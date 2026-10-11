import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseBsp } from '../src/bsp';
import { buildBrush } from '../src/game';
// surf faces (0.05 < n.z < 0.7, facing up) that are not drawn, or drawn as glass: ramps players can't see well
it('hidden ramps', () => {
  const b = readFileSync(process.env.BSP!), bsp = parseBsp(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), out: string[] = [];
  const drawn = bsp.brushes.flatMap(d => (d.type === 'planes' ? buildBrush(d).faces.filter(f => f.color !== null && f.n[2] > 0.05 && f.n[2] < 0.7) : []));
  const covered = (f: { n: number[]; verts: number[][] }) => { // a drawn face on (nearly) the same plane, overlapping it
    const d = f.verts[0].reduce((a, v, k) => a + v * f.n[k], 0), lo = [0, 1, 2].map(k => Math.min(...f.verts.map(v => v[k]))), hi = [0, 1, 2].map(k => Math.max(...f.verts.map(v => v[k])));
    return drawn.some(g => g.n.reduce((a, v, k) => a + v * f.n[k], 0) > 0.99 && Math.abs(g.verts[0].reduce((a, v, k) => a + v * f.n[k], 0) - d) < 80
      && [0, 1, 2].every(k => Math.min(...g.verts.map(v => v[k])) < hi[k] && Math.max(...g.verts.map(v => v[k])) > lo[k]));
  };
  bsp.brushes.forEach((d, i) => {
    if (d.type !== 'planes') return;
    const br = buildBrush(d), area = (vs: number[][]) => { let a = 0; for (let k = 1; k + 1 < vs.length; k++) { const u = vs[k].map((v, j) => v - vs[0][j]), w = vs[k + 1].map((v, j) => v - vs[0][j]); a += Math.hypot(u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]) / 2; } return a; };
    br.faces.forEach(f => {
      if (!(f.n[2] > 0.05 && f.n[2] < 0.7) || area(f.verts) < 40000) return;
      const kind = f.color === null ? (covered(f) ? '' : 'HIDDEN') : d.glass ? 'glass' : '';
      if (kind) out.push(`${kind} #${i} n ${f.n.map(x => x.toFixed(2))} area ${Math.round(area(f.verts))} bounds ${br.min.map(Math.round)} .. ${br.max.map(Math.round)}`);
    });
  });
  writeFileSync(process.env.OUT!, `${out.length} faces\n` + out.join('\n') + '\n');
});
