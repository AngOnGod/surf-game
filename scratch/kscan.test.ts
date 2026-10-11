import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { HULL_MIN, HULL_STAND, trace } from '../src/physics';
import { parseBsp } from '../src/bsp';
import { buildBrush } from '../src/game';
// cross-sections of a corridor running along +y (or AXIS=x): runs of surf samples (0.05 < n.z < 0.7) per slice
it('scan', () => {
  const b = readFileSync('public/maps/surf_kitsune.bsp'), bsp = parseBsp(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), w = bsp.brushes.map(buildBrush);
  const [a0, a1, da] = process.env.A!.split(',').map(Number), [l0, l1] = process.env.L!.split(',').map(Number), [ztop, zbot] = process.env.Z!.split(',').map(Number), ax = process.env.AXIS ?? 'y';
  for (let a = a0; da > 0 ? a <= a1 : a >= a1; a += da) {
    const runs: string[] = []; let cur: { l0: number; l1: number; z0: number; z1: number; n: number[] } | null = null;
    const flush = () => { if (cur) runs.push(`[${cur.l0}..${cur.l1} z${Math.round(cur.z0)}..${Math.round(cur.z1)} n${cur.n.map(v => v.toFixed(2)).join(',')}]`); cur = null; };
    for (let l = l0; l <= l1; l += 32) {
      const p: [number, number, number] = ax === 'y' ? [l, a, ztop] : [a, l, ztop];
      let z = ztop; while (z > zbot && trace(w, [p[0], p[1], z], [p[0], p[1], z], HULL_MIN, HULL_STAND).startsolid) z -= 64;
      const t = trace(w, [p[0], p[1], z], [p[0], p[1], zbot], HULL_MIN, HULL_STAND), n = t.normal;
      const surf = t.fraction < 1 && n[2] > 0.05 && n[2] < 0.7;
      if (surf && cur && Math.abs(n[0] - cur.n[0]) + Math.abs(n[1] - cur.n[1]) < 0.15) { cur.l1 = l; cur.z1 = t.end[2]; }
      else { flush(); if (surf) cur = { l0: l, l1: l, z0: t.end[2], z1: t.end[2], n: [...n] }; }
    }
    flush();
    console.log(`${ax}=${a}`.padEnd(10), runs.join(' '));
  }
  if (process.env.FB) bsp.entities.filter(e => e.classname === 'func_brush').forEach(e => console.log('fb', e.origin, e.model));
});
