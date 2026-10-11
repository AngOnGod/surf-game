// utopia_v3: draw-only (glass) brushes and solid brushes drawn nowhere (clip) in the lower map, with their extents
import { it } from 'vitest';
import { appendFileSync, readFileSync } from 'node:fs';
import { parseBsp } from '../src/bsp';
import { buildBrush } from '../src/game';
it('glass and clip', () => {
  const b = readFileSync('public/maps/surf_utopia_v3.bsp'), bsp = parseBsp(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), out = (t: string) => appendFileSync(process.env.OUT!, t + '\n');
  const r = (v: number[]) => v.map(Math.round).join(',');
  for (const d of bsp.brushes) {
    const br = buildBrush(d), drawn = (d as { faceColors?: (number | null)[] }).faceColors?.some(c => c !== null);
    if ((process.env.ALL === '2' ? br.nonsolid && [0, 1, 2].some(k => br.max[k] - br.min[k] > 300) : br.min[2] < 0) && (process.env.ALL ? br.nonsolid : br.max[2] < -500 && br.min[0] > 2000 && (br.nonsolid || !drawn))) out(`${br.nonsolid ? 'draw-only' : 'clip (solid, undrawn)'}${br.glass ? ' glass' : ''} ${r(br.min)} .. ${r(br.max)}`);
  }
});
