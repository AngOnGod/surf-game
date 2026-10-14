// Source engine .bsp (v19-21) loader. Layouts: Valve Developer Wiki, "Source BSP File Format".
// World brushes (model 0's tree, incl. func_detail) + static solid brush entities become convex 'planes' brushes,
// displacements collision triangles; entities give spawn, teleports (trigger_teleport -> info_teleport_destination),
// pushes and kill volumes.
import { type Box, type BrushDef, type MapDef, type Spawn, buildWorld, ridingLine } from './game';
import { DEG, type Settings, type Tris, type Vec, makeTris } from './physics';
import { cos, sin } from './fmath';
import { type Mesh, type Model, loadModel, readPak, staticProps } from './mdl';

const SOLID = 0x1 | 0x2 | 0x8 | 0x4000 | 0x10000; // solid | window | grate | moveable | playerclip  (MASK_PLAYERSOLID)
const HIDDEN = 0x2 | 0x4 | 0x40 | 0x80 | 0x100 | 0x200; // sky2d | sky | trigger | nodraw | hint | skip
const TOOL = /^tools\/tools(?!black)/i; // clip, playerclip, invisible, skybox, nodraw...: collide but never drawn
const LIGHT = /^lights\//i; // self-lit panels: compiled with a black reflectivity, drawn white
const STATIC_SOLID = new Set(['func_brush', 'func_wall', 'func_wall_toggle', 'func_detail']);

export type Entity = Record<string, string>;
export type Shape = [number, number, number, number][][]; // convex brushes (n·x <= d planes): exact trigger volume
export type Filter = { name: string; negate: boolean }; // filter_activator_name: the player's targetname must (not) match
export interface Bsp {
  brushes: BrushDef[];
  entities: Entity[];
  spawn: Spawn;
  fails: (Box & { to?: Spawn; keep?: boolean; shape?: Shape; filter?: Filter })[];
  namers: (Box & { shape: Shape; name: string; filter?: Filter })[]; // triggers that rename the player (!activator AddOutput targetname)
  pushes: (Box & { vel: Vec; once: boolean; shape?: Shape })[];
  triggers: (Box & { e: Entity })[]; // trigger_multiple / trigger_once volumes (maps wire their outputs by hand)
  bounds: Box;
  terrain: Terrain;
  tris: Tris; // the displacements that are solid to players
  props: Props;
  settings: Partial<Settings>; // movement cvars the map sets itself when it loads
}
/** Static props to draw: each model once (its own space), with a placement matrix per copy (4x4, column-major). */
export type Props = (Mesh & { glass: Mesh; at: number[][] })[]; // glass: the see-through part
/** Displacements (terrain, cave walls) as a triangle soup to draw: positions, normals, colours. */
export interface Terrain { pos: Float32Array; nrm: Float32Array; col: Float32Array }

const vec = (s = '0 0 0') => s.trim().split(/\s+/).map(Number) as Vec;

