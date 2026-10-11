import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { HULL_MIN, HULL_STAND, trace } from '../src/physics';
import { parseBsp } from '../src/bsp';
import { buildBrush } from '../src/game';
// Guide lines along straight legs: cross-sections every 128 units; in each, every surface stacked under each lateral
// sample (hull traces down, stepping through solids) within ±700 of the expected height zh (lerped along the leg);
// surf faces nearest zh, grouped into runs; the run nearest the previous line. Prints runs of [x, y, z] mid-face points.
type Face = { l0: number; l1: number; z0: number; z1: number; n: number[] };
it('generate guides along legs', () => {
  const b = readFileSync(process.env.BSP ?? 'public/bsp/surf_aircontrol_ksf.bsp'), bsp = parseBsp(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), w = bsp.brushes.map(buildBrush);
  const legs: { from: number[]; to: number[]; half: number; zh: number[]; prefer?: number; step?: number }[] = JSON.parse(process.env.LEGS!), log: string[] = [];
  for (const leg of legs) {
    const dx = leg.to[0] - leg.from[0], dy = leg.to[1] - leg.from[1], L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, lx = -uy, ly = ux; // l = left
    let prev: number | null = leg.prefer ?? null, run: number[][] = [], prevSign = 0; const out: string[] = [];
    const flush = (why: string) => { if (run.length) out.push(`[${run.filter((_, i) => i % 4 === 0 || i === run.length - 1).map(p => `[${p.join(', ')}]`).join(', ')}] (${why})`); run = []; };
    for (let s = 0; s <= L; s += leg.step ?? 128) {
      const cx = leg.from[0] + ux * s, cy = leg.from[1] + uy * s, zh = leg.zh[0] + ((leg.zh[1] - leg.zh[0]) * s) / L, faces: Face[] = []; let cur: Face | null = null;
      for (let l = -leg.half; l <= leg.half; l += 16) {
        const x = cx + lx * l, y = cy + ly * l;
        let pick: { z: number; n: number[] } | null = null;
        for (let z = zh + 700; z > zh - 700; ) {
          if (trace(w, [x, y, z], [x, y, z], HULL_MIN, HULL_STAND).startsolid) { z -= 16; continue; }
          const t = trace(w, [x, y, z], [x, y, zh - 700], HULL_MIN, HULL_STAND);
          if (t.fraction === 1) break;
          const n = t.normal;
          if (n[2] > 0.05 && n[2] < 0.7 && Math.abs(n[0] * lx + n[1] * ly) > 0.4 && (!pick || Math.abs(t.end[2] - zh) < Math.abs(pick.z - zh))) pick = { z: t.end[2], n: [...n] };
          z = t.end[2] - 16;
        }
        const surf = !!pick;
        if (surf && cur && Math.sign(pick!.n[0] * lx + pick!.n[1] * ly) === Math.sign(cur.n[0] * lx + cur.n[1] * ly) && Math.abs(pick!.z - cur.z1) < 64) { cur.l1 = l; cur.z1 = pick!.z; }
        else { if (cur) faces.push(cur); cur = surf ? { l0: l, l1: l, z0: pick!.z, z1: pick!.z, n: pick!.n } : null; }
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
    log.push(`LEG ${JSON.stringify(leg.from)}->${JSON.stringify(leg.to)} zh ${leg.zh}:\n  ${out.join('\n  ')}`);
  }
  writeFileSync(process.env.OUT ?? 'scratch/acgen2.out', log.join('\n') + '\n');
}, 600000);
