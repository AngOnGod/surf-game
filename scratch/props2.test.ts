// Hull brushes match their hulls (bounds within 2 units of the points'), and how long a whole map takes to load
import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { type MapDef, Session } from '../src/game';
import { DEFAULTS } from '../src/physics';
import { resolveMap } from '../src/bsp';
const maps = Object.values(import.meta.glob<{ default: MapDef }>('../src/maps/*.ts', { eager: true })).map(m => m.default);
it('props2', async () => {
  const out: string[] = [];
  for (const id of process.env.MAPS!.split(',')) {
    const m = maps.find(d => d.id === id)!, t0 = performance.now();
    const def = await resolveMap(m, async u => { const b = readFileSync('public/' + u); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); });
    const t1 = performance.now(), s = new Session(def, { ...DEFAULTS }), t2 = performance.now();
    const inv = s.world.filter(b => b.faces.every(f => f.color === null));
    const big = inv.filter(b => b.max.some((v, k) => v - b.min[k] > 20000));
    out.push(`${id}: resolve ${(t1 - t0).toFixed(0)} ms, session ${(t2 - t1).toFixed(0)} ms; ${s.world.length} brushes, ${inv.length} invisible, ${big.length} invisible > 20000 across`);
  }
  writeFileSync('scratch/props2.out', out.join('\n') + '\n');
}, 600000);
