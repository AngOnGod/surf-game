// Stretches of a recording (DEMO=) that pass through displacement rock: the run replayed without rock collision, each
// tick's box tested against the rock at rest (overlapping its surface) and swept (through a face from the front).
import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { type MapDef, Session } from '../src/game';
import { DEFAULTS, HULL_MIN, type Vec, hullMax, trace } from '../src/physics';
import { resolveMap } from '../src/bsp';
import { type Demo, replayDemo } from '../src/plan';
const maps = Object.values(import.meta.glob<{ default: MapDef }>('../src/maps/*.ts', { eager: true })).map(m => m.default);
const read = async (u: string) => { const b = readFileSync('public/' + u); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
it('rock spans', async () => {
  const d = JSON.parse(readFileSync(process.env.DEMO!, 'utf8')) as Demo & { map: string; tickrate: number; settings: object };
  const def = await resolveMap(maps.find(m => m.id === d.map)!, read), set = { ...DEFAULTS, ...d.settings, tickrate: d.tickrate };
  const s = new Session({ ...def, tris: undefined, world: undefined }, set), bot = replayDemo(d.ticks), rock = Object.assign([], { tris: def.tris });
  s.restore(d.snap);
  const spans: { a: number; b: number; at: Vec; z: number[]; front: number }[] = [];
  for (let i = 0; i < d.ticks.length && s.run.state !== 'done'; i++) {
    const o = [...s.p.origin] as Vec;
    s.step(bot(s.p)); s.events.length = 0;
    const p = s.p.origin, hi = hullMax(s.p), rest = trace(rock, p, p, HULL_MIN, hi).startsolid, sw = trace(rock, o, p, HULL_MIN, hi).fraction < 1;
    if (!rest && !sw) continue;
    const t = (i + 1) / d.tickrate, last = spans.at(-1);
    if (last && t - last.b < 0.1) { last.b = t; last.front += +sw; } else spans.push({ a: t, b: t, at: [...p] as Vec, z: [], front: +sw });
  }
  writeFileSync('scratch/rockspans.out', spans.map(r => `${r.a.toFixed(2)}-${r.b.toFixed(2)} s from ${r.at.map(Math.round)} (${r.front} ticks through a face from the front)`).join('\n') + `\n${spans.length} stretches\n`);
}, 600000);
