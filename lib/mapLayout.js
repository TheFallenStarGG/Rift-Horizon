/**
 * Where everything is. Deterministic. 25 major POIs (14 original ones kept in place + 11 new ones across the big map),
 * roads routed around lakes and steep ground, and ~300 minor POIs: roadside services, lake-side docks, and
 * terrain-matched ones (mines up high, farms on flat ground, sawmills in forests...).
 * POIS holds every POI. NOTE: POIS.forEach is deliberately limited to the always-built "persist" POIs, because
 * vehicles.js spawns a vehicle per POI via POIS.forEach. Everything else iterates POIS with for...of / index.
 */
import { makeRng } from './rng.js';
import { MAP_HALF, LAKES, LAKE, naturalHeight, lakeAt, dryness, mesaness, forestDensity } from './terrain.js';

export const ARENA = { x: 420, z: 430, half: 32 };

const LH = LAKES[2];
const MAJOR = [
  { name: 'Crossroads', type: 'plaza', x: 0, z: 0, r: 60 },
  { name: 'Port Haven', type: 'town', x: -120, z: -180, r: 150 },
  { name: 'Iron Works', type: 'industrial', x: 300, z: -100, r: 110 },
  { name: 'Fort Keller', type: 'military', x: -300, z: 400, r: 80 },
  { name: 'Hill Fort', type: 'hillfort', x: 560, z: -330, r: 90 },
  { name: 'Lakeside', type: 'lake', x: LAKE.x + LAKE.rx + 40, z: LAKE.z, r: 100 },
  { name: 'Green Acres', type: 'farm', x: -400, z: -420, r: 110 },
  { name: 'Standing Stones', type: 'ruins', x: 100, z: 560, r: 80 },
  { name: 'Sky Tower', type: 'tower', x: -700, z: -450, r: 40 },
  { name: 'Granite Quarry', type: 'quarry', x: 760, z: 80, r: 110 },
  { name: 'The Pit', type: 'arena', x: ARENA.x, z: ARENA.z, r: 55 },
  { name: 'Mercy Airfield', type: 'airfield', x: 40, z: -700, r: 120 },
  { name: 'Summit Lodge', type: 'lodge', x: -740, z: 640, r: 50 },
  { name: 'Ridgeback Camp', type: 'camp', x: 640, z: 560, r: 50 },
  // ---- the big map ----
  { name: 'Highline Power Station', type: 'power', x: 3150, z: -2050, r: 140 },
  { name: 'Black Ridge Mine', type: 'mine', x: -4150, z: -1150, r: 120 },
  { name: 'Dry Gulch Refinery', type: 'refinery', x: 3400, z: 3750, r: 150 },
  { name: 'Stonewall Penitentiary', type: 'prison', x: -1500, z: 3300, r: 120 },
  { name: 'St. Aldric Medical Center', type: 'hospital', x: 1500, z: 900, r: 110 },
  { name: 'Riverside Stadium', type: 'stadium', x: -1800, z: -700, r: 110 },
  { name: 'Whitecap Wind Farm', type: 'windfarm', x: 1700, z: -3400, r: 260, flat: 45 },
  { name: 'Blue Harbour', type: 'harbor', x: LH.x - LH.rx - 40, z: LH.z, r: 130, flat: 70, lake: 2 },
  { name: 'Junction Yard', type: 'railyard', x: -3000, z: 1450, r: 150 },
  { name: 'Eagle Peak Observatory', type: 'observatory', x: -2100, z: -2000, r: 70 },
  { name: 'Dustwater', type: 'ghost', x: 3700, z: 600, r: 120 },
];

const POIS_ALL = MAJOR.map((m, i) => ({ id: 'M' + i, tier: 'major', persist: true, ...m }));

