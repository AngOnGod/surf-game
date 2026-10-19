import { type Box, type MapDef, type Spawn, type Station, flagsOf, line, routeOf } from '../game';
import type { Vec } from '../physics';

// surf_cyberwave (Mr.Cow, 2019; CS:GO, BSP v21) imported from public/maps/ as a gzipped copy of the original file
// (unpacked as it loads: byte for byte the map, which is over the host's 100 MB file limit), shipped unmodified under its
// CC BY-NC-ND 4.0 licence with credit (CREDITS.md). Two long stages north over a neon city, each with its own timer.
// The ramps are models (drawn from the map's packed files) over invisible player-clip brushes, which are what you ride.
// It's drawn with its own look (its textures, neon colours and pulses, baked lighting and sky), not the flat colours.
// The map sets its own movement settings when it loads (sv_maxvelocity 7500; the rest are the defaults here), and they
// apply on it. Zones are the map's own trigger volumes (s1_start_zone, s2_start_zone, s2_end_zone), grown by the
// player's box, as a trigger fires on touch; stage 1 ends just before its exit portal (a teleport to stage 2). Falls
// teleport you back to the stage's start, keeping speed as Source does (stage 2's start is a small player-clip cage with
// no floor: you come out of stage 1's portal into it, lose your speed and drop out of it, so stage 2 starts from still).
// You start, and R restarts, at stage 1's start (where its portal lands you), as a timer's restart does: the map's spawn
// room, a walk north into that portal, is skipped. Portals still lead back to it (the back of stage 1's start platform,
// the end of stage 2), and the bonus starts from its back portal: playable, but with no timer here.
// The autopilot's stage 1 line is the player's own run (test/runs/cyberwave@256-s1.json, saved in-game; stations by
// scratch/demoguide.test.ts): one station per ride or flight, every key an exact point; the planned run (src/runs.ts)
// was searched along it. Stage 2's line is laid on the ramps by hand (the map's brushes): no planned run there yet.
/** Autopilot line (see Station), the east side of both stages (they're mirror images): s = the stage. */
export const STATIONS: Station[] = [
  { s: 0, g: line([217, -14446, 13462], [283, -14137, 12818]), h: [-1, -1] }, // fly 0.0-1.0 s
  { s: 0, g: line([283, -14135, 12814], [186, -13853, 12398], [141, -13474, 12100], [120, -13012, 11894], [134, -12499, 11820]), h: [-1, -1] }, // ride 1.0-2.4 s
  { s: 0, g: line([64, -11822, 11759], [182, -11202, 11736], [151, -10818, 11666], [205, -10276, 11493]), h: [-1, -1] }, // fly 2.4-3.7 s
  { s: 0, g: line([206, -10269, 11491], [328, -9484, 11338], [357, -8934, 11302]), h: [-1, -1] }, // ride 3.7-4.5 s
  { s: 0, g: line([356, -8926, 11302], [293, -8353, 11261], [103, -7639, 11094], [130, -6877, 10787]), h: [-1, -1] }, // fly 4.5-5.6 s
  { s: 0, g: line([132, -6870, 10783], [312, -5675, 10573]), h: [-1, -1], cut: 705 }, // ride 5.6-6.6 s (climb to the launch cut off)
  { s: 0, g: line([333, -4910, 10744], [380, -3644, 11007], [398, -2109, 10934]), h: [-1, -1] }, // fly 6.6-8.1 s
  { s: 0, g: line([1182, -733, 10916], [1187, -728, 10915]), h: [-1, -1] }, // fly 8.4-8.9 s
  { s: 0, g: line([1192, -723, 10914], [2045, -229, 10867], [3007, -56, 10865]), h: [-1, -1] }, // ride 8.9-10.0 s
  { s: 0, g: line([3052, -57, 10864], [3718, -129, 10797], [4399, -214, 10626]), h: [-1, -1] }, // fly 10.0-10.7 s
  { s: 0, g: line([4406, -215, 10624], [5297, -271, 10553]), h: [-1, -1], cut: 861 }, // ride 10.7-11.6 s (climb to the launch cut off)
  { s: 0, g: line([6188, -112, 10754], [6730, -47, 10915], [7652, -271, 11024], [8079, -553, 10993], [8690, -1147, 10803], [9229, -1890, 10405], [9608, -2558, 9920], [9900, -3400, 9182], [9971, -4014, 8560]), h: [-1, -1] }, // fly 11.6-14.9 s
  { s: 0, g: line([9971, -4022, 8552], [9934, -4752, 8078], [9944, -5622, 7915]), h: [-1, -1], cut: 814 }, // ride 14.9-15.8 s (climb to the launch cut off)
  { s: 0, g: line([9979, -6546, 7961], [9842, -7560, 7946], [9808, -8539, 7836]), h: [-1, -1] }, // fly 15.8-16.6 s
  { s: 0, g: line([9809, -8550, 7836], [9810, -8561, 7835]), h: [-1, -1], cut: 1388 }, // ride 16.6-17.1 s (climb to the launch cut off)
  { s: 0, g: line([9865, -10058, 8397], [10710, -10681, 8877], [11785, -10601, 9181], [12134, -10453, 9242], [12604, -9782, 9284], [12774, -9399, 9259], [12714, -8770, 9253], [12753, -8109, 9271], [12676, -7002, 9122]), h: [-1, -1] }, // fly 17.1-20.1 s
  { s: 0, g: line([12675, -6994, 9120], [12665, -6515, 9107]), h: [-1, -1], cut: 790 }, // ride 20.1-20.7 s (climb to the launch cut off)
  { s: 0, g: line([12707, -5360, 9198], [12641, -4522, 9174], [12363, -3549, 8974]), h: [-1, -1] }, // fly 20.7-21.8 s
  { s: 0, g: line([12358, -3541, 8973], [11802, -2843, 8837]), h: [-1, -1], cut: 247 }, // ride 21.8-22.3 s (climb to the launch cut off)
  { s: 0, g: line([11638, -2637, 8867], [11355, -2049, 8965], [11249, -1516, 8990], [11281, -1159, 8979], [11575, -355, 8859], [11507, -15, 8773], [11310, 360, 8640], [10355, 957, 8125], [9729, 1064, 7734], [9033, 982, 7219]), h: [-1, -1] }, // fly 22.3-24.9 s
  { s: 0, g: line([9025, 980, 7214], [8451, 955, 7109]), h: [-1, -1], cut: 1705 }, // ride 25.0-25.9 s (climb to the launch cut off)
  { s: 0, g: line([6539, 1010, 7180], [4562, 868, 7073], [3044, 1046, 7021], [2285, 1160, 6882], [1440, 1714, 6578], [1247, 2029, 6431], [1132, 2753, 6086], [1199, 3538, 5633], [1230, 3780, 5595], [1175, 4197, 5664], [722, 5561, 6002], [460, 6349, 6075], [296, 7024, 6066]), h: [-1, -1] }, // fly 25.9-30.3 s
  { s: 0, g: line([83, 8488, 6332], [-62, 9101, 6565], [-83, 9853, 6755], [-59, 10485, 6842], [94, 11161, 6860], [142, 12185, 6740], [-10, 13523, 6317]), h: [-1, -1] }, // fly 30.9-33.2 s
  { s: 1, g: [[0, -14900, -7700]], h: [-1, -1] }, // stage 2: off the platform
  { s: 1, g: [[250, -14600, -8600], [250, -13900, -9200], [250, -13000, -9500], [250, -12100, -9580]], h: [0.6, 0.6] }, // the first ridge: its east face
  { s: 1, g: [[600, -10250, -10150], [600, -9000, -10340], [600, -7600, -10340], [600, -6700, -10120]], h: [0.5, 0.5] }, // the channel: its east side
  { s: 1, g: [[700, -5250, -9520], [1500, -5300, -9520], [2300, -5650, -9520], [2900, -6150, -9520]], h: [0.6, 0.6] }, // the arch: east, then south
  { s: 1, g: [[3650, -7100, -10096], [4300, -7650, -10096], [5000, -7950, -10096], [5700, -8050, -10096]], h: [0.6, 0.6] }, // around to the east
  { s: 1, g: [[6300, -7850, -10480], [8500, -7850, -10480]], h: [0.6, 0.6] },
  { s: 1, g: [[10450, -6700, -10900], [10450, -5600, -11300], [10450, -4500, -11380], [10450, -3300, -11380], [10450, -2200, -11300], [10450, -1250, -10900]], h: [0.6, 0.6] }, // north, down and up again
  { s: 1, g: [[9750, 1450, -10650], [9750, 2500, -10800], [9800, 3500, -10800], [10250, 4500, -10800]], h: [0.6, 0.6] },
  { s: 1, g: [[11250, 5600, -11376], [11850, 6600, -11376], [11950, 7360, -11376], [11850, 8100, -11376], [11250, 9150, -11376]], h: [0.6, 0.6] }, // the half circle, around to the north-west
  { s: 1, g: [[9000, 9100, -12450], [9000, 8200, -12850], [9000, 7300, -12900]], h: [0.6, 0.6] }, // back south
  { s: 1, g: [[9000, 5800, -12910], [9000, 4600, -12900], [9000, 3950, -12760]], h: [0.6, 0.6] },
  { s: 1, g: [[9300, 2100, -12272], [9200, 1100, -12272], [8600, 200, -12272], [7700, -250, -12272], [6200, -400, -12272]], h: [0.6, 0.6] }, // around to the west
  { s: 1, g: [[4700, -200, -12450], [4700, 1000, -12890], [4700, 2000, -12910]], h: [0.6, 0.6] }, // north again
  { s: 1, g: [[5100, 3300, -12912], [5100, 5400, -12912]], h: [0.6, 0.6] },
  { s: 1, g: [[4850, 7350, -13040], [4450, 8050, -13040], [3650, 8600, -13040], [2700, 8850, -13040], [1500, 8850, -13040]], h: [0.5, 0.5], cut: 1200 }, // the last curve, to the west, then climbing it
  { s: 1, g: [[0, 13540, -11870], [0, 13900, -11950]], h: [-1, -1], aim: 0 }, // launch off its top edge, up onto the end platform (770 higher, 4500 on: a planned launch)
];
const hull = (b: Box): Box => ({ min: [b.min[0] - 16, b.min[1] - 16, b.min[2] - 72], max: [b.max[0] + 16, b.max[1] + 16, b.max[2]] });
const small = (b: Box) => Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1]) < 900; // a portal, not a kill plane

