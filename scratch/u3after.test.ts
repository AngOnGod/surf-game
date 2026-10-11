// utopia_v3: the verified autopilot to the booster, then where it goes (every 0.25 s) until it falls or finishes
import { it } from 'vitest';
import { appendFileSync, readFileSync } from 'node:fs';
import { DEFAULTS, hlen } from '../src/physics';
import { Session } from '../src/game';
import { resolveMap } from '../src/bsp';
import { makeBot } from '../src/bot';
import m from '../src/maps/utopia_v3';
it('after the booster', async () => {
  const b = readFileSync('public/maps/surf_utopia_v3.bsp'), def = await resolveMap(m, async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const s = new Session(def, { ...DEFAULTS }), bot = makeBot(def.route!, s.world, s.s, undefined, true, { flags: def.routeFlags, hazard: s.hazard });
  const booster = def.pushes!.find(q => q.vel[0] > 0 && q.min[2] < -1000)!;
  appendFileSync(process.env.OUT!, `booster ${booster.min.map(Math.round)} .. ${booster.max.map(Math.round)} vel ${booster.vel.map(Math.round)}\n`);
  let boosted = -1;
  for (let i = 0; i < 128 * 120; i++) {
    s.step(bot(s.p));
    const o = s.p.origin, evs = s.events.splice(0);
    if (boosted < 0 && o.every((v, k) => v >= booster.min[k] - 16 && v <= booster.max[k] + 16)) boosted = i;
    if (boosted >= 0 && (i - boosted) % 32 === 0) appendFileSync(process.env.OUT!, `t+${((i - boosted) / 128).toFixed(2)} ${o.map(Math.round)} v ${s.p.vel.map(Math.round)} |v| ${Math.round(hlen(s.p.vel))}\n`);
    if (evs.length) appendFileSync(process.env.OUT!, `t=${(i / 128).toFixed(2)} events ${evs.map(e => e.type).join(',')} at ${o.map(Math.round)}\n`);
    if (evs.some(e => e.type === 'fail' || e.type === 'finish')) break;
  }
}, 600000);
