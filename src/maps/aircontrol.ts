import { type Box, type MapDef, type Station, routeOf } from '../game';

// surf_aircontrol_ksf (CS:GO workshop build, BSP v21) imported from public/bsp/. It comes with no licence to share it, so
// the .bsp is gitignored and never shipped: players load their own copy (bsp.own). One long linear course in twelve legs that spiral down the map, five checkpoints.
// Unlike most maps it carries its own timer volumes (start_trigger, cp1-5_trigger, end_trigger: the hooks a server's
// timer plugin reads), so the zones are the map's own. Every fall teleports back to the start room, as on a server.
// The bonus (an air-control course with alternating pushes) has no way in from the main map (servers teleport you
// there with a command), so it isn't wired up. The finish: through a pipe whose floor is a kill strip, out of a round
// hole into the end room (whose floor teleports you back to the start once the timer has stopped).
/** Autopilot line (see Station): s = the section (0 = start to cp1, ..., 5 = cp5 to the end). Riding heights and the
 *  in-air points were tuned by search, section by section (scratch/acopt). Verified start to finish at 128 tick from
 *  either tick parity (test/); at 64 tick it passes the first checkpoint, then comes off leg 2 too wide to land on
 *  leg 3's first ramp (half the air-strafe authority per second), so 64 tick is unverified past there. */