// ---------- road routing: A* over an 80 m grid, steep ground and lakes cost a lot ----------
const GN = 150, GC = (MAP_HALF * 2) / GN, NP = GN + 1;
const GHT = new Float32Array(NP * NP), GBAD = new Uint8Array(NP * NP);
for (let j = 0; j < NP; j++) for (let i = 0; i < NP; i++) {
  const x = -MAP_HALF + i * GC, z = -MAP_HALF + j * GC, k = j * NP + i;
  GHT[k] = naturalHeight(x, z);
  GBAD[k] = lakeAt(x, z, 1.3) || Math.abs(x) > 5350 || Math.abs(z) > 5350 ? 1 : 0;
}
const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const gi = (v) => Math.max(0, Math.min(GN, Math.round((v + MAP_HALF) / GC)));

function route(ax, az, bx, bz) {
  const s = gi(az) * NP + gi(ax), t = gi(bz) * NP + gi(bx), tx = t % NP, tz = (t / NP) | 0;
  const g = new Float32Array(NP * NP).fill(Infinity), from = new Int32Array(NP * NP).fill(-1), done = new Uint8Array(NP * NP);
  const hf = [], hk = [];
  const push = (f, k) => {
    let i = hf.length; hf.push(f); hk.push(k);
    while (i > 0) { const p = (i - 1) >> 1; if (hf[p] <= hf[i]) break; [hf[p], hf[i]] = [hf[i], hf[p]]; [hk[p], hk[i]] = [hk[i], hk[p]]; i = p; }
  };
  const pop = () => {
    const top = hk[0], lf = hf.pop(), lk = hk.pop();
    if (hf.length) {
      hf[0] = lf; hk[0] = lk;
      for (let i = 0; ;) {
        const l = 2 * i + 1, r = l + 1; let m = i;
        if (l < hf.length && hf[l] < hf[m]) m = l;
        if (r < hf.length && hf[r] < hf[m]) m = r;
        if (m === i) break;
        [hf[m], hf[i]] = [hf[i], hf[m]]; [hk[m], hk[i]] = [hk[i], hk[m]]; i = m;
      }
    }
    return top;
  };
  g[s] = 0; push(0, s);
  while (hf.length) {
    const k = pop();
    if (done[k]) continue;
    done[k] = 1;
    if (k === t) break;
    const ki = k % NP, kj = (k / NP) | 0;
    for (const [dx, dz] of NB) {
      const ni = ki + dx, nj = kj + dz;
      if (ni < 0 || nj < 0 || ni > GN || nj > GN) continue;
      const n = nj * NP + ni;
      if (done[n] || (GBAD[n] && n !== t)) continue;
      const d = dx && dz ? GC * 1.414 : GC, slope = Math.abs(GHT[n] - GHT[k]) / d;
      const c = g[k] + d * (1 + 40 * Math.pow(Math.max(0, slope - 0.04), 1.2) + (GHT[n] > 260 ? 3 : 0));
      if (c < g[n]) { g[n] = c; from[n] = k; push(c + Math.hypot(ni - tx, nj - tz) * GC * 0.9, n); }
    }
  }
  const pts = [[bx, bz]];
  for (let k = from[t]; k >= 0 && k !== s; k = from[k]) pts.push([-MAP_HALF + (k % NP) * GC, -MAP_HALF + ((k / NP) | 0) * GC]);
  pts.push([ax, az]);
  return pts.reverse();
}
const chaikin = (p) => {
  const o = [p[0]];
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[i], b = p[i + 1];
    o.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
  }
  o.push(p[p.length - 1]);
  return o;
};
function resample(p, step) {
  const out = [p[0]]; let need = step;
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[i], b = p[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); let pos = 0;
    while (L - pos >= need) { pos += need; out.push([a[0] + ((b[0] - a[0]) * pos) / L, a[1] + ((b[1] - a[1]) * pos) / L]); need = step; }
    need -= L - pos;
  }
  const last = p[p.length - 1], q = out[out.length - 1];
  if (Math.hypot(last[0] - q[0], last[1] - q[1]) > 2) out.push(last);
  return out;
}

