// Port of Source (CS:S / CS:GO) CGameMovement. World units are Source units, Z is up.
// Collision: convex brushes traced as an expanded point (Q3 / Source CM_ClipBoxToBrush style).
import { atan2, cos, sin, hypot2, hypot3 } from './fmath';

export type Vec = [number, number, number];
export const DEG = Math.PI / 180;
export const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec, s: number): Vec => [a[0] * s, a[1] * s, a[2] * s];
export const ma = (a: Vec, s: number, b: Vec): Vec => [a[0] + s * b[0], a[1] + s * b[1], a[2] + s * b[2]];
export const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a: Vec) => hypot3(a[0], a[1], a[2]);
export const hlen = (a: Vec) => hypot2(a[0], a[1]);
export const norm = (a: Vec): Vec => { const l = len(a); return l > 0 ? scale(a, 1 / l) : [0, 0, 0]; };

// ---------------------------------------------------------------- brushes

export interface Plane { n: Vec; d: number } // solid where n·x <= d
export interface Face { n: Vec; verts: Vec[]; color: number | null } // null: not drawn
export interface Brush { planes: Plane[]; faces: Face[]; min: Vec; max: Vec; color: number; stamp?: number; glass?: boolean; nonsolid?: boolean }

const AXES: Vec[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const ON = 1e-3;

/** Outward planes of the convex hull of a small point set. */
export function hullPlanes(pts: Vec[]): Plane[] {
  const out: Plane[] = [];
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) for (let k = j + 1; k < pts.length; k++) {
    let n = cross(sub(pts[j], pts[i]), sub(pts[k], pts[i]));
    if (len(n) < 1e-6) continue;
    n = norm(n);
    let d = dot(n, pts[i]), pos = 0, neg = 0;
    for (const q of pts) { const s = dot(n, q) - d; if (s > 1e-4) pos++; else if (s < -1e-4) neg++; }
    if (pos && neg) continue;
    if (pos) { n = scale(n, -1); d = -d; }
    if (!out.some(p => dot(p.n, n) > 1 - 1e-9)) out.push({ n, d });
  }
  return out;
}

/** Builds render faces, bounds and collision planes (faces + axial and edge bevels, as vbsp does). */
export function makeBrush(input: Plane[], color = 0x808080, faceColors?: (number | null)[]): Brush {
  const P = input.map(p => { const l = len(p.n); return { n: scale(p.n, 1 / l), d: p.d / l }; });
  const verts: Vec[] = [];
  for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) for (let k = j + 1; k < P.length; k++) {
    const a = P[i], b = P[j], c = P[k], bc = cross(b.n, c.n), den = dot(a.n, bc);
    if (Math.abs(den) < 1e-9) continue;
    const v = scale(add(add(scale(bc, a.d), scale(cross(c.n, a.n), b.d)), scale(cross(a.n, b.n), c.d)), 1 / den);
    if (P.some(q => dot(q.n, v) > q.d + ON)) continue;
    if (!verts.some(u => len(sub(u, v)) < ON)) verts.push(v);
  }
  const on = (p: Plane, v: Vec) => Math.abs(dot(p.n, v) - p.d) < ON;
  const faces: Face[] = [], planes: Plane[] = [];
  for (const [pi, p] of P.entries()) {
    const vs = verts.filter(v => on(p, v));
    if (vs.length < 3 || planes.some(q => dot(q.n, p.n) > 1 - 1e-9)) continue;
    const c = scale(vs.reduce(add), 1 / vs.length), u = norm(sub(vs[0], c)), w = cross(p.n, u);
    const ang = (v: Vec) => atan2(dot(sub(v, c), w), dot(sub(v, c), u));
    vs.sort((a, b) => ang(a) - ang(b));
    faces.push({ n: p.n, verts: vs, color: faceColors ? faceColors[pi] : color });
    planes.push(p);
  }
  const bevel = (n: Vec, at?: Vec) => {
    if (len(n) < 1e-6) return;
    n = norm(n);
    if (planes.some(p => dot(p.n, n) > 1 - 1e-6)) return;
    const d = Math.max(...verts.map(v => dot(n, v)));
    if (at && Math.abs(dot(n, at) - d) > ON) return; // must touch the brush along the edge it came from
    planes.push({ n, d });
  };
  for (const a of AXES) { bevel(a); bevel(scale(a, -1)); }
  for (let i = 0; i < faces.length; i++) for (let j = i + 1; j < faces.length; j++) {
    const shared = faces[i].verts.filter(v => on(planes[j], v));
    if (shared.length < 2) continue;
    const e = cross(faces[i].n, faces[j].n);
    for (const a of AXES) { const c = cross(e, a); bevel(c, shared[0]); bevel(scale(c, -1), shared[0]); }
  }
  const min = [0, 1, 2].map(i => Math.min(...verts.map(v => v[i]))) as Vec;
  const max = [0, 1, 2].map(i => Math.max(...verts.map(v => v[i]))) as Vec;
  return { planes, faces, min, max, color };
}

