import { type Box, type MapDef, type Spawn, type Station, flagsOf, routeOf } from '../game';
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
/** Autopilot line (see Station), the east side of both stages (they're mirror images): s = the stage.
 *  Guide points are on the ramps (most are invisible clip brushes under the models), found from the map's brushes. */
export const STATIONS: Station[] = [
  { s: 0, g: [[0, -14300, 13350]], h: [-1, -1] }, // stage 1: off the platform's north edge
  { s: 0, g: [[250, -14200, 12800], [250, -13700, 12290], [250, -13200, 12030], [250, -12700, 11910], [250, -12100, 11880]], h: [0.5, 0.5] }, // the curved drop (a trough): its east side
  { s: 0, g: [[300, -10900, 11400], [300, -9100, 11400]], h: [0.6, 0.6] }, // a ridge: its east face
  { s: 0, g: [[300, -7800, 10580], [300, -6000, 10580], [300, -5100, 10720]], h: [0.6, 0.85] },
  { s: 0, g: [[380, -4300, 11150]], h: [-1, -1] }, // hop: the next ramp is higher, its end a wall
  { s: 0, g: [[450, -3100, 11000], [550, -1900, 11000], [1100, -900, 11000], [1900, -350, 11000], [2900, -150, 11000]], h: [0.6, 0.6] }, // the ridge curves east
  { s: 0, g: [[4000, -250, 10480], [6100, -250, 10480]], h: [0.6, 0.85] },
  { s: 0, g: [[6750, -330, 10650]], h: [-1, -1] }, // hop (the same height across a gap)
  { s: 0, g: [[7400, -450, 10480], [8800, -650, 10480], [9900, -1450, 10480], [10400, -2700, 10480]], h: [0.6, 0.6] }, // the arch: around to the south
  { s: 0, g: [[10150, -3500, 9200], [10150, -4500, 8500], [10150, -5500, 8100], [10150, -6300, 7950]], h: [0.6, 0.85] }, // down south
  { s: 0, g: [[9950, -7000, 8150]], h: [-1, -1] }, // hop
  { s: 0, g: [[9750, -7700, 7950], [9750, -8800, 8050], [9750, -9700, 8350]], h: [0.6, 0.6] }, // it rises at the end
  { s: 0, g: [[9740, -10810, 9200], [10400, -11600, 9300], [11150, -11800, 9350], [11900, -11600, 9300], [12560, -10810, 9200]], h: [-1, -1] }, // the U-turn in the air, around the solid light tower (x 10240-12032, y -10240 to -8448) inside clip walls
  { s: 0, g: [[12550, -10000, 8944], [12550, -8400, 8944]], h: [0.6, 0.85] }, // the outer ramps, north: the first, climbing it
  { s: 0, g: [[12570, -7800, 9180]], h: [-1, -1] }, // hop the gap (the next piece's end is a wall: the drop over the gap would hit it)
  { s: 0, g: [[12550, -7200, 8944], [12550, -5500, 8944]], h: [0.6, 0.6] },
  { s: 0, g: [[12450, -4400, 8944], [12300, -3600, 8944], [11800, -2800, 8944]], h: [0.6, 0.6] },
  { s: 0, g: [[10700, -2300, 8944], [10250, -1500, 8944], [10050, -500, 8944]], h: [0.6, 0.6] },
  { s: 0, g: [[10500, 1000, 8400], [9300, 1000, 7350], [8000, 1000, 7190], [7600, 1000, 7184]], h: [0.6, 0.85] }, // west
  { s: 0, g: [[6300, 870, 7400]], h: [-1, -1] }, // hop
  { s: 0, g: [[5000, 750, 7184], [3200, 750, 7184]], h: [0.6, 0.6] },
  { s: 0, g: [[1240, 950, 7000], [1300, 2000, 5900], [1300, 3000, 5550], [1300, 3700, 5520]], h: [0.8, 0.85] }, // a curved drop, north: onto its top (steep there, it falls away faster than a flight)
  { s: 0, g: [[800, 4700, 6300]], h: [-1, -1] }, // hop up onto the last ridge
  { s: 0, g: [[300, 5700, 6060], [300, 8400, 6060]], h: [0.4, 0.4], cut: 2400 }, // the last ridge: ride it low, then climb to its crest just as it ends
  { s: 0, g: [[0, 13060, 6260], [0, 13700, 6200]], h: [-1, -1], aim: 0 }, // the long flight onto the platform in front of the exit portal (a planned launch)
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
