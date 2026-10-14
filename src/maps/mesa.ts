import { type Box, type MapDef, type Station, flagsOf, line, routeOf } from '../game';
import type { Vec } from '../physics';

// surf_mesa (Arblarg, 2014; CS:S, BSP v20) imported from public/maps/, shipped unmodified under its CC BY-NC-ND 4.0
// licence with credit (CREDITS.md). One long linear course that winds down the whole map: the top tube, a loop out
// along the north edge, down one side and back along the south, north again, into the centre, through a big box over
// a kill pit, then the bottom run north to the blast door. The map is mirror-symmetric (x -> -x), so there are two
// routes (east and west) and the checkpoints cover both. Falls teleport back to the spawn room, as on a server.
// The map has no timer volumes: the start is the spawn platform, the end the blast door's trigger, the checkpoints are
// placed by hand at the section changes. The cave rock around the route is the map's own displacements: solid, as in
// Source (one-sided: from behind, the stuck check stops you dead), except the few the map flags as not solid to players.
// The static props (stalactites, rock clusters, cacti) are drawn and solid through their collision hulls, all but one
// stock rock model the map doesn't pack (rockcliff_cluster02b: not drawn, not solid). Left out: the moving crystals
// (func_tanktrain) and the secret (it is opened with buttons: the secret door is left open, the island teleport stays off).
const both = (min: Vec, max: Vec): Box[] => [{ min, max }, { min: [-max[0], min[1], min[2]], max: [-min[0], max[1], max[2]] }];
const cp = (name: string, [a, ...also]: Box[]) => ({ name, ...a, also }); // centre ones need no mirror
// The autopilot line is the player's own run (test/runs/mesa@256.json, saved in-game; stations by scratch/demoguide.test.ts):
// one station per ride or flight, every key an exact point; the planned runs (src/runs.ts) were searched along it. That
// run was recorded while the rock was drawn only, and it goes through rock in 7 places (under the north hall's shelf at
// 12 s, and briefly six more times), so it no longer replays: the planned runs keep to the line where they can and go
// around the rock and the props where it went through. The whole course is connected (a flood fill from the spawn to
// the blast door, each step swept both ways, touches no kill volume, rock or solid prop; test/).
// Under some kill slabs there's a solid floor with room to stand: the autopilot's searches count going there as a fall.
/** Autopilot line (see Station), the east route: s = the section (0 = start to checkpoint 1, ...). */
export const STATIONS: Station[] = [
  { s: 0, g: line([62, -148, 10181], [41, -47, 10196], [112, 121, 9996]), h: [-1, -1] }, // fly 0.0-1.0 s
  { s: 0, g: line([113, 122, 9994], [197, 257, 9850], [240, 476, 9758], [312, 1943, 9650]), h: [-1, -1], cut: 554 }, // ride 1.0-3.6 s (climb to the launch cut off)
  { s: 0, g: line([297, 2967, 9827], [-59, 3369, 9658], [-153, 3885, 9237], [-104, 4489, 8449], [77, 5083, 7309]), h: [-1, -1] }, // fly 3.6-6.5 s
  { s: 0, g: line([78, 5087, 7302], [147, 5475, 6873], [188, 5857, 6616], [219, 6307, 6439], [237, 6848, 6361]), h: [-1, -1], cut: 1038 }, // ride 6.5-7.8 s (climb to the launch cut off)
  { s: 0, g: line([164, 7967, 6597], [29, 8888, 6939], [42, 9726, 7121], [100, 10802, 7179], [139, 11930, 7029]), h: [-1, -1] }, // fly 7.8-9.7 s
  { s: 1, g: line([139, 11938, 7028], [435, 12928, 6914], [956, 13707, 6886]), h: [-1, -1], cut: 2442 }, // ride 9.7-11.7 s (climb to the launch cut off)
  { s: 1, g: line([3095, 14786, 7140], [3925, 14857, 7209], [4821, 15080, 7131], [5653, 15000, 6979]), h: [-1, -1] }, // fly 11.7-13.0 s
  { s: 1, g: line([5661, 14999, 6977], [6403, 14958, 6925]), h: [-1, -1], cut: 892 }, // ride 13.0-13.8 s (climb to the launch cut off)
  { s: 1, g: line([7299, 15030, 7016], [8011, 15073, 7093], [8937, 15080, 7056], [10052, 15005, 6801]), h: [-1, -1] }, // fly 13.8-15.1 s
  { s: 1, g: line([10061, 15004, 6799], [10738, 14935, 6717]), h: [-1, -1], cut: 991 }, // ride 15.1-15.9 s (climb to the launch cut off)
  { s: 1, g: line([12711, 14141, 6957], [13163, 13807, 6917], [13600, 13382, 6807]), h: [-1, -1] }, // fly 15.9-17.0 s
  { s: 1, g: line([13605, 13376, 6805], [13795, 13128, 6754]), h: [-1, -1], cut: 489 }, // ride 17.0-17.4 s (climb to the launch cut off)
  { s: 1, g: line([14170, 12790, 6787], [14459, 12496, 6812], [14710, 12024, 6798], [15016, 10695, 6521]), h: [-1, -1] }, // fly 17.4-18.5 s
  { s: 1, g: line([15016, 10687, 6519], [14979, 10028, 6424]), h: [-1, -1], cut: 1841 }, // ride 18.5-19.7 s (climb to the launch cut off)
  { s: 1, g: line([15041, 8104, 6644], [15181, 7094, 6851], [14994, 6952, 6868], [14606, 7098, 6863], [14512, 6973, 6846], [14580, 6830, 6818], [14805, 6700, 6750], [15155, 6642, 6614], [15275, 6470, 6498], [15201, 6289, 6371], [14933, 6116, 6122], [14879, 5913, 5927], [14948, 5799, 5782], [15216, 5712, 5427], [15339, 5407, 4934], [15319, 5205, 4597], [15054, 4574, 3276]), h: [-1, -1] }, // fly 19.7-23.5 s
  { s: 2, g: line([15051, 4569, 3268], [15003, 4307, 3034], [14969, 3916, 2826], [14932, 3219, 2661]), h: [-1, -1], cut: 889 }, // ride 23.5-24.4 s (climb to the launch cut off)
  { s: 2, g: line([15079, 2279, 2917], [15257, 1322, 3270], [15297, 323, 3488], [15189, -636, 3558], [15156, -1728, 3476], [15059, -3197, 3588], [15000, -3745, 3547], [15024, -4436, 3426]), h: [-1, -1] }, // fly 24.4-27.4 s
  { s: 2, g: line([15025, -4444, 3424], [15089, -5468, 3286]), h: [-1, -1], cut: 1618 }, // ride 27.4-28.6 s (climb to the launch cut off)
  { s: 2, g: line([14981, -7127, 3423], [15033, -8375, 3425], [14955, -9069, 3323]), h: [-1, -1] }, // fly 28.6-29.4 s
  { s: 2, g: line([14952, -9078, 3322], [14698, -9628, 3275], [14257, -10235, 3259]), h: [-1, -1], cut: 135 }, // ride 29.4-30.1 s (climb to the launch cut off)
  { s: 3, g: line([14066, -10427, 3262], [13720, -10685, 3244], [13132, -10853, 3171]), h: [-1, -1] }, // fly 30.1-30.6 s
  { s: 3, g: line([13123, -10853, 3171], [11513, -10742, 3031], [10753, -10620, 2879], [10345, -10456, 2760], [9671, -9826, 2650], [9191, -9030, 2619]), h: [-1, -1], cut: 264 }, // ride 30.6-32.7 s (climb to the launch cut off)
  { s: 3, g: line([9093, -8775, 2625], [8720, -7777, 2549], [8596, -7269, 2449], [8539, -6157, 2102], [8716, -5253, 1674]), h: [-1, -1] }, // fly 32.7-34.3 s
  { s: 3, g: line([8718, -5244, 1669], [8699, -4426, 1645]), h: [-1, -1], cut: 571 }, // ride 34.3-34.9 s (climb to the launch cut off)
  { s: 3, g: line([8672, -3803, 1742], [8682, -3061, 1862], [8762, -2297, 1893], [8824, -1513, 1828], [8888, -730, 1663]), h: [-1, -1] }, // fly 34.9-36.3 s
  { s: 3, g: line([8889, -721, 1661], [8945, 32, 1591]), h: [-1, -1] }, // ride 36.3-36.6 s
  { s: 4, g: line([8945, 41, 1591], [8954, 1331, 1411]), h: [-1, -1] }, // fly 36.6-37.2 s
  { s: 4, g: line([8954, 1340, 1409], [8983, 3051, 1296]), h: [-1, -1], cut: 198 }, // ride 37.2-38.0 s (climb to the launch cut off)
  { s: 4, g: line([8981, 3258, 1297], [8945, 4106, 1258], [8921, 4974, 1115]), h: [-1, -1] }, // fly 38.0-38.7 s
  { s: 4, g: line([8922, 4984, 1113], [8981, 6383, 921]), h: [-1, -1], cut: 806 }, // ride 38.7-39.6 s (climb to the launch cut off)
  { s: 4, g: line([8948, 7335, 967], [8999, 8923, 878]), h: [-1, -1] }, // fly 39.6-40.3 s
  { s: 4, g: line([8771, 9893, 1091], [8532, 10223, 1238], [8158, 10490, 1369], [7426, 10700, 1504], [6673, 10905, 1538], [5761, 11075, 1440], [4948, 11014, 1229], [4198, 11141, 923]), h: [-1, -1] }, // fly 40.7-43.0 s
  { s: 4, g: line([4189, 11140, 921], [3669, 11033, 787], [2363, 10940, 747]), h: [-1, -1], cut: 2439 }, // ride 43.0-44.9 s (climb to the launch cut off)
  { s: 4, g: line([122, 8666, 1134], [325, 7726, 1073], [414, 6651, 794], [539, 5847, 436], [535, 4905, -137]), h: [-1, -1] }, // fly 45.0-47.3 s
  { s: 5, g: line([534, 4897, -142], [660, -897, -2670], [791, -3329, -3580], [719, -4868, -3670]), h: [-1, -1], cut: 1052 }, // ride 47.3-51.2 s (climb to the launch cut off)
  { s: 5, g: line([554, -6564, -3269], [-289, -7375, -3122], [-386, -7636, -3105], [-401, -8026, -3096], [-302, -8331, -3099], [-103, -8594, -3113], [866, -9165, -3244], [984, -9406, -3296], [992, -9725, -3368], [773, -10074, -3481], [6, -10387, -3765], [-175, -10623, -3892], [-205, -10910, -4025], [-140, -11200, -4173], [351, -12055, -4748], [268, -12262, -4910], [2, -12372, -5136], [-230, -12272, -5354], [-349, -12052, -5582], [-432, -11010, -6651], [-490, -9991, -7879], [-281, -8575, -9905], [87, -7399, -11890]), h: [-1, -1] }, // fly 51.2-56.7 s
  { s: 5, g: line([92, -7391, -11903], [202, -7195, -12041], [275, -6780, -12132], [326, -4981, -12196]), h: [-1, -1], cut: 668 }, // ride 56.7-57.7 s (climb to the launch cut off)
  { s: 5, g: line([312, -3967, -11917], [285, -3259, -11304], [168, -1348, -11425], [11, 657, -11808], [225, 2562, -11764], [96, 3976, -11875], [-554, 5507, -11151], [-678, 6701, -10815], [-497, 7492, -10685], [-286, 7705, -10657], [359, 8123, -10635], [586, 8566, -10661], [522, 9525, -10800], [260, 10820, -11179], [198, 11952, -11680], [76, 13051, -12320], [-43, 14100, -12264]), h: [-1, -1] }, // fly 57.7-64.3 s
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
    cp('Bottom', [{ min: [-4400, -7000, -12400], max: [4400, -6700, -11600] }]), // the landing ramp after the drop
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
