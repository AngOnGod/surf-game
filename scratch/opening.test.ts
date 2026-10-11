// map where a hull can cross a wall line: for each (x, z), sweep along +y from Y0 to Y1; '.' clear, '#' blocked
import { it } from 'vitest';
import { appendFileSync, readFileSync } from 'node:fs';
import { HULL_MIN, HULL_STAND, trace, type Vec } from '../src/physics';
import { parseBsp } from '../src/bsp';
import { buildBrush } from '../src/game';
it('opening', () => {
  const b = readFileSync(process.env.BSP!), bsp = parseBsp(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), w = bsp.brushes.map(buildBrush);
  const [x0, x1, xs, z0, z1, zs, y0, y1] = process.env.G!.split(',').map(Number), lines = [`x ${x0}..${x1} step ${xs} (columns), z ${z1} (top) .. ${z0}; sweep y ${y0} -> ${y1}`];
  for (let z = z1; z >= z0; z -= zs) {
    let row = '';
    for (let x = x0; x <= x1; x += xs) { const a: Vec = [x, y0, z], c: Vec = [x, y1, z], t = trace(w, a, c, HULL_MIN, HULL_STAND); row += t.startsolid ? 's' : t.fraction >= 1 ? '.' : '#'; }
    lines.push(`${String(z).padStart(6)} ${row}`);
  }
  appendFileSync(process.env.OUT!, lines.join('\n') + '\n');
});
