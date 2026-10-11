import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import * as F from '../src/fmath';
// accuracy vs the engine (should agree to within an ulp) and speed
it('fmath', () => {
  let seed = 777; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const ulp = (a: number, b: number) => Math.abs(a - b) / (Math.abs(a) * 2 ** -52 || 5e-324);
  const out: string[] = [];
  const cases: [string, () => number[], (...a: number[]) => number, (...a: number[]) => number][] = [
    ['sin', () => [(r() - 0.5) * 20], Math.sin, F.sin], ['cos', () => [(r() - 0.5) * 20], Math.cos, F.cos],
    ['sinBig', () => [(r() - 0.5) * 4000], Math.sin, F.sin], ['asin', () => [r() * 2 - 1], Math.asin, F.asin],
    ['atan2', () => [(r() - 0.5) * 4000, (r() - 0.5) * 4000], Math.atan2, F.atan2], ['atan2y', () => [(r() - 0.5) * 1e-3, (r() - 0.5) * 4000], Math.atan2, F.atan2],
  ];
  for (const [k, gen, a, b] of cases) {
    let bad = 0, worst = 0; const args = [...Array(300000)].map(gen);
    for (const v of args) { const u = a(...v), x = b(...v); if (!Object.is(u, x)) bad++; worst = Math.max(worst, ulp(u, x)); }
    let t = performance.now(); let acc = 0; for (const v of args) acc += a(...v); const ta = performance.now() - t;
    t = performance.now(); for (const v of args) acc += b(...v); const tb = performance.now() - t;
    out.push(`${k}: ${bad} differ, worst ${worst.toFixed(2)} ulp; engine ${ta.toFixed(1)}ms ours ${tb.toFixed(1)}ms ${acc > 1e300 ? '' : ''}`);
  }
  for (const v of [0, -0, 1, -1, Math.PI, -Math.PI / 2]) out.push(`special ${v}: ${F.sin(v)} ${F.cos(v)} ${F.atan2(v, -1)} ${F.atan2(-0, v)} ${F.asin(Math.max(-1, Math.min(1, v)))}`);
  writeFileSync('scratch/fmcheck.out', out.join('\n') + '\n');
});
