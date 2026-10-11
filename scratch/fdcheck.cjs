const f = require('./fdlibm.cjs');
let seed = 777; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const cases = {
  sin: [() => [(r() - 0.5) * 20], x => Math.sin(x), x => f.sin(x)],
  cos: [() => [(r() - 0.5) * 20], x => Math.cos(x), x => f.cos(x)],
  sinBig: [() => [(r() - 0.5) * 2000], x => Math.sin(x), x => f.sin(x)],
  asin: [() => [r() * 2 - 1], x => Math.asin(x), x => f.asin(x)],
  asinSmall: [() => [(r() - 0.5) * 0.01], x => Math.asin(x), x => f.asin(x)],
  atan2: [() => [(r() - 0.5) * 4000, (r() - 0.5) * 4000], (y, x) => Math.atan2(y, x), (y, x) => f.atan2(y, x)],
  atan2small: [() => [(r() - 0.5) * 1e-3, (r() - 0.5) * 4000], (y, x) => Math.atan2(y, x), (y, x) => f.atan2(y, x)],
};
for (const [k, [gen, a, b]] of Object.entries(cases)) {
  let bad = 0, ex = null;
  for (let i = 0; i < 300000; i++) { const args = gen(); const u = a(...args), v = b(...args); if (!Object.is(u, v)) { bad++; ex ??= [args, u, v]; } }
  console.log(k, bad, ex ? JSON.stringify(ex) : '');
}
