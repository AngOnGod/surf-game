// Replay a planned run of surf_beginner (RUN=scratch/x.run.json, STAGE=index to start at that stage's spawn, BSP=path,
// TICK=256): position, speed and events every quarter second. Writes scratch/bg-replay.txt.
import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { DEFAULTS, hlen } from '../src/physics';
import { type MapDef, Session } from '../src/game';
import { resolveMap } from '../src/bsp';
import { makeBot } from '../src/bot';
import { decode, replay } from '../src/plan';
import m from '../src/maps/beginner';
it('replay', async () => {
  const def: MapDef = await resolveMap(m, async () => { const b = readFileSync(process.env.BSP!); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); });
  const tick = +(process.env.TICK ?? 256), r = JSON.parse(readFileSync(process.env.RUN!, 'utf8')), s = new Session(def, { ...DEFAULTS, tickrate: tick });
  if (process.env.STAGE) s.respawn(def.stages![+process.env.STAGE].spawn);
  const bot = replay(r.run, tick, makeBot(def.route!, s.world, s.s, undefined, true, { flags: def.routeFlags, hazard: s.hazard, bisect: def.routeCorners })), out: string[] = [];
  for (let i = 0; i < (decode(r.run).length * tick) / 16; i++) {
    s.step(bot(s.p));
    for (const e of s.events.splice(0)) if (e.type !== 'msg' && e.type !== 'split') out.push(`${(i / tick).toFixed(2)}s ${e.type}${'index' in e ? ' ' + (e.index + 1) : ''}${'time' in e ? ' ' + e.time.toFixed(3) : ''}`);
    if (i % (tick / 4) === 0) out.push(`   ${(i / tick).toFixed(2)} ${s.p.origin.map(Math.round)} speed ${Math.round(hlen(s.p.vel))} vz ${Math.round(s.p.vel[2])}${s.p.onGround ? ' ground' : ''}`);
  }
  writeFileSync('scratch/bg-replay.txt', out.join('\n') + '\n');
});
