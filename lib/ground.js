/**
 * Exact ground, generated in 160 m chunks the first time anything asks for them (never for the whole map at once).
 * Each chunk keeps a 5 m grid with a 1-sample border (for seamless normals). heightAt() is the bilinear read of it.
 * POI footprints are levelled here: a flat core with a soft shoulder.
 */
import { MAP_HALF, naturalHeight } from './terrain.js';
import { POIS } from './mapLayout.js';

export const CELL = 5;
export const CH_CELLS = 32;
export const CHUNK = CELL * CH_CELLS;
export const NCH = (MAP_HALF * 2) / CHUNK;
export const CELLS = NCH * CH_CELLS;
export const SAMPLES = CELLS + 1;
const PS = CH_CELLS + 3;
const FLAT_SCALE = { arena: 1.9 };
const FLAT_CORE = 0.8;
const EMPTY = [];
const smooth = (t) => t * t * (3 - 2 * t);

let sitesBy = null;
function siteIndex() {
  if (sitesBy) return sitesBy;
  sitesBy = new Map();
  for (let i = 0; i < POIS.length; i++) {
    const p = POIS[i], r = (p.flat != null ? p.flat : p.r) * (FLAT_SCALE[p.type] || 1);
    const s = { x: p.x, z: p.z, r, h: naturalHeight(p.x, p.z) };
    const c0 = Math.max(0, Math.floor((p.x - r - CELL + MAP_HALF) / CHUNK)), c1 = Math.min(NCH - 1, Math.floor((p.x + r + CELL + MAP_HALF) / CHUNK));
    const d0 = Math.max(0, Math.floor((p.z - r - CELL + MAP_HALF) / CHUNK)), d1 = Math.min(NCH - 1, Math.floor((p.z + r + CELL + MAP_HALF) / CHUNK));
    for (let cz = d0; cz <= d1; cz++) for (let cx = c0; cx <= c1; cx++) {
      const k = cz * NCH + cx;
      (sitesBy.get(k) || sitesBy.set(k, []).get(k)).push(s);
    }
  }
  return sitesBy;
}
function evalAt(x, z, list) {
  let h = naturalHeight(x, z);
  for (let i = 0; i < list.length; i++) {
    const s = list[i], dx = x - s.x, dz = z - s.z;
    if (Math.abs(dx) >= s.r || Math.abs(dz) >= s.r) continue;
    const d = Math.sqrt(dx * dx + dz * dz) / s.r;
    if (d >= 1) continue;
    const w = d <= FLAT_CORE ? 1 : 1 - smooth((d - FLAT_CORE) / (1 - FLAT_CORE));
    h += (s.h - h) * w;
  }
  return h;
}

const chunks = new Array(NCH * NCH).fill(null);
const ck = (c) => (c < 0 ? 0 : c > NCH - 1 ? NCH - 1 : c);

/** padded (35 x 35) heights of a chunk; sample (i, j) sits at chunk origin + (i - 1, j - 1) cells */
export function chunkHeights(cx, cz) {
  const key = cz * NCH + cx;
  let g = chunks[key];
  if (g) return g;
  g = new Float32Array(PS * PS);
  const list = siteIndex().get(key) || EMPTY;
  const x0 = -MAP_HALF + cx * CHUNK - CELL, z0 = -MAP_HALF + cz * CHUNK - CELL;
  for (let j = 0; j < PS; j++) for (let i = 0; i < PS; i++) g[j * PS + i] = evalAt(x0 + i * CELL, z0 + j * CELL, list);
  chunks[key] = g;
  return g;
}
/** the true analytic ground (no grid), used for far terrain LOD */
export function heightExact(x, z) {
  const cx = ck(Math.floor((x + MAP_HALF) / CHUNK)), cz = ck(Math.floor((z + MAP_HALF) / CHUNK));
  return evalAt(x, z, siteIndex().get(cz * NCH + cx) || EMPTY);
}
export function groundGrid() { return null; } // the single big grid is gone; kept so old imports still link

export function heightAt(x, z) {
  let gx = (x + MAP_HALF) / CELL, gz = (z + MAP_HALF) / CELL;
  if (gx < 0) gx = 0; else if (gx > CELLS) gx = CELLS;
  if (gz < 0) gz = 0; else if (gz > CELLS) gz = CELLS;
  let i = gx | 0, j = gz | 0;
  if (i >= CELLS) i = CELLS - 1;
  if (j >= CELLS) j = CELLS - 1;
  const cx = (i / CH_CELLS) | 0, cz = (j / CH_CELLS) | 0;
  const g = chunks[cz * NCH + cx] || chunkHeights(cx, cz);
  const k = (j - cz * CH_CELLS + 1) * PS + (i - cx * CH_CELLS + 1);
  const fx = gx - i, fz = gz - j;
  const a = g[k], b = g[k + 1], c = g[k + PS], d = g[k + PS + 1];
  return fx + fz <= 1 ? a + (b - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
}
