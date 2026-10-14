// Map format, brush builders and the game session (triggers, timer, practice checkpoints).
import {
  type Brush, type Cmd, type Player, type Settings, type Tris, type Vec, type World, DEG, HULL_MIN, HULL_STAND, add,
  categorizePosition, ctx, hullMax, hullPlanes, makeBrush, newPlayer, playerMove, scale, teleport, trace,
} from './physics';
import type { Bsp, Filter, Props, Shape, Terrain } from './bsp';
import type { Look } from './look';
import { cos, sin } from './fmath';

export interface Spawn { pos: Vec; yaw: number; pitch?: number }
export interface Box { min: Vec; max: Vec }
/** pos is the bottom-centre of the unrotated shape; yaw rotates about Z, ramp pitch tips the +X end down. */
export type BrushDef =
  | { type: 'box'; pos: Vec; size: Vec; yaw?: number; color?: number }
  | { type: 'ramp'; pos: Vec; length: number; width: number; height: number; yaw?: number; pitch?: number; sides?: 'both' | 'left' | 'right'; color?: number }
  | { type: 'planes'; planes: [number, number, number, number][]; color?: number; faceColors?: (number | null)[]; glass?: boolean; nonsolid?: boolean }; // n·x <= d, outward normals; null colour = not drawn; glass: drawn see-through; nonsolid: drawn only

export interface MapDef {
  id: string; name: string; blurb?: string; order?: number;
  spawn: Spawn;
  brushes: BrushDef[];
  start?: Box; end?: Box; // run zones; staged maps default to the first stage start / last stage end
  checkpoints?: (Box & { name?: string; spawn?: Spawn; also?: Box[] })[]; // sections: split on entry, implicit fail respawn; also: extra boxes (mirrored routes)
  stages?: { name?: string; start: Box; end: Box; spawn: Spawn }[];
  fails?: (Box & { to?: Spawn; keep?: boolean; quiet?: boolean; shape?: Shape; filter?: Filter })[]; // teleport volumes; `to` omitted: current section / stage start; keep: velocity and duck kept (Source trigger_teleport); quiet: not a fail; shape: exact convex volume (imported triggers)
  pushes?: (Box & { vel: Vec; once?: boolean; set?: boolean; shape?: Shape })[]; // trigger_push: base velocity while inside; once: impulse on entry; set: velocity on entry
  route?: (Vec | [number, number, number, number])[]; // optional autopilot waypoints (4th value: riding height, see ridingLine)
  routeOnSurface?: boolean; // route points are guides ([x, y, zHint, h?]): turned into a riding line on the faces at load (see ridingLine)
  routeFlags?: number[]; // per route point, for the autopilot (1: a launch must pass through this point, see makeBot)
  routeCorners?: boolean; // autopilot: a waypoint at a corner is passed at the bisector (tight, turning routes)
  world?: World; // prebuilt collision brushes (set by the loader)
  bsp?: { url: string; apply: (b: Bsp) => Partial<MapDef>; own?: { get: string; sha256: string }; look?: boolean }; // geometry/entities from a Source .bsp, loaded on demand; own: not shipped (no licence to share): players pick their own copy (where to get it, the exact file the zones and route fit); look: drawn with its own materials, lighting and sky
  credit?: { by: string; source: string; license?: [string, string] }; // third-party maps: author, where it's from, licence name + link
  trail?: { zone: Box; width: [number, number]; life: number; height: number }; // a sprite trail handed out in zone (Source env_spritetrail parented to you)
  namers?: (Box & { shape?: Shape; name: string; filter?: Filter })[]; // zones that set the player's targetname (for filtered triggers)
  terrain?: Terrain; // an imported map's displacements (terrain, cave walls), drawn
  tris?: Tris; // ...and those solid to players, as collision triangles
  props?: Props; // an imported map's static props, drawn (the solid ones' hulls are among its brushes)
  look?: Look; // an imported map's own look (bsp.look): drawn in place of the flat colours
  settings?: Partial<Settings>; // movement settings the map sets itself (an imported map's spawn commands): they apply on it
}