// ---------------------------------------------------------------- tracing

export const DIST_EPSILON = 0.03125;
// Float noise guard: a move that approaches a plane by less than this is sliding along it. Without it,
// sliding exactly DIST_EPSILON off a ramp face can register fraction-0 hits (the classic "rampbug").
const PARALLEL = 1e-6;

export interface Trace { fraction: number; end: Vec; normal: Vec; startsolid: boolean; allsolid: boolean }

// Broadphase: brushes bucketed into a uniform 3D grid (built lazily per world array); huge ones are always tested.
const CELL = 512;
interface Grid { cells: Map<number, Brush[]>; big: Brush[] }
const grids = new WeakMap<Brush[], Grid>();
const cellKey = (x: number, y: number, z: number) => ((x + 512) * 1024 + (y + 512)) * 1024 + (z + 512);
function gridOf(world: Brush[]): Grid {
  let g = grids.get(world);
  if (g) return g;
  g = { cells: new Map(), big: [] };
  for (const b of world) {
    if (b.nonsolid) continue; // drawn only
    const lo = b.min.map(v => Math.floor(v / CELL)), hi = b.max.map(v => Math.floor(v / CELL));
    if ((hi[0] - lo[0] + 1) * (hi[1] - lo[1] + 1) * (hi[2] - lo[2] + 1) > 2048) { g.big.push(b); continue; }
    for (let x = lo[0]; x <= hi[0]; x++) for (let y = lo[1]; y <= hi[1]; y++) for (let z = lo[2]; z <= hi[2]; z++) {
      const k = cellKey(x, y, z), c = g.cells.get(k);
      if (c) c.push(b); else g.cells.set(k, [b]);
    }
  }
  grids.set(world, g);
  return g;
}
let traceStamp = 0;

export function trace(world: Brush[], start: Vec, end: Vec, mins: Vec, maxs: Vec): Trace {
  const tr: Trace = { fraction: 1, end, normal: [0, 0, 0], startsolid: false, allsolid: false };
  const lo = [0, 1, 2].map(i => Math.min(start[i], end[i]) + mins[i] - 1);
  const hi = [0, 1, 2].map(i => Math.max(start[i], end[i]) + maxs[i] + 1);
  const g = gridOf(world), stamp = ++traceStamp;
  const test = (b: Brush) => {
    if (b.stamp === stamp || b.nonsolid) return;
    b.stamp = stamp;
    if (b.min[0] > hi[0] || b.max[0] < lo[0] || b.min[1] > hi[1] || b.max[1] < lo[1] || b.min[2] > hi[2] || b.max[2] < lo[2]) return;
    clipBoxToBrush(tr, b, start, end, mins, maxs);
  };
  for (const b of g.big) test(b);
  const c0 = lo.map(v => Math.floor(v / CELL)), c1 = hi.map(v => Math.floor(v / CELL));
  if ((c1[0] - c0[0] + 1) * (c1[1] - c0[1] + 1) * (c1[2] - c0[2] + 1) > 4096) for (const b of world) test(b); // very long sweep
  else for (let x = c0[0]; x <= c1[0]; x++) for (let y = c0[1]; y <= c1[1]; y++) for (let z = c0[2]; z <= c1[2]; z++) for (const b of g.cells.get(cellKey(x, y, z)) ?? []) test(b);
  if (tr.allsolid) tr.fraction = 0;
  if (tr.fraction < 1) tr.end = ma(start, tr.fraction, sub(end, start));
  return tr;
}

