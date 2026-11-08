/** World colliders: spatial-grid broadphase. Axis-aligned boxes (optionally raised off the ground) + ramps (wedges) + terrain. */
import { heightAt } from './ground.js';
import { MAP_HALF } from './terrain.js';

export const WORLD_HALF = MAP_HALF - 6; // playable half-extent
export const STEP = 0.35; // max curb the player can walk up
const GRID_HALF = MAP_HALF + 24;
const CELL = 8;
const N = (GRID_HALF * 2) / CELL;

export const colliders = [];
const cells = new Array(N * N).fill(null);
let stamp = 0;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const ci = (v) => clamp(Math.floor((v + GRID_HALF) / CELL), 0, N - 1);

function register(c) {
  c._s = 0;
  c._i = colliders.length;
  colliders.push(c);
  const x1 = ci(c.maxX), z1 = ci(c.maxZ);
  for (let iz = ci(c.minZ); iz <= z1; iz++) {
    for (let ix = ci(c.minX); ix <= x1; ix++) {
      const k = iz * N + ix;
      (cells[k] || (cells[k] = [])).push(c);
    }
  }
  return c;
}

/** h = TOP height. opts: { y0 (base height), mesh, noCover, piece } */
export function addCollider(x, z, w, h, d, o = {}) {
  return register({
    mesh: o.mesh || null,
    minX: x - w / 2, maxX: x + w / 2, minZ: z - d / 2, maxZ: z + d / 2,
    y0: o.y0 || 0, h, cx: x, cz: z, w, d,
    noCover: !!o.noCover, ramp: false, piece: o.piece || null,
  });
}

/**
 * Ramp (wedge). dir = direction it RISES toward: 0 = +x, 1 = +z, 2 = -x, 3 = -z.
 * Surface goes from y0 at the low edge to `top` at the high edge.
 */
export function addRamp(x, z, w, d, y0, top, dir, o = {}) {
  const minX = x - w / 2, maxX = x + w / 2, minZ = z - d / 2, maxZ = z + d / 2;
  const len = dir === 0 || dir === 2 ? w : d;
  const rise = top - y0, k = rise / len;
  const slope = dir === 0 ? [-k, 1, 0, -k * minX + y0]
    : dir === 1 ? [0, 1, -k, -k * minZ + y0]
    : dir === 2 ? [k, 1, 0, k * maxX + y0]
    : [0, 1, k, k * maxZ + y0];
  const raw = [slope, [0, -1, 0, -y0], [1, 0, 0, maxX], [-1, 0, 0, -minX], [0, 0, 1, maxZ], [0, 0, -1, -minZ]];
  const planes = raw.map(([a, b, c, e]) => {
    const l = Math.hypot(a, b, c);
    return [a / l, b / l, c / l, e / l];
  });
  return register({
    mesh: o.mesh || null, minX, maxX, minZ, maxZ, y0, h: top, cx: x, cz: z, w, d,
    noCover: true, ramp: true, dir, len, rise, planes, piece: o.piece || null,
  });
}

export function removeCollider(c) {
  if (!c || c._i < 0) return;
  const last = colliders.pop();
  if (last !== c) { colliders[c._i] = last; last._i = c._i; }
  c._i = -1;
  const x1 = ci(c.maxX), z1 = ci(c.maxZ);
  for (let iz = ci(c.minZ); iz <= z1; iz++) {
    for (let ix = ci(c.minX); ix <= x1; ix++) {
      const a = cells[iz * N + ix];
      if (!a) continue;
      const i = a.indexOf(c);
      if (i >= 0) { a[i] = a[a.length - 1]; a.pop(); }
    }
  }
}

export function clearColliders() {
  colliders.length = 0;
  cells.fill(null);
}

// ---------- queries (shared result arrays: use immediately, don't hold across calls) ----------
const _near = [];
export function queryRect(x0, z0, x1, z1) {
  _near.length = 0;
  const s = ++stamp;
  const ix1 = ci(x1), iz1 = ci(z1);
  for (let iz = ci(z0); iz <= iz1; iz++) {
    for (let ix = ci(x0); ix <= ix1; ix++) {
      const a = cells[iz * N + ix];
      if (!a) continue;
      for (let i = 0; i < a.length; i++) {
        const c = a[i];
        if (c._s !== s) { c._s = s; _near.push(c); }
      }
    }
  }
  return _near;
}
export const nearby = (x, z, r) => queryRect(x - r, z - r, x + r, z + r);

