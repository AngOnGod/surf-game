// Rendering, input, fixed-tick loop, HUD, menus. All movement lives in physics.ts; all rules in game.ts.
import * as THREE from 'three';
import { type Cmd, type Player, type Settings, type Vec, DEFAULTS, NO_CMD, hlen, len, viewVectors } from './physics';
import { type Box, type GameEvent, type MapDef, Session } from './game';
import { makeBot } from './bot';
import { type Demo, replay } from './plan';
import { RUNS } from './runs';
import { resolveMap } from './bsp';

const MAPS = Object.values(import.meta.glob<{ default: MapDef }>('./maps/*.ts', { eager: true }))
  .map(m => m.default).sort((a, b) => (a.order ?? 99) - (b.order ?? 99));

const store = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};
const saved = store.get<Partial<Settings> & { v?: number }>('surf.settings', {});
if (!saved.v) { delete saved.bhopLimiter; delete saved.autobhop; } // v1 saved vanilla CS:GO's bhop settings: switch to the surf-server ones
const settings: Settings & { v: number } = { ...DEFAULTS, ...saved, v: 2 };
interface PB { time?: number; splits?: (number | undefined)[]; stages?: (number | undefined)[] }
const pbKey = (id: string, tick = settings.tickrate) => `surf.pb.${id}${tick === 128 ? '' : '@' + tick}`; // each tick rate has its own times
// like a server's: times only count with the standard movement settings
const MOVEMENT: (keyof Settings)[] = ['gravity', 'airaccelerate', 'airMaxWishspeed', 'accelerate', 'friction', 'stopspeed', 'maxspeed', 'maxvelocity', 'jumpImpulse', 'rampfix', 'bhopLimiter', 'autobhop'];
const custom = () => MOVEMENT.some(k => Math.abs(+settings[k] - +DEFAULTS[k]) > 1e-6);
const $ = (id: string) => document.getElementById(id)!;
const wrap = (a: number) => ((a + 540) % 360) - 180;
const fmt = (t: number) => { const m = Math.floor(t / 60); return `${m}:${(t - m * 60).toFixed(3).padStart(6, '0')}`; };
const diff = (d: number) => `<span class="${d <= 0 ? 'good' : 'bad'}">${d <= 0 ? '−' : '+'}${Math.abs(d).toFixed(3)}</span>`;

// ---------------------------------------------------------------- scene (Z-up, Source units)

THREE.Object3D.DEFAULT_UP.set(0, 0, 1);
const canvas = $('c') as HTMLCanvasElement;
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, 1, 8, 400000);
const HORIZON = new THREE.Color(0xc4d6e6), FOG_NEAR = 12000, FOG_FAR = 110000;
scene.fog = new THREE.Fog(HORIZON, FOG_NEAR, FOG_FAR);

const sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
  uniforms: { horizon: { value: HORIZON } },
  vertexShader: 'varying vec3 vD; void main() { vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
  fragmentShader: `uniform vec3 horizon; varying vec3 vD;
    void main() { float h = normalize(vD).z;
      vec3 c = mix(horizon, vec3(.16, .38, .7), smoothstep(0., .55, h));
      gl_FragColor = vec4(mix(c, vec3(.42, .47, .55), smoothstep(0., -.35, h)), 1.); }`,
}));
sky.renderOrder = -1;
sky.frustumCulled = false;
scene.add(sky);

// world-space checker (128u) + grid lines (32u fine, 512u major) so speed and distance read at a glance
const brushMat = new THREE.ShaderMaterial({
  side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1, // edges draw on top
  uniforms: { fogColor: { value: HORIZON }, fogNear: { value: FOG_NEAR }, fogFar: { value: FOG_FAR }, alpha: { value: 1 } },
  vertexShader: `attribute vec3 tint; varying vec3 vW, vN, vC; varying float vD;
    void main() { vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; vN = normal; vC = tint;
      vec4 v = viewMatrix * w; vD = -v.z; gl_Position = projectionMatrix * v; }`,
  fragmentShader: `uniform vec3 fogColor; uniform float fogNear, fogFar, alpha; varying vec3 vW, vN, vC; varying float vD;
    float grid(vec2 uv, float s) { vec2 g = abs(fract(uv / s - .5) - .5) / fwidth(uv / s); return 1. - min(min(g.x, g.y), 1.); }
    void main() {
      vec3 n = normalize(vN), a = abs(n);
      vec2 uv = a.z >= max(a.x, a.y) ? vW.xy : a.x >= a.y ? vW.yz : vW.xz;
      vec2 cell = floor(uv / 128.);
      vec3 c = vC * mix(.88, 1.04, mod(cell.x + cell.y, 2.));
      c *= .6 + .4 * max(dot(n, normalize(vec3(.45, .3, .85))), 0.) + .08 * n.z;
      c *= 1. - .2 * grid(uv, 32.) * (1. - smoothstep(600., 2500., vD)) - .32 * grid(uv, 512.);
      gl_FragColor = vec4(mix(c, fogColor, smoothstep(fogNear, fogFar, vD)), alpha);
    }`,
});
const glassMat = Object.assign(brushMat.clone(), { transparent: true, depthWrite: false }); // windows: glass and grids
glassMat.uniforms.alpha.value = 0.45;
const edgeMat = new THREE.LineBasicMaterial({ color: 0x0b1220, transparent: true, opacity: 0.45 });
let worldGroup = new THREE.Group(), failGroup = new THREE.Group();

