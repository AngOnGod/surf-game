import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { DEFAULTS } from '../src/physics';
import { Session } from '../src/game';
import { resolveMap } from '../src/bsp';
import { makeBot } from '../src/bot';
import m from '../src/maps/aircontrol';
// full-precision state per tick over a window, to diff against the browser (same loop as surf.play + surf.advance)
it('det', async () => {
  const def = await resolveMap(m, async () => { const b = readFileSync('public/bsp/surf_aircontrol_ksf.bsp'); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); });
  const s = new Session(def, { ...DEFAULTS }), bot = makeBot(def.route!, s.world, s.s, undefined, !!def.routeOnSurface, { flags: def.routeFlags, hazard: s.hazard, bisect: def.routeCorners });
  const [a, b] = (process.env.WIN ?? '0,40').split(',').map(Number), out: string[] = [];
  for (let i = 1; i <= 128 * b; i++) { s.step(bot(s.p)); if (i >= 128 * a) out.push(`${i} ${s.p.origin.join(',')} ${s.p.vel.join(',')} ${s.p.yaw}`); }
  writeFileSync(process.env.OUT ?? 'scratch/acdet.out', out.join('\n') + '\n');
}, 600000);