/** Walk the grid cells a ray passes through. fn(cellArray, tExit) returns true to stop. */
function walkCells(x0, z0, dx, dz, tMax, fn) {
  const gx = (x0 + GRID_HALF) / CELL, gz = (z0 + GRID_HALF) / CELL;
  let ix = clamp(Math.floor(gx), 0, N - 1), iz = clamp(Math.floor(gz), 0, N - 1);
  const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
  const tdx = dx !== 0 ? CELL / Math.abs(dx) : Infinity;
  const tdz = dz !== 0 ? CELL / Math.abs(dz) : Infinity;
  let tmx = dx !== 0 ? Math.max(0, (((dx > 0 ? ix + 1 : ix) - gx) * CELL) / dx) : Infinity;
  let tmz = dz !== 0 ? Math.max(0, (((dz > 0 ? iz + 1 : iz) - gz) * CELL) / dz) : Infinity;
  for (let guard = 0; guard < 500; guard++) {
    if (ix < 0 || iz < 0 || ix >= N || iz >= N) return;
    const tExit = Math.min(tmx, tmz, tMax);
    const a = cells[iz * N + ix];
    if (a && fn(a, tExit)) return;
    if (tExit >= tMax) return;
    if (tmx < tmz) { ix += sx; tmx += tdx; } else { iz += sz; tmz += tdz; }
  }
}

const _along = [];
/** Broadphase superset of the colliders touched by a 2D segment */
export function along(ax, az, bx, bz) {
  _along.length = 0;
  const s = ++stamp;
  walkCells(ax, az, bx - ax, bz - az, 1, (arr) => {
    for (let i = 0; i < arr.length; i++) {
      const c = arr[i];
      if (c._s !== s) { c._s = s; _along.push(c); }
    }
    return false;
  });
  return _along;
}

function rampSurface(c, x, z) {
  let u;
  if (c.dir === 0) u = x - c.minX;
  else if (c.dir === 1) u = z - c.minZ;
  else if (c.dir === 2) u = c.maxX - x;
  else u = c.maxZ - z;
  return c.y0 + clamp(u, 0, c.len) * (c.rise / c.len);
}

/** Height of the highest walkable surface at (x, z) that is within step reach of y */
export function floorAt(x, z, y, r = 0.25) {
  let best = heightAt(x, z);
  const list = queryRect(x - r, z - r, x + r, z + r);
  for (let n = 0; n < list.length; n++) {
    const c = list[n];
    if (x < c.minX - 0.05 || x > c.maxX + 0.05 || z < c.minZ - 0.05 || z > c.maxZ + 0.05) continue;
    const s = c.ramp ? rampSurface(c, x, z) : c.h;
    // Ramps need more vertical reach so vehicles can climb; pads stay tight
    const reach = c.ramp ? 2.8 : (c.noCover ? 0.7 : 0.55);
    if (s <= y + reach && s > best) best = s;
  }
  return best;
}

/** Underside height of the lowest slab above the player's feet at (x, z), or Infinity */
export function ceilAt(x, z, y, r = 0.25) {
  let best = Infinity;
  const list = queryRect(x - r, z - r, x + r, z + r);
  for (let n = 0; n < list.length; n++) {
    const c = list[n];
    if (x < c.minX || x > c.maxX || z < c.minZ || z > c.maxZ) continue;
    if (c.y0 > y + 0.4 && c.y0 < best) best = c.y0;
  }
  return best;
}

/** Push a circle out of every collider. y = feet height, hgt = body height */
export function resolveCircle(x, z, radius, y = 0, hgt = 1.8) {
  let px = x, pz = z;
  const list = queryRect(px - radius - 0.01, pz - radius - 0.01, px + radius + 0.01, pz + radius + 0.01);
  for (let n = 0; n < list.length; n++) {
    const c = list[n];
    if (y + hgt <= c.y0 + 0.05) continue; // passing underneath
    const nearestX = clamp(px, c.minX, c.maxX);
    const nearestZ = clamp(pz, c.minZ, c.maxZ);
    const top = c.ramp ? rampSurface(c, nearestX, nearestZ) : c.h;
    if (y + STEP >= top) continue; // can stand on / step onto it
    const dx = px - nearestX;
    const dz = pz - nearestZ;
    const dist = Math.hypot(dx, dz);
    if (dist < radius) {
      if (dist < 1e-6) {
        const left = px - c.minX, right = c.maxX - px;
        const up = pz - c.minZ, down = c.maxZ - pz;
        const m = Math.min(left, right, up, down);
        if (m === left) px = c.minX - radius;
        else if (m === right) px = c.maxX + radius;
        else if (m === up) pz = c.minZ - radius;
        else pz = c.maxZ + radius;
      } else {
        const push = (radius - dist) / dist;
        px += dx * push;
        pz += dz * push;
      }
    }
  }
  px = clamp(px, -WORLD_HALF, WORLD_HALF);
  pz = clamp(pz, -WORLD_HALF, WORLD_HALF);
  return { x: px, z: pz };
}

