import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { HULL_MIN, HULL_STAND, trace } from '../src/physics';
import { parseBsp } from '../src/bsp';
import { buildBrush } from '../src/game';
// along a path (start -> goal), every ~384 units: the first surface below each point (surf faces marked)
it('surfaces under a path', () => {
  const b = readFileSync('public/maps/surf_kitsune.bsp'), bsp = parseBsp(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), w = bsp.brushes.map(buildBrush);
  const path: number[][] = JSON.parse(readFileSync(process.env.PATH_FILE!, 'utf8'));
  let acc = 0;
  for (let i = 0; i < path.length; i++) {
    if (i > 0) acc += Math.hypot(...path[i].map((v, k) => v - path[i - 1][k]));
    if (i > 0 && acc < 384 && i < path.length - 1) continue;
    acc = 0;
    const p = path[i], tr = trace(w, p as any, [p[0], p[1], p[2] - 3000], HULL_MIN, HULL_STAND), n = tr.normal;
    const kind = tr.fraction >= 1 ? 'none' : n[2] >= 0.7 ? 'floor' : n[2] > 0.05 ? 'SURF' : 'wall';
    const fail = bsp.fails.some(f => tr.end.every((v, k) => v >= f.min[k] - 16 && v <= f.max[k] + 16) && !f.quiet);
    console.log(`${p.map(Math.round).join(',').padEnd(22)} below: ${kind} ${tr.fraction < 1 ? Math.round(tr.end[2]) + ' n(' + n.map(v => v.toFixed(2)) + ')' : ''}${fail ? ' [kill]' : ''}`);
  }
});
