// kitsune: speed through each stage's exit teleport (kept, as in Source), then whether the autopilot carries on into
// the next stage with it. TICK=, PAR=.
import { it } from 'vitest';
import { appendFileSync, readFileSync } from 'node:fs';
import { DEFAULTS, NO_CMD } from '../src/physics';
import { Session } from '../src/game';
import { resolveMap } from '../src/bsp';
import { makeBot } from '../src/bot';
import kitsune from '../src/maps/kitsune';
it('carry', async () => {
  const b = readFileSync('public/maps/surf_kitsune.bsp'), def = await resolveMap(kitsune, async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  const tick = +(process.env.TICK ?? 128), hs = (v: number[]) => Math.hypot(v[0], v[1]).toFixed(0);
  for (let k = 0; k < 8; k++) {
    const s = new Session(def, { ...DEFAULTS, tickrate: tick }), bot = makeBot(def.route!, s.world, s.s, undefined, true, { flags: def.routeFlags, hazard: s.hazard, bisect: def.routeCorners, settle: !!process.env.SETTLE });
    s.respawn(def.stages![k].spawn);
    if (+(process.env.PAR ?? 0)) s.step(NO_CMD);
    let out = '', i = 0, res = 'timeout';
    for (; i < tick * 80; i++) {
      const v = [...s.p.vel];
      s.step(bot(s.p));
      const evs = s.events.splice(0);
      if (evs.some(e => e.type === 'fail')) { res = out ? 'fail' : 'fail (before the exit)'; break; }
      if (!out && s.stage.index === k + 1) {
        const yaw = def.stages![k + 1].spawn.yaw, rel = (Math.atan2(v[1], v[0]) * 180 / Math.PI - yaw + 540) % 360 - 180;
        out = `exit ${hs(v)} u/s (z ${v[2].toFixed(0)}) -> in ${hs(s.p.vel)} u/s, ${rel.toFixed(0)}° off the new view; `;
      }
      if (out && evs.some(e => e.type === 'stage' && e.index === k + 1)) { res = 'next stage done'; break; }
      if (out && process.env.TRACE === String(k + 2) && i % (tick / 16) === 0) appendFileSync(process.env.OUT!, `  t=${(i / tick).toFixed(2)} ${s.p.origin.map(Math.round)} v ${s.p.vel.map(Math.round)} ${s.p.onGround ? 'ground' : ''}\n`);
    }
    appendFileSync(process.env.OUT!, `stage ${k + 1} -> ${k + 2}: ${out || 'no exit; '}${res} at ${(i / tick).toFixed(1)}s, at ${s.p.origin.map(Math.round)}` + '\n');
  }
}, 600_000);
