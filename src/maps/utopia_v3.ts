import { type Box, type MapDef, line } from '../game';
import type { Vec } from '../physics';
import { cos, sin } from '../fmath';

// The real surf_utopia_v3 (Panzerhandschuh, 2010; TF2 original, BSP v20) imported from public/maps/, shipped unmodified
// under its CC BY-NC-ND 4.0 licence with credit (CREDITS.md). The map is mirror-symmetric (one route per TF2 team), so
// checkpoints cover both sides. TF2 sends fallers to a jail; those teleports are remapped to "back to the start"
// (the checkpoints are timing splits). Timer zones and checkpoints aren't in the map file, so they're placed here by hand.
const both = (min: Vec, max: Vec): Box[] => [{ min, max }, { min: [min[0], -max[1], min[2]], max: [max[0], -min[1], max[2]] }];
const cp = (name: string, [a, b]: Box[]) => ({ name, ...a, also: [b] }); // timing splits (falls restart the map)
// guides: line() keys (src/game.ts), or an arc around c every 6°
const arc = (c: [number, number], r: number, a0: number, a1: number, z0: number, z1: number): Vec[] => {
  const n = Math.max(2, Math.round(Math.abs(a1 - a0) / 6));
  return [...Array(n + 1).keys()].map(j => { const t = j / n, a = ((a0 + (a1 - a0) * t) * Math.PI) / 180; return [c[0] + r * cos(a), c[1] + r * sin(a), z0 + (z1 - z0) * t]; });
};
/** Autopilot line (+y side): stations of guide points, each with a riding height ramping h0 -> h1 (0 = a face's
 *  bottom edge, 1 = its top; -1 = keep the point as an in-air waypoint). Heights tuned by search so the line holds
 *  from either tick parity (see test/). Tuned up to the booster; past it the stations are the player's own line. */
export const STATIONS: { g: Vec[]; h: [number, number]; aim?: number; dive?: number[] }[] = [
  { g: [[-13700, 200, 13060]], h: [-1, -1] }, // strafe off the spawn's centre line: dropping straight down lands on the ridge's flat top
  { g: line([-13350, 220, 11780], [-12033, 190, 10591], [-10767, 170, 9993], [-9450, 150, 9750]), h: [0.62, 0.8] },
  { g: line([-7100, 330, 9210], [-5800, 250, 9380], [-4500, 150, 9500]), h: [0.5, 0.78] },
  { g: line([-3850, 100, 9700], [-3200, 80, 9950]), h: [0.88, 0.92] }, // kicker: launch high over the gap's kill box
  { g: line([1150, 120, 9950], [1800, 170, 9640], [2450, 190, 9456], [5050, 200, 9383]), h: [0.88, 0.7] },
  { g: line([7600, 150, 8700], [9600, 100, 8340]), h: [0.9, 0.95] }, // the pyramid sinks into a kill slab: stay near its top
  { g: line([10445, 150, 7975], [11148, 220, 7801], [11824, 429, 7584], [12954, 1080, 7432], [13750, 2403, 7418], [13941, 3084, 7585]), h: [0.62, 0.6486554492699327] }, // the split
  { g: line([13634, 5100, 7480], [13634, 8400, 6607]), h: [0.5974230054070913, 0.7347555686488269] },
  { g: line([14292, 10458, 6148], [14306, 11749, 6143], [14186, 13179, 6083], [13838, 13782, 5945], [13379, 14308, 5851], [12829, 14735, 5813], [12206, 15047, 5836], [11534, 15234, 5915]), h: [0.7111269191269536, 0.6016199877814711] },
  { g: line([10100, 14530, 5588], [3700, 14530, 4632]), h: [0.48656551206776166, 0.757943270150452] }, // the valley
  { g: arc([807, 12932], 2640, 90, 180, 4413, 4222), h: [0.3937414338266677, 0.6564970975925191] },
  { g: line([-1900, 13000, 4400], [-1900, 12550, 4450]), h: [0.6744136967662305, 0.97] }, // ride high: the next ridge is 3900 units away
  { g: line([-1794, 8450, 3569], [-1794, 6650, 2914], [-1794, 5450, 2657]), h: [0.7558408892330181, 0.43905820228308384] },
  { g: line([-1541, 2877, 2622], [-1597, 2311, 2643], [-1762, 1767, 2662], [-2030, 1266, 2686], [-2567, 1003, 2402], [-3427, 429, 2442], [-4441, 227, 2464]), h: [0.6849238703579351, 0.5545347302784085] },
  { g: line([-10300, 190, 2087], [-13000, 190, 2176]), h: [0.7902659314341096, 0.7646567404437636] },
  { g: line([-15112, 4500, 2250], [-15112, 9800, 640]), h: [0.4566213297107495, 0.575258825748318] }, // the loop: in the tunnel, west face (the air turn ends there)
  { g: arc([-12425, 12578], 2850, 180, 0, 690, 700), h: [0.6378838831069753, 0.6692735620934023] },
  { g: line([-9826, 7500, 212], [-9826, 5700, -373]), h: [0.6030648854864809, 0.62] },
  { g: arc([-7603, 2918], 2850, 180, 270, -710, -665), h: [0.62, 0.62] },
  { g: line([-2200, 190, -2043], [-100, 190, -2361], [1500, 250, -2250]), h: [0.62, 0.55] }, // booster
  // past it: the line of the player's recorded run (test/runs/utopia_v3@128.json, keys from scratch/demoguide.test.ts),
  // every key an exact point: off the booster ridge's upturned end, a 270° air loop over the corridor (open air up to
  // z 560 there) onto the bowl's east face heading south, round the bowl, a launch east and a 180° air turn onto the
  // lower ridge's south face, west down it, over the hall onto the low ridge and into the END room
  { g: line([1615, 337, -2458], [2407, 311, -2223], [3176, 246, -1761]), h: [-1, -1] }, // ride 47.8-48.3 s
  { g: line([3196, 244, -1746], [3626, 139, -1427], [4003, -53, -1145], [4923, -710, -498], [5514, -1058, -180], [6196, -1307, 96], [6880, -1360, 298], [7517, -1276, 436], [8162, -869, 536], [8393, -218, 565], [8380, 355, 544], [8280, 634, 517], [8059, 913, 471], [7347, 1563, 263], [6886, 1680, 112], [6214, 1620, -160], [5871, 1467, -338], [5399, 1128, -652], [4924, 682, -1064], [4728, 83, -1521], [4798, -508, -2002]), h: [-1, -1] }, // fly 48.3-53.2 s
  { g: line([4804, -526, -2017], [5272, -1894, -2541]), h: [-1, -1] }, // ride 53.2-53.7 s
  { g: line([5282, -1914, -2547], [5649, -2493, -2724]), h: [-1, -1] }, // fly 53.7-54.0 s
  { g: line([5664, -2510, -2729], [6364, -3121, -2871], [7015, -3425, -2871], [7783, -3576, -2759], [8712, -3937, -2308]), h: [-1, -1] }, // ride 54.0-55.2 s
  { g: line([8728, -3945, -2298], [10107, -4612, -1643], [11047, -4840, -1416], [11381, -4788, -1426], [11637, -4630, -1450], [12370, -3770, -1668], [12526, -3399, -1794], [12598, -2878, -1999], [12647, -1790, -2560], [12582, -1305, -2876], [12430, -971, -3137], [12145, -667, -3462], [11830, -485, -3770], [11365, -348, -4213]), h: [-1, -1] }, // fly 55.2-58.9 s
  { g: line([11346, -352, -4224], [11122, -406, -4348], [10567, -420, -4500], [6632, -432, -5434], [6064, -452, -5503], [5079, -444, -5493]), h: [-1, -1] }, // ride 59.0-61.2 s
  { g: line([5056, -443, -5492], [3281, -253, -5594], [1453, -157, -6006], [-374, -31, -6732], [-2148, 168, -7739]), h: [-1, -1] }, // fly 61.3-63.7 s
  { g: line([-2171, 175, -7751], [-3235, 320, -7931], [-4741, 376, -8002], [-6124, 340, -7956], [-7415, 326, -7724], [-8600, 320, -7700]), h: [-1, -1] }, // ride 63.7-65.4 s
];
export const routeOf = (st: typeof STATIONS) => st.flatMap(({ g, h }) => g.map((p, i) => [...p, h[0] + ((h[1] - h[0]) * i) / Math.max(1, g.length - 1)]));

