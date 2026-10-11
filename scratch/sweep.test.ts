// sweep the player's hull along segments (SEGS: x,y,z>x,y,z;...): clear, or where it hits and the normal; and kill contact
import { it } from 'vitest';
import { appendFileSync, readFileSync } from 'node:fs';
import { HULL_MIN, HULL_STAND, trace, type Vec } from '../src/physics';
import { parseBsp } from '../src/bsp';
import { buildBrush } from '../src/game';
it('sweep', () => {
  const b = readFileSync(process.env.BSP!), bsp = parseBsp(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), w = bsp.brushes.map(buildBrush);
  const kill = (p: Vec) => bsp.fails.some(f => p[0] + 16 > f.min[0] && p[0] - 16 < f.max[0] && p[1] + 16 > f.min[1] && p[1] - 16 < f.max[1] && p[2] + 72 > f.min[2] && p[2] < f.max[2]);
  for (const s of process.env.SEGS!.split(';')) {
    const [a, c] = s.split('>').map(q => q.split(',').map(Number) as Vec), t = trace(w, a, c, HULL_MIN, HULL_STAND);
    let k = -1; for (let i = 0; i <= 100; i++) if (kill(a.map((v, j) => v + (c[j] - v) * i / 100) as Vec)) { k = i; break; }
    appendFileSync(process.env.OUT!, `${s}: ${t.startsolid ? 'starts in solid' : t.fraction >= 1 ? 'clear' : `hits at ${t.end.map(Math.round)} normal ${t.normal.map(x => x.toFixed(2))}`}${k >= 0 ? `; kill at ${k}%` : ''}\n`);
  }
});
