import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { DEFAULTS, type Cmd } from '../src/physics';
import { Session } from '../src/game';
import { resolveMap } from '../src/bsp';
import { makeBot } from '../src/bot';
import ac from '../src/maps/aircontrol';
import u3 from '../src/maps/utopia_v3';
// cost per tick: movement + triggers alone (replaying recorded commands), and with the autopilot deciding
it('tick cost', async () => {
  const out: string[] = [];
  for (const [m, file] of [[ac, 'public/bsp/surf_aircontrol_ksf.bsp'], [u3, 'public/maps/surf_utopia_v3.bsp']] as const) {
    const def = await resolveMap(m, async () => { const b = readFileSync(file); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); });
    for (const tickrate of [128, 256, 512]) {
      const s = new Session(def, { ...DEFAULTS, tickrate }), bot = makeBot(def.route!, s.world, s.s, undefined, true, { hazard: s.hazard }), cmds: Cmd[] = [];
      const N = tickrate * 30;
      let t = performance.now();
      for (let i = 0; i < N; i++) { const c = bot(s.p); cmds.push(c); s.step(c); }
      const withBot = (performance.now() - t) / N;
      const r = new Session(def, { ...DEFAULTS, tickrate });
      t = performance.now();
      for (const c of cmds) { r.p.yaw = r.p.yaw; r.step(c); }
      const step = (performance.now() - t) / N;
      out.push(`${m.id} ${tickrate} tick: step ${(step * 1000).toFixed(1)} µs, with autopilot ${(withBot * 1000).toFixed(1)} µs; per second of play ${(step * tickrate).toFixed(2)} ms (${(withBot * tickrate).toFixed(2)} ms autopilot); brushes ${s.world.length}`);
    }
  }
  writeFileSync('scratch/tickbench.out', out.join('\n') + '\n');
}, 600000);
