import { it } from 'vitest';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { DEFAULTS, NO_CMD, hlen, type Vec } from '../src/physics';
import { Session } from '../src/game';
import { resolveMap } from '../src/bsp';
import { makeBot } from '../src/bot';
const maps = Object.values(import.meta.glob<{ default: import('../src/game').MapDef }>('../src/maps/*.ts', { eager: true })).map(x => x.default);
const m = maps.find(x => x.id === (process.env.MAP ?? 'aircontrol'))!;
const f = (v: Vec | number[], d = 0) => v.map(x => x.toFixed(d)).join(',');
// Autopilot from the spawn: progress (nearest route point), splits, first fail. TRACE=n: last n quarter-second samples.
it('aircontrol run', async () => {
  const def = await resolveMap(m, async () => { const b = readFileSync(['public/maps/', 'public/bsp/'].map(d => d + m.bsp!.url.split('/').pop()).find(existsSync)!); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); });
  const ticks = (process.env.TICKS ?? '128,64').split(',').map(Number), pars = (process.env.PARS ?? '0,1').split(',').map(Number), out: string[] = [];
  const R = def.route!, near = (o: Vec) => R.reduce((b, q, i) => (Math.hypot(o[0] - q[0], o[1] - q[1], o[2] - q[2]) < Math.hypot(o[0] - R[b][0], o[1] - R[b][1], o[2] - R[b][2]) ? i : b), 0);
  for (const tick of ticks) for (const par of pars) {
    const s = new Session(def, { ...DEFAULTS, tickrate: tick }), bot = makeBot(R, s.world, s.s, process.env.ABSORB ? +process.env.ABSORB : undefined, true, { flags: def.routeFlags, hazard: s.hazard });
    s.p.tick = +(process.env.TICK0 ?? 0); s.p.origin[0] += +(process.env.EPS ?? 0) * 1e-6; // tick counter parity; float-noise nudge
    if (par) s.step(NO_CMD);
    let res = 'timeout', peak = 0, best = 0; const hist: string[] = [], splits: string[] = [];
    for (let i = 0; i < tick * +(process.env.SECS ?? 120) && res === 'timeout'; i++) {
      s.step(bot(s.p)); peak = Math.max(peak, hlen(s.p.vel));
      if (i % (tick / 4) === 0) { const n = near(s.p.origin); best = Math.max(best, n); hist.push(`   t=${(i / tick).toFixed(2)} o ${f(s.p.origin)} v ${f(s.p.vel)} h ${hlen(s.p.vel).toFixed(0)} n ${f(s.p.lastNormal, 2)} gnd ${s.p.onGround} wp ${n}`); }
      for (const e of s.events.splice(0)) {
        if (e.type === 'fail') res = `FAIL t=${(i / tick).toFixed(2)} at ${f(s.p.origin)}`;
        if (e.type === 'split') splits.push((i / tick).toFixed(2));
        if (e.type === 'finish') res = `done ${(i / tick).toFixed(2)}s`;
      }
    }
    out.push(`tick ${tick} par ${par}: ${res} best wp ${best}/${R.length} splits [${splits}] peak ${peak.toFixed(0)}`);
    if (process.env.TRACE && !res.startsWith('done')) out.push(hist.slice(-+process.env.TRACE).join('\n'));
  }
  writeFileSync(process.env.OUT ?? 'scratch/acrun.out', out.join('\n') + '\n');
}, 1200000);
