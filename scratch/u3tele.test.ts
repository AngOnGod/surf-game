// utopia_v3: teleports and pushes below z = 0 (where each sends you), and the bounds of the lower map
import { it } from 'vitest';
import { appendFileSync, readFileSync } from 'node:fs';
import { parseBsp } from '../src/bsp';
it('teleports', () => {
  const b = readFileSync('public/maps/surf_utopia_v3.bsp'), bsp = parseBsp(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)), out = (t: string) => appendFileSync(process.env.OUT!, t + '\n');
  const r = (v: number[]) => v.map(Math.round).join(',');
  for (const f of bsp.fails.filter(f => f.min[2] < 0)) out(`${f.to ? 'teleport' : 'kill'} ${r(f.min)} .. ${r(f.max)}${f.to ? ' -> ' + r(f.to.pos) + ' yaw ' + f.to.yaw : ''}`);
  for (const p of bsp.pushes.filter(f => f.min[2] < 0)) out(`push ${r(p.min)} .. ${r(p.max)} vel ${r(p.vel)}${p.once ? ' once' : ''}`);
  for (const e of bsp.entities.filter(e => /trigger|func_door|func_button|logic|point_/.test(e.classname) && !/trigger_(teleport|push|hurt)/.test(e.classname))) out(`${e.classname} ${e.targetname ?? ''} ${e.origin ?? ''} ${Object.entries(e).filter(([k]) => /^On/.test(k)).map(([k, v]) => k + '=' + v).join(' ')}`.slice(0, 220));
  out(`bounds ${r(bsp.bounds.min)} .. ${r(bsp.bounds.max)}`);
});