function clipBoxToBrush(tr: Trace, b: Brush, p1: Vec, p2: Vec, mins: Vec, maxs: Vec) {
  let enter = -1, leave = 1, clip: Plane | null = null, startout = false, getout = false;
  for (const pl of b.planes) {
    const n = pl.n;
    // push the plane out by the box's support distance
    const dist = pl.d - ((n[0] < 0 ? maxs[0] : mins[0]) * n[0] + (n[1] < 0 ? maxs[1] : mins[1]) * n[1] + (n[2] < 0 ? maxs[2] : mins[2]) * n[2]);
    const d1 = dot(p1, n) - dist, d2 = dot(p2, n) - dist;
    if (d2 > 0) getout = true;
    if (d1 > 0) startout = true;
    // completely in front of this face: no intersection with the whole brush
    if (d1 > 0 && (d2 >= DIST_EPSILON || d2 >= d1 || (d2 > 0 && d1 - d2 < PARALLEL))) return;
    if (d1 <= 0 && d2 <= 0) continue;
    if (d1 > d2) { const f = (d1 - DIST_EPSILON) / (d1 - d2); if (f > enter) { enter = f; clip = pl; } }
    else { const f = (d1 + DIST_EPSILON) / (d1 - d2); if (f < leave) leave = f; }
  }
  if (!startout) { tr.startsolid = true; if (!getout) { tr.allsolid = true; tr.fraction = 0; } return; }
  if (enter < leave && enter > -1 && enter < tr.fraction) { tr.fraction = Math.max(enter, 0); tr.normal = clip!.n; }
}

// ---------------------------------------------------------------- movement

export const HULL_MIN: Vec = [-16, -16, 0];
export const HULL_STAND: Vec = [16, 16, 72];
export const HULL_DUCK: Vec = [16, 16, 54];
export const VIEW_STAND = 64, VIEW_DUCK = 46, STEP_SIZE = 18;
const DUCK_DELTA = HULL_STAND[2] - HULL_DUCK[2];
const NON_JUMP_VELOCITY = 140, MAX_CLIP_PLANES = 5, MOVE_SPEED = 450, DUCK_SPEED = 0.34, NOCLIP_SPEED = 1250;

export interface Settings {
  tickrate: number; gravity: number; airaccelerate: number; airMaxWishspeed: number; accelerate: number;
  friction: number; stopspeed: number; maxspeed: number; maxvelocity: number; jumpImpulse: number;
  bhopLimiter: boolean; autobhop: boolean; rampfix: boolean; sensitivity: number; fov: number;
  trail: boolean; // cosmetic: always show the rainbow trail (otherwise only where a map hands one out)
}
export const DEFAULTS: Settings = {
  tickrate: 128, gravity: 800, airaccelerate: 150, airMaxWishspeed: 30, accelerate: 5.5, friction: 5.2,
  stopspeed: 80, maxspeed: 250, maxvelocity: 3500, jumpImpulse: Math.sqrt(2 * 800 * 57),
  bhopLimiter: false, autobhop: true, rampfix: true, sensitivity: 2, fov: 90, trail: false, // surf-server setup: sv_enablebunnyhopping 1, sv_autobunnyhopping 1, a rampbug fix
};

/** fwd/side/up are key axes in [-1, 1]; the move code scales them like cl_forwardspeed. */
export interface Cmd { fwd: number; side: number; up: number; jump: boolean; duck: boolean; fast?: boolean }
export const NO_CMD: Cmd = { fwd: 0, side: 0, up: 0, jump: false, duck: false };