export const box = (pos: Vec, size: Vec, o: { yaw?: number; color?: number } = {}): BrushDef => ({ type: 'box', pos, size, ...o });
export const ramp = (pos: Vec, o: { length: number; width: number; height: number; yaw?: number; pitch?: number; sides?: 'both' | 'left' | 'right'; color?: number }): BrushDef =>
  ({ type: 'ramp', pos, ...o });
/** AABB from bottom-centre + size. */
export const zone = (pos: Vec, size: Vec): Box => ({
  min: [pos[0] - size[0] / 2, pos[1] - size[1] / 2, pos[2]], max: [pos[0] + size[0] / 2, pos[1] + size[1] / 2, pos[2] + size[2]],
});

// ---------------------------------------------------------------- course builder (map authoring helper)
// Lays two-sided ramps along +X with a riding line, gaps, drops, gate walls and mid-air slots. One row per ramp:
//   gap    air distance from the previous ramp's end       dy     lateral shift of the ramp centre
//   drop   how far the landing line sits below the line you leave on (default: clears the gap at `vmin` u/s)
//   face   side the line rides (+1 = +Y face, -1 = -Y face) W/H    cross-section width/height   pitch  nose-down °
//   gates  walls with a window at `at` (fraction of length) and `h` (fraction of face height)   slit   slot in the gap
// The first ramp starts under a spawn platform (walk off its edge onto the face); an end platform follows the last.
export interface Row { len: number; gap: number; drop?: number; vmin?: number; dy?: number; W?: number; H?: number; pitch?: number; face?: 1 | -1; color?: number; gates?: { at: number; h: number }[]; slit?: boolean }
export interface Leg { x0: number; y: number; bottom: number; W: number; H: number; spawn: Spawn }
export interface Course { brushes: BrushDef[]; fails: Box[]; route: Vec[]; legs: Leg[]; spawn: Spawn; start: Box; end: Box; endTop: number }
const LAND = 0.68, RIDE = 0.5, WALL = 0xe0a040, PLATFORM = 0x9aa3ad; // line heights: 0 = bottom edge, 1 = apex

