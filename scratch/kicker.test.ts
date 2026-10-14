// From a planner snapshot (SNAP=), run the route bot and report ticks that lose speed, and which brush the move hit
import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { type MapDef, Session, buildBrush } from '../src/game';
import { DEFAULTS, HULL_MIN, type Vec, hlen, hullMax, len, trace } from '../src/physics';
import { resolveMap } from '../src/bsp';
import { makeBot } from '../src/bot';
const maps = Object.values(import.meta.glob<{ default: MapDef }>('../src/maps/*.ts', { eager: true })).map(m => m.default);
it('kicker', async () => {
  const m = maps.find(d => d.id === (process.env.MAP ?? 'cyberwave'))!;
  const def = await resolveMap(m, async u => { const b = readFileSync('public/' + u); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); });
  const tick = +(process.env.TICK ?? 128), s = new Session(def, { ...DEFAULTS, tickrate: tick });
  if (process.env.SNAP) { const sn = JSON.parse(readFileSync(process.env.SNAP, 'utf8')); Object.assign(s, structuredClone({ p: sn.snap.p, run: sn.snap.run, stage: sn.snap.stage, section: sn.snap.section })); }
  else { const at = process.env.AT!.split(',').map(Number); Object.assign(s.p, { origin: at.slice(0, 3), vel: at.slice(3, 6), onGround: false }); s.p.yaw = Math.atan2(at[4], at[3]) * 180 / Math.PI; s.snap(); }
  const bot = makeBot(def.route!, s.world, s.s, undefined, true, { flags: def.routeFlags, hazard: s.hazard }), out: string[] = [];
  const brushes = def.brushes.map((d, i) => ({ i, b: buildBrush(d), d }));
  for (let i = 0; i < tick * +(process.env.SECS ?? 4); i++) {
    const o = [...s.p.origin] as Vec, v = len(s.p.vel);
    s.step(bot(s.p));
    const fell = s.events.splice(0).some(e => e.type === 'fail');
    const v2 = len(s.p.vel);
    if (i % 16 === 0 || v2 < v * 0.93 || fell) out.push(`t ${(i / tick).toFixed(3)} at ${s.p.origin.map(Math.round)} speed ${Math.round(v)} -> ${Math.round(v2)} hspeed ${Math.round(hlen(s.p.vel))} n ${s.p.lastNormal.map(x => x.toFixed(2))} ground ${s.p.onGround}${fell ? ' FELL' : ''}`);
    if (v2 < v * 0.93) { // which brushes does this move touch?
      const hits = brushes.filter(({ b }) => { const t = trace(Object.assign([b], {}), o, s.p.origin, HULL_MIN, hullMax(s.p)); const u = trace(Object.assign([b], {}), s.p.origin, s.p.origin, HULL_MIN, hullMax(s.p)); return t.fraction < 1 || u.startsolid || trace(Object.assign([b], {}), o, [o[0] + s.p.vel[0] / tick * 2, o[1] + s.p.vel[1] / tick * 2, o[2] + s.p.vel[2] / tick * 2], HULL_MIN, hullMax(s.p)).fraction < 1; });
      for (const h of hits.slice(0, 4)) out.push(`    hit brush ${h.i} ${h.b.min.map(Math.round)}..${h.b.max.map(Math.round)} drawn ${h.b.faces.some(f => f.color !== null)} planes ${h.b.planes.length}`);
    }
    if (fell) break;
  }
  writeFileSync('scratch/kicker.out', out.join('\n') + '\n');
}, 600000);