export interface Player {
  origin: Vec; vel: Vec; yaw: number; pitch: number; // degrees, Source convention (pitch > 0 looks down)
  onGround: boolean; ducked: boolean; oldJump: boolean; noclip: boolean;
  viewOffset: number; surfaceFriction: number;
  baseVel: Vec; // trigger_push base velocity (moves you while inside, becomes real velocity when you leave)
  tick: number; wishdir: Vec; lastNormal: Vec; touchTick: number; // debug / bot
}

export const newPlayer = (origin: Vec, yaw = 0, pitch = 0): Player => ({
  origin, vel: [0, 0, 0], yaw, pitch, onGround: false, ducked: false, oldJump: false, noclip: false,
  viewOffset: VIEW_STAND, surfaceFriction: 1, baseVel: [0, 0, 0], tick: 0, wishdir: [0, 0, 0], lastNormal: [0, 0, 0], touchTick: -1,
});

export interface Ctx { p: Player; w: Brush[]; s: Settings; dt: number }
export const ctx = (p: Player, w: Brush[], s: Settings): Ctx => ({ p, w, s, dt: 1 / s.tickrate });
export const hullMax = (p: Player) => (p.ducked ? HULL_DUCK : HULL_STAND);
const traceP = (c: Ctx, a: Vec, b: Vec) => trace(c.w, a, b, HULL_MIN, hullMax(c.p));

export function viewVectors(yaw: number, pitch: number): { forward: Vec; right: Vec } {
  const y = yaw * DEG, p = pitch * DEG;
  return { forward: [cos(p) * cos(y), cos(p) * sin(y), -sin(p)], right: [sin(y), -cos(y), 0] };
}

export function clipVelocity(v: Vec, n: Vec, overbounce = 1): Vec {
  const backoff = dot(v, n) * overbounce;
  const out = v.map((x, i) => { const o = x - n[i] * backoff; return Math.abs(o) < 0.1 ? 0 : o; }) as Vec;
  const adjust = dot(out, n); // iterate once to make sure we aren't still moving through the plane
  return adjust < 0 ? ma(out, -adjust, n) : out;
}

export function accelerate(c: Ctx, wishdir: Vec, wishspeed: number, accel: number) {
  const addspeed = wishspeed - dot(c.p.vel, wishdir);
  if (addspeed <= 0) return;
  const accelspeed = Math.min(accel * c.dt * wishspeed * c.p.surfaceFriction, addspeed);
  c.p.vel = ma(c.p.vel, accelspeed, wishdir);
}

export function airAccelerate(c: Ctx, wishdir: Vec, wishspeed: number, accel: number) {
  const wishspd = Math.min(wishspeed, c.s.airMaxWishspeed);
  const addspeed = wishspd - dot(c.p.vel, wishdir);
  if (addspeed <= 0) return;
  // NB: uses the uncapped wishspeed; only the projection target is capped
  const accelspeed = Math.min(accel * wishspeed * c.dt * c.p.surfaceFriction, addspeed);
  c.p.vel = ma(c.p.vel, accelspeed, wishdir);
}

export function friction(c: Ctx) {
  const speed = len(c.p.vel);
  if (speed < 0.1) return;
  let drop = 0;
  if (c.p.onGround) drop = Math.max(speed, c.s.stopspeed) * c.s.friction * c.p.surfaceFriction * c.dt;
  const ns = Math.max(speed - drop, 0);
  if (ns !== speed) c.p.vel = scale(c.p.vel, ns / speed);
}

function checkVelocity(c: Ctx) {
  const m = c.s.maxvelocity;
  c.p.vel = c.p.vel.map(x => (Number.isFinite(x) ? Math.max(-m, Math.min(m, x)) : 0)) as Vec;
}

