// utopia_v3: riding-line probe for guide points past the booster (G: x,y,z;... in travel order), at a few heights
import { it } from 'vitest';
import { appendFileSync, readFileSync } from 'node:fs';
import { ridingLine } from '../src/game';
import { resolveMap } from '../src/bsp';
import m from '../src/maps/utopia_v3';
it('line', async () => {
  const b = readFileSync('public/maps/surf_utopia_v3.bsp'), def = await resolveMap(m, async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const g = process.env.G!.split(';').map(s => s.split(',').map(Number));
  for (const h of [0.2, 0.5, 0.8]) {
    const line = ridingLine(def.world!, g.map(p => [...p, h]));
    appendFileSync(process.env.OUT!, `h ${h}: ${line.map((p, i) => (p.every((v, k) => v === g[i][k]) ? 'none' : p.map(Math.round).join(','))).join('  ')}\n`);
  }
});
