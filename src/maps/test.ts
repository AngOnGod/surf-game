import { type MapDef, box, ramp, zone } from '../game';

// Flat ground, one floating 60° two-sided ramp (normal.z = 0.5: surf) and one 45° wedge (normal.z = 0.707: walkable).
// Walk up the wedge and run off its top edge onto the ramp's +Y face.
export const RAMP60 = { x0: 64, x1: 2112, y: -128, base: 64, width: 512, height: 256 * Math.tan(Math.PI / 3) };
export const WEDGE45 = { x0: -640, x1: 0, width: 640, height: 640 };

const map: MapDef = {
  id: 'test',
  name: 'Test Range',
  blurb: 'Flat ground, a 60° ramp and a 45° wedge. Used by the tests.',
  order: 3,
  spawn: { pos: [-1400, 0, 1], yaw: 0 },
  brushes: [
    box([0, 0, -64], [6144, 4096, 64], { color: 0x6b7280 }),
    ramp([(WEDGE45.x0 + WEDGE45.x1) / 2, 0, 0], { length: 512, width: WEDGE45.width, height: WEDGE45.height, sides: 'left', yaw: 90, color: 0xc9a227 }),
    ramp([(RAMP60.x0 + RAMP60.x1) / 2, RAMP60.y, RAMP60.base], { length: RAMP60.x1 - RAMP60.x0, width: RAMP60.width, height: RAMP60.height, color: 0x3b82f6 }),
  ],
  start: zone([-1400, 0, 0], [256, 256, 128]),
  end: zone([2600, 0, 0], [256, 1024, 256]),
};
export default map;
