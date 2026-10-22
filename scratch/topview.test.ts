// Top-down picture of a .bsp (BSP=path, VIEW=x0,y0,x1,y1, UPP=units per pixel, ZR=z0,z1 to keep, OUT=png): the
// highest upward face at each pixel (surf faces blue, floors grey, brighter = higher), teleports outlined (red: back
// to a stage start, green: on elsewhere), destinations yellow, the spawn white. SIDE=x|y draws a side view instead
// (looking along that axis: surf faces blue, others grey, nearer = brighter).
import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseBsp } from '../src/bsp';
import { buildBrush } from '../src/game';
import type { Vec } from '../src/physics';
import { png } from './png';

it('top view', () => {
  const raw = readFileSync(process.env.BSP!), b = parseBsp(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const [x0, y0, x1, y1] = (process.env.VIEW ?? `${b.bounds.min[0]},${b.bounds.min[1]},${b.bounds.max[0]},${b.bounds.max[1]}`).split(',').map(Number);
  const side = process.env.SIDE as 'x' | 'y' | undefined, [z0, z1] = (process.env.ZR ?? '-1e9,1e9').split(',').map(Number), upp = +(process.env.UPP ?? 8);
  // picture axes: top view (x right, y up); side 'x' looks along +x (y right, z up); side 'y' looks along +y (x right, z up)
  const U = side === 'x' ? 1 : 0, V = side ? 2 : 1, D = side === 'x' ? 0 : side === 'y' ? 1 : 2; // D: depth axis (bigger = nearer for the top view)
  const [u0, v0, u1, v1] = side ? [side === 'x' ? y0 : x0, z0, side === 'x' ? y1 : x1, z1] : [x0, y0, x1, y1];
  const W = Math.ceil((u1 - u0) / upp), H = Math.ceil((v1 - v0) / upp), img = new Uint8Array(W * H * 3).fill(16), depth = new Float64Array(W * H).fill(-Infinity);
  const lo = side ? (side === 'x' ? x0 : y0) : z0 === -1e9 ? b.bounds.min[2] : z0, hi = side ? (side === 'x' ? x1 : y1) : z1 === 1e9 ? b.bounds.max[2] : z1;
  const px = (p: Vec): [number, number] => [(p[U] - u0) / upp, H - (p[V] - v0) / upp];
  const keep = (p: Vec) => (side ? p[D] >= lo && p[D] <= hi : p[2] >= z0 && p[2] <= z1);
  const fill = (poly: Vec[], color: (d: number) => [number, number, number]) => { // scanline fill with a depth test (depth at the polygon's mean)
    const pts = poly.map(px), dz = poly.reduce((s, p) => s + (side ? -p[D] : p[2]), 0) / poly.length;
    const ys = pts.map(p => p[1]), ya = Math.max(0, Math.floor(Math.min(...ys))), yb = Math.min(H - 1, Math.ceil(Math.max(...ys)));
    for (let y = ya; y <= yb; y++) {
      const xs: number[] = [];
      pts.forEach((a, i) => { const c = pts[(i + 1) % pts.length]; if ((a[1] <= y + 0.5) !== (c[1] <= y + 0.5)) xs.push(a[0] + ((y + 0.5 - a[1]) / (c[1] - a[1])) * (c[0] - a[0])); });
      xs.sort((a, c) => a - c);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.round(xs[k])); x < Math.min(W, Math.round(xs[k + 1])); x++) {
        const i = y * W + x;
        if (dz <= depth[i]) continue;
        depth[i] = dz; const c = color(dz); img.set(c, i * 3);
      }
    }
  };
  const shade = (dz: number) => 0.35 + 0.65 * Math.min(1, Math.max(0, side ? (hi + dz) / (hi - lo) : (dz - lo) / (hi - lo)));
  for (const d of b.brushes) {
    if (d.type !== 'planes' || d.nonsolid) continue;
    const br = buildBrush(d);
    for (const f of br.faces) {
      if (f.verts.length < 3 || !f.verts.some(keep)) continue;
      const facing = f.n[2] > 0.05; // ramps and floors (walls would hide them in a side view)
      if (!facing) continue;
      const surf = f.n[2] > 0.05 && f.n[2] < 0.7, inv = f.color === null;
      if (inv && !surf && !process.env.INV) continue; // sky ceilings, clip walls: only invisible ramps are drawn
      fill(f.verts, dz => { const s = shade(dz); return surf ? [60 * s, 120 * s, 255 * s] : inv ? [120 * s, 60 * s, 140 * s] : [170 * s, 170 * s, 160 * s]; });
    }
  }
  const dot = (p: Vec, c: [number, number, number], r = 3) => { const [cx, cy] = px(p); for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) { const X = Math.round(cx + x), Y = Math.round(cy + y); if (X >= 0 && Y >= 0 && X < W && Y < H) img.set(c, (Y * W + X) * 3); } };
  const rect = (mn: Vec, mx: Vec, c: [number, number, number]) => {
    const [ax, ay] = px(mn), [bx, by] = px(mx), l = Math.round(Math.min(ax, bx)), r = Math.round(Math.max(ax, bx)), t = Math.round(Math.min(ay, by)), bt = Math.round(Math.max(ay, by));
    for (let x = l; x <= r; x++) for (const y of [t, bt]) if (x >= 0 && y >= 0 && x < W && y < H) img.set(c, (y * W + x) * 3);
    for (let y = t; y <= bt; y++) for (const x of [l, r]) if (x >= 0 && y >= 0 && x < W && y < H) img.set(c, (y * W + x) * 3);
  };
  const zlo = side ? z0 : z0 === -1e9 ? -1e9 : z0, zhi = z1, inView = (mn: Vec, mx: Vec) => mx[0] >= x0 && mn[0] <= x1 && mx[1] >= y0 && mn[1] <= y1 && mx[2] >= zlo && mn[2] <= zhi;
  for (const f of b.fails) {
    if (!inView(f.min, f.max)) continue;
    const back = f.to && Math.hypot(...([0, 1, 2].map(k => (f.min[k] + f.max[k]) / 2 - f.to!.pos[k]) as Vec)) < 9000 && !(Math.max(f.max[0] - f.min[0], f.max[1] - f.min[1]) < 300);
    rect(f.min, f.max, back || !f.to ? [255, 60, 60] : [60, 255, 60]);
    if (f.to && inView(f.to.pos, f.to.pos)) dot(f.to.pos, [255, 230, 0]);
  }
  dot(b.spawn.pos, [255, 255, 255], 4);
  writeFileSync(process.env.OUT ?? 'scratch/view.png', png(W, H, img));
  writeFileSync((process.env.OUT ?? 'scratch/view.png') + '.txt', `${W}x${H} px, ${upp} u/px, u ${u0}..${u1}, v ${v0}..${v1}\n`);
});
