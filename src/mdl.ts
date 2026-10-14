// Static props: models placed in a map (the prop_static game lump), loaded from the map's own packed files (the
// pakfile lump, a zip). Drawn, and solid where the map makes them solid (SOLID_VPHYSICS: the model's collision hulls,
// each a convex piece). Models that aren't packed in the map (stock game models) aren't available here.
// Formats: Valve Developer Wiki, "MDL", "VVD", "VTX", "PHY" (IVP compact surfaces), "VTF".
import type { Vec } from './physics';

/** The pakfile's entries (stored ones: that's how maps pack files), by lower-case path. */
export function readPak(u8: Uint8Array, ofs: number, len: number): Map<string, Uint8Array> {
  const out = new Map<string, Uint8Array>(), dv = new DataView(u8.buffer, u8.byteOffset);
  let e = ofs + len - 22;
  while (e >= ofs && dv.getUint32(e, true) !== 0x06054b50) e--; // end of central directory (a comment may follow it)
  if (e < ofs) return out;
  for (let i = 0, c = ofs + dv.getUint32(e + 16, true); i < dv.getUint16(e + 10, true) && dv.getUint32(c, true) === 0x02014b50; i++) {
    const method = dv.getUint16(c + 10, true), size = dv.getUint32(c + 20, true), nl = dv.getUint16(c + 28, true), local = ofs + dv.getUint32(c + 42, true);
    const name = new TextDecoder('latin1').decode(u8.subarray(c + 46, c + 46 + nl)).toLowerCase();
    if (method === 0) { const d = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true); out.set(name, u8.subarray(d, d + size)); }
    c += 46 + nl + dv.getUint16(c + 30, true) + dv.getUint16(c + 32, true);
  }
  return out;
}

export interface Prop { model: string; origin: Vec; angles: Vec; solid: number; skin: number; scale: number }
/** The prop_static game lump: dictionary of model names, leaves, then the props (their size depends on the version). */
export function staticProps(u8: Uint8Array, ofs: number): Prop[] {
  const dv = new DataView(u8.buffer, u8.byteOffset), n = dv.getInt32(ofs, true);
  for (let i = 0; i < n; i++) {
    const h = ofs + 4 + i * 16;
    if (dv.getInt32(h, true) !== 0x73707270) continue; // 'sprp'
    const ver = dv.getUint16(h + 6, true), start = dv.getInt32(h + 8, true), end = start + dv.getInt32(h + 12, true);
    let o = start;
    const nd = dv.getInt32(o, true), names: string[] = [];
    o += 4;
    for (let k = 0; k < nd; k++, o += 128) { const s = u8.subarray(o, o + 128); names.push(new TextDecoder('latin1').decode(s.subarray(0, s.indexOf(0) < 0 ? 128 : s.indexOf(0)))); }
    o += 4 + 2 * dv.getInt32(o, true); // leaves
    const np = dv.getInt32(o, true), size = np ? (end - o - 4) / np : 0, out: Prop[] = [];
    o += 4;
    for (let k = 0; k < np; k++, o += size) {
      const f = (q: number) => dv.getFloat32(o + q, true);
      out.push({ model: names[dv.getUint16(o + 24, true)], origin: [f(0), f(4), f(8)], angles: [f(12), f(16), f(20)], solid: u8[o + 30], skin: dv.getInt32(o + 32, true), scale: ver >= 11 && size >= 80 ? f(76) || 1 : 1 });
    }
    return out;
  }
  return [];
}

/** A model in its own space: triangles to draw (positions, normals, colours) and convex collision hulls. */
export interface Mesh { pos: Float32Array; nrm: Float32Array; col: Float32Array }
export interface Model extends Mesh { glass: Mesh; hulls: { pts: Vec[]; tris: number[] }[]; min: Vec; max: Vec } // glass: its see-through triangles

const str = (u8: Uint8Array, o: number) => { let e = o; while (u8[e]) e++; return new TextDecoder('latin1').decode(u8.subarray(o, e)); };
const srgb = (c: number) => Math.min(1, Math.max(0, c)) ** (1 / 2.2);