// ---------- 2D segment vs box (Liang-Barsky), result in _t0/_t1 ----------
let _t0 = 0, _t1 = 1;
function clip(p, q) {
  if (Math.abs(p) < 1e-9) return q >= 0;
  const r = q / p;
  if (p < 0) {
    if (r > _t1) return false;
    if (r > _t0) _t0 = r;
  } else {
    if (r < _t0) return false;
    if (r < _t1) _t1 = r;
  }
  return true;
}
function clipSeg(x1, z1, x2, z2, c) {
  _t0 = 0; _t1 = 1;
  const dx = x2 - x1, dz = z2 - z1;
  return (
    clip(-dx, x1 - c.minX) && clip(dx, c.maxX - x1) &&
    clip(-dz, z1 - c.minZ) && clip(dz, c.maxZ - z1) && _t0 < _t1
  );
}

/**
 * Is the line of sight between two points blocked? ya / yb = heights at each end.
 * Low cover only blocks when the ray is lower than it; raised floors only block rays that pass through them.
 */
export function lineBlocked(ax, az, bx, bz, ya = 1.4, yb = ya) {
  const dx = bx - ax, dz = bz - az;
  for (let i = 1; i < TERRAIN_SAMPLES; i++) {
    const t = i / TERRAIN_SAMPLES;
    if (ya + (yb - ya) * t < heightAt(ax + dx * t, az + dz * t) - 0.3) return true;
  }
  const s = ++stamp;
  let blocked = false;
  walkCells(ax, az, dx, dz, 1, (arr) => {
    for (let i = 0; i < arr.length; i++) {
      const c = arr[i];
      if (c._s === s) continue;
      c._s = s;
      if (!clipSeg(ax, az, bx, bz, c)) continue;
      const h0 = ya + (yb - ya) * _t0, h1 = ya + (yb - ya) * _t1;
      const lo = Math.min(h0, h1), hi = Math.max(h0, h1);
      let top = c.h;
      if (c.ramp) { const mt = (_t0 + _t1) / 2; top = rampSurface(c, ax + dx * mt, az + dz * mt); }
      if (top >= lo - 0.05 && c.y0 <= hi + 0.05) { blocked = true; return true; }
    }
    return false;
  });
  return blocked;
}

// ---------- 3D ray vs world (boxes + ramps + terrain) ----------
const TERRAIN_SAMPLES = 16;
const TERRAIN_STEP = 2;
const _hit = { t: 0, nx: 0, ny: 1, nz: 0, ground: false, c: null };
const _O = [0, 0, 0], _D = [0, 0, 0], _MN = [0, 0, 0], _MX = [0, 0, 0];
let _rt = 0, _rf = false, _rs = 0;

function hitBox(c) {
  _MN[0] = c.minX; _MN[1] = c.y0; _MN[2] = c.minZ;
  _MX[0] = c.maxX; _MX[1] = c.h; _MX[2] = c.maxZ;
  let t0 = 0, t1 = _rt, ni = -1, ns = 0;
  for (let a = 0; a < 3; a++) {
    const o = _O[a], d = _D[a];
    if (Math.abs(d) < 1e-9) {
      if (o < _MN[a] || o > _MX[a]) return;
      continue;
    }
    let ta = (_MN[a] - o) / d, tb = (_MX[a] - o) / d, s = -1;
    if (ta > tb) { const k = ta; ta = tb; tb = k; s = 1; }
    if (ta > t0) { t0 = ta; ni = a; ns = s; }
    if (tb < t1) t1 = tb;
    if (t0 > t1) return;
  }
  if (ni >= 0 && t0 < _rt) {
    _rt = t0; _rf = true;
    _hit.nx = ni === 0 ? ns : 0;
    _hit.ny = ni === 1 ? ns : 0;
    _hit.nz = ni === 2 ? ns : 0;
    _hit.ground = false; _hit.c = c;
  }
}

