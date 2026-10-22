// surf_beginner layout probe (BSP=path): spawn, teleports (box, centre, destination), pushes, triggers, and the surf
// faces (solid, 0.05 < nz < 0.7) grouped by brush, sorted by position. Writes scratch/bg-probe.txt.
import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseBsp } from '../src/bsp';
import { buildBrush } from '../src/game';

it('probe', () => {
  const raw = readFileSync(process.env.BSP ?? 'public/maps/surf_beginner.bsp'), b = parseBsp(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
  const r = (v: number[]) => v.map(Math.round).join(' '), out: string[] = [];
  out.push(`spawn ${r(b.spawn.pos)} yaw ${b.spawn.yaw}; bounds ${r(b.bounds.min)} .. ${r(b.bounds.max)}; brushes ${b.brushes.length}; tris ${b.tris.count ?? '?'}; props ${b.props.length}; settings ${JSON.stringify(b.settings)}`);
  for (const f of b.fails) out.push(`fail c ${r(f.min.map((v, k) => (v + f.max[k]) / 2))} size ${r(f.max.map((v, k) => v - f.min[k]))} -> ${f.to ? `${r(f.to.pos)} yaw ${f.to.yaw}` : 'stage start'}${f.filter ? ' filter' : ''}`);
  for (const p of b.pushes) out.push(`push ${r(p.min)} .. ${r(p.max)} vel ${r(p.vel)}${p.once ? ' once' : ''}`);
  for (const t of b.triggers) out.push(`trigger ${r(t.min)} .. ${r(t.max)} ${t.e.classname} ${Object.entries(t.e).filter(([k]) => k.startsWith('on')).map(([k, v]) => `${k}=${v}`).join(' ')}`);
  const surf: string[] = [];
  for (const d of b.brushes) {
    if (d.type !== 'planes' || d.nonsolid) continue;
    const br = buildBrush(d), faces = br.planes.filter(p => p.n[2] > 0.05 && p.n[2] < 0.7);
    if (!faces.length) continue;
    surf.push(`surf ${r(br.min)} .. ${r(br.max)} n ${faces.map(p => p.n.map(x => x.toFixed(2)).join(',')).join(' | ')}${d.faceColors?.every(c => c === null) ? ' (invisible)' : ''}`);
  }
  out.push(`${surf.length} surf brushes`, ...surf.sort());
  writeFileSync('scratch/bg-probe.txt', out.join('\n') + '\n');
});