function zoneMesh(b: Box, color: number, opacity: number) {
  const size = [0, 1, 2].map(i => b.max[i] - b.min[i]) as Vec;
  const g = new THREE.BoxGeometry(...size), grp = new THREE.Group();
  grp.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false })));
  grp.add(new THREE.LineSegments(new THREE.EdgesGeometry(g), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.8 })));
  grp.position.set(...([0, 1, 2].map(i => (b.min[i] + b.max[i]) / 2) as Vec));
  return grp;
}

function buildScene(s: Session) {
  worldGroup.traverse(o => { if (o instanceof THREE.Mesh || o instanceof THREE.LineSegments) o.geometry.dispose(); });
  scene.remove(worldGroup);
  worldGroup = new THREE.Group();
  const solid = { pos: [] as number[], nrm: [] as number[], tint: [] as number[] }, glass = { pos: [] as number[], nrm: [] as number[], tint: [] as number[] }, edges: number[] = [], col = new THREE.Color();
  for (const b of s.world) {
    const m = b.glass ? glass : solid;
    for (const f of b.faces) {
      if (f.color === null) continue;
      col.set(f.color);
      for (let i = 1; i + 1 < f.verts.length; i++) for (const v of [f.verts[0], f.verts[i], f.verts[i + 1]]) { m.pos.push(...v); m.nrm.push(...f.n); m.tint.push(col.r, col.g, col.b); }
      f.verts.forEach((v, i) => edges.push(...v, ...f.verts[(i + 1) % f.verts.length]));
    }
  }
  for (const [m, mat] of [[solid, brushMat], [glass, glassMat]] as const) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(m.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(m.nrm, 3));
    g.setAttribute('tint', new THREE.Float32BufferAttribute(m.tint, 3));
    worldGroup.add(new THREE.Mesh(g, mat));
  }
  const eg = new THREE.BufferGeometry();
  eg.setAttribute('position', new THREE.Float32BufferAttribute(edges, 3));
  worldGroup.add(new THREE.LineSegments(eg, edgeMat));
  const t = s.def.terrain;
  if (t?.pos.length) {
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.BufferAttribute(t.pos, 3));
    tg.setAttribute('normal', new THREE.BufferAttribute(t.nrm, 3));
    tg.setAttribute('tint', new THREE.BufferAttribute(t.col, 3));
    worldGroup.add(new THREE.Mesh(tg, brushMat));
  }
  const d = s.def;
  if (!d.stages) { if (s.start) worldGroup.add(zoneMesh(s.start, 0x22c55e, 0.12)); if (s.end) worldGroup.add(zoneMesh(s.end, 0xef4444, 0.12)); }
  for (const st of d.stages ?? []) worldGroup.add(zoneMesh(st.start, 0x22c55e, 0.12), zoneMesh(st.end, 0xef4444, 0.12));
  for (const c of d.checkpoints ?? []) for (const z of [c, ...(c.also ?? [])]) worldGroup.add(zoneMesh(z, 0xeab308, 0.05));
  for (const p of d.pushes ?? []) worldGroup.add(zoneMesh(p, 0x06b6d4, 0.15));
  failGroup = new THREE.Group();
  for (const f of d.fails ?? []) if (f.max[0] - f.min[0] < 1e5) failGroup.add(zoneMesh(f, f.quiet ? 0x06b6d4 : 0xd946ef, 0.04));
  worldGroup.add(failGroup);
  scene.add(worldGroup);
}

