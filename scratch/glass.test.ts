import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseBsp } from '../src/bsp';
import { buildBrush } from '../src/game';
// glass (window) brushes: where they are and whether they get drawn
it('glass', () => {
  const b = readFileSync(process.env.BSP!), bsp = parseBsp(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), out: string[] = [];
  bsp.brushes.forEach(d => {
    if (d.type !== 'planes' || !d.glass) return;
    const br = buildBrush(d), drawn = d.faceColors!.filter(c => c !== null).length;
    out.push(`${br.min.map(Math.round)} .. ${br.max.map(Math.round)} drawn faces ${drawn}/${d.faceColors!.length} colors ${[...new Set(d.faceColors!.filter(c => c !== null))].map(c => c!.toString(16))}`);
  });
  writeFileSync(process.env.OUT!, `${out.length} glass brushes\n` + out.sort().join('\n') + '\n');
});
