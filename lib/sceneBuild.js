/**
 * Geometry toolkit for the map: materials, a chunked geometry batcher, and building/prop primitives.
 * Everything placed here adds colliders in a deterministic order so every client builds the same world.
 *
 * Ground handling: heightAt() is the exact rendered ground, and every primitive that sits on the ground uses
 * groundRange()/settle() so nothing floats: props bury into the ground, buildings get foundations, roads
 * and pads are draped over the terrain.
 */
import * as THREE from 'three';
import { addCollider, addRamp } from './collision.js';
import { heightAt } from './ground.js';
import { createBuildingTextures } from './bldgTex.js';

const PI = Math.PI;
export const DX = [1, 0, -1, 0], DZ = [0, 1, 0, -1];
const RAMP_ROT = [0, -PI / 2, PI, PI / 2];
const Q = [0, 1, 2, 0, 2, 3];
const FACES = [
  { n: [1, 0, 0], v: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]], u: 'z', w: 'y' },
  { n: [-1, 0, 0], v: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]], u: 'z', w: 'y' },
  { n: [0, 1, 0], v: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]], u: 'x', w: 'z' },
  { n: [0, -1, 0], v: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]], u: 'x', w: 'z' },
  { n: [0, 0, 1], v: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]], u: 'x', w: 'y' },
  { n: [0, 0, -1], v: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]], u: 'x', w: 'y' },
];

const CH = 128; // batch chunk size in metres
const OUT = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] }; // outward direction of each building side
const STEP_DIR = { s: 3, n: 1, e: 2, w: 0 }; // direction door steps rise toward (into the building)
const ROOF_TINTS = [0x5b4a42, 0x4a4f58, 0x6e3f34, 0x3e4a3c, 0x7a6a5a, 0x55504a];
const SHUTTER_TINTS = [0x3f5a4a, 0x5a3a30, 0x2f3f55, 0xe8e4da];

/** wall look for a legacy material key; null = painted-metal / industrial shell (keeps its own material) */
function wallLook(mk) {
  switch (mk) {
    case 'brick': return { mk: 'brickT', tints: [0xffffff, 0xf0d6c6, 0xdcb7a4, 0xf6e6d8, 0xc9b0a2], tile: 2 };
    case 'woodR': return { mk: 'sidingT', tints: [0xb8584d, 0xa94a3f, 0xc2655a], tile: 2 };
    case 'woodD': return { mk: 'sidingT', tints: [0x8a7058, 0x9a8670, 0x7b6a58, 0x6f7b6a], tile: 2 };
    case 'wood': return { mk: 'sidingT', tints: [0xd8c8a0, 0xcbb892, 0x9fb3a0, 0xa7b8c8], tile: 2 };
    case 'concD': return { mk: 'plasterT', tints: [0x8e9096, 0x7e8086, 0x9a948a], tile: 4 };
    case 'concC': return { mk: 'plasterT', tints: [0xc4ced8, 0xb5c2ce, 0xd0d6dc], tile: 4 };
    case 'concW': return { mk: 'plasterT', tints: [0xe8d9bf, 0xefe2cc, 0xdccaa8], tile: 4 };
    case 'stone': return { mk: 'plasterT', tints: [0xb2ab9f, 0xa59f94, 0xbdb6a8], tile: 3 };
    case 'conc': return { mk: 'plasterT', tints: [0xe9e2d2, 0xd2d9cc, 0xc9d3da, 0xf1ede5], tile: 4 };
    default: return null;
  }
}

function makeMaterials(tex) {
  const mats = {};
  const def = (k, map, color, o = {}) => {
    const m = new THREE.MeshStandardMaterial({ color, map: map || null, roughness: o.r ?? 0.9, metalness: o.m ?? 0 });
    if (o.po !== undefined) { m.polygonOffset = true; m.polygonOffsetFactor = o.po; m.polygonOffsetUnits = o.po; m.userData.flat = true; }
    if (o.em) { m.emissive = new THREE.Color(o.em); m.emissiveIntensity = o.ei ?? 1; }
    mats[k] = m;
  };
  const tc = tex.concrete, tw = tex.wood, tm = tex.metal;
  def('conc', tc, 0xffffff); def('concW', tc, 0xe8d9bf); def('concC', tc, 0xc4ced8); def('concD', tc, 0x8e9096);
  def('brick', tc, 0xc79a85); def('stone', tc, 0xb2ab9f); def('rock', tc, 0x857f72); def('floor', tc, 0xb0aa9e);
  def('stair', tc, 0x9a968c); def('sand', tc, 0xd6c291);
  def('wood', tw, 0xffffff, { r: 0.8 }); def('woodD', tw, 0xb4947a, { r: 0.8 }); def('woodR', tw, 0xc2655a, { r: 0.8 });
  def('hay', null, 0xc9ab4e, { r: 1 }); def('canvas', null, 0xc9bf9f, { r: 1 });
  def('metal', tm, 0xd0d4d8, { r: 0.5, m: 0.6 }); def('metalD', tm, 0x555a60, { r: 0.5, m: 0.6 });
  def('roof', tm, 0x6b5f58, { r: 0.7, m: 0.4 }); def('roofB', tm, 0x4c5864, { r: 0.7, m: 0.4 });
  const paints = { pRed: 0x93402f, pBlue: 0x3b6a8c, pGreen: 0x55743a, pYellow: 0xb8892f, pGrey: 0x7c848a, pOrange: 0xc3662a, pWhite: 0xd2d4d6 };
  for (const k in paints) def(k, tm, paints[k], { r: 0.5, m: 0.6 });
  def('glass', null, 0x1c2a36, { r: 0.15, m: 0.8 }); def('tire', null, 0x121212, { r: 0.9 });
  def('lamp', null, 0xfff2c0, { em: 0xffe9a0, ei: 1.2 });
  def('road', tc, 0x66686a, { po: -3 }); def('roadJ', tc, 0x66686a, { po: -4 });
  def('dirt', tc, 0x8a7757, { po: -2 }); def('mark', null, 0xdedede, { po: -5 });
  def('pad', tc, 0xb8b8b4, { po: -2 }); def('wheat', null, 0x9b8a45, { po: -1 }); def('crop', null, 0x4f7a35, { po: -1 });
  def('plow', null, 0x6a4b33, { po: -1 }); def('hpad', null, 0x4a4f55, { po: -4 });

  // tinted building materials: the colour comes from per-vertex colours so one material gives endless variety
  const bt = createBuildingTextures(tex);
  const tinted = (k, map, o = {}) => {
    mats[k] = new THREE.MeshStandardMaterial({ color: 0xffffff, map, vertexColors: true, roughness: o.r ?? 0.9, metalness: 0 });
  };
  tinted('plasterT', bt.plaster); tinted('brickT', bt.brick, { r: 0.95 }); tinted('sidingT', bt.siding, { r: 0.85 }); tinted('shingleT', bt.shingle, { r: 0.8 });
  return mats;
}