// ---------------------------------------------------------------- rainbow trail: a map's env_spritetrail (or always on)
const BANDS = [0xff2020, 0xff8a00, 0xffe600, 0x2ee640, 0x2a8cff, 0x5a32e6, 0xb040ff].map(c => new THREE.Color(c));
const TRAIL_MAX = 1024, NB = BANDS.length;
const trailPos = new Float32Array(TRAIL_MAX * NB * 2 * 3), trailCol = new Float32Array(TRAIL_MAX * NB * 2 * 4);
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute('position', new THREE.BufferAttribute(trailPos, 3).setUsage(THREE.DynamicDrawUsage));
trailGeo.setAttribute('color', new THREE.BufferAttribute(trailCol, 4).setUsage(THREE.DynamicDrawUsage));
trailGeo.setIndex([...Array(TRAIL_MAX - 1).keys()].flatMap(i => [...Array(NB).keys()].flatMap(b => {
  const a = (i * NB + b) * 2, c = ((i + 1) * NB + b) * 2; // each band: its own two edges per sample, so colours stay crisp
  return [a, a + 1, c, a + 1, c + 1, c];
})));
const trail = new THREE.Mesh(trailGeo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, side: THREE.DoubleSide, depthWrite: false, fog: false }));
trail.frustumCulled = false;
scene.add(trail);
const trailPts: { t: number; p: THREE.Vector3 }[] = [];
function drawTrail(o: number[], now: number) {
  const spec = session.def.trail ?? { width: [8, 1], life: 2, height: 40 }, on = session.trail || settings.trail;
  const head = new THREE.Vector3(o[0], o[1], o[2] + spec.height), lastPt = trailPts.at(-1);
  if (!on || (lastPt && lastPt.p.distanceTo(head) > 400)) trailPts.length = 0; // off, or teleported: start over
  if (on && (!lastPt || lastPt.p.distanceTo(head) > 1)) trailPts.push({ t: now / 1000, p: head });
  while (trailPts.length && (trailPts.length > TRAIL_MAX || now / 1000 - trailPts[0].t > spec.life)) trailPts.shift();
  const n = trailPts.length, side = new THREE.Vector3(), dir = new THREE.Vector3(), toCam = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const { t, p } = trailPts[i], age = Math.min(1, (now / 1000 - t) / spec.life), w = spec.width[0] + (spec.width[1] - spec.width[0]) * age;
    dir.subVectors(trailPts[Math.min(n - 1, i + 1)].p, trailPts[Math.max(0, i - 1)].p);
    toCam.subVectors(camera.position, p);
    side.crossVectors(dir, toCam).normalize(); // camera-facing ribbon
    const near = Math.min(1, Math.max(0, (toCam.length() - 24) / 72)), alpha = (1 - age) * near; // fade out at the tail and right by the eye
    for (let b = 0; b < NB; b++) for (let e = 0; e < 2; e++) {
      const v = (i * NB + b) * 2 + e, u = ((b + e) / NB - 0.5) * w;
      trailPos.set([p.x + side.x * u, p.y + side.y * u, p.z + side.z * u], v * 3);
      trailCol.set([BANDS[b].r, BANDS[b].g, BANDS[b].b, alpha], v * 4);
    }
  }
  trailGeo.setDrawRange(0, Math.max(0, n - 1) * NB * 6);
  trailGeo.attributes.position.needsUpdate = trailGeo.attributes.color.needsUpdate = true;
}

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  // Source FOV is horizontal at 4:3; widescreen widens horizontally (Hor+)
  camera.fov = (2 * Math.atan(Math.tan((settings.fov / 2) * Math.PI / 180) * 3 / 4) * 180) / Math.PI;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

// ---------------------------------------------------------------- game state, input

let session = new Session(MAPS.find(m => !m.bsp)!, settings);
let autopilot: ((p: Player) => Cmd) | null = null;
let locked = false, debug = false, menuOpen = true, lastCmd: Cmd = NO_CMD;
const keys = new Set<string>();
let jumpTap = false, wheelJump = false;

// Run recording: the view and keys of every tick since the last clean start (a timer starting, a checkpoint loaded,
// noclip turned off), kept at a finish; E saves it as a file. The movement code is deterministic, so a replay from the
// snapshot is exact (scratch/demo.test.ts): a human's line is ground truth the autopilot can be taught from.
type Recorded = Demo & { map: string; tickrate: number; settings: Partial<Settings>; stage?: number; practice: boolean };
let rec: Pick<Demo, 'snap' | 'ticks'> | null = null, demo: Recorded | null = null;
const record = () => { rec = { snap: session.snapshot(), ticks: [] }; };
function saveDemo() {
  if (!demo) return flash('No finished run recorded yet');
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([JSON.stringify(demo)])), download: `${demo.map}@${demo.tickrate}${demo.stage === undefined ? '' : '-s' + (demo.stage + 1)}.demo.json` });
  a.click(); URL.revokeObjectURL(a.href);
  flash(`Saved ${a.download} to your downloads`);
}

let loading = false, pick: MapDef | null = null; // pick: a map whose file the player has to supply
const resolved = new Map<string, MapDef>();
const mapCache = () => caches.open('surf-maps'); // map files players supplied themselves, kept in this browser only
async function readMap(url: string) {
  try { const hit = await (await mapCache()).match(url); if (hit) return hit.arrayBuffer(); } catch { /* no Cache API here */ }
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} not found`);
  return r.arrayBuffer();
}
async function load(def: MapDef) {
  loading = true;
  if (def.bsp && !resolved.has(def.id)) flash(`Loading ${def.name}…`, 60000);
  try {
    const full = resolved.get(def.id) ?? await resolveMap(def, readMap);
    resolved.set(def.id, full);
    session = new Session(full, settings);
    autopilot = null;
    buildScene(session);
    if (def.bsp) { msgTick = -1; flash(def.name); }
  } catch (e) {
    if (def.bsp?.own) { msgTick = -1; flash('', 0); pick = def; show('pick'); document.exitPointerLock(); }
    else flash(`Couldn't load ${def.name}: ${(e as Error).message}`, 6000);
  } finally { loading = false; }
}
async function supply(def: MapDef, file: File) { // the player's own copy of a map that isn't shipped
  const buf = await file.arrayBuffer();
  let same = true;
  try { same = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map(b => b.toString(16).padStart(2, '0')).join('') === def.bsp!.own!.sha256; } catch { /* no SubtleCrypto */ }
  try { await (await mapCache()).put(def.bsp!.url, new Response(buf)); } catch { /* not kept: pick it again next time */ }
  resolved.set(def.id, await resolveMap(def, async () => buf));
  pick = null; show(null); lock(); await load(def);
  if (!same) flash(`Not the exact ${def.name} file this was made for: zones and the autopilot may not line up`, 6000);
}

