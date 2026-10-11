import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolveMap } from '../src/bsp';
import m from '../src/maps/kitsune';
it('white info', async () => {
  const def = await resolveMap(m, async () => { const b = readFileSync('public/maps/surf_kitsune.bsp'); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); });
  const st = def.stages![8], out = [`White spawn ${st.spawn.pos} yaw ${st.spawn.yaw}; start ${st.start.min}..${st.start.max}; end ${st.end.min}..${st.end.max}`];
  for (const f of def.fails!) if (f.max[0] > -16500 && f.min[0] < -10000 && f.max[2] > -2000 && f.min[2] < 11500 && (f.max[0] - f.min[0]) < 20000)
    out.push(`fail ${f.min.map(Math.round)}..${f.max.map(Math.round)}${f.to ? ' -> ' + f.to.pos.map(Math.round) : ''}${f.quiet ? ' quiet' : ''}${f.filter ? ' filter ' + f.filter.name + (f.filter.negate ? '!' : '') : ''}`);
  for (const f of def.fails!) if (f.to && f.to.pos[1] > 9000 && f.to.pos[1] < 11300 && f.to.pos[2] < -10000) out.push(`INTO TUBE: ${f.min.map(Math.round)}..${f.max.map(Math.round)} -> ${f.to.pos.map(Math.round)} yaw ${f.to.yaw}${f.quiet ? ' quiet' : ''}${f.filter ? ' filter ' + f.filter.name : ''}`);
  writeFileSync('scratch/white.out', out.join('\n') + '\n');
});
