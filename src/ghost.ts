// The ghost: the autopilot's run worked out from a fresh start in a session of its own, a little at a time, as where it
// is on every tick. The game draws it as a see-through figure that sets off when your timer starts (each stage's, on a
// staged map), as replay bots do on surf servers: a line to follow. It only shows the way; the timer doesn't care.
import type { Cmd, Player } from './physics';
import { Session } from './game';
import { makeBot } from './bot';
import { BLOCK, decode, replay } from './plan';
import { RUNS } from './runs';

/** A map's autopilot from a fresh start: its planned run at this tick rate if there is one (`standard`: the movement
 *  settings at their defaults; `left`: the ticks of moves a run of the first stages has), else the route follower. */
export function pilot(s: Session, standard: boolean) {
  const planned = standard ? RUNS[`${s.def.id}@${s.s.tickrate}`] : undefined, r = s.def.route;
  if (!planned && !r) return null;
  const routeBot = (settle: boolean) => makeBot(r ?? [], s.world, s.s, undefined, !!s.def.routeOnSurface, { flags: s.def.routeFlags, hazard: s.hazard, bisect: s.def.routeCorners, settle });
  const drive: (p: Player) => Cmd = planned ? replay(planned.run, s.s.tickrate, routeBot(false)) : routeBot(true); // (planned runs hand some blocks to it)
  return { planned, drive, left: planned?.stage === undefined ? Infinity : (decode(planned.run).length * s.s.tickrate) / BLOCK };
}

export const POSE = 5; // per tick: x, y, z, yaw, ducked
export type Ghost = NonNullable<ReturnType<typeof ghost>>;
/** The autopilot's run on this session's map and settings, worked out by step(). It ends at a finish (a second on), a
 *  fall, when a run of the first stages runs out of moves, or after `seconds`. */
export function ghost(of: Session, standard: boolean, seconds = 300) {
  const s = new Session({ ...of.def, world: of.world }, of.s), a = pilot(s, standard);
  if (!a) return null;
  s.assisted = true;
  const tr = s.s.tickrate, cap = seconds * tr, at = new Float32Array((cap + 1) * POSE), staged = !!s.def.stages;
  const put = (i: number) => at.set([...s.p.origin, s.p.yaw, +s.p.ducked], i * POSE);
  put(0);
  let left = a.left;
  const g = {
    planned: a.planned, at, n: 1, // poses: at[i] is where it is after i ticks
    sync: [] as number[], // the tick its timer starts: the run's, or on a staged map each stage's
    finish: -1, fell: false, done: false,
    /** Works out up to `ticks` more ticks. */
    step(ticks: number) {
      for (; ticks > 0 && !g.done; ticks--) {
        const s0 = s.stage.state;
        s.step(a.drive(s.p));
        if (staged && s.stage.state === 'running' && s0 !== 'running') g.sync[s.stage.index] ??= g.n;
        for (const e of s.events.splice(0)) {
          if (e.type === 'start' && !staged) g.sync[0] ??= g.n;
          if (e.type === 'finish') g.finish = g.n;
          if (e.type === 'fail') g.fell = true;
        }
        if (g.fell) break;
        put(g.n++);
        if (--left <= 0 || g.n > cap || (g.finish >= 0 && g.n > g.finish + tr)) break;
      }
      if (ticks > 0 && !g.done) { // over: a timer that starts in its last second has no run to show
        g.done = true;
        g.sync.forEach((t, k) => { if (t > g.n - tr) delete g.sync[k]; });
      }
    },
  };
  return g;
}
