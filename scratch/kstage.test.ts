import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFAULTS, NO_CMD, hlen, type Vec } from '../src/physics';
import { Session } from '../src/game';
import { resolveMap } from '../src/bsp';
import { makeBot } from '../src/bot';
import m from '../src/maps/kitsune';
const f = (v: Vec | number[], d = 0) => v.map(x => x.toFixed(d)).join(',');
it('kitsune stages', async () => {
  const def = await resolveMap(m, async () => { const b = readFileSync('public/maps/surf_kitsune.bsp'); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); });
  const stages = (process.env.STAGES ?? '1,2,3,4,5').split(',').map(Number), ticks = (process.env.TICKS ?? '128,64').split(',').map(Number);
  for (const k of stages) for (const tick of ticks) for (const par of [0, 1]) {
    const s = new Session(def, { ...DEFAULTS, tickrate: tick }), bot = makeBot(def.route!, s.world, s.s, undefined, true, { flags: def.routeFlags, hazard: s.hazard, bisect: true });
    s.respawn(def.stages![k - 1].spawn); if (par) s.step(NO_CMD);
    let res = 'timeout', peak = 0; const hist: string[] = [];
    for (let i = 0; i < tick * 40 && res === 'timeout'; i++) {
      s.step(bot(s.p)); peak = Math.max(peak, hlen(s.p.vel));
      if (process.env.TRACE && i % (tick / 4) === 0) hist.push(`   t=${(i / tick).toFixed(2)} o ${f(s.p.origin)} h ${hlen(s.p.vel).toFixed(0)} vz ${s.p.vel[2].toFixed(0)} n ${f(s.p.lastNormal, 2)} gnd ${s.p.onGround}`);
      for (const e of s.events.splice(0)) {
        if (e.type === 'fail') res = `FAIL at ${f(s.p.origin)} (from ${hist.at(-1)?.slice(0, 60) ?? ''})`;
        if (e.type === 'stage') res = `done ${e.time.toFixed(2)}s`;
      }
    }
    console.log(`stage ${k} ${def.stages![k - 1].name} tick ${tick} par ${par}: ${res} peak ${peak.toFixed(0)}`);
    if (process.env.TRACE && !res.startsWith('done')) console.log(hist.slice(-+(process.env.TRACE)).join('\n'));
  }
}, 600000);
