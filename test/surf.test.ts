import { existsSync, readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import worker, { RUNS as BOARD_RUNS } from '../server/worker';
import { describe, expect, it } from 'vitest';
import {
  type Cmd, type Vec, DEFAULTS, HULL_MIN, HULL_STAND, NO_CMD, accelerate, airAccelerate, categorizePosition, clipVelocity,
  ctx, dot, friction, hlen, len, makeTris, newPlayer, playerMove, trace,
} from '../src/physics';
import { type MapDef, type Spawn, Session, buildBrush, inside, rate } from '../src/game';
import { makeBot } from '../src/bot';
import { type Demo, replay, replayDemo } from '../src/plan';
import { RUNS } from '../src/runs';
import { ghost } from '../src/ghost';
import * as F from '../src/fmath';
import { parseBsp, resolveMap, unpack } from '../src/bsp';
import testMap, { RAMP60 } from '../src/maps/test';

const S = { ...DEFAULTS };
const DT = 1 / 128;
const world = testMap.brushes.map(buildBrush);
const near = (a: Vec, b: Vec, eps = 1e-9) => a.forEach((x, i) => expect(x).toBeCloseTo(b[i], -Math.log10(eps)));
const mapDefs = Object.values(import.meta.glob<{ default: MapDef }>('../src/maps/*.ts', { eager: true })).map(m => m.default);

/** Drop a player straight down from `at` until it rests on something. */
function settle(at: Vec) {
  const p = newPlayer(at);
  const tr = trace(world, at, [at[0], at[1], at[2] - 4000], HULL_MIN, HULL_STAND);
  p.origin = tr.end;
  return { p, c: ctx(p, world, S), normal: tr.normal };
}

describe('deterministic trig (src/fmath)', () => {
  it('agrees with the engine to within an ulp, and on the special cases', () => {
    let seed = 99; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const ulps = (a: number, b: number) => Math.abs(a - b) / (Math.abs(a) * 2 ** -52 || 5e-324);
    for (let i = 0; i < 20000; i++) {
      const x = (r() - 0.5) * 40, y = (r() - 0.5) * 8000, z = (r() - 0.5) * 8000, s = r() * 2 - 1;
      expect(Math.max(ulps(Math.sin(x), F.sin(x)), ulps(Math.cos(x), F.cos(x)), ulps(Math.asin(s), F.asin(s)), ulps(Math.atan2(y, z), F.atan2(y, z)))).toBeLessThanOrEqual(1);
    }
    expect([F.atan2(0, -1), F.atan2(-0, -1), F.atan2(1, 0), F.asin(1), F.cos(0), F.sin(-0)]).toEqual([Math.PI, -Math.PI, Math.PI / 2, Math.PI / 2, 1, -0]);
  });
});

describe('ClipVelocity', () => {
  it('removes the into-plane component', () => {
    near(clipVelocity([100, 0, -100], [0, 0, 1]), [100, 0, 0]);
    const n: Vec = [0, Math.sin(Math.PI / 3), Math.cos(Math.PI / 3)];
    const out = clipVelocity([300, 0, -400], n);
    near(out, [300, 400 * 0.5 * Math.sin(Math.PI / 3), -400 + 400 * 0.25]);
    expect(Math.abs(dot(out, n))).toBeLessThan(1e-9);
  });
  it('zeroes components below 0.1 and honours overbounce', () => {
    near(clipVelocity([0.05, 10, -10], [0, 0, 1]), [0, 10, 0]);
    near(clipVelocity([0, 0, -100], [0, 0, 1], 2), [0, 0, 100]);
  });
});

describe('Accelerate / AirAccelerate / Friction per-tick deltas', () => {
  const mk = (vel: Vec, onGround = true) => { const p = newPlayer([0, 0, 0]); p.vel = vel; p.onGround = onGround; return ctx(p, [], S); };
  it('ground accelerate', () => {
    let c = mk([0, 0, 0]); accelerate(c, [1, 0, 0], 250, 5.5); expect(c.p.vel[0]).toBeCloseTo(5.5 * 250 * DT, 12);
    c = mk([245, 0, 0]); accelerate(c, [1, 0, 0], 250, 5.5); expect(c.p.vel[0]).toBeCloseTo(250, 12);
    c = mk([250, 0, 0]); accelerate(c, [1, 0, 0], 250, 5.5); expect(c.p.vel[0]).toBe(250);
    c = mk([1000, 0, 0]); accelerate(c, [0, 1, 0], 250, 5.5); near(c.p.vel, [1000, 5.5 * 250 * DT, 0]);
  });
  it('air accelerate caps the projection at 30 but uses the uncapped wishspeed for the rate', () => {
    let c = mk([0, 0, 0], false); airAccelerate(c, [1, 0, 0], 250, 150); expect(c.p.vel[0]).toBeCloseTo(30, 12);
    c = mk([0, 0, 0], false); airAccelerate(c, [1, 0, 0], 250, 10); expect(c.p.vel[0]).toBeCloseTo(10 * 250 * DT, 12); // 19.53 < 30
    c = mk([0, 0, 0], false); airAccelerate(c, [1, 0, 0], 20, 10); expect(c.p.vel[0]).toBeCloseTo(10 * 20 * DT, 12);
    c = mk([1000, 0, 0], false); airAccelerate(c, [0, 1, 0], 250, 150); near(c.p.vel, [1000, 30, 0]); // strafe: +30 sideways
    c = mk([1000, 0, 0], false); airAccelerate(c, [1, 0, 0], 250, 150); near(c.p.vel, [1000, 0, 0]); // no gain along velocity
    c = mk([1000, 20, 0], false); airAccelerate(c, [0, 1, 0], 250, 150); near(c.p.vel, [1000, 30, 0]);
  });
  it('friction', () => {
    let c = mk([250, 0, 0]); friction(c); expect(c.p.vel[0]).toBeCloseTo(250 - 250 * 5.2 * DT, 12);
    c = mk([50, 0, 0]); friction(c); expect(c.p.vel[0]).toBeCloseTo(50 - 80 * 5.2 * DT, 12); // below stopspeed
    c = mk([2, 0, 0]); friction(c); expect(c.p.vel[0]).toBe(0);
    c = mk([250, 0, 0], false); friction(c); expect(c.p.vel[0]).toBe(250); // no friction in the air
  });
});

describe('CategorizePosition', () => {
  it('60° ramp face is not ground', () => {
    const { p, c, normal } = settle([800, RAMP60.y + RAMP60.width / 4, 900]);
    expect(normal[2]).toBeCloseTo(0.5, 6);
    categorizePosition(c);
    expect(p.onGround).toBe(false);
  });
  it('45° wedge is ground (normal.z = 0.707 >= 0.7)', () => {
    const { p, c, normal } = settle([-320, 0, 1000]);
    expect(normal[2]).toBeCloseTo(Math.SQRT1_2, 6);
    categorizePosition(c);
    expect(p.onGround).toBe(true);
  });
  it('flat ground is ground, moving up fast is not', () => {
    const { p, c } = settle([-1400, 0, 100]);
    categorizePosition(c); expect(p.onGround).toBe(true);
    p.vel = [0, 0, 141]; categorizePosition(c); expect(p.onGround).toBe(false);
  });
});

describe('ground movement', () => {
  const run = (p: ReturnType<typeof newPlayer>, cmd: Cmd, ticks: number, w = world, s = S) => { const c = ctx(p, w, s); for (let i = 0; i < ticks; i++) playerMove(c, cmd); };
  it('W from rest reaches exactly maxspeed', () => {
    const { p } = settle([-1400, 0, 50]);
    run(p, { ...NO_CMD, fwd: 1 }, 256);
    expect(p.onGround).toBe(true);
    expect(hlen(p.vel)).toBeCloseTo(250, 6);
  });
  it('jump reaches ~57 units and the bhop limiter caps to 1.1 * maxspeed', () => {
    const { p } = settle([-1400, 0, 50]);
    run(p, NO_CMD, 4);
    const z0 = p.origin[2];
    let apex = z0;
    p.vel = [400, 0, 0];
    run(p, { ...NO_CMD, jump: true }, 1, world, { ...S, bhopLimiter: true }); // vanilla CS:GO (sv_enablebunnyhopping 0)
    expect(hlen(p.vel)).toBeCloseTo(275, 6);
    for (let i = 0; i < 200 && !(p.onGround && i > 2); i++) { run(p, NO_CMD, 1); apex = Math.max(apex, p.origin[2]); }
    expect(apex - z0).toBeGreaterThan(54);
    expect(apex - z0).toBeLessThan(58);
  });
  it('holding jump bhops with no speed lost on landing, and strafing gains speed', () => {
    const { p } = settle([-1400, 1200, 50]); // open floor, clear of the ramps
    run(p, NO_CMD, 4);
    p.vel = [-400, 0, 0];
    let landings = 0;
    for (let i = 0; i < 400; i++) { const was = p.onGround; run(p, { ...NO_CMD, jump: true }, 1); if (!was && p.onGround) landings++; }
    expect(landings).toBeGreaterThan(3);
    expect(hlen(p.vel)).toBeCloseTo(400, 6);
    for (let i = 0; i < 600; i++) { p.yaw = Math.atan2(p.vel[1], p.vel[0]) * 180 / Math.PI; run(p, { ...NO_CMD, side: 1, jump: true }, 1); } // look along the velocity, hold D
    expect(hlen(p.vel)).toBeGreaterThan(500);
  });
  it('256 tick: jumps still reach ~57 units and holding jump keeps the landing speed', () => {
    const s256 = { ...S, tickrate: 256 }, { p } = settle([-1400, 1200, 50]);
    run(p, NO_CMD, 8, world, s256);
    const z0 = p.origin[2];
    let apex = z0;
    run(p, { ...NO_CMD, jump: true }, 1, world, s256);
    for (let i = 0; i < 256; i++) { run(p, NO_CMD, 1, world, s256); apex = Math.max(apex, p.origin[2]); }
    expect(apex - z0).toBeGreaterThan(56); // a little higher than at 128 (55.8): gravity is stepped more finely
    expect(apex - z0).toBeLessThan(57);
    p.vel = [-400, 0, 0];
    for (let i = 0; i < 800; i++) run(p, { ...NO_CMD, jump: true }, 1, world, s256);
    expect(hlen(p.vel)).toBeCloseTo(400, 6);
  });
  it('walks up the 45° wedge at full horizontal speed (StepMove)', () => {
    const { p } = settle([-760, 0, 50]);
    run(p, { ...NO_CMD, fwd: 1 }, 90); // ~69 ticks to reach 250 against friction
    const x0 = p.origin[0], z0 = p.origin[2];
    run(p, { ...NO_CMD, fwd: 1 }, 64);
    expect(p.onGround).toBe(true);
    expect(p.origin[2] - z0).toBeGreaterThan(100); // climbed
    expect((p.origin[0] - x0) / 0.5).toBeGreaterThan(240);
  });
});

describe('surf scenario on the 60° ramp', () => {
  const faceY = RAMP60.y + RAMP60.width / 4; // middle of the +Y face
  const drop = (x: number, z: number) => {
    const p = newPlayer([x, faceY, z]);
    p.vel = [300, 0, 0];
    const c = ctx(p, world, S);
    const log: { speed: number; touching: boolean; ground: boolean; p: Vec }[] = [];
    let lastRamp = 1e9;
    for (let i = 0; i < 128 * 4 && i < lastRamp + 20 && !p.onGround; i++) {
      playerMove(c, NO_CMD);
      const touching = p.touchTick === p.tick && p.lastNormal[2] > 0 && p.lastNormal[2] < 0.7;
      if (touching) lastRamp = i;
      log.push({ speed: len(p.vel), touching, ground: p.onGround, p: [...p.origin] });
    }
    return log;
  };
  const check = (log: ReturnType<typeof drop>) => {
    const on = log.map((l, i) => (l.touching ? i : -1)).filter(i => i >= 0);
    expect(on.length).toBeGreaterThan(20); // actually rode the face
    const first = on[0], last = on.at(-1)!;
    for (let i = first; i <= last; i++) {
      expect(log[i].ground).toBe(false); // never grounded on a 60° face
      expect(log[i].speed).toBeGreaterThan(300); // never stopped or stuck
      if (i > first + 1) expect(log[i].speed).toBeGreaterThan(log[i - 1].speed - 1e-6); // gains speed down the face
    }
    expect(log[last].speed).toBeGreaterThan(log[first + 1].speed + 200);
    const after = log.slice(last + 1, last + 6);
    expect(after.length).toBe(5); // launched: free flight after leaving the ramp
    expect(after.every(l => !l.touching && !l.ground && l.speed > log[last].speed - 1)).toBe(true);
    return log[last];
  };
  it('300 u/s along the ramp, dropped mid-length: slides down the face and launches off the bottom edge', () => {
    const l = check(drop(400, 700));
    expect(l.p[1] + 16).toBeGreaterThan(RAMP60.y + RAMP60.width / 2 - 1); // box reached the bottom edge
  });
  it('300 u/s along the ramp, dropped near the end: launches off the end of the ramp', () => {
    const log = drop(1880, 360);
    const l = check(log);
    expect(l.p[0] + 16).toBeGreaterThan(RAMP60.x1 - 1); // box reached the end cap
    expect(log.at(-1)!.p[0] - 16).toBeGreaterThan(RAMP60.x1); // and flew past it
    expect(l.p[1] + 16).toBeLessThan(RAMP60.y + RAMP60.width / 2); // still on the face, not off the bottom
  });
});

describe('rampbug fix', () => {
  // states from random rides on the Gauntlet's ramps where Source's float rounding stops the player dead
  const CASES = [
    { origin: [16786.131524297016, 34544.40507052369, 8087.242067651104], vel: [201.93756529284215, 698.6875908730934, 120.10863574333283], lastNormal: [0.6756429699644945, -0.31849562586173336, 0.6648812777064039] },
    { origin: [9500.652862802182, 32771.3758796263, 8680.532111993316], vel: [364.0458153949477, -420.0912335620069, -169.3680179765889], lastNormal: [0.6708810157520627, 0.3280965896019037, 0.6650348040479389] },
  ];
  it('Source stops dead on these; with the fix the player keeps its speed, in free space', () => {
    const def = mapDefs.find(m => m.id === 'gauntlet')!;
    for (const k of CASES) for (const rampfix of [false, true]) {
      const s = new Session(def, { ...S, rampfix });
      Object.assign(s.p, { origin: [...k.origin], vel: [...k.vel], lastNormal: [...k.lastNormal], onGround: false, tick: 1, touchTick: 0 });
      s.step(NO_CMD);
      if (!rampfix) expect(len(s.p.vel)).toBeLessThan(20);
      else {
        expect(len(s.p.vel)).toBeGreaterThan(0.8 * len(k.vel as Vec));
        expect(trace(s.world, s.p.origin, s.p.origin, HULL_MIN, HULL_STAND).startsolid).toBe(false);
      }
    }
  });
});

describe('displacement collision (terrain, cave rock)', () => {
  // a 4096-unit square of two triangles: a floor (facing up) or a wall (facing -x), like a flat displacement
  const sq = (pts: Vec[]) => makeTris(new Float64Array([...pts[0], ...pts[1], ...pts[2], ...pts[0], ...pts[2], ...pts[3]]));
  const floor = sq([[-2048, -2048, 0], [2048, -2048, 0], [2048, 2048, 0], [-2048, 2048, 0]]); // counter-clockwise from above
  const wall = sq([[0, -2048, -2048], [0, -2048, 2048], [0, 2048, 2048], [0, 2048, -2048]]); // faces -x
  const only = (t: ReturnType<typeof makeTris>) => Object.assign([] as ReturnType<typeof buildBrush>[], { tris: t });
  it('a floor holds you up: you land, stand and walk on it', () => {
    const p = newPlayer([0, 0, 100]), c = ctx(p, only(floor), S);
    for (let i = 0; i < 128; i++) playerMove(c, NO_CMD);
    expect(p.onGround).toBe(true);
    expect(p.origin[2]).toBeGreaterThanOrEqual(0);
    expect(p.origin[2]).toBeLessThan(0.1);
    p.yaw = 30;
    for (let i = 0; i < 128; i++) playerMove(c, { ...NO_CMD, fwd: 1 });
    expect([p.onGround, Math.round(hlen(p.vel))]).toEqual([true, 250]);
  });
  it('a wall stops you from its front; from behind you pass through (one-sided, as in Source)', () => {
    const w = only(wall);
    const into = trace(w, [-200, 0, 0], [200, 0, 0], HULL_MIN, HULL_STAND);
    expect(into.fraction).toBeLessThan(1);
    expect(into.end[0]).toBeCloseTo(-16 - 0.03125, 3);
    expect(into.normal).toEqual([-1, 0, 0]);
    expect(trace(w, [200, 0, 0], [-200, 0, 0], HULL_MIN, HULL_STAND).fraction).toBe(1);
    const p = newPlayer([-400, 0, 0]), c = ctx(p, w, S);
    p.vel = [1200, 300, 0];
    for (let i = 0; i < 64; i++) playerMove(c, NO_CMD);
    expect(p.origin[0]).toBeLessThan(-15.9);
    expect(p.vel[1]).toBeGreaterThan(200); // slid along it
  });
  it('a box at rest is stuck only where it overlaps the surface itself', () => {
    const w = only(wall), at = (x: number) => trace(w, [x, 0, 0], [x, 0, 0], HULL_MIN, HULL_STAND).startsolid;
    expect([at(-17), at(-15), at(0), at(15), at(17), at(300)]).toEqual([false, true, true, true, false, false]);
  });
});

describe('maps', () => {
  it.each(mapDefs.map(m => [m.id, m] as const))('%s builds and spawns in free space', (_, def) => {
    const s = new Session(def, S);
    for (const b of s.world) expect(b.faces.length).toBeGreaterThanOrEqual(4);
    const o = s.p.origin;
    expect(trace(s.world, o, o, HULL_MIN, HULL_STAND).startsolid).toBe(false);
    for (const st of def.stages ?? []) expect(trace(s.world, st.spawn.pos, st.spawn.pos, HULL_MIN, HULL_STAND).startsolid).toBe(false);
    for (const cp of def.checkpoints ?? []) if (cp.spawn) expect(trace(s.world, cp.spawn.pos, cp.spawn.pos, HULL_MIN, HULL_STAND).startsolid).toBe(false);
  });
  it('rate as the map list shows them: mostly the tier, then the length and how far back a fall sends you', () => {
    expect(Object.fromEntries(mapDefs.filter(m => m.difficulty).map(m => [m.id, rate(m.difficulty!).name]))).toEqual({
      utopia: 'Beginner', stages: 'Beginner', aircontrol: 'Beginner', aircontrol_v3: 'Beginner', gauntlet: 'Beginner', beginner: 'Beginner',
      kitsune: 'Easy', mesa: 'Easy', utopia_v3: 'Easy', progress: 'Easy', cyberwave: 'Medium',
    });
    expect(mapDefs.filter(m => !m.difficulty).map(m => m.id)).toEqual(['test']);
  });
  it.each(mapDefs.filter(m => m.bsp && !m.bsp.own).map(m => [m.id, m.bsp!] as const))('%s is shipped as the exact file it names (its version)', async (_, b) => {
    const raw = readFileSync(`public/${b.url}`), buf = await unpack(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    expect(createHash('sha256').update(new Uint8Array(buf)).digest('hex')).toBe(b.sha256);
  }, 60_000);
  it('a map comes out of the zip it was published in', async () => {
    const bsp = new TextEncoder().encode('VBSP'.repeat(500)), files: [string, Uint8Array, number][] = [['readme.txt', new TextEncoder().encode('hi'), 0], ['maps/x.bsp', deflateRawSync(bsp), 8]];
    const local: Uint8Array[] = [], central: Uint8Array[] = [];
    let at = 0;
    for (const [name, data, method] of files) { // name, data (stored or deflated), compression method
      const n = new TextEncoder().encode(name), h = new Uint8Array(30 + n.length), c = new Uint8Array(46 + n.length), hv = new DataView(h.buffer), cv = new DataView(c.buffer);
      hv.setUint32(0, 0x04034b50, true); hv.setUint16(8, method, true); hv.setUint32(18, data.length, true); hv.setUint16(26, n.length, true); h.set(n, 30);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(10, method, true); cv.setUint32(20, data.length, true); cv.setUint16(28, n.length, true); cv.setUint32(42, at, true); c.set(n, 46);
      local.push(h, data); central.push(c); at += h.length + data.length;
    }
    const end = new Uint8Array(22), ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(10, files.length, true); ev.setUint32(16, at, true);
    expect(new Uint8Array(await unpack(new Uint8Array(Buffer.concat([...local, ...central, end])).buffer))).toEqual(bsp);
  });
});

describe('timer', () => {
  it('starts when the origin leaves the start zone and stops on entering the end zone', () => {
    const s = new Session(testMap, S);
    expect(s.run.state).toBe('ready');
    let left = -1, ticks = 0;
    s.p.yaw = 0;
    for (let i = 0; i < 128 * 30 && s.run.state !== 'done'; i++) {
      s.step({ ...NO_CMD, fwd: 1 });
      if (left < 0 && s.run.state === 'running') left = i;
      if (left >= 0) ticks++;
      if (s.p.origin[0] > 300 && s.p.origin[0] < 2200) s.p.origin = [2300, 0, 1]; // skip the ramp: walk straight to the end
    }
    expect(s.run.state).toBe('done');
    expect(s.events.some(e => e.type === 'start')).toBe(true);
    expect(s.run.time).toBeCloseTo((ticks - 1) / 128, 9); // time counts ticks after leaving, at fixed dt
  });
  it('loading a practice checkpoint invalidates the run', () => {
    const s = new Session(testMap, S);
    s.saveCheckpoint();
    for (let i = 0; i < 128; i++) s.step({ ...NO_CMD, fwd: 1 });
    expect(s.run.state).toBe('running');
    s.loadCheckpoint();
    expect(s.run.practice).toBe(true);
  });
});

// The autopilot drives the real movement code with legal inputs only (yaw + strafe keys). It proves each map is
// completable at both tick rates, and that riding ramps never sticks: no tick may stop the player dead (a rampbug,
// edge snag or wall crash). Landings legitimately shed the into-face component, so the bar is 70% in one tick.
describe('maps are completable (autopilot)', () => {
  const runMap = (def: MapDef, tickrate: number, from?: { section: number; spawn: Spawn }) => {
    const s = new Session(def, { ...S, tickrate }), bot = makeBot(def.route!, s.world, s.s);
    if (from) { s.section = from.section; s.respawn(from.spawn); }
    let worst = 0, prev = 0, fails = 0;
    for (let i = 0; i < tickrate * 150; i++) {
      s.step(bot(s.p));
      const v = len(s.p.vel);
      const evs = s.events.splice(0);
      fails += evs.filter(e => e.type === 'fail').length;
      if (prev > 200 && !evs.length) worst = Math.max(worst, 1 - v / prev);
      prev = v;
      if (from ? s.section !== from.section || s.run.state === 'done' : evs.some(e => e.type === 'finish')) return { done: true, fails, worst, s };
    }
    return { done: false, fails, worst, s };
  };
  for (const tickrate of [128, 64]) {
    for (const id of ['utopia', 'stages']) it(`${id} start to finish at ${tickrate} tick`, () => {
      const r = runMap(mapDefs.find(m => m.id === id)!, tickrate);
      expect(r.done).toBe(true);
      expect(r.fails).toBe(0);
      expect(r.worst).toBeLessThan(0.7);
    });
    it(`gauntlet: every stage completes from its spawn at ${tickrate} tick (either tick parity)`, async () => {
      const def = await resolveMap(mapDefs.find(m => m.id === 'gauntlet')!);
      def.stages!.forEach((st, k) => [0, 1].forEach(par => {
        const s = new Session(def, { ...S, tickrate }), bot = makeBot(def.route!, s.world, s.s, undefined, true);
        s.respawn(st.spawn);
        if (par) s.step(NO_CMD); // the bot alternates strafes on tick parity: runs are chaotic, both must work
        let worst = 0, prev = 0, res = 'timeout';
        for (let i = 0; i < tickrate * 60 && res === 'timeout'; i++) {
          s.step(bot(s.p));
          const v = len(s.p.vel), evs = s.events.splice(0);
          if (prev > 200 && !evs.length) worst = Math.max(worst, 1 - v / prev);
          prev = v;
          if (evs.some(e => e.type === 'fail')) res = 'fail';
          if (evs.some(e => e.type === 'stage')) res = 'done';
        }
        expect(res, `stage ${k + 1} parity ${par}`).toBe('done');
        expect(worst, `stage ${k + 1} parity ${par}`).toBeLessThan(0.7);
      }));
    }, 120_000);
    it(`utopia: every section completes from its zero-velocity respawn at ${tickrate} tick`, () => {
      const def = mapDefs.find(m => m.id === 'utopia')!;
      def.checkpoints!.forEach((cp, i) => {
        const r = runMap(def, tickrate, { section: i + 1, spawn: cp.spawn! });
        expect(r.done, `section ${i + 2}`).toBe(true);
        expect(r.fails, `section ${i + 2}`).toBe(0);
      });
    });
  }
});

// Imported maps: skip when the .bsp isn't there (public/bsp/ is gitignored).
const BSP = 'public/maps/surf_utopia_v3.bsp';
describe.skipIf(!existsSync(BSP))('Source .bsp import (surf_utopia_v3)', () => {
  const read = async () => { const b = readFileSync(BSP); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
  it('parses brushes, entities, teleports and pushes', async () => {
    const b = parseBsp(await read());
    expect(b.brushes.length).toBeGreaterThan(5000);
    expect(b.fails.filter(f => f.to).length).toBeGreaterThan(100);
    expect(b.pushes.length).toBe(8);
    expect(b.brushes.every(br => br.type === 'planes' && br.planes.every(p => Math.abs(Math.hypot(p[0], p[1], p[2]) - 1) < 1e-3))).toBe(true);
  }, 60_000);
  it('autopilot passes all 3 splits and reaches the booster (both tick parities)', async () => {
    const def = await resolveMap(mapDefs.find(m => m.id === 'utopia_v3')!, read);
    const booster = def.pushes!.find(b => b.vel[0] > 0 && b.min[2] < -1000)!; // the +x push after the keyhole
    for (const par of [0, 1]) {
      const s = new Session(def, S), bot = makeBot(def.route!, s.world, s.s, undefined, true);
      if (par) s.step(NO_CMD);
      let splits = 0, boosted = false;
      for (let i = 0; i < 128 * 60 && !boosted; i++) {
        s.step(bot(s.p));
        const evs = s.events.splice(0);
        expect(evs.some(e => e.type === 'fail'), `parity ${par}, ${i / 128}s`).toBe(false);
        splits += evs.filter(e => e.type === 'split').length;
        boosted = s.p.origin.every((v, k) => v >= booster.min[k] - 16 && v <= booster.max[k] + 16);
      }
      expect([splits, boosted]).toEqual([3, true]);
    }
  }, 120_000);
  it('spawns in free space, on the ground', async () => {
    const def = await resolveMap(mapDefs.find(m => m.id === 'utopia_v3')!, read);
    const s = new Session(def, S);
    expect(trace(s.world, s.p.origin, s.p.origin, HULL_MIN, HULL_STAND).startsolid).toBe(false);
    for (let i = 0; i < 64; i++) s.step(NO_CMD);
    expect(s.p.onGround).toBe(true);
    expect(s.events.some(e => e.type === 'fail')).toBe(false);
  }, 60_000);
});

const KITSUNE = 'public/maps/surf_kitsune.bsp';
describe.skipIf(!existsSync(KITSUNE))('Source .bsp import (surf_kitsune)', () => {
  const read = async () => { const b = readFileSync(KITSUNE); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
  const load = () => resolveMap(mapDefs.find(m => m.id === 'kitsune')!, read);
  it('nine stages, each with a spawn in free space and an exit window', async () => {
    const def = await load(), s = new Session(def, S);
    expect(def.stages!.map(st => st.name)).toEqual(['Red', 'Orange', 'Yellow', 'Green', 'Teal', 'Blue', 'Purple', 'Pink', 'White']);
    for (const st of def.stages!) {
      expect(trace(s.world, st.spawn.pos, st.spawn.pos, HULL_MIN, HULL_STAND).startsolid, st.name).toBe(false);
      expect(def.fails!.some(f => f.quiet && st.end.min.every((v, k) => v <= f.min[k] && st.end.max[k] >= f.max[k])), st.name).toBe(true);
    }
  }, 60_000);
  it('the secret path: backing out of the spawn room tags you, and the push carries you on into the first stage', async () => {
    const def = await load(), s = new Session(def, S);
    for (let i = 0; i < 128 * 4 && s.p.origin[2] < 300; i++) s.step({ ...NO_CMD, fwd: -1 }); // into the rear teleport
    for (let i = 0; i < 128 * 6 && !(s.stage.index === 0 && s.p.origin[1] < -14000); i++) s.step({ ...NO_CMD, fwd: 1 });
    expect([s.name, s.p.origin[1] < -14000]).toEqual(['x', true]);
    expect(def.fails!.filter(f => f.filter?.name === 'x').length).toBe(1); // ...which opens Red's hidden second exit
    expect(s.trail).toBe(false); // the trail waits in the secret room
  }, 60_000);
  it('White (the last stage) goes through: a clear way from its start to its exit, touching no kill volume', async () => {
    // a flood fill through free space (each step swept) shortened to clear segments; its walls include glass grids
    const WAY: Vec[] = [[-15104, 14976, 10808], [-14592, 8064, 10808], [-14976, 7680, 10808], [-14848, 7552, 10808], [-14208, 6528, 8888], [-14208, 6784, 7992], [-14208, 5760, 6968], [-14208, 3840, 6200], [-10368, 3968, 6200], [-10368, 10240, 5816], [-10368, 10368, 5048], [-2560, 10368, 4152], [128, 10240, 4152], [0, 8576, 4152], [-640, 8192, 4152], [-2176, 8064, 4152], [-2176, 9088, 2232], [-1920, 9984, 2232], [-1152, 10624, 312], [1024, 10624, -5576], [8192, 10624, -7240], [8832, 10368, -7240], [10240, 10624, -7240], [11008, 10368, -7240], [14208, 10240, -9416], [14080, 10240, -9928], [13056, 10240, -10568], [-16000, 10240, -11848]];
    const b = parseBsp(await read()), def = await load(), s = new Session(def, S), white = def.stages![8];
    const touches = (p: Vec) => b.fails.some(f => p[0] + 16 > f.min[0] && p[0] - 16 < f.max[0] && p[1] + 16 > f.min[1] && p[1] - 16 < f.max[1] && p[2] + 72 > f.min[2] && p[2] < f.max[2]
      && (!f.shape || f.shape.some(br => br.every(([a, c, e, d]) => Math.min(...[0, 1, 2, 3, 4, 5, 6, 7].map(k => a * (p[0] + (k & 1 ? 16 : -16)) + c * (p[1] + (k & 2 ? 16 : -16)) + e * (p[2] + (k & 4 ? 72 : 0)))) <= d))));
    expect(Math.hypot(...([0, 1, 2].map(k => WAY[0][k] - white.spawn.pos[k])) as Vec)).toBeLessThan(200);
    expect(WAY.at(-1)!.every((v, k) => v >= white.end.min[k] && v <= white.end.max[k])).toBe(true);
    for (let i = 1; i < WAY.length; i++) {
      const a = WAY[i - 1], c = WAY[i], t = trace(s.world, a, c, HULL_MIN, HULL_STAND), n = Math.ceil(len(c.map((v, k) => v - a[k]) as Vec) / 24);
      expect(t.fraction === 1 && !t.startsolid, `segment ${i}`).toBe(true);
      for (let k = 0; k <= n; k++) expect(touches(a.map((v, j) => v + ((c[j] - v) * k) / n) as Vec), `segment ${i}`).toBe(false);
    }
  }, 120_000);
  // the autopilot's line is verified stage by stage (the rest of the map is imported and playable, but unverified)
  const VERIFIED: Record<number, number[]> = { 128: [1, 2, 3, 4, 6], 64: [1, 2, 3] };
  for (const tickrate of [128, 64]) it(`autopilot finishes stages ${VERIFIED[tickrate].join(', ')} at ${tickrate} tick (either tick parity)`, async () => {
    const def = await load();
    for (const k of VERIFIED[tickrate]) for (const par of [0, 1]) {
      const s = new Session(def, { ...S, tickrate }), bot = makeBot(def.route!, s.world, s.s, undefined, true, { flags: def.routeFlags, hazard: s.hazard, bisect: def.routeCorners });
      s.respawn(def.stages![k - 1].spawn);
      if (par) s.step(NO_CMD);
      let res = 'timeout';
      for (let i = 0; i < tickrate * 40 && res === 'timeout'; i++) {
        s.step(bot(s.p));
        const evs = s.events.splice(0);
        if (evs.some(e => e.type === 'fail')) res = 'fail';
        if (evs.some(e => e.type === 'stage')) res = 'done';
      }
      expect(res, `stage ${k} parity ${par}`).toBe('done');
    }
  }, 120_000);
  // Source's trigger_teleport keeps velocity: each exit hands its speed on to the next stage. The in-game demo runs the
  // map from the spawn room in one go, carrying it through every exit
  const CHAIN: Record<number, number> = { 128: 4, 64: 3 };
  for (const tickrate of [128, 64]) it(`exits keep speed; from the spawn room the autopilot carries it through stages 1-${CHAIN[tickrate]} at ${tickrate} tick (either tick parity)`, async () => {
    const def = await load();
    for (const par of [0, 1]) {
      const s = new Session(def, { ...S, tickrate }), bot = makeBot(def.route!, s.world, s.s, undefined, true, { flags: def.routeFlags, hazard: s.hazard, bisect: def.routeCorners });
      if (par) s.step(NO_CMD);
      const done: number[] = [], kept: number[][] = [];
      for (let i = 0; i < tickrate * 120 && s.stage.index < CHAIN[tickrate]; i++) { // on through the last one's exit
        const v = hlen(s.p.vel), o = s.p.origin;
        s.step(bot(s.p));
        if (Math.hypot(s.p.origin[0] - o[0], s.p.origin[1] - o[1]) > 1000) kept.push([v, hlen(s.p.vel)]); // through an exit
        const evs = s.events.splice(0);
        expect(evs.some(e => e.type === 'fail'), `parity ${par}: fell in stage ${s.stage.index + 1}`).toBe(false);
        for (const e of evs) if (e.type === 'stage') done.push(e.index);
      }
      expect(done).toEqual([...Array(CHAIN[tickrate]).keys()]);
      expect(kept.length).toBe(CHAIN[tickrate] + 1); // the spawn room's, then each stage's exit
      for (const [out, into] of kept) { expect(out).toBeGreaterThan(200); expect(Math.abs(into - out)).toBeLessThan(10); }
    }
  }, 120_000);
});

const AIRCONTROL = 'public/bsp/surf_aircontrol_ksf.bsp';
describe.skipIf(!existsSync(AIRCONTROL))('Source .bsp import (surf_aircontrol_ksf, CS:GO v21)', () => {
  const read = async () => { const b = readFileSync(AIRCONTROL); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
  const load = () => resolveMap(mapDefs.find(m => m.id === 'aircontrol')!, read);
  it('takes its zones from the map\'s own timer triggers; spawns on the ground; falls teleport to the start', async () => {
    const b = parseBsp(await read()), def = await load(), s = new Session(def, S);
    expect(b.namers.map(n => n.name)).toContain('main'); // v21 outputs are ESC-separated
    expect(def.checkpoints!.length).toBe(5);
    expect(def.start!.max[2]).toBe(14592);
    for (let i = 0; i < 64; i++) s.step(NO_CMD);
    expect(s.p.onGround).toBe(true);
    expect(def.fails!.filter(f => f.to?.pos.join() === '-1856,-9504,14720').length).toBeGreaterThan(40);
  }, 60_000);
  // the autopilot's line is verified start to finish at 128 tick; at 64 tick only up to the first checkpoint
  const VERIFIED: Record<number, number> = { 128: 6, 64: 1 }; // checkpoints passed (6: the finish)
  for (const tickrate of [128, 64]) it(`autopilot ${VERIFIED[tickrate] > 5 ? 'runs start to finish through all 5 checkpoints' : `reaches checkpoint ${VERIFIED[tickrate]}`} at ${tickrate} tick (either tick parity)`, async () => {
    const def = await load();
    for (const par of [0, 1]) {
      const s = new Session(def, { ...S, tickrate }), bot = makeBot(def.route!, s.world, s.s, undefined, true, { hazard: s.hazard });
      if (par) s.step(NO_CMD);
      let res = 'timeout', passed = 0;
      for (let i = 0; i < tickrate * 120 && res === 'timeout'; i++) {
        s.step(bot(s.p));
        const evs = s.events.splice(0);
        passed += evs.filter(e => e.type === 'split' || e.type === 'finish').length;
        if (evs.some(e => e.type === 'fail')) res = `fail at ${s.p.origin.map(Math.round)} (${passed} passed)`;
        if (passed >= VERIFIED[tickrate]) res = 'ok';
      }
      expect(res, `parity ${par}`).toBe('ok');
    }
  }, 240_000);
});

describe('Source .bsp import (surf_aircontrol_v3, CS:S v19)', () => {
  it('spawns on the ground in its start room; leaving starts the run, a fall sends you back, the end room finishes it', async () => {
    const def = await resolveMap(mapDefs.find(m => m.id === 'aircontrol_v3')!, async () => { const b = readFileSync('public/maps/surf_AirControl_v3.bsp'); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); });
    const s = new Session(def, S), run = (fwd: number, ticks: number) => { const seen: string[] = []; for (let i = 0; i < ticks; i++) { s.step({ ...NO_CMD, fwd }); seen.push(...s.events.splice(0).map(e => e.type)); } return seen; };
    run(0, 64);
    expect([s.p.onGround, inside(s.p.origin, def.start!)]).toEqual([true, true]);
    expect(run(1, 256)).toContain('start'); // out of the start room the way it faces
    s.p.origin = [-1800, -7000, 12900]; // into the kill floor under the first ramps
    expect(run(0, 2)).toContain('fail');
    expect(inside(s.p.origin, def.start!)).toBe(true);
    run(1, 256);
    s.p.origin = [12160, 3072, -14390]; // the end room, where the original's weapons wait
    expect(run(0, 2)).toContain('finish');
  }, 60_000);
});

const BEGINNER = 'public/maps/surf_beginner.bsp';
describe.skipIf(!existsSync(BEGINNER))('Source .bsp import (surf_beginner)', () => {
  const read = async () => { const b = readFileSync(BEGINNER); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
  const load = () => resolveMap(mapDefs.find(m => m.id === 'beginner')!, read);
  it('seven stages: a fall goes back to the stage\'s platform, its portal ends it and readies the next, the last one finishes the run', async () => {
    const def = await load(), st = def.stages!;
    expect(st.map(x => x.name)).toEqual([1, 2, 3, 4, 5, 6, 7].map(i => `Stage ${i}`));
    st.forEach((x, i) => {
      expect(inside(x.spawn.pos, x.start) && def.fails!.some(f => !f.quiet && f.to && inside(f.to.pos, x.start)), x.name).toBe(true);
      const exits = def.fails!.filter(f => f.quiet && f.to && inside(f.to.pos, x.end));
      expect(exits.length, x.name).toBe(i === 1 ? 2 : 1); // stage 2's cross ramp has a portal at either end
      for (const ex of exits) {
        const s = new Session(def, S);
        s.stage = { index: i, state: 'running', time: 5, splits: [], practice: false };
        s.run = { state: 'running', time: 30, splits: [], practice: false };
        s.p.origin = [(ex.min[0] + ex.max[0]) / 2, (ex.min[1] + ex.max[1]) / 2, ex.min[2] + 8];
        s.step(NO_CMD);
        const ev = s.events.splice(0).map(e => e.type);
        expect([ev.includes('stage'), i < 6 ? s.stage.index === i + 1 && s.stage.state === 'ready' : ev.includes('finish')], x.name).toEqual([true, true]);
      }
    });
  }, 60_000);
  // the autopilot's line is verified for stages 1-4 at 256 tick (the rest of the map is imported and playable: no line yet)
  it('autopilot finishes stages 1-4 at 256 tick, each from standing and in one go from the start (either tick parity)', async () => {
    const def = await load();
    for (const k of [1, 2, 3, 4, 0]) for (const par of [0, 1]) { // 0: from the start, carrying speed through the portals
      const s = new Session(def, { ...S, tickrate: 256 }), bot = makeBot(def.route!, s.world, s.s, undefined, true, { flags: def.routeFlags, hazard: s.hazard, bisect: def.routeCorners });
      if (k) s.respawn(def.stages![k - 1].spawn);
      if (par) s.step(NO_CMD);
      const done: number[] = [];
      let fell = false;
      for (let i = 0; i < 256 * 40 && !fell && done.length < (k ? 1 : 4); i++) {
        s.step(bot(s.p));
        for (const e of s.events.splice(0)) { if (e.type === 'fail') fell = true; if (e.type === 'stage') done.push(e.index + 1); }
      }
      expect(done, `${k ? `stage ${k}` : 'from the start'} parity ${par}`).toEqual(k ? [k] : [1, 2, 3, 4]);
    }
  }, 240_000);
});

const MESA = 'public/maps/surf_mesa.bsp';
describe.skipIf(!existsSync(MESA))('Source .bsp import (surf_mesa)', () => {
  const read = async () => { const b = readFileSync(MESA); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
  const load = () => resolveMap(mapDefs.find(m => m.id === 'mesa')!, read);
  it('spawns on the ground in its start zone; falls teleport back to the spawn room', async () => {
    const def = await load(), s = new Session(def, S);
    for (let i = 0; i < 64; i++) s.step(NO_CMD);
    expect(s.p.onGround).toBe(true);
    expect(s.p.origin.every((v, k) => v >= def.start!.min[k] && v <= def.start!.max[k])).toBe(true);
    expect(def.fails!.filter(f => f.to && Math.abs(f.to.pos[2] - 10161) < 1).length).toBeGreaterThan(8);
    expect(def.checkpoints!.length).toBe(6);
  }, 60_000);
  it('the whole course goes through: a clear way from the spawn room to the blast door, touching no kill volume', async () => {
    // a flood fill through free space (each step swept both ways: the cave rock is solid from the front, and from behind
    // Source stops you dead) shortened to clear segments, around the rock and the solid props (it doesn't model gravity:
    // it shows the course is connected, not that a given line through it is fast enough)
    const WAY: Vec[] = [[-32, -480, 10272], [-320, 4320, 9792], [-320, 4320, 9504], [-320, 4896, 7872], [-320, 5376, 7104], [-320, 5952, 6912], [-320, 6624, 6816], [-320, 7488, 6816], [-416, 12096, 6816], [-512, 12480, 6816], [-2528, 14400, 6816], [-4064, 14592, 6816], [-12320, 14400, 6816], [-12608, 14112, 6816], [-13664, 13920, 6816], [-13760, 13728, 6816], [-14048, 13440, 6816], [-14624, 11808, 6816], [-14624, 7968, 6720], [-14624, 4896, 4608], [-14624, 4704, 3360], [-14624, 3552, 2976], [-14624, 2400, 2976], [-14432, -192, 3264], [-14432, -5184, 3360], [-14432, -8064, 3168], [-14432, -8832, 3168], [-14240, -9216, 3168], [-13088, -10080, 3168], [-12512, -10176, 3168], [-10592, -10272, 3168], [-9152, -9984, 3168], [-9152, -9792, 3072], [-9056, -6240, 2784], [-9056, -6144, 2688], [-9056, -5376, 2304], [-9056, -3552, 2208], [-9056, 0, 1824], [-9056, 2304, 1536], [-9056, 6144, 1344], [-9056, 6336, 1536], [-9056, 6240, 1824], [-9056, 6240, 1920], [-7712, 6240, 1920], [-7712, 9312, 1920], [-1184, 9792, 1920], [-1184, 9792, 1632], [-896, 9792, 1344], [-320, 8448, 1248], [-320, 768, -1440], [-320, -192, -2016], [-320, -1920, -2784], [-320, -3264, -3072], [-320, -3744, -3264], [-128, -3936, -3264], [-128, -4320, -3264], [-32, -9504, -3552], [-32, -9504, -4800], [-32, -7104, -10848], [-32, -6720, -11424], [-32, -6336, -11520], [-32, -480, -11616], [-32, 14016, -12000], [-32, 14112, -12288], [-32, 14400, -12288], [-32, 14400, -12192]];
    const b = parseBsp(await read()), def = await load(), s = new Session(def, S);
    const touches = (p: Vec) => b.fails.some(f => p[0] + 16 > f.min[0] && p[0] - 16 < f.max[0] && p[1] + 16 > f.min[1] && p[1] - 16 < f.max[1] && p[2] + 72 > f.min[2] && p[2] < f.max[2]
      && (!f.shape || f.shape.some(br => br.every(([a, c, e, d]) => Math.min(...[0, 1, 2, 3, 4, 5, 6, 7].map(k => a * (p[0] + (k & 1 ? 16 : -16)) + c * (p[1] + (k & 2 ? 16 : -16)) + e * (p[2] + (k & 4 ? 72 : 0)))) <= d))));
    expect(WAY[0].every((v, k) => v >= def.start!.min[k] - 300 && v <= def.start!.max[k] + 300)).toBe(true);
    expect(Math.hypot(...([0, 1, 2].map(k => WAY.at(-1)![k] - (def.end!.min[k] + def.end!.max[k]) / 2)) as Vec)).toBeLessThan(300);
    for (let i = 1; i < WAY.length; i++) {
      const a = WAY[i - 1], c = WAY[i], t = trace(s.world, a, c, HULL_MIN, HULL_STAND), u = trace(s.world, c, a, HULL_MIN, HULL_STAND), n = Math.ceil(len(c.map((v, k) => v - a[k]) as Vec) / 24);
      expect(t.fraction === 1 && !t.startsolid && u.fraction === 1, `segment ${i}`).toBe(true);
      for (let k = 0; k <= n; k++) expect(touches(a.map((v, j) => v + ((c[j] - v) * k) / n) as Vec), `segment ${i}`).toBe(false);
    }
  }, 120_000);
  it('the cave rock is solid (but for the few displacements the map flags as not), and so are the solid static props', async () => {
    const def = await load(), s = new Session(def, S), rock = Object.assign([], { tris: def.tris });
    expect([def.terrain!.pos.length / 9, def.tris!.order.length]).toEqual([183552, 175360]); // 64 of 1434 displacements: no hull collision
    // where the player's recording flew under the north hall's rock shelf (it was drawn only then): stuck in it now
    expect(trace(rock, [3623, 14816, 7220], [3623, 14816, 7220], HULL_MIN, HULL_STAND).startsolid).toBe(true);
    expect(trace(rock, [3623, 14816, 7000], [3623, 14816, 7000], HULL_MIN, HULL_STAND).startsolid).toBe(false);
    expect([def.props!.length, def.props!.reduce((a, p) => a + p.at.length, 0)]).toEqual([15, 212]); // (one stock rock model isn't packed)
    const t = trace(s.world, [-1400, 11456, -10950], [-400, 11456, -10950], HULL_MIN, HULL_STAND); // through a stalactite
    expect(t.fraction).toBeLessThan(1);
  }, 60_000);
  // the autopilot: the planned runs (below) finish the map; the player's recorded run (test/runs/) is its line
});

const CYBERWAVE = 'public/maps/surf_cyberwave.bsp.gz';
describe.skipIf(!existsSync(CYBERWAVE))('Source .bsp import (surf_cyberwave, gzipped, CS:GO v21)', () => {
  const load = () => resolveMap(mapDefs.find(m => m.id === 'cyberwave')!, async () => { const b = readFileSync(CYBERWAVE); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); });
  it('the map\'s own settings (max velocity 7500), its stage zones, its models; spawns on the ground', async () => {
    const def = await load(), s = new Session(def, S);
    expect(s.s.maxvelocity).toBe(7500);
    expect(S.maxvelocity).toBe(3500); // (the settings passed in are left as they are)
    expect(def.stages!.map(st => st.name)).toEqual(['Stage 1', 'Stage 2']);
    expect([def.props!.length, def.props!.reduce((a, p) => a + p.at.length, 0)]).toEqual([74, 283]);
    for (let i = 0; i < 128; i++) s.step(NO_CMD); // (stage 1's landing point is above its platform)
    expect(s.p.onGround).toBe(true);
  }, 60_000);
  it('you start, and restart, at stage 1\'s start (the spawn room is skipped); a solid light tower stands inside stage 1\'s U-turn', async () => {
    const def = await load(), s = new Session(def, S);
    expect(def.spawn).toEqual(def.stages![0].spawn);
    for (let i = 0; i < 128 * 3; i++) s.step({ ...NO_CMD, fwd: 1 });
    expect(s.stage.state).toBe('running'); // walked off the platform: stage 1's timer runs
    s.restart();
    for (let i = 0; i < 128; i++) s.step(NO_CMD);
    expect([s.p.onGround, s.stage.index, s.stage.state]).toEqual([true, 0, 'ready']);
    expect(s.p.origin.every((v, k) => v >= def.stages![0].start.min[k] && v <= def.stages![0].start.max[k])).toBe(true);
    expect(trace(s.world, [11136, -11200, 8704], [11136, -9344, 8704], HULL_MIN, HULL_STAND).fraction).toBeLessThan(1);
  }, 60_000);
  it('drawn with its own look: neon tints, textures, lightmaps, props lit by their baked lighting, its sky', async () => {
    const L = (await load()).look!;
    const glow = L.mats.filter(m => m.lit === 0 && !m.tex && !m.pulse.length).map(m => m.tint.map(c => Math.round(c * 255)).join(' '));
    expect(glow).toEqual(expect.arrayContaining(['20 114 255', '249 62 62', '234 37 234', '56 255 238', '249 125 42', '252 241 40'])); // its six neon colours ($color, $color2)
    expect(L.mats.filter(m => m.tex).length).toBeGreaterThan(20);
    expect(L.sky!.map(s => `${s.w}x${s.h}`)).toEqual(Array(6).fill('1024x1024'));
    expect(L.lightmap!.w * L.lightmap!.h).toBeGreaterThan(0);
    const lit = L.parts.filter(p => p.light), unlit = Math.fround(0.9); // every prop vertex found its baked colour (0.9: none)
    expect(lit.length).toBeGreaterThan(5);
    expect(lit.every(p => p.light!.every((v, i) => i % 3 || v !== unlit || p.light![i + 1] !== unlit))).toBe(true);
  }, 60_000);
});

const PROGRESS = 'public/maps/surf_progress_fix.bsp.gz';
describe.skipIf(!existsSync(PROGRESS))('Source .bsp import (surf_progress, gzipped)', () => {
  const load = () => resolveMap(mapDefs.find(m => m.id === 'progress')!, async () => { const b = readFileSync(PROGRESS); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); });
  it('a hub, four parts from the map\'s own zones, its models; spawns on the ground in the hub', async () => {
    const def = await load(), s = new Session(def, S);
    expect(def.stages!.map(st => st.name)).toEqual(['Part 1', 'Part 2', 'Part 3', 'Part 4']);
    expect(def.props!.reduce((a, p) => a + p.at.length, 0)).toBe(428);
    for (let i = 0; i < 64; i++) s.step(NO_CMD);
    expect([s.p.onGround, Math.round(s.p.origin[0]), Math.round(s.p.origin[1])]).toEqual([true, 11968, 10016]);
  }, 60_000);
  it('its signs show their arrows and titles: their glowing faces are drawn in their own textures', async () => {
    const signs = (await load()).props!.filter(p => p.parts?.length);
    expect([signs.length, signs.reduce((a, p) => a + p.at.length, 0)]).toEqual([18, 47]); // arrows (19 flicks, 11 turns, 2 bends), section boards
    expect(signs.every(p => p.parts!.every(q => q.mat.tex && q.mat.lit === 0 && q.index.length))).toBe(true);
  }, 60_000);
  it('part 3\'s last section is ridden three times: each exit opens part 4 only once you hold the other two letters', async () => {
    const def = await load(), s = new Session(def, S), five = [9408, -13312, -11936];
    const exit = (x: number, y: number) => { // drop into an exit (two tilted slabs: back to its pad first, then on to part 4), then on through whatever it leads to
      s.p.origin = [x, y, -15100]; s.p.vel = [0, 0, -900];
      for (let i = 0; i < 128 && s.p.origin[2] < -14000; i++) s.step(NO_CMD);
      s.step(NO_CMD);
      return s.p.origin.map(Math.round);
    };
    s.name = 'target_default';
    expect([exit(6341, -4934), s.name]).toEqual([five, 'target_a']); // exit A: back by pad A (tagged a), on into the section again
    expect([exit(12538, -4930), s.name]).toEqual([five, 'target_ac']); // exit C: not yet (needs a and b); pad C: tagged a and c
    const at = exit(9440, -3314); // exit B: a and c held, so on to part 4
    expect([s.stage.index, at[0], at[1]]).toEqual([3, 14912, 5216]);
  }, 60_000);
});

// planned runs replay exactly: from a fresh start, the stored moves finish (a run of the first stages: get through its
// last one) in the stored time, without a fall
describe('planned autopilot runs', () => {
  for (const [key, { run, time, stage }] of Object.entries(RUNS)) {
    const [id, tick] = key.split('@'), m = mapDefs.find(d => d.id === id)!, file = m.bsp && ['public/maps/', 'public/bsp/'].map(d => d + m.bsp!.url.split('/').pop()).find(existsSync);
    it.skipIf(m.bsp && !file)(`${m.name} at ${tick} tick: the planned run ${stage === undefined ? 'finishes' : `gets through stage ${stage + 1}`} in ${time.toFixed(3)}`, async () => {
      const def = await resolveMap(m, async () => { const b = readFileSync(file!); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); });
      const s = new Session(def, { ...S, tickrate: +tick }), bot = replay(run, +tick, makeBot(def.route ?? [], s.world, s.s, undefined, !!def.routeOnSurface, { flags: def.routeFlags, hazard: s.hazard, bisect: def.routeCorners }));
      let t = -1;
      for (let i = 0; i < +tick * (time + 5) && t < 0; i++) {
        s.step(bot(s.p));
        for (const e of s.events.splice(0)) { expect(e.type, `fell at ${(i / +tick).toFixed(2)}s`).not.toBe('fail'); if ((e.type === 'finish' && stage === undefined) || (e.type === 'stage' && e.index === stage)) t = e.type === 'stage' ? s.run.time : e.time; }
      }
      expect(t).toBe(time);
    }, 120_000);
  }
});

// the ghost (src/ghost.ts) is the autopilot's run: from where its timer starts (each stage's, on a staged map), its
// trace finishes in the planned time
describe('ghost', () => {
  for (const [id, tick] of [['utopia', 128], ['stages', 128]] as const) {
    it(`${id} at ${tick} tick: the planned run's timer starts and its finish`, async () => {
      const m = await resolveMap(mapDefs.find(d => d.id === id)!), g = ghost(new Session(m, { ...S, tickrate: tick }), true)!;
      while (!g.done) g.step(1000);
      expect(g.fell).toBe(false);
      expect(Object.keys(g.sync).length).toBe(m.stages?.length ?? 1);
      expect((g.finish - g.sync[0]) / tick).toBe(RUNS[`${id}@${tick}`].time);
      const [x, y, z] = g.at.subarray(g.finish * 5); // it's in the end zone then
      expect(inside([x, y, z], m.end ?? m.stages!.at(-1)!.end)).toBe(true);
    }, 120_000);
  }
});

// the player's recorded runs (test/runs/, saved in-game with E) replay exactly: from their snapshot, the stored view and
// keys finish in the stored time, without a fall (any change to the movement code that moves a human's line shows up here)
const DEMOS: Record<string, number> = { 'aircontrol@256': 53.69921875, 'utopia_v3@128': 65.3515625, 'kitsune@128-s5': 7.1171875, 'cyberwave@256-s1': 33.23046875 }; // <map>@<tick>[-s<stage>]: the run's (or that stage's) time
describe('recorded runs', () => {
  for (const [key, time] of Object.entries(DEMOS)) {
    const [, id, tick, stage] = key.match(/^(.*)@(\d+)(?:-s(\d+))?$/)!, m = mapDefs.find(d => d.id === id)!, file = m.bsp && ['public/maps/', 'public/bsp/'].map(d => d + m.bsp!.url.split('/').pop()).find(existsSync);
    it.skipIf(m.bsp && !file)(`${m.name} at ${tick} tick: the recorded ${stage ? `stage ${stage}` : 'run'} finishes in ${time.toFixed(3)}`, async () => {
      const def = await resolveMap(m, async () => { const b = readFileSync(file!); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); });
      const d: Demo = JSON.parse(readFileSync(`test/runs/${key}.json`, 'utf8')), s = new Session(def, { ...S, tickrate: +tick }), bot = replayDemo(d.ticks);
      s.restore(d.snap);
      let t = -1;
      for (let i = 0; i < d.ticks.length && t < 0; i++) {
        s.step(bot(s.p));
        for (const e of s.events.splice(0)) { expect(e.type, `fell at ${(i / +tick).toFixed(2)}s`).not.toBe('fail'); if ((e.type === 'stage' && !!stage && e.index === +stage - 1) || (e.type === 'finish' && !stage)) t = e.time; }
      }
      expect(t).toBe(time);
    }, 120_000);
  }
});

// the online leaderboard (server/worker.ts) over an in-memory SQLite standing in for D1
describe('leaderboard server', () => {
  const env = () => {
    const db = new DatabaseSync(':memory:');
    db.exec(readFileSync('server/schema.sql', 'utf8'));
    const prepare = (sql: string) => {
      let v: never[] = [];
      const st = { bind: (...a: never[]) => ((v = a), st), first: async () => db.prepare(sql).get(...v) ?? null, all: async () => ({ results: db.prepare(sql).all(...v) }), run: async () => db.prepare(sql).run(...v) };
      return st;
    };
    return { DB: { prepare, batch: async (ss: { run(): Promise<unknown> }[]) => { for (const st of ss) await st.run(); } }, ADMIN_KEY: 'admin' };
  };
  const call = async (e: ReturnType<typeof env>, method: string, path: string, body?: object, headers: Record<string, string> = {}) => {
    const r = await worker.fetch(new Request(`https://board${path}`, { method, headers: { origin: 'http://localhost:5173', 'content-type': 'application/json', ...headers }, body: body && JSON.stringify(body) }), e as never);
    return [r.status, await r.json()] as [number, any];
  };
  it('knows the maps on the board and their fast runs, as the game rates them', () => {
    expect(BOARD_RUNS).toEqual(Object.fromEntries(mapDefs.filter(m => m.difficulty).map(m => [m.id, m.difficulty!.run])));
  });
  it('joins unique names, keeps only faster times, checks keys and times, ranks, and lets the admin delete', async () => {
    const e = env(), [, a] = await call(e, 'POST', '/join', { name: ' Ang ' });
    expect(a.name).toBe('Ang');
    expect((await call(e, 'POST', '/join', { name: 'ang' }))[0]).toBe(409); // names are unique whatever their case
    expect((await call(e, 'POST', '/join', { name: '<b>' }))[0]).toBe(400);
    const up = (time: number, o: object = {}) => call(e, 'POST', '/time', { id: a.id, key: a.key, map: 'mesa', tick: 256, time, splits: [12.5, null], ...o });
    expect(await up(60)).toEqual([200, { time: 60, rank: 1 }]);
    expect(await up(70)).toEqual([200, { time: 60, rank: 1 }]); // slower: the faster one stays
    expect(await up(55)).toEqual([200, { time: 55, rank: 1 }]);
    for (const [o, status] of [[{ key: 'x' }, 403], [{ time: 30 }, 400], [{ map: 'test' }, 400], [{ tick: 64 }, 400], [{ splits: Array(65).fill(1) }, 400]] as const)
      expect((await up(55, o))[0]).toBe(status); // wrong key, under 0.7 x the fast run, not on the board, 64 tick, too many splits
    const [, b] = await call(e, 'POST', '/join', { name: 'Bob' });
    await call(e, 'POST', '/time', { id: b.id, key: b.key, map: 'mesa', tick: 256, time: 50 });
    expect((await call(e, 'GET', '/board?map=mesa&tick=256'))[1].map((r: { name: string; time: number; splits: unknown }) => [r.name, r.time, r.splits])).toEqual([['Bob', 50, []], ['Ang', 55, [12.5, null]]]);
    expect((await call(e, 'GET', `/summary?tick=256&id=${a.id}`))[1]).toEqual({ mesa: { name: 'Bob', time: 50, n: 2, rank: 2 } });
    expect((await call(e, 'GET', '/summary?tick=128'))[1]).toEqual({});
    expect((await call(e, 'POST', '/rename', { id: a.id, key: a.key, name: 'BOB' }))[0]).toBe(409);
    expect(await call(e, 'POST', '/rename', { id: a.id, key: a.key, name: 'Angus' })).toEqual([200, { id: a.id, name: 'Angus' }]);
    expect(await call(e, 'POST', '/me', { id: a.id, key: a.key })).toEqual([200, { id: a.id, name: 'Angus' }]);
    expect((await call(e, 'DELETE', `/player?id=${b.id}`))[0]).toBe(403);
    expect((await call(e, 'DELETE', `/player?id=${b.id}`, undefined, { 'x-admin-key': 'admin' }))[0]).toBe(200);
    expect((await call(e, 'DELETE', `/time?id=${a.id}&map=mesa&tick=256`, undefined, { 'x-admin-key': 'admin' }))[0]).toBe(200);
    expect((await call(e, 'GET', '/board?map=mesa&tick=256'))[1]).toEqual([]);
  });
  it('rate limits joins from one address', async () => {
    const e = env(), codes = [];
    for (let i = 0; i < 11; i++) codes.push((await call(e, 'POST', '/join', { name: `p${i}` }))[0]);
    expect(codes).toEqual([...Array(10).fill(200), 429]);
  });
});