/** `at`: x of the spawn platform's front edge, lateral centre, apex height of the first ramp. */
export function course(rows: Row[], at: Vec): Course {
  const brushes: BrushDef[] = [], fails: Box[] = [], route: Vec[] = [], legs: Leg[] = [];
  const EDGE = at[0] - 40;
  let x = at[0] - 800, y = at[1], face: 1 | -1 = 1, prevPitch = 0, prevBottom = 0, edge: Vec = [0, 0, 0];
  rows.forEach((r, ri) => {
    const W = r.W ?? 1152, H = r.H ?? 700, L = r.len, p = (r.pitch ?? 2) * DEG, c = cos(p), s = sin(p);
    const prevEnd = x, leave = route.at(-1);
    x += r.gap; y += r.dy ?? 0; face = r.face ?? face;
    // place the apex so the landing line point (300 in, height LAND) sits `drop` below where the last line left off
    const G = r.gap + 120, drop = r.drop ?? G * sin(prevPitch) + 400 * (G / (r.vmin ?? 850)) ** 2 + 150 + 300 * s;
    const zApex = leave ? leave[2] - drop + 300 * s + H * c * (1 - LAND) : at[2];
    const pz = zApex - (L / 2) * s - H * c, px = x + (L / 2) * c;
    const w = (lx: number, ly: number, lz: number): Vec => [px + lx * c + lz * s, y + ly, pz - lx * s + lz * c]; // ramp local -> world
    // player origin riding the face at relative height h (box edge on the face)
    const on = (lx: number, h: number): Vec => { const q = w(lx, face * (W / 2) * (1 - h), H * h); return [q[0], q[1] + face * 16, q[2]]; };
    brushes.push(ramp([px, y, pz], { length: L, width: W, height: H, pitch: r.pitch ?? 2, color: r.color }));
    const x1 = w(L / 2, 0, 0)[0], low = w(L / 2, 0, 0)[2], bottom = w(-L / 2, 0, 0)[2];
    fails.push({ min: [x - 32, y - 3000, low - 6000], max: [x1 + 32, y + 3000, low - 120] });
    if (r.gap) fails.push({ min: [prevEnd, y - 3000, low - 6000], max: [x, y + 3000, Math.min(bottom, prevBottom) - 120] });
    const lxEdge = (EDGE - px - (H / 2) * s) / c; // local x under the spawn platform's front edge
    if (ri === 0) edge = on(lxEdge, RIDE);
    const sp = on(-L / 2 + 250, RIDE);
    legs.push({ x0: x, y, bottom, W, H, spawn: { pos: [sp[0], sp[1], sp[2] + 48], yaw: 0, pitch: 20 } });
    const land = ri === 0 ? on(lxEdge + 400, RIDE) : on(-L / 2 + 300, LAND); // land high: room to absorb it
    if (r.slit && leave) { // pillars across the gap, slot centred on the straight line between leaving and landing
      const m = (prevEnd + x) / 2, t = (m - leave[0]) / (land[0] - leave[0]);
      const sy = leave[1] + (land[1] - leave[1]) * t, sw = 96, zb = Math.min(leave[2], land[2]) - 1400, zt = Math.max(leave[2], land[2]) + 1400;
      brushes.push(box([m, sy - sw - 600, zb], [64, 1200, zt - zb], { color: WALL }), box([m, sy + sw + 600, zb], [64, 1200, zt - zb], { color: WALL }));
      route.push([m, sy, leave[2] + (land[2] - leave[2]) * t]);
    }
    route.push(land);
    for (const g of r.gates ?? []) { // wall with a window around the line at this height
      const lx = -L / 2 + g.at * L, o = on(lx, g.h), hw = 160, gx = o[0];
      const zb = w(lx, 0, 0)[2] - 300, zt = w(lx, 0, H)[2] + 700, y0 = y - W / 2 - 400, y1 = y + W / 2 + 400;
      const lo = o[1] - hw, hi = o[1] + hw, top = o[2] + 72 + 240;
      brushes.push(
        box([gx, (y0 + lo) / 2, zb], [48, lo - y0, zt - zb], { color: WALL }),
        box([gx, (hi + y1) / 2, zb], [48, y1 - hi, zt - zb], { color: WALL }),
        box([gx, o[1], top], [48, hi - lo, zt - top], { color: WALL }),
      );
      route.push(on(lx - 600, g.h), on(lx + 200, g.h));
    }
    route.push(on(L / 2 - 120, RIDE));
    x = x1; prevPitch = p; prevBottom = low;
  });
  const plat = edge[2] + 100, pc: Vec = [EDGE - 384, edge[1], plat];
  brushes.push(box([pc[0], pc[1], plat - 64], [768, 768, 64], { color: PLATFORM }));
  const endTop = route.at(-1)![2] - 1800;
  brushes.push(box([x + 3200, y, endTop - 128], [5000, 3000, 128], { color: PLATFORM }));
  fails.push({ min: [x, y - 3000, endTop - 6000], max: [x + 700, y + 3000, endTop - 200] });
  route.push([x + 3200, y, endTop]);
  return {
    brushes, fails, route, legs, endTop,
    spawn: { pos: [EDGE - 300, edge[1], plat + 1], yaw: 0 },
    start: zone(pc, [768, 768, 160]),
    end: zone([x + 1700, y, endTop], [2000, 3000, 2600]),
  };
}

const rotZ = (v: Vec, a: number): Vec => { const c = cos(a * DEG), s = sin(a * DEG); return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]]; };
const rotY = (v: Vec, a: number): Vec => { const c = cos(a * DEG), s = sin(a * DEG); return [v[0] * c + v[2] * s, v[1], -v[0] * s + v[2] * c]; };

/** The collision world: the brushes, and the displacement triangles if the map has any. */
export const buildWorld = (def: MapDef): World => Object.assign(def.brushes.map(buildBrush), { tris: def.tris });

