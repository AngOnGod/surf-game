import { type Box, type MapDef, type Station, flagsOf, routeOf } from '../game';
import type { Vec } from '../physics';

// surf_mesa (Arblarg, 2014; CS:S, BSP v20) imported from public/maps/, shipped unmodified under its CC BY-NC-ND 4.0
// licence with credit (CREDITS.md). One long linear course that winds down the whole map: the top tube, a loop out
// along the north edge, down one side and back along the south, north again, into the centre, through a big box over
// a kill pit, then the bottom run north to the blast door. The map is mirror-symmetric (x -> -x), so there are two
// routes (east and west) and the checkpoints cover both. Falls teleport back to the spawn room, as on a server.
// The map has no timer volumes: the start is the spawn platform, the end the blast door's trigger, the checkpoints are
// placed by hand at the section changes. Left out: the moving crystals (func_tanktrain) and the secret (it is opened
// with buttons: the secret door is left open, the island teleport stays off).
const both = (min: Vec, max: Vec): Box[] => [{ min, max }, { min: [-max[0], min[1], min[2]], max: [-min[0], max[1], max[2]] }];
const cp = (name: string, [a, ...also]: Box[]) => ({ name, ...a, also }); // centre ones need no mirror
// The autopilot line is verified through checkpoint 2 (both tick parities, nudged starts; test/). Past it, the east
// side dips: the curve bottoms out ~900 units below the next ramp, and the way on is a big carve up the curve's face (or
// flying over the dip from the corner), which the autopilot doesn't do yet; the stations past there are a draft. The
// whole course is connected (a swept flood fill from the spawn to the blast door touches no kill volume; test/).
// Under some kill slabs there's a solid floor with room to stand: the autopilot's searches count going there as a fall.
/** Autopilot line (see Station), the east route: s = the section (0 = start to checkpoint 1, ...). */
export const STATIONS: Station[] = [
  { s: 0, g: [[0, -300, 10170]], h: [-1, -1] }, // off the spawn platform onto the ridge
  { s: 0, g: [[210, 28, 9889], [210, 540, 9791], [210, 1052, 9778], [210, 1564, 9778], [210, 2076, 9778], [210, 2588, 9832], [234, 2844, 9862]], h: [0.583, 0.75] }, // the top ridge
  { s: 0, g: [[-155, 3700, 8900]], h: [-1, -1], tune: true }, // off its end, over the gap
  { s: 0, g: [[328, 4356, 7812], [208, 4740, 7491], [208, 5124, 7053], [208, 5508, 6769], [208, 5796, 6619]], h: [0.43, 0.483] }, // the second ridge, down into the tunnel
  { s: 0, g: [[204, 6312, 6457], [204, 6824, 6401], [204, 7336, 6414], [204, 7848, 6512]], h: [0.675, 0.692], cut: 908.694 }, // the tunnel: its end kicks up
  { s: 0, g: [[363, 9800, 7211], [326, 11400, 7050]], h: [-1, -1], tune: true, aim: 1 }, // launch the length of the hall (its floor kills)
  { s: 1, g: [[208, 11812, 6942], [240, 12324, 6945], [376, 12836, 6944], [632, 13348, 6943], [1048, 13860, 6948], [1320, 14244, 7097]], h: [0.6, 0.75] }, // north, bearing east
  { s: 1, g: [[1908, 14422, 6942], [2932, 14622, 6935], [3956, 14958, 6926], [4980, 14958, 6926], [6004, 14958, 6926], [7028, 14958, 6926]], h: [0.47165581488254255, 0.75] }, // east along the north edge
  { s: 1, g: [[7924, 14974, 6853], [8948, 14974, 6763], [9972, 14974, 6762], [10996, 14942, 6759], [12020, 14574, 6770], [12532, 14326, 6909]], h: [0.5085573797830936, 0.75] },
  { s: 1, g: [[13104, 13824, 6750], [13480, 13312, 6639], [13936, 12800, 6589]], h: [0.472356188910516, 0.8721852950446711] }, // round the corner, south
  { s: 1, g: [[14317, 12152, 6522], [14749, 11193, 6361], [14937, 10186, 6371], [14937, 9143, 6371], [14935, 8230, 6475]], h: [0.6, 0.7326933351434584] },
  { s: 2, g: [[14900, 6800, 5200]], h: [-1, -1], tune: true }, // down the east side
  { s: 2, g: [[14806, 5496, 3816], [14934, 4472, 3033], [14934, 3448, 2681], [14934, 2424, 2708]], h: [0.6, 0.97] }, // the curve: carve up its face to the lip at its end
  { s: 2, g: [[15500, 1500, 3500], [15000, 0, 3800]], h: [-1, -1], tune: true }, // off the lip, high, swinging back west onto the next (higher) ramp
  { s: 2, g: [[14642, -112, 3603], [14642, -1136, 3603], [14642, -2032, 3603]], h: [0.6, 0.75] },
  { s: 2, g: [[14642, -2800, 3532], [14642, -3824, 3442], [14642, -4848, 3353], [14642, -5872, 3331], [14642, -7024, 3331]], h: [0.6, 0.75] },
  { s: 2, g: [[14898, -8176, 3123], [14866, -8688, 3114], [14746, -9200, 3120]], h: [0.6, 0.75] },
  { s: 3, g: [[13824, -10672, 2944], [12800, -10672, 2944], [11776, -10672, 2944], [10880, -10672, 2944]], h: [0.6, 0.75] }, // west along the south edge
  { s: 3, g: [[10624, -10424, 2573], [10112, -10272, 2717], [9600, -9816, 2720]], h: [0.6, 0.75] },
  { s: 3, g: [[9348, -6736, 2288], [9236, -5712, 1886], [9236, -4688, 1771], [9276, -3920, 1837]], h: [0.6, 0.75] }, // north again
  { s: 3, g: [[9012, -1744, 1507], [9012, -720, 1507], [9012, -80, 1507]], h: [0.6, 0.75] },
  { s: 4, g: [[9012, 688, 1393], [9012, 1712, 1304], [9012, 2736, 1259], [9012, 3120, 1259]], h: [0.6, 0.75] },
  { s: 4, g: [[9012, 4272, 1062], [9012, 5296, 972], [9012, 6320, 883], [9012, 7216, 883]], h: [0.6, 0.75] },
  { s: 4, g: [[9076, 8240, 885], [9036, 8752, 881], [8900, 9264, 882]], h: [0.6, 0.75] },
  { s: 4, g: [[7104, 11044, 801], [6080, 11044, 801], [5056, 11044, 801], [4032, 11044, 801], [3008, 11044, 801], [1984, 10868, 799], [960, 10180, 800]], h: [0.6, 0.75] }, // west to the centre
  { s: 5, g: [[-596, 6040, 477], [-612, 5016, 21], [-628, 3992, -434], [-652, 2968, -879], [-668, 1944, -1334]], h: [0.6, 0.75] }, // into the box: its west wall
  { s: 5, g: [[-556, 988, -1934], [-684, -36, -2235], [-692, -1060, -2702], [-692, -2084, -3179], [-692, -2596, -3418]], h: [0.6, 0.75] },
  { s: 5, g: [[-796, -3108, -3574], [-756, -4132, -3624], [-756, -5156, -3547], [-756, -6180, -3272]], h: [0.6, 0.75] },
];

