import { it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DEFAULTS, HULL_MIN, HULL_STAND, NO_CMD, dot, len, newPlayer, trace, type Vec } from '../src/physics';
import { type MapDef, Session } from '../src/game';
import { resolveMap } from '../src/bsp';
// rampbug sampler: drop a player onto ramp faces along each map's line with random speed / direction, let it slide
// (no input) for 1.5 s; a tick that keeps < 50% of its speed while airborne on a surf face is a stop, classified by
// the plane it ended on: the face it was riding (a rampbug proper), a face nearly parallel to it (a seam), else a wall
const defs = Object.values(import.meta.glob<{ default: MapDef }>('../src/maps/*.ts', { eager: true })).map(m => m.default);
const file = (d: MapDef) => d.bsp && ['public/maps/', 'public/bsp/'].map(p => p + d.bsp!.url.split('/').pop()).find(existsSync);
it('ramp sampler', async () => {
  const caught: unknown[] = [], out: string[] = [], N = +(process.env.N ?? 1500), tickrate = +(process.env.TICK ?? 128), fix = process.env.FIX === '1';
  let seed = 4242; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (const m of defs) {
    if (m.id === 'test' || (m.bsp && !file(m)) || (process.env.MAPS && !process.env.MAPS.split(',').includes(m.id))) continue;
    const def = await resolveMap(m, async () => { const b = readFileSync(file(m)!); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); });
    const R = def.route!.filter(q => (q as number[])[3] === undefined || (q as number[])[3] >= 0) as number[][], s = new Session(def, { ...DEFAULTS, tickrate, rampfix: fix } as any);
    const kinds = { bug: 0, seam: 0, wall: 0 }, ex: string[] = []; let rides = 0, rideTicks = 0;
    for (let k = 0; k < N; k++) {
      const i = Math.floor(rnd() * (R.length - 1)), a = R[i], b = R[i + 1];
      const down = trace(s.world, [a[0], a[1], a[2] + 40], [a[0], a[1], a[2] - 200], HULL_MIN, HULL_STAND);
      const n = down.normal; if (down.fraction === 1 || down.startsolid || !(n[2] > 0.05 && n[2] < 0.7)) continue;
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, sp = 600 + rnd() * 2400, ang = (rnd() - 0.5) * 0.8;
      const ux = (dx * Math.cos(ang) - dy * Math.sin(ang)) / L, uy = (dx * Math.sin(ang) + dy * Math.cos(ang)) / L;
      let v: Vec = [ux * sp, uy * sp, (rnd() - 0.5) * 600]; v = v.map((c, j) => c - Math.min(0, dot(v, n)) * n[j]) as Vec; // along the face
      s.p = Object.assign(newPlayer(down.end, 0, 0), { vel: v }); s.events.length = 0; rides++;
      for (let t = 0; t < tickrate * 1.5; t++) {
        const pre = structuredClone(s.p), v0 = len(s.p.vel), n0 = [...s.p.lastNormal], on = s.p.tick - s.p.touchTick <= 2 && n0[2] > 0.05 && n0[2] < 0.7, air = !s.p.onGround, o0 = s.p.origin;
        s.step(NO_CMD); rideTicks++;
        if (s.events.splice(0).some(e => e.type === 'fail') || Math.hypot(s.p.origin[0] - o0[0], s.p.origin[1] - o0[1], s.p.origin[2] - o0[2]) > 300) break;
        if (air && on && v0 > 300 && len(s.p.vel) < 0.5 * v0) {
          // what blocks the old direction of travel? a wall (or end cap) facing against it is a crash, not a bug
          const u = [0, 1, 2].map(j => (v0 ? (o0 && (s.p.origin[j] - o0[j])) : 0)) as Vec, ul = len(u) || 1, probe = trace(s.world, s.p.origin, [0, 1, 2].map(j => s.p.origin[j] + (u[j] / ul) * 6) as Vec, HULL_MIN, HULL_STAND);
          const wall = probe.fraction < 1 && Math.abs(dot(probe.normal, n0 as Vec) - 1) > 1e-3 && dot(probe.normal, [u[0] / ul, u[1] / ul, u[2] / ul]) < -0.3;
          const n1 = s.p.lastNormal, near = dot(n0 as Vec, n1) > 0.95;
          const kind = wall ? 'wall' : near ? (Math.abs(dot(n0 as Vec, n1) - 1) < 1e-4 ? 'bug' : 'seam') : 'wall'; kinds[kind]++;
          if (kind === 'bug' && len(s.p.vel) < 20) caught.push({ map: m.id, tickrate, pre });
          if (kind !== 'wall' && ex.length < 6) ex.push(`  ${kind} ${v0.toFixed(0)}->${len(s.p.vel).toFixed(0)} at ${s.p.origin.map(x => x.toFixed(1))} n ${n0.map(x => x.toFixed(3))} -> ${[...n1].map(x => x.toFixed(3))}`);
          break;
        }
      }
    }
    out.push(`${m.id} @${tickrate}${fix ? ' fix' : ''}: ${rides} rides, ${(rideTicks / tickrate).toFixed(0)} s on ramps: ${kinds.bug} rampbugs, ${kinds.seam} seam stops, ${kinds.wall} walls`, ...ex);
  }
  writeFileSync(process.env.OUT ?? 'scratch/rampsample.out', out.join('\n') + '\n');
  writeFileSync('scratch/rampbugs.json', JSON.stringify(caught));
}, 1800000);
