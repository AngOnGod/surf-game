// Per-stage autopilot-line search for surf_kitsune: riding heights and launch cuts, ranked by runs finished over
// {128, 64} tick x {both tick parities}, then time / progress. Each stage is run from rest at its spawn and (CTICKS,
// default TICKS) as the in-game demo runs it: from the spawn room on through every stage before it, carrying the
// speed through each exit teleport (they keep velocity).
import { it } from 'vitest';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DEFAULTS, NO_CMD } from '../src/physics';
import { Session, ridingLine } from '../src/game';
import { resolveMap } from '../src/bsp';
import { makeBot } from '../src/bot';
import m, { STATIONS } from '../src/maps/kitsune';
import { flagsOf, routeOf, type Station } from '../src/game';
type V = number[]; // per tunable station: [h0, h1, cut?]
it('optimise one kitsune stage', async () => {
  const K = +(process.env.STAGE ?? 1) - 1, N = +(process.env.N ?? 1500), tag = `${K + 1}${process.env.SEED ? '-' + process.env.SEED : ''}`, OUT = `scratch/kopt-${tag}.json`, LOG = `scratch/kopt-${tag}.prog`;
  const def = await resolveMap(m, async () => { const b = readFileSync('public/maps/surf_kitsune.bsp'); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); });
  const world = def.world!, ticks = (process.env.TICKS ?? '128,64').split(',').map(Number);
  const cticks = (process.env.CTICKS ?? process.env.TICKS ?? '128,64').split(',').filter(Boolean).map(Number);
  const runs = [...ticks.map(tick => ({ tick, from: K })), ...cticks.map(tick => ({ tick, from: -1 }))];
  const mine = STATIONS.map((_, i) => i).filter(i => STATIONS[i].s === K && (STATIONS[i].h[0] >= 0 || STATIONS[i].tune));
  // riding stations: [h0, h1, cut?]; tunable in-air stations: [dx, dy, dz] per point
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
  const evaluate = (v: V[]) => {
    const { route, owner, flags } = build(v), lo = owner.findIndex(i => STATIONS[i].s === K), hi = owner.findLastIndex(i => STATIONS[i].s === K);
    const res = runs.flatMap(({ tick, from }) => [0, 1].map(par => {
      const s = new Session({ ...def, route: route as any }, { ...DEFAULTS, tickrate: tick }), bot = makeBot(route, world, s.s, undefined, true, { flags, hazard: s.hazard, bisect: true });
      if (from >= 0) s.respawn(def.stages![from].spawn);
      if (par) s.step(NO_CMD);
      let last = lo, near = 1e9, fin = 0; // near: closest approach to the next waypoint (a gradient past the last one reached)
      const prog = () => (last - lo + Math.max(0, 1 - near / 3000)) / (hi - lo);
      for (let i = 0; i < tick * (from < 0 ? 40 + 20 * K : 40); i++) {
        s.step(bot(s.p));
        const o = s.p.origin, d = (j: number) => Math.hypot(o[0] - route[j][0], o[1] - route[j][1], o[2] - route[j][2]);
        for (let j = last; j <= Math.min(hi, last + 20); j++) if (d(j) < 500 && j > last) { last = j; near = 1e9; }
        if (last < hi) near = Math.min(near, d(last + 1));
        for (const e of s.events.splice(0)) {
          if (e.type === 'stage' && e.index === K) fin = e.time; // the end zone: done once through the exit window too
          if (e.type === 'fail') return { done: false, time: 0, st: owner[last], prog: prog() };
        }
        if (fin && (K === def.stages!.length - 1 || s.stage.index === K + 1)) return { done: true, time: fin, st: owner[hi], prog: 1 };
      }
      return { done: false, time: 0, st: owner[last], prog: prog() };
    }));
    const done = res.filter(r => r.done).length;
    return { score: done * 1e4 + res.reduce((a, r) => a + (r.done ? 100 - r.time : 100 * r.prog), 0), done, res };
  };
  const show = (r: ReturnType<typeof evaluate>) => `${r.done}/${r.res.length} ` + r.res.map(x => (x.done ? x.time.toFixed(2) : `st${x.st}`)).join(' ');
  let cur = evaluate(best);
  writeFileSync(LOG, `stage ${K + 1} start ${show(cur)}\n`);
  let seed = 101 + K * 7 + +(process.env.SEED ?? 0); const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  const t0 = Date.now();
  for (let it = 0; it < N && cur.done < cur.res.length; it++) {
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
  appendFileSync(LOG, `stage ${K + 1} final ${show(cur)} ${JSON.stringify(best.map(x => x.map(v => +v.toFixed(3))))}\n`);
}, 14_400_000);
