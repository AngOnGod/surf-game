// How far the route-following autopilot gets on its own (MAP=, TICK=, SECS=, both tick parities): the furthest
// waypoint it passed, every fall (time, waypoint, position, speed) and the finish time if it got there.
import { it } from 'vitest';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { type MapDef, Session } from '../src/game';
import { DEFAULTS, NO_CMD, hlen } from '../src/physics';
import { resolveMap } from '../src/bsp';
import { makeBot } from '../src/bot';

const maps = Object.values(import.meta.glob<{ default: MapDef }>('../src/maps/*.ts', { eager: true })).map(m => m.default);

it('route bot', async () => {
  const m = maps.find(x => x.id === (process.env.MAP ?? 'utopia_v3'))!, file = ['public/maps/', 'public/bsp/'].map(d => d + m.bsp!.url.split('/').pop()).find(existsSync)!;
  const def = await resolveMap(m, async () => { const b = readFileSync(file); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); });
  const tick = +(process.env.TICK ?? 128), route = def.route!, secs = +(process.env.SECS ?? 90), OUT = `scratch/${m.id}-bot.out`;
  writeFileSync(OUT, '');
  for (const par of [0, 1]) {
    const s = new Session(def, { ...DEFAULTS, tickrate: tick }), bot = makeBot(route, s.world, s.s, undefined, !!def.routeOnSurface, { flags: def.routeFlags, hazard: s.hazard, bisect: def.routeCorners, settle: true });
    if (par) s.step(NO_CMD);
    let far = -1, fin = -1;
    const log: string[] = [];
    for (let i = 0; i < tick * secs && fin < 0; i++) {
      const k = bot.save().k, o = s.p.origin, v = s.p.vel;
      s.step(bot(s.p));
      far = Math.max(far, bot.save().k);
      for (const e of s.events.splice(0)) {
        if (e.type === 'fail') log.push(`  ${(i / tick).toFixed(2)}s fell past waypoint ${k} ${route[k]?.slice(0, 3).map(Math.round)} at ${o.map(Math.round)} speed ${Math.round(hlen(v))} vz ${Math.round(v[2])}`);
        if (e.type === 'finish') fin = e.time;
      }
      if (process.env.TRACE && i % tick === 0) log.push(`  ${(i / tick).toFixed(0)}s k ${k} at ${o.map(Math.round)} speed ${Math.round(hlen(v))} vz ${Math.round(v[2])} E ${Math.round(o[2] + (v[0] ** 2 + v[1] ** 2 + v[2] ** 2) / 1600)}`);
    }
    appendFileSync(OUT, `parity ${par}: ${fin >= 0 ? `finished ${fin.toFixed(3)}` : 'no finish'}, furthest waypoint ${far} of ${route.length} ${route[far]?.slice(0, 3).map(Math.round)}\n` + log.join('\n') + '\n');
  }
}, 600_000);
