// Where does a recording (DEMO=) first touch displacement rock? Replays it twice in lockstep, with and without the
// displacement triangles, and reports the first ticks where they part.
import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { type MapDef, Session } from '../src/game';
import { DEFAULTS, HULL_MIN, hullMax, trace } from '../src/physics';
import { resolveMap } from '../src/bsp';
import { type Demo, replayDemo } from '../src/plan';
const maps = Object.values(import.meta.glob<{ default: MapDef }>('../src/maps/*.ts', { eager: true })).map(m => m.default);
const read = async (u: string) => { const b = readFileSync('public/' + u); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
it('divergence', async () => {
  const d = JSON.parse(readFileSync(process.env.DEMO!, 'utf8')) as Demo & { map: string; tickrate: number; settings: object };
  const def = await resolveMap(maps.find(m => m.id === d.map)!, read), set = { ...DEFAULTS, ...d.settings, tickrate: d.tickrate };
  const a = new Session(def, set), b = new Session({ ...def, tris: undefined, world: undefined }, set), ba = replayDemo(d.ticks), bb = replayDemo(d.ticks);
  a.restore(d.snap); b.restore(d.snap);
  const out: string[] = [], tris = Object.assign([], { tris: def.tris });
  for (let i = 0; i < d.ticks.length; i++) {
    const o = [...b.p.origin] as [number, number, number];
    a.step(ba(a.p)); b.step(bb(b.p)); a.events.length = b.events.length = 0;
    const t = trace(tris, o, b.p.origin, HULL_MIN, hullMax(b.p)), gap = Math.hypot(...a.p.origin.map((v, k) => v - b.p.origin[k]));
    if (t.fraction < 1 || t.startsolid) out.push(`t ${((i + 1) / d.tickrate).toFixed(3)} free run hits rock at ${t.end.map(Math.round)} n ${t.normal.map(v => v.toFixed(2))} speed ${Math.round(Math.hypot(b.p.vel[0], b.p.vel[1]))}${t.startsolid ? ' (inside)' : ''}`);
    if (gap > 1 && out.length < 400) out.push(`t ${((i + 1) / d.tickrate).toFixed(3)} parted by ${gap.toFixed(1)}: solid ${a.p.origin.map(Math.round)} free ${b.p.origin.map(Math.round)}`);
    if (out.length > 60) break;
  }
  writeFileSync('scratch/divergence.out', out.join('\n') + '\n');
}, 600000);
