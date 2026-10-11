import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { trace } from '../src/physics';
import { parseBsp } from '../src/bsp';
import { buildBrush } from '../src/game';
// vertical profile along an arbitrary segment A->B: '#' solid, 'T' teleport volume, ' ' empty
it('diag', () => {
  const b = readFileSync('public/bsp/surf_aircontrol_ksf.bsp'), bsp = parseBsp(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), w = bsp.brushes.map(buildBrush);
  const [ax, ay, bx, by] = process.env.SEG!.split(',').map(Number), [z0, z1, dz] = process.env.Z!.split(',').map(Number), n = +(process.env.N ?? 80), o: [number, number, number] = [0, 0, 0];
  const inShape = (f: (typeof bsp.fails)[number], p: number[]) => p.every((v, k) => v >= f.min[k] && v <= f.max[k]) && (!f.shape || f.shape.some(br => br.every(([nx, ny, nz, d]) => nx * p[0] + ny * p[1] + nz * p[2] <= d)));
  const lines = [`${ax},${ay} -> ${bx},${by} in ${n} steps`];
  for (let z = z0; z >= z1; z -= dz) {
    let s = '';
    for (let i = 0; i <= n; i++) { const p: [number, number, number] = [ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n, z]; s += trace(w, p, p, o, o).startsolid ? '#' : bsp.fails.some(f => inShape(f, p)) ? 'T' : ' '; }
    lines.push(`${String(z).padStart(7)} |${s}|`);
  }
  writeFileSync(process.env.OUT ?? 'scratch/acdiag.out', lines.join('\n') + '\n');
});
