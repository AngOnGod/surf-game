// Distance-to-goal field: BFS out from the goal box through hull-free cells that touch no teleport/kill volume, each
// step swept (no slipping through thin walls). Writes OUT.bin (Int32 steps to the goal per cell, -1: unreachable or
// blocked) and OUT.json (box, cell size, dims). BSP, BOX (x0,y0,z0,x1,y1,z1), CELL, GOAL (x0,y0,z0,x1,y1,z1)
import { it } from 'vitest';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { HULL_MIN, HULL_STAND, trace, type Vec } from '../src/physics';
import { parseBsp, unpack } from '../src/bsp';
import { buildBrush } from '../src/game';
it('distance field', async () => {
  const b = readFileSync(process.env.BSP!), bsp = parseBsp(await unpack(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))), w = Object.assign(bsp.brushes.map(buildBrush), { tris: bsp.tris });
  const [x0, y0, z0, x1, y1, z1] = process.env.BOX!.split(',').map(Number), C = +(process.env.CELL ?? 64), goal = process.env.GOAL!.split(',').map(Number);
  const nx = Math.ceil((x1 - x0) / C) + 1, ny = Math.ceil((y1 - y0) / C) + 1, nz = Math.ceil((z1 - z0) / C) + 1, N = nx * ny * nz;
  const P = (id: number): Vec => { const k = Math.floor(id / (nx * ny)), j = Math.floor((id % (nx * ny)) / nx), i = id % nx; return [x0 + i * C, y0 + j * C, z0 + k * C]; };
  const into = (f: { min: number[]; max: number[] }) => [0, 1, 2].every(k => f.min[k] <= goal[k + 3] && f.max[k] >= goal[k]); // the goal's own teleport (a portal the field leads into) isn't an obstacle
  const touches = (p: Vec) => bsp.fails.filter(f => !into(f)).some(f => p[0] + 16 > f.min[0] && p[0] - 16 < f.max[0] && p[1] + 16 > f.min[1] && p[1] - 16 < f.max[1] && p[2] + 72 > f.min[2] && p[2] < f.max[2]
    && (!f.shape || f.shape.some(br => br.every(([a, c, e, d]) => Math.min(...[0, 1, 2, 3, 4, 5, 6, 7].map(k => a * (p[0] + (k & 1 ? 16 : -16)) + c * (p[1] + (k & 2 ? 16 : -16)) + e * (p[2] + (k & 4 ? 72 : 0)))) <= d))));
  const state = new Int8Array(N), dist = new Int32Array(N).fill(-1), queue = new Int32Array(N); // state: 0 unknown, 1 free, 2 blocked
  const free = (id: number) => { if (!state[id]) { const p = P(id); state[id] = trace(w, p, p, HULL_MIN, HULL_STAND).startsolid || touches(p) ? 2 : 1; } return state[id] === 1; };
  let head = 0, tail = 0;
  for (let id = 0; id < N; id++) { const p = P(id); if (p.every((v, k) => v >= goal[k] && v <= goal[k + 3]) && free(id)) { dist[id] = 0; queue[tail++] = id; } }
  const seeds = tail, t0 = Date.now();
  while (head < tail) {
    const id = queue[head++], i = id % nx, j = Math.floor((id % (nx * ny)) / nx), k = Math.floor(id / (nx * ny));
    for (const [di, dj, dk] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const a = i + di, c = j + dj, e = k + dk;
      if (a < 0 || c < 0 || e < 0 || a >= nx || c >= ny || e >= nz) continue;
      const n = (e * ny + c) * nx + a;
      if (dist[n] >= 0 || !free(n)) continue;
      const t = trace(w, P(id), P(n), HULL_MIN, HULL_STAND), u = trace(w, P(n), P(id), HULL_MIN, HULL_STAND); if (t.fraction < 1 || t.startsolid || u.fraction < 1) continue;
      dist[n] = dist[id] + 1; queue[tail++] = n;
    }
  }
  writeFileSync(process.env.OUT + '.bin', Buffer.from(dist.buffer));
  writeFileSync(process.env.OUT + '.json', JSON.stringify({ box: [x0, y0, z0, x1, y1, z1], cell: C, dims: [nx, ny, nz] }));
  appendFileSync(process.env.OUT + '.txt', `${seeds} goal cells, ${tail} reached of ${N}, ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
}, 14_400_000);
