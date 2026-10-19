import { type Box, type MapDef, type Spawn, type Station, flagsOf, routeOf } from '../game';
import type { Vec } from '../physics';

// surf_kitsune (Arblarg, 2014; CS:S, BSP v20) imported from public/maps/, shipped unmodified under its CC BY-NC-ND
// 4.0 licence with credit (CREDITS.md). Nine stages, each inside its own rainbow tube (solid, invisible until the
// map's reward lights it). A fall onto a stage's kill floor teleports you back to that stage's start; a small
// teleport window at its far end sends you on to the next one, and the last one returns you to the spawn room.
// Teleports keep your velocity, as in Source (only your view turns to the destination's), so you carry your speed
// from one stage into the next. Stage zones aren't in the map file: starts are placed on each arrival platform, ends
// just in front of each exit window. The secret path works as in the map: back out of the spawn room (you get
// tagged), then each stage's hidden second exit only opens for the right tag, and teal's leads to the secret room
// with the rainbow trail. (The rainbow walls lighting up and the secret room's button are left out.) Most exits and
// gaps need a launch: climb the face and pop off its top (the autopilot plans these by look-ahead). The autopilot
// line is verified per stage in test/ (some stages at 128 tick only), and in one go from the spawn room, carrying
// the speed, through stages 1-4 at 128 tick (1-3 at 64), as the in-game demo runs it; White's line is mapped only
// through its first ridges. White is the long one: after its first ramp it threads glass grid walls and floors
// (window brushes: solid, drawn see-through), goes east through two grid windows, crosses the north of the map and
// drops in at the east end of a tube that runs the whole map back west to the exit window (a flood fill through free
// space, with every step swept, finds that way through without touching a kill volume; test/).
const STAGES: { name: string; dest: string; dir: Vec }[] = [ // dir: travel direction into the exit window
  { name: 'Red', dest: 'red', dir: [0, 1, 0] },
  { name: 'Orange', dest: 'orange', dir: [0, 1, 0] },
  { name: 'Yellow', dest: 'yellow', dir: [0, 1, 0] },
  { name: 'Green', dest: 'green', dir: [0, 1, 0] },
  { name: 'Teal', dest: 'teal', dir: [0, 1, 0] },
  { name: 'Blue', dest: 'blue', dir: [0, 1, 0] },
  { name: 'Purple', dest: 'purple', dir: [0, -1, 0] },
  { name: 'Pink', dest: 'pink', dir: [0, -1, 0] },
  { name: 'White', dest: 'white', dir: [-1, 0, 0] },
];
/** Autopilot line (see Station): the spawn walk, then each stage's stations (s: stage index). */
export const STATIONS: Station[] = [
  { s: -1, g: [[0, -1100, 100], [0, -500, 150]], h: [-1, -1] }, // spawn room: walk into the teleport to the first stage
  { s: 0, g: [[-15360, -14588, 675]], h: [-1, -1] }, // Red: jump off the platform
  { s: 0, g: [[-15112, -14588, 501], [-15144, -14076, 407], [-15144, -13564, 405], [-15144, -13052, 217], [-15144, -12540, 217], [-15144, -12412, 217]], h: [0.32965874134809586, 0.5026211075502656], cut: 855.8573364472209 },
  { s: 0, g: [[-15360, -12300, 560], [-15360, -11720, 480], [-15360, -10920, 480]], h: [-1, -1] }, // launch over the bar into the exit window
  { s: 1, g: [[-13424, -15323.732528727918, -511]], h: [-1, -1] }, // Orange: jump off the platform
  { s: 1, g: [[-13096, -14588, -681], [-13096, -14076, -725], [-13096, -13564, -769]], h: [0.5268084473851534, 0.5210421150998372], cut: 546.3823521609872 },
  { s: 1, g: [[-13242, -13512, -364], [-13304, -12606, -643.3646518805149], [-13292, -12102, -837]], h: [-1, -1] }, // launch into the exit window
  { s: 2, g: [[-11264, -14716, -1885]], h: [-1, -1] }, // Yellow: jump off the platform
  { s: 2, g: [[-11056, -14588, -2017], [-11056, -14076, -2107], [-11056, -13692, -2175]], h: [0.6602711714750038, 0.6779575263432733] },
  { s: 2, g: [[-10704, -13436, -2334], [-10704, -12924, -2334], [-10704, -12412, -2334]], h: [0.10287527229542581, 0.17653376355508366] },
  { s: 2, g: [[-11056, -12028, -2403], [-11056, -11516, -2403], [-11056, -11132, -2403]], h: [0.23555055615212916, 0.97], cut: 235.2573267153385 },
  { s: 2, g: [[-11361.334160719533, -10806.709210013476, -2086.0542395927696], [-11276.737208842575, -10787.345709296607, -2016], [-11371.150339452333, -10216.144007063314, -2493.236806800348]], h: [-1, -1] }, // launch into the exit window
  { s: 3, g: [[-8289, -14658, -3155]], h: [-1, -1] }, // Green: jump off the platform
  { s: 3, g: [[-7984, -14716, -3255], [-7984, -14204, -3493], [-7984, -13692, -3732], [-7984, -13180, -3971], [-7984, -12668, -4210], [-7984, -12156, -4448], [-7984, -11644, -4687], [-8096, -11516, -4603]], h: [0.5754383573163899, 0.5409146169313557], cut: 1256.7057285942483 },
  { s: 3, g: [[-8065, -11112, -4297]], h: [-1, -1] }, // launch over the gap
  { s: 3, g: [[-7376, -10364, -4559], [-7376, -9852, -4559]], h: [0.2581248925038087, 0.2784819572074515], cut: 842.6487878662317 },
  { s: 3, g: [[-7478, -9493, -4199], [-8227.22697525147, -8666, -4224], [-8047.456870706291, -8096, -4224]], h: [-1, -1] }, // launch into the exit window
  // Teal: the player's own line (scratch/demos/kitsune@128-s5.demo.json via scratch/demoguide.test.ts), exact points
  { s: 4, g: [[-5006, -14994, -5379], [-5039, -14682, -5368], [-5001, -14506, -5632]], h: [-1, -1] }, // fly 0.0-1.9 s
  { s: 4, g: [[-5000, -14504, -5637], [-4944, -14241, -5835], [-4888, -13977, -6033], [-4832, -13714, -6231], [-4805, -13384, -6352], [-4834, -13130, -6384]], h: [-1, -1], cut: 354 }, // ride 1.9-3.7 s (climb to the launch cut off)
  { s: 4, g: [[-4998, -12728, -6280], [-4929, -12434, -6222], [-4669, -12144, -6229], [-4628, -12021, -6253], [-4725, -11752, -6370], [-4822, -11483, -6487], [-4813, -11265, -6647], [-4803, -11046, -6807]], h: [-1, -1], aim: 3 }, // fly 3.7-5.4 s (through the right-hand window)
  { s: 4, g: [[-4802, -11037, -6814], [-4781, -10618, -7049], [-4815, -10360, -7078]], h: [-1, -1], cut: 330 }, // ride 5.4-6.1 s (climb to the launch cut off)
  { s: 4, g: [[-4881, -9727, -6903], [-4705, -9487, -6859], [-4683, -9317, -6851], [-4763, -9089, -6864], [-4953, -8892, -6913]], h: [-1, -1], aim: 1 }, // fly 6.1-7.1 s (through the second wall's window)
  { s: 5, g: [[-2048, -15000, -8050]], h: [-1, -1] }, // Blue: jump off the platform
  { s: 5, g: [[-1832, -14588, -8433], [-1840, -14076, -8580], [-1840, -13564, -8730], [-1840, -13052, -8860], [-1840, -12412, -9003]], h: [0.7716512331368924, 0.5650785292104834] },
  // the drop maze: over the top glass, down into the pit, back under the top glass, forward again under the middle one
  { s: 5, g: [[-1877, -11042, -9658], [-2079, -11494, -10775], [-2430, -11092, -11113], [-2227, -10863, -11050]], h: [-1, -1] },
  { s: 5, g: [[-1850, -10450, -12750], [-1850, -9900, -12900]], h: [0.9082613073355111, 0.7945031979909494] }, // the lower ridge
  { s: 5, g: [[-2048, -8700, -13080], [-2048, -8272, -13056], [-2048, -7500, -13056]], h: [-1, -1] }, // the exit window
  { s: 6, g: [[512, -14728, -12270]], h: [-1, -1] }, // Purple: jump off the platform
  { s: 6, g: [[728, -14444, -12545], [728, -13420, -12819], [728, -12396, -13094], [728, -11372, -13368], [728, -10348, -13642], [712, -9836, -13760]], h: [0.7537113650119012, 0.6971481466570424], cut: 452.7939624568276 },
  { s: 6, g: [[650, -9450, -13420]], h: [-1, -1], tune: true }, // launch toward the cross ridge (turning right)
  { s: 6, g: [[2268, -9632, -13847], [2780, -9632, -13847], [3164, -9632, -13847]], h: [0.5944195193378642, 0.97], cut: 910.6313866665254, aim: 0 }, // the cross ridge: turn right twice
  { s: 6, g: [[3900, -9600, -13500]], h: [-1, -1], tune: true }, // launch up onto the return ridge (turning right)
  { s: 6, g: [[4816, -9256, -13665], [4848, -10280, -13897], [4848, -11304, -14172], [4848, -12328, -14446], [4848, -13352, -14721], [4848, -13864, -14858]], h: [0.3508278393663743, 0.03], cut: 1613.5598904412768, aim: 0 },
  { s: 6, g: [[5050, -14400, -14000], [5056, -15900, -13984], [5056, -16700, -13984]], h: [-1, -1], tune: true, aim: 1 }, // big launch up into the exit window
  { s: 7, g: [[8192, -700, 6400]], h: [-1, -1] }, // Pink: jump off the platform
  { s: 7, g: [[8000, -900, 4914], [8000, -2000, 4621], [8000, -3100, 4327], [8000, -4200, 4033], [8000, -5300, 3740], [8000, -6400, 3446], [8000, -7500, 3152], [8000, -8600, 2859], [8000, -9700, 2565]], h: [0.6764868573914472, 0.04005453606128265], cut: 2000 },
  { s: 7, g: [[7500, -10900, 3000], [7500, -11312, 2900], [8192, -12320, 2800], [8192, -14368, 2650]], h: [-1, -1], tune: true, aim: 1 }, // launch, around the glass panel, through two slots
  { s: 7, g: [[8192, -15000, 2620], [8192, -15344, 2608], [8192, -16200, 2608]], h: [-1, -1] }, // onto the landing, into the exit window
  { s: 8, g: [[-15104, 14800, 10650]], h: [-1, -1] }, // White: jump off the platform
  { s: 8, g: [[-14900, 14200, 10473], [-14900, 13000, 10221], [-14900, 12000, 10011], [-14900, 11000, 9801], [-14900, 10000, 9591], [-14900, 9100, 9402]], h: [0.62, 0.62], cut: 1500 },
  { s: 8, g: [[-15750, 8250, 9450], [-15700, 7650, 9300]], h: [-1, -1], tune: true, aim: 1 }, // pop over the apex into the left-hand gap past the pillar, over the wall
  { s: 8, g: [[-15650, 6700, 7700], [-15680, 5800, 6600]], h: [-1, -1], tune: true, dive: [0, 1] }, // dive under the raised kill shelf, through the left-hand gap
  { s: 8, g: [[-15300, 5400, 6050], [-15300, 4900, 5950]], h: [0.62, 0.62] }, // the second ridge
];
const small = (b: Box) => Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1]) < 900; // a window, not a kill floor
const same = (a: Vec, b: Vec) => a.every((v, k) => Math.abs(v - b[k]) < 1);

