// Ramps as connected groups of brushes with surf faces (any colour: clip ramps too) inside BOX (BSP=, .gz ok): per group
// its pieces, bounds, height range, face normals and a polyline through the pieces' centres (nearest-neighbour walk).
import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseBsp, unpack } from '../src/bsp';
import { buildBrush } from '../src/game';
it('ramp groups', async () => {
  const b = readFileSync(process.env.BSP!), bsp = parseBsp(await unpack(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
  const bx = process.env.BOX!.split(',').map(Number), G = +(process.env.GAP ?? 24);
  const ramps = bsp.brushes.map(buildBrush).filter(br => !br.nonsolid && [0, 1, 2].every(k => br.max[k] >= bx[k] && br.min[k] <= bx[k + 3]) && br.faces.some(f => f.n[2] > 0.05 && f.n[2] < 0.7));
  const par = ramps.map((_, i) => i), find = (i: number): number => (par[i] === i ? i : (par[i] = find(par[i])));
  for (let i = 0; i < ramps.length; i++) for (let j = i + 1; j < ramps.length; j++) {
    const a = ramps[i], c = ramps[j];
    if ([0, 1, 2].every(k => a.min[k] <= c.max[k] + G && c.min[k] <= a.max[k] + G)) par[find(i)] = find(j);
  }
  const groups = new Map<number, typeof ramps>();
  ramps.forEach((r, i) => { const g = find(i); groups.set(g, [...(groups.get(g) ?? []), r]); });
  const out: string[] = [];
  for (const g of [...groups.values()].sort((p, q) => Math.max(...q.map(r => r.max[2])) - Math.max(...p.map(r => r.max[2])))) {
    const mn = [0, 1, 2].map(k => Math.min(...g.map(r => r.min[k]))), mx = [0, 1, 2].map(k => Math.max(...g.map(r => r.max[k])));
    if (g.length < +(process.env.MIN ?? 3)) continue;
    const c = g.map(r => [0, 1, 2].map(k => (r.min[k] + r.max[k]) / 2));
    // walk: start at the piece farthest from the group's centre, then nearest unvisited
    const ctr = [0, 1, 2].map(k => c.reduce((a, p) => a + p[k], 0) / c.length);
    let cur = c.reduce((m, p, i) => (Math.hypot(p[0] - ctr[0], p[1] - ctr[1]) > Math.hypot(c[m][0] - ctr[0], c[m][1] - ctr[1]) ? i : m), 0);
    const seen = new Set([cur]), path = [c[cur]];
    while (seen.size < c.length) { let best = -1, bd = Infinity; c.forEach((p, i) => { if (!seen.has(i)) { const d = Math.hypot(p[0] - c[cur][0], p[1] - c[cur][1], p[2] - c[cur][2]); if (d < bd) { bd = d; best = i; } } }); seen.add(best); cur = best; path.push(c[best]); }
    const step = Math.max(1, Math.round(path.length / 12)), pts = path.filter((_, i) => i % step === 0 || i === path.length - 1);
    const ns = new Map<string, number>(); for (const r of g) for (const f of r.faces) if (f.n[2] > 0.05 && f.n[2] < 0.7) { const k = f.n.map(v => v.toFixed(1)).join(','); ns.set(k, (ns.get(k) ?? 0) + 1); }
    out.push(`group of ${g.length}: ${mn.map(Math.round)} .. ${mx.map(Math.round)}  normals ${[...ns].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, n]) => `(${k})x${n}`).join(' ')}\n   path ${pts.map(p => `[${p.map(Math.round)}]`).join(' ')}`);
  }
  writeFileSync(process.env.OUT!, out.join('\n') + `\n${groups.size} groups of ${ramps.length} pieces\n`);
}, 600000);
