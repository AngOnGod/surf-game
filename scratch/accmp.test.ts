// How far a recorded run (CSV= from demo.test.ts) strays from a map's autopilot route (MAP=): per route point, the
// nearest recorded point; and the stretches of the recording farther than 600 from the route. Writes scratch/accmp.out.
import { it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { MapDef } from '../src/game';
import { resolveMap } from '../src/bsp';

const maps = Object.values(import.meta.glob<{ default: MapDef }>('../src/maps/*.ts', { eager: true })).map(m => m.default);
it('compare', async () => {
  const m = maps.find(x => x.id === process.env.MAP)!, file = ['public/maps/', 'public/bsp/'].map(d => d + m.bsp!.url.split('/').pop()).find(existsSync)!;
  const def = await resolveMap(m, async () => { const b = readFileSync(file); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); });
  const rec = readFileSync(process.env.CSV!, 'utf8').trim().split('\n').slice(1).map(l => l.split(',')).map(f => ({ t: +f[0], o: [+f[1], +f[2], +f[3]], v: +f[7] }));
  const d = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const out: string[] = ['route point -> nearest recorded (dist, dz, time)'];
  def.route!.forEach((q, i) => { let b = rec[0]; for (const r of rec) if (d(r.o, q) < d(b.o, q)) b = r; out.push(`${i} ${q.slice(0, 3).map(Math.round)} -> ${d(b.o, q).toFixed(0)} dz ${(q[2] - b.o[2]).toFixed(0)} t ${b.t.toFixed(2)}`); });
  out.push('', 'recording far from the route (>600):');
  for (const r of rec.filter((_, i) => i % 64 === 0)) { const dm = Math.min(...def.route!.map(q => d(r.o, q))); if (dm > 600) out.push(`t ${r.t.toFixed(2)} ${r.o.map(Math.round)} v ${r.v} -> ${dm.toFixed(0)}`); }
  writeFileSync('scratch/accmp.out', out.join('\n'));
}, 300_000);