const map: MapDef = {
  id: 'cyberwave',
  name: 'surf_cyberwave',
  blurb: 'Two long neon stages over a city, each with its own timer. The map sets max velocity 7500.',
  credit: { by: 'Mr.Cow', source: 'https://gamebanana.com/mods/82068', license: ['CC BY-NC-ND 4.0', 'https://creativecommons.org/licenses/by-nc-nd/4.0/'] },
  order: 0,
  difficulty: { tier: 2, run: 58, sections: 2 },
  spawn: { pos: [0, 0, 0], yaw: 90 },
  brushes: [],
  route: routeOf(STATIONS) as [number, number, number, number][],
  routeFlags: flagsOf(STATIONS),
  routeOnSurface: true,
  bsp: {
    url: 'maps/surf_cyberwave.bsp.gz',
    look: true, // drawn as it is: its neon, textures, lighting and sky
    apply: b => {
      const zone = (name: string): Box => { const t = b.triggers.filter(t => t.e.targetname === name); return hull({ min: [0, 1, 2].map(k => Math.min(...t.map(x => x.min[k]))) as Vec, max: [0, 1, 2].map(k => Math.max(...t.map(x => x.max[k]))) as Vec }); };
      const dest = (name: string): Spawn => { const e = b.entities.find(e => e.classname === 'info_teleport_destination' && e.targetname === name)!; return { pos: e.origin.split(' ').map(Number) as Vec, yaw: +e.angles.split(' ')[1] }; };
      const s1 = dest('s1_start'), s2 = dest('s2_start');
      const exit1 = b.fails.find(f => f.to && small(f) && f.to.pos.every((v, k) => Math.abs(v - s2.pos[k]) < 1))!; // stage 1's exit portal
      const end1: Box = { min: [exit1.min[0] - 16, exit1.min[1] - 256, exit1.min[2] - 72], max: [exit1.max[0] + 16, exit1.min[1] - 17, exit1.max[2]] }; // the 240 units in front of it
      return {
        brushes: b.brushes, pushes: b.pushes, spawn: s1,
        fails: b.fails.map(f => (small(f) ? { ...f, quiet: true } : f)), // portals move you on (or back to the spawn room): not falls
        stages: [
          { name: 'Stage 1', start: zone('s1_start_zone'), end: end1, spawn: s1 },
          { name: 'Stage 2', start: zone('s2_start_zone'), end: zone('s2_end_zone'), spawn: s2 },
        ],
      };
    },
  },
};
export default map;
