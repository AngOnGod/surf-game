// the old route-following autopilot's state at a moment (AT ticks, or AFTER x: AT ticks after passing x = AFTERX), saved
// like beam.test.ts snapshots (moves: none; botTicks: how many ticks the old bot drove) to OUT
import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { DEFAULTS, hlen } from '../src/physics';
import { Session } from '../src/game';
import { resolveMap } from '../src/bsp';
import { makeBot } from '../src/bot';
import m from '../src/maps/utopia_v3';
it('bot snapshot', async () => {
  const b = readFileSync('public/maps/surf_utopia_v3.bsp'), def = await resolveMap(m, async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const tick = +(process.env.TICK ?? 128), s = new Session(def, { ...DEFAULTS, tickrate: tick }), bot = makeBot(def.route!, s.world, s.s, undefined, true, {});
  const ax = +(process.env.AFTERX ?? 1e9), after = +(process.env.AT ?? 0);
  let i = 0, passed = -1;
  for (; i < tick * 120; i++) { s.step(bot(s.p)); s.events.length = 0; if (passed < 0 && s.p.origin[0] > ax && s.p.origin[2] < -1000) passed = i; if (passed >= 0 && i - passed >= after) break; }
  const sx = s as unknown as { inPush: boolean[] }, snap = structuredClone({ p: s.p, run: s.run, stage: s.stage, section: s.section, trail: s.trail, name: s.name, inPush: sx.inPush });
  writeFileSync(process.env.OUT!, JSON.stringify({ snap, moves: [], botTicks: i + 1, j: 0, prog: 0 }));
  writeFileSync(process.env.OUT + '.txt', `ticks ${i + 1} (${((i + 1) / tick).toFixed(3)} s): at ${s.p.origin.map(Math.round)} v ${s.p.vel.map(Math.round)} |v| ${Math.round(hlen(s.p.vel))} E ${Math.round(s.p.origin[2] + (s.p.vel[0] ** 2 + s.p.vel[1] ** 2 + s.p.vel[2] ** 2) / 1600)} run ${s.run.state} ${s.run.time.toFixed(2)}\n`);
}, 600000);