function hitRamp(c) {
  let t0 = 0, t1 = _rt, ni = -1;
  for (let i = 0; i < 6; i++) {
    const p = c.planes[i];
    const den = p[0] * _D[0] + p[1] * _D[1] + p[2] * _D[2];
    const num = p[3] - (p[0] * _O[0] + p[1] * _O[1] + p[2] * _O[2]);
    if (Math.abs(den) < 1e-9) {
      if (num < 0) return;
      continue;
    }
    const t = num / den;
    if (den < 0) { if (t > t0) { t0 = t; ni = i; } }
    else if (t < t1) t1 = t;
    if (t0 > t1) return;
  }
  if (ni >= 0 && t0 < _rt) {
    const p = c.planes[ni];
    _rt = t0; _rf = true;
    _hit.nx = p[0]; _hit.ny = p[1]; _hit.nz = p[2];
    _hit.ground = false; _hit.c = c;
  }
}

function rayCell(arr, tExit) {
  for (let i = 0; i < arr.length; i++) {
    const c = arr[i];
    if (c._s === _rs) continue;
    c._s = _rs;
    if (c.ramp) hitRamp(c); else hitBox(c);
  }
  return _rf && _rt <= tExit;
}

/** First t in [0, tMax] where the ray meets the terrain, or -1. Marches, then bisects the crossing. */
function terrainT(ox, oy, oz, dx, dy, dz, tMax) {
  const above = (t) => oy + dy * t - heightAt(ox + dx * t, oz + dz * t);
  if (above(0) <= 0) return 0;
  if (dy >= 0) return -1;
  let t0 = 0;
  for (let t1 = Math.min(TERRAIN_STEP, tMax); ; t1 = Math.min(t1 + TERRAIN_STEP, tMax)) {
    if (above(t1) <= 0) {
      let lo = t0, hi = t1;
      for (let k = 0; k < 10; k++) {
        const mid = (lo + hi) / 2;
        if (above(mid) <= 0) hi = mid; else lo = mid;
      }
      return hi;
    }
    if (t1 >= tMax) return -1;
    t0 = t1;
  }
}

/** Returns a shared result {t, nx, ny, nz, ground, c} or null. Use it immediately. `c.piece` is set for player builds. */
export function raycastWorld(ox, oy, oz, dx, dy, dz, maxT) {
  _O[0] = ox; _O[1] = oy; _O[2] = oz;
  _D[0] = dx; _D[1] = dy; _D[2] = dz;
  _rt = maxT; _rf = false; _hit.c = null;
  _rs = ++stamp;
  walkCells(ox, oz, dx, dz, _rt, rayCell);
  const tg = terrainT(ox, oy, oz, dx, dy, dz, _rt);
  if (tg >= 0) {
    _rt = tg; _rf = true; _hit.c = null; _hit.ground = true;
    const e = 0.5, px = ox + dx * tg, pz = oz + dz * tg;
    const gx = (heightAt(px + e, pz) - heightAt(px - e, pz)) / (2 * e);
    const gz = (heightAt(px, pz + e) - heightAt(px, pz - e)) / (2 * e);
    const l = Math.hypot(gx, 1, gz);
    _hit.nx = -gx / l; _hit.ny = 1 / l; _hit.nz = -gz / l;
  }
  if (!_rf) return null;
  _hit.t = _rt;
  return _hit;
}

export function nearestCoverAwayFrom(px, pz, threatX, threatZ) {
  let best = null, bestScore = -Infinity;
  const list = queryRect(px - 45, pz - 45, px + 45, pz + 45);
  for (let n = 0; n < list.length; n++) {
    const c = list[n];
    if (c.noCover) continue;
    const awayX = c.cx - threatX;
    const awayZ = c.cz - threatZ;
    const len = Math.hypot(awayX, awayZ) || 1;
    const sx = c.cx + (awayX / len) * (c.w / 2 + 1.2);
    const sz = c.cz + (awayZ / len) * (c.d / 2 + 1.2);
    const distMe = Math.hypot(sx - px, sz - pz);
    const distThreat = Math.hypot(sx - threatX, sz - threatZ);
    const score = distThreat - distMe * 0.35;
    if (score > bestScore) {
      bestScore = score;
      best = { x: sx, z: sz, collider: c };
    }
  }
  return best;
}