const halfGravity = (c: Ctx) => { c.p.vel = [c.p.vel[0], c.p.vel[1], c.p.vel[2] - c.s.gravity * 0.5 * c.dt]; };
function startGravity(c: Ctx) { // vertical base velocity is folded in as an acceleration, then dropped
  const p = c.p;
  p.vel = [p.vel[0], p.vel[1], p.vel[2] - c.s.gravity * 0.5 * c.dt + p.baseVel[2] * c.dt];
  p.baseVel = [p.baseVel[0], p.baseVel[1], 0];
}
// AirMove / WalkMove add the base velocity for the move itself and take it back out afterwards
const withBase = (c: Ctx, move: () => void) => { c.p.vel = add(c.p.vel, c.p.baseVel); move(); c.p.vel = sub(c.p.vel, c.p.baseVel); };
const zeroZ = (v: Vec): Vec => [v[0], v[1], 0];

/** Rampbug fix (what surf servers patch in). Float rounding leaves a box a hair inside the surface it slides along:
 *  either a swept move gets through but its end, re-tested, is stuck, or the next move starts all-solid; Source stops
 *  the player dead either way. Instead, nudge the box back out along that surface (then straight up): a free spot
 *  within 2 units keeps the move and the speed. */
function unstick(c: Ctx, pos: Vec): Vec | null {
  const n = c.p.lastNormal;
  for (const d of (len(n) > 0 ? [n, [0, 0, 1]] : [[0, 0, 1]]) as Vec[]) for (const k of [DIST_EPSILON, 0.125, 0.5, 2]) {
    const q = ma(pos, k, d);
    if (!traceP(c, q, q).startsolid) return q;
  }
  return null;
}

export function tryPlayerMove(c: Ctx) {
  const p = c.p;
  const planes: Vec[] = [];
  let original = p.vel, primal = p.vel, allFraction = 0, timeLeft = c.dt;
  for (let bump = 0; bump < 4; bump++) {
    if (len(p.vel) === 0) break;
    const tr = traceP(c, p.origin, ma(p.origin, timeLeft, p.vel));
    allFraction += tr.fraction;
    if (tr.allsolid) { // trapped in a solid: with the fix, a hair inside the surface just hit gets nudged back out
      const q = c.s.rampfix ? unstick(c, p.origin) : null;
      if (!q) { p.vel = [0, 0, 0]; return; }
      p.origin = q; continue;
    }
    if (tr.fraction > 0) {
      if (tr.fraction === 1) {
        const stuck = traceP(c, tr.end, tr.end), q = (stuck.startsolid || stuck.fraction !== 1) && (c.s.rampfix ? unstick(c, tr.end) : null);
        if (q === null) { p.vel = [0, 0, 0]; break; } // stuck at the end: Source stops dead (the classic rampbug)
        if (q) tr.end = q;
      }
      p.origin = tr.end;
      original = p.vel;
      planes.length = 0;
    }
    if (tr.fraction === 1) break;
    p.lastNormal = tr.normal;
    p.touchTick = p.tick;
    timeLeft -= timeLeft * tr.fraction;
    if (planes.length >= MAX_CLIP_PLANES) { p.vel = [0, 0, 0]; break; }
    planes.push(tr.normal);
    if (planes.length === 1 && !p.onGround) {
      // first impact while airborne: plain clip (overbounce = 1 + sv_bounce * (1 - surfaceFriction) = 1)
      p.vel = original = clipVelocity(original, planes[0], 1);
    } else {
      let i = 0;
      for (; i < planes.length; i++) {
        p.vel = clipVelocity(original, planes[i], 1);
        let j = 0;
        for (; j < planes.length; j++) if (j !== i && dot(p.vel, planes[j]) < 0) break;
        if (j === planes.length) break;
      }
      if (i === planes.length) { // go along the crease
        if (planes.length !== 2) { p.vel = [0, 0, 0]; break; }
        const dir = norm(cross(planes[0], planes[1]));
        p.vel = scale(dir, dot(dir, p.vel));
      }
      // if velocity is against the original velocity, stop dead to avoid tiny oscillations in sloping corners
      if (dot(p.vel, primal) <= 0) { p.vel = [0, 0, 0]; break; }
    }
  }
  if (allFraction === 0) p.vel = [0, 0, 0];
}

