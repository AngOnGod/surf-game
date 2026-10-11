import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { trace } from '../src/physics';
import { parseBsp } from '../src/bsp';
import { buildBrush } from '../src/game';
// ASCII profile in a vertical plane: '#' solid (point test), 'T' fall teleport, '>' other teleport, ' ' empty
it('profile', () => {
  const b = readFileSync('public/maps/surf_kitsune.bsp'), bsp = parseBsp(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), w = bsp.brushes.map(buildBrush);
  const [a0, a1, da] = process.env.A!.split(',').map(Number), C = +process.env.C!, [z0, z1, dz] = process.env.Z!.split(',').map(Number), ax = process.env.AXIS ?? 'y';
  const P = (a: number, z: number): [number, number, number] => (ax === 'y' ? [C, a, z] : [a, C, z]);
  const big = (f: { min: number[]; max: number[] }) => Math.max(f.max[0] - f.min[0], f.max[1] - f.min[1]) >= 900;
  const lines: string[] = [];
  for (let z = z0; z >= z1; z -= dz) {
    let s = '';
    for (let a = a0; a <= a1; a += da) {
      const p = P(a, z), z0p: [number, number, number] = [0, 0, 0];
      if (trace(w, p, p, z0p, z0p).startsolid) { s += '#'; continue; }
      const inShape = (f: (typeof bsp.fails)[number]) => !f.shape || f.shape.some(br => br.every(([nx, ny, nz, d]) => nx * p[0] + ny * p[1] + nz * p[2] <= d));
      const f = bsp.fails.find(f => p.every((v, k) => v >= f.min[k] && v <= f.max[k]) && inShape(f));
      s += f ? (big(f) ? 'T' : '>') : ' ';
    }
    lines.push(`${String(z).padStart(7)} |${s}|`);
  }
  console.log(`${ax} ${a0}..${a1} step ${da} at ${ax === 'y' ? 'x' : 'y'}=${C}\n` + lines.join('\n'));
});
