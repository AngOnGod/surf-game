// Replays a recording (DEMO=) with solid rock up to the tick before T= seconds, then reports the rock triangles near
// the player: which overlap its box at the free run's next position, and how they face.
import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { type MapDef, Session } from '../src/game';
import { DEFAULTS, HULL_MIN, type Vec, hullMax, makeTris, trace } from '../src/physics';
import { resolveMap } from '../src/bsp';
import { type Demo, replayDemo } from '../src/plan';
const maps = Object.values(import.meta.glob<{ default: MapDef }>('../src/maps/*.ts', { eager: true })).map(m => m.default);
const read = async (u: string) => { const b = readFileSync('public/' + u); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
it('rock probe', async () => {
  const d = JSON.parse(readFileSync(process.env.DEMO!, 'utf8')) as Demo & { map: string; tickrate: number; settings: object };
  const def = await resolveMap(maps.find(m => m.id === d.map)!, read), set = { ...DEFAULTS, ...d.settings, tickrate: d.tickrate };
  const s = new Session(def, set), bot = replayDemo(d.ticks), N = Math.round(+process.env.T! * d.tickrate) - 1, out: string[] = [];
  s.restore(d.snap);
  for (let i = 0; i < N; i++) { s.step(bot(s.p)); s.events.length = 0; }
  const p = s.p, T = def.tris!, hi = hullMax(p);
  out.push(`at ${p.origin.map(v => v.toFixed(2))} vel ${p.vel.map(v => v.toFixed(1))} onGround ${p.onGround}`);
  const next = bot(s.p); // the tick that parts
  const before = [...p.origin] as Vec;
  s.step(next);
  out.push(`after: ${p.origin.map(v => v.toFixed(2))} vel ${p.vel.map(v => v.toFixed(1))} lastNormal ${p.lastNormal.map(v => v.toFixed(3))}`);
  // each triangle near: overlap at rest at `before` + vel*dt, and sweep results
  const dt = 1 / d.tickrate, end: Vec = [before[0] + 2054 * dt, before[1], before[2]];
  for (let t = 0; t < T.pl.length / 4; t++) {
    const v = T.v.subarray(t * 9, t * 9 + 9), c = [0, 1, 2].map(k => (v[k] + v[k + 3] + v[k + 6]) / 3);
    if (Math.hypot(c[0] - before[0], c[1] - before[1], c[2] - before[2] - 36) > 260) continue;
    const one = Object.assign([], { tris: makeTris(Float64Array.from(v)) });
    const rest = trace(one, before, before, HULL_MIN, hi).startsolid, sw = trace(one, before, end, HULL_MIN, hi);
    out.push(`tri ${t} centre ${c.map(Math.round)} n ${[...T.pl.subarray(t * 4, t * 4 + 3)].map(x => x.toFixed(2))} overlapsNow ${rest} sweep+x ${sw.fraction.toFixed(3)} verts ${[...v].map(Math.round)}`);
  }
  writeFileSync('scratch/rockprobe.out', out.join('\n') + '\n');
}, 600000);