export function parseBsp(buf: ArrayBuffer): Bsp {
  const dv = new DataView(buf), u8 = new Uint8Array(buf);
  if (dv.getUint32(0, true) !== 0x50534256) throw new Error('not a VBSP file');
  const version = dv.getInt32(4, true);
  const lump = (i: number) => ({ ofs: dv.getInt32(8 + i * 16, true), len: dv.getInt32(12 + i * 16, true), ver: dv.getInt32(16 + i * 16, true) });
  const f32 = (o: number) => dv.getFloat32(o, true), i32 = (o: number) => dv.getInt32(o, true);
  const u16 = (o: number) => dv.getUint16(o, true), i16 = (o: number) => dv.getInt16(o, true);

  // planes (20 B), texinfo (72 B), texdata (32 B) + names
  const P = lump(1), planes = [...Array(P.len / 20).keys()].map(i => { const o = P.ofs + i * 20; return [f32(o), f32(o + 4), f32(o + 8), f32(o + 12)]; });
  const TI = lump(6), TD = lump(2), SD = lump(43), ST = lump(44);
  const texName = (td: number) => { let o = SD.ofs + i32(ST.ofs + 4 * i32(TD.ofs + td * 32 + 12)), s = ''; while (u8[o]) s += String.fromCharCode(u8[o++]); return s; };
  const srgb = (c: number) => Math.round(255 * Math.min(1, Math.max(0, c)) ** (1 / 2.2));
  const faceColor = new Map<number, number | null>(); // texinfo -> colour, or null = not drawn
  const colorOf = (ti: number) => {
    if (ti < 0) return null;
    if (!faceColor.has(ti)) {
      const o = TI.ofs + ti * 72, flags = i32(o + 64), td = i32(o + 68), d = TD.ofs + td * 32;
      const dark = f32(d) + f32(d + 4) + f32(d + 8) < 0.05 && LIGHT.test(texName(td));
      faceColor.set(ti, flags & HIDDEN || td < 0 || TOOL.test(texName(td)) ? null : dark ? 0xffffff : (srgb(f32(d)) << 16) | (srgb(f32(d + 4)) << 8) | srgb(f32(d + 8)));
    }
    return faceColor.get(ti)!;
  };

  // which brushes belong to which model: walk each model's node tree down to its leaves' brush lists
  const N = lump(5), L = lump(10), LB = lump(17), M = lump(14);
  const leafSize = version <= 19 || L.ver === 0 ? 56 : 32;
  const brushesOf = (headnode: number) => {
    const out = new Set<number>(), stack = [headnode];
    while (stack.length) {
      const n = stack.pop()!;
      if (n < 0) { // leaf: firstleafbrush/numleafbrushes at +24/+26 in both layouts (old ones append a light cube)
        const o = L.ofs + (-1 - n) * leafSize, first = u16(o + 24), count = u16(o + 26);
        for (let k = 0; k < count; k++) out.add(u16(LB.ofs + 2 * (first + k)));
      } else stack.push(i32(N.ofs + n * 32 + 4), i32(N.ofs + n * 32 + 8));
    }
    return out;
  };
  const models = [...Array(M.len / 48).keys()].map(i => {
    const o = M.ofs + i * 48;
    return { mins: [f32(o), f32(o + 4), f32(o + 8)] as Vec, maxs: [f32(o + 12), f32(o + 16), f32(o + 20)] as Vec, headnode: i32(o + 36) };
  });

  // entities: { "key" "value" ... }
  const E = lump(0), text = new TextDecoder('latin1').decode(u8.subarray(E.ofs, E.ofs + E.len));
  const entities: Entity[] = [...text.matchAll(/\{([^{}]*)\}/g)].map(m => { // a key given more than once (outputs) keeps every value, a line each
    const e: Entity = {};
    for (const kv of m[1].matchAll(/"([^"]*)"\s+"([^"]*)"/g)) { const k = kv[1].toLowerCase(); e[k] = k in e ? `${e[k]}\n${kv[2]}` : kv[2]; }
    return e;
  });
  const modelOf = (e: Entity) => (e.model?.startsWith('*') ? models[+e.model.slice(1)] : undefined);

  // collision brushes: world + static solid brush entities
  const B = lump(18), S = lump(19);
  const keep = new Map<number, { org: Vec; hidden: boolean }>([...brushesOf(models[0].headnode)].map(b => [b, { org: [0, 0, 0], hidden: false }])); // brush -> model origin
  const shown = new Map<number, Vec>(); // drawn but never solid: func_illusionary (e.g. glass laid over an invisible clip ramp), never-solid brushes
  for (const e of entities) {
    if (!modelOf(e)) continue;
    const hidden = e.rendermode === '10' || (!!e.rendermode && e.rendermode !== '0' && e.renderamt === '0'); // not drawn
    if (STATIC_SOLID.has(e.classname) && e.solidity !== '1') brushesOf(modelOf(e)!.headnode).forEach(b => keep.set(b, { org: vec(e.origin), hidden }));
    else if ((e.classname === 'func_illusionary' || STATIC_SOLID.has(e.classname)) && !hidden) brushesOf(modelOf(e)!.headnode).forEach(b => shown.set(b, vec(e.origin)));
  }
  const brushPlanes = (b: number, org: Vec) => { // a brush's sides (minus compiler bevels; the engine adds its own), moved by org
    const o = B.ofs + b * 12, first = i32(o), count = i32(o + 4), sides: { pl: [number, number, number, number]; ti: number }[] = [];
    for (let k = 0; k < count; k++) {
      const so = S.ofs + (first + k) * 8;
      if (u8[so + 6]) continue;
      const [nx, ny, nz, d] = planes[u16(so)];
      sides.push({ pl: [nx, ny, nz, d + nx * org[0] + ny * org[1] + nz * org[2]], ti: i16(so + 2) });
    }
    return { contents: i32(o + 8), sides };
  };
  const brushes: BrushDef[] = [];
  const seeThrough = (ti: number) => ti >= 0 && !!(i32(TI.ofs + ti * 72 + 64) & 0x10); // SURF_TRANS: glass and the like
  const tint = (c: number | null) => (c !== null && ((c >> 16) + ((c >> 8) & 255) + (c & 255)) < 300 ? 0xd8e2ec : c); // dark see-through textures (grids) read as light glass
  for (const [b, { org, hidden }] of [...keep].sort((x, y) => x[0] - y[0])) {
    const { contents, sides } = brushPlanes(b, org);
    if (!(contents & SOLID)) continue;
    // clip-only brushes are invisible; windows (glass, grids: solid to players too) and translucent textures are drawn see-through
    const glass = (!(contents & 0x1) && !!(contents & 0x2)) || sides.some(s => seeThrough(s.ti) && colorOf(s.ti) !== null);
    brushes.push({ type: 'planes', planes: sides.map(s => s.pl), faceColors: sides.map(s => ((contents & 0x1 || contents & 0x2) && !hidden ? (glass ? tint(colorOf(s.ti)) : colorOf(s.ti)) : null)), ...(glass && { glass }) });
  }
  for (const [b, org] of [...shown].sort((x, y) => x[0] - y[0])) {
    const { sides } = brushPlanes(b, org), colors = sides.map(s => colorOf(s.ti));
    if (colors.every(c => c === null)) continue;
    const glass = sides.some(s => seeThrough(s.ti) && colorOf(s.ti) !== null);
    brushes.push({ type: 'planes', planes: sides.map(s => s.pl), faceColors: glass ? colors.map(tint) : colors, nonsolid: true, ...(glass && { glass }) });
  }

  // gameplay entities
  const byName = new Map(entities.filter(e => e.targetname).map(e => [e.targetname.toLowerCase(), e])); // Source names are case-insensitive
  const spawnOf = (e: Entity): Spawn => { const a = vec(e.angles); return { pos: vec(e.origin), yaw: a[1], pitch: a[0] }; };
  const boxOf = (e: Entity): (Box & { shape: Shape }) | undefined => { // AABB for the broadphase + the exact convex shape
    const m = modelOf(e), org = vec(e.origin);
    return m && {
      min: [0, 1, 2].map(i => m.mins[i] + org[i]) as Vec, max: [0, 1, 2].map(i => m.maxs[i] + org[i]) as Vec,
      shape: [...brushesOf(m.headnode)].map(b => brushPlanes(b, org).sides.map(s => s.pl)),
    };
  };
  const spawnEnt = entities.find(e => /^info_player_(start|terrorist|counterterrorist|teamspawn|deathmatch)$/.test(e.classname));
  const fails: Bsp['fails'] = [], pushes: Bsp['pushes'] = [], triggers: Bsp['triggers'] = [], namers: Bsp['namers'] = [];
  const filterOf = (name: string) => { const f = byName.get(name.toLowerCase()); return f?.classname === 'filter_activator_name' ? { name: (f.filtername ?? '').toLowerCase(), negate: f.negated === '1' } : undefined; };
  for (const e of entities) {
    const box = boxOf(e), filter = e.filtername ? filterOf(e.filtername) : undefined;
    if (!box || e.startdisabled === '1' || (e.filtername && !filter)) continue; // (other filter kinds never pass the player)
    if (filter) Object.assign(box, { filter });
    const dest = e.target && byName.get(e.target.toLowerCase());
    if (e.classname === 'trigger_teleport' && dest) fails.push({ ...box, to: spawnOf(dest), keep: true }); // keeps velocity (CTriggerTeleport::Touch passes none)
    else if (e.classname === 'trigger_hurt' && +(e.damage ?? 0) >= 100) fails.push(box); // kill volume: back to the current checkpoint
    else if (/^trigger_(multiple|once)$/.test(e.classname)) {
      triggers.push({ min: box.min, max: box.max, e });
      const rename = Object.values(e).join('\n').match(/!activator[,\x1b]AddOutput[,\x1b]targetname ([^,\x1b]*)[,\x1b]/i); // v21 (CS:GO) separates with ESC
      if (rename) namers.push({ ...box, name: rename[1].trim().toLowerCase() });
    }
    else if (e.classname === 'trigger_push') {
      const [p, y] = vec(e.pushdir), s = +(e.speed ?? 0);
      pushes.push({ ...box, vel: [cos(p * DEG) * cos(y * DEG) * s, cos(p * DEG) * sin(y * DEG) * s, -sin(p * DEG) * s], once: !!(+(e.spawnflags ?? 0) & 0x80) });
    }
  }
  // displacements: each a face (4 corners) subdivided 2^power times, every grid point pushed out along its own vector,
  // split into triangles as Source splits them (the diagonal alternates). Drawn when textured; solid to players unless
  // flagged not to collide with them (minTess carries the flags when its top bit is set: 0x4 = no hull collision).
  const V = lump(3), ED = lump(12), SE = lump(13), FA = lump(7), DI = lump(26), DV = lump(33), pos: number[] = [], nrm: number[] = [], col: number[] = [], solid: number[] = [];
  const vert = (i: number): Vec => [f32(V.ofs + i * 12), f32(V.ofs + i * 12 + 4), f32(V.ofs + i * 12 + 8)];
  const lerp = (a: Vec, b: Vec, t: number): Vec => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  for (let fi = 0; fi < FA.len / 56; fi++) {
    const o = FA.ofs + fi * 56, di = i16(o + 12);
    if (di < 0 || i16(o + 8) !== 4) continue;
    const d = DI.ofs + di * 176, mt = i32(d + 24) >>> 0, flags = mt & 0x80000000 ? mt & 0x7fffffff : 0;
    const color = colorOf(i16(o + 10)), hull = !!(i32(d + 32) & SOLID) && !(flags & 0x4);
    if (color === null && !hull) continue;
    const corners = [0, 1, 2, 3].map(k => { const se = i32(SE.ofs + (i32(o + 4) + k) * 4); return vert(u16(ED.ofs + Math.abs(se) * 4 + (se >= 0 ? 0 : 2))); });
    const start: Vec = [f32(d), f32(d + 4), f32(d + 8)], first = i32(d + 12), n = (1 << i32(d + 20)) + 1;
    const far = (c: Vec) => (c[0] - start[0]) ** 2 + (c[1] - start[1]) ** 2 + (c[2] - start[2]) ** 2, s0 = corners.reduce((m, c, k) => (far(c) < far(corners[m]) ? k : m), 0);
    const [c0, c1, c2, c3] = [0, 1, 2, 3].map(k => corners[(s0 + k) % 4]), pts: Vec[] = [];
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const p = lerp(lerp(c0, c1, y / (n - 1)), lerp(c3, c2, y / (n - 1)), x / (n - 1)), v = DV.ofs + (first + y * n + x) * 20, dist = f32(v + 12);
      pts.push([p[0] + f32(v) * dist, p[1] + f32(v + 4) * dist, p[2] + f32(v + 8) * dist]);
    }
    // the front is the face's: wind every triangle so its normal points that way on the flat grid
    const [pn0, pn1, pn2] = planes[u16(o)], up = u8[o + 2] ? -1 : 1, b = lerp(c0, c1, 1 / (n - 1)), c = lerp(b, lerp(c3, c2, 1 / (n - 1)), 1 / (n - 1));
    const u = [b[0] - c0[0], b[1] - c0[1], b[2] - c0[2]], w = [c[0] - c0[0], c[1] - c0[1], c[2] - c0[2]];
    const flip = ((u[1] * w[2] - u[2] * w[1]) * pn0 + (u[2] * w[0] - u[0] * w[2]) * pn1 + (u[0] * w[1] - u[1] * w[0]) * pn2) * up < 0;
    const rgb = color === null ? null : [(color >> 16) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255];
    const tri = (i: number, j: number, k: number) => {
      const [a, p, q] = flip ? [pts[i], pts[k], pts[j]] : [pts[i], pts[j], pts[k]];
      if (hull) solid.push(...a, ...p, ...q);
      if (!rgb) return;
      const e = [p[0] - a[0], p[1] - a[1], p[2] - a[2]], f = [q[0] - a[0], q[1] - a[1], q[2] - a[2]], nn = [e[1] * f[2] - e[2] * f[1], e[2] * f[0] - e[0] * f[2], e[0] * f[1] - e[1] * f[0]];
      const l = Math.hypot(nn[0], nn[1], nn[2]) || 1;
      for (const r of [a, p, q]) { pos.push(...r); nrm.push(nn[0] / l, nn[1] / l, nn[2] / l); col.push(...rgb); }
    };
    for (let y = 0; y + 1 < n; y++) for (let x = 0; x + 1 < n; x++) {
      const i = y * n + x;
      if (i % 2) { tri(i, i + n, i + 1); tri(i + 1, i + n, i + n + 1); } else { tri(i, i + n, i + n + 1); tri(i, i + n + 1, i + 1); }
    }
  }
  // static props: the models packed in the map, drawn; solid ones (vphysics) collide through their convex hulls
  const PK = lump(40), GL = lump(35), pak = readPak(u8, PK.ofs, PK.len), props: Props = [], placed = new Map<string, number>();
  const mdls = new Map<string, (Model & { planes: [number, number, number, number][][] }) | null>(); // per hull: its planes (n, d) in model space
  for (const p of GL.len ? staticProps(u8, GL.ofs) : []) {
    const key = `${p.model.toLowerCase()}#${p.skin}`;
    if (!mdls.has(key)) {
      const m = loadModel(pak, p.model, p.skin);
      mdls.set(key, m && { ...m, planes: m.hulls.map(hullOf) });
    }
    const m = mdls.get(key);
    if (!m) continue;
    const [ap, ay, ar] = p.angles.map(a => a * DEG), sp = sin(ap), cp = cos(ap), sy = sin(ay), cy = cos(ay), sr = sin(ar), cr = cos(ar), k = p.scale, o = p.origin;
    const R = [[cp * cy, sr * sp * cy - cr * sy, cr * sp * cy + sr * sy], [cp * sy, sr * sp * sy + cr * cy, cr * sp * sy - sr * cy], [-sp, sr * cp, cr * cp]]; // Source's AngleMatrix
    if (!placed.has(key)) { placed.set(key, props.length); props.push({ pos: m.pos, nrm: m.nrm, col: m.col, glass: m.glass, at: [] }); }
    props[placed.get(key)!].at.push([R[0][0] * k, R[1][0] * k, R[2][0] * k, 0, R[0][1] * k, R[1][1] * k, R[2][1] * k, 0, R[0][2] * k, R[1][2] * k, R[2][2] * k, 0, o[0], o[1], o[2], 1]);
    if (p.solid !== 6) continue; // SOLID_VPHYSICS; 0 is not solid (bounding-box props are rare enough to leave out)
    for (const hull of m.planes) { // n' = R n, d' = k d + n'·origin
      const planes = hull.map(([nx, ny, nz, d]): [number, number, number, number] => { const n = R.map(r => r[0] * nx + r[1] * ny + r[2] * nz); return [n[0], n[1], n[2], k * d + n[0] * o[0] + n[1] * o[1] + n[2] * o[2]]; });
      if (planes.length >= 4) brushes.push({ type: 'planes', planes, faceColors: planes.map(() => null) });
    }
  }
  const terrain = { pos: new Float32Array(pos), nrm: new Float32Array(nrm), col: new Float32Array(col) }, tris = makeTris(new Float64Array(solid));
  const w = models[0];
  // the movement cvars a map sets itself on load (a logic_auto's OnMapSpawn -> point_servercommand "Command" outputs)
  const settings: Partial<Settings> = {}, servers = new Set(entities.filter(e => e.classname === 'point_servercommand' && e.targetname).map(e => e.targetname.toLowerCase()));
  const CVARS: Record<string, (v: number) => Partial<Settings>> = {
    sv_maxvelocity: v => ({ maxvelocity: v }), sv_airaccelerate: v => ({ airaccelerate: v }), sv_accelerate: v => ({ accelerate: v }), sv_gravity: v => ({ gravity: v }),
    sv_friction: v => ({ friction: v }), sv_enablebunnyhopping: v => ({ bhopLimiter: !v }), sv_autobunnyhopping: v => ({ autobhop: !!v }),
  };
  for (const e of entities) if (e.classname === 'logic_auto') for (const out of (e.onmapspawn ?? '').split('\n')) {
    const [target, input, param] = out.split(/[,\x1b]/);
    const [cvar, value] = (param ?? '').trim().split(/\s+/);
    if (servers.has(target?.toLowerCase()) && /^command$/i.test(input ?? '') && CVARS[cvar?.toLowerCase()] && Number.isFinite(+value)) Object.assign(settings, CVARS[cvar.toLowerCase()](+value));
  }
  return { brushes, entities, fails, pushes, triggers, namers, spawn: spawnEnt ? spawnOf(spawnEnt) : { pos: [0, 0, 0], yaw: 0 }, bounds: { min: w.mins, max: w.maxs }, terrain, tris, props, settings };
}