/**
 * Builder with the geometry primitives. Every call takes absolute world coordinates; y0 is the base height.
 * Geometry is batched per material and per CH-metre chunk so frustum culling stays effective.
 */
export function createBuilder(scene, tex) {
  const mats = makeMaterials(tex);
  const buckets = new Map();
  const zones = [];
  const spots = [];
  const rects = []; // exact building footprints (roads skip these)
  let roadSegs = [];
  const R = { rng: null };

  // ---------- vertex tint state (used by tinted materials only) ----------
  const T = { r: 1, g: 1, b: 1, base: null };
  const _col = new THREE.Color();
  function setTint(hex, base = null) { _col.set(hex); T.r = _col.r; T.g = _col.g; T.b = _col.b; T.base = base; }
  const pc = (b, y) => {
    if (!b.c) return;
    let s = 1;
    if (T.base !== null) s = 0.7 + 0.3 * Math.min(1, Math.max(0, (y - T.base) / 1.5)); // dirtier near the ground
    b.c.push(T.r * s, T.g * s, T.b * s);
  };
  const vert = (b, x, y, z, nx, ny, nz, u, v) => { b.p.push(x, y, z); b.n.push(nx, ny, nz); b.u.push(u, v); pc(b, y); };

  const bucket = (mk, x, z) => {
    const key = mk + '|' + Math.floor(x / CH) + '|' + Math.floor(z / CH);
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { mk, p: [], n: [], u: [], c: mats[mk].vertexColors ? [] : null }));
    return b;
  };

  // ---------- ground handling ----------
  /** lowest / highest ground under a w x d footprint centred on (x, z) */
  function groundRange(x, z, w = 1, d = 1) {
    const hw = w / 2, hd = d / 2;
    const nx = Math.max(1, Math.ceil(w / 2.5)), nz = Math.max(1, Math.ceil(d / 2.5));
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i <= nx; i++) {
      for (let j = 0; j <= nz; j++) {
        const h = heightAt(x - hw + (w * i) / nx, z - hd + (d * j) / nz);
        if (h < lo) lo = h;
        if (h > hi) hi = h;
      }
    }
    return { lo, hi, mid: (lo + hi) / 2 };
  }
  /** props sitting on the ground are buried to the lowest point under them (never floating). An explicit y far from the ground is kept (roofs, platforms). */
  function settle(x, z, w, d, y, tol = 0.8) {
    const g = groundRange(x, z, w, d), snap = y >= g.lo - tol && y <= g.hi + tol;
    return { g, snap, base: snap ? g.lo : y };
  }

  /** axis-aligned (optionally Y-rotated) box with world-scaled UVs. y0 = base height. */
  function box(mk, x, y0, z, w, h, d, tile = 3, ry = 0) {
    const b = bucket(mk, x, z), c = Math.cos(ry), s = Math.sin(ry), hy = h / 2, cy = y0 + hy;
    const dim = { x: w, y: h, z: d };
    for (const f of FACES) {
      if (f.n[1] < 0 && y0 < 0.02) continue;
      const U = dim[f.u] / tile, V = dim[f.w] / tile;
      const nx = f.n[0] * c + f.n[2] * s, nz = -f.n[0] * s + f.n[2] * c, ny = f.n[1];
      for (const k of Q) {
        const v = f.v[k], lx = (v[0] * w) / 2, lz = (v[2] * d) / 2;
        vert(b, x + lx * c + lz * s, cy + v[1] * hy, z - lx * s + lz * c, nx, ny, nz, k === 1 || k === 2 ? U : 0, k >= 2 ? V : 0);
      }
    }
  }

  /** vertical single-sided quad (trim, shutters, bands). (x,y,z) = bottom centre, (nx,nz) = outward normal */
  function plate(mk, x, y, z, w, h, nx, nz, tile = 3) {
    const b = bucket(mk, x, z), tx = nz, tz = -nx;
    const pts = [[-1, 0], [1, 0], [1, 1], [-1, 1]];
    for (const k of Q) {
      const [sx, sy] = pts[k];
      vert(b, x + (tx * sx * w) / 2, y + sy * h, z + (tz * sx * w) / 2, nx, 0, nz, (sx > 0 ? w : 0) / tile, (sy * h) / tile);
    }
  }

  /** flat level quad at an explicit height (floors inside buildings) */
  function flat(mk, x, z, w, d, y = 0.02, ry = 0, tile = 4) {
    const b = bucket(mk, x, z), c = Math.cos(ry), s = Math.sin(ry);
    const pts = [[-1, 1], [1, 1], [1, -1], [-1, -1]];
    const uv = [[0, 0], [w / tile, 0], [w / tile, d / tile], [0, d / tile]];
    for (const k of Q) {
      const lx = (pts[k][0] * w) / 2, lz = (pts[k][1] * d) / 2;
      vert(b, x + lx * c + lz * s, y, z - lx * s + lz * c, 0, 1, 0, uv[k][0], uv[k][1]);
    }
  }

  /** quad hugging the terrain (pads, fields, markings). lift = height above the ground surface */
  function drape(mk, x, z, w, d, lift = 0.03, ry = 0, tile = 4) {
    const b = bucket(mk, x, z), c = Math.cos(ry), s = Math.sin(ry);
    const nx = Math.max(1, Math.ceil(w / 3)), nz = Math.max(1, Math.ceil(d / 3));
    const P = (i, j) => {
      const lx = (i / nx - 0.5) * w, lz = (j / nz - 0.5) * d;
      const px = x + lx * c + lz * s, pz = z - lx * s + lz * c;
      return [px, heightAt(px, pz) + lift, pz, ((i / nx) * w) / tile, ((j / nz) * d) / tile];
    };
    for (let j = 0; j < nz; j++) {
      for (let i = 0; i < nx; i++) {
        const a = P(i, j), bb = P(i + 1, j), cc = P(i, j + 1), dd = P(i + 1, j + 1);
        for (const p of [a, cc, bb, bb, cc, dd]) vert(b, p[0], p[1], p[2], 0, 1, 0, p[3], p[4]);
      }
    }
  }

  /** continuous road ribbon from (x0,z0) to (x1,z1) that follows the ground. o.skip(x,z) drops stretches (buildings, water) */
  function road(mk, x0, z0, x1, z1, width = 7, o = {}) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 1) return;
    const n = Math.max(1, Math.ceil(len / (o.step || 2.5)));
    const fx = (x1 - x0) / len, fz = (z1 - z0) / len, rx = fz, rz = -fx;
    const lift = o.lift ?? 0.07, hw = width / 2, tile = o.tile || 4;
    const row = (i) => {
      const t = i / n, px = x0 + (x1 - x0) * t, pz = z0 + (z1 - z0) * t;
      return [-1, 0, 1].map((k) => { const vx = px + rx * hw * k, vz = pz + rz * hw * k; return [vx, heightAt(vx, vz) + lift, vz]; });
    };
    let prev = row(0);
    for (let i = 0; i < n; i++) {
      const cur = row(i + 1), mx = (prev[1][0] + cur[1][0]) / 2, mz = (prev[1][2] + cur[1][2]) / 2;
      if (!(o.skip && o.skip(mx, mz))) {
        const b = bucket(mk, mx, mz), u0 = ((i * len) / n) / tile, u1 = (((i + 1) * len) / n) / tile;
        for (let k = 0; k < 2; k++) {
          const A = prev[k], B = prev[k + 1], C = cur[k], D = cur[k + 1], v0 = (k * hw) / tile, v1 = ((k + 1) * hw) / tile;
          vert(b, A[0], A[1], A[2], 0, 1, 0, u0, v0); vert(b, C[0], C[1], C[2], 0, 1, 0, u1, v0); vert(b, B[0], B[1], B[2], 0, 1, 0, u0, v1);
          vert(b, C[0], C[1], C[2], 0, 1, 0, u1, v0); vert(b, D[0], D[1], D[2], 0, 1, 0, u1, v1); vert(b, B[0], B[1], B[2], 0, 1, 0, u0, v1);
        }
      }
      prev = cur;
    }
  }

  /** dashed centre line draped over the road */
  function roadMarks(mk, x0, z0, x1, z1, o = {}) {
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 12) return;
    const fx = (x1 - x0) / len, fz = (z1 - z0) / len, rx = fz, rz = -fx, hw = 0.13, lift = (o.lift ?? 0.07) + 0.035, dash = 3, gap = 5;
    for (let s = 4; s + dash < len - 4; s += dash + gap) {
      const ax = x0 + fx * s, az = z0 + fz * s, bx = ax + fx * dash, bz = az + fz * dash, mx = (ax + bx) / 2, mz = (az + bz) / 2;
      if (o.skip && o.skip(mx, mz)) continue;
      const b = bucket(mk, mx, mz);
      const A = [ax - rx * hw, az - rz * hw], B = [ax + rx * hw, az + rz * hw], C = [bx - rx * hw, bz - rz * hw], D = [bx + rx * hw, bz + rz * hw];
      const V = (p, u, v) => vert(b, p[0], heightAt(p[0], p[1]) + lift, p[1], 0, 1, 0, u, v);
      V(A, 0, 0); V(C, 1, 0); V(B, 0, 1); V(C, 1, 0); V(D, 1, 1); V(B, 0, 1);
    }
  }

  /** round patch draped on the ground (road junctions) */
  function disc(mk, x, z, r, lift = 0.09, seg = 18) {
    const b = bucket(mk, x, z), cy = heightAt(x, z) + lift;
    for (let i = 0; i < seg; i++) {
      const a0 = (i / seg) * PI * 2, a1 = ((i + 1) / seg) * PI * 2;
      const p0x = x + Math.cos(a0) * r, p0z = z + Math.sin(a0) * r, p1x = x + Math.cos(a1) * r, p1z = z + Math.sin(a1) * r;
      vert(b, x, cy, z, 0, 1, 0, 0.5, 0.5);
      vert(b, p1x, heightAt(p1x, p1z) + lift, p1z, 0, 1, 0, 1, 0.5);
      vert(b, p0x, heightAt(p0x, p0z) + lift, p0z, 0, 1, 0, 0, 0.5);
    }
  }

  /** ramp-shaped prism rising toward `dir` (0 +x, 1 +z, 2 -x, 3 -z). L = run, W = width, Rr = rise */
  function wedge(mk, x, y0, z, L, W, Rr, dir, tile = 3) {
    const b = bucket(mk, x, z), ry = RAMP_ROT[dir], c = Math.cos(ry), s = Math.sin(ry);
    const A = [-L / 2, 0, -W / 2], B = [-L / 2, 0, W / 2], C = [L / 2, 0, -W / 2], D = [L / 2, 0, W / 2];
    const E = [L / 2, Rr, -W / 2], F = [L / 2, Rr, W / 2];
    for (const tri of [[A, C, D], [A, D, B], [C, E, F], [C, F, D], [A, B, F], [A, F, E], [A, E, C], [B, D, F]]) {
      const w3 = tri.map(([lx, ly, lz]) => [x + lx * c + lz * s, y0 + ly, z - lx * s + lz * c, lx, ly, lz]);
      const ux = w3[1][0] - w3[0][0], uy = w3[1][1] - w3[0][1], uz = w3[1][2] - w3[0][2];
      const vx = w3[2][0] - w3[0][0], vy = w3[2][1] - w3[0][1], vz = w3[2][2] - w3[0][2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      for (const p of w3) vert(b, p[0], p[1], p[2], nx, ny, nz, (p[3] + p[5]) / tile, (p[4] + p[5] * 0.5) / tile);
    }
  }

  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _eu = new THREE.Euler(), _v3 = new THREE.Vector3(), _s3 = new THREE.Vector3();
  /** any THREE geometry (cylinder, cone, ...). pos = [x,y,z] */
  function geo(mk, g0, pos, rot = [0, 0, 0], scl = [1, 1, 1]) {
    const g = g0.index ? g0.toNonIndexed() : g0.clone();
    _m4.compose(_v3.set(pos[0], pos[1], pos[2]), _q.setFromEuler(_eu.set(rot[0], rot[1], rot[2])), _s3.set(scl[0], scl[1], scl[2]));
    g.applyMatrix4(_m4);
    const b = bucket(mk, pos[0], pos[2]);
    const pa = g.attributes.position.array, na = g.attributes.normal.array, ua = g.attributes.uv.array;
    for (let i = 0, j = 0; i < pa.length; i += 3, j += 2) vert(b, pa[i], pa[i + 1], pa[i + 2], na[i], na[i + 1], na[i + 2], ua[j], ua[j + 1]);
    g.dispose();
    g0.dispose();
  }

  function finish() {
    for (const b of buckets.values()) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.u, 2));
      if (b.c) g.setAttribute('color', new THREE.Float32BufferAttribute(b.c, 3));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mats[b.mk]);
      m.receiveShadow = true;
      m.castShadow = !mats[b.mk].userData.flat;
      scene.add(m);
    }
    buckets.clear();
  }

  const zone = (x, z, w, d, pad = 3) => zones.push([x - w / 2 - pad, z - d / 2 - pad, x + w / 2 + pad, z + d / 2 + pad]);
  const blocked = (x, z) => {
    for (let i = 0; i < zones.length; i++) { const q = zones[i]; if (x > q[0] && x < q[2] && z > q[1] && z < q[3]) return true; }
    return false;
  };
  const inRect = (x, z) => {
    for (let i = 0; i < rects.length; i++) { const q = rects[i]; if (x > q[0] && x < q[2] && z > q[1] && z < q[3]) return true; }
    return false;
  };
  const setRoads = (segs) => { roadSegs = segs; };
  const roadNear = (x, z, r) => {
    for (const [x0, z0, x1, z1] of roadSegs) {
      const vx = x1 - x0, vz = z1 - z0, L2 = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((x - x0) * vx + (z - z0) * vz) / L2));
      if (Math.hypot(x0 + vx * t - x, z0 + vz * t - z) < r + 3.5) return true;
    }
    return false;
  };

  /**
   * o.ground = bury visual into the slope.
   * CRITICAL: never expand the collider from ground-lo to ground-hi across a wide footprint —
   * that created invisible walls on every hillside pad / rock / platform across the map.
   * Pads (nc or thin): thin surface slab only.
   * Vertical props on slopes: sit on local heightAt, height = h (not slope span).
   */
  function solid(mk, x, y0, z, w, h, d, o = {}) {
    let base = y0, topY = y0 + h;
    const pad = !!(o.nc || h <= 0.75);
    if (o.ground) {
      const g = groundRange(x, z, w, d);
      if (pad) {
        // Visual may fill the slope; collision is only a thin walkable skin near the top
        base = g.lo - (o.sink ?? 0.5);
        topY = g.hi + h;
        box(mk, x, base, z, w, Math.max(0.05, topY - base), d, o.tile || 3, 0);
        if (o.col === false) return null;
        const top = g.hi + h;
        const thick = Math.max(0.3, Math.min(h + 0.15, 0.6));
        return addCollider(x, z, w, top, d, { y0: top - thick, noCover: true });
      }
      // Walls / posts / crates on slopes: local ground only, no lo..hi prism
      const gy = heightAt(x, z);
      base = gy - (o.sink ?? 0.12);
      topY = base + h;
    }
    box(mk, x, base, z, w, Math.max(0.05, topY - base), d, o.tile || 3, 0);
    if (o.col === false) return null;
    if (pad) {
      const thick = Math.max(0.3, Math.min(h + 0.15, 0.6));
      return addCollider(x, z, w, topY, d, { y0: topY - thick, noCover: true });
    }
    return addCollider(x, z, w, topY, d, { y0: base, noCover: false });
  }

  /** straight wall with openings. axis 'x': runs along x at z = fixed. ops = [{c, w, lo, hi}] sorted by c. */
  function wallRun(mk, axis, fixed, a0, a1, y0, h, t, ops, tile = 3) {
    let cur = a0;
    const seg = (s, e, lo, hi) => {
      if (e - s < 0.04 || hi - lo < 0.04) return;
      const mid = (s + e) / 2, len = e - s;
      if (axis === 'x') solid(mk, mid, y0 + lo, fixed, len, hi - lo, t, { tile });
      else solid(mk, fixed, y0 + lo, mid, t, hi - lo, len, { tile });
    };
    for (const o of ops) {
      const s = o.c - o.w / 2, e = o.c + o.w / 2;
      seg(cur, s, 0, h);
      if (o.lo > 0) seg(s, e, 0, o.lo);
      seg(s, e, o.hi, h);
      cur = e;
    }
    seg(cur, a1, 0, h);
  }

  /** walkable stair: ramp collider + stepped visual. (x,z) = footprint centre; len along the rise direction */
  function stairs(x, z, dir, w, len, y0, rise, mk = 'stair') {
    const alongX = dir % 2 === 0;
    addRamp(x, z, alongX ? len : w, alongX ? w : len, y0, y0 + rise, dir);
    const n = Math.max(3, Math.round(rise / 0.28)), r = rise / n, ln = len / n;
    for (let k = 0; k < n; k++) {
      const off = -len / 2 + (k + 0.5) * ln;
      box(mk, x + DX[dir] * off, y0, z + DZ[dir] * off, alongX ? ln : w, (k + 0.5) * r, alongX ? w : ln, 2);
    }
  }

  /**
   * Enterable building. Options: floors, fh, t, mk (wall look), roof ('flat' walkable | 'gable' | 'shed'), roofMk,
   * door ('s' | ['s','n']), doorAt, dw, dh, win, winGap, part, stairs, props, parapet, shop, skipRoad, y0.
   * Without y0 the building settles itself onto the ground (floor level = ground at the first door, foundation
   * filling the rest, door steps where the ground falls away).
   */
  function building(cx, cz, w, d, o = {}) {
    if (o.skipRoad && roadNear(cx, cz, Math.hypot(w, d) / 2 + 4)) return null;
    const rnd = R.rng;
    const fl = o.floors || 1, fh = o.fh || 3.2, t = o.t || 0.3;
    const mkIn = o.mk || 'conc', look = wallLook(mkIn), ind = !look;
    const wallMk = ind ? mkIn : look.mk, wtile = ind ? 4 : look.tile;
    const wallHex = ind ? 0xffffff : look.tints[Math.floor(rnd() * look.tints.length)];
    const trimHex = !ind && look.mk === 'brickT' ? 0xe6dfd2 : 0xf2eee4;
    const roofKind = o.roof || 'flat', flatRoof = roofKind === 'flat', roofMk = o.roofMk || 'roof';
    const roofHex = ROOF_TINTS[Math.floor(rnd() * ROOF_TINTS.length)];
    const doors = [].concat(o.door === undefined ? 's' : o.door);
    const dw = o.dw || 1.6, dh = Math.min(o.dh || 2.4, fh - 0.4);
    const shop = !!o.shop && !ind;

    const face = { n: cz - d / 2, s: cz + d / 2, w: cx - w / 2, e: cx + w / 2 };
    const alongOf = (k) => (k === 'n' || k === 's' ? cx : cz) + (o.doorAt || 0);
    const outAt = (k, c, dist) => (k === 'n' || k === 's' ? [c, face[k] + OUT[k][1] * dist] : [face[k] + OUT[k][0] * dist, c]);

    // ---- ground: floor level comes from the ground at the first door ----
    const g = groundRange(cx, cz, w, d);
    const grounded = o.y0 === undefined || Math.abs(o.y0 - heightAt(cx, cz)) < 0.9;
    let y0 = o.y0 ?? heightAt(cx, cz);
    if (grounded) { const [px, pz] = outAt(doors[0], alongOf(doors[0]), 0.8); y0 = heightAt(px, pz); }
    if (grounded && y0 - g.lo > 0.03) {
      const low = g.lo - 0.6;
      box('concD', cx, low, cz, w, y0 - low, d, 3); // foundation visual only
      // Thin walkable floor — full foundation volume blocked the hillside around every building
      addCollider(cx, cz, w - 2 * t, y0, d - 2 * t, { y0: y0 - 0.3, noCover: true });
    }
    const top = y0 + fl * fh;

    const ix0 = cx - w / 2 + t, ix1 = cx + w / 2 - t, iz0 = cz - d / 2 + t, iz1 = cz + d / 2 - t;
    const Lr = fh / 0.75;
    const levels = flatRoof ? fl : fl - 1; // flights of stairs (pitched roofs are not walkable)
    const stairsOn = (o.stairs ?? true) && levels >= 1 && iz1 - iz0 >= Lr + 2.4 && ix1 - ix0 >= 4.2;
    zone(cx, cz, w, d, 4);
    rects.push([cx - w / 2 - 0.6, cz - d / 2 - 0.6, cx + w / 2 + 0.6, cz + d / 2 + 0.6]);

    const sides = {
      n: { ax: 'x', fixed: cz - d / 2 + t / 2, a0: cx - w / 2, a1: cx + w / 2, c0: cx },
      s: { ax: 'x', fixed: cz + d / 2 - t / 2, a0: cx - w / 2, a1: cx + w / 2, c0: cx },
      w: { ax: 'z', fixed: cx - w / 2 + t / 2, a0: iz0, a1: iz1, c0: cz },
      e: { ax: 'z', fixed: cx + w / 2 - t / 2, a0: iz0, a1: iz1, c0: cz },
    };

    // ---- walls ----
    setTint(wallHex, y0);
    const decor = [];
    for (let f = 0; f < fl; f++) {
      const by = y0 + f * fh;
      for (const k of ['n', 's', 'w', 'e']) {
        const s = sides[k], ops = [];
        if (f === 0 && doors.includes(k)) ops.push({ c: s.c0 + (o.doorAt || 0), w: dw, lo: 0, hi: dh, door: true });
        if (o.win !== false) {
          const front = shop && f === 0 && doors.includes(k);
          const gap = front ? 4.4 : o.winGap || 3.6, ww = front ? 2.6 : 1.2;
          const lo = front ? 0.55 : 0.95, hi = front ? Math.min(2.5, fh - 0.45) : Math.min(2.15, fh - 0.45);
          for (let c = s.a0 + 1.8; c <= s.a1 - 1.8; c += gap) {
            if (ops.some((q) => Math.abs(q.c - c) < q.w / 2 + ww / 2 + 0.4)) continue;
            ops.push({ c, w: ww, lo, hi, big: front });
          }
        }
        ops.sort((a, b) => a.c - b.c);
        wallRun(wallMk, s.ax, s.fixed, s.a0, s.a1, by, fh, t, ops, wtile);
        decor.push({ k, by, ops });
      }
    }
    if (o.part && w >= 14) {
      for (let f = 0; f < fl; f++) wallRun(wallMk, 'z', cx + 1.5, iz0, iz1, y0 + f * fh, fh, 0.25, [{ c: cz, w: 1.4, lo: 0, hi: Math.min(2.3, fh - 0.4) }], wtile);
    }

    // ---- floors, ceilings, stairs ----
    const hz0 = iz0 + 0.6, hz1 = hz0 + Lr;
    const col = (i) => (i % 2 === 0 ? [ix0, ix0 + 1.4] : [ix1 - 1.4, ix1]);
    const slab = (x0, x1, z0, z1, sy, m) => {
      if (x1 - x0 > 0.05 && z1 - z0 > 0.05) solid(m, (x0 + x1) / 2, sy, (z0 + z1) / 2, x1 - x0, 0.25, z1 - z0, { tile: 3 });
    };
    for (let j = 1; j <= fl; j++) {
      const sy = y0 + j * fh - 0.25, m = j === fl && flatRoof ? roofMk : 'floor';
      if (stairsOn && j <= levels) {
        const [hx0, hx1] = col(j - 1);
        slab(ix0, hx0, iz0, iz1, sy, m); slab(hx1, ix1, iz0, iz1, sy, m);
        slab(hx0, hx1, hz1, iz1, sy, m); slab(hx0, hx1, iz0, hz0, sy, m);
      } else slab(ix0, ix1, iz0, iz1, sy, m);
    }
    if (stairsOn) {
      for (let i = 0; i < levels; i++) {
        const [a, b] = col(i);
        stairs((a + b) / 2, (hz0 + hz1) / 2, 3, 1.4, Lr, y0 + i * fh, fh);
      }
    }
    flat('pad', cx, cz, w - 2 * t, d - 2 * t, y0 + 0.02);

    // ---- door steps where the ground falls away outside ----
    for (const k of doors) {
      const c = alongOf(k), sample = (dist) => { const [px, pz] = outAt(k, c, dist); return heightAt(px, pz); };
      const r0 = y0 - sample(3);
      if (r0 > 0.18 && r0 < 2.8) {
        const len = Math.max(1.4, Math.min(6, r0 * 2.2)), rise = y0 - sample(len + 0.2);
        if (rise > 0.18) {
          const [sx, sz] = outAt(k, c, len / 2);
          stairs(sx, sz, STEP_DIR[k], dw + 0.8, len, y0 - rise, rise);
        }
      }
    }

    // ---- parapet (flat roofs) ----
    if (flatRoof && o.parapet !== false) {
      solid(wallMk, cx, top, cz - d / 2 + t / 2, w, 1.0, t, { tile: wtile });
      solid(wallMk, cx, top, cz + d / 2 - t / 2, w, 1.0, t, { tile: wtile });
      solid(wallMk, cx - w / 2 + t / 2, top, cz, t, 1.0, d - 2 * t, { tile: wtile });
      solid(wallMk, cx + w / 2 - t / 2, top, cz, t, 1.0, d - 2 * t, { tile: wtile });
    }

    // ---- facade detail ----
    const bandPlates = (y, h, hex) => {
      setTint(hex, null);
      for (const k of ['n', 's', 'w', 'e']) {
        const alongX = k === 'n' || k === 's', len = alongX ? w : d, c0 = alongX ? cx : cz, [nx, nz] = OUT[k];
        const gaps = y < y0 + dh && doors.includes(k) ? [[alongOf(k) - dw / 2 - 0.1, alongOf(k) + dw / 2 + 0.1]] : [];
        let a = c0 - len / 2;
        for (const [g0, g1] of [...gaps, [c0 + len / 2, c0 + len / 2]]) {
          if (g0 - a > 0.2) { const [px, pz] = outAt(k, (a + g0) / 2, 0.03); plate('plasterT', px, y, pz, g0 - a, h, nx, nz, 3); }
          a = g1;
        }
      }
    };
    if (!ind) {
      setTint(trimHex, y0);
      for (const { k, by, ops } of decor) {
        const alongX = k === 'n' || k === 's';
        for (const q of ops) {
          if (q.door) {
            for (const sd of [-1, 1]) {
              const [px, pz] = outAt(k, q.c + sd * (q.w / 2 + 0.07), 0.07);
              box('plasterT', px, by, pz, alongX ? 0.14 : 0.14, q.hi + 0.18, 0.14, 2);
            }
            const [hx, hz] = outAt(k, q.c, 0.07);
            box('plasterT', hx, by + q.hi, hz, alongX ? q.w + 0.28 : 0.14, 0.18, alongX ? 0.14 : q.w + 0.28, 2);
          } else {
            const [px, pz] = outAt(k, q.c, 0.12);
            box('plasterT', px, by + q.lo - 0.07, pz, alongX ? q.w + 0.36 : 0.26, 0.09, alongX ? 0.26 : q.w + 0.36, 2);
            const [lx, lz] = outAt(k, q.c, 0.06);
            box('plasterT', lx, by + q.hi, lz, alongX ? q.w + 0.3 : 0.12, 0.14, alongX ? 0.12 : q.w + 0.3, 2);
          }
        }
      }
      bandPlates(y0, 0.5, 0x77736b); // dark base course
      if (fl >= 2 && look.mk !== 'brickT') for (let f = 1; f < fl; f++) bandPlates(y0 + f * fh - 0.15, 0.28, trimHex);
      if (look.mk === 'sidingT' || rnd() < 0.25) {
        setTint(SHUTTER_TINTS[Math.floor(rnd() * SHUTTER_TINTS.length)], y0);
        for (const { k, by, ops } of decor) {
          const [nx, nz] = OUT[k];
          for (const q of ops) {
            if (q.door || q.big) continue;
            for (const sd of [-1, 1]) {
              const [px, pz] = outAt(k, q.c + sd * (q.w / 2 + 0.32), 0.03);
              plate('plasterT', px, by + q.lo, pz, 0.5, q.hi - q.lo, nx, nz, 2);
            }
          }
        }
      }
      if (shop) { // awning over the front door
        const k = doors[0], [px, pz] = outAt(k, alongOf(k), 0.77);
        const am = ['pRed', 'pBlue', 'pGreen', 'pYellow', 'canvas'][Math.floor(rnd() * 5)];
        wedge(am, px, y0 + dh + 0.15, pz, 1.5, dw + 3.2, 0.55, STEP_DIR[k], 2);
      }
    }
    if (flatRoof && o.parapet !== false) { // cap stones
      setTint(trimHex, null);
      const cm = ind ? 'concD' : 'plasterT';
      box(cm, cx, top + 1.0, cz - d / 2 + t / 2, w + 0.2, 0.1, t + 0.2, 2);
      box(cm, cx, top + 1.0, cz + d / 2 - t / 2, w + 0.2, 0.1, t + 0.2, 2);
      box(cm, cx - w / 2 + t / 2, top + 1.0, cz, t + 0.2, 0.1, d - 2 * t, 2);
      box(cm, cx + w / 2 - t / 2, top + 1.0, cz, t + 0.2, 0.1, d - 2 * t, 2);
    }

    // ---- pitched roofs ----
    if (roofKind === 'gable') {
      setTint(roofHex, null);
      const ov = 0.55, ridgeX = w >= d, half = (ridgeX ? d : w) / 2 + ov, rise = Math.min(3.6, half * 0.42), W = (ridgeX ? w : d) + 2 * ov;
      if (ridgeX) { wedge('shingleT', cx, top, cz - half / 2, half, W, rise, 1, 2); wedge('shingleT', cx, top, cz + half / 2, half, W, rise, 3, 2); }
      else { wedge('shingleT', cx - half / 2, top, cz, half, W, rise, 0, 2); wedge('shingleT', cx + half / 2, top, cz, half, W, rise, 2, 2); }
      if (!ind && rnd() < 0.6) { // chimney
        setTint(0xf0d6c6, null);
        const along = (rnd() - 0.5) * ((ridgeX ? w : d) - 5);
        box('brickT', ridgeX ? cx + along : cx, top, ridgeX ? cz : cz + along, 0.9, rise + 1.0, 0.9, 2);
      }
    } else if (roofKind === 'shed') {
      const ov = 0.5, span = d + 2 * ov;
      wedge(roofMk, cx, top, cz, span, w + 2 * ov, Math.min(2.2, span * 0.12), 3, 3);
    } else if (o.props !== false && d >= 9 && w >= 9) { // rooftop AC units
      const nU = 1 + (rnd() < 0.5 ? 1 : 0);
      for (let u = 0; u < nU; u++) {
        const px = cx + (rnd() - 0.5) * (w - 7), pz = cz + d / 2 - 2.0 - rnd() * 1.2;
        solid('pGrey', px, top, pz, 1.8, 1.1, 1.1, { tile: 1 });
        box('metalD', px, top + 1.1, pz, 1.1, 0.07, 0.9, 1);
      }
    }
    setTint(0xffffff, null);

    // ---- interior props + pickup spots ----
    const mx0 = ix0 + 2.2, mx1 = ix1 - 2.2;
    if (o.props !== false && mx1 - mx0 > 1.6 && iz1 - iz0 > 6.5) {
      for (let f = 0; f <= fl; f++) {
        if (f === fl && !flatRoof) continue;
        const by = y0 + f * fh, n = f === fl ? (rnd() < 0.5 ? 1 : 0) : 1 + (rnd() < 0.5 ? 1 : 0);
        for (let k = 0; k < n; k++) {
          const px = mx0 + rnd() * (mx1 - mx0), pz = iz0 + 2.6 + rnd() * Math.max(0.1, iz1 - iz0 - 5.2), kind = rnd();
          if (f === fl) solid('metalD', px, by, pz, 1.6, 0.9, 1.2, { tile: 1 });
          else if (kind < 0.45) { const s = 0.9 + rnd() * 0.5; solid('wood', px, by, pz, s, s, s, { tile: 1.5 }); }
          else if (kind < 0.75) solid('woodD', px, by, pz, 1.8, 0.85, 0.9, { tile: 1.5 });
          else solid('metalD', px, by, pz, 0.7, 1.9, 0.6, { tile: 1 });
        }
      }
      if (rnd() < 0.7) spots.push({ x: mx0 + rnd() * (mx1 - mx0), z: cz + (rnd() - 0.5) * 2, y: y0 + 0.4 });
      if (fl >= 2 && flatRoof && rnd() < 0.8) spots.push({ x: cx + (rnd() - 0.5) * 3, z: cz + (rnd() - 0.5) * 3, y: top + 0.4 });
    }
    return { top };
  }

  const lamp = (x, y, z) => {
    solid('metalD', x, y, z, 0.2, 5, 0.2, { tile: 1 });
    box('metalD', x, y + 5, z, 0.7, 0.12, 0.12, 1);
    box('lamp', x + 0.4, y + 4.9, z, 0.3, 0.12, 0.3, 1);
  };
  const crates = (x, y, z, nx, nz, lv, tile = 1.2) => {
    const s = 1.2, e = s - 0.03, by = settle(x, z, nx * s, nz * s, y).base;
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) for (let k = 0; k < lv; k++) {
      box('wood', x + (i - (nx - 1) / 2) * s, by + k * s, z + (j - (nz - 1) / 2) * s, e, e, e, tile);
    }
    addCollider(x, z, nx * s, by + lv * s, nz * s, { y0: by });
  };
  const jersey = (x, y, z, axis = 'x') => {
    const L = 3, Wd = 0.7, sx = axis === 'x' ? L : Wd, sz = axis === 'x' ? Wd : L, by = settle(x, z, sx, sz, y).base;
    box('conc', x, by, z, sx, 0.4, sz, 2);
    box('conc', x, by + 0.4, z, axis === 'x' ? L : 0.42, 0.65, axis === 'x' ? 0.42 : L, 2);
    addCollider(x, z, sx, by + 1.05, sz, { y0: by });
  };
  const sandbags = (x, y, z, len, axis = 'x') => {
    const by = settle(x, z, axis === 'x' ? len : 0.8, axis === 'x' ? 0.8 : len, y).base;
    for (let r = 0; r < 4; r++) {
      const o = r % 2 ? 0.2 : 0;
      box('sand', axis === 'x' ? x + o : x, by + r * 0.28, axis === 'x' ? z : z + o, axis === 'x' ? len : 0.8, 0.28, axis === 'x' ? 0.8 : len, 1);
    }
    addCollider(x, z, axis === 'x' ? len : 0.8, by + 1.12, axis === 'x' ? 0.8 : len, { y0: by });
  };
  const barrel = (x, y, z, mk) => {
    const by = settle(x, z, 0.6, 0.6, y).base;
    geo(mk, new THREE.CylinderGeometry(0.3, 0.3, 0.9, 10), [x, by + 0.45, z]);
    addCollider(x, z, 0.45, by + 0.9, 0.45, { y0: by });
  };
  /** slope-following fence (y0 is ignored: posts stand on the ground) */
  const fence = (x0, y0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.ceil(len / 3));
    const px = (i) => x0 + ((x1 - x0) * i) / n, pz = (i) => z0 + ((z1 - z0) * i) / n, gy = (i) => heightAt(px(i), pz(i));
    for (let i = 0; i <= n; i++) box('woodD', px(i), gy(i) - 0.2, pz(i), 0.15, 1.45, 0.15, 1);
    const yaw = Math.atan2(-(z1 - z0), x1 - x0);
    for (let i = 0; i < n; i++) {
      const ga = gy(i), gb = gy(i + 1), sl = Math.hypot(px(i + 1) - px(i), pz(i + 1) - pz(i));
      const mx = (px(i) + px(i + 1)) / 2, mz = (pz(i) + pz(i + 1)) / 2, pitch = Math.atan2(gb - ga, sl);
      for (const yy of [0.5, 0.95]) geo('woodD', new THREE.BoxGeometry(sl + 0.05, 0.1, 0.06), [mx, (ga + gb) / 2 + yy, mz], [0, yaw, pitch]);
      // IMPORTANT: do NOT use one AABB spanning the segment — diagonal runs filled the whole
      // rectangle with solid collision (invisible walls all over farms / POIs).
      // Chain small upright boxes along the rail instead.
      const steps = Math.max(1, Math.ceil(sl / 0.55));
      for (let s = 0; s < steps; s++) {
        const u = (s + 0.5) / steps;
        const cx = px(i) + (px(i + 1) - px(i)) * u;
        const cz = pz(i) + (pz(i + 1) - pz(i)) * u;
        const gy = heightAt(cx, cz);
        addCollider(cx, cz, 0.32, gy + 1.15, 0.32, { y0: gy, noCover: true });
      }
    }
  };
  const car = (x, y, z, ry, mk) => {
    y = settle(x, z, 4.4, 4.4, y).base;
    const c = Math.cos(ry), s = Math.sin(ry);
    const at = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
    box(mk, x, y + 0.3, z, 4.2, 0.7, 1.8, 2, ry);
    const cab = at(-0.3, 0);
    box('glass', cab[0], y + 1.0, cab[1], 2.2, 0.62, 1.6, 2, ry);
    for (const [lx, lz] of [[1.3, 0.95], [1.3, -0.95], [-1.3, 0.95], [-1.3, -0.95]]) {
      const w = at(lx, lz);
      box('tire', w[0], y, w[1], 0.7, 0.7, 0.3, 1, ry);
    }
    // Oriented-ish footprint: chain 3 small boxes along the car long axis so diagonals don't
    // create a giant AABB (same class of bug as the old fence colliders).
    const fx = Math.sin(ry), fz = Math.cos(ry);
    const L = 4.0, W = 1.7, n = 3;
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * ((L - W) / Math.max(1, n - 1));
      addCollider(x + fx * off, z + fz * off, W, y + 1.35, W, { y0: y, noCover: true });
    }
  };
  function container(x, y, z, axis, mk, lvl = 0) {
    const L = 6.1, H = 2.6, W = 2.45, sw = axis === 'x' ? L : W, sd = axis === 'x' ? W : L;
    const y0 = settle(x, z, sw, sd, y).base + lvl * H;
    box(mk, x, y0, z, sw, H, sd, 2.4);
    for (const a of [-1, 1]) for (const b of [-1, 1]) box('metalD', x + a * (sw / 2 - 0.06), y0, z + b * (sd / 2 - 0.06), 0.12, H + 0.02, 0.12, 1);
    box('metalD', x + (axis === 'x' ? sw / 2 : 0), y0 + 0.15, z + (axis === 'x' ? 0 : sd / 2), axis === 'x' ? 0.05 : W - 0.3, H - 0.3, axis === 'x' ? W - 0.3 : 0.05, 1);
    addCollider(x, z, sw, y0 + H, sd, { y0, noCover: lvl > 0 });
  }
  function silo(x, y, z, r = 3, h = 14) {
    const by = settle(x, z, r * 2, r * 2, y).base;
    geo('metal', new THREE.CylinderGeometry(r, r, h + 0.3, 14), [x, by - 0.3 + (h + 0.3) / 2, z]);
    geo('roofB', new THREE.ConeGeometry(r * 1.05, 2, 14), [x, by + h + 1, z]);
    addCollider(x, z, r * 1.05, by + h, r * 1.05, { y0: by });
    zone(x, z, r * 2, r * 2, 3);
  }
  function watchtower(x, y, z, hgt = 7, dir = 0) {
    const st = settle(x, z, 4.4, 4.4, y), yb = st.snap ? st.g.hi : y; // platform base level
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const lx = x + sx * 1.9, lz = z + sz * 1.9, lb = st.snap ? heightAt(lx, lz) - 0.3 : y; // each leg reaches its own ground
        solid('metalD', lx, lb, lz, 0.4, yb + hgt - lb, 0.4, { tile: 1 });
      }
    }
    solid('floor', x, yb + hgt - 0.25, z, 4.8, 0.25, 4.8);
    for (let k = 0; k < 4; k++) {
      if (k === (dir + 2) % 4) continue;
      if (k % 2 === 0) solid('metalD', x + DX[k] * 2.3, yb + hgt, z, 0.12, 1.0, 4.8, { tile: 1 });
      else solid('metalD', x, yb + hgt, z + DZ[k] * 2.3, 4.8, 1.0, 0.12, { tile: 1 });
    }
    solid('roof', x, yb + hgt + 2.6, z, 5.4, 0.2, 5.4);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) box('metalD', x + sx * 2.5, yb + hgt, z + sz * 2.5, 0.15, 2.6, 0.15, 1);
    const len = hgt / 0.75, fx = x - DX[dir] * (2.4 + len), fz = z - DZ[dir] * (2.4 + len);
    const foot = st.snap ? Math.min(yb, heightAt(fx, fz)) : y;
    stairs(x - DX[dir] * (2.4 + len / 2), z - DZ[dir] * (2.4 + len / 2), dir, 1.6, len, foot, yb + hgt - foot, 'metalD');
    zone(x - DX[dir] * len / 2, z - DZ[dir] * len / 2, len + 8, len + 8, 2);
    spots.push({ x, z, y: yb + hgt + 0.4 });
  }
  const ruinWall = (x, y, z, len, axis = 'x') => {
    const a = len * 0.62, b = len * 0.38, t = 0.4;
    const piece = (u0, l, h) => {
      const sx = axis === 'x' ? l : t, sz = axis === 'x' ? t : l;
      solid('concD', axis === 'x' ? x + u0 : x, y, axis === 'x' ? z : z + u0, sx, h, sz, { tile: 3, ground: true, nc: false });
    };
    piece(-len / 2 + a / 2, a, 2.8);
    piece(len / 2 - b / 2, b, 1.4);
  };

  return {
    mats, box, flat, drape, plate, road, roadMarks, disc, wedge, geo, solid, wallRun, stairs, building, lamp, crates, jersey, sandbags,
    barrel, fence, car, container, silo, watchtower, ruinWall, zone, blocked, inRect, setRoads, roadNear, groundRange, setTint,
    zones, spots, finish, setRng: (r) => { R.rng = r; },
  };
}
