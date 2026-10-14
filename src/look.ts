// A map drawn with its own look (opted into per map): its materials (textures, tints, see-through and glowing ones), its
// baked lighting (brush lightmaps, static props' vertex lighting) and its sky, as Source draws them. Materials: Valve
// Developer Wiki, "VMT", "Material proxies" (Sine); the map's textures are read from its packed files (stock ones aren't
// available: those faces keep their compiled average colour).
import type { Vec } from './physics';
import { type Image, readVtf } from './vtf';

/** Sine proxy on a colour channel: `$color[k]` swings between min and max every `period` seconds. */
export interface Pulse { k: number; min: number; max: number; period: number; offset: number }
/** lit: 0 none (glows), 1 lightmap, 2 vertex lighting; blend: 0 opaque, 1 see-through, 2 additive, 3 cut out (alpha test). */
export interface Mat { tex: Image | null; tint: Vec; lit: 0 | 1 | 2; blend: 0 | 1 | 2 | 3; alpha: number; cull: boolean; pulse: Pulse[] }
/** Triangles of one material: positions, texture coordinates, then lightmap coordinates (lit 1) or light colours (lit 2). */
export interface Part { mat: number; pos: Float32Array; uv: Float32Array; lm?: Float32Array; light?: Float32Array; index: Uint32Array }
/** The faces by material; the lightmap atlas (gamma, halved: 2 = the brightest); the sky (rt bk lf ft up dn). */
export interface Look { mats: Mat[]; parts: Part[]; lightmap: Image | null; sky: Image[] | null }

type Pak = Map<string, Uint8Array>;
const key = (p: string) => p.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase();
const latin1 = (b: Uint8Array) => new TextDecoder('latin1').decode(b);

/** A material's parameters (lower-case keys, the shader as `shader`), patches applied; null if it isn't packed. */
export function readVmt(pak: Pak, path: string, depth = 0): Record<string, string> | null {
  const raw = pak.get(key(`materials/${path.replace(/^materials[\\/]/i, '').replace(/\.vmt$/i, '')}.vmt`));
  if (!raw || depth > 3) return null;
  const text = latin1(raw).replace(/\/\/[^\n]*/g, ''), cut = text.search(/"?proxies"?\s*\{/i), head = cut < 0 ? text : text.slice(0, cut);
  const kv: Record<string, string> = { shader: (text.match(/^\s*"?([\w.]+)/)?.[1] ?? '').toLowerCase() };
  for (const m of head.matchAll(/"?([$%]\w+|include)"?\s+("[^"]*"|[^\s{}"]+)/gi)) kv[m[1].toLowerCase()] = m[2].replace(/"/g, '');
  for (const [i, s] of [...(cut < 0 ? '' : text.slice(cut)).matchAll(/"?sine"?\s*\{([^}]*)\}/gi)].entries()) kv[`sine${i}`] = s[1];
  if (kv.shader !== 'patch' || !kv.include) return kv;
  const base = readVmt(pak, kv.include, depth + 1);
  return base && { ...base, ...Object.fromEntries(Object.entries(kv).filter(([k]) => k !== 'shader' && k !== 'include')) };
}

const colour = (s?: string): Vec => { // "[r g b]" (0-1) or "{r g b}" (0-255)
  const v = (s ?? '').match(/[-\d.]+/g)?.map(Number) ?? [];
  const c = (v.length >= 3 ? v.slice(0, 3) : [v[0] ?? 1, v[0] ?? 1, v[0] ?? 1]) as Vec;
  return /\{/.test(s ?? '') ? (c.map(x => x / 255) as Vec) : c;
};
const textures = new WeakMap<Pak, Map<string, Image | null>>(); // decoded once per map
export const texture = (pak: Pak, path: string, max = 512): Image | null => {
  let cache = textures.get(pak);
  if (!cache) textures.set(pak, (cache = new Map()));
  const file = key(`materials/${path.replace(/\.vtf$/i, '')}.vtf`), k = `${file}@${max}`;
  if (!cache.has(k)) { const v = pak.get(file); cache.set(k, v ? readVtf(v, max) : null); }
  return cache.get(k)!;
};

/** A material as drawn. `flat`: its compiled average colour (gamma), used when its texture isn't packed. */
export function material(pak: Pak, path: string, flat: Vec, lit: 0 | 1 | 2): Mat {
  const kv = readVmt(pak, path) ?? { shader: '' }, tex = kv.$basetexture ? texture(pak, kv.$basetexture) : null;
  const tint = colour(kv.$color).map((c, k) => c * colour(kv.$color2)[k] * (tex ? 1 : flat[k])) as Vec;
  const on = (k: string) => !!kv[k] && kv[k] !== '0', alpha = kv.$alpha ? +kv.$alpha : 1;
  const pulse = Object.keys(kv).filter(k => k.startsWith('sine')).flatMap(k => {
    const p = Object.fromEntries([...kv[k].matchAll(/"?(\w+)"?\s+"?([^"\s]+)"?/g)].map(m => [m[1].toLowerCase(), m[2]]));
    const ch = (p.resultvar ?? '').match(/^\$color\[(\d)\]$/i), num = (s: string | undefined, d: number) => (s === undefined ? d : s.startsWith('$') ? +(kv[s.toLowerCase()] ?? d) : +s);
    return ch ? [{ k: +ch[1], min: num(p.sinemin, 0), max: num(p.sinemax, 1), period: num(p.sineperiod, 1) || 1, offset: num(p.timeoffset, 0) }] : [];
  });
  return {
    tex, tint, alpha, pulse, cull: !on('$nocull'),
    lit: kv.shader === 'unlitgeneric' ? 0 : lit,
    blend: on('$additive') ? 2 : on('$translucent') || alpha < 1 ? 1 : on('$alphatest') ? 3 : 0,
  };
}

/** The six faces of a packed sky (rt bk lf ft up dn), or null. */
export function sky(pak: Pak, name: string): Image[] | null {
  const faces = ['rt', 'bk', 'lf', 'ft', 'up', 'dn'].map(s => { const kv = readVmt(pak, `skybox/${name}${s}`); return kv?.$basetexture ? texture(pak, kv.$basetexture, 1024) : null; });
  return faces.every(f => f) ? (faces as Image[]) : null;
}
