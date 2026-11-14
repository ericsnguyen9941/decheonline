/**
 * Deterministic double-precision `atan2`, `sin` and `cos` for the sim (docs/spec/movement.md §14). Built only from
 * `+ - * /`, which IEEE 754 rounds the same on every engine, so every peer gets the same bits. The algorithms follow
 * fdlibm (argument reduction, then a fixed polynomial); results are within one ulp of the engine's own `Math.*`
 * (trig.test.ts). The original's x87 results are assumed correctly rounded (movement.md §15), so a one-ulp double
 * error can only matter where it flips a float32 rounding.
 */

const f64 = new Float64Array(1);
const words = new Uint32Array(f64.buffer);
/** Index of the 32-bit word holding the sign and exponent of a float64 on this machine's byte order. */
const HI = new Uint8Array(new Float64Array([-0]).buffer)[7] === 0x80 ? 1 : 0;

function highWord(x: number): number {
  f64[0] = x;
  return words[HI]! | 0;
}

/** `x` with its low 32 bits cleared. */
function withHighWord(hi: number): number {
  words[HI] = hi >>> 0;
  words[1 - HI] = 0;
  return f64[0]!;
}

const ATAN_HI = [4.63647609000806093515e-1, 7.85398163397448278999e-1, 9.82793723247329054082e-1, 1.5707963267948965580];
const ATAN_LO = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
const AT = [
  3.33333333333329318027e-1, -1.99999999998764832476e-1, 1.42857142725034663711e-1, -1.1111110405462355788e-1,
  9.09088713343650656196e-2, -7.69187620504482999495e-2, 6.66107313738753120669e-2, -5.83357013379057348645e-2,
  4.97687799461593236017e-2, -3.6531572744216915527e-2, 1.62858201153657823623e-2,
] as const;

export function atan(x: number): number {
  const hx = highWord(x);
  const ix = hx & 0x7fffffff;
  if (ix >= 0x44100000) {
    if (x !== x) return x;
    return hx > 0 ? ATAN_HI[3]! + ATAN_LO[3]! : -ATAN_HI[3]! - ATAN_LO[3]!;
  }
  let id: number;
  if (ix < 0x3fdc0000) {
    if (ix < 0x3e200000) return x;
    id = -1;
  } else {
    x = Math.abs(x);
    if (ix < 0x3ff30000) {
      if (ix < 0x3fe60000) {
        id = 0;
        x = (2 * x - 1) / (2 + x);
      } else {
        id = 1;
        x = (x - 1) / (x + 1);
      }
    } else if (ix < 0x40038000) {
      id = 2;
      x = (x - 1.5) / (1 + 1.5 * x);
    } else {
      id = 3;
      x = -1 / x;
    }
  }
  const z = x * x;
  const w = z * z;
  const s1 = z * (AT[0] + w * (AT[2] + w * (AT[4] + w * (AT[6] + w * (AT[8] + w * AT[10])))));
  const s2 = w * (AT[1] + w * (AT[3] + w * (AT[5] + w * (AT[7] + w * AT[9]))));
  if (id < 0) return x - x * (s1 + s2);
  const r = ATAN_HI[id]! - (x * (s1 + s2) - ATAN_LO[id]! - x);
  return hx < 0 ? -r : r;
}

const PI = 3.141592653589793116;
const PI_LO = 1.2246467991473532e-16;
const PI_2 = 1.5707963267948965580;

export function atan2(y: number, x: number): number {
  if (x !== x || y !== y) return x + y;
  if (x === 1) return atan(y);
  const hy = highWord(y);
  const hx = highWord(x);
  const m = ((hy >>> 31) & 1) | ((hx >>> 30) & 2);
  if (y === 0) {
    if (m <= 1) return y;
    return m === 2 ? PI : -PI;
  }
  if (x === 0) return hy < 0 ? -PI_2 : PI_2;
  if (!Number.isFinite(x)) {
    if (!Number.isFinite(y)) return [PI / 4, -PI / 4, (3 * PI) / 4, (-3 * PI) / 4][m]!;
    return [0, -0, PI, -PI][m]!;
  }
  if (!Number.isFinite(y)) return hy < 0 ? -PI_2 : PI_2;
  const k = (((hy >> 20) & 0x7ff) - ((hx >> 20) & 0x7ff)) | 0;
  let z: number;
  if (k > 60) z = PI_2 + 0.5 * PI_LO;
  else if (hx < 0 && k < -60) z = 0;
  else z = atan(Math.abs(y / x));
  switch (m) {
    case 0:
      return z;
    case 1:
      return -z;
    case 2:
      return PI - (z - PI_LO);
    default:
      return z - PI_LO - PI;
  }
}

const S1 = -1.66666666666666324348e-1;
const S2 = 8.33333333332248946124e-3;
const S3 = -1.98412698298579493134e-4;
const S4 = 2.75573137070700676789e-6;
const S5 = -2.50507602534068634195e-8;
const S6 = 1.58969099521155010221e-10;

