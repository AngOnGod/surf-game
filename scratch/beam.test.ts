// Beam search for a planned run (src/plan.ts): every block, each kept state tries every move with the real game
// session (pushes, teleports, timers); falls are dropped, near-duplicates merged, and the best W by score kept.
// Score: horizontal progress along a guide line + E * mechanical energy (height + speed²/2g) - straying more than R
// sideways off it - A * dropping more than T below it (the riding line keeps the height a gap needs) - A/4 * riding more
// than 3T above it on a ramp. In the air, height over time is ballistic (strafing is horizontal), so a launch is judged
// at once: - A * arriving at the next ramp more than L below its riding line (or U above: overshooting it) (time: distance along the guide over
// horizontal speed). TAIL points are free-space guides: there, straying more than TT above or below or RT sideways
// costs AT (a free path under ceilings and between walls: far off it is somewhere else). DF (scratch/df.test.ts output):
// past the cut, progress is the drop in distance-to-goal through free space instead, and the bands are off.
// Lookahead (past the cut only: the guide's checks cover the rest): the best 2W each block are played on for H seconds,
// steering down the distance field and, failing that, strafing straight on; one that falls both ways ranks below
// every survivor (a crude policy alone flags good lines it can't ride itself). And in the air, the ballistic arc
// (no steering) is traced 1.25 s ahead: its first impact costs C * the energy the hit takes ((v·n)², none for a landing
// along a face), an arc into a kill volume costs a fall; both weighted down with time, as steering can still change them. The beam keeps at most K states per cell of (guide segment, side offset, height off the guide, speed),
// so lines that ride higher or wider survive alongside the greedy ones (cells: 128-unit position bins, speed bins).
// MAP=, TICK=, W=, E=, R= (TAG= names the log/run files, to run two searches of one map at once); guide: the map's route, or cut where TAIL (json points) begins and continued along it.
// CAP=x0,y0,z0,x1,y1,z1,v: inside that box, speed over v costs 2 per u/s (a launch that must not be too fast).
// GATES=x0,y0,z0,x1,y1,z1;...: boxes to pass in order; until the last, the score is energy + G per gate passed - GW *
// the distance to the next gate (tight sections where speed is the whole game); past the last, the usual score. PW: weight of progress against energy (default 1; low values hoard speed through tight sections).
// TTG=1: score progress as time to go instead (remaining distance over speed, times 3000 u/s): speed is worth as
// much as position. Backtracking: when the beam dies out or stalls (no new best for STALL s), it rewinds 3 s per try
// (TRIES) to the beam saved then and searches on with twice the width per try (up to WMAX), back to W once past it.
// SAVE_AT=seconds: write the best state then (and the moves to it) to <tag>.snap.json; START=that file: search on from it.
import { it } from 'vitest';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import type { MapDef } from '../src/game';
import { DEFAULTS, HULL_MIN, HULL_STAND, hullMax, trace, type Vec } from '../src/physics';
import { Session, buildBrush } from '../src/game';
import { resolveMap } from '../src/bsp';
import { BLOCK, BOT, MOVES, encode, move, replay } from '../src/plan';
import { makeBot } from '../src/bot';
import { atan2 } from '../src/fmath';
const mods = import.meta.glob<{ default: MapDef }>('../src/maps/*.ts', { eager: true });
const m = Object.values(mods).map(x => x.default).find(x => x.id === (process.env.MAP ?? 'utopia_v3'))!;
type Snap = { p: Session['p']; run: Session['run']; stage: Session['stage']; section: number; trail: boolean; name: string; inPush: boolean[] };
interface Node { snap: Snap; j: number; v: number; prog: number; cell: string; parent: Node | null; m: number; g: number; bot?: unknown; pure?: boolean }
it('beam', async () => {
  const tick = +(process.env.TICK ?? 128), W = +(process.env.W ?? 100), K = +(process.env.K ?? 2), E = +(process.env.E ?? 0.5), L = +(process.env.L ?? 300), U = +(process.env.U ?? 1500), R = +(process.env.R ?? 1500), tag = process.env.TAG ?? `${m.id}@${tick}`, LOG = `scratch/beam-${tag}.log`;
  const def = await resolveMap(m, async () => { const b = readFileSync(['public/maps/', 'public/bsp/'].map(d => d + m.bsp!.url.split('/').pop()).find(existsSync)!); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); });
  const world = def.world ?? def.brushes.map(buildBrush);
  let guide = (def.route ?? []).map(q => [q[0], q[1], q[2]] as Vec), band: [number, number][] = guide.map(() => [+(process.env.A ?? 2), +(process.env.T ?? 150)]), free: boolean[] = guide.map(() => false);
  if (process.env.TAIL) {
    const tail: Vec[] = JSON.parse(readFileSync(process.env.TAIL, 'utf8')), d = (q: Vec) => Math.hypot(q[0] - tail[0][0], q[1] - tail[0][1], q[2] - tail[0][2]);
    const cut = guide.reduce((b, q, i) => (d(q) < d(guide[b]) ? i : b), 0);
    guide = [...guide.slice(0, cut), ...tail]; band = [...band.slice(0, cut), ...tail.map((): [number, number] => [+(process.env.AT ?? 0.5), +(process.env.TT ?? 500)])];
    free = guide.map((_, i) => i >= cut);
  }
  const riding = guide.map((a, j) => j + 1 < guide.length && [0.25, 0.5, 0.75].every(f => { // a surf face under the segment: riding, not a gap
    const q = a.map((v, k) => v + (guide[j + 1][k] - v) * f), t = trace(world, [q[0], q[1], q[2] + 64], [q[0], q[1], q[2] - 256], HULL_MIN, HULL_STAND);
    return t.fraction < 1 && t.normal[2] > 0.05 && t.normal[2] < 0.7;
  }));
  const cum = guide.reduce<number[]>((a, q, i) => [...a, i ? a[i - 1] + Math.hypot(q[0] - guide[i - 1][0], q[1] - guide[i - 1][1]) : 0], []);
  const on = (o: Vec, j: number) => { // o against guide segment j: progress, side offset, height off it, distance, past its end
    const a = guide[j], b = guide[j + 1], ab = b.map((v, k) => v - a[k]), L2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2 || 1;
    const t0 = ((o[0] - a[0]) * ab[0] + (o[1] - a[1]) * ab[1] + (o[2] - a[2]) * ab[2]) / L2, t = Math.max(0, Math.min(1, t0));
    const q = a.map((v, k) => v + ab[k] * t), h = Math.hypot(ab[0], ab[1]) || 1;
    return { j, prog: cum[j] + t * h, side: ((o[1] - q[1]) * ab[0] - (o[0] - q[0]) * ab[1]) / h, dz: o[2] - q[2], d: Math.hypot(o[0] - q[0], o[1] - q[1], o[2] - q[2]), past: t0 >= 1, t0 };
  };
  const where = (o: Vec, j0: number) => { // the guide is followed segment by segment (never skipping ahead to a later one that passes close)
    let w = on(o, j0);
    for (let i = 0; i < 4 && w.j + 2 < guide.length; i++) { const n = on(o, w.j + 1); if (w.past || (n.t0 > 0 && n.d < w.d)) w = n; else break; }
    return w;
  };
  const df = process.env.DF ? { ...JSON.parse(readFileSync(process.env.DF + '.json', 'utf8')), d: new Int32Array(readFileSync(process.env.DF + '.bin').buffer.slice(0)) } : null;
  const dist = (o: Vec) => { // distance to goal (units) from the nearest reachable cell around o (feet: look a little above first)
    const { box, cell: C, dims: [nx, ny, nz], d } = df!, i = Math.round((o[0] - box[0]) / C), j = Math.round((o[1] - box[1]) / C), k = Math.round((o[2] - box[2]) / C);
    let best = Infinity;
    for (const dk of [0, 1, -1, 2]) for (const dj of [0, -1, 1]) for (const di of [0, -1, 1]) {
      const a = i + di, b = j + dj, c = k + dk;
      if (a < 0 || b < 0 || c < 0 || a >= nx || b >= ny || c >= nz) continue;
      const v = d[(c * ny + b) * nx + a]; if (v >= 0 && v < best) best = v;
    }
    return best * C;
  };
  const cutAt = free.indexOf(true), d0 = df && cutAt >= 0 ? dist(guide[cutAt]) : 0;
  const s = new Session(def, { ...DEFAULTS, tickrate: tick }), per = tick / BLOCK, g = s.s.gravity, sx = s as unknown as { inPush: boolean[] };
  const snap = (): Snap => structuredClone({ p: s.p, run: s.run, stage: s.stage, section: s.section, trail: s.trail, name: s.name, inPush: sx.inPush });
  const restore = (n: Snap) => { const c = structuredClone(n); Object.assign(s, { p: c.p, run: c.run, stage: c.stage, section: c.section, trail: c.trail, name: c.name }); sx.inPush = c.inPush; s.events.length = 0; };
  // the route-following autopilot as a move (BOT): built the way the game builds it; NOBOT=1 leaves it out. The line
  // that has only ever used it is always kept, so a planned run is never worse than the autopilot alone.
  const B = makeBot(def.route ?? [], s.world, s.s, undefined, !!def.routeOnSurface, { flags: def.routeFlags, hazard: s.hazard, bisect: def.routeCorners });
  const moves = MOVES.map((_, i) => i).filter(i => i !== BOT || (!process.env.NOBOT && def.route?.length));
  const H = +(process.env.H ?? 1.5), wrap = (a: number) => ((a + 540) % 360) - 180;
  const heading = (o: Vec, j: number): number | null => { // where the policy steers (degrees)
    if (df && free[j]) { const C = df.cell, f = (dx: number, dy: number) => dist([o[0] + dx, o[1] + dy, o[2]]), gx = f(C, 0) - f(-C, 0), gy = f(0, C) - f(0, -C); return Number.isFinite(gx) && Number.isFinite(gy) && (gx || gy) ? atan2(-gy, -gx) * 180 / Math.PI : null; }
    let k = j + 1; while (k + 1 < guide.length && Math.hypot(guide[k][0] - o[0], guide[k][1] - o[1]) < 1500) k++;
    return atan2(guide[k][1] - o[1], guide[k][0] - o[0]) * 180 / Math.PI;
  };
  const play = (n: Node, steer: boolean) => { // seconds until a fall, or Infinity
    restore(n.snap);
    let j = n.j;
    for (let i = 0; i < H * tick; i++) {
      if (i % 8 === 0) j = where(s.p.origin, j).j;
      const want = steer ? heading(s.p.origin, j) : null, v = s.p.vel, err = want === null ? 0 : wrap(want - atan2(v[1], v[0]) * 180 / Math.PI);
      s.step(move(s.p, Math.abs(err) < 3 ? 1 : err > 0 ? 2 : 3)); // straight, or turn left / right
      for (const e of s.events) { if (e.type === 'fail') return i / tick; if (e.type === 'finish') return Infinity; }
      s.events.length = 0;
    }
    return Infinity;
  };
  const Ca = +(process.env.C ?? 1);
  const arc = (n: Node) => { // airborne: penalty for where the unsteered arc goes in the next 1.25 s
    const p = n.snap.p, v = p.vel, o = p.origin, hi = hullMax(p), dt = 1 / 32;
    if (p.onGround || p.tick - p.touchTick <= 1) return 0;
    let q: Vec = [...o];
    for (let k = 1; k <= 40; k++) {
      const t = k * dt, nq: Vec = [o[0] + v[0] * t, o[1] + v[1] * t, o[2] + v[2] * t - (g * t * t) / 2], tr = trace(s.world, q, nq, HULL_MIN, hi);
      if (tr.fraction < 1 || tr.startsolid) { const m = tr.normal, vn = v[0] * m[0] + v[1] * m[1] + (v[2] - g * t) * m[2]; return vn < 0 ? (Ca * vn * vn / (2 * g)) * (1 - t / 1.5) : 0; }
      if (s.hazard({ ...p, origin: nq })) return 5000 * (1 - t / 1.5);
      q = nq;
    }
    return 0;
  };
  const survival = (n: Node) => { const a = play(n, true); return a < Infinity ? Math.max(a, play(n, false)) : a; };
  const overFloor = (o: Vec) => { const t = trace(s.world, o, [o[0], o[1], o[2] - 80], HULL_MIN, hullMax(s.p)); return t.fraction < 1 && t.normal[2] >= 0.7; }; // level ground within a hop below
  s.restart();
  const B0 = B.save();
  const demoStart = () => { // DEMO=a recorded run: search on from its snapshot (a stage's start), along the guide from the nearest segment
    const d = JSON.parse(readFileSync(process.env.DEMO!, 'utf8')) as { snap: Snap }, o = d.snap.p.origin;
    let j = 0; for (let k = 0; k + 1 < guide.length; k++) if (on(o, k).d < on(o, j).d) j = k;
    return { snap: d.snap, moves: [], j, prog: on(o, j).prog };
  };
  const start = process.env.START ? JSON.parse(readFileSync(process.env.START, 'utf8')) as { snap: Snap; moves: number[]; j: number; prog: number } : process.env.DEMO ? demoStart() : null;
  const prefix: number[] = start?.moves ?? [], j0 = start ? Math.max(start.j, process.env.FREE ? cutAt : 0) : 0; // FREE: on from the cut (no guide)
  const TO = +(process.env.TO ?? -1); // TO=stage index: done when that stage is completed (a staged map's run through it), not at the map's finish
  const gates = (process.env.GATES ?? '').split(';').filter(Boolean).map(s => s.split(',').map(Number)), GW = +(process.env.GW ?? 0.1);
  let beam: Node[] = [{ snap: start?.snap ?? snap(), j: j0, v: 0, prog: start?.prog ?? 0, cell: '', parent: null, m: 0, g: 0, pure: moves.includes(BOT) && !process.env.START }], done: { node: Node; time: number } | null = null;
  writeFileSync(LOG, `${tag} W ${W} K ${K} E ${E} R ${R} A,T ${band[0]} tail ${band.at(-1)}: guide ${guide.length} points (${riding.filter(Boolean).length} segments riding), ${Math.round(cum.at(-1)!)} long\n`);
  if (df) appendFileSync(LOG, `distance field: ${d0} to go from the cut at ${guide[cutAt]}\n`);
  const t0 = Date.now();
  let bestProg = -Infinity, bestAt = prefix.length; // stalled: no new best progress for STALL seconds
  let width = W, tries = 0, failProg = -Infinity;
  const hist = new Map<number, Node[]>(), MAXT = +(process.env.TRIES ?? 4), WMAX = +(process.env.WMAX ?? 3200), STALL = BLOCK * +(process.env.STALL ?? 15);
  for (let step = prefix.length; step < BLOCK * +(process.env.SECS ?? 240) && !done; step++) {
    if (step % BLOCK === 0) hist.set(step, beam);
    const next: Node[] = [];
    for (const n of beam) for (const mi of moves) {
      restore(n.snap);
      if (mi === BOT) B.load(n.bot as ReturnType<typeof B.save> ?? B0);
      let dead = false, fin = -1;
      for (let i = 0; i < per && !dead; i++) {
        s.step(mi === BOT ? B(s.p) : move(s.p, mi));
        for (const e of s.events) { if (e.type === 'fail') dead = true; if (e.type === 'finish' || (e.type === 'stage' && e.index === TO)) fin = s.run.time; }
        s.events.length = 0;
        if (fin >= 0) break;
      }
      if (dead) { if (process.env.DEBUG && step >= +(process.env.DEBUG)) appendFileSync(LOG, `  step ${step} fell: move ${mi} at ${s.p.origin.map(Math.round)} v ${s.p.vel.map(Math.round)}\n`); continue; }
      const o = s.p.origin, w = where(o, n.j), vv = s.p.vel, sp = Math.hypot(vv[0], vv[1], vv[2]), energy = o[2] + sp ** 2 / (2 * g);
      const cell = [w.j, ...o.map(c => Math.round(c / 128)), Math.round(sp / 200), Math.round(vv[2] / 200)].join(); // where and how fast (slow starts in one room still spread)
      const [A, T] = band[w.j], onFace = s.p.tick - s.p.touchTick <= 1 || s.p.onGround;
      if (!free[w.j] && w.dz < -400 && sp < 800 && (s.p.onGround || overFloor(o))) continue; // walking (or hopping) along a floor far below the line: it counts as progress but is no line, and there's no way back up (fast states skimming a ramp top are left to the score)
      if (df && free[w.j]) { const dd = dist(o); if (!Number.isFinite(dd)) continue; w.prog = cum[cutAt] + d0 - dd; }
      const cap = process.env.CAP?.split(',').map(Number);
      let pen = cap && o.every((c, k) => c >= cap[k] && c <= cap[k + 3]) ? 2 * Math.max(0, sp - cap[6]) : 0;
      pen += df && free[w.j] ? 0 : Math.max(0, Math.abs(w.side) - (free[w.j] ? +(process.env.RT ?? 800) : R));
      if (free[w.j] && !df) pen += A * Math.max(0, Math.abs(w.dz) - T);
      else if (riding[w.j]) pen += A * (Math.max(0, -w.dz - T) + Math.max(0, w.dz - 3 * T) / 4);
      if (!onFace && !free[w.j]) { // airborne: where will the fall be when the next ramp comes?
        const jr = riding.findIndex((r, i) => r && i > w.j), hs = Math.hypot(vv[0], vv[1]);
        if (jr > 0 && hs > 100) { const t = (cum[jr] - w.prog) / hs, zt = o[2] + vv[2] * t - (g * t * t) / 2; pen += A * (Math.max(0, guide[jr][2] - L - zt) + Math.max(0, zt - guide[jr][2] - U)); }
      } else if (!riding[w.j] && !free[w.j]) pen += A * Math.max(0, -w.dz - T); // touching something over a gap, below the line
      const rem = df ? (free[w.j] ? d0 - (w.prog - cum[cutAt]) : cum[cutAt] - w.prog + d0) : cum.at(-1)! - w.prog; // distance to go
      const score = process.env.TTG ? -3000 * rem / Math.max(sp, 300) : w.prog;
      let gi = n.g; while (gi < gates.length && o.every((c, k) => c >= gates[gi][k] && c <= gates[gi][k + 3])) gi++;
      // gated (past the cut, gates still ahead): any such state ranks above those before the cut, gates passed first
      const gated = gates.length && free[w.j], gv = gated && gi < gates.length ? gi * +(process.env.G ?? 1500) + energy - GW * Math.hypot(...[0, 1, 2].map(k => o[k] - (gates[gi][k] + gates[gi][k + 3]) / 2)) - pen : null;
      const node: Node = { pure: n.pure && mi === BOT, bot: mi === BOT ? B.save() : n.bot, snap: snap(), j: w.j, prog: w.prog, cell: cell + ':' + gi, v: gv ?? ((gated ? (gates.length + 1) * 1e6 : 0) + +(process.env.PW ?? 1) * score + E * energy - pen), parent: n, m: mi, g: gi };
      if (fin >= 0 && (!done || fin < done.time)) done = { node, time: fin };
      next.push(node);
    }
    next.sort((a, b) => b.v - a.v);
    const seen = new Set<string>(), per_cell = new Map<string, number>();
    beam = next.filter(n => {
      const k = [...n.snap.p.origin, ...n.snap.p.vel].map(v => Math.round(v / 8)).join(), c = per_cell.get(n.cell) ?? 0;
      if (seen.has(k) || c >= K) return false;
      seen.add(k); per_cell.set(n.cell, c + 1); return true;
    }).slice(0, H > 0 ? 2 * width : width);
    let doomed = 0;
    if (Ca > 0) { for (const n of beam) n.v -= arc(n); beam.sort((a, b) => b.v - a.v); }
    if (H > 0 && beam.some(n => free[n.j])) { for (const n of beam) { if (!free[n.j]) continue; const t = survival(n); if (t < Infinity) { n.v -= 1e6 + (H - t) * 1e5; doomed++; } } beam.sort((a, b) => b.v - a.v); }
    const pure = next.find(n => n.pure); // (the autopilot alone: kept whatever its score)
    beam = beam.slice(0, width);
    if (pure && !beam.includes(pure)) beam.push(pure);
    if (process.env.DEBUG && step >= +process.env.DEBUG) for (const n of beam.slice(0, 6)) appendFileSync(LOG, `  step ${step}: v ${n.v.toFixed(0)} prog ${n.prog.toFixed(0)} at ${n.snap.p.origin.map(Math.round)} vel ${n.snap.p.vel.map(Math.round)} ground ${n.snap.p.onGround} normal ${n.snap.p.lastNormal.map(x => x.toFixed(2))}\n`);
    if (beam[0] && beam[0].prog > bestProg + 50) { bestProg = beam[0].prog; bestAt = step; }
    if (!beam.length || step - bestAt >= STALL) { // died out or stalled: rewind and search wider
      if (tries >= MAXT) break;
      tries++; failProg = Math.max(failProg, bestProg);
      const to = Math.max(...[...hist.keys()].filter(k => k <= Math.max(prefix.length, bestAt - BLOCK * 3 * tries))); // (from the last progress, not from where it died: a beam can linger a long time after the real mistake)
      beam = hist.get(to)!; width = Math.min(WMAX, W * 2 ** tries); bestAt = to; bestProg = Math.max(...beam.map(n => n.prog));
      appendFileSync(LOG, `t ${(step / BLOCK).toFixed(1)}s: ${next.length ? 'stalled' : 'everything fell'}; back to ${(to / BLOCK).toFixed(1)}s, width ${width}\n`);
      step = to - 1; continue;
    }
    if (tries && bestProg > failProg + 3000) { tries = 0; width = W; appendFileSync(LOG, `t ${(step / BLOCK).toFixed(1)}s: past it, width ${W}\n`); }
    if (process.env.SAVE_AT && step + 1 === Math.round(+process.env.SAVE_AT * BLOCK) && beam[0]) {
      const ms: number[] = []; for (let n: Node | null = beam[0]; n?.parent; n = n.parent) ms.unshift(n.m);
      writeFileSync(`scratch/${tag}.snap.json`, JSON.stringify({ snap: beam[0].snap, moves: [...prefix, ...ms], j: beam[0].j, prog: beam[0].prog }));
    }
    if (step % 32 === 0 || !beam.length) { const b = beam[0]; appendFileSync(LOG, b ? `t ${(step / BLOCK).toFixed(1)}s: best prog ${Math.round(b.prog)} seg ${b.j} at ${b.snap.p.origin.map(Math.round)} speed ${Math.round(Math.hypot(...b.snap.p.vel))} E ${Math.round(b.snap.p.origin[2] + (b.snap.p.vel[0] ** 2 + b.snap.p.vel[1] ** 2 + b.snap.p.vel[2] ** 2) / (2 * g))} gates ${b.g}, ${next.length} alive, ${doomed} doomed, ${((Date.now() - t0) / 1000).toFixed(0)}s\n` : `t ${(step / BLOCK).toFixed(1)}s: everything fell\n`); }
  }
  if (!done) return appendFileSync(LOG, `no finish (gave up after ${tries} tries)\n`);
  const ms: number[] = [...prefix]; for (let n: Node | null = done.node, k = prefix.length; n?.parent; n = n.parent) ms.splice(k, 0, n.m);
  const run = encode(ms);
  // replay it as the game does, from a fresh start (a search from a recording's snapshot has no such replay: it only shows the line is findable)
  let time = -1;
  if (!process.env.DEMO) {
    const r = new Session(def, { ...DEFAULTS, tickrate: tick }), bot = replay(run, tick, makeBot(def.route ?? [], r.world, r.s, undefined, !!def.routeOnSurface, { flags: def.routeFlags, hazard: r.hazard, bisect: def.routeCorners }));
    for (let i = 0; i < (ms.length + 2) * per && time < 0; i++) { r.step(bot(r.p)); for (const e of r.events.splice(0)) if (e.type === 'finish' || (e.type === 'stage' && e.index === TO)) time = r.run.time; }
  }
  appendFileSync(LOG, `finished ${done.time.toFixed(3)} (replay ${time.toFixed(3)}), ${ms.length} blocks, ${run.length} chars, ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);
  writeFileSync(`scratch/${tag}.run.json`, JSON.stringify({ run, time: done.time, ...(TO >= 0 && { stage: TO }) }));
}, 14_400_000);
