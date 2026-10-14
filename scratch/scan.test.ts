// Cross-sections of a corridor running along +y (or AXIS=x): runs of surf samples (0.05 < n.z < 0.7) and floors per
// slice, top-down from Z top (BSP= file, .gz ok; A=from,to,step along; L=from,to across; Z=top,bottom; OUT=)
import { it } from 'vitest';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { HULL_MIN, HULL_STAND, trace } from '../src/physics';
import { parseBsp, unpack } from '../src/bsp';
import { buildBrush } from '../src/game';
it('scan', async () => {
  const b = readFileSync(process.env.BSP!), bsp = parseBsp(await unpack(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))), w = Object.assign(bsp.brushes.map(buildBrush), { tris: bsp.tris });
  const [a0, a1, da] = process.env.A!.split(',').map(Number), [l0, l1] = process.env.L!.split(',').map(Number), [ztop, zbot] = process.env.Z!.split(',').map(Number), ax = process.env.AXIS ?? 'y', step = +(process.env.STEP ?? 32);
  writeFileSync(process.env.OUT!, '');
  for (let a = a0; da > 0 ? a <= a1 : a >= a1; a += da) {
    const runs: string[] = []; let cur: { l0: number; l1: number; z0: number; z1: number; n: number[]; kind: string } | null = null;
    const flush = () => { if (cur) runs.push(`${cur.kind}[${cur.l0}..${cur.l1} z${Math.round(cur.z0)}..${Math.round(cur.z1)} n${cur.n.map(v => v.toFixed(2)).join(',')}]`); cur = null; };
    for (let l = l0; l <= l1; l += step) {
      const p: [number, number, number] = ax === 'y' ? [l, a, ztop] : [a, l, ztop];
      let z = ztop; while (z > zbot && trace(w, [p[0], p[1], z], [p[0], p[1], z], HULL_MIN, HULL_STAND).startsolid) z -= 64;
      const t = trace(w, [p[0], p[1], z], [p[0], p[1], zbot], HULL_MIN, HULL_STAND), n = t.normal;
      const kind = t.fraction >= 1 ? '' : n[2] > 0.05 && n[2] < 0.7 ? 'S' : n[2] >= 0.7 ? 'F' : '';
      const kill = kind && bsp.fails.some(f => p[0] + 16 > f.min[0] && p[0] - 16 < f.max[0] && p[1] + 16 > f.min[1] && p[1] - 16 < f.max[1] && t.end[2] + 72 > f.min[2] && t.end[2] - 2 < f.max[2]);
      const k = kind && (kill ? 'K' + kind : kind);
      if (k && cur && cur.kind === k && Math.abs(n[0] - cur.n[0]) + Math.abs(n[1] - cur.n[1]) < 0.15 && Math.abs(t.end[2] - cur.z1) < 200) { cur.l1 = l; cur.z1 = t.end[2]; }
      else { flush(); if (k) cur = { l0: l, l1: l, z0: t.end[2], z1: t.end[2], n: [...n], kind: k }; }
    }
    flush();
    appendFileSync(process.env.OUT!, `${ax === 'y' ? 'y' : 'x'}=${a}: ${runs.join(' ')}\n`);
  }
}, 3600000);
