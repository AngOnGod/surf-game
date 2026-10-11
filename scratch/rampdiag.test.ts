import { it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DEFAULTS, HULL_MIN, HULL_STAND, clipVelocity, cross, ctx, dot, len, trace, type Vec } from '../src/physics';
import { type MapDef, Session } from '../src/game';
import { resolveMap } from '../src/bsp';
// replay one captured rampbug tick: gravity half-step, then tryPlayerMove's loop with a log of every bump
const defs = Object.values(import.meta.glob<{ default: MapDef }>('../src/maps/*.ts', { eager: true })).map(m => m.default);
const file = (d: MapDef) => d.bsp && ['public/maps/', 'public/bsp/'].map(p => p + d.bsp!.url.split('/').pop()).find(existsSync);
const f3 = (v: number[]) => v.map(x => x.toFixed(4)).join(',');
it('rampdiag', async () => {
  const caught = JSON.parse(readFileSync('scratch/rampbugs.json', 'utf8')), out: string[] = [];
  for (const { map, tickrate, pre } of caught) {
    const m = defs.find(d => d.id === map)!, def = m.bsp ? await resolveMap(m, async () => { const b = readFileSync(file(m)!); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }) : m;
    const world = new Session(def, DEFAULTS).world;
    const dt = 1 / tickrate, p = { ...pre, vel: [pre.vel[0], pre.vel[1], pre.vel[2] - 800 * 0.5 * dt] as Vec };
    const T = (a: Vec, b: Vec) => trace(world, a, b, HULL_MIN, HULL_STAND);
    out.push(`== ${map} origin ${f3(p.origin)} vel ${f3(p.vel)}`);
    const planes: Vec[] = []; let original = p.vel, primal = p.vel, all = 0, left = dt, why = 'ok';
    for (let bump = 0; bump < 4; bump++) {
      const end = p.origin.map((c: number, k: number) => c + left * p.vel[k]) as Vec, tr = T(p.origin, end);
      out.push(`  bump ${bump}: frac ${tr.fraction} n ${f3(tr.normal)} start ${tr.startsolid} all ${tr.allsolid} vel ${f3(p.vel)}`);
      all += tr.fraction;
      if (tr.allsolid) { why = 'allsolid'; p.vel = [0, 0, 0]; break; }
      if (tr.fraction === 1) { const st = T(tr.end, tr.end); out.push(`    end re-test: start ${st.startsolid} frac ${st.fraction} n ${f3(st.normal)}`); if (st.startsolid || st.fraction !== 1) { why = 'stuck at end (Source precision check)'; p.vel = [0, 0, 0]; break; } }
      if (tr.fraction > 0) { p.origin = tr.end; original = p.vel; planes.length = 0; }
      if (tr.fraction === 1) break;
      left -= left * tr.fraction;
      planes.push(tr.normal);
      if (planes.length === 1) { p.vel = original = clipVelocity(original, planes[0], 1); out.push(`    clip -> ${f3(p.vel)}`); }
      else {
        let i = 0;
        for (; i < planes.length; i++) { p.vel = clipVelocity(original, planes[i], 1); let j = 0; for (; j < planes.length; j++) if (j !== i && dot(p.vel, planes[j]) < 0) break; if (j === planes.length) break; }
        if (i === planes.length) { if (planes.length !== 2) { why = 'planes>2'; p.vel = [0, 0, 0]; break; } const d = cross(planes[0], planes[1]), dl = len(d); p.vel = d.map(x => (x / dl) * dot(d.map(y => y / dl) as Vec, p.vel)) as Vec; out.push(`    crease -> ${f3(p.vel)}`); }
        else out.push(`    clip[${i}] -> ${f3(p.vel)}`);
        if (dot(p.vel, primal) <= 0) { why = 'against primal'; p.vel = [0, 0, 0]; break; }
      }
    }
    if (all === 0) why = 'allFraction 0';
    out.push(`  => ${why}; planes ${planes.map(f3).join(' | ')}`);
  }
  writeFileSync('scratch/rampdiag.out', out.join('\n') + '\n');
}, 600000);
