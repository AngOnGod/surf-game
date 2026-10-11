// utopia_v3: search the 3 s after the booster for move sequences that get over the kicker and out through the low
// opening in the corridor's north wall (x 4650-5600, z <= -1425) with the most energy (z + v²/2g). From START (a
// snapshot, e.g. the old bot's just past the booster); random run-length sequences, then hill-climbing on the best.
import { it } from 'vitest';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { DEFAULTS, type Vec } from '../src/physics';
import { Session } from '../src/game';
import { resolveMap } from '../src/bsp';
import { BLOCK, move } from '../src/plan';
import m from '../src/maps/utopia_v3';
it('launch', async () => {
  const b = readFileSync('public/maps/surf_utopia_v3.bsp'), def = await resolveMap(m, async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const s = new Session(def, { ...DEFAULTS }), per = 128 / BLOCK, sx = s as unknown as { inPush: boolean[] }, g = 800;
  const start = JSON.parse(readFileSync(process.env.START!, 'utf8'));
  const restore = () => { const c = structuredClone(start.snap); Object.assign(s, { p: c.p, run: c.run, stage: c.stage, section: c.section, trail: c.trail, name: c.name }); sx.inPush = c.inPush; s.events.length = 0; };
  const N = 56, E = (p: typeof s.p) => p.origin[2] + (p.vel[0] ** 2 + p.vel[1] ** 2 + p.vel[2] ** 2) / (2 * g);
  const goal: Vec = [5450, 1800, -1500];
  const evaluate = (ms: number[]) => { // score: energy once out through the opening (+1e5), else closeness to it
    restore();
    let best = -1e9;
    for (let k = 0; k < N; k++) for (let i = 0; i < per; i++) {
      s.step(move(s.p, ms[k]));
      if (s.events.some(e => e.type === 'fail')) return { score: best - 5e4, out: null };
      s.events.length = 0;
      const o = s.p.origin;
      if (o[1] >= 1780 && o[0] >= 4650 && o[0] <= 6400 && o[2] >= -2900 && o[2] <= -1425) return { score: 1e5 + E(s.p), out: { at: k * per + i, o: [...o], v: [...s.p.vel], E: E(s.p), snap: structuredClone({ p: s.p, run: s.run, stage: s.stage, section: s.section, trail: s.trail, name: s.name, inPush: sx.inPush }) } };
      best = Math.max(best, -Math.hypot(o[0] - goal[0], o[1] - goal[1], o[2] - goal[2]) + E(s.p) * 0.2);
    }
    return { score: best, out: null };
  };
  let seed = +(process.env.SEED ?? 7); const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const VOCAB = [0, 1, 2, 3, 4, 5, 6, 7, 10, 11]; // coast, straight, turns (full, gentle, sharp), forward, brake
  const random = () => { const ms: number[] = []; while (ms.length < N) { const mv = VOCAB[Math.floor(rnd() * VOCAB.length)], n = 1 + Math.floor(rnd() * 8); for (let i = 0; i < n; i++) ms.push(mv); } return ms.slice(0, N); };
  let best = { ms: random(), r: { score: -Infinity, out: null as null | { at: number; o: number[]; v: number[]; E: number; snap: unknown } } };
  const t0 = Date.now(), R = +(process.env.RANDOM ?? 3000), H = +(process.env.CLIMB ?? 6000);
  for (let i = 0; i < R; i++) { const ms = random(), r = evaluate(ms); if (r.score > best.r.score) best = { ms, r }; }
  appendFileSync(process.env.OUT!, `random ${R}: best ${best.r.score.toFixed(0)} ${best.r.out ? `out at ${best.r.out.o.map(Math.round)} E ${best.r.out.E.toFixed(0)}` : 'not out'} (${((Date.now() - t0) / 1000).toFixed(0)}s)\n`);
  for (let i = 0; i < H; i++) {
    const ms = [...best.ms], n = 1 + Math.floor(rnd() * 3);
    for (let j = 0; j < n; j++) { const at = Math.floor(rnd() * N), len = 1 + Math.floor(rnd() * 4), mv = VOCAB[Math.floor(rnd() * VOCAB.length)]; for (let k = at; k < Math.min(N, at + len); k++) ms[k] = mv; }
    const r = evaluate(ms);
    if (r.score > best.r.score) { best = { ms, r }; if (r.out) appendFileSync(process.env.OUT!, `  climb ${i}: out at ${r.out.o.map(Math.round)} v ${r.out.v.map(Math.round)} E ${r.out.E.toFixed(0)}\n`); }
  }
  appendFileSync(process.env.OUT!, `final ${best.r.score.toFixed(0)} ${best.r.out ? `E ${best.r.out.E.toFixed(0)} at ${best.r.out.o.map(Math.round)}` : 'not out'}; moves ${best.ms.join('')} (${((Date.now() - t0) / 1000).toFixed(0)}s)\n`);
  if (best.r.out) writeFileSync(process.env.SAVE!, JSON.stringify({ snap: best.r.out.snap, moves: [...(start.moves ?? []), ...best.ms.slice(0, Math.ceil((best.r.out.at + 1) / per))], botTicks: start.botTicks, j: 0, prog: 0 }));
}, 3600000);
