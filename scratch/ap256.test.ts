import { it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DEFAULTS, type Vec } from '../src/physics';
import { type MapDef, Session } from '../src/game';
import { resolveMap } from '../src/bsp';
import { makeBot } from '../src/bot';
import { decode, replay, BLOCK } from '../src/plan';
import { RUNS } from '../src/runs';
// The in-game autopilot (P) at TICK (default 256) on every map: its planned run if there is one, else the route bot.
// Writes scratch/ap256.out: finish time, or where it fell / timed out.
const defs = Object.values(import.meta.glob<{ default: MapDef }>('../src/maps/*.ts', { eager: true })).map(m => m.default);
it('autopilot at 256 on every map', async () => {
  const tick = +(process.env.TICK ?? 256), out: string[] = [], only = process.env.MAPS?.split(',');
  for (const m of defs) {
    if (only && !only.includes(m.id)) continue;
    const planned = RUNS[`${m.id}@${tick}`];
    if (!m.route && !planned) { out.push(`${m.id}: no autopilot`); continue; }
    const file = m.bsp && ['public/maps/', 'public/bsp/'].map(d => d + m.bsp!.url.split('/').pop()).find(existsSync);
    if (m.bsp && !file) { out.push(`${m.id}: map file missing`); continue; }
    const def = await resolveMap(m, async () => { const b = readFileSync(file!); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); });
    const s = new Session(def, { ...DEFAULTS, tickrate: tick });
    const route = (settle: boolean) => makeBot(def.route ?? [], s.world, s.s, undefined, !!def.routeOnSurface, { flags: def.routeFlags, hazard: s.hazard, bisect: def.routeCorners, settle });
    let bot = planned ? replay(planned.run, tick, route(false)) : route(true), left = planned?.stage !== undefined ? (decode(planned.run).length * tick) / BLOCK : Infinity;
    let res = 'timeout', fails = 0, stages: string[] = [];
    s.restart();
    for (let i = 0; i < tick * 240 && res === 'timeout'; i++) {
      if (left-- <= 0) { res = `planned run of stage ${planned!.stage! + 1} ended (hands back)`; break; }
      s.step(bot(s.p));
      for (const e of s.events.splice(0)) {
        if (e.type === 'fail' && ++fails >= 3) res = `fell 3 times, last at ${s.p.origin.map(Math.round)}`;
        if (e.type === 'stage') stages.push(`s${e.index + 1} ${e.time.toFixed(2)}`);
        if (e.type === 'finish') res = `FINISHED ${e.time.toFixed(3)}s${fails ? ` (${fails} falls)` : ''}`;
      }
    }
    if (res === 'timeout') res = `timeout at ${s.p.origin.map(Math.round)} (${fails} falls)`;
    out.push(`${m.id}: ${planned ? 'planned' : 'route bot'}: ${res}${stages.length ? ` [${stages.join(', ')}]` : ''}`);
    writeFileSync('scratch/ap256.out', out.join('\n') + '\n');
  }
  writeFileSync('scratch/ap256.out', out.join('\n') + '\n');
}, 3_600_000);