/** sin(x + y) for |x| <= pi/4, y the tail of x; `hasTail` false means y is 0. */
function kernelSin(x: number, y: number, hasTail: boolean): number {
  const ix = highWord(x) & 0x7fffffff;
  if (ix < 0x3e400000 && Math.trunc(x) === 0) return x;
  const z = x * x;
  const v = z * x;
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)));
  if (!hasTail) return x + v * (S1 + z * r);
  return x - (z * (0.5 * y - v * r) - y - v * S1);
}

const C1 = 4.16666666666666019037e-2;
const C2 = -1.38888888888741095749e-3;
const C3 = 2.48015872894767294178e-5;
const C4 = -2.75573143513906633035e-7;
const C5 = 2.08757232129817482790e-9;
const C6 = -1.13596475577881948265e-11;

/** cos(x + y) for |x| <= pi/4. */
function kernelCos(x: number, y: number): number {
  const ix = highWord(x) & 0x7fffffff;
  if (ix < 0x3e400000 && Math.trunc(x) === 0) return 1;
  const z = x * x;
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
  if (ix < 0x3fd33333) return 1 - (0.5 * z - (z * r - x * y));
  const qx = ix > 0x3fe90000 ? 0.28125 : withHighWord(ix - 0x00200000);
  const hz = 0.5 * z - qx;
  const a = 1 - qx;
  return a - (hz - (z * r - x * y));
}

const INV_PIO2 = 6.36619772367581382433e-1;
const PIO2_1 = 1.57079632673412561417;
const PIO2_1T = 6.07710050650619224932e-11;
const PIO2_2 = 6.07710050630396597660e-11;
const PIO2_2T = 2.02226624879595063154e-21;
const PIO2_3 = 2.02226624871116645580e-21;
const PIO2_3T = 8.47842766036889956997e-32;

/** Reduced argument: x = n * pi/2 + (y0 + y1), |y0 + y1| <= pi/4. */
const reduced = [0, 0];

/** Argument reduction for pi/4 < |x| < 2^19 * pi/2 (fdlibm's medium path); returns n, fills `reduced`. */
function remPio2(x: number): number {
  const hx = highWord(x);
  const ix = hx & 0x7fffffff;
  if (ix < 0x4002d97c) {
    // |x| < 3pi/4: n = +-1.
    const sign = hx > 0 ? 1 : -1;
    let z = x - sign * PIO2_1;
    let tail = PIO2_1T;
    if (ix === 0x3ff921fb) {
      // x is close to pi/2: use 33 more bits of pi/2.
      z -= sign * PIO2_2;
      tail = PIO2_2T;
    }
    reduced[0] = z - sign * tail;
    reduced[1] = z - reduced[0] - sign * tail;
    return sign;
  }
  if (ix > 0x413921fb) throw new RangeError(`trig argument out of range: ${x}`);
  const t = Math.abs(x);
  const n = Math.trunc(t * INV_PIO2 + 0.5);
  const fn = n;
  let r = t - fn * PIO2_1;
  let w = fn * PIO2_1T;
  const j = ix >> 20;
  let y0 = r - w;
  if (j - ((highWord(y0) >> 20) & 0x7ff) > 16) {
    // Cancellation: second iteration with 118 bits of pi/2.
    let tt = r;
    w = fn * PIO2_2;
    r = tt - w;
    w = fn * PIO2_2T - (tt - r - w);
    y0 = r - w;
    if (j - ((highWord(y0) >> 20) & 0x7ff) > 49) {
      // Third iteration, 151 bits.
      tt = r;
      w = fn * PIO2_3;
      r = tt - w;
      w = fn * PIO2_3T - (tt - r - w);
      y0 = r - w;
    }
  }
  const y1 = r - y0 - w;
  if (hx < 0) {
    reduced[0] = -y0;
    reduced[1] = -y1;
    return -n;
  }
  reduced[0] = y0;
  reduced[1] = y1;
  return n;
}

export function sin(x: number): number {
  const ix = highWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kernelSin(x, 0, false);
  if (ix >= 0x7ff00000) return NaN;
  const n = remPio2(x);
  const [y0, y1] = reduced as [number, number];
  switch (n & 3) {
    case 0:
      return kernelSin(y0, y1, true);
    case 1:
      return kernelCos(y0, y1);
    case 2:
      return -kernelSin(y0, y1, true);
    default:
      return -kernelCos(y0, y1);
  }
}

export function cos(x: number): number {
  const ix = highWord(x) & 0x7fffffff;
  if (ix <= 0x3fe921fb) return kernelCos(x, 0);
  if (ix >= 0x7ff00000) return NaN;
  const n = remPio2(x);
  const [y0, y1] = reduced as [number, number];
  switch (n & 3) {
    case 0:
      return kernelCos(y0, y1);
    case 1:
      return -kernelSin(y0, y1, true);
    case 2:
      return -kernelCos(y0, y1);
    default:
      return kernelSin(y0, y1, true);
  }
}