export const STATIONS: Station[] = [
  { s: 0, g: [[-1500, -9150, 14300]], h: [-1, -1] }, // walk off the start room's front edge
  { s: 0, g: [[-1502, -9172, 14143], [-1470, -8660, 14098], [-1438, -8148, 14052], [-1438, -7636, 13970], [-1438, -7508, 13949]], h: [0.7, 0.92] },
  { s: 0, g: [[-1326, -7124, 13781], [-1318, -6612, 13551], [-1310, -6484, 13500]], h: [0.7, 0.92] },
  { s: 0, g: [[-1278, -6100, 13351], [-1310, -5588, 13279], [-1334, -5076, 13314], [-1358, -4948, 13354]], h: [0.25581376353473323, 0.7402651158397504] },
  { s: 0, g: [[-1750, -4650, 13445]], h: [-1, -1] }, // onto the centre ramp from above (its front end is a wall)
  { s: 0, g: [[-1790, -4308, 13087], [-1790, -3796, 13023], [-1790, -3284, 12960], [-1790, -3028, 12928]], h: [0.5694455526703492, 0.6336945714595428] },
  { s: 0, g: [[-1726, -2772, 12838], [-1582, -2260, 12667], [-1518, -1748, 12550], [-1486, -1236, 12450], [-1486, -1108, 12419]], h: [0.8101307684004577, 0.97] },
  { s: 0, g: [[-1430, -724, 12371], [-1550, -212, 12311]], h: [0.8762174708774144, 0.2799007668815724] },
  { s: 0, g: [[-2038, 172, 11900], [-2078, 684, 12398], [-2200, 1150, 12500]], h: [0.8771743268907349, 0.3954563075346649] }, // the pyramid: off its north end, west
  { s: 0, g: [[-2980, 1011, 12374]], h: [-1, -1] }, // over the gap onto the next leg's first ramp (its east end is a wall)
  { s: 1, g: [[-3128, 1296, 12362], [-3640, 1280, 12272], [-4152, 1280, 12200], [-4664, 1264, 12110], [-5176, 1248, 12020], [-5688, 1240, 11936], [-6072, 1232, 11875]], h: [0.03, 0.6055141075975465] },
  { s: 1, g: [[-6600, 232, 11740], [-7000, 232, 11650], [-7400, 232, 11580]], h: [0.6357138637310129, 0.22209930345657752] }, // across the valley: its south face
  { s: 1, g: [[-8000, 1008, 11030], [-8632, 1008, 10912]], h: [0.1588879491198426, 0.21537185854242127] },
  { s: 1, g: [[-10168, 1136, 10430], [-10680, 1184, 10406], [-11192, 1216, 10360], [-11704, 1264, 10335]], h: [0.1244331392226092, 0.33692569042381565] },
  { s: 1, g: [[-11900, 1350, 10300], [-12526, 1648, 10373]], h: [-1, -1], tune: true }, // turn north in the air
  { s: 1, g: [[-12814, 2284, 10001], [-12990, 2796, 9914], [-13150, 3308, 9801], [-13278, 3692, 9729]], h: [0.32242479679573316, 0.9686257633264806] },
  { s: 1, g: [[-13398, 5100, 9591], [-13430, 5612, 9198], [-13286, 6124, 9101], [-13382, 6636, 8583]], h: [0.3109537048542298, 0.37436545413770506] },
  { s: 2, g: [[-12319, 7883, 8171], [-12142, 8229, 8358], [-11849, 8490, 8273], [-11568, 8760, 8217], [-11288, 9031, 8160]], h: [0.97, 0.9148476713641669] }, // corner: turn east
  { s: 2, g: [[-10075, 9649, 7935]], h: [-1, -1], tune: true },
  { s: 2, g: [[-9664, 10130, 7729], [-8640, 10082, 7625], [-7616, 10034, 7519], [-6592, 9986, 7414], [-5568, 9938, 7309], [-4544, 9890, 7204], [-3900, 9860, 7140]], h: [0.6974191375160925, 0.8315636884358548] },
  { s: 2, g: [[-3026, 10063, 6996]], h: [-1, -1], tune: true }, // over the gap in the north ramps
  { s: 2, g: [[-1984, 10218, 6785], [-960, 10114, 6668], [64, 10002, 6543], [1088, 9890, 6418], [2112, 9778, 6292]], h: [0.6, 0.7612870911947167] },
  { s: 2, g: [[2851, 9734, 6189], [3450, 9253, 5992], [4054, 8778, 5789], [4569, 8346, 5566]], h: [0.5251662928853102, 0.6618673715469423] }, // corner: turn south
  { s: 2, g: [[5500, 7200, 5400]], h: [-1, -1], tune: true }, // the long air gap
  { s: 2, g: [[6680, 5824, 4691], [6424, 5312, 4340], [6328, 4800, 4189], [6200, 4288, 3999], [6096, 3776, 3838], [6024, 3264, 3718], [5848, 3008, 3481]], h: [0.060599332567423767, 0.7552554592010515] },
  { s: 2, g: [[5659, 1479, 2900]], h: [-1, -1], tune: true }, // into the tunnel mouth
  { s: 3, g: [[5998, 588, 3154], [5950, -436, 3067], [5902, -1460, 2981], [5854, -2484, 2895]], h: [0.6598254560778131, 0.9037070234618662] }, // the tunnel
  { s: 3, g: [[5974, -2868, 2853], [5926, -3892, 2747], [5878, -4916, 2639], [5790, -5940, 2489], [5718, -6452, 2480]], h: [0.7800515698431704, 0.6513115028311968] },
  { s: 3, g: [[5400, -8027, 2300]], h: [-1, -1], tune: true }, // out of the tunnel, down into the room
  { s: 3, g: [[5273, -8657, 1966], [4964, -8886, 2044], [4595, -9040, 2002], [4216, -9181, 1940], [3847, -9336, 1897]], h: [0.5930551537218479, 0.344913852417747] }, // corner: turn west
  { s: 3, g: [[3040, -9504, 1782], [2272, -9496, 1754], [1504, -9496, 1735], [736, -9408, 1614]], h: [0.22037279960937553, 0.6099058426176823] },
  { s: 3, g: [[-791, -9445, 1300]], h: [-1, -1], tune: true },
  { s: 3, g: [[-2336, -9408, 714], [-3104, -9376, 448], [-3872, -9352, 190], [-4640, -9312, -87], [-5408, -9248, -391]], h: [0.2966640396553401, 0.4314501921625675] },
  { s: 3, g: [[-6757, -9338, -1141]], h: [-1, -1], tune: true },
  { s: 3, g: [[-7520, -9320, -1407], [-8288, -9304, -1495], [-9056, -9288, -1584]], h: [0.5180791471557908, 0.9026844034326931] },
  { s: 4, g: [[-11165, -7574, -1709]], h: [-1, -1], tune: true }, // north-west across the open room
  { s: 4, g: [[-12972, -6820, -2793], [-12988, -6308, -2811], [-13012, -5796, -2839], [-13028, -5284, -2857], [-13052, -4772, -2885]], h: [0.17522335009812712, 0.7330910292617362] },
  { s: 4, g: [[-12913, -3884, -2676]], h: [-1, -1], tune: true },
  { s: 4, g: [[-12964, -2596, -3168], [-12980, -2084, -3186], [-13004, -1572, -3214], [-13020, -1188, -3232]], h: [0.7580287135217869, 0.7252496745863353] },
  { s: 4, g: [[-13101, -323, -3398]], h: [-1, -1], tune: true },
  { s: 4, g: [[-13092, 604, -3565], [-13076, 1116, -3587], [-13060, 1628, -3610], [-13044, 2140, -3633], [-13028, 2652, -3656], [-13012, 3036, -3679]], h: [0.3443760407041785, 0.6356477382965631] },
  { s: 4, g: [[-12840, 4123, -3123]], h: [-1, -1], tune: true },
  { s: 4, g: [[-12652, 4316, -3567], [-12644, 4828, -3647], [-12644, 5340, -3742], [-12644, 5852, -3837], [-12644, 6364, -3933], [-12644, 6876, -4028]], h: [0.18436527985152168, 0.97] },
  { s: 4, g: [[-12425, 7845, -4317]], h: [-1, -1], tune: true },
  { s: 4, g: [[-12396, 8284, -4380], [-12284, 8796, -4420], [-12172, 9308, -4460], [-12060, 9820, -4500], [-11956, 10332, -4551], [-11852, 10844, -4601], [-11740, 11356, -4641]], h: [0.6566599350623961, 0.97] },
  { s: 4, g: [[-12800, 12600, -4850], [-12500, 12850, -4900], [-12252, 13020, -4934]], h: [0.97, 0.7816655601011147] }, // corner (faces south-east): land mid-face, ride it north-east
  { s: 4, g: [[-10150, 12390, -6289]], h: [-1, -1], tune: true }, // through the last checkpoint, a long drop
  { s: 5, g: [[-7616, 12354, -6965], [-6592, 12250, -7083], [-5568, 12138, -7211], [-4544, 12066, -7368], [-3520, 12034, -7558], [-2752, 12002, -7710]], h: [0.7814293283975278, 0.7308127182373743] },
  { s: 5, g: [[-2238, 12250, -7576], [-1213, 12239, -8050], [-188, 12228, -8524], [834, 12305, -9095], [1855, 12406, -9709], [2752, 12406, -10349]], h: [0.3956385387984022, 0.8041687727365222] }, // the long ridge (south face)
  { s: 5, g: [[3312, 12400, -10757], [4336, 12480, -11397], [5360, 12504, -11965], [6384, 12472, -12466], [7408, 12352, -12842]], h: [0.4146593712600759, 0.7082855157709291] },
  { s: 5, g: [[7867, 12281, -12903], [8652, 12125, -12907], [9403, 11906, -12798], [10077, 11537, -12684]], h: [0.099421444672367, 0.45690317453372986] }, // it curves south
  { s: 5, g: [[11433, 9551, -12197]], h: [-1, -1], tune: true }, // across the open room into the middle of the pipe's mouth
  { s: 5, g: [[11210, 7548, -12400], [11210, 6524, -12688], [11210, 5500, -12983]], h: [0.28845651667036915, 0.43712839300412454] }, // inside the pipe (its floor is a kill strip)
  { s: 5, g: [[11831, 4700, -12500], [12100, 3500, -13000]], h: [-1, -1], tune: true }, // out through the round hole at its far end (centred, it is smaller than the pipe)
  { s: 5, g: [[12100, 2500, -13900]], h: [-1, -1] }, // down into the end zone
];

