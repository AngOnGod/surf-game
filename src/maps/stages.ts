import { type Box, type MapDef, type Row, type Spawn, course } from '../game';

// Staged map: four independent short courses, each with its own start/end zone and a teleporter after the end
// zone to the next stage. Stage k lives at its own offset so nothing overlaps.
const STAGES: { name: string; color: number; rows: Row[] }[] = [
  { name: 'Glide', color: 0x4f86c6, rows: [
    { len: 6000, gap: 0, W: 1280, H: 780, pitch: 6 },
    { len: 4000, gap: 600, W: 1280, H: 780 },
  ] },
  { name: 'Switchback', color: 0xd08a3c, rows: [
    { len: 5000, gap: 0, pitch: 6 },
    { len: 3500, gap: 600, dy: 900, face: -1 },
    { len: 3500, gap: 600, dy: -900, face: 1 },
  ] },
  { name: 'Freefall', color: 0x3fa7a0, rows: [
    { len: 5000, gap: 0, pitch: 6 },
    { len: 6500, gap: 1500, drop: 1500, W: 2048, H: 1240, pitch: 6 },
  ] },
  { name: 'Keyhole', color: 0x8b6fd6, rows: [
    { len: 7000, gap: 0, W: 1280, H: 780, pitch: 6, gates: [{ at: 0.65, h: 0.5 }] },
    { len: 3500, gap: 600 },
  ] },
];

const courses = STAGES.map((st, i) => course(st.rows.map(r => ({ ...r, color: st.color })), [i * 40000, i * 9000, 12000]));
const teleports: (Box & { to: Spawn; quiet: boolean })[] = courses.slice(0, -1).map((c, i) => ({
  min: [c.end.max[0], c.end.min[1], c.endTop], max: [c.end.max[0] + 3000, c.end.max[1], c.endTop + 3000], to: courses[i + 1].spawn, quiet: true,
}));

const map: MapDef = {
  id: 'stages',
  name: 'Four Stages',
  blurb: 'A short staged map: 4 independent stages, each with its own start/end zone and stage times.',
  order: 2,
  difficulty: { tier: 1, run: 52, sections: 4 },
  spawn: courses[0].spawn,
  brushes: courses.flatMap(c => c.brushes),
  stages: courses.map((c, i) => ({ name: STAGES[i].name, start: c.start, end: c.end, spawn: c.spawn })),
  fails: [...courses.flatMap(c => c.fails), ...teleports, { min: [-1e6, -1e6, -1e6], max: [1e6, 1e6, Math.min(...courses.map(c => c.endTop)) - 2500] }],
  route: courses.flatMap(c => c.route),
};
export default map;