// Prim MST over the majors + each major's nearest extra neighbour
const nM = MAJOR.length, dist = (a, b) => Math.hypot(MAJOR[a].x - MAJOR[b].x, MAJOR[a].z - MAJOR[b].z);
const edges = [], seen = new Set(), ekey = (a, b) => (a < b ? a + '-' + b : b + '-' + a);
{
  const inT = new Set([0]);
  while (inT.size < nM) {
    let ba = -1, bb = -1, bd = Infinity;
    for (const a of inT) for (let b = 0; b < nM; b++) if (!inT.has(b)) { const d = dist(a, b); if (d < bd) { bd = d; ba = a; bb = b; } }
    inT.add(bb); edges.push([ba, bb]); seen.add(ekey(ba, bb));
  }
  for (let a = 0; a < nM; a++) {
    let bb = -1, bd = 3200;
    for (let b = 0; b < nM; b++) if (b !== a && !seen.has(ekey(a, b)) && dist(a, b) < bd) { bd = dist(a, b); bb = b; }
    if (bb >= 0) { edges.push([a, bb]); seen.add(ekey(a, bb)); }
  }
}
export const ROAD_PATHS = edges.map(([a, b]) => {
  const A = MAJOR[a], B = MAJOR[b];
  return { a, b, pts: resample(chaikin(chaikin(route(A.x, A.z, B.x, B.z))), 14) };
});
export const ROADS = ROAD_PATHS.map((r) => [r.a, r.b]); // old format: pairs of POI indices

// road segment index (for "is this spot on a road" queries)
export const ROAD_SEGS = [];
const RIDX = new Map(), rkey = (cx, cz) => ((cx + 64) << 8) | (cz + 64);
for (const rp of ROAD_PATHS) {
  for (let k = 0; k < rp.pts.length - 1; k++) {
    const a = rp.pts[k], b = rp.pts[k + 1], s = [a[0], a[1], b[0], b[1]];
    ROAD_SEGS.push(s);
    for (const [x, z] of [a, b, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]]) {
      const key = rkey(Math.floor(x / 128), Math.floor(z / 128));
      (RIDX.get(key) || RIDX.set(key, []).get(key)).push(s);
    }
  }
}
export function distToRoad(x, z) {
  const cx = Math.floor(x / 128), cz = Math.floor(z / 128);
  let best = Infinity;
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const l = RIDX.get(rkey(cx + dx, cz + dz));
    if (!l) continue;
    for (const [x0, z0, x1, z1] of l) {
      const vx = x1 - x0, vz = z1 - z0, t = Math.max(0, Math.min(1, ((x - x0) * vx + (z - z0) * vz) / (vx * vx + vz * vz || 1)));
      const d = Math.hypot(x0 + vx * t - x, z0 + vz * t - z);
      if (d < best) best = d;
    }
  }
  return best;
}

// ---------- minor POIs ----------
const R = makeRng(7331);
const slopeOf = (x, z) => Math.hypot(naturalHeight(x + 6, z) - naturalHeight(x - 6, z), naturalHeight(x, z + 6) - naturalHeight(x, z - 6)) / 12;
const free = (x, z, r, gap) => {
  if (Math.abs(x) > 5300 || Math.abs(z) > 5300 || lakeAt(x, z, 1.25)) return false;
  for (let i = 0; i < POIS_ALL.length; i++) { const p = POIS_ALL[i]; if (Math.hypot(p.x - x, p.z - z) < p.r + r + gap) return false; }
  return true;
};
const PERSIST = new Set(['fuel', 'garage', 'checkpoint']);
let minorN = 0;
const addMinor = (type, x, z, extra = {}) => {
  const p = { id: 'm' + minorN++, name: type, tier: 'minor', type, x, z, r: 18 + R() * 8, persist: PERSIST.has(type), ...extra };
  POIS_ALL.push(p);
  return p;
};

