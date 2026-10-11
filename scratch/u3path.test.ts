// utopia_v3: the old verified autopilot's path (every 0.25 s) over the first stretch, for comparing with the planner
import { it } from 'vitest';
import { appendFileSync, readFileSync } from 'node:fs';
import { DEFAULTS, hlen } from '../src/physics';
import { Session } from '../src/game';
import { resolveMap } from '../src/bsp';
import { makeBot } from '../src/bot';
import m from '../src/maps/utopia_v3';
it('path', async () => {
  const b = readFileSync('public/maps/surf_utopia_v3.bsp'), def = await resolveMap(m, async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const s = new Session(def, { ...DEFAULTS }), bot = makeBot(def.route!, s.world, s.s, undefined, true, {});
  for (let i = 0; i < 128 * +(process.env.SECS ?? 15); i++) {
    s.step(bot(s.p)); s.events.length = 0;
    if (i % 32 === 0) appendFileSync(process.env.OUT!, `t ${(i / 128).toFixed(2)} ${s.p.origin.map(Math.round)} v ${s.p.vel.map(Math.round)} |v| ${Math.round(hlen(s.p.vel))} n ${s.p.tick - s.p.touchTick <= 1 ? s.p.lastNormal.map(x => x.toFixed(2)) : '-'}\n`);
  }
}, 600000);
