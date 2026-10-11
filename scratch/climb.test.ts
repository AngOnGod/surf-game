import { it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DEFAULTS, NO_CMD, type Player } from '../src/physics';
import { type MapDef, Session } from '../src/game';
import { resolveMap } from '../src/bsp';
import { makeBot } from '../src/bot';
// is the climb from the east curve up to the next ramp possible at all? from the autopilot's state on the curve,
// scripted inputs: hold strafe-left (into the face) while turning left at a fixed rate, for a while, then let go;
// best height reached when passing y = -100 (the next ramp starts there, its faces at z ~3400-3800)
const defs = Object.values(import.meta.glob<{ default: MapDef }>('../src/maps/*.ts', { eager: true })).map(m => m.default);
it('climb', async () => {
  const m = defs.find(d => d.id === 'mesa')!;
  const def = await resolveMap(m, async () => { const b = readFileSync('public/maps/surf_mesa.bsp'); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); });
  const s0 = new Session(def, { ...DEFAULTS }), bot = makeBot(def.route!, s0.world, s0.s, undefined, true, { flags: def.routeFlags, hazard: s0.hazard });
  const T0 = +(process.env.T0 ?? 29.5);
  for (let i = 0; i < 128 * T0; i++) s0.step(bot(s0.p));
  const start: Player = structuredClone(s0.p), out = [`start ${start.origin.map(Math.round)} v ${start.vel.map(Math.round)}`];
  let best = { z: -1e9, d: '' };
  for (const rate of [0, 0.1, 0.2, 0.3, 0.45, 0.6, 0.8, 1.0, 1.3]) for (const hold of [16, 32, 48, 64, 96, 128, 160, 200]) for (const side of [-1, 1]) {
    const s = new Session(def, { ...DEFAULTS }); s.p = structuredClone(start); s.section = 2; s.snap();
    s.p.yaw = Math.atan2(start.vel[1], start.vel[0]) * 180 / Math.PI;
    let at = -1e9, failed = false;
    for (let k = 0; k < 128 * 2 && s.p.origin[1] > -100; k++) {
      if (k < hold) s.p.yaw += rate * -side;
      s.step(k < hold ? { ...NO_CMD, side } : NO_CMD);
      if (s.events.splice(0).some(e => e.type === 'fail')) { failed = true; break; }
      at = s.p.origin[2];
    }
    if (!failed && s.p.origin[1] <= -100 && at > best.z) best = { z: at, d: `rate ${rate} hold ${hold} side ${side} -> z ${at.toFixed(0)} at ${s.p.origin.map(Math.round)}` };
  }
  out.push(`best: ${best.d || 'none reached y -100 alive'}`);
  writeFileSync('scratch/climb.out', out.join('\n') + '\n');
}, 1800000);