function stayOnGround(c: Ctx) {
  const p = c.p;
  const up = traceP(c, p.origin, add(p.origin, [0, 0, 2]));
  const tr = traceP(c, up.end, sub(p.origin, [0, 0, STEP_SIZE]));
  if (tr.fraction > 0 && tr.fraction < 1 && !tr.startsolid && tr.normal[2] >= 0.7 && Math.abs(p.origin[2] - tr.end[2]) > 0.5 / 32) p.origin = tr.end;
}

function stepMove(c: Ctx) {
  const p = c.p, pos = p.origin, vel = p.vel;
  tryPlayerMove(c); // slide move down
  const downPos = p.origin, downVel = p.vel;
  p.origin = pos; p.vel = vel;
  let tr = traceP(c, p.origin, add(p.origin, [0, 0, STEP_SIZE + DIST_EPSILON])); // move up a stair height
  if (!tr.startsolid && !tr.allsolid) p.origin = tr.end;
  tryPlayerMove(c); // slide move up
  tr = traceP(c, p.origin, sub(p.origin, [0, 0, STEP_SIZE + DIST_EPSILON])); // move down a stair
  if (tr.normal[2] < 0.7) { p.origin = downPos; p.vel = downVel; return; } // not on ground any more: use the original move
  if (!tr.startsolid && !tr.allsolid) p.origin = tr.end;
  const dd = (downPos[0] - pos[0]) ** 2 + (downPos[1] - pos[1]) ** 2;
  const ud = (p.origin[0] - pos[0]) ** 2 + (p.origin[1] - pos[1]) ** 2;
  if (dd > ud) { p.origin = downPos; p.vel = downVel; } else p.vel = [p.vel[0], p.vel[1], downVel[2]];
}

function walkMove(c: Ctx, wishdir: Vec, wishspeed: number) {
  const p = c.p;
  p.vel = zeroZ(p.vel);
  accelerate(c, wishdir, wishspeed, c.s.accelerate);
  p.vel = zeroZ(p.vel);
  p.vel = add(p.vel, p.baseVel);
  if (len(p.vel) < 1) { p.vel = sub([0, 0, 0], p.baseVel); return; }
  const dest: Vec = [p.origin[0] + p.vel[0] * c.dt, p.origin[1] + p.vel[1] * c.dt, p.origin[2]];
  const tr = traceP(c, p.origin, dest);
  if (tr.fraction === 1) p.origin = tr.end;
  else stepMove(c);
  p.vel = sub(p.vel, p.baseVel);
  stayOnGround(c);
}

function airMove(c: Ctx, wishdir: Vec, wishspeed: number) {
  airAccelerate(c, wishdir, wishspeed, c.s.airaccelerate);
  withBase(c, () => tryPlayerMove(c));
}

function setGround(c: Ctx, tr: Trace | null) {
  c.p.onGround = !!tr;
  if (tr) c.p.vel = zeroZ(c.p.vel);
}

const touchesGround = (c: Ctx, mins: Vec, maxs: Vec) => {
  const tr = trace(c.w, c.p.origin, sub(c.p.origin, [0, 0, 2]), mins, maxs);
  return (tr.fraction < 1 || tr.startsolid) && tr.normal[2] >= 0.7 ? tr : null;
};

export function categorizePosition(c: Ctx) {
  const p = c.p;
  p.surfaceFriction = 1;
  if (p.vel[2] > NON_JUMP_VELOCITY) return setGround(c, null); // shooting up really fast: definitely not on ground
  const lo = HULL_MIN, hi = hullMax(p);
  let tr = touchesGround(c, lo, hi);
  // TryTouchGroundInQuadrants: a sub-box may find a shallower plane we can stand on
  if (!tr) for (const [mx, my, Mx, My] of [[lo[0], lo[1], 0, 0], [0, 0, hi[0], hi[1]], [lo[0], 0, 0, hi[1]], [0, lo[1], hi[0], 0]]) {
    if ((tr = touchesGround(c, [mx, my, lo[2]], [Mx, My, hi[2]]))) break;
  }
  setGround(c, tr);
}

