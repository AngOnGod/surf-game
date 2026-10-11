import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseBsp } from '../src/bsp';
it('kitsune teleports', () => {
  const b = readFileSync('public/maps/surf_kitsune.bsp'), bsp = parseBsp(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const r = (v: number[]) => v.map(Math.round).join(',');
  console.log('fails', bsp.fails.length);
  const names = new Map(bsp.entities.filter(e => e.classname === 'info_teleport_destination').map(e => [e.origin, e.targetname]));
  [...bsp.fails].sort((a, b) => a.min[2] - b.min[2]).forEach(f => console.log('tele', r(f.min), '..', r(f.max), '->', f.to ? names.get(f.to.pos.join(' ')) ?? r(f.to.pos) : 'KILL', f.to ? r(f.to.pos) : '', f.shape ? `shape ${f.shape.length}` : ''));
  bsp.entities.filter(e => /func_brush|func_illusionary|func_button|filter_|ambient|sky_camera/.test(e.classname)).forEach(e => console.log(e.classname, e.targetname ?? '', e.origin ?? '', e.model ?? '', JSON.stringify(e).slice(0, 220)));
});
