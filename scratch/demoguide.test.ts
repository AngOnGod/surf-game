// Guide points from a recorded run (DEMO=file; FROM=seconds to start at, TOL=units; PTS=1 for explicit points instead
// of line() keys): the line the player took, simplified (Douglas-Peucker; keys forced where a ride becomes a flight or
// back), as map stations to paste into src/maps: one station per ride or flight (s: the section or stage it is in),
// every key an exact point (h -1). The route bot and the planner then learn the line by finding their own inputs along
// it. Writes DEMO.guide.txt.
import { it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { type MapDef, Session } from '../src/game';
import { DEFAULTS, HULL_MIN, HULL_STAND, type Vec, trace } from '../src/physics';
import { resolveMap } from '../src/bsp';
import { type Demo, replayDemo } from '../src/plan';

const maps = Object.values(import.meta.glob<{ default: MapDef }>('../src/maps/*.ts', { eager: true })).map(m => m.default);
const read = async (u: string) => { const b = readFileSync('public/' + u); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };
const dist = (p: Vec, a: Vec, b: Vec) => { // point to segment ab
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1] + (p[2] - a[2]) * ab[2]) / l2));
  return Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t, p[2] - a[2] - ab[2] * t);
};
const simplify = (pts: Vec[], tol: number): Vec[] => {
  if (pts.length < 3) return pts;
  let k = 0, worst = 0;
  for (let i = 1; i + 1 < pts.length; i++) { const d = dist(pts[i], pts[0], pts.at(-1)!); if (d > worst) { worst = d; k = i; } }
  return worst > tol ? [...simplify(pts.slice(0, k + 1), tol).slice(0, -1), ...simplify(pts.slice(k), tol)] : [pts[0], pts.at(-1)!];
};

it('guide from a recording', async () => {
  const path = process.env.DEMO!, d = JSON.parse(readFileSync(path, 'utf8')) as Demo & { map: string; tickrate: number; settings: object };
  const from = +(process.env.FROM ?? 0), tol = +(process.env.TOL ?? 48);
  const def = await resolveMap(maps.find(m => m.id === d.map)!, read), s = new Session(def, { ...DEFAULTS, ...d.settings, tickrate: d.tickrate }), bot = replayDemo(d.ticks);
  s.restore(d.snap);
  const pts: { o: Vec; ride: boolean; t: number; s: number }[] = [];
  for (let i = 0; i < d.ticks.length && s.run.state !== 'done'; i++) {
    s.step(bot(s.p)); s.events.length = 0;
    const p = s.p, n = p.lastNormal, t = (i + 1) / d.tickrate;
    if (t >= from) pts.push({ o: [...p.origin], ride: p.onGround || (p.tick - p.touchTick <= 1 && n[2] > 0 && n[2] < 0.7), t, s: s.section });
  }
  // phases: runs of riding / flying; one shorter than 0.3 s (a touch in the air, a few ticks off a face) is folded into the one before it
  const ph = pts.map(p => p.ride), MIN = Math.round(0.3 * d.tickrate);
  for (let again = true; again;) {
    again = false;
    for (let i = 0; i < ph.length;) {
      let j = i; while (j < ph.length && ph[j] === ph[i]) j++;
      if (i > 0 && j < ph.length && j - i < MIN) { ph.fill(ph[i - 1], i, j); again = true; }
      i = j;
    }
  }
  const out: string[] = [], world = def.world!, sections = !!(def.checkpoints || def.stages);
  const nearFace = (o: Vec) => { const t = trace(world, [o[0], o[1], o[2] + 64], [o[0], o[1], o[2] - 256], HULL_MIN, HULL_STAND); return t.fraction < 1 && t.normal[2] > 0 && t.normal[2] < 0.7; };
  for (let i = 0; i < pts.length;) {
    let j = i; while (j < pts.length && ph[j] === ph[i]) j++;
    let seg = pts.slice(i, j).map(p => p.o), cut = 0;
    if (!ph[i]) { while (seg.length > 2 && nearFace(seg[0])) seg.shift(); } // a flight: starts where it is clear of the face (the route bot climbs to a target with no face under it)
    else if (j < pts.length) { // a ride before a flight: the climb to the launch (z rising at the end) is the route bot's cut
      let k = seg.length - 1; while (k > 0 && seg[k - 1][2] <= seg[k][2]) k--;
      for (let q = k; q + 1 < seg.length; q++) cut += Math.hypot(seg[q + 1][0] - seg[q][0], seg[q + 1][1] - seg[q][1]);
      if (cut > 0) seg = seg.slice(0, k + 1);
    }
    const keys = simplify(seg, tol);
    // PTS=1: explicit points every ~350 units; otherwise keys for the line() helper
    const g = process.env.PTS
      ? keys.slice(1).flatMap((b, k) => { const a = keys[k], n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / 350)); return [...Array(n).keys()].map(q => a.map((v, c) => v + ((b[c] - v) * q) / n)); }).concat([keys.at(-1)!])
      : keys;
    const txt = g.map(k => `[${k.map(v => Math.round(v)).join(', ')}]`).join(', ');
    if (keys.length >= 2) out.push(`  { ${sections ? `s: ${pts[i].s}, ` : ''}g: ${process.env.PTS ? `[${txt}]` : `line(${txt})`}, h: [-1, -1]${cut > 0 ? `, cut: ${Math.round(cut)}` : ''} }, // ${ph[i] ? 'ride' : 'fly'} ${pts[i].t.toFixed(1)}-${pts[j - 1].t.toFixed(1)} s${cut > 0 ? ' (climb to the launch cut off)' : ''}`);
    i = j;
  }
  writeFileSync(path + '.guide.txt', out.join('\n') + '\n');
  console.log(`${pts.length} ticks from ${from} s -> ${out.length} stations, ${out.join('').split('[').length - 1} keys\n` + out.join('\n'));
}, 600_000);
