import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { DEFAULTS, NO_CMD } from '../src/physics';
import { Session } from '../src/game';
import { resolveMap } from '../src/bsp';
import { makeBot } from '../src/bot';
import m from '../src/maps/aircontrol';
// robustness: full runs from N nudged starts (x += k * 1.7e-6, tick counter and parity varied); pass rate + where runs fail
it('aircontrol robustness', async () => {
  const def = await resolveMap(m, async () => { const b = readFileSync('public/bsp/surf_aircontrol_ksf.bsp'); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); });
  const tick = +(process.env.TICK ?? 128), N = +(process.env.N ?? 20), out: string[] = []; let ok = 0;
  for (let k = 0; k < N; k++) {
    const s = new Session(def, { ...DEFAULTS, tickrate: tick }), bot = makeBot(def.route!, s.world, s.s, undefined, true, { hazard: s.hazard });
    s.p.tick = k & 1; s.p.origin = [s.p.origin[0] + k * 1.7e-6, s.p.origin[1], s.p.origin[2]];
    if (k & 2) s.step(NO_CMD);
    let res = 'timeout', splits = 0;
    for (let i = 0; i < tick * 120 && res === 'timeout'; i++) {
      s.step(bot(s.p));
      for (const e of s.events.splice(0)) {
        if (e.type === 'split') splits++;
        if (e.type === 'fail') res = `FAIL after ${splits} splits at ${s.p.origin.map(Math.round)} (${(i / tick).toFixed(1)}s)`;
        if (e.type === 'finish') { res = `done ${(i / tick).toFixed(2)}s`; ok++; }
      }
    }
    out.push(`${k}: ${res}`);
  }
  writeFileSync(process.env.OUT ?? 'scratch/acrobust.out', `${ok}/${N} at ${tick} tick\n` + out.join('\n') + '\n');
}, 3_600_000);