const map: MapDef = {
  id: 'mesa',
  name: 'surf_mesa',
  blurb: 'A long winding linear run down the whole map, two mirrored routes, 6 checkpoints; falls restart it.',
  credit: { by: 'Arblarg', source: 'https://gamebanana.com/mods/122542', license: ['CC BY-NC-ND 4.0', 'https://creativecommons.org/licenses/by-nc-nd/4.0/'] },
  order: 0,
  spawn: { pos: [0, 0, 0], yaw: 90 },
  brushes: [],
  start: { min: [-1056, -1000, 10080], max: [1056, -150, 10400] }, // the spawn platform
  end: { min: [-240, 14100, -12400], max: [240, 14600, -12000] }, // the blast door's trigger
  checkpoints: [
    cp('North Hall', [{ min: [-2600, 11200, 6200], max: [2600, 11500, 8000] }]),
    cp('East Wall', both([13800, 7800, 5000], [15600, 8100, 7600])),
    cp('South Turn', both([13800, -10000, 2400], [15600, -9700, 4200])),
    cp('North Run', both([7800, -400, 900], [10200, -100, 2400])),
    cp('The Box', [{ min: [-1500, 6100, -600], max: [1500, 6400, 1400] }]),
    cp('Bottom', [{ min: [-4400, -12400, -12400], max: [4400, -12100, -10800] }]),
  ],
  route: routeOf(STATIONS) as [number, number, number, number][],
  routeFlags: flagsOf(STATIONS),
  routeOnSurface: true,
  bsp: {
    url: 'maps/surf_mesa.bsp',
    apply: b => ({ brushes: b.brushes, pushes: b.pushes, fails: b.fails, spawn: b.spawn }),
  },
};
export default map;
