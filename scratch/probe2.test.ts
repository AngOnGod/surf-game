// Which brushes (and which static props' hulls) overlap a standing player at P (BSP=)
import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { HULL_MIN, HULL_STAND, type Vec, trace } from '../src/physics';
import { parseBsp, unpack } from '../src/bsp';
import { readPak, staticProps } from '../src/mdl';
import { buildBrush } from '../src/game';
it('probe2', async () => {
  const b = readFileSync(process.env.BSP!), buf = await unpack(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), bsp = parseBsp(buf), p = process.env.P!.split(',').map(Number) as Vec, out: string[] = [];
  bsp.brushes.forEach((d, i) => { const br = buildBrush(d); if (trace(Object.assign([br], {}), p, p, HULL_MIN, HULL_STAND).startsolid) out.push(`brush ${i} ${br.min.map(Math.round)}..${br.max.map(Math.round)} planes ${br.planes.length} drawn ${br.faces.some(f => f.color !== null)}`); });
  const u8 = new Uint8Array(buf), dv = new DataView(buf), gl = { ofs: dv.getInt32(8 + 35 * 16, true) };
  for (const pr of staticProps(u8, gl.ofs)) if (Math.hypot(pr.origin[0] - p[0], pr.origin[1] - p[1], pr.origin[2] - p[2]) < 1500) out.push(`prop ${pr.model} at ${pr.origin.map(Math.round)} ang ${pr.angles.map(Math.round)} solid ${pr.solid}`);
  writeFileSync('scratch/probe2.out', out.join('\n') + '\n');
}, 600000);
