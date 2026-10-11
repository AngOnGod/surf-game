// Autopilot: follows a map's route using only legal inputs (view yaw + strafe keys), through the real movement code.
import { type Brush, type Cmd, type Player, type Settings, type Vec, DEG, HULL_MIN, HULL_STAND, NO_CMD, ctx, hlen, hullMax, playerMove, trace } from './physics';
import { asin, atan2, cos, sin } from './fmath';

const wrap = (a: number) => ((a + 540) % 360) - 180;
const yawOf = (x: number, y: number) => atan2(y, x) / DEG;

/** absorb: how much of a hard landing to soak up by pre-strafing into the face (1 = no down-face slide). Soaking it
 *  up costs speed; at 64 tick there's too little strafe authority to recover a slide, so it soaks everything. */
/** Climb a surf face (normal n) toward t: strafe square to the velocity, into the face and on along it, leading the
 *  strafe a little (twice the climb a second at 128 tick, as much at 64) for a little speed. Sets the view yaw. */
function climb(p: Player, n: Vec, t: readonly number[], s: Settings): Cmd {
  const o = p.origin, nl = Math.hypot(n[0], n[1]), nx = n[0] / nl, ny = n[1] / nl;
  const fw = -ny * (t[0] - o[0]) + nx * (t[1] - o[1]) > 0 ? 1 : -1;
  const px = -nx - ny * fw, py = -ny + nx * fw, y = p.yaw * DEG; // right = (sin y, -cos y)
  const side = sin(y) * px - cos(y) * py > 0 ? 1 : -1;
  p.yaw -= side * asin(Math.min(1, (60 * 128) / s.tickrate - 30) / (hlen(p.vel) || 1)) / DEG;
  return { ...NO_CMD, side };
}

/** opt.flags[i] & 1: waypoint i is what a launch must hit (a window): the autopilot plans when to start climbing by
 *  simulating a few choices with the real movement code (opt.hazard: does a player state touch a kill volume). */
