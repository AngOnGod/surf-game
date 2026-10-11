import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { HULL_MIN, HULL_STAND, trace, type Vec } from '../src/physics';
import { parseBsp } from '../src/bsp';
import { buildBrush } from '../src/game';
// shorten a flood path to a polyline whose every segment is clear: a box sweep hits nothing, and the box never
// touches a kill/teleport volume along it (sampled every 24 units)
it('simplify', () => {
  const b = readFileSync(process.env.BSP!), bsp = parseBsp(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), w = bsp.brushes.map(buildBrush);
  const path: Vec[] = JSON.parse(readFileSync(process.env.PATHFILE!, 'utf8'));
  const touches = (p: Vec) => bsp.fails.some(f => p[0] + 16 > f.min[0] && p[0] - 16 < f.max[0] && p[1] + 16 > f.min[1] && p[1] - 16 < f.max[1] && p[2] + 72 > f.min[2] && p[2] < f.max[2]
    && (!f.shape || f.shape.some(br => br.every(([a, c, e, d]) => Math.min(...[0, 1, 2, 3, 4, 5, 6, 7].map(k => a * (p[0] + (k & 1 ? 16 : -16)) + c * (p[1] + (k & 2 ? 16 : -16)) + e * (p[2] + (k & 4 ? 72 : 0)))) <= d))));
  const clear = (a: Vec, c: Vec) => {
    const t = trace(w, a, c, HULL_MIN, HULL_STAND); if (t.fraction < 1 || t.startsolid) return false;
    const L = Math.hypot(c[0] - a[0], c[1] - a[1], c[2] - a[2]), n = Math.ceil(L / 24);
    for (let k = 0; k <= n; k++) if (touches(a.map((v, i) => v + ((c[i] - v) * k) / n) as Vec)) return false;
    return true;
  };
  const out: Vec[] = [path[0]];
  for (let i = 0; i < path.length - 1; ) {
    let j = i + 1; while (j + 1 < path.length && clear(path[i], path[j + 1])) j++;
    if (!clear(path[i], path[j])) throw new Error(`no clear step from ${path[i]}`);
    out.push(path[j]); i = j;
  }
  writeFileSync(process.env.OUT!, JSON.stringify(out));
}, 600000);
