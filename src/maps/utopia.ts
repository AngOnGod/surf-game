import { type MapDef, type Row, course, zone } from '../game';

// Long linear beginner map: 7 sections of sweeping two-sided ramps along +X, gap jumps, big drops, two gate
// walls and a mid-air slot. Tuning, verified by the autopilot at 128 and 64 tick (test/surf.test.ts):
//  - faces ~50° (n.z ≈ 0.64): recovering from a hard landing on a 60°+ face is barely possible at 64 tick
//  - a section's first ramp is pitched 6° so a zero-velocity respawn reaches ~900 u/s by its end
//  - default drops clear the gap at 850 u/s (1200 at a section entry, the slowest arrival after finishing a
//    section from its respawn); bigger drops only make fast players slam in
//  - ramps are long enough to catch a 3500 u/s landing; gates and the slot sit >= 0.5 s past that touchdown
//  - section-entry ramps are wide/tall: that's where fast continuous runs land hardest
const E = 1200; // section-entry vmin
const SECTIONS: { name: string; color: number; rows: Row[] }[] = [
  { name: 'Warm-up', color: 0x4f86c6, rows: [
    { len: 5300, gap: 0, W: 1280, H: 780, pitch: 6 }, // starts under the spawn platform
    { len: 4000, gap: 600, W: 1280, H: 780 },
  ] },
  { name: 'The Drop', color: 0x3fa7a0, rows: [
    { len: 6500, gap: 1500, drop: 1500, W: 2048, H: 1240, pitch: 6 }, // big drop: a tall face absorbs the landing
    { len: 4000, gap: 600, dy: 900, face: -1 },
  ] },
  { name: 'Gatekeeper', color: 0x8b6fd6, rows: [
    { len: 5500, gap: 700, vmin: E, dy: -900, face: 1, W: 1600, H: 960, pitch: 6, gates: [{ at: 0.6, h: 0.5 }] },
    { len: 3500, gap: 600 },
  ] },
  { name: 'Island Hopping', color: 0xd08a3c, rows: [
    { len: 4500, gap: 700, vmin: E, W: 1600, H: 960, pitch: 6 },
    { len: 3200, gap: 700, dy: 640, face: -1 },
    { len: 3200, gap: 700, dy: -640, face: 1 },
  ] },
  { name: 'The Needle', color: 0xc75a7a, rows: [
    { len: 7000, gap: 1200, vmin: E, W: 1600, H: 960, pitch: 6 },
    { len: 4500, gap: 1300, W: 1600, H: 960, slit: true },
  ] },
  { name: 'Steep Climb', color: 0x5aa15a, rows: [
    { len: 7000, gap: 600, vmin: E, W: 1536, H: 1200, pitch: 6, gates: [{ at: 0.6, h: 0.42 }, { at: 0.9, h: 0.6 }] },
    { len: 3500, gap: 700, W: 1280, H: 1000 },
  ] },
  { name: 'Home Stretch', color: 0x4f86c6, rows: [
    { len: 7000, gap: 1200, vmin: E, W: 1600, H: 960, pitch: 6 },
  ] },
];

const rows = SECTIONS.flatMap(s => s.rows.map(r => ({ ...r, color: s.color })));
const c = course(rows, [0, 0, 16000]);
const firsts = SECTIONS.map((_, i) => SECTIONS.slice(0, i).reduce((n, s) => n + s.rows.length, 0));

const map: MapDef = {
  id: 'utopia',
  name: 'Utopia-like',
  blurb: '7 sections of long two-sided ramps, big drops, gap jumps, two gate walls and a slot to thread. Beginner friendly.',
  order: 1,
  difficulty: { tier: 1, run: 33, sections: 7 },
  spawn: c.spawn,
  brushes: c.brushes,
  start: c.start,
  end: c.end,
  // section starts: a tall slab across each section's first ramp entrance; falling respawns you above that ramp
  checkpoints: firsts.slice(1).map((ri, i) => {
    const l = c.legs[ri];
    return { name: SECTIONS[i + 1].name, ...zone([l.x0 - 100, l.y, l.bottom - 64], [200, l.W + 1600, l.H + 2000]), spawn: l.spawn };
  }),
  fails: [...c.fails, { min: [-1e5, -1e5, -1e5], max: [1e5, 1e5, c.endTop - 2500] }],
  route: c.route,
};
export default map;
