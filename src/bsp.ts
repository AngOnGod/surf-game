// Source engine .bsp (v19-21) loader. Layouts: Valve Developer Wiki, "Source BSP File Format".
// World brushes (model 0's tree, incl. func_detail) + static solid brush entities become convex 'planes' brushes,
// displacements collision triangles; entities give spawn, teleports (trigger_teleport -> info_teleport_destination),
// pushes and kill volumes.
import { type Box, type BrushDef, type MapDef, type Spawn, buildWorld, ridingLine } from './game';
import { DEG, type Settings, type Tris, type Vec, makeTris } from './physics';
import { cos, sin } from './fmath';
import { type Mesh, type Model, loadModel, readPak, staticProps } from './mdl';
import { type Look, type Mat, type Part, material, sky } from './look';

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
  look?: Look; // the map's own look, when asked for
}
/** Static props to draw: each model once (its own space), with a placement matrix per copy (4x4, column-major). */
export type Props = (Mesh & { glass: Mesh; at: number[][] })[]; // glass: the see-through part
/** Displacements (terrain, cave walls) as a triangle soup to draw: positions, normals, colours. */
export interface Terrain { pos: Float32Array; nrm: Float32Array; col: Float32Array }

const vec = (s = '0 0 0') => s.trim().split(/\s+/).map(Number) as Vec;

