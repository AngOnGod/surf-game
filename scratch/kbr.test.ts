import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseBsp } from '../src/bsp';
import { buildBrush } from '../src/game';
it('brushes in a box', () => {
  const b = readFileSync('public/maps/surf_kitsune.bsp'), bsp = parseBsp(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), w = bsp.brushes.map(buildBrush);
  const [x0, y0, z0, x1, y1, z1] = process.env.BOX!.split(',').map(Number);
  w.forEach((br, i) => {
    if (br.max[0] < x0 || br.min[0] > x1 || br.max[1] < y0 || br.min[1] > y1 || br.max[2] < z0 || br.min[2] > z1) return;
    const vis = br.faces.filter(f => f.color !== null).length;
    const slopes = br.faces.filter(f => f.n[2] > 0.05 && f.n[2] < 0.99).map(f => f.n.map(v => v.toFixed(2)).join(','));
    console.log(`#${i} ${br.min.map(Math.round)} .. ${br.max.map(Math.round)} faces ${br.faces.length} visible ${vis} ${slopes.length ? 'sloped ' + slopes.join(' | ') : ''}`);
  });
});
