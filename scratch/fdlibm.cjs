// fdlibm 5.3 ports (sin, cos, asin, atan, atan2) for checking against an engine's Math.*
const buf = new Float64Array(1), w = new Int32Array(buf.buffer);
const hi = x => { buf[0] = x; return w[1]; }, lo = x => { buf[0] = x; return w[0]; };
const fromWords = (h, l) => { w[1] = h; w[0] = l; return buf[0]; };
const withLo = (x, l) => { buf[0] = x; w[0] = l; return buf[0]; };

const S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04,
  S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;
function kSin(x, y, iy) {
  const ix = hi(x) & 0x7fffffff;
  if (ix < 0x3e400000 && (x | 0) === 0) return x;
  const z = x * x, v = z * x, r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return iy === 0 ? x + v * (S1 + z * r) : x - ((z * (0.5 * y - v * r) - y) - v * S1);
}
const C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03, C3 = 2.48015872894767294178e-05,
  C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;
function kCos(x, y) {
  const ix = hi(x) & 0x7fffffff;
  if (ix < 0x3e400000 && (x | 0) === 0) return 1;
  const z = x * x, r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  if (ix < 0x3fd33333) return 1 - (0.5 * z - (z * r - x * y));
  const qx = ix > 0x3fe90000 ? 0.28125 : fromWords(ix - 0x00200000, 0);
  const hz = 0.5 * z - qx, a = 1 - qx;
  return a - (hz - (z * r - x * y));
}
// argument reduction for |x| < 2^20 * pi/2 (medium path of __ieee754_rem_pio2); returns n, y0, y1
const invpio2 = 6.36619772367581382433e-01, pio2_1 = 1.57079632673412561417e+00, pio2_1t = 6.07710050650619224932e-11,
  pio2_2 = 6.07710050630396597660e-11, pio2_2t = 2.02226624879595063154e-21, pio2_3 = 2.02226624871116645580e-21,
  pio2_3t = 8.47842766036889956997e-32;
const npio2_hw = [0x3FF921FB, 0x400921FB, 0x4012D97C, 0x401921FB, 0x401F6A7A, 0x4022D97C, 0x4025FDBB, 0x402921FB,
  0x402C463A, 0x402F6A7A, 0x4031475C, 0x4032D97C, 0x40346B9C, 0x4035FDBB, 0x40378FDB, 0x403921FB, 0x403AB41B,
  0x403C463A, 0x403DD85A, 0x403F6A7A, 0x40407E4C, 0x4041475C, 0x4042106C, 0x4042D97C, 0x4043A28C, 0x40446B9C,
  0x404534AC, 0x4045FDBB, 0x4046C6CB, 0x40478FDB, 0x404858EB, 0x404921FB];