const map: MapDef = {
  id: 'kitsune',
  name: 'surf_kitsune',
  blurb: 'Nine short neon stages, each with its own timer.',
  credit: { by: 'Arblarg', source: 'https://gamebanana.com/mods/122382', license: ['CC BY-NC-ND 4.0', 'https://creativecommons.org/licenses/by-nc-nd/4.0/'] },
  order: 0,
  difficulty: { tier: 2, run: 59, sections: 9 }, // community tier 1, a step up here: harder than the other beginner maps
  spawn: { pos: [0, 0, 0], yaw: 90 },
  brushes: [],
  route: routeOf(STATIONS) as [number, number, number, number][],
  routeFlags: flagsOf(STATIONS),
  routeCorners: true,
  routeOnSurface: true,
  bsp: {
    url: 'maps/surf_kitsune.bsp',
    apply: b => {
      const dest = (name: string): Spawn => {
        const e = b.entities.find(e => e.classname === 'info_teleport_destination' && e.targetname?.toLowerCase() === name)!;
        return { pos: e.origin.split(' ').map(Number) as Vec, yaw: +e.angles.split(' ')[1] };
      };
      const stages = STAGES.map((st, i) => {
        const spawn = dest(st.dest), next = dest(STAGES[i + 1]?.dest ?? 'start');
        const exit = b.fails.find(f => f.to && small(f) && same(f.to.pos, next.pos))!;
        const back = st.dir.map(v => -v * 400);
        const end: Box = { // the exit window, grown a little and stretched back along the approach
          min: exit.min.map((v, k) => v - 64 + Math.min(0, back[k])) as Vec,
          max: exit.max.map((v, k) => v + 64 + Math.max(0, back[k])) as Vec,
        };
        const p = spawn.pos, start: Box = { min: [p[0] - 220, p[1] - 220, p[2] - 16], max: [p[0] + 220, p[1] + 220, p[2] + 160] };
        return { name: st.name, start, end, spawn };
      });
      // the reward trail: an env_spritetrail that a trigger (on the ledge behind the spawn room) parents to the player
      // (the sprite waits in the spawn room: a plain SetParent would keep that offset, so it's attached at chest height)
      const sprite = b.entities.find(e => e.classname === 'env_spritetrail')!;
      const zone = b.triggers.find(t => Object.values(t.e).some(v => v.startsWith(`${sprite.targetname},SetParent`)))!;
      const trail = { zone, width: [+sprite.startwidth, +sprite.endwidth] as [number, number], life: +sprite.lifetime, height: 40 };
      return { brushes: b.brushes, pushes: b.pushes, namers: b.namers, spawn: b.spawn, stages, trail, fails: b.fails.map(f => (small(f) ? { ...f, quiet: true } : f)) };
    },
  },
};
export default map;
