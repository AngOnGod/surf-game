// Planned runs: an offline search (scratch/beam.test.ts) tries these moves with the real movement code, like a
// tool-assisted run, and keeps the best line start to finish. A run is stored as one move per block of ticks and
// replayed exactly (the movement code gives the same result in every browser).
import { type Cmd, type Player, DEG, NO_CMD, hlen } from './physics';
import { atan2 } from './fmath';

/** Moves: the wish direction relative to the velocity's heading (degrees, + = left) on even and odd ticks; null: no
 *  keys. Each is made with the nearest key (A, D, W or S) and the view turned to match, so the view looks roughly along
 *  the velocity. Jump is held throughout (on the ground: bunnyhop). */
export const MOVES: readonly [number | null, number | null][] = [
  [null, null], // a: coast
  [90, -90], // b: straight: strafe left and right in turn (each adds speed)
  [90, 90], [-90, -90], // c, d: turn left / right, square strafe (the most speed)
  [90, null], [-90, null], // e, f: gentle turn
  [120, 120], [-120, -120], // g, h: sharp turn (sheds speed)
  [150, 150], [-150, -150], // i, j: very sharp
  [0, 0], // k: forward
  [180, 180], // l: brake
  [null, null], // m: hand the block to the route-following autopilot (src/bot.ts)
];
export const BLOCK = 16; // blocks a second
const LETTERS = 'abcdefghijklm';
export const BOT = 12;

/** One tick of a move: sets the view, returns the keys. (Pitch only matters to noclip: it just tilts the view down.) */
export function move(p: Player, m: number): Cmd {
  p.pitch = 8;
  const rel = MOVES[m][p.tick & 1], head = hlen(p.vel) > 1 ? atan2(p.vel[1], p.vel[0]) / DEG : p.yaw;
  if (rel === null) { p.yaw = head; return { ...NO_CMD, jump: true }; }
  if (Math.abs(rel) <= 45) { p.yaw = head + rel; return { ...NO_CMD, fwd: 1, jump: true }; }
  if (Math.abs(rel) >= 135) { p.yaw = head + rel - 180; return { ...NO_CMD, fwd: -1, jump: true }; }
  p.yaw = head + rel + (rel > 0 ? -90 : 90); // A pushes 90° left of the view, D 90° right
  return { ...NO_CMD, side: rel > 0 ? -1 : 1, jump: true };
}

/** Runs are run-length coded: a move letter, then how many blocks (if more than one). */
export const encode = (ms: number[]) => ms.reduce<[number, number][]>((r, m) => (r.length && r.at(-1)![0] === m ? (r.at(-1)![1]++, r) : [...r, [m, 1]]), [])
  .map(([m, n]) => LETTERS[m] + (n > 1 ? n : '')).join('');
export const decode = (run: string) => [...run.matchAll(/([a-m])(\d*)/g)].flatMap(([, l, n]) => Array(+(n || 1)).fill(LETTERS.indexOf(l)) as number[]);

/** Replays a run from a fresh start (Session.restart): one move per block, then coasting. `bot`: the map's
 *  route-following autopilot, built as the search built it, for blocks handed to it. */
export function replay(run: string, tickrate: number, bot?: (p: Player) => Cmd) {
  const ms = decode(run), per = tickrate / BLOCK;
  let i = 0;
  return (p: Player): Cmd => { const m = ms[Math.floor(i++ / per)] ?? 0; return m === BOT ? bot!(p) : move(p, m); };
}
