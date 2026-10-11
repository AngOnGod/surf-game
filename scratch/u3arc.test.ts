// utopia_v3: coast a player from a state (FROM x,y,z; VEL vx,vy,vz) with no input; log the path and every contact
import { it } from 'vitest';
import { appendFileSync, readFileSync } from 'node:fs';
import { DEFAULTS, NO_CMD, newPlayer, type Vec } from '../src/physics';
import { Session } from '../src/game';
import { resolveMap } from '../src/bsp';
import m from '../src/maps/utopia_v3';
it('arc', async () => {
  const b = readFileSync('public/maps/surf_utopia_v3.bsp'), def = await resolveMap(m, async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const s = new Session(def, { ...DEFAULTS }), out = (t: string) => appendFileSync(process.env.OUT!, t + '\n');
  for (const run of process.env.RUNS!.split(';')) {
    const [o, v] = run.split('|').map(q => q.split(',').map(Number) as Vec);
    Object.assign(s.p, newPlayer(o, 0, 0), { vel: v, tick: 100 }); s.events.length = 0;
    out(`from ${o} v ${v}:`);
    for (let i = 0; i < 128 * 2.2; i++) {
      const before = s.p.vel.map(Math.round).join(), touch = s.p.touchTick;
      s.step(NO_CMD);
      const ev = s.events.splice(0);
      if (ev.some(e => e.type === 'fail')) { out(`  t ${(i / 128).toFixed(2)}: fell (teleported)`); break; }
      if (s.p.touchTick !== touch) out(`  t ${(i / 128).toFixed(2)}: contact at ${s.p.origin.map(Math.round)} normal ${s.p.lastNormal.map(x => x.toFixed(2))} v ${before} -> ${s.p.vel.map(Math.round)}`);
      if (i % 16 === 0) out(`  t ${(i / 128).toFixed(2)} ${s.p.origin.map(Math.round)}`);
    }
  }
}, 600000);
