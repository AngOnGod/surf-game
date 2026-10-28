// The riding line of a map file kept in scratch (SRC=scratch/<file>.ts, e.g. a map's old stations from git), as guide
// points for the planner (beam.test.ts GUIDE=): writes OUT (json [x, y, z][]).
import { it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { MapDef } from '../src/game';
import { resolveMap } from '../src/bsp';

it('route', async () => {
  const m: MapDef = (await import(/* @vite-ignore */ '../' + process.env.SRC!)).default, file = ['public/maps/', 'public/bsp/'].map(d => d + m.bsp!.url.split('/').pop()).find(existsSync)!;
  const def = await resolveMap(m, async () => { const b = readFileSync(file); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); });
  writeFileSync(process.env.OUT!, JSON.stringify(def.route!.map(q => q.slice(0, 3))));
}, 300_000);