function remPio2(x) {
  const hx = hi(x), ix = hx & 0x7fffffff;
  if (ix <= 0x3fe921fb) return [0, x, 0];
  if (ix < 0x4002d97c) { // |x| < 3pi/4
    if (hx > 0) {
      let z = x - pio2_1;
      if (ix !== 0x3ff921fb) { const y0 = z - pio2_1t; return [1, y0, (z - y0) - pio2_1t]; }
      z -= pio2_2; const y0 = z - pio2_2t; return [1, y0, (z - y0) - pio2_2t];
    }
    let z = x + pio2_1;
    if (ix !== 0x3ff921fb) { const y0 = z + pio2_1t; return [-1, y0, (z - y0) + pio2_1t]; }
    z += pio2_2; const y0 = z + pio2_2t; return [-1, y0, (z - y0) + pio2_2t];
  }
  if (ix <= 0x413921fb) { // |x| ~<= 2^19 (pi/2)
    const t = Math.abs(x), n = (t * invpio2 + 0.5) | 0, fn = n;
    let r = t - fn * pio2_1, ww = fn * pio2_1t, y0;
    if (n < 32 && ix !== npio2_hw[n - 1]) y0 = r - ww;
    else {
      const j = ix >> 20; y0 = r - ww;
      let i = j - ((hi(y0) >> 20) & 0x7ff);
      if (i > 16) {
        let tt = r; ww = fn * pio2_2; r = tt - ww; ww = fn * pio2_2t - ((tt - r) - ww); y0 = r - ww;
        i = j - ((hi(y0) >> 20) & 0x7ff);
        if (i > 49) { tt = r; ww = fn * pio2_3; r = tt - ww; ww = fn * pio2_3t - ((tt - r) - ww); y0 = r - ww; }
      }
    }
    const y1 = (r - y0) - ww;
    return hx < 0 ? [-n, -y0, -y1] : [n, y0, y1];
  }
  return null; // huge arguments: not needed here
}
function sin(x) {
  const ix = hi(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kSin(x, 0, 0);
  if (ix >= 0x7ff00000) return NaN;
  const r = remPio2(x); if (!r) return Math.sin(x);
  const [n, y0, y1] = r;
  switch (n & 3) { case 0: return kSin(y0, y1, 1); case 1: return kCos(y0, y1); case 2: return -kSin(y0, y1, 1); default: return -kCos(y0, y1); }
}
function cos(x) {
  const ix = hi(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kCos(x, 0);
  if (ix >= 0x7ff00000) return NaN;
  const r = remPio2(x); if (!r) return Math.cos(x);
  const [n, y0, y1] = r;
  switch (n & 3) { case 0: return kCos(y0, y1); case 1: return -kSin(y0, y1, 1); case 2: return -kCos(y0, y1); default: return kSin(y0, y1, 1); }
}
// asin
const pio2_hi = 1.57079632679489655800e+00, pio2_lo = 6.12323399573676603587e-17, pio4_hi = 7.85398163397448278999e-01,
  pS0 = 1.66666666666666657415e-01, pS1 = -3.25565818622400915405e-01, pS2 = 2.01212532134862925881e-01,
  pS3 = -4.00555345006794114027e-02, pS4 = 7.91534994289814532176e-04, pS5 = 3.47933107596021167570e-05,
  qS1 = -2.40339491173441421878e+00, qS2 = 2.02094576023350569471e+00, qS3 = -6.88283971605453293030e-01,
  qS4 = 7.70381505559019352791e-02;
function asin(x) {
  const hx = hi(x), ix = hx & 0x7fffffff;
  if (ix >= 0x3ff00000) {
    if (((ix - 0x3ff00000) | lo(x)) === 0) return x * pio2_hi + x * pio2_lo;
    return NaN;
  }
  if (ix < 0x3fe00000) {
    if (ix < 0x3e400000) { if (1e300 + x > 1) return x; }
    const t = x * x, p = t * (pS0 + t * (pS1 + t * (pS2 + t * (pS3 + t * (pS4 + t * pS5))))), q = 1 + t * (qS1 + t * (qS2 + t * (qS3 + t * qS4)));
    return x + x * (p / q);
  }
  let ww = 1 - Math.abs(x), t = ww * 0.5;
  const p = t * (pS0 + t * (pS1 + t * (pS2 + t * (pS3 + t * (pS4 + t * pS5))))), q = 1 + t * (qS1 + t * (qS2 + t * (qS3 + t * qS4)));
  const s = Math.sqrt(t);
  if (ix >= 0x3fef3333) { ww = p / q; t = pio2_hi - (2 * (s + s * ww) - pio2_lo); }
  else {
    ww = withLo(s, 0); const c = (t - ww * ww) / (s + ww), r = p / q;
    const pp = 2 * s * r - (pio2_lo - 2 * c), qq = pio4_hi - 2 * ww;
    t = pio4_hi - (pp - qq);
  }
  return hx > 0 ? t : -t;
}
// atan, atan2
const atanhi = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
const atanlo = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const aT = [3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01, -1.11111104054623557880e-01,
  9.09088713343650656196e-02, -7.69187620504482999495e-02, 6.66107313738753120669e-02, -5.83357013379057348645e-02,
  4.97687799461593236017e-02, -3.65315727442169155270e-02, 1.62858201153657823623e-02];
function atan(x) {
  const hx = hi(x), ix = hx & 0x7fffffff;
  let id;
  if (ix >= 0x44100000) {
    if (ix > 0x7ff00000 || (ix === 0x7ff00000 && lo(x) !== 0)) return x + x;
    return hx > 0 ? atanhi[3] + atanlo[3] : -atanhi[3] - atanlo[3];
  }
  if (ix < 0x3fdc0000) {
    if (ix < 0x3e400000) { if (1e300 + x > 1) return x; }
    id = -1;
  } else {
    x = Math.abs(x);
    if (ix < 0x3ff30000) {
      if (ix < 0x3fe60000) { id = 0; x = (2 * x - 1) / (2 + x); } else { id = 1; x = (x - 1) / (x + 1); }
    } else if (ix < 0x40038000) { id = 2; x = (x - 1.5) / (1 + 1.5 * x); } else { id = 3; x = -1 / x; }
  }
  const z = x * x, ww = z * z;
  const s1 = z * (aT[0] + ww * (aT[2] + ww * (aT[4] + ww * (aT[6] + ww * (aT[8] + ww * aT[10])))));
  const s2 = ww * (aT[1] + ww * (aT[3] + ww * (aT[5] + ww * (aT[7] + ww * aT[9]))));
  if (id < 0) return x - x * (s1 + s2);
  const zz = atanhi[id] - ((x * (s1 + s2) - atanlo[id]) - x);
  return hx < 0 ? -zz : zz;
}
const pi_o_4 = 7.8539816339744827900e-01, pi_o_2 = 1.5707963267948965580e+00, pi = 3.1415926535897931160e+00, pi_lo = 1.2246467991473531772e-16;
function atan2(y, x) {
  const hx = hi(x), ix = hx & 0x7fffffff, lx = lo(x), hy = hi(y), iy = hy & 0x7fffffff, ly = lo(y);
  if ((ix | ((lx | -lx) >>> 31)) > 0x7ff00000 || (iy | ((ly | -ly) >>> 31)) > 0x7ff00000) return x + y;
  if (((hx - 0x3ff00000) | lx) === 0) return atan(y);
  const m = ((hy >> 31) & 1) | ((hx >> 30) & 2);
  if ((iy | ly) === 0) { switch (m) { case 0: case 1: return y; case 2: return pi + 1e-300; default: return -pi - 1e-300; } }
  if ((ix | lx) === 0) return hy < 0 ? -pi_o_2 - 1e-300 : pi_o_2 + 1e-300;
  if (ix === 0x7ff00000) {
    if (iy === 0x7ff00000) { switch (m) { case 0: return pi_o_4 + 1e-300; case 1: return -pi_o_4 - 1e-300; case 2: return 3 * pi_o_4 + 1e-300; default: return -3 * pi_o_4 - 1e-300; } }
    switch (m) { case 0: return 0; case 1: return -0; case 2: return pi + 1e-300; default: return -pi - 1e-300; }
  }
  if (iy === 0x7ff00000) return hy < 0 ? -pi_o_2 - 1e-300 : pi_o_2 + 1e-300;
  const k = (iy - ix) >> 20;
  let z;
  if (k > 60) z = pi_o_2 + 0.5 * pi_lo;
  else if (hx < 0 && k < -60) z = 0;
  else z = atan(Math.abs(y / x));
  switch (m) {
    case 0: return z;
    case 1: return -z;
    case 2: return pi - (z - pi_lo);
    default: return (z - pi_lo) - pi;
  }
}
module.exports = { sin, cos, asin, atan2 };
