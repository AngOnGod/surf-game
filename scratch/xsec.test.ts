// ASCII cross-sections of a map at fixed x (or y with AXIS=y): '#' solid, 'K' kill/teleport volume, '.' free, for the
// player's hull (a cell is free if a standing hull fits there). XS = comma list; Y0,Y1,Z0,Z1,STEP. AXIS=z: top-down
// slices at heights XS, columns x Y0..Y1, rows y Z1 (top) .. Z0
import { it } from 'vitest';
import { appendFileSync, readFileSync } from 'node:fs';
import { HULL_MIN, HULL_STAND, trace, type Vec } from '../src/physics';
import { parseBsp } from '../src/bsp';
import { buildBrush } from '../src/game';
it('xsec', () => {
  const b = readFileSync(process.env.BSP!), bsp = parseBsp(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), w = bsp.brushes.map(buildBrush);
  const [a0, a1, z0, z1, st] = ['Y0', 'Y1', 'Z0', 'Z1', 'STEP'].map(k => +process.env[k]!), ax = process.env.AXIS === 'y', top = process.env.AXIS === 'z';
  const kill = (p: Vec) => bsp.fails.some(f => p[0] + 16 > f.min[0] && p[0] - 16 < f.max[0] && p[1] + 16 > f.min[1] && p[1] - 16 < f.max[1] && p[2] + 72 > f.min[2] && p[2] < f.max[2]);
  for (const x of process.env.XS!.split(',').map(Number)) {
    const lines = [`${top ? 'z' : ax ? 'y' : 'x'} = ${x}: columns ${ax || top ? 'x' : 'y'} ${a0}..${a1} step ${st}, rows ${top ? 'y' : 'z'} ${z1} (top) .. ${z0}`];
    for (let z = z1; z >= z0; z -= st) {
      let row = '';
      for (let a = a0; a <= a1; a += st) { const p: Vec = top ? [a, z, x] : ax ? [a, x, z] : [x, a, z]; row += trace(w, p, p, HULL_MIN, HULL_STAND).startsolid ? '#' : kill(p) ? 'K' : '.'; }
      lines.push(`${String(z).padStart(6)} ${row}`);
    }
    appendFileSync(process.env.OUT!, lines.join('\n') + '\n\n');
  }
}, 600000);
