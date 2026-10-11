import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { trace } from '../src/physics';
import { parseBsp } from '../src/bsp';
import { buildBrush } from '../src/game';
// walls across a corridor: slices where most of the tube's cross-section is solid; print their openings
it('gates', () => {
  const b = readFileSync('public/maps/surf_kitsune.bsp'), bsp = parseBsp(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), w = bsp.brushes.map(buildBrush);
  const Z: [number, number, number] = [0, 0, 0];
  for (const [name, axis, a0, a1, l0, l1, z0, z1] of JSON.parse(process.env.C!) as [string, string, number, number, number, number, number, number][]) {
    const P = (a: number, l: number, z: number): [number, number, number] => (axis === 'y' ? [l, a, z] : [a, l, z]);
    let lastWall = -1e9;
    for (let a = a0; a0 < a1 ? a <= a1 : a >= a1; a += a0 < a1 ? 16 : -16) {
      let solid = 0, n = 0;
      for (let l = l0 + 32; l <= l1 - 32; l += 64) for (let z = z0; z >= z1; z -= 64) { n++; if (trace(w, P(a, l, z), P(a, l, z), Z, Z).startsolid) solid++; }
      if (solid / n < 0.6 || Math.abs(a - lastWall) < 100) continue;
      lastWall = a;
      // openings: free cells, merged into boxes by rows
      const free: string[] = [];
      for (let z = z0; z >= z1; z -= 32) {
        let run: number | null = null; const rs: string[] = [];
        for (let l = l0 + 16; l <= l1 - 16; l += 16) {
          const f = !trace(w, P(a, l, z), P(a, l, z), Z, Z).startsolid;
          if (f && run === null) run = l;
          if (!f && run !== null) { rs.push(`${run}..${l - 16}`); run = null; }
        }
        if (run !== null) rs.push(`${run}..${l1 - 16}`);
        if (rs.length) free.push(`z${z}: ${rs.join(' ')}`);
      }
      const zs = free.map(s => +s.split(':')[0].slice(1));
      console.log(`${name} wall at ${axis}=${a}: open rows z ${zs.length ? `${Math.max(...zs)}..${Math.min(...zs)}` : 'none'}; sample ${free[Math.floor(free.length / 2)] ?? ''}`);
    }
  }
}, 600000);
