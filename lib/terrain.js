/**
 * Deterministic ground shape for the whole 12 km map. Pure functions of (x, z): every client agrees on the ground.
 * Layout: gentle core basin round the start, hill country around it, long mountain ranges, one big massif,
 * a mesa/canyon region, dry steppe in the south-east, a mountain wall round the border, and lakes with flat shores.
 * POI footprints are levelled on top of this by ground.js.
 */
export const MAP_HALF = 6000;
export const WATER_Y = 0.6;

const SEED = 1337;
function hash2(ix, iz) {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(SEED, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
const smooth = (t) => t * t * (3 - 2 * t);
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const lerp = (a, b, t) => a + (b - a) * t;
function vnoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const sx = fx * fx * (3 - 2 * fx), sz = fz * fz * (3 - 2 * fz);
  const a = hash2(ix, iz), b = hash2(ix + 1, iz), c = hash2(ix, iz + 1), d = hash2(ix + 1, iz + 1);
  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}
function fbm(x, z, oct) {
  let s = 0, a = 0.5, n = 0;
  for (let o = 0; o < oct; o++) { s += vnoise(x, z) * a; n += a; x = x * 2.01 + 19.7; z = z * 2.01 - 7.3; a *= 0.5; }
  return s / n;
}
function ridged(x, z, oct) {
  let s = 0, a = 0.5, n = 0;
  for (let o = 0; o < oct; o++) {
    const r = 1 - Math.abs(vnoise(x, z) * 2 - 1);
    s += r * r * a; n += a; x = x * 2.03 + 17.1; z = z * 2.03 - 9.7; a *= 0.5;
  }
  return s / n;
}
function distPoly(x, z, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const ax = pts[i][0], az = pts[i][1], vx = pts[i + 1][0] - ax, vz = pts[i + 1][1] - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz || 1)));
    const dx = ax + vx * t - x, dz = az + vz * t - z, d = dx * dx + dz * dz;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/** lakes: y (water level) is filled in below. Lakeside keeps the old level so its pier still fits. */
export const LAKES = [
  { name: 'Lakeside', x: -560, z: 220, rx: 230, rz: 170, depth: 6.5 },
  { name: 'Mirror Lake', x: -2650, z: 900, rx: 430, rz: 300, depth: 7 },
  { name: 'Long Water', x: 2500, z: 2250, rx: 620, rz: 260, depth: 8 },
  { name: 'Eagle Tarn', x: -2100, z: -1380, rx: 200, rz: 150, depth: 6 },
  { name: 'Cold Fork Reservoir', x: 3450, z: -2550, rx: 520, rz: 230, depth: 8 },
  { name: 'Redwater', x: 600, z: 3400, rx: 380, rz: 270, depth: 6 },
  { name: 'Mire Lake', x: -3350, z: -3300, rx: 420, rz: 320, depth: 5 },
];
export const LAKE = LAKES[0];

const RANGES = [
  { w: 850, h: 330, pts: [[-5300, -4300], [-3300, -4700], [-1200, -4500], [1200, -4800], [3200, -4400], [5300, -4800]] }, // north spine
  { w: 800, h: 300, pts: [[5000, -3200], [5200, -800], [4800, 1200], [5200, 3200], [4700, 5000]] }, // east crown
  { w: 800, h: 320, pts: [[-5000, -2300], [-4800, 200], [-5100, 2400], [-4400, 4600]] }, // west wall
  { w: 700, h: 280, pts: [[-2600, 4900], [-300, 5200], [2200, 4800], [4000, 5200]] }, // south teeth
];
const MASSIFS = [{ x: -2100, z: -2000, rx: 900, rz: 700, h: 430 }]; // Mount Aldric (observatory on top)

