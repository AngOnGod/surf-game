import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseBsp } from '../src/bsp';
import { buildBrush } from '../src/game';
// solid brushes in a box that are never drawn (every face colour null): invisible walls
it('invisible solids', () => {
  const b = readFileSync(process.env.BSP!), bsp = parseBsp(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const [x0, y0, z0, x1, y1, z1] = process.env.BOX!.split(',').map(Number), out: string[] = [];
  const all = bsp.brushes.map(d => ({ d, br: buildBrush(d) })), visible = all.filter(x => x.d.type === 'planes' && x.d.faceColors?.some(c => c !== null));
  const overlap = (a: { min: number[]; max: number[] }, b: { min: number[]; max: number[] }) => [0, 1, 2].reduce((v, k) => v * Math.max(0, Math.min(a.max[k], b.max[k]) - Math.max(a.min[k], b.min[k])), 1);
  const vol = (a: { min: number[]; max: number[] }) => [0, 1, 2].reduce((v, k) => v * (a.max[k] - a.min[k]), 1);
  bsp.brushes.forEach((d, i) => {
    if (d.type !== 'planes' || d.faceColors?.some(c => c !== null)) return;
    const br = buildBrush(d);
    if (br.max[0] < x0 || br.min[0] > x1 || br.max[1] < y0 || br.min[1] > y1 || br.max[2] < z0 || br.min[2] > z1) return;
    const cover = visible.reduce((m, v) => Math.max(m, overlap(br, v.br) / vol(br)), 0); // how much of it a visible brush shares
    if (process.env.BARE && cover > 0.3) return;
    out.push(`#${i} ${br.min.map(Math.round)} .. ${br.max.map(Math.round)} size ${br.max.map((v, k) => Math.round(v - br.min[k]))} visible-overlap ${cover.toFixed(2)}`);
  });
  writeFileSync(process.env.OUT ?? 'scratch/invis.out', `${out.length} invisible solids\n` + out.join('\n') + '\n');
});