const map: MapDef = {
  id: 'utopia_v3',
  name: 'surf_utopia_v3',
  blurb: 'Linear, 3 checkpoints, two mirrored routes.',
  credit: { by: 'Panzerhandschuh (with Kelao, Spoz, Sbrown)', source: 'https://gamebanana.com/mods/72161', license: ['CC BY-NC-ND 4.0', 'https://creativecommons.org/licenses/by-nc-nd/4.0/'] },
  order: 0,
  difficulty: { tier: 1, run: 54, sections: 1 }, // the jail sends you to the start too
  spawn: { pos: [-14272, 0, 13072], yaw: 0 },
  brushes: [],
  start: { min: [-15000, -640, 12990], max: [-13560, 640, 13300] },
  end: { min: [-14330, -2100, -8300], max: [-7400, 2100, -3800] },
  checkpoints: [
    cp('The Split', both([6900, -1600, 7300], [9000, 1600, 9600])),
    cp('Back Corner', both([-2600, 7900, 2900], [-1000, 9200, 4800])),
    cp('The Loop', both([-15400, 3600, 1800], [-13900, 4600, 3400])),
  ],
  route: routeOf(STATIONS) as [number, number, number, number][],
  routeFlags: STATIONS.flatMap(({ g, aim, dive = [] }) => g.map((_, i) => (i === aim ? 1 : 0) | (dive.includes(i) ? 2 : 0))),
  routeOnSurface: true,
  bsp: {
    url: 'maps/surf_utopia_v3.bsp',
    sha256: '47149322ee65e0d4f8a3216cf8eb631ecc84406c0d96b45857228a33b012341e',
    apply: b => ({
      brushes: b.brushes,
      pushes: b.pushes,
      fails: b.fails.map(f => (f.to && f.to.pos[2] < -9000 ? { ...f, to: map.spawn } : f)), // jail -> back to the start, like the original
    }),
  },
};
export default map;