export function buildBrush(d: BrushDef): Brush {
  if (d.type === 'planes') return { ...makeBrush(d.planes.map(([x, y, z, w]) => ({ n: [x, y, z], d: w })), d.color ?? 0x8a8f98, d.faceColors), glass: d.glass, nonsolid: d.nonsolid };
  let pts: Vec[];
  if (d.type === 'box') {
    const [x, y, z] = d.size;
    pts = [-x / 2, x / 2].flatMap(a => [-y / 2, y / 2].flatMap(b => [[a, b, 0], [a, b, z]] as Vec[]));
  } else {
    const { length: L, width: W, height: H } = d, s = d.sides ?? 'both';
    const top = s === 'both' ? 0 : s === 'left' ? -W / 2 : W / 2; // 'left' slope faces +Y (left of +X)
    pts = [-L / 2, L / 2].flatMap(x => [[x, -W / 2, 0], [x, W / 2, 0], [x, top, H]] as Vec[]).map(v => rotY(v, d.pitch ?? 0));
  }
  pts = pts.map(v => add(rotZ(v, d.yaw ?? 0), d.pos));
  return makeBrush(hullPlanes(pts), d.color ?? (d.type === 'ramp' ? 0x4f86c6 : 0x8a8f98));
}

export const inside = (o: Vec, b: Box & { also?: Box[] }): boolean => o.every((x, i) => x >= b.min[i] && x <= b.max[i]) || !!b.also?.some(a => inside(o, a));
const overlaps = (p: Player, b: Box & { solids?: Brush[] }) => {
  const hi = hullMax(p);
  return p.origin.every((x, i) => x + HULL_MIN[i] <= b.max[i] && x + hi[i] >= b.min[i])
    && (!b.solids || trace(b.solids, p.origin, p.origin, HULL_MIN, hi).startsolid);
};

export type RunState = 'idle' | 'ready' | 'running' | 'done';
export interface Timer { state: RunState; time: number; splits: (number | undefined)[]; practice: boolean }
export type GameEvent =
  | { type: 'start' } | { type: 'fail' } | { type: 'msg'; text: string }
  | { type: 'split'; index: number; time: number; practice: boolean }
  | { type: 'finish'; time: number; splits: (number | undefined)[]; practice: boolean }
  | { type: 'stage'; index: number; time: number; practice: boolean };

const freshTimer = (state: RunState = 'idle'): Timer => ({ state, time: 0, splits: [], practice: false });
interface Saved { origin: Vec; vel: Vec; yaw: number; pitch: number; ducked: boolean }
export interface Snapshot { p: Player; run: Timer; stage: Timer & { index: number }; section: number; trail: boolean; name: string; inPush: boolean[] }

export class Session {
  world: World;
  p: Player;
  prev: { origin: Vec; view: number };
  run = freshTimer();
  stage = { index: 0, ...freshTimer() };
  section = 0; // linear maps: index of last checkpoint reached (0 = none); staged maps: stage index
  saved: Saved | null = null;
  assisted = false; // autopilot driving: runs count as practice
  trail = false; // the map's sprite trail is attached (it stays on through teleports, like a parented entity)
  name = ''; // the player's targetname: maps tag you on secret paths, and filtered triggers only fire for the right tag
  private passes = (f?: Filter) => !f || (this.name === f.name) !== f.negate;
  events: GameEvent[] = [];
  private inPush: boolean[] = [];
  private splitZones: (Box & { also?: Box[] })[];
  readonly start?: Box;
  readonly end?: Box;

