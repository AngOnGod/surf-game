import type { Box, MapDef, Spawn } from '../game';
import { type Piece, canyon, platform } from '../build';
import { type Vec, hullPlanes } from '../physics';
import { cos, sin } from '../fmath';

// A hard original map: five stages of enclosed canyons. Each stage starts with a steep drop-in, then tests one
// skill: a banked turn into a kicker gap, bobsled S-bends on the outer walls, 61° knife-edges with air switches and
// a window to thread, a 180° descending corkscrew, and two long speed-check gaps. Falls restart the stage.
// Ramps switch type (ridge <-> valley) only across a gap: run straight into a valley and the low half of the
// ridge face meets the valley wedge's square end.
const R = (len: number, drop: number, o: Partial<Piece> = {}): Piece => ({ kind: 'ridge', len, drop, ...o });
const T = (turn: number, r: number, drop: number, o: Partial<Piece> = {}): Piece => ({ kind: 'ridge', turn, r, drop, side: turn > 0 ? 1 : -1, ...o }); // ride the face that faces the turn centre (it holds you)
const V = (turn: number, r: number, drop: number, o: Partial<Piece> = {}): Piece => ({ kind: 'valley', turn, r, drop, side: turn > 0 ? -1 : 1, ...o }); // the outer wall faces the centre
const GAP = (len: number, drop: number): Piece => ({ kind: 'gap', len, drop });

// Riding heights (ride) were tuned by search so the autopilot finishes every stage at 128 and 64 tick (see test/).
export const STAGES: { name: string; color: number; pieces: Piece[] }[] = [
  { name: 'Drop Zone', color: 0x4f86c6, pieces: [
    R(3200, 2200, { ride: 0.55 }), R(2600, 260), T(90, 3200, 520), R(2200, 140, { ride: 0.75 }), R(700, -260, { ride: 0.9 }),
    GAP(2400, 700), R(3600, 420, { ride: 0.6 }), R(1200, 120),
  ] },
  { name: 'Serpent', color: 0x3fa7a0, pieces: [
    R(2800, 1900, { ride: 0.55 }), R(1600, 160, { ride: 0.7277132413028966 }), GAP(1200, 700), V(-70, 4000, 600), V(140, 4000, 1100), V(-70, 4000, 600, { ride: 0.6609379084825686 }), GAP(1200, 700), R(2600, 260), R(1000, 80),
  ] },
  { name: 'Needles', color: 0xc75a7a, pieces: [
    R(2800, 1800, { ride: 0.55 }), R(3000, 520, { w: 300, h: 560, ride: 0.66 }), GAP(1500, 1000),
    { kind: 'left', len: 2600, drop: 380, w: 360, h: 640, ride: 0.7010630245439664 }, GAP(1300, 900), { kind: 'right', len: 2600, drop: 380, w: 360, h: 640, ride: 0.5843376470612887 }, GAP(1300, 900),
    R(3600, 420, { w: 320, h: 600, side: -1, gate: { at: 0.6, u: -160, v: 240, ww: 300, wh: 300 } }), R(1000, 80, { w: 320, h: 600, side: -1 }),
  ] },
  { name: 'Corkscrew', color: 0x8b6fd6, pieces: [
    R(2600, 1700, { ride: 0.55 }), R(1200, 120), GAP(1200, 700), V(-180, 3200, 1500, { w: 720, h: 760 }), { kind: 'valley', len: 2400, drop: 200, side: 1, w: 720, h: 760 }, GAP(1200, 700), R(1200, 80),
  ] },
  { name: 'Overdrive', color: 0xd08a3c, pieces: [
    R(4000, 3000, { ride: 0.55 }), R(3600, 300, { ride: 0.75 }), R(700, -280, { ride: 0.92 }), GAP(3000, 900), R(4000, 420, { ride: 0.8933400339419904 }),
    R(700, -300, { ride: 0.92 }), GAP(3400, 1000), R(4200, 400, { ride: 0.6038362040999741 }), R(1200, 80),
  ] },
];

/** Build the map; route entries carry the global piece index as a 5th value (used to tune riding heights). */
export function assemble(defs: typeof STAGES): MapDef {
const ends: { e: [number, number, number]; h: number }[] = [];
const stages: { name: string; start: Box; end: Box; spawn: Spawn }[] = [], brushes: MapDef['brushes'] = [], fails: NonNullable<MapDef['fails']> = [], route: number[][] = [];
let pieceBase = 0;
defs.forEach((st, i) => {
  const at: [number, number, number] = [0, i * 36000, 12000];
  const pl = platform([at[0], at[1], at[2] + (st.pieces[0].h ?? 720) + 140], 0); // above the drop-in ridge's apex
  const c = canyon(st.pieces, at, 0, { color: st.color });
  brushes.push(pl.brush, ...c.brushes);
  fails.push(...c.fails);
  const e = c.end, h = c.heading * Math.PI / 180;
  // end zone: a slab across the canyon just past the last piece; a teleport beyond it to the next stage
  const ex = e[0] + cos(h) * 200, ey = e[1] + sin(h) * 200;
  const end: Box = { min: [ex - 1100, ey - 1100, e[2] - 600], max: [ex + 1100, ey + 1100, e[2] + 2400] };
  stages.push({ name: st.name, start: pl.zone, end, spawn: pl.spawn });
  ends.push({ e: [e[0], e[1], e[2]], h });
  route.push([pl.spawn.pos[0] + 300, pl.spawn.pos[1] + 120, pl.spawn.pos[2], -1, -1], ...c.route.map(r => [...r.slice(0, 4), r[4] + pieceBase]), [ex, ey, e[2] + 400, -1, -1], [ex + cos(h) * 4000, ey + sin(h) * 4000, e[2], -1, -1]);
  pieceBase += st.pieces.length;
});
// stage end teleports: everything beyond each end zone (an oriented box, however you fly out) -> the next stage's platform
ends.slice(0, -1).forEach(({ e, h }, i) => {
  const pts = [1400, 14000].flatMap(a => [-9000, 9000].flatMap(b => [-6000, 6000].map(c => [e[0] + cos(h) * a - sin(h) * b, e[1] + sin(h) * a + cos(h) * b, e[2] + c] as Vec)));
  fails.push({ min: [0, 1, 2].map(k => Math.min(...pts.map(q => q[k]))) as Vec, max: [0, 1, 2].map(k => Math.max(...pts.map(q => q[k]))) as Vec, shape: [hullPlanes(pts).map(q => [...q.n, q.d] as [number, number, number, number])], to: stages[i + 1].spawn, quiet: true });
});

return {
  id: 'gauntlet',
  name: 'Gauntlet',
  blurb: 'Hard: 5 stages of enclosed canyons. Banked turns, wall switches, 62° knife-edges, a corkscrew and speed checks.',
  order: 1,
  spawn: stages[0].spawn,
  brushes,
  stages,
  fails: [...fails, { min: [-1e6, -1e6, -1e6], max: [1e6, 1e6, -12000] }],
  route: route as [number, number, number, number][],
  routeOnSurface: true,
};
}
export default assemble(STAGES);
