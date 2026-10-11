// utopia_v3 hall: cast horizontal traces outward from inside the hall at a few heights; report where they hit and the
// surface normal (n_z 0: a vertical wall; 0.05..0.7: surfable)
import { it } from 'vitest';
import { appendFileSync, readFileSync } from 'node:fs';
import { HULL_MIN, HULL_STAND, trace, type Vec } from '../src/physics';
import { parseBsp } from '../src/bsp';
import { buildBrush } from '../src/game';
it('walls', () => {
  const b = readFileSync('public/maps/surf_utopia_v3.bsp'), bsp = parseBsp(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), w = bsp.brushes.map(buildBrush);
  const [cx, cy] = (process.env.C ?? '11000,2500').split(',').map(Number);
  for (const z of (process.env.ZS ?? '-1600,-2200,-2800,-3300').split(',').map(Number)) {
    const row: string[] = [];
    for (let a = 0; a < 360; a += 20) {
      const o: Vec = [cx, cy, z], e: Vec = [cx + Math.cos(a * Math.PI / 180) * 12000, cy + Math.sin(a * Math.PI / 180) * 12000, z], t = trace(w, o, e, HULL_MIN, HULL_STAND);
      row.push(t.startsolid ? `${a}:solid` : t.fraction >= 1 ? `${a}:-` : `${a}:${t.end.slice(0, 2).map(Math.round).join(',')} nz ${t.normal[2].toFixed(2)}`);
    }
    appendFileSync(process.env.OUT!, `z ${z} from (${cx},${cy}):\n  ${row.join('\n  ')}\n`);
  }
});
