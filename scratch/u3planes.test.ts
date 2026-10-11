// utopia_v3: planes of the undrawn solid brushes whose bounds contain a point (PTS: x,y,z;...), to see which way they face
import { it } from 'vitest';
import { appendFileSync, readFileSync } from 'node:fs';
import { parseBsp } from '../src/bsp';
import { buildBrush } from '../src/game';
it('planes', () => {
  const b = readFileSync('public/maps/surf_utopia_v3.bsp'), bsp = parseBsp(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  for (const s of process.env.PTS!.split(';')) {
    const q = s.split(',').map(Number);
    for (const d of bsp.brushes) {
      const br = buildBrush(d);
      if (!q.every((v, k) => v >= br.min[k] - 1 && v <= br.max[k] + 1)) continue;
      const slanted = br.faces.filter(f => Math.abs(f.n[2]) > 0.05 && Math.abs(f.n[2]) < 0.95).map(f => `n(${f.n.map(x => x.toFixed(2))}) at ${f.verts[0].map(Math.round)}`);
      appendFileSync(process.env.OUT!, `${s}: brush ${br.min.map(Math.round)}..${br.max.map(Math.round)}${br.nonsolid ? ' (draw-only)' : ''} slanted faces: ${slanted.join('; ') || 'none'}\n`);
    }
  }
});
