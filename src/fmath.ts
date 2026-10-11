// sin, cos, asin, atan2 from fdlibm 5.3, in plain IEEE arithmetic. JS engines may round Math.sin & co. differently
// (Chrome and node already disagree in the last bit), and the movement code is chaotic enough that one ulp grows into
// a different run within a minute; with these, the autopilot replays the same run everywhere the tests ran it.
const buf = new Float64Array(1), w = new Int32Array(buf.buffer);
const hi = (x: number) => { buf[0] = x; return w[1]; }, lo = (x: number) => { buf[0] = x; return w[0]; };
const words = (h: number, l: number) => { w[1] = h; w[0] = l; return buf[0]; };

const S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04,
  S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;
const C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03, C3 = 2.48015872894767294178e-05,
  C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;
function kSin(x: number, y: number) { // sin(x + y), |x| <= pi/4
  if ((hi(x) & 0x7fffffff) < 0x3e400000 && (x | 0) === 0) return x;
  const z = x * x, v = z * x, r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  return y === 0 ? x + v * (S1 + z * r) : x - ((z * (0.5 * y - v * r) - y) - v * S1);
}
function kCos(x: number, y: number) { // cos(x + y), |x| <= pi/4
  const ix = hi(x) & 0x7fffffff;
  if (ix < 0x3e400000 && (x | 0) === 0) return 1;
  const z = x * x, r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  if (ix < 0x3fd33333) return 1 - (0.5 * z - (z * r - x * y));
  const qx = ix > 0x3fe90000 ? 0.28125 : words(ix - 0x00200000, 0);
  return (1 - qx) - ((0.5 * z - qx) - (z * r - x * y));
}
const PIO2 = [1.57079632673412561417e+00, 6.07710050650619224932e-11, 6.07710050630396597660e-11, 2.02226624879595063154e-21,
  2.02226624871116645580e-21, 8.47842766036889956997e-32];
/** x = n pi/2 + y0 + y1 (|x| < 2^19 pi/2: every angle the game makes; beyond that the engine's own result) */
function rem(x: number): [number, number, number] | null {
  const hx = hi(x), ix = hx & 0x7fffffff;
  if (ix > 0x413921fb) return null;
  const t = Math.abs(x), n = (t * 6.36619772367581382433e-01 + 0.5) | 0;
  let r = t - n * PIO2[0], ww = n * PIO2[1], y0 = r - ww;
  const j = ix >> 20;
  for (let k = 2, lim = 16; k < 6 && j - ((hi(y0) >> 20) & 0x7ff) > lim; k += 2, lim = 49) { // a second / third pass when cancellation ate the bits
    const tt = r; ww = n * PIO2[k]; r = tt - ww; ww = n * PIO2[k + 1] - ((tt - r) - ww); y0 = r - ww;
  }
  const y1 = (r - y0) - ww;
  return hx < 0 ? [-n, -y0, -y1] : [n, y0, y1];
}
const trig = (x: number, cosine: boolean) => {
  if ((hi(x) & 0x7fffffff) <= 0x3fe921fb) return cosine ? kCos(x, 0) : kSin(x, 0);
  const r = rem(x);
  if (!r) return cosine ? Math.cos(x) : Math.sin(x);
  const [n, y0, y1] = r, q = (n + (cosine ? 1 : 0)) & 3;
  return q === 0 ? kSin(y0, y1) : q === 1 ? kCos(y0, y1) : q === 2 ? -kSin(y0, y1) : -kCos(y0, y1);
};
export const sin = (x: number) => trig(x, false);
export const cos = (x: number) => trig(x, true);

const pq = (t: number) => (t * (1.66666666666666657415e-01 + t * (-3.25565818622400915405e-01 + t * (2.01212532134862925881e-01 +
  t * (-4.00555345006794114027e-02 + t * (7.91534994289814532176e-04 + t * 3.47933107596021167570e-05)))))) /
  (1 + t * (-2.40339491173441421878e+00 + t * (2.02094576023350569471e+00 + t * (-6.88283971605453293030e-01 + t * 7.70381505559019352791e-02))));
