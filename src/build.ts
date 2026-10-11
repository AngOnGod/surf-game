// Path-based course builder: sweeps convex cross-sections along a centreline of straights and arcs (with drops),
// one convex brush per segment and section, mitred at the joints so faces meet without seams or steps.
import type { Box, BrushDef, Spawn } from './game';
import { type Vec, DEG, cross, dot, hullPlanes, norm, scale, sub } from './physics';
import { cos, sin } from './fmath';

export type Kind = 'ridge' | 'valley' | 'left' | 'right' | 'gap';
export interface Piece {
  kind: Kind;
  len?: number; // straight length
  turn?: number; r?: number; // arc: degrees (+ = left) and centreline radius
  drop?: number; // centreline height lost over the piece (negative rises: a kicker)
  w?: number; h?: number; // face run (horizontal) and height: the slope is atan(h / w)
  gapW?: number; // valley: width of the kill channel between its two faces
  side?: 1 | -1; // face the autopilot line rides (+1 = left of travel)
  ride?: number; // autopilot riding height on that face (0 bottom .. 1 top)
  color?: number;
  gate?: { at: number; u: number; v: number; ww: number; wh: number }; // wall across the canyon with a window at (u, v)
}
export interface Built { brushes: BrushDef[]; fails: (Box & { shape: [number, number, number, number][][] })[]; route: number[][]; end: Vec; heading: number }

const WALL = [0x8d8378, 0x9c3a2c, 0x8d8378, 0x4f6b78, 0x9c3a2c, 0x8d8378]; // utopia-ish stripes, bottom to top
const STRIPE = [0.42, 0.06, 0.1, 0.14, 0.06, 1]; // band heights as fractions of the wall

interface Frame { p: Vec; heading: number }

