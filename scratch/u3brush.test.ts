// utopia_v3: the brushes at points (PTS), with how the importer built them (glass / draw-only / face colours)
import { it } from 'vitest';
import { appendFileSync, readFileSync } from 'node:fs';
import { parseBsp } from '../src/bsp';
import { buildBrush } from '../src/game';
it('brush', () => {
  const b = readFileSync('public/maps/surf_utopia_v3.bsp'), bsp = parseBsp(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  for (const s of process.env.PTS!.split(';')) {
    const q = s.split(',').map(Number);
    bsp.brushes.forEach((d, i) => {
      const br = buildBrush(d);
      if (!q.every((v, k) => v >= br.min[k] - 24 && v <= br.max[k] + 24)) return;
      const cols = [...new Set((d as { faceColors?: (number | null)[] }).faceColors ?? [])].map(c => (c === null ? 'none' : '#' + c.toString(16)));
      appendFileSync(process.env.OUT!, `${s}: #${i} ${br.min.map(Math.round)}..${br.max.map(Math.round)}${br.glass ? ' GLASS' : ''}${br.nonsolid ? ' DRAW-ONLY' : ''} colours ${cols.join(' ')}\n`);
    });
  }
});