const requestLock = canvas.requestPointerLock.bind(canvas) as (o?: object) => Promise<void> | void;
const lock = async () => {
  try { await requestLock({ unadjustedMovement: true }); } // raw mouse input where supported
  catch { try { await requestLock(); } catch { /* needs a user gesture, or Esc cooldown: click again */ } }
};
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (locked && pick) document.exitPointerLock(); // (the lock requested with the click landed after the load failed)
  else if (locked) show(null); else show(pick ? 'pick' : 'pause');
});
canvas.addEventListener('click', () => { if (!locked) lock(); });

const GAME_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space', 'ControlLeft', 'ControlRight', 'KeyR', 'KeyC', 'KeyV', 'KeyN', 'KeyP', 'F3']);
addEventListener('keydown', e => {
  if (menuOpen) return;
  if (GAME_KEYS.has(e.code) || e.ctrlKey) e.preventDefault();
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'Space') jumpTap = true;
  else if (e.code === 'KeyR') { session.restart(); if (autopilot) startAutopilot(); }
  else if (e.code === 'KeyC') session.saveCheckpoint();
  else if (e.code === 'KeyV') { session.loadCheckpoint(); if (session.saved) record(); }
  else if (e.code === 'KeyN') { session.toggleNoclip(); session.p.noclip ? (rec = null) : record(); }
  else if (e.code === 'KeyP') autopilot ? stopAutopilot() : startAutopilot();
  else if (e.code === 'KeyE') saveDemo();
  else if (e.code === 'F3') debug = !debug;
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());
addEventListener('wheel', () => { if (!menuOpen) wheelJump = true; }, { passive: true }); // mwheel jump, one tick per notch
addEventListener('mousemove', e => {
  if (!locked || autopilot) return;
  const k = 0.022 * settings.sensitivity, p = session.p;
  p.yaw = wrap(p.yaw - e.movementX * k);
  p.pitch = Math.max(-89, Math.min(89, p.pitch + e.movementY * k));
});
addEventListener('beforeunload', e => { if (locked && session.run.state === 'running') e.preventDefault(); }); // Ctrl+W guard

function readCmd(): Cmd {
  const k = (c: string) => (keys.has(c) ? 1 : 0);
  const duck = !!(k('ControlLeft') || k('ControlRight'));
  const jump = keys.has('Space') || jumpTap || wheelJump;
  jumpTap = wheelJump = false;
  return { fwd: k('KeyW') - k('KeyS'), side: k('KeyD') - k('KeyA'), up: k('Space') - (duck ? 1 : 0), jump, duck, fast: !!(k('ShiftLeft') || k('ShiftRight')) };
}

function startAutopilot() { // a planned run if there is one for this map and tick rate (standard settings only), else the route follower
  const planned = custom() ? undefined : RUNS[`${session.def.id}@${settings.tickrate}`], r = session.def.route;
  if (!planned && !r) return flash('This map has no autopilot route');
  session.restart();
  session.assisted = true;
  rec = null;
  const routeBot = (settle: boolean) => makeBot(r ?? [], session.world, settings, undefined, !!session.def.routeOnSurface, { flags: session.def.routeFlags, hazard: session.hazard, bisect: session.def.routeCorners, settle });
  autopilot = planned ? replay(planned.run, settings.tickrate, routeBot(false)) : routeBot(true); // (planned runs hand some blocks to it)
  flash(planned ? `Autopilot: its planned run, ${fmt(planned.time)} (P to stop)` : 'Autopilot demo (P to stop) · runs are not saved');
}
function stopAutopilot() { autopilot = null; session.restart(); session.assisted = false; flash('Autopilot off'); }

// ---------------------------------------------------------------- events, HUD

let msgTimer = 0, msgTick = -1;
function flash(html: string, ms = 2200) {
  const m = $('msg');
  m.innerHTML = msgTick === session.p.tick ? m.innerHTML + '\n' + html : html; // same-tick events stack
  msgTick = session.p.tick;
  m.style.opacity = '1';
  clearTimeout(msgTimer);
  msgTimer = window.setTimeout(() => (m.style.opacity = '0'), ms);
}

