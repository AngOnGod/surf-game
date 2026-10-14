// Static props per map (BSP=, .gz ok): models drawn, copies, triangles, collision hulls; load time
import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseBsp, unpack } from '../src/bsp';
it('props', async () => {
  const out: string[] = [];
  for (const f of process.env.BSP!.split(',')) {
    const b = readFileSync(f), buf = await unpack(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), t0 = performance.now(), bsp = parseBsp(buf), ms = performance.now() - t0;
    const tris = bsp.props.reduce((a, p) => a + (p.pos.length / 9) * p.at.length, 0), uniq = bsp.props.reduce((a, p) => a + p.pos.length / 9, 0);
    const hullBrushes = bsp.brushes.filter(d => d.type === 'planes' && d.faceColors?.every(c => c === null) && d.planes.length > 6).length;
    out.push(`${f}: ${bsp.props.length} models, ${bsp.props.reduce((a, p) => a + p.at.length, 0)} copies, ${uniq} unique triangles, ${tris} drawn; ${bsp.brushes.length} brushes (${hullBrushes} invisible ones with > 6 planes); ${bsp.tris.order.length} rock triangles; parse ${ms.toFixed(0)} ms`);
    const cols = bsp.props.map(p => [...p.col.subarray(0, 3)].map(v => v.toFixed(2)).join(','));
    out.push('  first colours: ' + cols.slice(0, 12).join(' | '));
  }
  writeFileSync('scratch/props.out', out.join('\n') + '\n');
}, 600000);
