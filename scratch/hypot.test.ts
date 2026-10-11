// fmath.hypot2/3 must match V8's Math.hypot bit for bit (node runs V8, like Chrome)
import { it, expect } from 'vitest';
import { hypot2, hypot3 } from '../src/fmath';
it('hypot matches V8', () => {
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const val = () => { const r = rnd(); const m = r < 0.1 ? 0 : r < 0.2 ? rnd() * 1e-3 : r < 0.6 ? (rnd() - 0.5) * 4000 : r < 0.9 ? (rnd() - 0.5) * 1e5 : (rnd() - 0.5) * 1e300; return rnd() < 0.05 ? Math.round(m) : m; };
  let bad = 0;
  for (let i = 0; i < 4e6; i++) {
    const x = val(), y = val(), z = val();
    if (!Object.is(hypot2(x, y), Math.hypot(x, y))) bad++;
    if (!Object.is(hypot3(x, y, z), Math.hypot(x, y, z))) bad++;
  }
  for (const [x, y] of [[0, 0], [-0, 0], [Infinity, NaN], [NaN, 1], [3, 4], [1e-320, 1e-320], [1e308, 1e308]]) { if (!Object.is(hypot2(x, y), Math.hypot(x, y))) bad++; if (!Object.is(hypot3(x, y, x), Math.hypot(x, y, x))) bad++; }
  expect(bad).toBe(0);
});
