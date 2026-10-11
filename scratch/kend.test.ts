import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { HULL_MIN, HULL_STAND, trace } from '../src/physics';
import { parseBsp } from '../src/bsp';
import { buildBrush } from '../src/game';
// for a ridge running along +/-y: walk from y0 in direction dy until no surf face under x-range; report the end and the apex there
it('ridge ends', () => {
  const b = readFileSync('public/maps/surf_kitsune.bsp'), bsp = parseBsp(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), w = bsp.brushes.map(buildBrush);
  for (const [name, x0, x1, y0, dy, ztop, zbot] of JSON.parse(process.env.R!) as [string, number, number, number, number, number, number][]) {
    let last: string = '';
    for (let y = y0; Math.abs(y - y0) < 6000; y += dy) {
      let best = -1e9, bx = 0, any = false;
      for (let x = x0; x <= x1; x += 16) {
        let z = ztop; while (z > zbot && trace(w, [x, y, z], [x, y, z], HULL_MIN, HULL_STAND).startsolid) z -= 32;
        const t = trace(w, [x, y, z], [x, y, zbot], HULL_MIN, HULL_STAND);
        if (t.fraction < 1 && t.normal[2] > 0.05 && t.normal[2] < 0.7) { any = true; if (t.end[2] > best) { best = t.end[2]; bx = x; } }
      }
      if (!any) { console.log(`${name}: face ends before y=${y}; last ${last}`); break; }
      last = `y=${y} apex x ${bx} z ${Math.round(best)}`;
    }
  }
});
