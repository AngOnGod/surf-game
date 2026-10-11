import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { DEFAULTS, type Vec } from '../src/physics';
import { type MapDef, Session } from '../src/game';
import { resolveMap } from '../src/bsp';
import { makeBot } from '../src/bot';
// does the autopilot's run pass through displacement terrain (solid in Source, drawn-only here)? segment vs triangle per tick
const defs = Object.values(import.meta.glob<{ default: MapDef }>('../src/maps/*.ts', { eager: true })).map(m => m.default);
it('cave crossings', async () => {
  const m = defs.find(d => d.id === (process.env.MAP ?? 'mesa'))!, file = process.env.BSP ?? 'public/maps/surf_mesa.bsp';
  const def = await resolveMap(m, async () => { const b = readFileSync(file); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); });
  const P = def.terrain!.pos, C = 512, grid = new Map<string, number[]>();
  for (let t = 0; t < P.length / 9; t++) {
    const xs = [P[t * 9], P[t * 9 + 3], P[t * 9 + 6]], ys = [P[t * 9 + 1], P[t * 9 + 4], P[t * 9 + 7]], zs = [P[t * 9 + 2], P[t * 9 + 5], P[t * 9 + 8]];
    for (let x = Math.floor(Math.min(...xs) / C); x <= Math.floor(Math.max(...xs) / C); x++) for (let y = Math.floor(Math.min(...ys) / C); y <= Math.floor(Math.max(...ys) / C); y++) for (let z = Math.floor(Math.min(...zs) / C); z <= Math.floor(Math.max(...zs) / C); z++) { const k = `${x},${y},${z}`; (grid.get(k) ?? grid.set(k, []).get(k)!).push(t); }
  }
  const cross = (a: Vec, b: Vec, t: number) => { // Moller-Trumbore, segment a->b
    const v0 = [P[t * 9], P[t * 9 + 1], P[t * 9 + 2]], e1 = [P[t * 9 + 3] - v0[0], P[t * 9 + 4] - v0[1], P[t * 9 + 5] - v0[2]], e2 = [P[t * 9 + 6] - v0[0], P[t * 9 + 7] - v0[1], P[t * 9 + 8] - v0[2]];
    const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]], det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2];
    if (Math.abs(det) < 1e-9) return false;
    const s = [a[0] - v0[0], a[1] - v0[1], a[2] - v0[2]], u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) / det; if (u < 0 || u > 1) return false;
    const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]], v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) / det; if (v < 0 || u + v > 1) return false;
    const w = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det; return w >= 0 && w <= 1;
  };
  const s = new Session(def, { ...DEFAULTS }), bot = makeBot(def.route!, s.world, s.s, undefined, true, { flags: def.routeFlags, hazard: s.hazard }), out: string[] = [];
  let splits = 0, hits = 0;
  for (let i = 0; i < 128 * +(process.env.SECS ?? 30) && splits < +(process.env.SPLITS ?? 2); i++) {
    const a = [...s.p.origin] as Vec; s.step(bot(s.p)); const b = s.p.origin;
    splits += s.events.splice(0).filter(e => e.type === 'split').length;
    const mid = [0, 1, 2].map(k => (a[k] + b[k]) / 2 + 36 * (k === 2 ? 1 : 0)); // box centre
    for (const t of grid.get(mid.map(v => Math.floor(v / C)).join(',')) ?? []) if (cross([a[0], a[1], a[2] + 36], [b[0], b[1], b[2] + 36], t)) { hits++; if (out.length < 10) out.push(`t=${(i / 128).toFixed(2)} at ${b.map(Math.round)}`); }
  }
  writeFileSync('scratch/cavecross.out', `${def.terrain!.pos.length / 9} triangles; ${splits} splits; path crosses terrain ${hits} times\n` + out.join('\n') + '\n');
}, 600000);