export function parseBsp(buf: ArrayBuffer, opts: { look?: boolean } = {}): Bsp {
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
  const look = opts.look ? lookOf() : undefined;
  for (const [pi, p] of (GL.len ? staticProps(u8, GL.ofs) : []).entries()) {
    const key = `${p.model.toLowerCase()}#${p.skin}`;
    if (!mdls.has(key)) {
      const m = loadModel(pak, p.model, p.skin, !!look);
      mdls.set(key, m && { ...m, planes: m.hulls.map(hullOf) });
    }
    const m = mdls.get(key);
    if (!m) continue;
    const [ap, ay, ar] = p.angles.map(a => a * DEG), sp = sin(ap), cp = cos(ap), sy = sin(ay), cy = cos(ay), sr = sin(ar), cr = cos(ar), k = p.scale, o = p.origin;
    const R = [[cp * cy, sr * sp * cy - cr * sy, cr * sp * cy + sr * sy], [cp * sy, sr * sp * sy + cr * cy, cr * sp * sy - sr * cy], [-sp, sr * cp, cr * cp]]; // Source's AngleMatrix
    if (!placed.has(key)) { placed.set(key, props.length); props.push({ pos: m.pos, nrm: m.nrm, col: m.col, glass: m.glass, at: [] }); }
    props[placed.get(key)!].at.push([R[0][0] * k, R[1][0] * k, R[2][0] * k, 0, R[0][1] * k, R[1][1] * k, R[2][1] * k, 0, R[0][2] * k, R[1][2] * k, R[2][2] * k, 0, o[0], o[1], o[2], 1]);
    look?.prop(m.meshes, R.map(r => r.map(x => x * k)), o, pak.get(`sp_${pi}.vhv`));
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
  return { brushes, entities, fails, pushes, triggers, namers, spawn: spawnEnt ? spawnOf(spawnEnt) : { pos: [0, 0, 0], yaw: 0 }, bounds: { min: w.mins, max: w.maxs }, terrain, tris, props, settings, look: look?.done() };

  /** The map's own look: its faces by material (texture and lightmap coordinates), a lightmap atlas, its props lit by
   *  their baked vertex lighting, its sky. */
  function lookOf() {
    const mats: Mat[] = [], ids = new Map<string, number>(), acc: { pos: number[]; uv: number[]; lm: number[]; light: number[]; index: number[] }[] = [];
    const matOf = (path: string, flat: Vec, lit: 0 | 1 | 2) => {
      const k = `${path.toLowerCase()}|${lit}`;
      if (!ids.has(k)) { ids.set(k, mats.length); mats.push(material(pak, path, flat, lit)); acc.push({ pos: [], uv: [], lm: [], light: [], index: [] }); }
      return ids.get(k)!;
    };
    // faces of the world and of the brush entities drawn (not triggers, tool volumes or hidden ones), where they stand
    const LM = lump(8).len ? lump(8) : lump(53), lit: { a: (typeof acc)[number]; at: number; n: number; ofs: number; w: number; h: number; x: number; y: number }[] = [];
    const hidden = (e: Entity) => e.rendermode === '10' || (!!e.rendermode && e.rendermode !== '0' && e.renderamt === '0');
    const drawn: [number, Vec][] = [[0, [0, 0, 0]], ...entities.filter(e => e.model?.startsWith('*') && !hidden(e) && !/^(trigger_|func_(areaportal|occluder|viscluster|clip_vphysics|precipitation|dustmotes|smokevolume|buyzone|bomb_target|hostage_rescue))/.test(e.classname)).map((e): [number, Vec] => [+e.model.slice(1), vec(e.origin)])];
    for (const [mi, org] of drawn) for (let f = i32(M.ofs + mi * 48 + 40), end = f + i32(M.ofs + mi * 48 + 44); f < end; f++) {
      const o = FA.ofs + f * 56, ti = i16(o + 10);
      if (ti < 0 || i16(o + 12) >= 0) continue; // (displacements are drawn as terrain)
      const t = TI.ofs + ti * 72, flags = i32(t + 64), td = i32(t + 68);
      if (flags & HIDDEN || td < 0 || TOOL.test(texName(td))) continue;
      const vs = [...Array(i16(o + 8)).keys()].map(k => { const se = i32(SE.ofs + (i32(o + 4) + k) * 4); return vert(u16(ED.ofs + Math.abs(se) * 4 + (se >= 0 ? 0 : 2))); });
      const d = TD.ofs + td * 32, mapped = i32(o + 20) >= 0 && u8[o + 16] !== 255 && !(flags & 0x400); // lightmapped (style 0)
      const a = acc[matOf(texName(td), [0, 4, 8].map(q => Math.min(1, Math.max(0, f32(d + q))) ** (1 / 2.2)) as Vec, mapped ? 1 : 0)], first = a.pos.length / 3;
      const dot = (v: Vec, q: number) => v[0] * f32(t + q) + v[1] * f32(t + q + 4) + v[2] * f32(t + q + 8) + f32(t + q + 12);
      for (const v of vs) {
        a.pos.push(v[0] + org[0], v[1] + org[1], v[2] + org[2]);
        a.uv.push(dot(v, 0) / (i32(d + 16) || 1), dot(v, 16) / (i32(d + 20) || 1));
        if (mapped) a.lm.push(dot(v, 32) - i32(o + 28), dot(v, 48) - i32(o + 32)); // in luxels: placed in the atlas below
      }
      if (mapped) lit.push({ a, at: a.lm.length - 2 * vs.length, n: vs.length, ofs: LM.ofs + i32(o + 20), w: i32(o + 36) + 1, h: i32(o + 40) + 1, x: 0, y: 0 });
      const [pn0, pn1, pn2] = planes[u16(o)], u = vs.reduce((s, v, i) => { const w = vs[(i + 1) % vs.length]; return [s[0] + (v[1] - w[1]) * (v[2] + w[2]), s[1] + (v[2] - w[2]) * (v[0] + w[0]), s[2] + (v[0] - w[0]) * (v[1] + w[1])]; }, [0, 0, 0]);
      const flip = (u[0] * pn0 + u[1] * pn1 + u[2] * pn2) * (u8[o + 2] ? -1 : 1) < 0; // wound to face the plane's side
      for (let k = 1; k + 1 < vs.length; k++) a.index.push(first, first + (flip ? k + 1 : k), first + (flip ? k : k + 1));
    }
    // the lightmaps, packed into rows of an atlas: luxels (r, g, b, exponent) as gamma, halved
    let W = 256;
    while (W * W < 1.3 * lit.reduce((s, b) => s + b.w * b.h, 0)) W *= 2;
    let x = 0, y = 0, row = 0;
    for (const b of [...lit].sort((p, q) => q.h - p.h)) {
      if (x + b.w > W) { x = 0; y += row; row = 0; }
      Object.assign(b, { x, y }); x += b.w; row = Math.max(row, b.h);
    }
    const H = Math.max(1, 2 ** Math.ceil(Math.log2(y + row || 1))), rgba = new Uint8Array(W * H * 4);
    for (const b of lit) {
      for (let j = 0; j < b.h; j++) for (let i = 0; i < b.w; i++) {
        const l = b.ofs + 4 * (j * b.w + i), e = 2 ** dv.getInt8(l + 3) / 255, p = ((b.y + j) * W + b.x + i) * 4;
        for (let q = 0; q < 3; q++) rgba[p + q] = Math.min(255, Math.round(127.5 * (u8[l + q] * e) ** (1 / 2.2)));
        rgba[p + 3] = 255;
      }
      for (let k = 0; k < b.n; k++) { b.a.lm[b.at + 2 * k] = (b.x + b.a.lm[b.at + 2 * k] + 0.5) / W; b.a.lm[b.at + 2 * k + 1] = (b.y + b.a.lm[b.at + 2 * k + 1] + 0.5) / H; }
    }
    return {
      /** A static prop's meshes, placed (R: rotation times scale, o: origin), lit by its .vhv: colours per strip group
       *  vertex (BGRA; three of them, one per bump direction, when 12 bytes a vertex), gamma with 2x overbright. */
      prop(meshes: NonNullable<Model>['meshes'], R: number[][], o: Vec, vhv?: Uint8Array) {
        const V = vhv && new DataView(vhv.buffer, vhv.byteOffset, vhv.byteLength), size = V ? V.getUint32(12, true) : 0, groups: [number, number][] = [];
        for (let i = 0; V && i < V.getInt32(20, true); i++) if (V.getUint32(40 + 28 * i, true) === 0) groups.push([V.getUint32(44 + 28 * i, true), V.getUint32(48 + 28 * i, true)]);
        const light = (key: number): Vec => {
          const [n, at] = groups[key >>> 16] ?? [0, 0], i = key & 0xffff;
          if (!vhv || i >= n || at + (i + 1) * size > vhv.length) return [0.9, 0.9, 0.9];
          const c: Vec = [0, 0, 0], k = size >= 12 ? 3 : 1;
          for (let s = 0; s < k; s++) for (let q = 0; q < 3; q++) c[q] += (vhv[at + i * size + 4 * s + 2 - q] / 127.5) ** 2.2 / k;
          return c.map(v => v ** (1 / 2.2)) as Vec;
        };
        for (const m of meshes) {
          const a = acc[matOf(m.mat, [1, 1, 1], 2)], first = a.pos.length / 3;
          for (let v = 0; v < m.pos.length / 3; v++) {
            const [px, py, pz] = [m.pos[3 * v], m.pos[3 * v + 1], m.pos[3 * v + 2]];
            for (let r = 0; r < 3; r++) a.pos.push(R[r][0] * px + R[r][1] * py + R[r][2] * pz + o[r]);
            a.uv.push(m.uv[2 * v], m.uv[2 * v + 1]);
            a.light.push(...light(m.light[v]));
          }
          for (const i of m.index) a.index.push(first + i);
        }
      },
      done(): Look {
        const parts: Part[] = acc.flatMap((a, mat) => a.index.length ? [{
          mat, pos: new Float32Array(a.pos), uv: new Float32Array(a.uv), index: new Uint32Array(a.index),
          ...(mats[mat].lit === 1 && { lm: new Float32Array(a.lm) }), ...(mats[mat].lit === 2 && { light: new Float32Array(a.light) }),
        }] : []);
        return { mats, parts, lightmap: lit.length ? { w: W, h: H, rgba } : null, sky: sky(pak, entities.find(e => e.classname === 'worldspawn')?.skyname ?? '') };
      },
    };
  }
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
  const b = def.bsp && parseBsp(await unpack(await read(def.bsp.url)), { look: def.bsp.look }), full = b ? { ...def, ...def.bsp!.apply(b), terrain: b.terrain, tris: b.tris, props: b.props, look: b.look, settings: { ...b.settings, ...def.settings } } : def;
  if (!full.routeOnSurface || !full.route) return full;
  const world = buildWorld(full);
  return { ...full, world, route: ridingLine(world, full.route) };
}