const sectionName = (i: number) => session.def.stages?.[i]?.name ?? (i > 0 ? session.def.checkpoints?.[i - 1]?.name : undefined);
function onEvent(e: GameEvent) {
  const id = session.def.id, pb: PB = store.get(pbKey(id), {});
  if ((e.type === 'finish' || e.type === 'stage') && rec) { // finished cleanly since the recording started: keep it
    demo = { map: id, tickrate: settings.tickrate, settings: Object.fromEntries(MOVEMENT.map(k => [k, settings[k]])) as Partial<Settings>, stage: e.type === 'stage' ? e.index : undefined, time: e.time, practice: e.practice, ...rec };
    rec = null;
    flash('Run recorded: E saves it as a file', 4000);
  }
  if (e.type === 'msg') flash(e.text);
  else if (e.type === 'split' && !e.practice) {
    const ref = pb.splits?.[e.index];
    flash(`${sectionName(e.index + 1) ?? `Split ${e.index + 1}`}  ${fmt(e.time)}${ref !== undefined ? '  ' + diff(e.time - ref) : ''}`);
  } else if (e.type === 'stage') {
    if (e.practice || custom()) return flash(`Stage ${e.index + 1}  ${fmt(e.time)}  <span class="gold">${e.practice ? 'practice' : 'custom settings: not saved'}</span>`);
    const ref = pb.stages?.[e.index], best = ref === undefined || e.time < ref;
    if (best) { (pb.stages ??= [])[e.index] = e.time; store.set(pbKey(id), pb); }
    flash(`Stage ${e.index + 1}  ${fmt(e.time)}${ref !== undefined ? '  ' + diff(e.time - ref) : ''}${best ? '  <span class="gold">stage PB</span>' : ''}`, 3500);
  } else if (e.type === 'finish') {
    if (e.practice || custom()) return flash(`Finished  ${fmt(e.time)}\n<span class="gold">${e.practice ? 'practice' : 'custom settings'}: not saved</span>`, 5000);
    const best = pb.time === undefined || e.time < pb.time;
    if (best) store.set(pbKey(id), { ...pb, time: e.time, splits: e.splits });
    flash(`${best ? '<span class="gold">NEW PERSONAL BEST</span>\n' : 'Finished\n'}${fmt(e.time)}${pb.time !== undefined ? '  ' + diff(e.time - pb.time) : ''}`, 6000);
  }
}

const cache = new Map<string, string>();
const set = (id: string, html: string) => { if (cache.get(id) !== html) { cache.set(id, html); $(id).innerHTML = html; } };
const v3 = (v: Vec, d = 1) => v.map(x => x.toFixed(d).padStart(9)).join('');
let fps = 0, frames = 0, fpsT = 0;

function hud() {
  const p = session.p, r = session.run, st = session.stage, staged = !!session.def.stages, total = session.sections;
  set('speed', `${Math.round(hlen(p.vel))}<small>u/s</small>`);
  const tag = (t: string, c = 'gold') => `<span class="tag ${c}">${t}</span>`;
  const practice = r.practice ? tag(session.assisted ? 'AUTOPILOT' : 'PRACTICE') : custom() ? tag('CUSTOM') : '';
  let timer = r.state === 'ready' ? `<span class="good">${fmt(0)}</span>${tag('START', 'good')}` : r.state === 'running' ? fmt(r.time) + practice
    : r.state === 'done' ? `<span class="gold">${fmt(r.time)}</span>${practice}` : '';
  if (staged && st.state !== 'idle') timer += `<div style="font-size:15px;opacity:.75">stage ${st.index + 1}  ${fmt(st.time)}</div>`;
  set('timer', timer);
  const idx = staged ? st.index : session.section, name = sectionName(idx);
  set('section', `${staged ? 'Stage' : 'Section'} ${idx + 1}/${total}${name ? ' · ' + name : ''}`);
  set('mode', [autopilot ? 'AUTOPILOT' : '', p.noclip ? 'NOCLIP' : '', settings.tickrate !== 128 ? `${settings.tickrate} TICK` : ''].filter(Boolean).join('  ·  '));
  const c = lastCmd;
  for (const [k, on] of [['kW', c.fwd > 0], ['kS', c.fwd < 0], ['kA', c.side < 0], ['kD', c.side > 0], ['kJ', c.jump], ['kC', c.duck]] as const) $(k).classList.toggle('on', on);
  const dbg = $('debug');
  dbg.style.display = debug ? 'block' : 'none';
  failGroup.visible = debug;
  if (debug) {
    const n = p.lastNormal, age = p.tick - p.touchTick;
    dbg.textContent = [
      `pos      ${v3(p.origin)}`,
      `vel      ${v3(p.vel)}   h ${hlen(p.vel).toFixed(1)}  |v| ${len(p.vel).toFixed(1)}`,
      `onground ${p.onGround}   ducked ${p.ducked}   noclip ${p.noclip}`,
      `clip n   ${v3(n, 3)}   ${p.touchTick < 0 ? 'never' : age + ' ticks ago'}`,
      `wishdir  ${v3(p.wishdir, 3)}`,
      `view     yaw ${p.yaw.toFixed(2)}  pitch ${p.pitch.toFixed(2)}`,
      `tick     ${p.tick} @ ${settings.tickrate} Hz   ${fps} fps`,
    ].join('\n');
  }
}

