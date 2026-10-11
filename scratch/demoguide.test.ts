// Guide points from a recorded run (DEMO=file; FROM=seconds to start at, TOL=units): the line the player took,
// simplified (Douglas-Peucker; keys forced where a ride becomes a flight or back), as map stations to paste into
// src/maps: one station per ride or flight, every key an exact point (h -1). The route bot and the planner then learn
// the line by finding their own inputs along it. Writes DEMO.guide.txt.
import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { type MapDef, Session } from '../src/game';
import { DEFAULTS, type Vec } from '../src/physics';
import { resolveMap } from '../src/bsp';
import { type Demo, replayDemo } from '../src/plan';

const maps = Object.values(import.meta.glob<{ default: MapDef }>('../src/maps/*.ts', { eager: true })).map(m => m.default);
const read = async (u: string) => { const b = readFileSync('public/' + u); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const dist = (p: Vec, a: Vec, b: Vec) => { // point to segment ab
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / l2));
  return Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t, p[2] - a[2] - ab[2] * t);
};
const simplify = (pts: Vec[], tol: number): Vec[] => {
  if (pts.length < 3) return pts;
  let k = 0, worst = 0;
  for (let i = 1; i + 1 < pts.length; i++) { const d = dist(pts[i], pts[0], pts.at(-1)!); if (d > worst) { worst = d; k = i; } }
  return worst > tol ? [...simplify(pts.slice(0, k + 1), tol).slice(0, -1), ...simplify(pts.slice(k), tol)] : [pts[0], pts.at(-1)!];
};

it('guide from a recording', async () => {
  const path = process.env.DEMO!, d = JSON.parse(readFileSync(path, 'utf8')) as Demo & { map: string; tickrate: number; settings: object };
  const from = +(process.env.FROM ?? 0), tol = +(process.env.TOL ?? 48);
  const def = await resolveMap(maps.find(m => m.id === d.map)!, read), s = new Session(def, { ...DEFAULTS, ...d.settings, tickrate: d.tickrate }), bot = replayDemo(d.ticks);
  s.restore(d.snap);
  const pts: { o: Vec; ride: boolean; t: number }[] = [];
  for (let i = 0; i < d.ticks.length && s.run.state !== 'done'; i++) {
    s.step(bot(s.p)); s.events.length = 0;
    const p = s.p, n = p.lastNormal, t = (i + 1) / d.tickrate;
    if (t >= from) pts.push({ o: [...p.origin], ride: p.onGround || (p.tick - p.touchTick <= 1 && n[2] > 0 && n[2] < 0.7), t });
  }
  // phases: runs of riding / flying, with blips (a few ticks off a face, a touch in the air) folded into their neighbours
  let ph = pts.map(p => p.ride);
  for (const [want, min] of [[true, 8], [false, 4]] as const) for (let i = 0; i < ph.length;) {
    let j = i; while (j < ph.length && ph[j] === ph[i]) j++;
    if (ph[i] !== want && j - i < min && i > 0) ph.fill(want, i, j);
    i = j;
  }
  const out: string[] = [];
  for (let i = 0; i < pts.length;) {
    let j = i; while (j < pts.length && ph[j] === ph[i]) j++;
    const keys = simplify(pts.slice(i, j).map(p => p.o), tol).map(k => `[${k.map(v => Math.round(v)).join(', ')}]`);
    if (keys.length >= 2) out.push(`  { g: line(${keys.join(', ')}), h: [-1, -1] }, // ${ph[i] ? 'ride' : 'fly'} ${pts[i].t.toFixed(1)}-${pts[j - 1].t.toFixed(1)} s`);
    i = j;
  }
  writeFileSync(path + '.guide.txt', out.join('\n') + '\n');
  console.log(`${pts.length} ticks from ${from} s -> ${out.length} stations, ${out.join('').split('[').length - 1} keys\n` + out.join('\n'));
}, 600_000);
