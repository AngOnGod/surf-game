// Source engine .bsp (v19-21) loader. Layouts: Valve Developer Wiki, "Source BSP File Format".
// World brushes (model 0's tree, incl. func_detail) + static solid brush entities become convex 'planes' brushes;
// entities give spawn, teleports (trigger_teleport -> info_teleport_destination), pushes and kill volumes.
import { type Box, type BrushDef, type MapDef, type Spawn, buildBrush, ridingLine } from './game';
import { DEG, type Vec } from './physics';
import { cos, sin } from './fmath';

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
  fails: (Box & { to?: Spawn; shape?: Shape; filter?: Filter })[];
  namers: (Box & { shape: Shape; name: string; filter?: Filter })[]; // triggers that rename the player (!activator AddOutput targetname)
  pushes: (Box & { vel: Vec; once: boolean; shape?: Shape })[];
  triggers: (Box & { e: Entity })[]; // trigger_multiple / trigger_once volumes (maps wire their outputs by hand)
  bounds: Box;
}

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
  const entities: Entity[] = [...text.matchAll(/\{([^{}]*)\}/g)].map(m => Object.fromEntries([...m[1].matchAll(/"([^"]*)"\s+"([^"]*)"/g)].map(kv => [kv[1].toLowerCase(), kv[2]])));
  const modelOf = (e: Entity) => (e.model?.startsWith('*') ? models[+e.model.slice(1)] : undefined);

  // collision brushes: world + static solid brush entities
  const B = lump(18), S = lump(19);
  const keep = new Map<number, { org: Vec; hidden: boolean }>([...brushesOf(models[0].headnode)].map(b => [b, { org: [0, 0, 0], hidden: false }])); // brush -> model origin
  for (const e of entities) {
    if (!STATIC_SOLID.has(e.classname) || e.solidity === '1' || !modelOf(e)) continue;
    const hidden = e.rendermode === '10' || (!!e.rendermode && e.rendermode !== '0' && e.renderamt === '0'); // solid but not drawn
    brushesOf(modelOf(e)!.headnode).forEach(b => keep.set(b, { org: vec(e.origin), hidden }));
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
  for (const [b, { org, hidden }] of [...keep].sort((x, y) => x[0] - y[0])) {
    const { contents, sides } = brushPlanes(b, org);
    if (!(contents & SOLID)) continue;
    // clip-only brushes are invisible
    brushes.push({ type: 'planes', planes: sides.map(s => s.pl), faceColors: sides.map(s => (contents & 0x1 && !hidden ? colorOf(s.ti) : null)) });
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
    if (e.classname === 'trigger_teleport' && dest) fails.push({ ...box, to: spawnOf(dest) });
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
  const w = models[0];
  return { brushes, entities, fails, pushes, triggers, namers, spawn: spawnEnt ? spawnOf(spawnEnt) : { pos: [0, 0, 0], yaw: 0 }, bounds: { min: w.mins, max: w.maxs } };
}

/** Load a map's .bsp (browser: fetch; tests pass their own reader) and merge it into the definition. */
export async function resolveMap(def: MapDef, read: (url: string) => Promise<ArrayBuffer> = u => fetch(u).then(r => {
  if (!r.ok) throw new Error(`${u} not found`);
  return r.arrayBuffer();
})): Promise<MapDef> {
  const full = def.bsp ? { ...def, ...def.bsp.apply(parseBsp(await read(def.bsp.url))) } : def;
  if (!full.routeOnSurface || !full.route) return full;
  const world = full.brushes.map(buildBrush);
  return { ...full, world, route: ridingLine(world, full.route) };
}
