import type { MapDef } from '../game';

// surf_aircontrol_v3 (CS:S, BSP v19, 2005): the original surf_aircontrol by David Hocking (SnooP), shipped unmodified
// under its CC BY-NC-ND 4.0 licence (GameBanana; the author's readme also lets it be shared, with credit). KSF's later
// build (aircontrol.ts) reworked most of the course past the first leg, so that map's autopilot line stops fitting at the
// pyramid: this one has no line yet (a recorded run would give it one). The original has no timer volumes; its start and
// end rooms are the ones KSF's start and end triggers fill, so the zones are those boxes. Falls (lethal trigger_hurts)
// send you back to the start; so does its one teleport (out of a secret room to above the end room: it would skip the run).
const map: MapDef = {
  id: 'aircontrol_v3',
  name: 'surf_aircontrol_v3',
  blurb: 'The original aircontrol (2005): one long linear run down the map; falls restart it. No autopilot yet.',
  credit: { by: 'David Hocking (SnooP)', source: 'https://gamebanana.com/mods/121601', license: ['CC BY-NC-ND 4.0', 'https://creativecommons.org/licenses/by-nc-nd/4.0/'] },
  order: 0,
  difficulty: { tier: 1, run: 36, sections: 1 }, // as KSF's build (the same rooms and drop); not measured on this one
  spawn: { pos: [0, 0, 0], yaw: 90 },
  brushes: [],
  start: { min: [-2912, -10144, 14336], max: [-800, -9248, 14592] },
  end: { min: [9280, 512, -14400], max: [14912, 4464, -13696] },
  bsp: {
    url: 'maps/surf_AirControl_v3.bsp',
    sha256: '59b448537aabd29f3f3cbf0bcc41a02581c4cd7ac62906e8c40c597e75121e54',
    lift: 0.5, // unlit (Source draws it fullbright, texture detail and all) and built of dark metal: as flat colours its ramps read as black
    apply: b => ({ brushes: b.brushes, pushes: b.pushes, fails: b.fails.map(({ to, keep, ...f }) => f), spawn: { pos: b.spawn.pos, yaw: 90 } }),
  },
};
export default map;