function rawHeight(x, z) {
  const wx = x + (fbm(x / 1100 + 11.3, z / 1100 - 7.7, 2) - 0.5) * 620;
  const wz = z + (fbm(x / 1100 - 23.9, z / 1100 + 31.1, 2) - 0.5) * 620;
  const r = Math.sqrt(x * x + z * z);
  const core = 1 - smooth(clamp01((r - 420) / 900));
  const b1 = fbm(wx / 1500 + 3.1, wz / 1500 - 5.2, 3);
  const b2 = fbm(wx / 430 + 5, wz / 430 - 9, 3);
  const b3 = fbm(x / 80, z / 80, 2);
  let h = 4 + Math.max(0, b1 - 0.28) * 48 + b2 * 18 + b3 * 3; // plains and rolling country
  h = lerp(h, 9 + (b2 - 0.5) * 9 + (b3 - 0.5) * 2, core * 0.85); // calm core basin
  const hills = smooth(clamp01((r - 450) / 500)) * (1 - smooth(clamp01((r - 1700) / 900)));
  if (hills > 0) h += hills * (fbm(wx / 300 + 8, wz / 300 - 3, 3) - 0.35) * 55; // hill country round the core
  let m = 0, hh = 0;
  for (const R of RANGES) {
    const d = distPoly(wx, wz, R.pts) / R.w, mm = Math.exp(-d * d * 1.25);
    if (mm > m) { m = mm; hh = R.h; }
  }
  for (const M of MASSIFS) {
    const dx = (wx - M.x) / M.rx, dz = (wz - M.z) / M.rz, mm = Math.exp(-(dx * dx + dz * dz) * 1.3);
    if (mm > m) { m = mm; hh = M.h; }
  }
  if (m > 0.003) {
    const crest = ridged(wx / 560 + 40, wz / 560 - 40, 4);
    const along = 0.6 + 0.8 * fbm(wx / 1800 + 70, wz / 1800 + 12, 2);
    h += m * 38 + Math.pow(m, 1.35) * hh * (0.28 + 0.72 * crest) * along + m * m * ridged(x / 140, z / 140, 3) * 26;
  }
  const mr = Math.sqrt((x + 3500) * (x + 3500) + (z - 3000) * (z - 3000)) / 1300; // mesa country, south-west
  if (mr < 1.3) {
    const mm = 1 - smooth(clamp01((mr - 0.5) / 0.8)), n = fbm(wx / 650 + 90, wz / 650 + 5, 3);
    const t1 = smooth(clamp01((n - 0.5) / 0.07)), t2 = smooth(clamp01((n - 0.6) / 0.06));
    if (h < 70) h += (70 + fbm(x / 120, z / 120, 2) * 8 - h) * t1 * mm;
    h += t2 * mm * 32;
  }
  const e = Math.max(Math.abs(x), Math.abs(z)) / MAP_HALF; // mountain wall round the border
  if (e > 0.88) h += smooth(clamp01((e - 0.88) / 0.1)) * (90 + ridged(wx / 300 + 7, wz / 300 - 2, 4) * 220);
  return h;
}

LAKES.forEach((L, i) => { L.y = i === 0 ? WATER_Y : Math.max(2.5, rawHeight(L.x, L.z) - 3); });

/** flat shelf round every lake (1.7 m above the water), bowl inside */
function carve(h, x, z) {
  for (let i = 0; i < LAKES.length; i++) {
    const L = LAKES[i], dx = (x - L.x) / L.rx, dz = (z - L.z) / L.rz, d2 = dx * dx + dz * dz;
    if (d2 > 3.1) continue;
    const d = Math.sqrt(d2), m = 1 - smooth(clamp01((d - 1.12) / 0.62));
    h += (L.y + 1.7 - h) * m;
    if (d < 1) h -= L.depth * Math.pow(1 - d2, 0.7);
  }
  return h;
}

export function naturalHeight(x, z) {
  return carve(rawHeight(x, z), x, z) + (fbm(x / 22 + 3, z / 22 - 8, 2) - 0.5) * 0.9;
}

/** the lake whose ellipse (scaled by k) contains the point, or null */
export function lakeAt(x, z, k = 1) {
  for (let i = 0; i < LAKES.length; i++) {
    const L = LAKES[i], dx = (x - L.x) / L.rx, dz = (z - L.z) / L.rz;
    if (dx * dx + dz * dz < k * k) return L;
  }
  return null;
}
/** 0 temperate .. 1 dry steppe (south-east) */
export function dryness(x, z) {
  const d = Math.sqrt((x - 3000) * (x - 3000) + (z - 3600) * (z - 3600)) / 2300;
  return clamp01(1.25 - d + (fbm(x / 900 + 5, z / 900 - 3, 2) - 0.5) * 0.5);
}
/** 0..1 inside the south-west mesa country */
export function mesaness(x, z) {
  return 1 - smooth(clamp01((Math.sqrt((x + 3500) * (x + 3500) + (z - 3000) * (z - 3000)) / 1300 - 0.45) / 0.7));
}
/** 0..1 how thick the forest is here (h = ground height there) */
export function forestDensity(x, z, h) {
  if (h > 175 || h < 2) return 0;
  const f = fbm(x / 520 + 31, z / 520 - 17, 3), moist = fbm(x / 2300 + 4, z / 2300 - 9, 2);
  let d = smooth(clamp01((f - 0.42) / 0.2)) * (0.45 + 0.7 * moist);
  d *= 1 - 0.9 * dryness(x, z);
  d *= 1 - smooth(clamp01((h - 110) / 65));
  d *= 1 - mesaness(x, z) * 0.85;
  d *= 0.35 + 0.65 * smooth(clamp01((Math.sqrt(x * x + z * z) - 150) / 500)); // keep the start area open
  return Math.min(1, d);
}

/** kept for old imports: ground with POI sites levelled (ground.js does this faster, per chunk) */
export function createTerrain(sites = []) {
  return (x, z) => {
    let h = naturalHeight(x, z);
    for (const s of sites) {
      const d = Math.hypot(x - s.x, z - s.z);
      if (d >= s.r) continue;
      const w = 1 - smooth(clamp01((d / s.r - 0.8) / 0.2));
      h += (s.h - h) * w;
    }
    return h;
  };
}
