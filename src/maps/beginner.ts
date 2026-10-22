import { type Box, type MapDef, type Spawn, type Station, flagsOf, routeOf } from '../game';
import type { Vec } from '../physics';

// surf_beginner (Kiiru, 2011; CS:S, BSP v20) imported from public/maps/, shipped unmodified under its CC BY-NC-ND 4.0
// licence with credit (CREDITS.md). Seven short stages, each in its own room: drop off the platform, ride to the portal
// at the far end, which takes you to the next stage's platform. Falls teleport you back to the stage's platform. Every
// arrival point is a small invisible cage with no floor: teleports keep your speed (Source), the cage takes it and you
// drop onto the platform, so each stage starts from still. The map has no timer volumes: a stage starts on its platform
// and ends where its portal lands you (the next stage's platform; the last one's, a toilet).
// You start, and R restarts, on stage 1's platform, as a timer's restart does: the map's spawn room (a walk into the
// stage 1 portal) and its secret room are skipped.
// Each stage has a twist: a cross ramp with a portal at either end (2), a U-turn round a wall (3), a grate to clear (4),
// two slaloms round diamond pillars and a dive through a hole in the floor (5), a grate to ride under and a fence to
// clear, then back under the floor to a kicker (6), and round the corridor's end, back down a side hall, through a
// hole and across a lower hall (7). The autopilot line is verified for stages 1-4 at 256 tick (test/); the planned run
// (src/runs.ts) is that line, and hands back after stage 4. The rest of the line is a guide for the planner: it finds
// stage 6 along it from a standing start; stage 5's second slalom and stage 7's lower hall are unsolved.
const STAGES: [string, number, number, number, number, number][] = [ // each stage's arrival point and the platform under it: x0, y0, x1, y1, top
  ['failman1', -448, -64, 192, 256, 320],
  ['failman2', 2016, 2176, 3040, 2432, 512],
  ['failman3', 1312, -96, 1664, 640, 768],
  ['failman4', 2528, 5472, 2784, 6304, 672],
  ['failman5', -5920, -1888, -5664, -1376, 2576],
  ['failman6', -2608, 32, -2032, 288, 2208],
  ['failman7', -5568, 544, -5056, 736, 2640],
];
/** Autopilot line (see Station): s = the stage (verified through stage 4, see above). */
export const STATIONS: Station[] = [
  { s: 0, g: [[-128, 330, 300]], h: [-1, -1] }, // stage 1: walk off the platform
  { s: 0, g: [[32, 400, 230], [32, 650, 140], [32, 900, 50], [32, 980, 20]], h: [0.6, 0.6] },
  { s: 0, g: [[-128, 1500, -60], [-128, 2004, -280], [-128, 2400, -280]], h: [-1, -1] }, // pop off its end, into the portal (and on: a miss keeps heading in)
  { s: 1, g: [[2528, 2500, 480]], h: [-1, -1] }, // stage 2
  { s: 1, g: [[2378, 2700, 420], [2378, 2950, 380], [2378, 3200, 340], [2378, 3330, 320]], h: [0.6, 0.6] },
  { s: 1, g: [[2200, 3700, 230]], h: [-1, -1] }, // turn left in the air: land on the cross ramp going its way
  { s: 1, g: [[1950, 3968, 130], [1800, 3968, 130]], h: [0.5, 0.5] }, // the cross ramp: west
  { s: 1, g: [[1400, 3968, 40], [1068, 3968, 40], [700, 3968, 40]], h: [-1, -1] },
  { s: 2, g: [[1700, 272, 760]], h: [-1, -1] }, // stage 3
  { s: 2, g: [[1850, 412, 600], [2150, 412, 560], [2450, 412, 520], [2750, 412, 470], [3050, 412, 470]], h: [0.6, 0.6] },
  { s: 2, g: [[3370, 525, 510], [3484, 796, 480], [3370, 1067, 450]], h: [-1, -1] }, // U-turn round the wall
  { s: 2, g: [[3050, 1172, 300], [2750, 1172, 250], [2450, 1172, 200], [2150, 1172, 170], [1950, 1172, 160]], h: [0.6, 0.6], cut: 250 },
  { s: 2, g: [[1640, 1312, 340], [1330, 1312, 330], [1000, 1312, 330]], h: [-1, -1], aim: 1 }, // up onto the platform, into the portal
  { s: 3, g: [[2500, 5888, 650]], h: [-1, -1] }, // stage 4
  { s: 3, g: [[2300, 6028, 600], [1900, 6028, 450], [1500, 6028, 300], [1100, 6028, 200], [800, 6028, 180], [500, 6028, 200]], h: [0.6, 0.8], cut: 300 },
  { s: 3, g: [[150, 5888, 420], [-350, 5888, 100]], h: [-1, -1], aim: 0 }, // over the grate
  { s: 3, g: [[-700, 6000, -300], [-1100, 6000, -300], [-1500, 6000, -300]], h: [0.6, 0.6], cut: 200 },
  { s: 3, g: [[-2000, 5888, -170], [-2450, 5888, -180], [-2772, 5888, -160], [-3100, 5888, -160]], h: [-1, -1] }, // up onto the platform, into the portal
  { s: 4, g: [[-5600, -1632, 2560]], h: [-1, -1] }, // stage 5
  { s: 4, g: [[-5400, -1492, 2110], [-5000, -1492, 1960], [-4600, -1492, 1810], [-4250, -1492, 1690]], h: [0.6, 0.8], cut: 300 },
  // a slalom (a diamond pillar with a wall tooth either side: under the tooth tips, over the pillar's point), then a dive
  // through the hole in the floor onto the lower ramp
  { s: 4, g: [[-3600, -1295, 1900], [-3219, -1195, 1820], [-2835, -1295, 1650], [-2300, -1500, 1000]], h: [-1, -1], aim: 0, dive: [3] },
  { s: 4, g: [[-2150, -1500, 900], [-1800, -1500, 800], [-1400, -1500, 700], [-1050, -1500, 640]], h: [0.6, 0.8], cut: 250 },
  { s: 4, g: [[-413, -1295, 900], [-32, -1195, 880], [350, -1295, 850], [1000, -1500, 820], [1332, -1632, 780]], h: [-1, -1], aim: 0 }, // the second slalom, onto the platform
  { s: 5, g: [[-2320, 330, 2190]], h: [-1, -1] }, // stage 6
  { s: 5, g: [[-2460, 700, 1975], [-2460, 1100, 1905], [-2460, 1500, 1870], [-2460, 1800, 1870]], h: [0.85, 0.25] },
  { s: 5, g: [[-2460, 1950, 1870], [-2460, 2150, 1870]], h: [0.25, 0.25] }, // low under the grate across it
  { s: 5, g: [[-2460, 2350, 1870]], h: [0.6, 0.6] }, // then climb: launch
  { s: 5, g: [[-2320, 2752, 2230], [-2320, 3200, 1850], [-2600, 3450, 1450], [-2460, 3250, 1000]], h: [-1, -1], aim: 0 }, // over the fence, back round and down under the floor
  { s: 5, g: [[-2460, 3100, 750], [-2460, 2900, 600]], h: [0.5, 0.5] },
  { s: 5, g: [[-2320, 2300, 450]], h: [-1, -1] },
  { s: 5, g: [[-2460, 1650, 250], [-2460, 1300, 400], [-2460, 1080, 480]], h: [0.6, 0.6] },
  { s: 5, g: [[-2320, 500, 550], [-2320, 200, 420], [-2320, 30, 650]], h: [-1, -1] }, // up the kicker into the portal
  { s: 6, g: [[-5312, 760, 2620]], h: [-1, -1] }, // stage 7
  { s: 6, g: [[-5424, 900, 2080], [-5424, 1300, 1745], [-5424, 1700, 1420], [-5424, 2100, 1290], [-5424, 2600, 1190], [-5424, 3200, 1175], [-5424, 3800, 1175], [-5424, 4250, 1175]], h: [0.6, 0.6] },
];
const portal = (f: Box) => f.max[2] - f.min[2] >= 200 && Math.max(f.max[0] - f.min[0], f.max[1] - f.min[1]) <= 300; // tall and narrow: a portal, not a kill volume

