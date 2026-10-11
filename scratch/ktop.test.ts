import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { HULL_MIN, HULL_STAND, trace } from '../src/physics';
import { parseBsp } from '../src/bsp';
import { buildBrush } from '../src/game';
// top-down map: each cell shows the first surface below ztop: surf faces as an arrow of their downhill direction, floors '_', none '.'
it('top', () => {
  const b = readFileSync('public/maps/surf_kitsune.bsp'), bsp = parseBsp(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), w = bsp.brushes.map(buildBrush);
  const [x0, x1, y0, y1, step] = process.env.R!.split(',').map(Number), [ztop, zbot] = process.env.Z!.split(',').map(Number);
  const arrows = ['→', '↗', '↑', '↖', '←', '↙', '↓', '↘'];
  const rows: string[] = [];
  for (let y = y1; y >= y0; y -= step) {
    let row = '', zs = '';
    for (let x = x0; x <= x1; x += step) {
      let z = ztop, cell = '.';
      for (let k = 0; k < 6 && z > zbot; k++) { // look through stacked surfaces for the highest surf face
        while (z > zbot && trace(w, [x, y, z], [x, y, z], HULL_MIN, HULL_STAND).startsolid) z -= 32;
        const t = trace(w, [x, y, z], [x, y, zbot], HULL_MIN, HULL_STAND), n = t.normal;
        if (t.fraction >= 1) break;
        if (n[2] > 0.05 && n[2] < 0.7) { cell = arrows[(Math.round(Math.atan2(n[1], n[0]) / (Math.PI / 4)) + 8) % 8]; break; }
        if (cell === '.') cell = n[2] >= 0.7 ? '_' : '#';
        z = t.end[2] - 8;
      }
      row += cell;
    }
    rows.push(`${String(y).padStart(7)} ${row}`);
  }
  console.log(`x: ${x0}..${x1} step ${step} (arrow = downhill direction of the face)\n` + rows.join('\n'));
});
