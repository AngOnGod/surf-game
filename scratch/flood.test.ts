import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { HULL_MIN, HULL_STAND, trace } from '../src/physics';
import { parseBsp } from '../src/bsp';
import { buildBrush } from '../src/game';
// 3D flood fill (BFS) of hull-free cells from START, never touching a teleport/kill trigger's exact shape; writes the
// shortest cell path to the reachable cell nearest GOAL (OUT, JSON) and a summary
it('flood', () => {
  const b = readFileSync(process.env.BSP!), bsp = parseBsp(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), w = bsp.brushes.map(buildBrush);
  const [x0, y0, z0, x1, y1, z1] = process.env.BOX!.split(',').map(Number), C = +(process.env.CELL ?? 96), start = process.env.START!.split(',').map(Number), goal = process.env.GOAL!.split(',').map(Number);
  const nx = Math.ceil((x1 - x0) / C), ny = Math.ceil((y1 - y0) / C), nz = Math.ceil((z1 - z0) / C), N = nx * ny * nz;
  const P = (id: number): [number, number, number] => { const k = Math.floor(id / (nx * ny)), j = Math.floor((id % (nx * ny)) / nx), i = id % nx; return [x0 + i * C, y0 + j * C, z0 + k * C]; };
  const state = new Int8Array(N), parent = new Int32Array(N).fill(-1), queue = new Int32Array(N); // 0 unknown, 2 blocked, 3 visited
  const fails = bsp.fails;
  const free = (id: number) => {
    if (state[id]) return state[id] === 3 ? false : state[id] !== 2;
    const p = P(id), corners = [0, 1, 2, 3, 4, 5, 6, 7].map(c => [p[0] + (c & 1 ? 16 : -16), p[1] + (c & 2 ? 16 : -16), p[2] + (c & 4 ? 72 : 0)]);
    const touches = (f: (typeof fails)[number]) => p[0] + 16 > f.min[0] && p[0] - 16 < f.max[0] && p[1] + 16 > f.min[1] && p[1] - 16 < f.max[1] && p[2] + 72 > f.min[2] && p[2] < f.max[2]
      && (!f.shape || f.shape.some(br => br.every(([a, bb, c, d]) => Math.min(...corners.map(q => a * q[0] + bb * q[1] + c * q[2])) <= d)));
    const bad = trace(w, p, p, HULL_MIN, HULL_STAND).startsolid || fails.some(touches);
    state[id] = bad ? 2 : 1; return !bad;
  };
  const cell = (p: number[]) => { const i = Math.round((p[0] - x0) / C), j = Math.round((p[1] - y0) / C), k = Math.round((p[2] - z0) / C); return (k * ny + j) * nx + i; };
  const s = cell(start), CAP = +(process.env.CAP ?? 4e7); let head = 0, tail = 0; queue[tail++] = s; state[s] = 3;
  let reached = 0, best = s, bd = 1e18;
  while (head < tail && head < CAP) {
    const id = queue[head++], p = P(id); reached++;
    const d = Math.hypot(p[0] - goal[0], p[1] - goal[1], p[2] - goal[2]); if (d < bd) { bd = d; best = id; }
    const i = id % nx, j = Math.floor((id % (nx * ny)) / nx), k = Math.floor(id / (nx * ny));
    for (const [di, dj, dk] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      const a = i + di, bb = j + dj, c = k + dk;
      if (a < 0 || bb < 0 || c < 0 || a >= nx || bb >= ny || c >= nz) continue;
      const n = (c * ny + bb) * nx + a;
      if (!free(n)) continue;
      if (process.env.SWEEP) { const pa = P(id), pb = P(n), t = trace(w, pa, pb, HULL_MIN, HULL_STAND); if (t.fraction < 1 || t.startsolid) continue; } // a wall between the two cells
      state[n] = 3; parent[n] = id; queue[tail++] = n;
    }
  }
  const full: number[][] = []; for (let id = best; id >= 0; id = parent[id]) full.push(P(id));
  full.reverse();
  writeFileSync(process.env.OUT ?? 'scratch/flood.json', JSON.stringify(full));
  writeFileSync((process.env.OUT ?? 'scratch/flood.json') + '.txt', `reached ${reached} cells; closest to goal ${Math.round(bd)}; path ${full.length} cells\n` + full.filter((_, n) => n % 10 === 0 || n === full.length - 1).map(p => p.join(',')).join('\n') + '\n');
}, 3600000);
