import { it } from 'vitest';
import { DEFAULTS, NO_CMD, HULL_MIN, HULL_STAND, ctx, hlen, newPlayer, playerMove, trace } from '../src/physics';
import { buildBrush } from '../src/game';
import testMap from '../src/maps/test';
it('bhop trace', () => {
  const world = testMap.brushes.map(buildBrush), at: [number, number, number] = [-1400, 0, 50];
  const p = newPlayer(at); p.origin = trace(world, at, [at[0], at[1], at[2] - 4000], HULL_MIN, HULL_STAND).end;
  const c = ctx(p, world, DEFAULTS); (globalThis as any).out = [];
  for (let i = 0; i < 4; i++) playerMove(c, NO_CMD);
  p.vel = [400, 0, 0];
  for (let i = 0; i < 300; i++) { const g = p.onGround, v = hlen(p.vel); playerMove(c, { ...NO_CMD, jump: true }); if (g !== p.onGround || Math.abs(hlen(p.vel) - v) > 1e-9) (globalThis as any).out.push([i, g, '->', p.onGround, v.toFixed(3), '->', hlen(p.vel).toFixed(3), p.origin.map(x => x.toFixed(2)).join(' '), p.vel[2].toFixed(2)].join(" ")); }
  require("fs").writeFileSync("scratch/bhop.out", (globalThis as any).out.join("\n"));
});