  s: Settings;
  constructor(public def: MapDef, s: Settings) {
    this.s = def.settings && Object.keys(def.settings).length ? Object.assign(Object.create(s) as Settings, def.settings) : s; // (the rest still follows s)
    this.world = def.world ?? buildWorld(def);
    const solid = <T extends { shape?: Shape }>(v: T) => (v.shape ? { ...v, solids: v.shape.map(pl => makeBrush(pl.map(([x, y, z, w]) => ({ n: [x, y, z], d: w })))) } : v);
    this.def = def = { ...def, fails: def.fails?.map(solid), pushes: def.pushes?.map(solid), namers: def.namers?.map(solid) };
    this.start = def.start ?? def.stages?.[0].start;
    this.end = def.end ?? def.stages?.at(-1)!.end;
    this.splitZones = def.checkpoints ?? def.stages?.slice(1).map(s => s.start) ?? [];
    this.p = newPlayer([...def.spawn.pos], def.spawn.yaw, def.spawn.pitch ?? 0);
    this.prev = { origin: this.p.origin, view: this.p.viewOffset };
    this.restart();
  }

  get c() { return ctx(this.p, this.world, this.s); }
  /** Would this player state touch a kill volume (not a transition teleport)? For the autopilot's look-ahead. */
  hazard = (p: Player) => !!this.def.fails?.some(f => !f.quiet && overlaps(p, f));
  get sections() { return this.def.stages?.length ?? (this.def.checkpoints?.length ?? 0) + 1; }

  restart() {
    const sp = this.def.spawn;
    Object.assign(this.p, newPlayer([...sp.pos], sp.yaw, sp.pitch ?? 0)); // a fresh player (tick counter too): runs replay exactly
    this.respawn(sp);
    this.section = 0;
    this.run = freshTimer();
    this.stage = { index: 0, ...freshTimer() };
    this.triggers();
  }

  respawn(sp: Spawn, keep = false) {
    if (!keep) this.p.ducked = false;
    this.p.baseVel = [0, 0, 0];
    teleport(this.c, [...sp.pos], sp.yaw, sp.pitch ?? 0, keep ? this.p.vel : undefined);
    this.inPush = [];
    this.snap();
  }

  snap() { this.prev = { origin: this.p.origin, view: this.p.viewOffset }; }

  /** The whole state a replay starts from (a recorded run, a planner's node). */
  snapshot(): Snapshot { return structuredClone({ p: this.p, run: this.run, stage: this.stage, section: this.section, trail: this.trail, name: this.name, inPush: this.inPush }); }
  restore(s: Snapshot) { Object.assign(this, structuredClone(s)); this.events.length = 0; this.snap(); }

  currentSpawn(): Spawn {
    if (this.def.stages) return this.def.stages[this.stage.index].spawn;
    return (this.section > 0 && this.def.checkpoints?.[this.section - 1].spawn) || this.def.spawn;
  }

  step(cmd: Cmd) {
    this.prev = { origin: this.p.origin, view: this.p.viewOffset };
    playerMove(this.c, cmd);
    if (!this.p.noclip) this.triggers();
  }

  invalidate() { this.run.practice = true; this.stage.practice = true; }

  saveCheckpoint() {
    const p = this.p;
    this.saved = { origin: p.origin, vel: p.vel, yaw: p.yaw, pitch: p.pitch, ducked: p.ducked };
    this.events.push({ type: 'msg', text: 'Checkpoint saved' });
  }

  loadCheckpoint() {
    if (!this.saved) return this.events.push({ type: 'msg', text: 'No checkpoint saved (C)' });
    Object.assign(this.p, { ...this.saved, noclip: false });
    categorizePosition(this.c);
    this.inPush = [];
    this.snap();
    if (this.run.state === 'running' || this.stage.state === 'running') this.events.push({ type: 'msg', text: 'Practice: timer invalidated' });
    this.invalidate();
  }

  toggleNoclip() {
    const p = this.p;
    if (!p.noclip) { p.noclip = true; this.invalidate(); return this.events.push({ type: 'msg', text: 'Noclip on (timer invalidated)' }); }
    p.ducked = false;
    if (trace(this.world, p.origin, p.origin, HULL_MIN, HULL_STAND).startsolid) return this.events.push({ type: 'msg', text: 'Inside a brush, move out first' });
    p.noclip = false;
    p.vel = [0, 0, 0];
    categorizePosition(this.c);
    this.events.push({ type: 'msg', text: 'Noclip off' });
  }

