// Ramp brushes (a drawn face with 0.05 < n.z < 0.7) and kill/teleport trigger brushes inside BOX=x0,y0,z0,x1,y1,z1
// (BSP=, .gz ok): bounds, the surf faces' normals and heights; sorted along SORT=x|y|z.
import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { makeBrush } from '../src/physics';
import { parseBsp, unpack } from '../src/bsp';
import { buildBrush } from '../src/game';
it('ramps of', async () => {
  const b = readFileSync(process.env.BSP!), bsp = parseBsp(await unpack(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)));
  const bx = process.env.BOX!.split(',').map(Number), ax = 'xyz'.indexOf(process.env.SORT ?? 'y'), out: [number, string][] = [];
  const inBox = (mn: number[], mx: number[]) => [0, 1, 2].every(k => mx[k] >= bx[k] && mn[k] <= bx[k + 3]);
  const r = (v: number[]) => v.map(Math.round).join(',');
  for (const d of bsp.brushes) {
    const br = buildBrush(d);
    if (d.type !== 'planes' || !inBox(br.min, br.max)) continue;
    const surf = br.faces.filter(f => f.n[2] > 0.05 && f.n[2] < 0.7 && (process.env.CLIP || f.color !== null)), floor = br.faces.filter(f => f.n[2] >= 0.7 && (process.env.CLIP || f.color !== null));
    if (!surf.length && !process.env.ALL) continue;
    out.push([br.min[ax], `${surf.length ? (br.faces.every(f => f.color === null) ? 'ramp(clip)' : 'RAMP') : 'brush'} ${r(br.min)} .. ${r(br.max)}${d.nonsolid ? ' nonsolid' : ''}${d.glass ? ' glass' : ''}  ${surf.map(f => `n(${f.n.map(v => v.toFixed(2))}) z${Math.round(Math.min(...f.verts.map(v => v[2])))}..${Math.round(Math.max(...f.verts.map(v => v[2])))}`).join('  ')}${floor.length ? `  top z${Math.round(Math.max(...floor.flatMap(f => f.verts.map(v => v[2]))))}` : ''}`]);
  }
  for (const f of bsp.fails) for (const sh of f.shape ?? [[]]) {
    const br = sh.length ? makeBrush(sh.map(([x, y, z, w]) => ({ n: [x, y, z], d: w }))) : { min: f.min, max: f.max };
    if (inBox(br.min, br.max)) out.push([br.min[ax], `${f.to ? (f.keep ? 'TELEPORT' : 'tele') : 'KILL'} ${r(br.min)} .. ${r(br.max)}${f.to ? ` -> ${r(f.to.pos)}` : ''}`]);
  }
  out.sort((a, c) => a[0] - c[0]);
  writeFileSync(process.env.OUT!, out.map(o => o[1]).join('\n') + `\n${out.length} items\n`);
}, 600000);
