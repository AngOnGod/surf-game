// Textures a map packs (VTF; Valve Developer Wiki, "VTF (Valve Texture Format)"), decoded to RGBA for drawing.

/** An image as RGBA bytes, rows top down. */
export interface Image { w: number; h: number; rgba: Uint8Array }

// bytes per pixel by format (0 = block compressed or not decoded here); DXT1 (13, 20), DXT3 (14), DXT5 (15) are 4x4 blocks
const BPP = [4, 4, 3, 3, 2, 1, 2, 1, 1, 3, 3, 4, 4, 0, 0, 0, 4, 2, 2, 2, 0, 2, 2, 4, 8, 8, 4];
const size = (f: number, w: number, h: number) => (f === 13 || f === 20 ? 8 : f === 14 || f === 15 ? 16 : 0) * Math.ceil(w / 4) * Math.ceil(h / 4) || BPP[f] * w * h;
// where each channel sits in a pixel of the byte formats (-1: none)
const ORDER: Record<number, [number, number, number, number]> = { 0: [0, 1, 2, 3], 1: [3, 2, 1, 0], 2: [0, 1, 2, -1], 3: [2, 1, 0, -1], 11: [1, 2, 3, 0], 12: [2, 1, 0, 3], 16: [2, 1, 0, -1] };

/** The texture's first frame at the largest mip level no bigger than `max` a side (halved after decoding when the file
 *  has no level that small); null for formats not read here. */
export function readVtf(u8: Uint8Array, max = 512): Image | null {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (u8.length < 64 || dv.getUint32(0, true) !== 0x00465456) return null; // 'VTF\0'
  const minor = dv.getUint32(8, true), W = dv.getUint16(16, true), H = dv.getUint16(18, true), flags = dv.getUint32(20, true);
  const frames = Math.max(1, dv.getUint16(24, true)), fmt = dv.getInt32(52, true), mips = Math.max(1, u8[56]), low = dv.getInt32(57, true);
  const depth = minor >= 2 ? Math.max(1, dv.getUint16(63, true)) : 1, faces = flags & 0x4000 ? 6 : 1;
  if (!(fmt in ORDER) && ![5, 6, 8, 13, 14, 15, 20].includes(fmt)) return null;
  let at = dv.getUint32(12, true) + (low >= 0 ? size(low, u8[61], u8[62]) : 0);
  if (minor >= 3) for (let i = 0, n = dv.getUint32(68, true); i < n; i++) if (dv.getUint32(80 + 8 * i, true) === 0x30) at = dv.getUint32(84 + 8 * i, true); // the high-res image resource
  let mip = 0;
  while (mip + 1 < mips && Math.max(W >> mip, H >> mip) > max) mip++;
  for (let m = mips - 1; m > mip; m--) at += size(fmt, Math.max(1, W >> m), Math.max(1, H >> m)) * frames * faces * depth; // smallest levels first
  const w = Math.max(1, W >> mip), h = Math.max(1, H >> mip);
  if (at + size(fmt, w, h) > u8.length) return null;
  let img = decode(u8.subarray(at), fmt, w, h);
  while (Math.max(img.w, img.h) > max && img.w > 1 && img.h > 1) img = half(img);
  return img;
}

function decode(s: Uint8Array, fmt: number, w: number, h: number): Image {
  const rgba = new Uint8Array(w * h * 4);
  if (fmt === 13 || fmt === 20 || fmt === 14 || fmt === 15) { // DXT: 4x4 blocks, alpha (DXT3, DXT5) before colour
    const bw = Math.ceil(w / 4), step = fmt === 14 || fmt === 15 ? 16 : 8, c = new Uint8Array(16), a = new Uint8Array(8);
    for (let b = 0; b < bw * Math.ceil(h / 4); b++) {
      const o = b * step, k = o + step - 8, c0 = s[k] | (s[k + 1] << 8), c1 = s[k + 2] | (s[k + 3] << 8), bits = (s[k + 4] | (s[k + 5] << 8) | (s[k + 6] << 16) | (s[k + 7] << 24)) >>> 0;
      for (const [i, v] of [[0, c0], [4, c1]]) { c[i] = ((v >> 11) * 255 + 15) / 31; c[i + 1] = (((v >> 5) & 63) * 255 + 31) / 63; c[i + 2] = ((v & 31) * 255 + 15) / 31; c[i + 3] = 255; }
      const four = c0 > c1 || fmt === 14 || fmt === 15; // (DXT1's other mode: 3 colours and transparent black)
      for (let q = 0; q < 3; q++) { c[8 + q] = four ? (2 * c[q] + c[4 + q]) / 3 : (c[q] + c[4 + q]) / 2; c[12 + q] = four ? (c[q] + 2 * c[4 + q]) / 3 : 0; }
      c[11] = 255; c[15] = four ? 255 : 0;
      if (fmt === 15) { // 8 alpha levels between two end points, 3-bit indices
        a[0] = s[o]; a[1] = s[o + 1];
        for (let q = 2; q < 8; q++) a[q] = a[0] > a[1] ? ((8 - q) * a[0] + (q - 1) * a[1]) / 7 : q < 6 ? ((6 - q) * a[0] + (q - 1) * a[1]) / 5 : q === 6 ? 0 : 255;
      }
      const x0 = (b % bw) * 4, y0 = Math.floor(b / bw) * 4;
      for (let p = 0; p < 16; p++) {
        const x = x0 + (p & 3), y = y0 + (p >> 2);
        if (x >= w || y >= h) continue;
        const d = (y * w + x) * 4, ci = ((bits >>> (2 * p)) & 3) * 4;
        rgba[d] = c[ci]; rgba[d + 1] = c[ci + 1]; rgba[d + 2] = c[ci + 2]; rgba[d + 3] = c[ci + 3];
        if (fmt === 14) rgba[d + 3] = ((s[o + (p >> 1)] >> ((p & 1) * 4)) & 15) * 17;
        if (fmt === 15) { const bit = 16 + 3 * p, i = o + (bit >> 3), v = (s[i] | (s[i + 1] << 8)) >> (bit & 7); rgba[d + 3] = a[v & 7]; }
      }
    }
  } else {
    const n = BPP[fmt], ord = ORDER[fmt];
    for (let p = 0; p < w * h; p++) {
      const i = p * n, d = p * 4;
      if (ord) { for (let q = 0; q < 3; q++) rgba[d + q] = s[i + ord[q]]; rgba[d + 3] = ord[3] < 0 ? 255 : s[i + ord[3]]; }
      else { const l = fmt === 8 ? 255 : s[i]; rgba[d] = rgba[d + 1] = rgba[d + 2] = l; rgba[d + 3] = fmt === 6 ? s[i + 1] : fmt === 8 ? s[i] : 255; } // I8, IA88, A8
    }
  }
  return { w, h, rgba };
}

const half = ({ w, h, rgba }: Image): Image => { // a 2x2 box filter
  const W = w >> 1, H = h >> 1, out = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) for (let q = 0; q < 4; q++) {
    const i = ((2 * y) * w + 2 * x) * 4 + q;
    out[(y * W + x) * 4 + q] = (rgba[i] + rgba[i + 4] + rgba[i + w * 4] + rgba[i + w * 4 + 4] + 2) >> 2;
  }
  return { w: W, h: H, rgba: out };
};