  private triggers() {
    const { def, p } = this, dt = this.c.dt;
    for (const n of def.namers ?? []) if (this.passes(n.filter) && overlaps(p, n)) this.name = n.name;
    for (const f of def.fails ?? []) {
      if (this.passes(f.filter) && overlaps(p, f)) { this.respawn(f.to ?? this.currentSpawn(), f.keep); if (!f.quiet) this.events.push({ type: 'fail' }); break; }
    }
    let base: Vec | null = null; // Source trigger_push: base velocity while touching, momentum kept on exit
    (def.pushes ?? []).forEach((b, i) => {
      const now = overlaps(p, b);
      if (b.once || b.set) { if (now && !this.inPush[i]) { p.vel = b.set ? [...b.vel] : add(p.vel, b.vel); p.onGround = false; } }
      else if (now) {
        base = add(base ?? [0, 0, 0], b.vel);
        if (b.vel[2] > 0 && p.onGround) { p.onGround = false; p.origin = add(p.origin, [0, 0, 1]); }
      }
      this.inPush[i] = now;
    });
    if (def.trail && !this.trail && overlaps(p, def.trail.zone)) { this.trail = true; this.events.push({ type: 'msg', text: 'Rainbow trail unlocked' }); }
    if (base) p.baseVel = base;
    else if (p.baseVel.some(v => v)) { p.vel = add(p.vel, scale(p.baseVel, 1 + dt / 2)); p.baseVel = [0, 0, 0]; }
    const o = p.origin;

    if (def.stages) {
      const run = this.stage; // a stage's end first: one can end where the next starts (arriving through its exit teleport)
      if (run.state === 'running') {
        run.time += dt;
        if (inside(o, def.stages[run.index].end)) { run.state = 'done'; this.events.push({ type: 'stage', index: run.index, time: run.time, practice: run.practice }); }
      }
      def.stages.forEach((st, i) => { if (inside(o, st.start)) { this.stage = { index: i, ...freshTimer('ready') }; this.section = i; } });
      const st = def.stages[this.stage.index], t = this.stage;
      if (t.state === 'ready' && !inside(o, st.start)) { t.state = 'running'; t.practice ||= this.assisted; }
    } else {
      def.checkpoints?.forEach((cp, i) => { if (inside(o, cp)) this.section = i + 1; });
    }

    const r = this.run;
    if (this.start && inside(o, this.start)) {
      this.run = freshTimer('ready');
      if (!def.stages) this.section = 0;
    } else if (r.state === 'ready') {
      r.state = 'running';
      r.practice ||= this.assisted;
      this.events.push({ type: 'start' });
    } else if (r.state === 'running') {
      r.time += dt;
      this.splitZones.forEach((z, i) => {
        if (r.splits[i] === undefined && inside(o, z)) { r.splits[i] = r.time; this.events.push({ type: 'split', index: i, time: r.time, practice: r.practice }); }
      });
      if (this.end && inside(o, this.end)) { r.state = 'done'; this.events.push({ type: 'finish', time: r.time, splits: [...r.splits], practice: r.practice }); }
    }
  }
}

/** Turn guide points ([x, y, zHint, h?]) into a riding line: at each point, scan across the track for the surf face
 *  under it and take the spot `h` of the way from its bottom edge to its top (default 0.62); h < 0 keeps the point
 *  as is (an in-air waypoint). Robust on curved drops and arcs, where a fixed lateral offset is not a fixed height. */