/** A convex hull's planes (n·x <= d) from its own triangles: oriented away from its centre, duplicates merged. */
function hullOf({ pts, tris }: Model['hulls'][number]): [number, number, number, number][] {
  const c = [0, 1, 2].map(k => pts.reduce((a, p) => a + p[k], 0) / pts.length), out: [number, number, number, number][] = [];
  for (let t = 0; t + 2 < tris.length; t += 3) {
    const [a, b, e] = [pts[tris[t]], pts[tris[t + 1]], pts[tris[t + 2]]], u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [e[0] - a[0], e[1] - a[1], e[2] - a[2]];
    let n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const l = Math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]);
    if (!(l > 1e-3)) continue; // a sliver: its neighbours bound the hull there
    n = n.map(x => x / l);
    if (n[0] * (c[0] - a[0]) + n[1] * (c[1] - a[1]) + n[2] * (c[2] - a[2]) > 0) n = n.map(x => -x);
    const d = n[0] * a[0] + n[1] * a[1] + n[2] * a[2];
    if (pts.some(p => n[0] * p[0] + n[1] * p[1] + n[2] * p[2] > d + 0.1)) continue; // not a supporting plane (float noise on a near-flat fold)
    if (!out.some(q => q[0] * n[0] + q[1] * n[1] + q[2] * n[2] > 1 - 1e-6 && Math.abs(q[3] - d) < 0.01)) out.push([n[0], n[1], n[2], d]);
  }
  return out;
}

/** A map file as fetched: a gzipped copy (an original too big to host as it is, compressed whole) is unpacked. */
export const unpack = async (buf: ArrayBuffer): Promise<ArrayBuffer> => {
  const h = new Uint8Array(buf, 0, Math.min(2, buf.byteLength));
  return h[0] === 0x1f && h[1] === 0x8b ? new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer() : buf;
};

/** Load a map's .bsp (browser: fetch; tests pass their own reader) and merge it into the definition. */
export async function resolveMap(def: MapDef, read: (url: string) => Promise<ArrayBuffer> = u => fetch(u).then(r => {
  if (!r.ok) throw new Error(`${u} not found`);
  return r.arrayBuffer();
})): Promise<MapDef> {
  const b = def.bsp && parseBsp(await unpack(await read(def.bsp.url))), full = b ? { ...def, ...def.bsp!.apply(b), terrain: b.terrain, tris: b.tris, props: b.props, settings: { ...b.settings, ...def.settings } } : def;
  if (!full.routeOnSurface || !full.route) return full;
  const world = buildWorld(full);
  return { ...full, world, route: ridingLine(world, full.route) };
}