/** A material's colour (its base texture's reflectivity, what vbsp gives brushes) and whether it is see-through
 *  ($translucent, $additive, $alphatest: drawn as glass); null if it isn't packed. */
function material(pak: Map<string, Uint8Array>, path: string, depth = 0): { rgb: Vec; glass: boolean } | null {
  const vmt = pak.get(`materials/${path}.vmt`.replace(/\\/g, '/').replace(/\/+/g, '/').toLowerCase());
  if (!vmt || depth > 3) return null;
  const text = new TextDecoder('latin1').decode(vmt), inc = text.match(/"?include"?\s+"([^"]+)"/i);
  if (/^\s*"?patch"?/i.test(text) && inc) return material(pak, inc[1].replace(/^materials[\\/]/i, '').replace(/\.vmt$/i, ''), depth + 1);
  const glass = /"?\$(translucent|additive|alphatest)"?\s+"?1/i.test(text);
  const base = text.match(/"?\$basetexture"?\s+"?([^"\s]+)"?/i), vtf = base && pak.get(`materials/${base[1]}.vtf`.replace(/\\/g, '/').toLowerCase());
  if (!vtf || vtf.length < 44) return { rgb: [0.54, 0.56, 0.6], glass };
  const dv = new DataView(vtf.buffer, vtf.byteOffset);
  return { rgb: [0, 1, 2].map(k => srgb(dv.getFloat32(32 + 4 * k, true))) as Vec, glass };
}

/** Loads a packed model (MDL + VVD + DX90 VTX, level of detail 0, body 0, the given skin; PHY for its hulls). */
export function loadModel(pak: Map<string, Uint8Array>, name: string, skin = 0): Model | null {
  const base = name.toLowerCase().replace(/\\/g, '/').replace(/\.mdl$/, ''), mdl = pak.get(base + '.mdl'), vvd = pak.get(base + '.vvd');
  const vtx = pak.get(base + '.dx90.vtx') ?? pak.get(base + '.vtx') ?? pak.get(base + '.dx80.vtx');
  if (!mdl || !vvd || !vtx) return null;
  const M = new DataView(mdl.buffer, mdl.byteOffset), V = new DataView(vvd.buffer, vvd.byteOffset), X = new DataView(vtx.buffer, vtx.byteOffset);
  const mi = (o: number) => M.getInt32(o, true), xi = (o: number) => X.getInt32(o, true), ver = mi(4);
  // the model's materials: skin family -> texture, searched in its texture folders
  const dirs = [...Array(mi(212)).keys()].map(k => str(mdl, mi(mi(216) + 4 * k)));
  const tex = [...Array(mi(204)).keys()].map(k => { const t = mi(208) + 64 * k; return str(mdl, t + mi(t)); });
  const mats = tex.map(t => dirs.map(d => material(pak, d + t)).find(c => c) ?? null);
  const nref = mi(220), fam = Math.min(Math.max(0, skin), Math.max(0, mi(224) - 1));
  const matOf = (m: number) => mats[M.getInt16(mi(228) + 2 * (fam * nref + m), true)] ?? { rgb: [0.54, 0.56, 0.6] as Vec, glass: false };
  // vertices (VVD, level 0: fixups rebuild its order)
  const vstart = V.getInt32(56, true), nfix = V.getInt32(48, true), order: number[] = [];
  if (nfix) for (let k = 0, f = V.getInt32(52, true); k < nfix; k++) { const src = V.getInt32(f + 12 * k + 4, true), cnt = V.getInt32(f + 12 * k + 8, true); for (let q = 0; q < cnt; q++) order.push(src + q); }
  const vert = (i: number) => vstart + 48 * (nfix ? order[i] : i);
  const solid = { pos: [] as number[], nrm: [] as number[], col: [] as number[] }, see = { pos: [] as number[], nrm: [] as number[], col: [] as number[] };
  const sgSize = ver >= 49 ? 33 : 25;
  for (let b = 0; b < Math.min(xi(28), mi(232)); b++) {
    const xb = xi(32) + 8 * b, mb = mi(236) + 16 * b;
    if (xi(xb) < 1 || M.getInt32(mb + 4, true) < 1) continue;
    const xm = xb + xi(xb + 4), mm = mb + M.getInt32(mb + 12, true); // the body part's first model (body 0)
    const lod = xm + xi(xm + 4), vbase = M.getInt32(mm + 84, true) / 48;
    for (let k = 0; k < xi(lod); k++) {
      const xme = lod + xi(lod + 4) + 9 * k, mme = mm + M.getInt32(mm + 76, true) + 116 * k, voff = M.getInt32(mme + 12, true), mat = matOf(M.getInt32(mme, true)), c = mat.rgb, out = mat.glass ? see : solid;
      for (let g = 0; g < xi(xme); g++) {
        const sg = xme + xi(xme + 4) + sgSize * g, nv = xi(sg), vo = sg + xi(sg + 4), ni = xi(sg + 8), io = sg + xi(sg + 12);
        for (let t = 0; t + 2 < ni; t += 3) {
          const tri = [0, 2, 1].map(q => X.getUint16(io + 2 * (t + q), true)); // (Source winds them clockwise)
          if (tri.some(i => i >= nv)) continue;
          for (const i of tri) {
            const v = vert(vbase + voff + X.getUint16(vo + 9 * i + 4, true));
            for (let a = 0; a < 3; a++) { out.pos.push(V.getFloat32(v + 16 + 4 * a, true)); out.nrm.push(V.getFloat32(v + 28 + 4 * a, true)); out.col.push(c[a]); }
          }
        }
      }
    }
  }
  const f3 = (o: number): Vec => [M.getFloat32(o, true), M.getFloat32(o + 4, true), M.getFloat32(o + 8, true)];
  const mesh = (m: typeof solid): Mesh => ({ pos: new Float32Array(m.pos), nrm: new Float32Array(m.nrm), col: new Float32Array(m.col) });
  return { ...mesh(solid), glass: mesh(see), hulls: phyHulls(pak.get(base + '.phy')), min: f3(104), max: f3(116) };
}