type Run = { s: number; z: number }[];
const faceRuns = new WeakMap<Brush[], Map<string, Run | null>>(); // the scan doesn't depend on h: tuning reuses it
export function ridingLine(world: Brush[], guide: number[][], hDefault = 0.62): Vec[] {
  if (!faceRuns.has(world)) faceRuns.set(world, new Map());
  const cache = faceRuns.get(world)!;
  return guide.map((g, i) => {
    const [x, y, z, h = hDefault] = g;
    if (h < 0) return [x, y, z];
    const a = guide[Math.max(0, i - 1)], b = guide[Math.min(guide.length - 1, i + 1)];
    let tx = b[0] - a[0], ty = b[1] - a[1];
    const tl = Math.hypot(tx, ty) || 1; tx /= tl; ty /= tl;
    const key = `${x},${y},${z},${tx.toFixed(5)},${ty.toFixed(5)}`;
    if (!cache.has(key)) {
      const samples: { s: number; z: number; surf: boolean }[] = [];
      for (let s = -640; s <= 640; s += 16) {
        const px = x - ty * s, py = y + tx * s, tr = trace(world, [px, py, z + 400], [px, py, z - 1200], HULL_MIN, HULL_STAND), n = tr.normal;
        samples.push({ s, z: tr.end[2], surf: tr.fraction < 1 && n[2] > 0.05 && n[2] < 0.7 && Math.abs(n[0] * -ty + n[1] * tx) > 0.4 * Math.hypot(n[0], n[1]) });
      }
      // the run of surf samples nearest the guide point is "the face"
      let found: Run | null = null, bd = 1e9;
      for (let k = 0; k < samples.length;) {
        if (!samples[k].surf) { k++; continue; }
        const run: Run = [];
        while (k < samples.length && samples[k].surf) run.push(samples[k++]);
        const dist = Math.min(...run.map(r => Math.abs(r.s)));
        if (dist < bd) { bd = dist; found = run; }
      }
      cache.set(key, found && found.length >= 3 ? found : null);
    }
    const best = cache.get(key);
    if (!best) return [x, y, z];
    const lo = best[0].z < best.at(-1)!.z ? best[0] : best.at(-1)!, hi = lo === best[0] ? best.at(-1)! : best[0];
    const s = lo.s + (hi.s - lo.s) * h, r = best.reduce((m, q) => (Math.abs(q.s - s) < Math.abs(m.s - s) ? q : m));
    return [x - ty * r.s, y + tx * r.s, r.z + 2];
  });
}

/** Autopilot line: stations of guide points (s: stage or section), each with a riding height ramping h0 -> h1 (0 = a face's
 *  bottom edge, 1 = its top; -1 = keep the point as an in-air waypoint). A station followed by a launch (an in-air
 *  waypoint above: the autopilot climbs the face and pops off its top) ends `cut` units early, where the climb starts. */
export type Station = { s: number; g: Vec[]; h: [number, number]; cut?: number; tune?: boolean; aim?: number; dive?: number[] };
/** Guide points: key points densified every ~350 units (the last key included). */
export const line = (...keys: Vec[]): Vec[] => keys.slice(1).flatMap((b, i) => {
  const a = keys[i], n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 350));
  return [...Array(n + (i === keys.length - 2 ? 1 : 0)).keys()].map(j => a.map((v, k) => v + ((b[k] - v) * j) / n) as Vec);
});
export const trim = (g: Vec[], cut: number): Vec[] => { // drop the last `cut` units of a polyline
  const out = [...g];
  for (let left = cut; left > 0 && out.length > 1; ) {
    const b = out.at(-1)!, a = out.at(-2)!, l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l > left) { out[out.length - 1] = b.map((v, k) => v + ((a[k] - v) * left) / l) as Vec; break; }
    out.pop(); left -= l;
  }
  return out;
};
export const routeOf = (st: Station[]) => st.flatMap(({ g, h, cut = 0 }) => trim(g, cut).map((p, i, all) => [...p, h[0] + ((h[1] - h[0]) * i) / Math.max(1, all.length - 1)]));
/** Route flags for the autopilot: 1 on the point a launch must hit (`aim`; the launch is planned by look-ahead), 2 on
 *  points to dive to (`dive`: brake in the air when the fall would pass above them). */
export const flagsOf = (st: Station[]) => st.flatMap(({ g, cut = 0, aim, dive = [] }) => trim(g, cut).map((_, i) => (i === aim ? 1 : 0) | (dive.includes(i) ? 2 : 0)));
