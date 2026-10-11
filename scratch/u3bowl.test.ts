// utopia_v3 after the booster: the first surface below z = 0 on a grid (height, and its normal's z), to see the bowl
import { it } from 'vitest';
import { appendFileSync, readFileSync } from 'node:fs';
import { HULL_MIN, HULL_STAND, trace } from '../src/physics';
import { parseBsp } from '../src/bsp';
import { buildBrush } from '../src/game';
it('bowl', () => {
  const b = readFileSync('public/maps/surf_utopia_v3.bsp'), bsp = parseBsp(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), w = bsp.brushes.map(buildBrush);
  const Z0 = +(process.env.Z0 ?? 0), out = (t: string) => appendFileSync(process.env.OUT!, t + '\n');
  out(`first surface below z=${Z0}: height/100 and (normal z * 10); '.' = nothing above -9000; x rows, y columns -6000..6000 step 500`);
  for (let x = 1000; x <= 15000; x += 1000) {
    const row: string[] = [];
    for (let y = -6000; y <= 6000; y += 500) {
      const t = trace(w, [x, y, Z0], [x, y, -9000], HULL_MIN, HULL_STAND);
      row.push(t.startsolid ? '  ####' : t.fraction >= 1 ? '     .' : `${String(Math.round(t.end[2] / 100)).padStart(4)}/${Math.round(t.normal[2] * 10)}`);
    }
    out(`x ${String(x).padStart(5)}: ${row.join('')}`);
  }
});
