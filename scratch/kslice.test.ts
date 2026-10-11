import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { HULL_MIN, HULL_STAND, trace } from '../src/physics';
import { parseBsp } from '../src/bsp';
import { buildBrush } from '../src/game';
// vertical slice: along AXIS at fixed C, the solid bands (for the player hull) from z0 down to z1
it('slice', () => {
  const b = readFileSync('public/maps/surf_kitsune.bsp'), bsp = parseBsp(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), w = bsp.brushes.map(buildBrush);
  const [a0, a1, da] = process.env.A!.split(',').map(Number), C = +process.env.C!, [z0, z1] = process.env.Z!.split(',').map(Number), ax = process.env.AXIS ?? 'y';
  const solid = (a: number, z: number) => trace(w, ax === 'y' ? [C, a, z] : [a, C, z], ax === 'y' ? [C, a, z] : [a, C, z], HULL_MIN, HULL_STAND).startsolid;
  for (let a = a0; da > 0 ? a <= a1 : a >= a1; a += da) {
    const bands: string[] = []; let z = z0, inS = solid(a, z), top = z;
    for (; z > z1; z -= 16) { const s = solid(a, z); if (s !== inS) { if (s) top = z + 16; else bands.push(`${top}..${z + 16}`); inS = s; } }
    if (inS) bands.push(`${top}..<${z1}`);
    console.log(`${ax}=${a}`.padEnd(10), bands.join('  '));
  }
});
