import { it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DEFAULTS, hlen, len, type Vec } from '../src/physics';
import { type MapDef, Session } from '../src/game';
import { resolveMap } from '../src/bsp';
import { makeBot } from '../src/bot';
// rampbug census: autopilot runs over every map; a tick where an airborne player touching a surf face keeps < SHARE of
// its speed without a teleport, logged with what it touched (the plane normal it ended on)
const defs = Object.values(import.meta.glob<{ default: MapDef }>('../src/maps/*.ts', { eager: true })).map(m => m.default);
const file = (d: MapDef) => d.bsp && ['public/maps/', 'public/bsp/'].map(p => p + d.bsp!.url.split('/').pop()).find(existsSync);
it('rampbug census', async () => {
  const out: string[] = [], SHARE = +(process.env.SHARE ?? 0.6), ticks = (process.env.TICKS ?? '128').split(',').map(Number);
  for (const m of defs) {
    if (m.id === 'test' || (m.bsp && !file(m))) continue;
    const def = await resolveMap(m, async () => { const b = readFileSync(file(m)!); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); });
    for (const tickrate of ticks) {
      const s = new Session(def, { ...DEFAULTS, tickrate, rampfix: process.env.FIX === '1' } as any), bot = makeBot(def.route!, s.world, s.s, undefined, !!def.routeOnSurface, { flags: def.routeFlags, hazard: s.hazard, bisect: def.routeCorners });
      let events = 0, worst: string[] = [];
      for (let i = 0; i < tickrate * 90; i++) {
        const v0 = len(s.p.vel), n0 = s.p.lastNormal, onRamp = s.p.tick - s.p.touchTick <= 2 && n0[2] > 0.05 && n0[2] < 0.7, air = !s.p.onGround, o0 = s.p.origin;
        s.step(bot(s.p));
        const evs = s.events.splice(0), jumped = Math.hypot(...([0, 1, 2].map(k => s.p.origin[k] - o0[k])) as [number, number, number]) > 200;
        if (evs.some(e => e.type === 'finish')) break;
        if (air && onRamp && v0 > 300 && !jumped && len(s.p.vel) < SHARE * v0) {
          events++;
          if (worst.length < 6) worst.push(`  t=${(i / tickrate).toFixed(2)} ${v0.toFixed(0)}->${len(s.p.vel).toFixed(0)} at ${s.p.origin.map(Math.round)} ramp n ${n0.map(x => x.toFixed(2))} now n ${s.p.lastNormal.map(x => x.toFixed(2))}`);
        }
      }
      out.push(`${m.id} @${tickrate}: ${events} sudden stops on ramps`, ...worst);
    }
  }
  writeFileSync(process.env.OUT ?? 'scratch/rampbug.out', out.join('\n') + '\n');
}, 1800000);