function checkJumpButton(c: Ctx) {
  const { p, s } = c;
  if (!p.onGround) return; // in air: no effect (oldJump stays held)
  if (p.oldJump && !s.autobhop) return; // don't pogo stick
  if (s.bhopLimiter) { // PreventBunnyJumping
    const max = 1.1 * s.maxspeed, h = hlen(p.vel);
    if (h > max) p.vel = [p.vel[0] * max / h, p.vel[1] * max / h, p.vel[2]];
  }
  p.onGround = false;
  p.vel = [p.vel[0], p.vel[1], p.ducked ? s.jumpImpulse : p.vel[2] + s.jumpImpulse];
  halfGravity(c); // FinishGravity inside CheckJumpButton, as in Source
}

function duck(c: Ctx, cmd: Cmd) {
  const p = c.p;
  let snap = false;
  if (cmd.duck && !p.ducked) {
    p.ducked = true;
    if (!p.onGround) { p.origin = add(p.origin, [0, 0, DUCK_DELTA]); snap = true; } // in air: pull the feet up
    categorizePosition(c);
  } else if (!cmd.duck && p.ducked) {
    const o = p.onGround ? p.origin : sub(p.origin, [0, 0, DUCK_DELTA]);
    const tr = trace(c.w, o, o, HULL_MIN, HULL_STAND);
    if (!tr.startsolid) { p.ducked = false; p.origin = o; snap = !p.onGround; categorizePosition(c); }
  }
  const target = p.ducked ? VIEW_DUCK : VIEW_STAND, rate = DUCK_DELTA / 0.2 * c.dt;
  p.viewOffset = snap ? target : p.viewOffset + Math.max(-rate, Math.min(rate, target - p.viewOffset));
}

function noclipMove(c: Ctx, cmd: Cmd) {
  const p = c.p, { forward, right } = viewVectors(p.yaw, p.pitch);
  const wish = add(add(scale(forward, cmd.fwd), scale(right, cmd.side)), [0, 0, cmd.up]);
  p.vel = scale(norm(wish), NOCLIP_SPEED * (cmd.fast ? 4 : 1));
  p.origin = ma(p.origin, c.dt, p.vel);
  p.onGround = false;
}

export function teleport(c: Ctx, origin: Vec, yaw: number, pitch = 0, vel: Vec = [0, 0, 0]) {
  Object.assign(c.p, { origin, vel, yaw, pitch });
  categorizePosition(c);
}

/** One usercmd: PlayerMove -> Duck -> FullWalkMove. */
export function playerMove(c: Ctx, cmd: Cmd) {
  const { p, s } = c;
  p.tick++;
  if (p.noclip) return noclipMove(c, cmd);
  // CheckParameters: cl_forwardspeed / cl_sidespeed 450, scaled down to maxspeed
  let fmove = cmd.fwd * MOVE_SPEED, smove = cmd.side * MOVE_SPEED;
  const spd = hypot2(fmove, smove);
  if (spd > s.maxspeed) { fmove *= s.maxspeed / spd; smove *= s.maxspeed / spd; }
  if (p.vel[2] > 250) setGround(c, null); // sv_optimizedmovement: ground carries over from last tick
  duck(c, cmd);
  if (p.ducked && p.onGround) { fmove *= DUCK_SPEED; smove *= DUCK_SPEED; } // HandleDuckingSpeedCrop
  startGravity(c);
  if (cmd.jump) checkJumpButton(c);
  if (p.onGround) { p.vel = zeroZ(p.vel); friction(c); }
  checkVelocity(c);
  const y = p.yaw * DEG, cy = cos(y), sy = sin(y);
  const wishvel: Vec = [cy * fmove + sy * smove, sy * fmove - cy * smove, 0]; // forward/right from yaw only
  const wishdir = norm(wishvel), wishspeed = Math.min(len(wishvel), s.maxspeed);
  p.wishdir = wishdir;
  if (p.onGround) walkMove(c, wishdir, wishspeed); else airMove(c, wishdir, wishspeed);
  categorizePosition(c);
  checkVelocity(c);
  halfGravity(c); // FinishGravity
  if (p.onGround) p.vel = zeroZ(p.vel);
  p.oldJump = cmd.jump;
}