export function makeBot(route: readonly number[][], world: Brush[], s: Settings, absorb = s.tickrate < 100 ? 1 : 0, lateral = false,
  opt: { flags?: readonly number[]; hazard?: (p: Player) => boolean; bisect?: boolean } = {}) {
  const gravity = s.gravity;
  const plan = { tick: -1e9, climb: true };
  const rollout = (p0: Player, aim: readonly number[], wait: number) => { // closest approach to aim: slide `wait` ticks, climb, fly
    const q: Player = { ...p0, origin: [...p0.origin], vel: [...p0.vel], baseVel: [...p0.baseVel], lastNormal: [...p0.lastNormal], wishdir: [...p0.wishdir] };
    const c = ctx(q, world, s);
    let best = 1e9, since = 0;
    for (let i = 0; i < s.tickrate * 3 && since < s.tickrate / 2; i++) {
      const n = q.lastNormal, onFace = q.tick - q.touchTick <= 1 && n[2] > 0 && n[2] < 0.7;
      q.yaw = yawOf(q.vel[0], q.vel[1]);
      let cmd: Cmd = NO_CMD;
      if (onFace && i >= wait) cmd = climb(q, n, aim, s);
      else if (!onFace) { const err = wrap(yawOf(aim[0] - q.origin[0], aim[1] - q.origin[1]) - q.yaw); cmd = { ...NO_CMD, side: Math.abs(err) < 0.5 ? (q.tick & 1 ? 1 : -1) : err > 0 ? -1 : 1 }; }
      const before = hlen(q.vel);
      playerMove(c, cmd);
      if (opt.hazard?.(q)) return 1e6 + best;
      if (q.onGround || hlen(q.vel) < before * 0.5) return 5e5 + best; // landed flat or crashed
      const d = Math.hypot(q.origin[0] - aim[0], q.origin[1] - aim[1], q.origin[2] - aim[2]);
      if (d < 100) return d; // through the aim: what happens after is the next waypoint's business
      if (d < best) { best = d; since = 0; } else since++;
    }
    return best;
  };
  let k = -1, last: Vec | null = null; // k: last waypoint passed; target is route[k + 1]
  let tk = -2, tn: Vec | null = null; // normal of the surf face under the current target
  const uturn = (i: number) => { // the route doubles back at waypoint i (both legs long: not riding-line jitter)
    if (i <= 0 || i + 1 >= route.length) return false;
    const p = route[i - 1], q = route[i], r = route[i + 1], ax = q[0] - p[0], ay = q[1] - p[1], dx = r[0] - q[0], dy = r[1] - q[1];
    const la = Math.hypot(ax, ay), ld = Math.hypot(dx, dy);
    return la > 400 && ld > 400 && ld < 15000 && ax * dx + ay * dy < -0.17 * la * ld;
  };
  return (p: Player): Cmd => {
    const o = p.origin, v = p.vel;
    if (!last || Math.hypot(o[0] - last[0], o[1] - last[1], o[2] - last[2]) > 200) { // start or teleport: resume at the nearest waypoint
      let best = 0;
      route.forEach((q, i) => { if (Math.hypot(o[0] - q[0], o[1] - q[1], o[2] - q[2]) < Math.hypot(o[0] - route[best][0], o[1] - route[best][1], o[2] - route[best][2])) best = i; });
      k = best - 1;
    }
    last = o;
    const past = (i: number) => { // passed waypoint i (a link of >15000 units is a teleport: only arriving there counts)
      const q = route[i], r = route[i + 1], dx = r[0] - q[0], dy = r[1] - q[1];
      if (Math.hypot(dx, dy) >= 15000) return false;
      // where the route doubles back (a U-turn), passing means getting there along the way in, not crossing the way out
      if (uturn(i)) { const p = route[i - 1]; return (o[0] - q[0]) * (q[0] - p[0]) + (o[1] - q[1]) * (q[1] - p[1]) >= 0; }
      if (opt.bisect && i > 0) { // a corner is passed at the bisector of the ways in and out, not the way out alone
        const p = route[i - 1], la = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1, ld = Math.hypot(dx, dy) || 1;
        return (o[0] - q[0]) * ((q[0] - p[0]) / la + dx / ld) + (o[1] - q[1]) * ((q[1] - p[1]) / la + dy / ld) >= 0;
      }
      return (o[0] - q[0]) * dx + (o[1] - q[1]) * dy >= 0;
    };
    while (k + 2 < route.length && past(k + 1)) k++;
    const t = route[k + 1], a = route[Math.max(k, 0)];
    if (tk !== k) {
      tk = k;
      const tr = trace(world, [t[0], t[1], t[2] + 64], [t[0], t[1], t[2] - 256], HULL_MIN, HULL_STAND), m = tr.normal;
      tn = tr.fraction < 1 && m[2] > 0 && m[2] < 0.7 ? m : null;
    }
    const toT = yawOf(t[0] - o[0], t[1] - o[1]);
    const speed = hlen(v);
    if (p.onGround) { // walk toward the target; heading down to it, jump at the platform's edge (walking off drops short)
      p.yaw = toT;
      const vh = hlen(v) || 1, ahead: Vec = [o[0] + (v[0] / vh) * 40, o[1] + (v[1] / vh) * 40, o[2]];
      const edge = lateral && o[2] - t[2] > 100 && trace(world, [ahead[0], ahead[1], o[2] + 8], [ahead[0], ahead[1], o[2] - 40], HULL_MIN, HULL_STAND).fraction >= 1;
      return { ...NO_CMD, fwd: 1, jump: edge || (lateral && !s.bhopLimiter && vh > 400 && !p.oldJump) }; // landed on a flat top at speed: hop off before friction bites (if hopping keeps speed)
    }
    if (speed < 50) { p.yaw = toT; return NO_CMD; } // nearly still in the air: let gravity build speed (W here can hover you on a face)

    // look along the horizontal velocity: then A/D push exactly perpendicular to it (max turn / climb per tick)
    p.yaw = yawOf(v[0], v[1]);
    p.pitch = 10;
    const n = p.lastNormal;
    if (p.tick - p.touchTick <= 1 && n[2] > 0 && n[2] < 0.7) {
      // on a surf face: hold the line by strafing into the ramp (pull up) or releasing (slide down)
      const nl = Math.hypot(n[0], n[1]), nx = n[0] / nl, ny = n[1] / nl; // horizontal down-slope direction
      const sx = t[0] - a[0], sy = t[1] - a[1], seg = Math.hypot(sx, sy) || 1;
      const f = Math.max(0, Math.min(1, ((o[0] - a[0]) * sx + (o[1] - a[1]) * sy) / seg ** 2));
      const aimAt = [1, 2, 3].map(i => k + i).find(i => i < route.length && (opt.flags?.[i] ?? 0) & 1); // a planned launch coming up
      const launch = lateral && !tn && (t[2] > o[2] + 40 || aimAt !== undefined); // next waypoint is up in the air (or planned): climb the face and launch off its top
      if (lateral && !launch) { // hold the line's lateral position on the face (nearer the apex = higher): robust on curved drops
        // measured across the track (not along the face normal, which can tilt along the track on curved drops).
        // On the run-up to a gap (a long segment to the next ramp) hold the last waypoint's line and launch from it.
        const gap = seg > 1200;
        let lx = gap ? nx : -sy / seg, ly = gap ? ny : sx / seg;
        if (lx * nx + ly * ny < 0) { lx = -lx; ly = -ly; } // points down the face
        const g = gap ? 0 : f, d = (o[0] - a[0] - sx * g) * lx + (o[1] - a[1] - sy * g) * ly; // > 0: further down the face than the line
        const vLat = v[0] * lx + v[1] * ly, want = Math.max(-250, Math.min(250, -d * 3));
        if (vLat < want - 80 && d < -24) { // above the line and still rising (a banked curve lifts you): strafe down-face
          const y = p.yaw * DEG;
          return { ...NO_CMD, side: sin(y) * lx - cos(y) * ly > 0 ? 1 : -1 };
        }
        if (vLat <= want) return NO_CMD;
      } else if (!launch) { // hold the waypoint height; never follow a line steeper than a ramp's pitch (a gap segment means: hold, then launch)
        const slope = Math.max(-0.12, (t[2] - a[2]) / seg), zWant = a[2] + slope * f * seg;
        const along = (v[0] * sx + v[1] * sy) / seg; // feed-forward the line's slope
        if (v[2] >= slope * along + Math.max(-300, Math.min(300, (zWant - o[2]) * 4))) return NO_CMD;
      }
      // strafe perpendicular to velocity on the side that points into the face and forward along the ramp:
      // pulls up when moving along the ramp, curves a down-face slide into forward speed after a respawn/landing
      const fw = -ny * (t[0] - o[0]) + nx * (t[1] - o[1]) > 0 ? 1 : -1;
      const px = -nx - ny * fw, py = -ny + nx * fw, y = p.yaw * DEG; // right = (sin y, -cos y)
      const side = sin(y) * px - cos(y) * py > 0 ? 1 : -1;
      if (launch) { // lead the strafe: twice the climb a second at 128 tick (and as much at 64), for a little speed
        const j = aimAt;
        if (j !== undefined) { // planned launch: slide down a while first (a longer climb pops higher) or climb now
          if (p.tick - plan.tick >= 4) {
            const waits = [0, 6, 12, 24, 48, 96].map(w => Math.round((w * s.tickrate) / 128));
            const scores = waits.map(w => rollout(p, route[j], w));
            plan.tick = p.tick; plan.climb = scores.indexOf(Math.min(...scores)) === 0;
          }
          if (!plan.climb) return NO_CMD;
        }
        p.yaw -= side * asin(Math.min(1, (60 * 128) / s.tickrate - 30) / speed) / DEG;
      }
      return { ...NO_CMD, side };
    }
    // airborne and about to land on a surf face: strafe into it so the landing is parallel to the face
    // (smooth landing needs lateral speed into the face of about |vz| * cot(angle))
    // (only once the next waypoint is a landing spot, not an in-air one like a slot to thread)
    const landing = trace(world, [t[0], t[1], t[2]], [t[0], t[1], t[2] - 64], HULL_MIN, HULL_STAND).fraction < 1;
    let q = o, qv = v;
    for (let i = 0; i < (landing ? 24 : 0); i++) {
      const dt = 1 / 32, nq: Vec = [q[0] + qv[0] * dt, q[1] + qv[1] * dt, q[2] + qv[2] * dt - gravity * dt * dt / 2];
      const tr = trace(world, q, nq, HULL_MIN, hullMax(p));
      if (tr.fraction < 1) {
        const m = tr.normal, vh = Math.hypot(qv[0], qv[1]) || 1;
        if (Math.abs(m[2]) < 0.3 && (m[0] * qv[0] + m[1] * qv[1]) / vh < -0.6) { // heading into a ramp's end cap: drift down that ramp's slope
          const c: Vec = [tr.end[0] - m[0] * 48, tr.end[1] - m[1] * 48, tr.end[2]], top = trace(world, [c[0], c[1], c[2] + 1200], c, HULL_MIN, HULL_STAND).normal;
          if (top[2] > 0 && top[2] < 0.7) { const y = p.yaw * DEG; return { ...NO_CMD, side: sin(y) * top[0] - cos(y) * top[1] > 0 ? 1 : -1 }; } // (a plain wall: just steer)
        }
        const sameFace = !!tn && m[0] * tn[0] + m[1] * tn[1] + m[2] * tn[2] > 0.95; // the target's face (or one parallel to it)
        if (m[2] > 0 && m[2] < 0.7 && i > 0 && sameFace) {
          const ml = Math.hypot(m[0], m[1]), into = -(v[0] * m[0] + v[1] * m[1]) / ml;
          if (into < (absorb * -qv[2] * m[2]) / ml) { // not yet parallel to the face: push toward it
            const y = p.yaw * DEG;
            return { ...NO_CMD, side: sin(y) * -m[0] - cos(y) * -m[1] > 0 ? 1 : -1 };
          }
        }
        break;
      }
      q = nq; qv = [qv[0], qv[1], qv[2] - gravity * dt];
    }
    // a dive point (flag 2) below the straight fall line: brake hard in the air (back key: up to airaccel * maxspeed a
    // tick) until the fall from here lands on it, so steep drops through tight gaps are possible
    if ((opt.flags?.[k + 1] ?? 0) & 2) {
      const dh = Math.hypot(t[0] - o[0], t[1] - o[1]), th = dh / Math.max(speed, 1);
      if (speed > 250 && o[2] + v[2] * th - (gravity * th * th) / 2 > t[2] + 64) return { ...NO_CMD, fwd: -1 };
    }
    // airborne: rotate velocity toward the next waypoint
    const err = wrap(toT - p.yaw);
    if (Math.abs(err) < 0.5) return { ...NO_CMD, side: p.tick & 1 ? 1 : -1 }; // on course: alternate strafes, each adds speed (|v|² += 30²)
    // a strafe square to the velocity turns it by at most 30 u/s a tick (the air cap); for a tighter arc (the one
    // through the target) lead the turn: aim the wishdir th behind square, which adds up to 30 + |v|·sin(th) a tick.
    // (Surface-line routes only: the height-mode routes of the built-in maps were tuned without it.)
    const side = err > 0 ? -1 : 1, d = Math.hypot(t[0] - o[0], t[1] - o[1]), need = (2 * speed ** 2 * sin(Math.abs(err) * DEG)) / (d || 1) / s.tickrate;
    if (lateral && Math.abs(err) > 100 && k > 0 && uturn(k)) p.yaw -= side * Math.min(30, asin(Math.min(1, 170 / speed)) / DEG); // just past a U-turn point: hard lead, around in a few ticks for ~25% speed
    else if (lateral && need > 30) p.yaw -= side * asin(Math.min(15, need - 30) / speed) / DEG; // up to 45 a tick: nearly free
    return { ...NO_CMD, side };
  };
}
