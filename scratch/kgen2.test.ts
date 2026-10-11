import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { HULL_MIN, HULL_STAND, trace } from '../src/physics';
import { parseBsp } from '../src/bsp';
import { buildBrush } from '../src/game';
// Guide lines along arbitrary straight legs: cross-sections every 128 units, the surf face nearest the previous line
type Face = { l0: number; l1: number; z0: number; z1: number; n: number[] };
it('generate guides along legs', () => {
  const b = readFileSync('public/maps/surf_kitsune.bsp'), bsp = parseBsp(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), w = bsp.brushes.map(buildBrush);
  const legs: { from: number[]; to: number[]; half: number; z: number[]; prefer?: number }[] = JSON.parse(process.env.LEGS!);
  for (const leg of legs) {
    const dx = leg.to[0] - leg.from[0], dy = leg.to[1] - leg.from[1], L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, lx = -uy, ly = ux; // l = left
    let prev: number | null = leg.prefer ?? null, run: number[][] = []; const out: string[] = [];
    const flush = (why: string) => { if (run.length) out.push(`[${run.filter((_, i) => i % 4 === 0 || i === run.length - 1).map(p => `[${p.join(', ')}]`).join(', ')}] (${why})`); run = []; };
    let prevSign = 0;
    for (let s = 0; s <= L; s += 128) {
      const cx = leg.from[0] + ux * s, cy = leg.from[1] + uy * s, faces: Face[] = []; let cur: Face | null = null;
      for (let l = -leg.half; l <= leg.half; l += 16) {
        const x = cx + lx * l, y = cy + ly * l;
        let z = leg.z[0]; while (z > leg.z[1] && trace(w, [x, y, z], [x, y, z], HULL_MIN, HULL_STAND).startsolid) z -= 32;
        const t = trace(w, [x, y, z], [x, y, leg.z[1]], HULL_MIN, HULL_STAND), n = t.normal, nl = n[0] * lx + n[1] * ly;
        const surf = t.fraction < 1 && n[2] > 0.05 && n[2] < 0.7 && Math.abs(nl) > 0.4;
        if (surf && cur && Math.sign(nl) === Math.sign(cur.n[0] * lx + cur.n[1] * ly)) { cur.l1 = l; cur.z1 = t.end[2]; }
        else { if (cur) faces.push(cur); cur = surf ? { l0: l, l1: l, z0: t.end[2], z1: t.end[2], n: [...n] } : null; }
      }
      if (cur) faces.push(cur);
      const fs = faces.filter(f => f.l1 - f.l0 >= 96);
      if (!fs.length) { flush('gap'); continue; }
      const mid = (f: Face) => (f.l0 + f.l1) / 2;
      const f = prev === null ? fs[0] : fs.reduce((a, q) => (Math.abs(mid(q) - prev!) < Math.abs(mid(a) - prev!) ? q : a));
      const sign = Math.sign(f.n[0] * lx + f.n[1] * ly);
      if (run.length && sign !== prevSign) flush('switch');
      run.push([Math.round(cx + lx * mid(f)), Math.round(cy + ly * mid(f)), Math.round((f.z0 + f.z1) / 2)]);
      prev = mid(f); prevSign = sign;
    }
    flush('end');
    console.log(`LEG ${JSON.stringify(leg.from)}->${JSON.stringify(leg.to)}:\n  ${out.join('\n  ')}`);
  }
}, 600000);