// ---------------------------------------------------------------- menus

type Screen = 'maps' | 'pause' | 'settings' | 'pick' | 'board';
// ---------------------------------------------------------------- leaderboard: no server, so times travel in links

type Times = Record<string, Record<string, { r?: number; s?: (number | null)[] }>>; // tick -> map id -> run / stage times
const TICKS = [128, 64, 256];
const esc = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const myName = () => store.get('surf.name', '');
const friends = () => store.get<Record<string, { at: number; d: Times }>>('surf.friends', {});
const b64 = { // base64url of UTF-8 JSON
  enc: (o: unknown) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(o)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s: string) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)))),
};
function myTimes(): Times {
  const d: Times = {};
  for (const tick of TICKS) for (const m of MAPS) {
    const pb: PB = store.get(pbKey(m.id, tick), {});
    if (pb.time !== undefined || pb.stages?.some(t => t != null)) (d[tick] ??= {})[m.id] = { r: pb.time, s: pb.stages?.map(t => t ?? null) };
  }
  return d;
}
function addFriend(o: { n?: unknown; d?: Record<string, Record<string, { r?: unknown; s?: unknown }>> }) { // from a link: untrusted
  const n = typeof o?.n === 'string' ? o.n.trim().slice(0, 24) : '', d: Times = {}, t = (x: unknown) => (typeof x === 'number' && x > 0 && x < 1e6 ? x : null);
  if (!n) throw new Error('no name in it');
  if (n === myName()) throw new Error('it has your own name (use different names)');
  for (const tick of TICKS) for (const m of MAPS) {
    const e = o.d?.[tick]?.[m.id];
    if (e && typeof e === 'object') (d[tick] ??= {})[m.id] = { r: t(e.r) ?? undefined, s: Array.isArray(e.s) ? e.s.slice(0, 64).map(t) : undefined };
  }
  store.set('surf.friends', { ...friends(), [n]: { at: Date.now(), d } });
  return n;
}
let boardNote = '';
function openLink() {
  const m = location.hash.match(/^#times=([\w-]+)$/);
  if (!m) return;
  history.replaceState(null, '', location.pathname + location.search);
  try { boardNote = `Added ${esc(addFriend(b64.dec(m[1])))}'s times.`; } catch (err) { boardNote = `That times link didn't load: ${esc((err as Error).message)}.`; }
  show('board');
}
addEventListener('hashchange', openLink);
function board() { // per map (and tick rate): a column per player, the best in each row in gold
  const cols: [string, Times][] = [[myName() || 'You', myTimes()], ...Object.entries(friends()).sort(([a], [b]) => a.localeCompare(b)).map(([n, f]) => [n, f.d] as [string, Times])];
  let html = '';
  for (const tick of TICKS) for (const m of MAPS) {
    const at = cols.map(([, d]) => d[tick]?.[m.id]), n = Math.max(0, ...at.map(e => e?.s?.length ?? 0));
    const rows = [['Run', at.map(e => e?.r)] as const, ...Array.from({ length: n }, (_, i) => [m.stages?.[i]?.name ?? `Stage ${i + 1}`, at.map(e => e?.s?.[i] ?? undefined)] as const)]
      .filter(([, ts]) => ts.some(t => t != null));
    if (!rows.length) continue;
    html += `<h2>${m.name}${tick === 128 ? '' : ` · ${tick} tick`}</h2><table class="board"><tr><th></th>${cols.map(([c]) => `<th>${esc(c)}</th>`).join('')}</tr>` +
      rows.map(([label, ts]) => { const best = Math.min(...ts.map(t => t ?? 1e9)); return `<tr><td>${label}</td>${ts.map(t => `<td${t === best ? ' class="gold"' : ''}>${t != null ? fmt(t) : '—'}</td>`).join('')}</tr>`; }).join('') + '</table>';
  }
  const fr = Object.entries(friends());
  return (html || '<p>No times yet.</p>') + (fr.length ? `<h2>Friends</h2><div class="grid">${fr.map(([n, f]) => `<label>${esc(n)} · updated ${new Date(f.at).toLocaleDateString()}</label><button data-unfriend="${esc(n)}">Remove</button>`).join('')}</div>` : '');
}

let backTo: Screen = 'maps';
const NUMS: [keyof Settings, string, number][] = [
  ['gravity', 'Gravity', 10], ['airaccelerate', 'Air accelerate', 1], ['airMaxWishspeed', 'Air max wishspeed', 1],
  ['accelerate', 'Ground accelerate', 0.1], ['friction', 'Friction', 0.1], ['stopspeed', 'Stop speed', 1],
  ['maxspeed', 'Max speed', 1], ['maxvelocity', 'Max velocity (per axis)', 50], ['jumpImpulse', 'Jump impulse', 0.1],
  ['sensitivity', 'Mouse sensitivity (× 0.022°/count)', 0.05], ['fov', 'FOV (horizontal at 4:3)', 1],
];
const BOOLS: [keyof Settings, string][] = [['rampfix', 'Rampbug fix (no dead stops on ramps, as on surf servers)'], ['bhopLimiter', 'Bunnyhop speed limiter (1.1 × max speed on jump)'], ['autobhop', 'Auto-bunnyhop (hold jump)'], ['trail', 'Rainbow trail (always on; some maps hand one out)']];
const CONTROLS = [['Click', 'capture mouse'], ['W A S D', 'move / strafe'], ['Mouse', 'look'], ['Space / wheel', 'jump'], ['Ctrl', 'duck'],
  ['R', 'restart run'], ['C / V', 'save / load practice checkpoint (invalidates timer)'], ['N', 'noclip (Space/Ctrl up/down, Shift fast)'],
  ['P', 'autopilot demo'], ['E', 'save the last finished run as a file'], ['F3', 'debug overlay'], ['Esc', 'menu']];

function show(screen: Screen | null) {
  menuOpen = !!screen;
  $('menu').style.display = screen ? 'flex' : 'none';
  if (!screen) return;
  keys.clear();
  const panel = $('panel');
  if (screen === 'maps') {
    panel.innerHTML = `<h1>SURF</h1><p>Source-engine air strafing and ramp physics, ${settings.tickrate} tick.</p><h2>Maps</h2>` +
      MAPS.map((m, i) => { const pb: PB = store.get(pbKey(m.id), {}); return `<button class="map" data-map="${i}"><div><b>${m.name}</b><span>${m.blurb ?? ''}</span></div><em>${pb.time !== undefined ? 'PB ' + fmt(pb.time) : ''}</em></button>`; }).join('') +
      `<div class="row"><button data-go="board">Leaderboard</button><button data-go="settings">Settings</button></div><h2>Controls</h2><div class="keys">${CONTROLS.map(([k, d]) => `<span><kbd>${k}</kbd></span><span>${d}</span>`).join('')}</div>` +
      `<h2>Credits</h2><p class="credits">${MAPS.filter(m => m.credit).map(({ name, credit: c }) => `<b>${name}</b> by ${c!.by}${c!.license ? `, <a href="${c!.license[1]}" target="_blank" rel="noopener">${c!.license[0]}</a>` : ''} · <a href="${c!.source}" target="_blank" rel="noopener">source</a>`).join('<br>')}<br>Maps are the authors' unmodified files; zones and autopilot lines are this game's own.</p>`;
  } else if (screen === 'pick') {
    const d = pick!;
    panel.innerHTML = `<h1>${d.name}</h1><p>This map isn't hosted here (there's no licence to share it), so it needs your own copy: download <a href="${d.bsp!.own!.get}" target="_blank" rel="noopener">the map</a>, unzip it and choose the <b>.bsp</b>. It's kept in this browser for next time.</p>` +
      `<div class="row"><label class="button primary">Choose the .bsp…<input type="file" accept=".bsp" data-pick hidden></label><button data-go="maps">Back</button></div>`;
  } else if (screen === 'pause') {
    panel.innerHTML = `<h1>PAUSED</h1><p>${session.def.name}</p><div class="row"><button class="primary" data-act="resume">Resume</button><button data-act="restart">Restart (R)</button><button data-go="maps">Maps</button><button data-go="board">Leaderboard</button><button data-go="settings">Settings</button></div>`;
  } else if (screen === 'board') {
    panel.innerHTML = `<h1>LEADERBOARD</h1><p>Times stay in each player's browser, so they travel by link: copy yours and send it. When a friend opens it, your times join their board (they send theirs back for yours). Only runs with the standard movement settings count, and each tick rate has its own times.</p>` +
      (boardNote ? `<p class="gold">${boardNote}</p>` : '') +
      `<div class="grid"><label>Your name</label><input type="text" data-name maxlength="24" placeholder="name" value="${esc(myName())}"></div>` +
      `<div class="row"><button class="primary" data-act="share">Copy my times link</button><button data-go="${backTo}">Back</button></div>` + board();
    boardNote = '';
  } else {
    panel.innerHTML = `<h1>SETTINGS</h1><h2>Movement</h2><div class="grid"><label>Tick rate (autopilot made for 128)</label><select data-k="tickrate"><option>128</option><option>64</option><option>256</option></select>` +
      NUMS.map(([k, l, st]) => `<label>${l}</label><input type="number" step="${st}" data-k="${k}" value="${+(settings[k] as number).toFixed(4)}">`).join('') +
      BOOLS.map(([k, l]) => `<label>${l}</label><input type="checkbox" data-k="${k}" ${settings[k] ? 'checked' : ''}>`).join('') +
      `</div><p>Times only save with the movement settings at their defaults, as on a server (custom runs say so); each tick rate keeps its own times.</p><div class="row"><button class="primary" data-go="${backTo}">Back</button><button data-act="defaults">Reset to defaults</button></div>`;
    (panel.querySelector('select') as HTMLSelectElement).value = String(settings.tickrate);
  }
  if (screen === 'maps' || screen === 'pause') backTo = screen;
}

$('panel').addEventListener('click', e => {
  const b = (e.target as HTMLElement).closest('button');
  if (!b) return;
  if (b.dataset.map) { show(null); lock(); load(MAPS[+b.dataset.map]); }
  if (b.dataset.go) { pick = null; show(b.dataset.go as Screen); }
  if (b.dataset.act === 'resume') { show(null); lock(); }
  if (b.dataset.act === 'restart') { session.restart(); show(null); lock(); }
  if (b.dataset.unfriend) { const fr = friends(); delete fr[b.dataset.unfriend]; store.set('surf.friends', fr); show('board'); }
  if (b.dataset.act === 'share') {
    const n = myName(), url = `${location.origin}${location.pathname}#times=${b64.enc({ n, d: myTimes() })}`;
    if (!n) { boardNote = 'Enter your name first.'; return show('board'); }
    navigator.clipboard.writeText(url).then(() => 'Link copied: paste it to your friends.', () => `Copy this link: <input class="link" readonly value="${esc(url)}">`)
      .then(note => { boardNote = note; show('board'); });
  }
  if (b.dataset.act === 'defaults') { Object.assign(settings, DEFAULTS); store.set('surf.settings', settings); resize(); show('settings'); }
});
$('panel').addEventListener('change', e => {
  const el = e.target as HTMLInputElement, k = el.dataset.k as keyof Settings;
  if ('name' in el.dataset) store.set('surf.name', el.value.trim().slice(0, 24));
  if ('pick' in el.dataset && el.files?.[0] && pick) supply(pick, el.files[0]).catch(err => flash(`That file didn't load: ${(err as Error).message}`, 6000));
  if (!k) return;
  const v = el.type === 'checkbox' ? el.checked : Number(el.value);
  if (typeof v === 'number' && !Number.isFinite(v)) return;
  (settings as unknown as Record<string, number | boolean>)[k] = v;
  store.set('surf.settings', settings);
  resize();
});

// ---------------------------------------------------------------- loop: fixed tick, render interpolates

let acc = 0, last = performance.now();
const running = () => !menuOpen && !loading;
function tick() {
  lastCmd = autopilot ? autopilot(session.p) : readCmd();
  const p = session.p, r0 = session.run.state, s0 = session.stage.state;
  rec?.ticks.push([p.yaw, p.pitch, lastCmd.fwd, lastCmd.side, +lastCmd.jump, +lastCmd.duck]);
  session.step(lastCmd);
  if ((session.run.state === 'running' && r0 !== 'running') || (session.stage.state === 'running' && s0 !== 'running')) record(); // a timer just started
  for (const e of session.events.splice(0)) onEvent(e);
}
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = 1 / settings.tickrate;
  acc = running() ? Math.min(acc + (now - last) / 1000, 0.25) : 0;
  last = now;
  while (acc >= dt) { acc -= dt; tick(); }
  draw(running() ? acc / dt : 1, now);
}
function draw(t: number, now: number) {
  const p = session.p, a = session.prev;
  const o = [0, 1, 2].map(i => a.origin[i] + (p.origin[i] - a.origin[i]) * t), eye = a.view + (p.viewOffset - a.view) * t;
  const { forward: f } = viewVectors(p.yaw, p.pitch);
  camera.position.set(o[0], o[1], o[2] + eye);
  camera.lookAt(o[0] + f[0], o[1] + f[1], o[2] + eye + f[2]);
  sky.position.copy(camera.position);
  drawTrail(o, now);
  renderer.render(scene, camera);
  for (const e of session.events.splice(0)) onEvent(e); // restart / checkpoint messages
  hud();
  frames++;
  if (now - fpsT > 500) { fps = Math.round((frames * 1000) / (now - fpsT)); frames = 0; fpsT = now; }
}

resize();
buildScene(session);
show('maps');
openLink();
requestAnimationFrame(frame);

if (import.meta.env.DEV) { // hooks for automated checks in the browser
  Object.assign(window, {
    surf: {
      get session() { return session; }, get demo() { return demo; }, save: saveDemo, settings, maps: MAPS, three: { THREE, scene, renderer, camera, get world() { return worldGroup; } },
      async play(id: string, auto = false) { show(null); await load(MAPS.find(m => m.id === id)!); if (auto) startAutopilot(); },
      cam(pos: Vec, yaw: number, pitch = 0) { const p = session.p; p.noclip = true; session.invalidate(); p.origin = pos; p.vel = [0, 0, 0]; p.yaw = yaw; p.pitch = pitch; session.snap(); draw(1, performance.now()); },
      advance(seconds: number) { for (let i = Math.round(seconds * settings.tickrate); i > 0; i--) tick(); draw(1, performance.now()); }, // runs while rAF is throttled
    },
  });
}
