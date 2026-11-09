/**
 * Streams the ground mesh: 160 m chunks around the camera, full detail (5 m) near, coarse (20 m) far out
 * (the far ring only matters while the camera is very high, e.g. the hot drop). Chunks have skirts so LOD seams never show.
 * Colouring: biome (temperate / steppe / mesa), forest floor, shore sand, slope rock, snow.
 */
import * as THREE from 'three';
import { chunkHeights, heightExact, CHUNK, CH_CELLS, CELL, NCH } from './ground.js';
import { MAP_HALF, LAKES, lakeAt, dryness, mesaness, forestDensity } from './terrain.js';

const SKIRT = 8;
const C = {
  grassA: new THREE.Color(0x6b8f3e), grassB: new THREE.Color(0x4a7431), dry: new THREE.Color(0x8e8f52), steppe: new THREE.Color(0xb1a468),
  forest: new THREE.Color(0x3a5a2c), sand: new THREE.Color(0xc8b680), rock: new THREE.Color(0x7a746a), mesa: new THREE.Color(0x9c6a48),
  snow: new THREE.Color(0xe8edf0),
};
const _c = new THREE.Color();
const smooth01 = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };

function colourAt(x, z, h, ny, out) {
  const v = 0.5 + 0.5 * Math.sin(x * 0.013 + z * 0.021) * Math.cos(z * 0.017 - x * 0.007);
  _c.copy(C.grassB).lerp(C.grassA, v);
  const dr = dryness(x, z), ms = mesaness(x, z);
  _c.lerp(C.dry, smooth01(0.7, 0.9, Math.sin(x * 0.004 - z * 0.006) * 0.5 + 0.5) * 0.5 * (1 - dr));
  _c.lerp(C.steppe, dr * 0.85);
  _c.lerp(C.forest, forestDensity(x, z, h) * 0.55);
  _c.lerp(C.mesa, ms * 0.8);
  const lk = lakeAt(x, z, 1.5);
  if (lk) _c.lerp(C.sand, 1 - smooth01(lk.y + 0.5, lk.y + 2.3, h));
  const slopeRock = smooth01(0.82, 0.6, ny);
  _c.lerp(C.rock, Math.max(slopeRock, smooth01(70, 130, h)));
  _c.lerp(C.snow, smooth01(210, 250, h) * (0.5 + 0.5 * ny));
  out[0] = _c.r; out[1] = _c.g; out[2] = _c.b;
}

/** shared index buffers: n x n quads + 4 skirt strips (both windings, so they show from every side) */
function makeIndex(n) {
  const V = n + 1, idx = [], S = V * V;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const a = j * V + i, b = a + 1, c = a + V, d = c + 1;
    idx.push(a, c, b, b, c, d); // diagonal b-c: heightAt() relies on this
  }
  const strip = (edge, base) => {
    for (let i = 0; i < n; i++) {
      const p0 = edge(i), p1 = edge(i + 1), q0 = base + i, q1 = base + i + 1;
      idx.push(p0, p1, q0, p1, q1, q0, p0, q0, p1, p1, q0, q1);
    }
  };
  strip((i) => i, S);
  strip((i) => n * V + i, S + V);
  strip((i) => i * V, S + 2 * V);
  strip((i) => i * V + n, S + 3 * V);
  return new Uint16Array(idx);
}
const IDX = { 0: makeIndex(CH_CELLS), 1: makeIndex(CH_CELLS / 4) };