/** Lay pieces from `start` (centreline point at the bottom of the cross-section, heading in degrees). */
export function canyon(pieces: Piece[], start: Vec, heading: number, opt: { wall?: number; color?: number; smooth?: number } = {}): Built {
  const smooth = opt.smooth ?? 2400;
  const brushes: BrushDef[] = [], fails: Built['fails'] = [], route: number[][] = [];
  const half = opt.wall ?? 900; // canyon half-width to the walls
  // centreline frames of every piece (linear drops), each with its arc length s
  let pos = start, hd = heading, s0 = 0;
  const all = pieces.map(pc => {
    const frames: (Frame & { s: number })[] = [{ p: [...pos], heading: hd, s: s0 }];
    const arcLen = pc.turn ? (Math.abs(pc.turn) * DEG * (pc.r ?? 3000)) : pc.len ?? 1000;
    const drop = pc.drop ?? arcLen * Math.tan(4 * DEG), kicker = drop < 0;
    const n = kicker ? 1 : Math.max(1, pc.turn ? Math.ceil(Math.abs(pc.turn) / 7.5) : Math.ceil(arcLen / 256)); // a rising seam can rampbug: one brush
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      if (pc.turn) {
        const r = pc.r ?? 3000, sgn = Math.sign(pc.turn), h0 = hd * DEG, a = pc.turn * t * DEG;
        const cx = pos[0] - sin(h0) * r * sgn, cy = pos[1] + cos(h0) * r * sgn; // centre is to the left for left turns
        const ang = h0 - (Math.PI / 2) * sgn + a;
        frames.push({ p: [cx + r * cos(ang), cy + r * sin(ang), pos[2] - drop * t], heading: hd + pc.turn * t, s: s0 + arcLen * t });
      } else frames.push({ p: [pos[0] + cos(hd * DEG) * arcLen * t, pos[1] + sin(hd * DEG) * arcLen * t, pos[2] - drop * t], heading: hd, s: s0 + arcLen * t });
    }
    pos = frames.at(-1)!.p; hd = frames.at(-1)!.heading; s0 += arcLen;
    return frames;
  });
  // round off slope changes within each downhill run of ramps (a kink throws you off the face): average the height
  // profile over a window that shrinks to nothing at the run's ends, so runs still meet the platform, gaps and kickers
  // exactly. A moving average of a downhill profile stays downhill: seams on flat or rising stretches can rampbug
  // (the box touching one segment catches the next one's end cap), seams going downhill are covered by edge bevels.
  const open = (pc: Piece) => pc.kind === 'gap' || (pc.drop ?? 0) < 0;
  for (let i = 0; i < pieces.length; ) {
    let j = i;
    while (j < pieces.length && !open(pieces[j])) j++;
    if (j > i) {
      const run = all.slice(i, j).flat(), a = run[0].s, b = run.at(-1)!.s;
      const zAt = (s: number) => { const k = Math.max(1, run.findIndex(f => f.s >= s)), f0 = run[k - 1], f1 = run[k]; return f0.p[2] + (f1.p[2] - f0.p[2]) * ((s - f0.s) / (f1.s - f0.s || 1)); };
      const z = run.map(f => { const w = Math.min(smooth, 2 * (f.s - a), 2 * (b - f.s)); return [...Array(33).keys()].reduce((sum, k) => sum + zAt(Math.max(a, Math.min(b, f.s + w * (k / 32 - 0.5)))), 0) / 33; });
      run.forEach((f, k) => { f.p[2] = z[k]; });
    }
    i = j + 1;
  }
  const faces = new Map<string, { n: Vec; p: Vec }>(); // ridden face plane of the previous segment, per section key
  for (const [pi, pc] of pieces.entries()) {
    const frames = all[pi];
    const w = pc.w ?? 640, h = pc.h ?? 720, g = pc.gapW ?? 96, col = pc.color ?? opt.color ?? 0x8d8378;
    // cross-section polygons (u: lateral, + = left of travel; v: up from the centreline point)
    // surf sections have a key; their ridden face is the edge poly[0] -> poly[1]. A ridge is two halves, one per face.
    const sections: { poly: [number, number][]; color: number; key?: string }[] = [];
    const wedge = (s: 1 | -1): [number, number][] => [[s * g / 2, 0], [s * (g / 2 + w), h], [s * (g / 2 + w + 48), h], [s * (g / 2 + w + 48), -96], [s * g / 2, -96]];
    if (pc.kind === 'ridge') for (const s of [1, -1]) sections.push({ poly: [[s * w, 0], [0, h], [0, 0]], color: col, key: `ridge${s}` });
    if (pc.kind === 'valley' || pc.kind === 'left') sections.push({ poly: wedge(1), color: col, key: 'wedge1' });
    if (pc.kind === 'valley' || pc.kind === 'right') sections.push({ poly: wedge(-1), color: col, key: 'wedge-1' });
    for (const k of [...faces.keys()]) if (!sections.some(sc => sc.key === k)) faces.delete(k); // a gap or another kind: no joint
    let v0 = -640; // walls: striped bands from below the floor to well above the faces
    STRIPE.forEach((f, i) => {
      const v1 = i === STRIPE.length - 1 ? h + 1400 : v0 + (h + 2040) * f;
      for (const s of [1, -1]) sections.push({ poly: [[s * half, v0], [s * (half + 64), v0], [s * (half + 64), v1], [s * half, v1]], color: WALL[i] });
      v0 = v1;
    });
    sections.push({ poly: [[-half, -704], [half, -704], [half, -640], [-half, -640]], color: 0x3a3f47 }); // floor
    // joints: mitred lateral axes (bisector of neighbouring headings, stretched to keep widths)
    const joint = (i: number) => {
      const edge = i === 0 || i === frames.length - 1, a = frames[Math.max(0, i - 1)].heading, b = frames[Math.min(frames.length - 1, i + 1)].heading;
      const mid = (edge ? frames[i].heading : (a + b) / 2) * DEG, k = edge ? 1 : 1 / cos(((b - a) / 4) * DEG); // keep widths across the bend
      return (u: number, v: number): Vec => [frames[i].p[0] - sin(mid) * u * k, frames[i].p[1] + cos(mid) * u * k, frames[i].p[2] + v];
    };
    for (let i = 0; i + 1 < frames.length; i++) {
      const A = joint(i), B = joint(i + 1);
      for (const sc of sections) {
        const start = sc.poly.map(([u, v]) => A(u, v)), end = sc.poly.map(([u, v]) => B(u, v));
        if (sc.key) {
          // Rampbug guard. Where the ridden face bends toward the rider (a concave joint), a box sliding along the
          // previous segment can reach this one's start edge before its face and get the start cap or an edge bevel
          // as the hit plane: a dead stop. Lean the start cap back under the previous segment (the face plane stays):
          // the cap and its backward bevels are then buried behind the previous face, only this face can be hit.
          const prev = faces.get(sc.key), [p0, p1, q0] = [start[0], start[1], end[0]];
          if (prev && Math.max(...[end[0], end[1]].map(q => dot(prev.n, sub(q, prev.p)))) > 0.25) {
            const dir = norm(sub(frames[i + 1].p, frames[i].p));
            for (let k = 2; k < start.length; k++) start[k] = sub(start[k], scale(dir, 64));
          }
          let n = norm(cross(sub(p1, p0), sub(q0, p0)));
          if (dot(n, sub(A(...sc.poly[2]), p0)) > 0) n = scale(n, -1); // out of the face
          faces.set(sc.key, { n, p: p0 });
        }
        brushes.push({ type: 'planes', planes: hullPlanes([...start, ...end]).map(p => [...p.n, p.d] as [number, number, number, number]), color: sc.color });
      }
      // kill slab just above the floor, exact shape
      const slab: [number, number][] = [[-half, -640], [half, -640], [half, -560], [-half, -560]], pts = [...slab.map(([u, v]) => A(u, v)), ...slab.map(([u, v]) => B(u, v))];
      fails.push({ min: [0, 1, 2].map(k => Math.min(...pts.map(q => q[k]))) as Vec, max: [0, 1, 2].map(k => Math.max(...pts.map(q => q[k]))) as Vec, shape: [hullPlanes(pts).map(p => [...p.n, p.d] as [number, number, number, number])] });
    }
    // gate: a wall across the canyon with one window
    if (pc.gate) {
      const fi = Math.round(pc.gate.at * (frames.length - 1)), f = frames[fi], { u, v, ww, wh } = pc.gate;
      const at = (du: number, dv: number, dt: number): Vec => [f.p[0] - sin(f.heading * DEG) * du + cos(f.heading * DEG) * dt, f.p[1] + cos(f.heading * DEG) * du + sin(f.heading * DEG) * dt, f.p[2] + dv];
      const rect = (u0: number, u1: number, w0: number, w1: number) => brushes.push({ type: 'planes', color: 0xc8812f, planes: hullPlanes([u0, u1].flatMap(a => [w0, w1].flatMap(b => [-24, 24].map(c => at(a, b, c))))).map(p => [...p.n, p.d] as [number, number, number, number]) });
      rect(-half, u - ww / 2, -640, h + 1400); rect(u + ww / 2, half, -640, h + 1400); rect(u - ww / 2, u + ww / 2, v + wh, h + 1400); rect(u - ww / 2, u + ww / 2, -640, v);
    }
    // autopilot guides: middle of the ridden face
    if (pc.kind !== 'gap') {
      const s = pc.side ?? (pc.kind === 'right' ? -1 : 1), fu = pc.kind === 'ridge' ? s * w / 2 : s * (g / 2 + w / 2);
      for (let i = pi > 0 && pieces[pi - 1].kind !== 'gap' ? 1 : 0; i < frames.length; i++) route.push([...joint(i)(fu, h / 2), pc.ride ?? 0.62, pi]); // a joint once
    }
  }
  return { brushes, fails, route, end: pos, heading: hd };
}

/** A start platform (with its zone) whose front edge drops straight onto the first piece. */
export function platform(at: Vec, heading: number, size = 768): { brush: BrushDef; spawn: Spawn; zone: Box } {
  const c: Vec = [at[0] - cos(heading * DEG) * size / 2, at[1] - sin(heading * DEG) * size / 2, at[2]];
  const pts = [-1, 1].flatMap(a => [-1, 1].flatMap(b => [-64, 0].map(z => [c[0] + a * size / 2, c[1] + b * size / 2, c[2] + z] as Vec)));
  return {
    brush: { type: 'planes', color: 0x9aa3ad, planes: hullPlanes(pts).map(p => [...p.n, p.d] as [number, number, number, number]) },
    spawn: { pos: [c[0] - cos(heading * DEG) * size / 4, c[1] - sin(heading * DEG) * size / 4, c[2] + 1], yaw: heading },
    zone: { min: [c[0] - size / 2, c[1] - size / 2, c[2]], max: [c[0] + size / 2, c[1] + size / 2, c[2] + 160] },
  };
}
