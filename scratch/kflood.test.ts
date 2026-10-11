import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { HULL_MIN, HULL_STAND, trace } from '../src/physics';
import { parseBsp } from '../src/bsp';
import { buildBrush } from '../src/game';
// 3D flood fill of hull-free cells from a start point, never entering a teleport trigger
it('flood', () => {
  const b = readFileSync('public/maps/surf_kitsune.bsp'), bsp = parseBsp(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), w = bsp.brushes.map(buildBrush);
  const [x0, y0, z0, x1, y1, z1] = process.env.BOX!.split(',').map(Number), C = +(process.env.CELL ?? 48), start = process.env.START!.split(',').map(Number), goal = process.env.GOAL!.split(',').map(Number);
  const nx = Math.ceil((x1 - x0) / C), ny = Math.ceil((y1 - y0) / C), nz = Math.ceil((z1 - z0) / C);
  const idx = (i: number, j: number, k: number) => (k * ny + j) * nx + i, P = (i: number, j: number, k: number): [number, number, number] => [x0 + i * C, y0 + j * C, z0 + k * C];
  const state = new Int8Array(nx * ny * nz); // 0 unknown, 1 free, 2 blocked/trigger, 3 visited
  const free = (i: number, j: number, k: number) => {
    const id = idx(i, j, k); if (state[id]) return state[id] !== 2;
    const p = P(i, j, k);
    // the player box touches a trigger brush unless it lies wholly outside one of the brush's planes
    const corners = [0, 1, 2, 3, 4, 5, 6, 7].map(c => [p[0] + (c & 1 ? 16 : -16), p[1] + (c & 2 ? 16 : -16), p[2] + (c & 4 ? 72 : 0)]);
    const touches = (f: (typeof bsp.fails)[number]) => p[0] + 16 > f.min[0] && p[0] - 16 < f.max[0] && p[1] + 16 > f.min[1] && p[1] - 16 < f.max[1] && p[2] + 72 > f.min[2] && p[2] < f.max[2]
      && (!f.shape || f.shape.some(br => br.every(([nx, ny, nz, d]) => Math.min(...corners.map(q => nx * q[0] + ny * q[1] + nz * q[2])) <= d)));
    const bad = trace(w, p, p, HULL_MIN, HULL_STAND).startsolid || bsp.fails.some(touches);
    state[id] = bad ? 2 : 1; return !bad;
  };
  const toCell = (p: number[]) => [Math.round((p[0] - x0) / C), Math.round((p[1] - y0) / C), Math.round((p[2] - z0) / C)];
  const s = toCell(start), q: number[][] = [s], parent = new Int32Array(nx * ny * nz).fill(-1); free(s[0], s[1], s[2]); state[idx(s[0], s[1], s[2])] = 3;
  let reached = 0, minz = 1e9, maxy = -1e9;
  while (q.length) {
    const [i, j, k] = q.pop()!; // BFS (shortest path)
    const p = P(i, j, k); minz = Math.min(minz, p[2]); maxy = Math.max(maxy, p[1]); reached++;
    for (const [di, dj, dk] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]) {
      const a = i + di, bb = j + dj, c = k + dk;
      if (a < 0 || bb < 0 || c < 0 || a >= nx || bb >= ny || c >= nz) continue;
      if (state[idx(a, bb, c)] === 3 || !free(a, bb, c)) continue;
      state[idx(a, bb, c)] = 3; parent[idx(a, bb, c)] = idx(i, j, k); q.unshift([a, bb, c]);
    }
  }
  const g = toCell(goal);
  let near = 1e9; for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) if (state[idx(i, j, k)] === 3) { const p = P(i, j, k); near = Math.min(near, Math.hypot(p[0] - goal[0], p[1] - goal[1], p[2] - goal[2])); }
  let best = -1, bd = 1e9; for (let id = 0; id < state.length; id++) if (state[id] === 3) { const k = Math.floor(id / (nx * ny)), j = Math.floor((id % (nx * ny)) / nx), i = id % nx; const p = P(i, j, k), d = Math.hypot(p[0] - goal[0], p[1] - goal[1], p[2] - goal[2]); if (d < bd) { bd = d; best = id; } }
  const path: string[] = []; for (let id = best, n = 0; id >= 0; id = parent[id], n++) { const k = Math.floor(id / (nx * ny)), j = Math.floor((id % (nx * ny)) / nx), i = id % nx; if (n % 12 === 0) path.push(P(i, j, k).join(',')); }
  console.log('path (goal -> start):', path.join('  '));
  const full: number[][] = []; for (let id = best; id >= 0; id = parent[id]) { const k = Math.floor(id / (nx * ny)), j = Math.floor((id % (nx * ny)) / nx), i = id % nx; full.push(P(i, j, k)); }
  if (process.env.OUT) writeFileSync(process.env.OUT, JSON.stringify(full.reverse()));
  console.log(`reached ${reached} cells, min z ${minz}, max y ${maxy}, closest to goal ${Math.round(near)}`);
}, 600000);
