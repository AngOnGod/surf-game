import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseBsp } from '../src/bsp';
import { buildBrush } from '../src/game';
import { makeBrush } from '../src/physics';
// whole-map projections from brush bounds: '#' solid, 'T' teleport/kill trigger, '+' both (counts of brushes per cell)
it('projections', () => {
  const b = readFileSync(process.env.BSP!), bsp = parseBsp(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), w = bsp.brushes.map(buildBrush);
  const D = +(process.env.D ?? 512), out: string[] = [], lo = bsp.bounds.min, hi = bsp.bounds.max;
  const views: [string, number, number, number?, number?][] = process.env.BANDS
    ? process.env.BANDS.split(';').map(bd => { const [z0, z1] = bd.split(',').map(Number); return [`top, z ${z0}..${z1}`, 0, 1, z0, z1]; })
    : [['top (x right, y up)', 0, 1], ['side (y right, z up)', 1, 2], ['front (x right, z up)', 0, 2]];
  for (const [name, a, c, zb0, zb1] of views) {
    const inBand = (min: number[], max: number[]) => zb0 === undefined || (max[2] >= zb0 && min[2] <= zb1!);
    const na = Math.ceil((hi[a] - lo[a]) / D), nc = Math.ceil((hi[c] - lo[c]) / D), solid = new Uint16Array(na * nc), trig = new Uint16Array(na * nc);
    const mark = (min: number[], max: number[], arr: Uint16Array) => {
      for (let i = Math.max(0, Math.floor((min[a] - lo[a]) / D)); i <= Math.min(na - 1, Math.floor((max[a] - lo[a]) / D)); i++)
        for (let j = Math.max(0, Math.floor((min[c] - lo[c]) / D)); j <= Math.min(nc - 1, Math.floor((max[c] - lo[c]) / D)); j++) arr[j * na + i]++;
    };
    for (const br of w) if (br.max[0] - br.min[0] < 8000 && br.max[1] - br.min[1] < 8000 && br.max[2] - br.min[2] < 8000 && inBand(br.min, br.max)) mark(br.min, br.max, solid); // skip the skybox shell
    for (const f of bsp.fails) for (const sh of f.shape ?? []) { const br = makeBrush(sh.map(([x, y, z, d]) => ({ n: [x, y, z] as [number, number, number], d }))); if (inBand(br.min, br.max)) mark(br.min, br.max, trig); } // each convex piece's exact bounds
    out.push(`${name}: ${lo[a]}..${hi[a]} x ${lo[c]}..${hi[c]}, ${D}/char`);
    for (let j = nc - 1; j >= 0; j--) {
      let s = '';
      for (let i = 0; i < na; i++) { const S = solid[j * na + i], T = trig[j * na + i]; s += S && T ? '+' : T ? 'T' : S ? (S > 3 ? '#' : ':') : ' '; }
      out.push(`${String(Math.round(lo[c] + j * D)).padStart(7)} |${s}|`);
    }
  }
  writeFileSync(process.env.OUT ?? 'scratch/proj.out', out.join('\n') + '\n');
});
