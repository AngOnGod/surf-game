import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFAULTS, NO_CMD } from '../src/physics';
import { Session } from '../src/game';
import { resolveMap } from '../src/bsp';
import m from '../src/maps/kitsune';
it('kitsune secret start', async () => {
  const def = await resolveMap(m, async () => { const b = readFileSync('public/maps/surf_kitsune.bsp'); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); });
  console.log('namers', def.namers!.length, def.namers!.map(n => `${n.name || "''"}${n.filter ? '<' + n.filter.name : ''}`).join(' '), '| filtered teleports', def.fails!.filter(f => f.filter).length);
  const s = new Session(def, DEFAULTS); let prev = '';
  const log = (i: number) => { const k = `${s.name}`; if (k !== prev) { console.log(`t=${(i / 128).toFixed(2)} name '${s.name}' at ${s.p.origin.map(Math.round)}`); prev = k; } };
  for (let i = 0; i < 128 * 4; i++) { s.step({ ...NO_CMD, fwd: -1 }); log(i); if (s.p.origin[2] > 300) break; } // back into the rear teleport
  console.log('after back:', s.p.origin.map(Math.round));
  for (let i = 0; i < 128 * 6; i++) { s.step({ ...NO_CMD, fwd: 1 }); log(i); if (s.stage.index === 0 && s.p.origin[1] < -14000) break; }
  console.log('end:', s.p.origin.map(Math.round), 'name', s.name, 'stage', s.stage.index + 1);
});
