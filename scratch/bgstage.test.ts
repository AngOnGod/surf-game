// surf_beginner autopilot per stage (BSP=path, STAGES=1,2,.. TICKS=256,128, TRACE=n: last n quarter-second samples on a
// miss; CHAIN=1: the whole run from the spawn, carrying speed; VEL=x,y,z: a stage entered at that velocity). Writes scratch/bg-stage.out.
import { it } from 'vitest';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { DEFAULTS, NO_CMD, hlen, type Vec } from '../src/physics';
import { type MapDef, Session } from '../src/game';
import { resolveMap } from '../src/bsp';
import { makeBot } from '../src/bot';
import m from '../src/maps/beginner';
const f = (v: Vec | number[], d = 0) => v.map(x => x.toFixed(d)).join(',');
const OUT = 'scratch/bg-stage.out';
it('beginner stages', async () => {
  const def: MapDef = await resolveMap(m, async () => { const b = readFileSync(process.env.BSP!); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); });
  const stages = (process.env.STAGES ?? '1,2,3,4,5,6,7').split(',').map(Number), ticks = (process.env.TICKS ?? '256,128').split(',').map(Number);
  writeFileSync(OUT, '');
  for (const tick of ticks) for (const k of process.env.CHAIN ? [0] : stages) for (const par of [0, 1]) {
    const s = new Session(def, { ...DEFAULTS, tickrate: tick }), route = def.route ?? [], bot = makeBot(route, s.world, s.s, undefined, true, { flags: def.routeFlags, hazard: s.hazard, bisect: def.routeCorners, settle: true });
    if (k) { s.respawn(def.stages![k - 1].spawn); if (process.env.VEL) { s.p.vel = process.env.VEL.split(',').map(Number) as Vec; } } // VEL=x,y,z: arriving through a portal at speed (a chained run)
    if (par) s.step(NO_CMD);
    let res = 'timeout', peak = 0, far = 0, falls = 0;
    const hist: string[] = [], done: string[] = [];
    for (let i = 0; i < tick * (k ? 30 : 120) && res === 'timeout'; i++) {
      s.step(bot(s.p)); peak = Math.max(peak, hlen(s.p.vel)); far = Math.max(far, bot.save().k);
      if (i % (tick / 4) === 0) hist.push(`   t=${(i / tick).toFixed(2)} k ${bot.save().k} o ${f(s.p.origin)} h ${hlen(s.p.vel).toFixed(0)} vz ${s.p.vel[2].toFixed(0)} n ${f(s.p.lastNormal, 2)}${s.p.onGround ? ' ground' : ''}`);
      for (const e of s.events.splice(0)) {
        if (e.type === 'fail') { falls++; if (k || falls >= 3) res = `FELL at ${f(s.p.origin)} past waypoint ${bot.save().k} ${f(route[bot.save().k] ?? [])}`; }
        if (e.type === 'stage') { done.push(`s${e.index + 1} ${e.time.toFixed(2)}`); if (k && e.index === k - 1) res = `done ${e.time.toFixed(2)}s`; }
        if (e.type === 'finish') res = `FINISHED ${e.time.toFixed(3)}s`;
      }
    }
    appendFileSync(OUT, `${k ? `stage ${k}` : 'chain'} tick ${tick} par ${par}: ${res} peak ${peak.toFixed(0)} furthest wp ${far}${done.length ? ` [${done.join(', ')}]` : ''}${falls ? ` falls ${falls}` : ''}\n`);
    if (process.env.TRACE && !res.startsWith('done') && !res.startsWith('FIN')) appendFileSync(OUT, hist.slice(-+process.env.TRACE).join('\n') + '\n');
  }
}, 3_600_000);
