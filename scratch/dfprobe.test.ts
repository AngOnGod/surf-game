// sample a distance field at points (PTS: x,y,z;x,y,z;...)
import { it } from 'vitest';
import { appendFileSync, readFileSync } from 'node:fs';
it('df probe', () => {
  const { box, cell: C, dims: [nx, ny, nz] } = JSON.parse(readFileSync(process.env.DF + '.json', 'utf8')), d = new Int32Array(readFileSync(process.env.DF + '.bin').buffer.slice(0));
  for (const s of process.env.PTS!.split(';')) {
    const o = s.split(',').map(Number), i = Math.round((o[0] - box[0]) / C), j = Math.round((o[1] - box[1]) / C), k = Math.round((o[2] - box[2]) / C);
    let best = Infinity; for (const dk of [0, 1, -1, 2]) for (const dj of [0, -1, 1]) for (const di of [0, -1, 1]) { const a = i + di, b = j + dj, c = k + dk; if (a >= 0 && b >= 0 && c >= 0 && a < nx && b < ny && c < nz) { const v = d[(c * ny + b) * nx + a]; if (v >= 0) best = Math.min(best, v); } }
    appendFileSync(process.env.OUT!, `${s.padEnd(22)} ${Number.isFinite(best) ? best * C : 'unreachable'}\n`);
  }
});