const map: MapDef = {
  id: 'aircontrol',
  name: 'surf_aircontrol_ksf',
  blurb: 'One long linear run, 5 checkpoints; falls restart it. Not hosted here: downloaded from its original upload (8 MB) the first time.',
  credit: { by: 'KSF (Kool Surf Federation)', source: 'https://steamcommunity.com/sharedfiles/filedetails/?id=523349084' },
  order: 0,
  difficulty: { tier: 1, run: 36, sections: 1 },
  spawn: { pos: [0, 0, 0], yaw: 90 },
  brushes: [],
  route: routeOf(STATIONS) as [number, number, number, number][],
  routeOnSurface: true,
  bsp: {
    url: 'bsp/surf_aircontrol_ksf.bsp',
    own: { get: 'https://cdn.steamusercontent.com/ugc/683776078263100640/71D28D0F6B4DB35FB68B70A12484D8DA80326EB3/', sha256: '463b5a80ec15f1ba46d7a46c22ca4758c3855d6e16210b94e53d551f2bbafc03' }, // the workshop upload (a zip)
    apply: b => {
      const zone = (name: string): Box => { const t = b.triggers.find(t => t.e.targetname === name)!; return { min: t.min, max: t.max }; };
      return {
        brushes: b.brushes, pushes: b.pushes, fails: b.fails, spawn: b.spawn,
        start: zone('start_trigger'), end: zone('end_trigger'),
        checkpoints: [1, 2, 3, 4, 5].map(i => ({ name: `Checkpoint ${i}`, ...zone(`cp${i}_trigger`) })),
      };
    },
  },
};
export default map;
