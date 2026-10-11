// Replays a run recorded in-game (E saves it; DEMO=path) through the movement code from its snapshot and checks it
// finishes in the recorded time: the game is deterministic, so a human's line is exact ground truth for the autopilot.
// Writes DEMO.csv (every tick) and DEMO.txt (a sample every quarter second: time, position, speed, vz, energy
// z + v²/1600, what the player rides) to read the line off.
import { expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { type MapDef, Session } from '../src/game';
import { DEFAULTS, hlen } from '../src/physics';
import { resolveMap } from '../src/bsp';

const maps = Object.values(import.meta.glob<{ default: MapDef }>('../src/maps/*.ts', { eager: true })).map(m => m.default);
const read = async (u: string) => { const b = readFileSync('public/' + u); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

it('a recorded run replays exactly', async () => {
  const path = process.env.DEMO!, d = JSON.parse(readFileSync(path, 'utf8'));
  const def = await resolveMap(maps.find(m => m.id === d.map)!, read), s = new Session(def, { ...DEFAULTS, ...d.settings, tickrate: d.tickrate });
  s.restore(d.snap);
  const tr = d.tickrate, rows: string[] = [], evs: string[] = [];
  let done: number | null = null;
  for (const [i, [yaw, pitch, fwd, side, jump, duck]] of (d.ticks as number[][]).entries()) {
    s.p.yaw = yaw; s.p.pitch = pitch;
    s.step({ fwd, side, up: 0, jump: !!jump, duck: !!duck });
    const p = s.p, o = p.origin, v = p.vel, n = p.lastNormal, t = (i + 1) / tr;
    for (const e of s.events.splice(0)) {
      if (e.type === 'msg') continue;
      evs.push(`${t.toFixed(3)}s ${e.type}${'time' in e ? ' ' + e.time.toFixed(4) : ''}${'index' in e ? ' #' + (e.index + 1) : ''}`);
      if (done === null && ((e.type === 'finish' && d.stage === undefined) || (e.type === 'stage' && e.index === d.stage))) done = e.time;
    }
    const ride = p.onGround ? 'ground' : p.tick - p.touchTick <= 1 && n[2] > 0 && n[2] < 0.7 ? `face n ${n.map(x => x.toFixed(2)).join(' ')}` : 'air';
    rows.push([t.toFixed(4), ...o.map(x => x.toFixed(1)), ...v.map(x => x.toFixed(1)), hlen(v).toFixed(0), (o[2] + (v[0] ** 2 + v[1] ** 2 + v[2] ** 2) / 1600).toFixed(0), ride].join(','));
  }
  writeFileSync(path + '.csv', 'time,x,y,z,vx,vy,vz,speed,E,rides\n' + rows.join('\n'));
  const every = Math.max(1, Math.round(tr / 4));
  writeFileSync(path + '.txt', [...evs, '', 'time  x y z | speed vz E | rides', ...rows.filter((_, i) => i % every === 0).map(r => {
    const f = r.split(','); return `${f[0].padStart(9)}s  ${f[1]} ${f[2]} ${f[3]} | ${f[7]} ${f[6]} ${f[8]} | ${f[9]}`;
  })].join('\n'));
  console.log(`${d.map}@${tr}${d.stage === undefined ? '' : ' stage ' + (d.stage + 1)}: ${d.ticks.length} ticks, recorded ${d.time.toFixed(4)} s${d.practice ? ' (practice)' : ''}\n` + evs.join('\n'));
  expect(done, 'the replay finishes').not.toBeNull();
  expect(done).toBeCloseTo(d.time, 6);
}, 600_000);
