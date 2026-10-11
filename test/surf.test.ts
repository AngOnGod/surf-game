import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  type Cmd, type Vec, DEFAULTS, HULL_MIN, HULL_STAND, NO_CMD, accelerate, airAccelerate, categorizePosition, clipVelocity,
  ctx, dot, friction, hlen, len, newPlayer, playerMove, trace,
} from '../src/physics';
import { type MapDef, type Spawn, Session, buildBrush } from '../src/game';
import { makeBot } from '../src/bot';
import * as F from '../src/fmath';
import { parseBsp, resolveMap } from '../src/bsp';
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

describe('maps', () => {
  it.each(mapDefs.map(m => [m.id, m] as const))('%s builds and spawns in free space', (_, def) => {
    const s = new Session(def, S);
    for (const b of s.world) expect(b.faces.length).toBeGreaterThanOrEqual(4);
    const o = s.p.origin;
    expect(trace(s.world, o, o, HULL_MIN, HULL_STAND).startsolid).toBe(false);
    for (const st of def.stages ?? []) expect(trace(s.world, st.spawn.pos, st.spawn.pos, HULL_MIN, HULL_STAND).startsolid).toBe(false);
    for (const cp of def.checkpoints ?? []) if (cp.spawn) expect(trace(s.world, cp.spawn.pos, cp.spawn.pos, HULL_MIN, HULL_STAND).startsolid).toBe(false);
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