const map: MapDef = {
  id: 'beginner',
  name: 'surf_beginner',
  blurb: 'Seven short stages, each with its own timer: the classic first surf map.',
  credit: { by: 'Kiiru', source: 'https://gamebanana.com/mods/121714', license: ['CC BY-NC-ND 4.0', 'https://creativecommons.org/licenses/by-nc-nd/4.0/'] },
  order: 0,
  difficulty: { tier: 1, run: 45, sections: 7 },
  spawn: { pos: [0, 0, 0], yaw: 90 },
  brushes: [],
  route: routeOf(STATIONS) as [number, number, number, number][],
  routeFlags: flagsOf(STATIONS),
  routeCorners: true,
  routeOnSurface: true,
  bsp: {
    url: 'maps/surf_beginner.bsp',
    sha256: 'c7679bbb68829273c7ab86c7404096b65f4ef8f94ab09433da987c8f474e8d8d',
    apply: b => {
      const dest = (name: string): Spawn => {
        const e = b.entities.find(e => e.classname === 'info_teleport_destination' && e.targetname?.toLowerCase() === name.toLowerCase())!;
        return { pos: e.origin.split(' ').map(Number) as Vec, yaw: +e.angles.split(' ')[1] };
      };
      const starts = STAGES.map(([, x0, y0, x1, y1, top]): Box => ({ min: [x0, y0, top - 16], max: [x1, y1, top + 400] }));
      const toilet = dest('Endman_poop').pos, end: Box = { min: [toilet[0] - 80, toilet[1] - 80, toilet[2] - 48], max: [toilet[0] + 80, toilet[1] + 80, toilet[2] + 80] };
      const stages = STAGES.map(([name], i) => ({ name: `Stage ${i + 1}`, start: starts[i], end: starts[i + 1] ?? end, spawn: dest(name) }));
      return { brushes: b.brushes, pushes: b.pushes, spawn: stages[0].spawn, stages, fails: b.fails.map(f => (f.to && portal(f) ? { ...f, quiet: true } : f)) };
    },
  },
};
export default map;