export function createTerrainMesh(tex) {
  tex.grass.wrapS = tex.grass.wrapT = THREE.RepeatWrapping;
  const stdMat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex.grass, vertexColors: true, roughness: 1 });
  let cheapMat = null, mat = stdMat;
  const group = new THREE.Group();
  const live = new Map(); // key -> { mesh, lod }
  const col = [0, 0, 0];

  function buildMesh(cx, cz, lod) {
    const step = lod === 0 ? 1 : 4, n = CH_CELLS / step, V = n + 1, cs = CELL * step;
    const ox = -MAP_HALF + cx * CHUNK, oz = -MAP_HALF + cz * CHUNK;
    let H, PSZ;
    if (lod === 0) { H = chunkHeights(cx, cz); PSZ = CH_CELLS + 3; }
    else {
      PSZ = n + 3; H = new Float32Array(PSZ * PSZ);
      for (let j = 0; j < PSZ; j++) for (let i = 0; i < PSZ; i++) H[j * PSZ + i] = heightExact(ox + (i - 1) * cs, oz + (j - 1) * cs);
    }
    const at = (i, j) => H[(j + 1) * PSZ + (i + 1)];
    const total = V * V + 4 * V;
    const pos = new Float32Array(total * 3), nrm = new Float32Array(total * 3), clr = new Float32Array(total * 3), uv = new Float32Array(total * 2);
    for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) {
      const k = j * V + i, lx = i * cs, lz = j * cs, x = ox + lx, z = oz + lz, h = at(i, j);
      const dhx = (at(i + 1, j) - at(i - 1, j)) / (2 * cs), dhz = (at(i, j + 1) - at(i, j - 1)) / (2 * cs), l = Math.sqrt(dhx * dhx + 1 + dhz * dhz);
      pos[k * 3] = lx; pos[k * 3 + 1] = h; pos[k * 3 + 2] = lz;
      nrm[k * 3] = -dhx / l; nrm[k * 3 + 1] = 1 / l; nrm[k * 3 + 2] = -dhz / l;
      colourAt(x, z, h, 1 / l, col);
      clr[k * 3] = col[0]; clr[k * 3 + 1] = col[1]; clr[k * 3 + 2] = col[2];
      uv[k * 2] = x / 14; uv[k * 2 + 1] = z / 14;
    }
    const skirt = (s, k) => { // copy vertex k down into skirt slot s
      const o = (V * V + s) * 3, p = k * 3;
      pos[o] = pos[p]; pos[o + 1] = pos[p + 1] - SKIRT; pos[o + 2] = pos[p + 2];
      nrm[o] = nrm[p]; nrm[o + 1] = nrm[p + 1]; nrm[o + 2] = nrm[p + 2];
      clr[o] = clr[p]; clr[o + 1] = clr[p + 1]; clr[o + 2] = clr[p + 2];
      uv[(V * V + s) * 2] = uv[k * 2]; uv[(V * V + s) * 2 + 1] = uv[k * 2 + 1];
    };
    for (let i = 0; i < V; i++) { skirt(i, i); skirt(V + i, n * V + i); skirt(2 * V + i, i * V); skirt(3 * V + i, i * V + n); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    g.setAttribute('color', new THREE.BufferAttribute(clr, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(IDX[lod], 1));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.position.set(ox, 0, oz);
    m.receiveShadow = true;
    m.userData.terrain = true;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    group.add(m);
    return m;
  }
  function drop(key) {
    const c = live.get(key);
    if (!c) return;
    group.remove(c.mesh); c.mesh.geometry.dispose();
    live.delete(key);
  }
  function build(cx, cz, lod) {
    const key = cz * NCH + cx, old = live.get(key);
    const mesh = buildMesh(cx, cz, lod);
    if (old) { group.remove(old.mesh); old.mesh.geometry.dispose(); }
    live.set(key, { mesh, lod });
  }

  /** foci = [{x, z}] (camera first, then the player). Builds nearest-first within a time budget (ms). */
  function update(foci, view, camFar, budget = 3) {
    const near = view + 70, want = new Map(), queue = [];
    for (let fi = 0; fi < foci.length; fi++) {
      const f = foci[fi], far = fi === 0 ? Math.max(near, camFar + 120) : near, R = far + 115 + 160;
      const c0 = Math.max(0, Math.floor((f.x - R + MAP_HALF) / CHUNK)), c1 = Math.min(NCH - 1, Math.floor((f.x + R + MAP_HALF) / CHUNK));
      const d0 = Math.max(0, Math.floor((f.z - R + MAP_HALF) / CHUNK)), d1 = Math.min(NCH - 1, Math.floor((f.z + R + MAP_HALF) / CHUNK));
      for (let cz = d0; cz <= d1; cz++) for (let cx = c0; cx <= c1; cx++) {
        const mx = -MAP_HALF + (cx + 0.5) * CHUNK, mz = -MAP_HALF + (cz + 0.5) * CHUNK, d = Math.hypot(mx - f.x, mz - f.z);
        if (d > far + 113 + 160) continue;
        const key = cz * NCH + cx, lod = d > far + 113 ? -1 : d <= near + 113 ? 0 : 1, p = want.get(key);
        if (!p) want.set(key, { cx, cz, lod, d });
        else { if (lod >= 0 && (p.lod < 0 || lod < p.lod)) p.lod = lod; if (d < p.d) p.d = d; }
      }
    }
    for (const key of live.keys()) if (!want.has(key)) drop(key);
    for (const [key, w] of want) {
      if (w.lod < 0) continue;
      const cur = live.get(key);
      if (!cur || (cur.lod !== w.lod && (w.lod === 0 || w.d > near + 113 + 50))) queue.push({ key, ...w });
    }
    if (!queue.length) return;
    queue.sort((a, b) => a.d - b.d);
    const end = performance.now() + budget;
    for (const q of queue) {
      build(q.cx, q.cz, q.lod);
      if (performance.now() > end) break;
    }
  }
  /** build everything within r metres at full detail right now (loading screen) */
  function prime(x, z, r) {
    const c0 = Math.max(0, Math.floor((x - r + MAP_HALF) / CHUNK)), c1 = Math.min(NCH - 1, Math.floor((x + r + MAP_HALF) / CHUNK));
    const d0 = Math.max(0, Math.floor((z - r + MAP_HALF) / CHUNK)), d1 = Math.min(NCH - 1, Math.floor((z + r + MAP_HALF) / CHUNK));
    for (let cz = d0; cz <= d1; cz++) for (let cx = c0; cx <= c1; cx++) if (!live.has(cz * NCH + cx)) build(cx, cz, 0);
  }
  function setCheap(on) {
    if (on && !cheapMat) cheapMat = new THREE.MeshLambertMaterial({ color: 0xffffff, map: tex.grass, vertexColors: true });
    mat = on ? cheapMat : stdMat;
    for (const c of live.values()) c.mesh.material = mat;
  }

  const waterMat = new THREE.MeshStandardMaterial({ color: 0x2f6a86, roughness: 0.06, metalness: 0.3, transparent: true, opacity: 0.86 });
  for (const L of LAKES) {
    const w = new THREE.Mesh(new THREE.CircleGeometry(1, 72), waterMat);
    w.rotation.x = -Math.PI / 2;
    w.scale.set(L.rx * 0.9, L.rz * 0.9, 1);
    w.position.set(L.x, L.y, L.z);
    group.add(w);
  }
  return { group, update, prime, setCheap };
}
