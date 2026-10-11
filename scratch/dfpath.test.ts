// follow a distance field downhill from a point (FROM x,y,z): print every Nth cell of the path to the goal
import { it } from 'vitest';
import { appendFileSync, readFileSync } from 'node:fs';
it('df path', () => {
  const { box, cell: C, dims: [nx, ny, nz] } = JSON.parse(readFileSync(process.env.DF + '.json', 'utf8')), d = new Int32Array(readFileSync(process.env.DF + '.bin').buffer.slice(0));
  const o = process.env.FROM!.split(',').map(Number), N = +(process.env.N ?? 8), out = (s: string) => appendFileSync(process.env.OUT!, s + '\n');
  let [i, j, k] = [0, 1, 2].map(a => Math.round((o[a] - box[a]) / C)), id = (k * ny + j) * nx + i;
  if (d[id] < 0) { // nearest reachable cell
    let best = -1; for (let dk = -3; dk <= 3; dk++) for (let dj = -3; dj <= 3; dj++) for (let di = -3; di <= 3; di++) { const n = ((k + dk) * ny + (j + dj)) * nx + (i + di); if (d[n] >= 0 && (best < 0 || d[n] < d[best])) best = n; }
    id = best;
  }
  for (let step = 0; id >= 0 && d[id] > 0; step++) {
    i = id % nx; j = Math.floor((id % (nx * ny)) / nx); k = Math.floor(id / (nx * ny));
    if (step % N === 0) out(`${step} ${[box[0] + i * C, box[1] + j * C, box[2] + k * C].join(',')} d ${d[id] * C}`);
    let nxt = -1; for (const [a, b, c] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) { const n = ((k + c) * ny + (j + b)) * nx + (i + a); if (n >= 0 && n < d.length && d[n] >= 0 && d[n] < d[id] && (nxt < 0 || d[n] < d[nxt])) nxt = n; }
    id = nxt;
  }
});