// roadside services every ~1 km
const SIDE = ['fuel', 'garage', 'checkpoint', 'trailer', 'clinic', 'supply', 'fuel', 'checkpoint'];
for (const rp of ROAD_PATHS) {
  let acc = 0, next = 450 + R() * 500;
  for (let k = 0; k < rp.pts.length - 1; k++) {
    const a = rp.pts[k], b = rp.pts[k + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    acc += L;
    if (acc < next) continue;
    next = acc + 750 + R() * 550;
    const nx = (b[1] - a[1]) / (L || 1), nz = -(b[0] - a[0]) / (L || 1), side = R() < 0.5 ? 1 : -1, off = 22 + R() * 8;
    const x = a[0] + nx * side * off, z = a[1] + nz * side * off, type = SIDE[Math.floor(R() * SIDE.length)];
    if (free(x, z, 24, 150)) addMinor(type, x, z, { r: 22 });
  }
}
// lake-side: a dock and a lighthouse / cabin on every lake except the first
for (let i = 1; i < LAKES.length; i++) {
  const L = LAKES[i];
  for (let n = 0; n < 2; n++) {
    for (let tries = 0; tries < 12; tries++) {
      const a = R() * Math.PI * 2, x = L.x + Math.cos(a) * L.rx * 1.06, z = L.z + Math.sin(a) * L.rz * 1.06;
      if (Math.abs(x) > 5300 || Math.abs(z) > 5300) continue;
      let ok = true;
      for (const p of POIS_ALL) if (Math.hypot(p.x - x, p.z - z) < p.r + 40) ok = false;
      if (!ok) continue;
      addMinor(n === 0 ? 'dock' : L.rx >= 400 ? 'lighthouse' : 'cabin', x, z, { lake: i, r: 20 });
      break;
    }
  }
}
// terrain-matched minors everywhere else
function pickMinor(h, slope, fd, dry, mesa, nearLake) {
  const r = R();
  if (nearLake) return r < 0.5 ? 'cabin' : 'camp';
  if (h > 170) return slope > 0.3 ? 'mineshaft' : r < 0.4 ? 'cellmast' : r < 0.7 ? 'lookout' : 'bunker';
  if (h > 95) return r < 0.2 ? 'mineshaft' : r < 0.35 ? 'cellmast' : r < 0.55 ? 'lookout' : r < 0.7 ? 'bunker' : r < 0.85 ? 'crash' : 'camp';
  if (mesa > 0.5 || dry > 0.6) return r < 0.3 ? 'ruin' : r < 0.5 ? 'shack' : r < 0.65 ? 'crash' : r < 0.8 ? 'camp' : 'windmill';
  if (fd > 0.35) return r < 0.22 ? 'sawmill' : r < 0.4 ? 'ranger' : r < 0.6 ? 'cabin' : r < 0.75 ? 'camp' : r < 0.88 ? 'shack' : 'lookout';
  return r < 0.22 ? 'farm' : r < 0.35 ? 'windmill' : r < 0.5 ? 'trailer' : r < 0.62 ? 'cabin' : r < 0.72 ? 'church' : r < 0.8 ? 'graveyard' : r < 0.9 ? 'shack' : 'supply';
}
for (let tries = 0, made = 0; tries < 14000 && made < 260; tries++) {
  const x = (R() * 2 - 1) * 5250, z = (R() * 2 - 1) * 5250;
  if (!free(x, z, 24, 170)) continue;
  const h = naturalHeight(x, z), slope = slopeOf(x, z);
  if (h > 320 || slope > 0.5) continue;
  const type = pickMinor(h, slope, forestDensity(x, z, h), dryness(x, z), mesaness(x, z), !!lakeAt(x, z, 1.9));
  if (slope > 0.3 && type !== 'mineshaft') continue;
  addMinor(type, x, z);
  made++;
}

export const POIS = POIS_ALL;
export const VEHICLE_POIS = POIS_ALL.filter((p) => p.persist);
Object.defineProperty(POIS, 'forEach', { value: (cb, t) => VEHICLE_POIS.forEach(cb, t), enumerable: false });
