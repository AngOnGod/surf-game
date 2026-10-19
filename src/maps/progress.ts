import type { Box, MapDef, Spawn } from '../game';
import type { Vec } from '../physics';

// surf_progress (Xtra and Sam, 2019; CS:S, BSP v20) imported from public/maps/ as a gzipped copy of the original file
// (unpacked as it loads: byte for byte the map, which is over the host's 100 MB file limit), shipped unmodified under its
// CC BY-NC-ND 4.0 licence with credit (CREDITS.md). A tutorial map: a hub with a portal to each of four parts, each
// part a few sections (a fall teleports you back to the section's start). The parts chain: each ends in a portal to the
// next, and the last one ends back at the hub. Zones are the map's own trigger volumes (start_p1-p4, endzone), grown by
// the player's box, as a trigger fires on touch; a part ends where the next one starts. Part 3 ends with a choice: three
// pads tag you (a, b or c) and send you on into its last section, which has three exits; an exit takes you on to part 4
// only once you hold the other two letters, otherwise back to its own pad (so the section is ridden twice, by two
// different exits). The pads' teleport is the map's, enabled for good here (the map switches it on for 0.3 s as you
// step on a pad, after the pad has tagged you).
const hull = (b: Box): Box => ({ min: [b.min[0] - 16, b.min[1] - 16, b.min[2] - 72], max: [b.max[0] + 16, b.max[1] + 16, b.max[2]] });
const same = (a: Vec, b: Vec) => a.every((v, k) => Math.abs(v - b[k]) < 1);

const map: MapDef = {
  id: 'progress',
  name: 'surf_progress',
  blurb: 'A tutorial in four parts from a hub, each a few short sections; the parts chain into one run.',
  credit: { by: 'Xtra (DizzyHam) and Sam', source: 'https://gamebanana.com/mods/137868', license: ['CC BY-NC-ND 4.0', 'https://creativecommons.org/licenses/by-nc-nd/4.0/'] },
  order: 0,
  difficulty: { tier: 2, run: 60, sections: 13 }, // falls: back to the section's start
  spawn: { pos: [0, 0, 0], yaw: 90 },
  brushes: [],
  bsp: {
    url: 'maps/surf_progress_fix.bsp.gz',
    textured: /\/signs\//, // its signs show their arrows and titles (in their textures)
    apply: b => {
      const zone = (name: string): Box => { const t = b.triggers.find(t => t.e.targetname === name)!; return hull({ min: t.min, max: t.max }); };
      const dest = (name: string): Spawn => { const e = b.entities.find(e => e.classname === 'info_teleport_destination' && e.targetname === name)!; return { pos: e.origin.split(' ').map(Number) as Vec, yaw: +e.angles.split(' ')[1] }; };
      const starts = [1, 2, 3, 4].map(i => zone(`start_p${i}`)), spawns = [1, 2, 3, 4].map(i => dest(`tp_p${i}`));
      const pads: Box = { min: [10120, -14712, -11968], max: [10360, -14664, -11960] }; // trigger_p3s5 (starts disabled; see above)
      // falls: back to a section's start (tp_pNsM, part 4's tp_p4b) or, off the hub, to the hub; the rest move you on
      const back = b.entities.filter(e => e.classname === 'info_teleport_destination' && /^tp_p\ds\d$|^tp_p4b$/i.test(e.targetname ?? '')).map(e => dest(e.targetname).pos), hub = dest('tp_hub').pos;
      const fall = (f: Box & { to?: Spawn }) => !f.to || back.some(p => same(p, f.to!.pos)) || (same(f.to.pos, hub) && f.max[0] - f.min[0] > 1000);
      return {
        brushes: b.brushes, pushes: b.pushes, namers: b.namers, spawn: b.spawn,
        fails: [...b.fails.map(f => (fall(f) ? f : { ...f, quiet: true })), { ...pads, to: dest('tp_p3s5'), keep: true, quiet: true }],
        stages: starts.map((start, i) => ({ name: `Part ${i + 1}`, start, spawn: spawns[i], end: starts[i + 1] ?? zone('endzone') })),
      };
    },
  },
};
export default map;
