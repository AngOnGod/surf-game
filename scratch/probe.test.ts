// What is at a point (BSP=, P=x,y,z): standing hull stuck? which fail/teleport volumes touch it? floor below?
import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { HULL_MIN, HULL_STAND, type Vec, trace } from '../src/physics';
import { parseBsp, unpack } from '../src/bsp';
import { buildBrush } from '../src/game';
it('probe', async () => {
  const b = readFileSync(process.env.BSP!), bsp = parseBsp(await unpack(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))), w = Object.assign(bsp.brushes.map(buildBrush), { tris: bsp.tris });
  const out: string[] = [];
  for (const s of process.env.P!.split(';')) {
    const p = s.split(',').map(Number) as Vec, st = trace(w, p, p, HULL_MIN, HULL_STAND), dn = trace(w, p, [p[0], p[1], p[2] - 2000], HULL_MIN, HULL_STAND), up = trace(w, p, [p[0], p[1], p[2] + 2000], HULL_MIN, HULL_STAND);
    const touch = bsp.fails.filter(f => p[0] + 16 > f.min[0] && p[0] - 16 < f.max[0] && p[1] + 16 > f.min[1] && p[1] - 16 < f.max[1] && p[2] + 72 > f.min[2] && p[2] < f.max[2]);
    out.push(`${p}: stuck ${st.startsolid}; floor ${dn.fraction < 1 ? Math.round(dn.end[2]) + ' n ' + dn.normal.map(v => v.toFixed(2)) : 'none'}; ceiling ${up.fraction < 1 ? Math.round(up.end[2] + 72) : 'none'}; touches ${touch.map(f => `${f.min.map(Math.round)}..${f.max.map(Math.round)}${f.to ? ' -> ' + f.to.pos.map(Math.round) : ''}`).join(' | ') || 'nothing'}`);
  }
  writeFileSync('scratch/probe.out', out.join('\n') + '\n');
}, 600000);
