import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { DEFAULTS } from '../src/physics';
import { Session } from '../src/game';
import { resolveMap } from '../src/bsp';
import { makeBot } from '../src/bot';
import m from '../src/maps/aircontrol';
it('samples', async () => {
  const def = await resolveMap(m, async () => { const b = readFileSync('public/bsp/surf_aircontrol_ksf.bsp'); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); });
  const s = new Session(def, { ...DEFAULTS }), bot = makeBot(def.route!, s.world, s.s, undefined, !!def.routeOnSurface, { flags: def.routeFlags, hazard: s.hazard, bisect: def.routeCorners });
  const out: string[] = [`route ${def.route!.length} first ${def.route![1].map(x => x.toFixed(3))}`];
  for (let i = 1; i <= 128 * 75; i++) { s.step(bot(s.p)); if (i % 1280 === 0) out.push(`${i / 128}s ${s.p.origin.map(x => x.toFixed(1))} v ${s.p.vel.map(x => x.toFixed(1))}`); }
  writeFileSync('scratch/acsample.out', out.join('\n') + '\n');
});