/** Collision hulls from a PHY file: each solid's IVP compact surface holds convex pieces (ledges, whose triangles index a
 *  shared point array; those with children only bound others). IVP is in metres, y down: Source = (x, z, -y) / 0.0254. */
function phyHulls(phy?: Uint8Array): Model['hulls'] {
  if (!phy || phy.length < 16) return [];
  const D = new DataView(phy.buffer, phy.byteOffset), out: Model['hulls'] = [];
  let o = D.getInt32(0, true);
  for (let s = 0, n = D.getInt32(8, true); s < n && o + 4 <= phy.length; s++) {
    const size = D.getInt32(o, true), d = o + 4, surf = D.getUint32(d, true) === 0x59485056 ? d + 28 : d; // 'VPHY' header
    let end = Math.min(phy.length, d + size);
    for (let L = surf + 48; L + 16 <= end;) {
      const cp = D.getInt32(L, true), flags = D.getUint32(L + 8, true), nt = D.getInt16(L + 12, true);
      if (nt <= 0) break;
      end = Math.min(end, L + cp); // the points come after the last piece
      if ((flags & 3) === 0) {
        const map = new Map<number, number>(), pts: Vec[] = [], tris: number[] = [];
        for (let t = 0; t < nt; t++) for (let e = 0; e < 3; e++) {
          const i = D.getUint32(L + 16 + 16 * t + 4 + 4 * e, true) & 0xffff;
          if (!map.has(i)) { const p = L + cp + 16 * i, f = (q: number) => D.getFloat32(p + q, true) / 0.0254; map.set(i, pts.length); pts.push([f(0), f(8), -f(4)]); }
          tris.push(map.get(i)!);
        }
        out.push({ pts, tris });
      }
      L += 16 + 16 * nt;
    }
    o = d + size;
  }
  return out;
}
