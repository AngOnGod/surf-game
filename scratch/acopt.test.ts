// Per-section autopilot-line search for surf_aircontrol_ksf: riding heights, launch cuts and tuned in-air points,
// ranked by runs reaching the next checkpoint over {128, 64} tick x {both tick parities}, then time / progress.
// Sections after the first start from snapshots taken when the current line first enters the section.
import { it } from 'vitest';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DEFAULTS, NO_CMD, type Player } from '../src/physics';
import { Session, flagsOf, ridingLine, routeOf, type Station } from '../src/game';
import { resolveMap } from '../src/bsp';
import { makeBot } from '../src/bot';
import m, { STATIONS } from '../src/maps/aircontrol';
type V = number[];
it('optimise one aircontrol section', async () => {
  const K = +(process.env.SEC ?? 0), N = +(process.env.N ?? 400), tag = `${K}${process.env.SEED ? '-' + process.env.SEED : ''}`, OUT = `scratch/acopt-${tag}.json`, LOG = `scratch/acopt-${tag}.prog`;
  const def = await resolveMap(m, async () => { const b = readFileSync('public/bsp/surf_aircontrol_ksf.bsp'); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); });
  const world = def.world!, ticks = (process.env.TICKS ?? '128,64').split(',').map(Number), LIMIT = +(process.env.SECS ?? 40);
  const inside = (o: number[], b: { min: number[]; max: number[] }) => o.every((v, k) => v >= b.min[k] && v <= b.max[k]);
  const mine = STATIONS.map((_, i) => i).filter(i => STATIONS[i].s === K && (STATIONS[i].h[0] >= 0 || STATIONS[i].tune));
  let best: V[] = mine.map(i => (STATIONS[i].h[0] >= 0 ? [...STATIONS[i].h, ...(STATIONS[i].cut !== undefined ? [STATIONS[i].cut!] : [])] : STATIONS[i].g.flatMap(() => [0, 0, 0])));
  if (existsSync(OUT) && !process.env.FRESH) { const prev = JSON.parse(readFileSync(OUT, 'utf8')); if (prev.length === best.length) best = prev; }
  const build = (v: V[]) => {
    const st: Station[] = STATIONS.map((x, i) => {
      const j = mine.indexOf(i);
      if (j < 0) return x;
      if (x.h[0] < 0) return { ...x, g: x.g.map((p, k) => p.map((c, a) => c + v[j][k * 3 + a]) as typeof p) };
      return { ...x, h: [v[j][0], v[j][1]], cut: v[j][2] };
    });
    const owner = st.flatMap((x, i) => routeOf([x]).map(() => i));
    return { route: ridingLine(world, routeOf(st)), owner, flags: flagsOf(st) };
  };
  // starting states: the spawn, or the moment the current line first enters section K
  // runs start one section early, so the way into section K (its first stations are the previous one's landing) is tested too
  const K0 = Math.max(0, K - 1), base = build(best), starts: { tick: number; p: Player | null }[] = [], lo0 = base.owner.findIndex(i => STATIONS[i].s === K0);
  // variants: tick parity, the tick counter's parity (the game doesn't reset it), a 1e-6 nudge (float noise: Chrome and
  // node drift apart after ~40 s of flight, so a line must hold for nearby starts, not just the two exact ones)
  const VARIANTS = (process.env.VARIANTS ?? '0:0:0,1:0:0,0:1:0,1:1:0,0:0:1,1:1:1').split(',').map(v => v.split(':').map(Number));
  for (const tick of ticks) for (const [par, t0, eps] of VARIANTS) {
    const s = new Session({ ...def, route: base.route as any }, { ...DEFAULTS, tickrate: tick }), bot = makeBot(base.route, world, s.s, process.env.ABSORB ? +process.env.ABSORB : undefined, true, { flags: base.flags, hazard: s.hazard });
    s.p.tick = t0; s.p.origin = [s.p.origin[0] + eps * 1e-6, s.p.origin[1], s.p.origin[2]];
    if (par) s.step(NO_CMD);
    let p: Player | null = K0 ? null : structuredClone(s.p);
    for (let i = 0; i < tick * 400 && !p; i++) {
      s.step(bot(s.p));
      if (s.events.splice(0).some(e => e.type === 'fail')) break;
      const o = s.p.origin; // riding one of the section's first waypoints (past its first: what the previous section must reach)
      if (s.section >= K0 && [1, 2, 3, 4].some(j => { const q = base.route[lo0 + j]; return Math.hypot(o[0] - q[0], o[1] - q[1]) < 500 && o[2] > q[2] - 300; })) p = structuredClone(s.p);
    }
    starts.push({ tick, p });
    if (!p) appendFileSync(LOG + '.dbg', `tick ${tick} variant ${par}:${t0}:${eps}: no start; q ${base.route[lo0 + 1].map(Math.round)} lo0 ${lo0} section ${s.section} at ${s.p.origin.map(Math.round)}\n`);
  }
  const evaluate = (v: V[]) => {
    const { route, owner, flags } = build(v), lo = owner.findIndex(i => STATIONS[i].s === K0), hi = owner.findLastIndex(i => STATIONS[i].s === K);
    const final = K === (def.checkpoints?.length ?? 0), end = final ? hi : Math.min(route.length - 1, hi + 2); // done: two waypoints into the next section
    const res = starts.filter(x => x.p).map(({ tick, p }) => {
      const s = new Session({ ...def, route: route as any }, { ...DEFAULTS, tickrate: tick }), bot = makeBot(route, world, s.s, process.env.ABSORB ? +process.env.ABSORB : undefined, true, { flags, hazard: s.hazard });
      s.p = structuredClone(p!); s.section = K0; s.snap();
      let last = lo, near = 1e9; // near: closest approach to the next waypoint (a gradient past the last one reached)
      const prog = () => (last - lo + Math.max(0, 1 - near / 3000)) / (end - lo + 1);
      for (let i = 0; i < tick * LIMIT; i++) {
        s.step(bot(s.p));
        const o = s.p.origin, d = (j: number) => Math.hypot(o[0] - route[j][0], o[1] - route[j][1], o[2] - route[j][2]);
        for (let j = last; j <= Math.min(end, last + 20); j++) if (d(j) < (j === end ? 300 : 500) && o[2] > route[j][2] - 120 && j > last) { last = j; near = 1e9; } // the last one: actually on the line
        if (last < end) near = Math.min(near, d(last + 1));
        if (final ? inside(o, def.end!) : last >= end && s.section > K) return { done: true, time: i / tick, st: owner[end], prog: 1 };
        if (s.events.splice(0).some(e => e.type === 'fail')) return { done: false, time: 0, st: owner[last], prog: prog() };
      }
      return { done: false, time: 0, st: owner[last], prog: prog() };
    });
    const done = res.filter(r => r.done).length;
    return { score: done * 1e4 + res.reduce((a, r) => a + (r.done ? 100 - r.time : 100 * r.prog), 0), done, res };
  };
  const show = (r: ReturnType<typeof evaluate>) => `${r.done}/${r.res.length} ` + r.res.map(x => (x.done ? x.time.toFixed(2) : `st${x.st}`)).join(' ');
  let cur = evaluate(best);
  writeFileSync(LOG, `section ${K} starts ${starts.map(x => (x.p ? 'ok' : 'MISSING')).join(' ')}; start ${show(cur)}\n`);
  let seed = 101 + K * 7 + +(process.env.SEED ?? 0); const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const t0 = Date.now();
  for (let it = 0; it < N && (process.env.KEEP || cur.done < cur.res.length); it++) {
    const fails = cur.res.filter(r => !r.done).map(r => r.st);
    const fs = fails.length ? fails[Math.floor(rnd() * fails.length)] : mine.at(-1)!;
    const near = mine.map((si, j) => [si, j]).filter(([si]) => si <= fs + 1 && si >= fs - 3);
    const cand = best.map(x => [...x]);
    for (let k = 0, n = 1 + Math.floor(rnd() * 3); k < n; k++) {
      const [, j] = near.length && rnd() > 0.3 ? near[Math.floor(rnd() * near.length)] : [0, Math.floor(rnd() * mine.length)];
      const e = Math.floor(rnd() * cand[j].length), air = STATIONS[mine[j]].h[0] < 0;
      cand[j][e] = air ? Math.max(-600, Math.min(600, cand[j][e] + gauss() * 120)) : e < 2 ? Math.max(0.03, Math.min(0.97, cand[j][e] + gauss() * 0.15)) : Math.max(0, Math.min(2000, cand[j][e] + gauss() * 250));
    }
    const r = evaluate(cand);
    if (r.score > cur.score) { best = cand; cur = r; writeFileSync(OUT, JSON.stringify(best)); appendFileSync(LOG, `it ${it} ${show(r)} ${((Date.now() - t0) / 1000).toFixed(0)}s\n`); }
  }
  appendFileSync(LOG, `section ${K} final ${show(cur)} ${JSON.stringify(best.map(x => x.map(v => +v.toFixed(3))))}\n`);
}, 14_400_000);
