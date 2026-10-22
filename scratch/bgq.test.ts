// Brushes in a region (BSP=path, R=x0,y0,z0,x1,y1,z1): bounds, solidity, drawn, and the upward faces' normals + top z.
import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseBsp } from '../src/bsp';
import { buildBrush } from '../src/game';

it('query', () => {
  const raw = readFileSync(process.env.BSP!), b = parseBsp(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const R = process.env.R!.split(',').map(Number), r = (v: number[]) => v.map(Math.round).join(' '), out: string[] = [];
  for (const d of b.brushes) {
    if (d.type !== 'planes') continue;
    const br = buildBrush(d);
    if ([0, 1, 2].some(k => br.max[k] < R[k] || br.min[k] > R[k + 3])) continue;
    const up = br.faces.filter(f => f.n[2] > 0.05).map(f => `${f.n.map(x => x.toFixed(2)).join(',')}@${Math.round(Math.max(...f.verts.map(v => v[2])))}${f.color === null ? '(inv)' : ''}`);
    const all = process.env.ALL ? ` sides: ${br.planes.filter(p => Math.abs(p.n[2]) < 0.99).map(p => `${p.n.map(x => x.toFixed(2)).join(',')}|${Math.round(p.d)}`).join(' ')}` : '';
    out.push(`${r(br.min)} .. ${r(br.max)}${d.nonsolid ? ' NONSOLID' : ''}${d.glass ? ' glass' : ''}${d.faceColors?.every(c => c === null) ? ' invisible' : ''} up: ${up.join(' ')}${all}`);
  }
  writeFileSync(process.env.OUT ?? 'scratch/bgq.txt', out.join('\n') + '\n');
});
