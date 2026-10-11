import { it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DEFAULTS } from '../src/physics';
import { type MapDef, Session, flagsOf, ridingLine, routeOf, type Station } from '../src/game';
import { resolveMap } from '../src/bsp';
import { makeBot } from '../src/bot';
// the optimiser's way (route rebuilt from STATIONS) vs the map's own route: same run?
const mods = import.meta.glob<{ default: MapDef; STATIONS: Station[] }>('../src/maps/*.ts', { eager: true });
const mod = Object.values(mods).find(x => x.default.id === 'mesa')!, m = mod.default;
it('cmp', async () => {
  const def = await resolveMap(m, async () => { const b = readFileSync(['public/maps/', 'public/bsp/'].map(d => d + m.bsp!.url.split('/').pop()).find(existsSync)!); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); });
  const out: string[] = [];
  const rebuilt = ridingLine(def.world!, routeOf(mod.STATIONS)), flags = flagsOf(mod.STATIONS);
  out.push(`route lengths ${def.route!.length} vs ${rebuilt.length}; same points ${def.route!.every((q, i) => q.every((v, k) => v === rebuilt[i]?.[k]))}; flags same ${JSON.stringify(def.routeFlags) === JSON.stringify(flags)}`);
  for (const [name, route, fl] of [['map', def.route!, def.routeFlags], ['cloned', rebuilt, flags]] as const) {
    const s = new Session({ ...def, route: route as any }, { ...DEFAULTS }), bot = makeBot(route as any, def.world!, s.s, undefined, true, { flags: fl, hazard: s.hazard });
    if (name === 'cloned') { const p = structuredClone(s.p); s.p = structuredClone(p); s.section = 0; s.snap(); out.push(`clone keys ${Object.keys(p).join(',')}`); }
    for (let i = 1; i <= 128 * 12; i++) { s.step(bot(s.p)); if (i % 128 === 0 && i >= 128 * 9) out.push(`${name} t=${i / 128} ${s.p.origin.map(Math.round)}`); }
  }
  writeFileSync('scratch/cmp.out', out.join('\n') + '\n');
}, 600000);
