// utopia_v3: raw keyvalues of entities of a class (CLS) whose bounds or origin are near a point (NEAR x,y,z; within R)
import { it } from 'vitest';
import { appendFileSync, readFileSync } from 'node:fs';
import { parseBsp } from '../src/bsp';
it('ents', () => {
  const b = readFileSync('public/maps/surf_utopia_v3.bsp'), bsp = parseBsp(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const cls = new RegExp(process.env.CLS ?? '.'), n = (process.env.NEAR ?? '').split(',').map(Number), R = +(process.env.R ?? 1e9);
  for (const e of bsp.entities) {
    if (!cls.test(e.classname)) continue;
    const o = (e.origin ?? '0 0 0').split(' ').map(Number);
    if (n.length === 3 && Math.hypot(o[0] - n[0], o[1] - n[1], o[2] - n[2]) > R) continue;
    appendFileSync(process.env.OUT!, JSON.stringify(e).replace(/\\u001b/g, ',') + '\n');
  }
});
