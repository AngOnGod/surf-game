// A cross-section of a .bsp (BSP=path, AXIS=x|y, AT=that coordinate, VIEW=u0,v0,u1,v1 in the other horizontal axis
// and z, UPP=units per pixel, OUT=png): every solid brush cut by the plane, filled (blue: has a surf face, grey: drawn,
// purple: invisible); kill volumes red, other teleports green (outlines).
import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseBsp } from '../src/bsp';
import { buildBrush } from '../src/game';
import { png } from './png';

it('slice', () => {
  const raw = readFileSync(process.env.BSP!), b = parseBsp(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const ax = process.env.AXIS === 'y' ? 1 : 0, U = 1 - ax, X = +process.env.AT!, [u0, v0, u1, v1] = process.env.VIEW!.split(',').map(Number), upp = +(process.env.UPP ?? 8);
  const W = Math.ceil((u1 - u0) / upp), H = Math.ceil((v1 - v0) / upp), img = new Uint8Array(W * H * 3).fill(16);
  const px = (u: number, v: number): [number, number] => [(u - u0) / upp, H - (v - v0) / upp];
  const fill = (poly: [number, number][], c: number[]) => {
    const pts = poly.map(([u, v]) => px(u, v)), ys = pts.map(p => p[1]);
    for (let y = Math.max(0, Math.floor(Math.min(...ys))); y <= Math.min(H - 1, Math.ceil(Math.max(...ys))); y++) {
      const xs: number[] = [];
      pts.forEach((a, i) => { const q = pts[(i + 1) % pts.length]; if ((a[1] <= y + 0.5) !== (q[1] <= y + 0.5)) xs.push(a[0] + ((y + 0.5 - a[1]) / (q[1] - a[1])) * (q[0] - a[0])); });
      xs.sort((a, q) => a - q);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.round(xs[k])); x < Math.min(W, Math.round(xs[k + 1])); x++) img.set(c, (y * W + x) * 3);
    }
  };
  const outline = (mn: number[], mx: number[], c: number[]) => {
    if (X < mn[ax] || X > mx[ax]) return;
    const [l, t] = px(mn[U], mx[2]), [r, bt] = px(mx[U], mn[2]);
    for (let x = Math.round(l); x <= Math.round(r); x++) for (const y of [Math.round(t), Math.round(bt)]) if (x >= 0 && y >= 0 && x < W && y < H) img.set(c, (y * W + x) * 3);
    for (let y = Math.round(t); y <= Math.round(bt); y++) for (const x of [Math.round(l), Math.round(r)]) if (x >= 0 && y >= 0 && x < W && y < H) img.set(c, (y * W + x) * 3);
  };
  for (const d of b.brushes) {
    if (d.type !== 'planes' || d.nonsolid) continue;
    const br = buildBrush(d);
    if (X < br.min[ax] || X > br.max[ax]) continue;
    let poly: [number, number][] = [[u0 - 1e4, v0 - 1e4], [u1 + 1e4, v0 - 1e4], [u1 + 1e4, v1 + 1e4], [u0 - 1e4, v1 + 1e4]];
    for (const p of br.planes) { // keep n_u u + n_z z <= d - n_ax X
      const a = p.n[U], c = p.n[2], e = p.d - p.n[ax] * X, out: [number, number][] = [];
      poly.forEach((q, i) => {
        const r = poly[(i + 1) % poly.length], fq = a * q[0] + c * q[1] - e, fr = a * r[0] + c * r[1] - e;
        if (fq <= 0) out.push(q);
        if ((fq <= 0) !== (fr <= 0)) { const t = fq / (fq - fr); out.push([q[0] + (r[0] - q[0]) * t, q[1] + (r[1] - q[1]) * t]); }
      });
      poly = out;
      if (poly.length < 3) break;
    }
    if (poly.length < 3) continue;
    const surf = br.planes.some(p => p.n[2] > 0.05 && p.n[2] < 0.7), inv = d.faceColors?.every(c => c === null);
    fill(poly, inv ? [110, 60, 130] : surf ? [70, 120, 230] : [150, 150, 140]);
  }
  for (const f of b.fails) outline(f.min, f.max, f.quiet || (f.to && Math.max(f.max[0] - f.min[0], f.max[1] - f.min[1]) <= 300 && f.max[2] - f.min[2] >= 200) ? [60, 255, 60] : [255, 60, 60]);
  writeFileSync(process.env.OUT ?? 'scratch/slice.png', png(W, H, img));
});
