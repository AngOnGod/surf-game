import { it } from 'vitest';
import { appendFileSync, readFileSync } from 'node:fs';
import { DEFAULTS } from '../src/physics';
import { Session } from '../src/game';
import { resolveMap } from '../src/bsp';
import { makeBot } from '../src/bot';
import m from '../src/maps/utopia_v3';
it('bench', async () => {
  const b = readFileSync('public/maps/surf_utopia_v3.bsp'), def = await resolveMap(m, async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const s = new Session(def, { ...DEFAULTS }), bot = makeBot(def.route!, s.world, s.s, undefined, true, {});
  const cmds = [];
  for (let i = 0; i < 128 * 60; i++) { const c = bot(s.p); cmds.push(c); s.step(c); s.events.length = 0; }
  const s2 = new Session(def, { ...DEFAULTS }), t0 = performance.now();
  for (let r = 0; r < 3; r++) { s2.restart(); for (const c of cmds) { s2.step(c); s2.events.length = 0; } }
  const us = (performance.now() - t0) * 1000 / (3 * cmds.length);
  appendFileSync(process.env.OUT!, `${us.toFixed(2)} us per tick (Session.step, utopia_v3), ${def.world!.length} brushes, ${def.fails!.length} fails\n`);
}, 600000);
