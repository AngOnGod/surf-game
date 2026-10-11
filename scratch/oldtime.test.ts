// the old route-following autopilot's finish time on a map (MAP, TICK), from a fresh start
import { it } from 'vitest';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import type { MapDef } from '../src/game';
import { DEFAULTS } from '../src/physics';
import { Session } from '../src/game';
import { resolveMap } from '../src/bsp';
import { makeBot } from '../src/bot';
const mods = import.meta.glob<{ default: MapDef }>('../src/maps/*.ts', { eager: true });
it('old bot time', async () => {
  for (const id of process.env.MAPS!.split(',')) {
    const m = Object.values(mods).map(x => x.default).find(x => x.id === id)!, tick = +(process.env.TICK ?? 128);
    const def = await resolveMap(m, async () => { const b = readFileSync(['public/maps/', 'public/bsp/'].map(d => d + m.bsp!.url.split('/').pop()).find(existsSync)!); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); });
    const s = new Session(def, { ...DEFAULTS, tickrate: tick }), bot = makeBot(def.route!, s.world, s.s, undefined, !!def.routeOnSurface, { flags: def.routeFlags, hazard: s.hazard, bisect: def.routeCorners });
    let res = 'no finish', falls = 0;
    for (let i = 0; i < tick * 200; i++) { s.step(bot(s.p)); for (const e of s.events.splice(0)) { if (e.type === 'fail') falls++; if (e.type === 'finish') { res = `finished ${e.time.toFixed(3)}`; i = 1e9; } } }
    appendFileSync(process.env.OUT!, `${id} @${tick}: old autopilot ${res}, ${falls} falls\n`);
  }
}, 1200000);
