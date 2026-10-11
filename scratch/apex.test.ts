import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { DEFAULTS, HULL_MIN, HULL_STAND, NO_CMD, ctx, newPlayer, playerMove, trace } from '../src/physics';
import { buildBrush } from '../src/game';
import testMap from '../src/maps/test';
it('apex by tickrate', () => {
  const world = testMap.brushes.map(buildBrush), out: string[] = [];
  for (const tickrate of [64, 100, 128, 256, 512]) {
    const at: [number, number, number] = [-1400, 1200, 50], p = newPlayer(at); p.origin = trace(world, at, [at[0], at[1], -4000], HULL_MIN, HULL_STAND).end;
    const c = ctx(p, world, { ...DEFAULTS, tickrate });
    for (let i = 0; i < 8; i++) playerMove(c, NO_CMD);
    const z0 = p.origin[2]; let apex = z0;
    playerMove(c, { ...NO_CMD, jump: true });
    for (let i = 0; i < tickrate; i++) { playerMove(c, NO_CMD); apex = Math.max(apex, p.origin[2]); }
    out.push(`${tickrate}: apex ${(apex - z0).toFixed(3)}`);
  }
  writeFileSync('scratch/apex.out', out.join('\n') + '\n');
});