const PIO2_HI = 1.57079632679489655800e+00, PIO2_LO = 6.12323399573676603587e-17, PIO4_HI = 7.85398163397448278999e-01;
export function asin(x: number) {
  const hx = hi(x), ix = hx & 0x7fffffff;
  if (ix >= 0x3ff00000) return ((ix - 0x3ff00000) | lo(x)) === 0 ? x * PIO2_HI + x * PIO2_LO : NaN;
  if (ix < 0x3fe00000) { // |x| < 0.5
    if (ix < 0x3e400000) return x;
    const t = x * x;
    return x + x * pq(t);
  }
  let t = (1 - Math.abs(x)) * 0.5;
  const r = pq(t), s = Math.sqrt(t);
  if (ix >= 0x3fef3333) t = PIO2_HI - (2 * (s + s * r) - PIO2_LO);
  else {
    buf[0] = s; w[0] = 0; const f = buf[0], c = (t - f * f) / (s + f);
    t = PIO4_HI - ((2 * s * r - (PIO2_LO - 2 * c)) - (PIO4_HI - 2 * f));
  }
  return hx > 0 ? t : -t;
}

const ATANHI = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
const ATANLO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];

function atan(x: number) { // finite x
  const hx = hi(x), ix = hx & 0x7fffffff;
  if (ix >= 0x44100000) return hx > 0 ? ATANHI[3] + ATANLO[3] : -ATANHI[3] - ATANLO[3];
  let id = -1;
  if (ix < 0x3fdc0000) { if (ix < 0x3e400000) return x; }
  else {
    x = Math.abs(x);
    if (ix < 0x3ff30000) { if (ix < 0x3fe60000) { id = 0; x = (2 * x - 1) / (2 + x); } else { id = 1; x = (x - 1) / (x + 1); } }
    else if (ix < 0x40038000) { id = 2; x = (x - 1.5) / (1 + 1.5 * x); } else { id = 3; x = -1 / x; }
  }
  const z = x * x, ww = z * z, s = z * (3.33333333333329318027e-01 + ww * (1.42857142725034663711e-01 + ww * (9.09088713343650656196e-02 +
    ww * (6.66107313738753120669e-02 + ww * (4.97687799461593236017e-02 + ww * 1.62858201153657823623e-02))))) +
    ww * (-1.99999999998764832476e-01 + ww * (-1.11111104054623557880e-01 + ww * (-7.69187620504482999495e-02 +
    ww * (-5.83357013379057348645e-02 + ww * -3.65315727442169155270e-02))));
  if (id < 0) return x - x * s;
  const r = ATANHI[id] - ((x * s - ATANLO[id]) - x);
  return hx < 0 ? -r : r;
}
const PI = 3.1415926535897931160e+00, PI_LO = 1.2246467991473531772e-16;
export function atan2(y: number, x: number) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return Math.atan2(y, x); // (never in the game)
  if (x === 1) return atan(y);
  const m = (y < 0 || Object.is(y, -0) ? 1 : 0) | (x < 0 || Object.is(x, -0) ? 2 : 0);
  if (y === 0) return m === 2 ? PI : m === 3 ? -PI : y;
  if (x === 0) return y < 0 ? -PIO2_HI : PIO2_HI;
  const k = ((hi(y) & 0x7fffffff) - (hi(x) & 0x7fffffff)) >> 20;
  const z = k > 60 ? PIO2_HI + 0.5 * PI_LO : x < 0 && k < -60 ? 0 : atan(Math.abs(y / x));
  return m === 0 ? z : m === 1 ? -z : m === 2 ? PI - (z - PI_LO) : (z - PI_LO) - PI;
}

// Math.hypot as V8 computes it (scale by the largest, Kahan-sum the squares, sqrt): engines may round hypot differently,
// so this gives Chrome's (and node's) results in every browser. 2- and 3-argument forms, for speed.
export function hypot2(x: number, y: number) {
  const a = Math.abs(x), b = Math.abs(y);
  if (a === Infinity || b === Infinity) return Infinity;
  if (a !== a || b !== b) return NaN;
  const m = a > b ? a : b;
  if (m === 0) return 0;
  const p = a / m, q = b / m, s0 = p * p, s1 = q * q - ((s0 - 0) - s0);
  return Math.sqrt(s0 + s1) * m;
}
export function hypot3(x: number, y: number, z: number) {
  const a = Math.abs(x), b = Math.abs(y), c = Math.abs(z);
  if (a === Infinity || b === Infinity || c === Infinity) return Infinity;
  if (a !== a || b !== b || c !== c) return NaN;
  const m = Math.max(a, b, c);
  if (m === 0) return 0;
  let sum = 0, comp = 0;
  for (const v of [a / m, b / m, c / m]) { const t = v * v - comp, pre = sum + t; comp = (pre - sum) - t; sum = pre; }
  return Math.sqrt(sum) * m;
}
