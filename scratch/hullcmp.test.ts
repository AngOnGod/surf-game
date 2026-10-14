// Where do static-prop hulls stick out above a map's other brushes? Traces down a grid in BOX against the world with
// and without the prop hull brushes (BSP=, .gz ok). Reports cells where the props' surface is higher.
import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { HULL_MIN, HULL_STAND, type Vec, trace } from '../src/physics';
import { parseBsp, unpack } from '../src/bsp';
import { buildBrush } from '../src/game';
it('hull compare', async () => {
  const b = readFileSync(process.env.BSP!), bsp = parseBsp(await unpack(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
  const all = bsp.brushes.map(buildBrush), isProp = (d: (typeof bsp.brushes)[number]) => d.type === 'planes' && !!d.faceColors?.every(c => c === null) && d.planes.length !== 6 && !(d.planes.length < 9);
  const noProps = bsp.brushes.map((d, i) => [d, all[i]] as const).filter(([d]) => !isProp(d)).map(([, br]) => br);
  const [x0, y0, z0, x1, y1, z1] = process.env.BOX!.split(',').map(Number), st = +(process.env.STEP ?? 32), out: string[] = [];
  let worse = 0, n = 0;
  for (let x = x0; x <= x1; x += st) for (let y = y0; y <= y1; y += st) {
    const a = trace(all, [x, y, z1], [x, y, z0], HULL_MIN, HULL_STAND), c = trace(noProps, [x, y, z1], [x, y, z0], HULL_MIN, HULL_STAND);
    n++;
    if (a.end[2] > c.end[2] + 1) { worse++; if (out.length < 60) out.push(`${x},${y}: props ${a.end[2].toFixed(1)} n ${a.normal.map(v => v.toFixed(2))} vs brushes ${c.end[2].toFixed(1)} n ${c.normal.map(v => v.toFixed(2))}`); }
  }
  writeFileSync('scratch/hullcmp.out', `${worse} of ${n} columns: a prop hull above the brushes\n` + out.join('\n') + '\n');
}, 600000);
