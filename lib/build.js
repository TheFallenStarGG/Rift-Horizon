/**
 * Fortnite-style building: walls, floors, stair-ramps on a 4 m grid. Snap-to-look placement with a hologram ghost, pieces grow in
 * (blueprint shimmer), damage + shatter, and 3x3 tile EDITING (doors, windows, holes) incl. pre-edit of the next piece.
 * spec = { type, ix, iz, lv, o, tier, e? }  (e = bitmask of REMOVED tiles, bit = row * 3 + col)
 */
import * as THREE from 'three';
import { addCollider, addRamp, removeCollider, queryRect, raycastWorld } from './collision.js';

export const TILE = 4;
export const HEIGHT = 3;
export const SLAB = 0.25;
export const WALL_T = 0.22;
export const MAX_PIECES = 450;
export const MAX_LEVEL = 12;
export const COST = { wall: 10, floor: 10, ramp: 10 };
export const TIERS = [
  { name: 'Wood', hp: 140, tex: 'wood', color: 0xffffff, glow: 0xffb25e },
  { name: 'Stone', hp: 280, tex: 'concrete', color: 0xffffff, glow: 0xa8ccff },
  { name: 'Metal', hp: 420, tex: 'metal', color: 0xb4c2d4, glow: 0x7fe6ff },
];
export const TYPES = ['wall', 'floor', 'ramp'];
/** Online edits need the worker to keep spec.e (see worker cleanSpec). Leave false until the server is updated. */
export const ONLINE_EDITS = true;
export const EDIT_FULL = 511;

const CW = TILE / 3, CH = HEIGHT / 3;
const DX = [1, 0, -1, 0], DZ = [0, 1, 0, -1];
const RAMP_ROT = [0, -Math.PI / 2, Math.PI, Math.PI / 2];
const GROW = 0.3, PLACE_CD = 0.075, MATS_CAP = 500, MATS_REGEN = 10;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const easeBack = (k) => { const c = 1.25, x = k - 1; return 1 + (c + 1) * x * x * x + c * x * x; };

// ---------- geometry builder (flat-shaded boxes with vertex-colour shading, world-scaled UVs) ----------
const FACES = [
  { n: [1, 0, 0], a: 0, v: [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]] },
  { n: [-1, 0, 0], a: 0, v: [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]] },
  { n: [0, 1, 0], a: 1, v: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
  { n: [0, -1, 0], a: 1, v: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
  { n: [0, 0, 1], a: 2, v: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
  { n: [0, 0, -1], a: 2, v: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
];
const newB = () => ({ p: [], n: [], u: [], c: [], i: [] });

/** box centred at (cx,cy,cz), size w,h,d; optional rotation about z (rz) then x (rx); sh = vertex shade */
function box(b, cx, cy, cz, w, h, d, sh = 1, rz = 0, rx = 0) {
  const hw = w / 2, hh = h / 2, hd = d / 2;
  const cr = Math.cos(rz), sr = Math.sin(rz), cx2 = Math.cos(rx), sx2 = Math.sin(rx);
  for (const f of FACES) {
    const base = b.p.length / 3;
    let nx = f.n[0], ny = f.n[1], nz = f.n[2];
    if (rz) { const t = nx * cr - ny * sr; ny = nx * sr + ny * cr; nx = t; }
    if (rx) { const t = ny * cx2 - nz * sx2; nz = ny * sx2 + nz * cx2; ny = t; }
    for (const v of f.v) {
      let x = v[0] * hw, y = v[1] * hh, z = v[2] * hd;
      if (rz) { const t = x * cr - y * sr; y = x * sr + y * cr; x = t; }
      if (rx) { const t = y * cx2 - z * sx2; z = y * sx2 + z * cx2; y = t; }
      x += cx; y += cy; z += cz;
      b.p.push(x, y, z);
      b.n.push(nx, ny, nz);
      b.c.push(sh, sh, sh);
      if (f.a === 0) b.u.push(z / 2, y / 2); else if (f.a === 1) b.u.push(x / 2, z / 2); else b.u.push(x / 2, y / 2);
    }
    b.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
}
function toGeo(b) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(b.u, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(b.c, 3));
  g.setIndex(b.i);
  g.computeBoundingSphere();
  return g;
}

/** wall runs along z (thin in x), origin = base centre. mask = removed tiles */
function buildWall(tier, mask) {
  const b = newB(), T = WALL_T, tw = 0.1;
  const has = (c, r) => c >= 0 && c < 3 && r >= 0 && r < 3 && !((mask >> (r * 3 + c)) & 1);
  const pt = tier === 0 ? 0.13 : tier === 1 ? 0.17 : 0.1;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (!has(c, r)) continue;
      const z0 = -TILE / 2 + c * CW, y0 = r * CH, zc = z0 + CW / 2, yc = y0 + CH / 2;
      if (tier === 0) { // vertical planks
        const pw = CW / 3;
        for (let k = 0; k < 3; k++) box(b, 0, yc, z0 + pw * (k + 0.5), pt, CH - 0.02, pw - 0.014, 0.88 + 0.12 * ((k + r) % 2));
      } else if (tier === 1) { // two block courses, staggered
        const off = ((r + c) & 1) ? 0.018 : -0.018;
        box(b, off, y0 + CH * 0.25, zc, pt, CH * 0.5 - 0.014, CW - 0.014, 0.97);
        box(b, -off, y0 + CH * 0.75, zc, pt, CH * 0.5 - 0.014, CW - 0.014, 1.06);
      } else { // metal plate + rivets + cross brace
        box(b, 0, yc, zc, pt, CH - 0.02, CW - 0.02, 1);
        for (const sz of [-1, 1]) for (const sy of [-1, 1]) box(b, pt / 2 + 0.012, yc + sy * (CH / 2 - 0.1), zc + sz * (CW / 2 - 0.1), 0.03, 0.05, 0.05, 1.25);
        const len = Math.hypot(CW, CH) - 0.25;
        box(b, pt / 2 + 0.01, yc, zc, 0.025, len, 0.07, 0.78, 0, Math.atan2(CW, CH));
      }
      // frame trim on every side that borders the outside or a removed tile
      if (!has(c - 1, r)) box(b, 0, yc, z0 + tw / 2, T, CH, tw, 0.68);
      if (!has(c + 1, r)) box(b, 0, yc, z0 + CW - tw / 2, T, CH, tw, 0.68);
      if (!has(c, r - 1)) box(b, 0, y0 + tw / 2, zc, T, tw, CW, 0.68);
      if (!has(c, r + 1)) box(b, 0, y0 + CH - tw / 2, zc, T, tw, CW, 0.68);
    }
  }
  return toGeo(b);
}

/** floor slab, origin = base centre, cells: col along x, row along z */
function buildFloor(tier, mask) {
  const b = newB(), tw = 0.1;
  const has = (c, r) => c >= 0 && c < 3 && r >= 0 && r < 3 && !((mask >> (r * 3 + c)) & 1);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (!has(c, r)) continue;
      const x0 = -TILE / 2 + c * CW, z0 = -TILE / 2 + r * CW, xc = x0 + CW / 2, zc = z0 + CW / 2;
      box(b, xc, SLAB / 2, zc, CW - 0.006, SLAB, CW - 0.006, 1);
      if (tier === 0) for (let k = 1; k < 3; k++) box(b, xc, SLAB + 0.002, z0 + (CW / 3) * k, CW - 0.02, 0.008, 0.014, 0.55); // plank seams
      else if (tier === 2) for (const s of [-1, 1]) box(b, xc + s * CW * 0.3, SLAB + 0.004, zc, 0.05, 0.012, CW * 0.55, 1.18); // tread strips
      if (!has(c, r - 1)) box(b, xc, SLAB / 2 + 0.006, z0 + tw / 2, CW, SLAB + 0.012, tw, 0.66);
      if (!has(c, r + 1)) box(b, xc, SLAB / 2 + 0.006, z0 + CW - tw / 2, CW, SLAB + 0.012, tw, 0.66);
      if (!has(c - 1, r)) box(b, x0 + tw / 2, SLAB / 2 + 0.006, zc, tw, SLAB + 0.012, CW, 0.66);
      if (!has(c + 1, r)) box(b, x0 + CW - tw / 2, SLAB / 2 + 0.006, zc, tw, SLAB + 0.012, CW, 0.66);
    }
  }
  return toGeo(b);
}

/** real stairs rising toward +x: 12 treads + risers, side stringers, posts + handrails. Open underneath. */
function buildRamp(tier) {
  const b = newB(), N = 12, L = TILE, R = HEIGHT, run = L / N, rise = R / N, slope = R / L, ang = Math.atan(slope);
  const zs = TILE / 2 - 0.07;
  for (let i = 0; i < N; i++) {
    const x0 = -L / 2 + i * run, top = rise * (i + 0.5);
    box(b, x0 + run / 2, top - 0.05, 0, run + 0.02, 0.1, TILE - 0.3, 1);
    box(b, x0 + 0.02, top - rise / 2 - 0.05, 0, 0.04, rise, TILE - 0.3, 0.8);
  }
  const len = Math.hypot(L, R) + 0.2;
  for (const s of [-1, 1]) {
    box(b, 0, R / 2 - 0.2, s * zs, len, 0.34, 0.14, 0.7, ang);
    for (const x of [-1.7, -0.85, 0, 0.85, 1.7]) {
      const y = slope * (x + L / 2);
      box(b, x, y + 0.42, s * zs, 0.07, 0.84, 0.07, 0.62);
    }
    box(b, 0, R / 2 + 0.84, s * zs, len, 0.07, 0.09, 0.62, ang);
  }
  if (tier === 2) for (let i = 0; i < N; i += 2) box(b, -L / 2 + (i + 0.5) * run, rise * (i + 0.5) + 0.002, 0, 0.05, 0.012, TILE - 0.5, 1.2);
  return toGeo(b);
}

// ---------- spec helpers ----------
export const specKey = (s) => `${s.type}:${s.ix}:${s.iz}:${s.lv}:${s.o}`;

function specGeom(s) {
  const cx = s.ix * TILE, cz = s.iz * TILE, yb = s.lv * HEIGHT;
  let g;
  if (s.type === 'wall') {
    const along = s.o === 0;
    g = {
      x: cx + (along ? TILE / 2 : 0), z: cz + (along ? 0 : TILE / 2), y: yb + HEIGHT / 2,
      w: along ? WALL_T : TILE, h: HEIGHT, d: along ? TILE : WALL_T, y0: yb, top: yb + HEIGHT, ry: along ? 0 : Math.PI / 2, base: yb,
    };
  } else if (s.type === 'floor') {
    g = { x: cx, z: cz, y: yb + SLAB / 2, w: TILE, h: SLAB, d: TILE, y0: yb, top: yb + SLAB, ry: 0, base: yb };
  } else {
    g = { x: cx, z: cz, y: yb + SLAB, w: TILE, h: HEIGHT, d: TILE, y0: yb + SLAB, top: yb + SLAB + HEIGHT, ry: RAMP_ROT[s.o], base: yb + SLAB };
  }
  g.type = s.type;
  g.minX = g.x - g.w / 2; g.maxX = g.x + g.w / 2; g.minZ = g.z - g.d / 2; g.maxZ = g.z + g.d / 2;
  return g;
}
const canEditType = (t) => t === 'wall' || t === 'floor';

/** which tile (0..8) of target g does the ray hit? -1 = none */
function rayTile(g, o, d, maxT) {
  const c = Math.cos(g.ry), s = Math.sin(g.ry);
  const ox = o.x - g.x, oy = o.y - g.base, oz = o.z - g.z;
  const lx = ox * c - oz * s, lz = ox * s + oz * c;
  const dx = d.x * c - d.z * s, dz = d.x * s + d.z * c, dy = d.y;
  if (g.type === 'wall') {
    if (Math.abs(dx) < 1e-6) return -1;
    const t = -lx / dx;
    if (t < 0 || t > maxT) return -1;
    const hz = lz + dz * t, hy = oy + dy * t;
    if (Math.abs(hz) > TILE / 2 || hy < 0 || hy > HEIGHT) return -1;
    return clamp(Math.floor(hy / CH), 0, 2) * 3 + clamp(Math.floor((hz + TILE / 2) / CW), 0, 2);
  }
  if (Math.abs(dy) < 1e-6) return -1;
  const t = (SLAB - oy) / dy;
  if (t < 0 || t > maxT) return -1;
  const hx = lx + dx * t, hz = lz + dz * t;
  if (Math.abs(hx) > TILE / 2 || Math.abs(hz) > TILE / 2) return -1;
  return clamp(Math.floor((hz + TILE / 2) / CW), 0, 2) * 3 + clamp(Math.floor((hx + TILE / 2) / CW), 0, 2);
}

/**
 * hooks: onPlace(spec, piece, remote), onEdit(spec, piece), onBreak(piece), onHit(piece), onDenied(reason: 'mats'|'occupied'|'blocked'|'level')
 */
export function createBuild(scene, tex, hooks = {}) {
  const pieces = new Map();
  const order = [];
  const geoCache = new Map();
  const edgeCache = new Map();
  const getGeo = (type, tier, mask) => {
    const k = type === 'ramp' ? 'ramp' + tier : `${type}${tier}:${mask}`;
    let g = geoCache.get(k);
    if (!g) {
      g = type === 'wall' ? buildWall(tier, mask) : type === 'floor' ? buildFloor(tier, mask) : buildRamp(tier);
      geoCache.set(k, g);
    }
    return g;
  };
  const getEdges = (geo) => {
    let e = edgeCache.get(geo);
    if (!e) { e = new THREE.EdgesGeometry(geo, 35); edgeCache.set(geo, e); }
    return e;
  };
  const tierMats = TIERS.map((t) => new THREE.MeshStandardMaterial({
    color: t.color, map: tex[t.tex], roughness: 0.85, metalness: t.tex === 'metal' ? 0.5 : 0, vertexColors: true,
  }));
  const debMats = TIERS.map((t) => new THREE.MeshStandardMaterial({ color: t.color, map: tex[t.tex], roughness: 0.85, metalness: t.tex === 'metal' ? 0.5 : 0 }));

  // ghost (hologram of the real shape + crisp edges)
  const ghostMat = new THREE.MeshBasicMaterial({ color: 0x55ff88, transparent: true, opacity: 0.26, depthWrite: false });
  const ghost = new THREE.Mesh(getGeo('wall', 0, 0), ghostMat);
  const ghostLineMat = new THREE.LineBasicMaterial({ color: 0x9dffc0, transparent: true, opacity: 0.95 });
  const ghostLines = new THREE.LineSegments(getEdges(ghost.geometry), ghostLineMat);
  ghost.visible = ghostLines.visible = false;
  ghost.renderOrder = ghostLines.renderOrder = 5;
  scene.add(ghost, ghostLines);

  let active = false, type = 'wall', tier = 0, mats = 300, cd = 0, time = 0, lastDir = 0;
  let lastWhy = null, lastSpec = null, placedCount = 0;
  const tpl = { wall: 0, floor: 0 }; // pre-edit mask for the next wall / floor

  function setTransform(obj, g) {
    obj.position.set(g.x, g.base, g.z);
    obj.rotation.set(0, g.ry, 0);
  }

  // ---------- grow-in effect ----------
  const growing = new Set();
  const fxPool = [];
  const emptyGeo = new THREE.BufferGeometry();
  function takeFx() {
    let f = fxPool.find((x) => !x.used);
    if (!f) {
      if (fxPool.length >= 16) return null;
      const mat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      const mesh = new THREE.Mesh(emptyGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 4;
      scene.add(mesh);
      f = { mesh, mat, used: false };
      fxPool.push(f);
    }
    f.used = true;
    return f;
  }
  function freeFx(pc) {
    if (!pc.fx) return;
    pc.fx.used = false;
    pc.fx.mesh.visible = false;
    pc.fx = null;
  }
  function startGrow(pc) {
    pc.gt = 0;
    growing.add(pc);
    const f = takeFx();
    if (f) {
      f.mesh.geometry = pc.mesh.geometry;
      f.mat.color.setHex(TIERS[pc.spec.tier].glow);
      f.mesh.visible = true;
      pc.fx = f;
    }
    stepGrow1(pc, 0);
  }
  function stepGrow1(pc, dt) {
    pc.gt += dt;
    const k = Math.min(1, pc.gt / GROW), e = Math.max(0.02, easeBack(k)), m = pc.mesh, t = pc.spec.type;
    if (t === 'wall') m.scale.set(1 + (1 - k) * 0.6, e, 1);
    else if (t === 'floor') m.scale.set(e, 1, e);
    else m.scale.set(1, e, 1);
    if (pc.fx) {
      const o = pc.fx.mesh;
      o.position.copy(m.position); o.rotation.copy(m.rotation);
      o.scale.copy(m.scale).multiplyScalar(1.015);
      pc.fx.mat.opacity = (1 - k) * 0.8;
    }
    if (k >= 1) { m.scale.set(1, 1, 1); growing.delete(pc); freeFx(pc); }
  }
  const stepGrow = (dt) => { for (const pc of growing) stepGrow1(pc, dt); };

  // ---------- placement target ----------
  function rampUnder(p) {
    const list = queryRect(p.x - 0.1, p.z - 0.1, p.x + 0.1, p.z + 0.1);
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.ramp && c.piece && p.x >= c.minX && p.x <= c.maxX && p.z >= c.minZ && p.z <= c.maxZ &&
        p.y >= c.y0 - 0.1 && p.y <= c.h + 0.5) return c.piece;
    }
    return null;
  }

  /** facing direction with hysteresis so the ghost doesn't flicker on the diagonals */
  function facing(yaw) {
    const u = Math.atan2(-Math.cos(yaw), -Math.sin(yaw)) / (Math.PI / 2); // 0 = +x, 1 = +z
    const diff = ((u - lastDir) % 4 + 6) % 4 - 2;
    if (Math.abs(diff) > 0.62) lastDir = ((Math.round(u) % 4) + 4) % 4;
    return lastDir;
  }

  /** p = { x, y, z, yaw, pitch } (pitch > 0 = looking up) */
  function target(p) {
    const ix = Math.round(p.x / TILE), iz = Math.round(p.z / TILE);
    const dir = facing(p.yaw);
    let lv = Math.max(0, Math.round((p.y - SLAB) / HEIGHT));
    const up = p.pitch > 0.45, down = p.pitch < -0.6;
    let s;
    if (type === 'wall') {
      if (up) lv++;
      s = dir === 0 ? { ix, iz, o: 0 } : dir === 1 ? { ix, iz, o: 1 } : dir === 2 ? { ix: ix - 1, iz, o: 0 } : { ix, iz: iz - 1, o: 1 };
    } else if (type === 'floor') {
      if (up) lv++;
      s = down ? { ix, iz, o: 0 } : { ix: ix + DX[dir], iz: iz + DZ[dir], o: 0 };
    } else {
      const on = rampUnder(p);
      if (on) lv = on.spec.lv + 1; // keep climbing: the next ramp starts where this one ends
      s = { ix: ix + DX[dir], iz: iz + DZ[dir], o: dir };
    }
    s.type = type; s.lv = lv; s.tier = tier;
    if (canEditType(type) && tpl[type]) s.e = tpl[type];
    return s;
  }

  function check(s, free) {
    if (s.lv < 0 || s.lv > MAX_LEVEL) return 'level';
    if (pieces.has(specKey(s))) return 'occupied';
    const g = specGeom(s);
    const list = queryRect(g.minX, g.minZ, g.maxX, g.maxZ);
    for (let i = 0; i < list.length; i++) {
      const c = list[i];
      if (c.piece) continue;
      if (c.y0 < g.top - 0.1 && c.h > g.y0 + 0.1) {
        const ox = Math.min(c.maxX, g.maxX) - Math.max(c.minX, g.minX);
        const oz = Math.min(c.maxZ, g.maxZ) - Math.max(c.minZ, g.minZ);
        if (ox > 0.08 && oz > 0.08) return 'blocked';
      }
    }
    if (!free && mats < COST[s.type]) return 'mats';
    return null;
  }

  // ---------- colliders (one box per remaining tile of an edited piece) ----------
  function makeCols(pc) {
    const g = pc.geom, s = pc.spec, mask = s.e | 0, cols = [];
    if (s.type === 'ramp') cols.push(addRamp(g.x, g.z, g.w, g.d, g.y0, g.top, s.o, { piece: pc, mesh: pc.mesh }));
    else if (!mask) cols.push(addCollider(g.x, g.z, g.w, g.top, g.d, { y0: g.y0, piece: pc, mesh: pc.mesh, noCover: s.type === 'floor' }));
    else {
      for (let i = 0; i < 9; i++) {
        if ((mask >> i) & 1) continue;
        const c = i % 3, r = (i / 3) | 0, off = -TILE / 2 + CW * (c + 0.5);
        if (s.type === 'wall') {
          const y0 = g.y0 + r * CH, along = s.o === 0;
          cols.push(addCollider(along ? g.x : g.x + off, along ? g.z + off : g.z, along ? WALL_T : CW, y0 + CH, along ? CW : WALL_T, { y0, piece: pc, mesh: pc.mesh }));
        } else {
          cols.push(addCollider(g.x + off, g.z - TILE / 2 + CW * (r + 0.5), CW, g.top, CW, { y0: g.y0, piece: pc, mesh: pc.mesh, noCover: true }));
        }
      }
    }
    pc.cols = cols;
    pc.col = cols[0] || null;
  }
  const dropCols = (pc) => { for (const c of pc.cols) removeCollider(c); pc.cols = []; pc.col = null; };

  // ---------- pieces ----------
  function create(s) {
    const g = specGeom(s), mask = (s.e | 0) & EDIT_FULL;
    const mesh = new THREE.Mesh(getGeo(s.type, s.tier, mask), tierMats[s.tier]);
    setTransform(mesh, g);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
    const spec = { type: s.type, ix: s.ix, iz: s.iz, lv: s.lv, o: s.o, tier: s.tier };
    if (mask) spec.e = mask;
    const piece = {
      key: specKey(s), spec, mesh, col: null, cols: [], hp: TIERS[s.tier].hp, maxHp: TIERS[s.tier].hp, damaged: false, geom: g, gt: 1, fx: null,
    };
    makeCols(piece);
    pieces.set(piece.key, piece);
    order.push(piece.key);
    startGrow(piece);
    while (pieces.size > MAX_PIECES && order.length) {
      const old = pieces.get(order.shift());
      if (old) destroy(old, true);
    }
    return piece;
  }

  function place(spec, o = {}) {
    const key = specKey(spec);
    if (o.remote && pieces.has(key)) { // a remote "place" on an existing key = an edit of that piece
      const pc = pieces.get(key);
      if (((spec.e | 0) !== (pc.spec.e | 0)) && canEditType(pc.spec.type)) applyEdit(pc, spec.e | 0, true);
      return pc;
    }
    const why = check(spec, !!o.remote);
    if (why) {
      if (!o.remote && hooks.onDenied) hooks.onDenied(why);
      return null;
    }
    if (!o.remote) { mats -= COST[spec.type]; placedCount++; }
    const piece = create(spec);
    if (hooks.onPlace) hooks.onPlace(piece.spec, piece, !!o.remote);
    return piece;
  }

  // ---------- break effects ----------
  const debGeo = new THREE.BoxGeometry(0.2, 0.2, 0.2);
  const debris = [];
  let dIdx = 0;
  function burst(piece) {
    const g = piece.geom, s = piece.spec;
    for (let i = 0; i < 10; i++) {
      let d;
      if (debris.length < 48) {
        const m = new THREE.Mesh(debGeo, debMats[s.tier]);
        m.castShadow = true;
        scene.add(m);
        d = { m, v: new THREE.Vector3(), w: new THREE.Vector3(), life: 0 };
        debris.push(d);
      } else d = debris[dIdx++ % debris.length];
      d.m.material = debMats[s.tier];
      d.m.visible = true;
      d.m.scale.setScalar(0.6 + Math.random() * 1.2);
      d.m.position.set(
        g.x + (Math.random() - 0.5) * g.w,
        (g.y0 + g.top) / 2 + (Math.random() - 0.5) * (g.top - g.y0),
        g.z + (Math.random() - 0.5) * g.d,
      );
      d.v.set((Math.random() - 0.5) * 6, 1 + Math.random() * 4, (Math.random() - 0.5) * 6);
      d.w.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12);
      d.life = 1.3 + Math.random() * 0.6;
    }
  }
  function updateDebris(dt) {
    for (const d of debris) {
      if (d.life <= 0) continue;
      d.life -= dt;
      if (d.life <= 0) { d.m.visible = false; continue; }
      d.v.y -= 12 * dt;
      d.m.position.addScaledVector(d.v, dt);
      if (d.m.position.y < 0.1) {
        d.m.position.y = 0.1;
        d.v.y *= -0.3; d.v.x *= 0.6; d.v.z *= 0.6; d.w.multiplyScalar(0.5);
      }
      d.m.rotation.x += d.w.x * dt; d.m.rotation.y += d.w.y * dt; d.m.rotation.z += d.w.z * dt;
      if (d.life < 0.3) d.m.scale.multiplyScalar(1 - dt * 3);
    }
  }

  function destroy(piece, silent) {
    if (!piece || !pieces.has(piece.key)) return;
    if (edit.on && edit.piece === piece) closeEdit();
    growing.delete(piece);
    freeFx(piece);
    scene.remove(piece.mesh);
    if (piece.damaged) piece.mesh.material.dispose();
    dropCols(piece);
    pieces.delete(piece.key);
    if (!silent) {
      burst(piece);
      if (hooks.onBreak) hooks.onBreak(piece);
    }
  }

  /** target: a collider (from raycastWorld result .c) or a piece. Returns { destroyed, hp } or null. */
  function damage(tg, dmg) {
    const pc = tg && (tg.spec ? tg : tg.piece);
    if (!pc || !pieces.has(pc.key)) return null;
    pc.hp -= dmg;
    if (pc.hp <= 0) { destroy(pc); return { destroyed: true, hp: 0 }; }
    if (!pc.damaged) { pc.damaged = true; pc.mesh.material = tierMats[pc.spec.tier].clone(); }
    pc.mesh.material.color.set(TIERS[pc.spec.tier].color).multiplyScalar(0.4 + 0.6 * (pc.hp / pc.maxHp));
    if (hooks.onHit) hooks.onHit(pc);
    return { destroyed: false, hp: pc.hp };
  }

  // ---------- editing ----------
  const edit = { on: false, piece: null, spec: null, g: null, mask: 0, orig: 0, hover: -1 };
  const grid = new THREE.Group();
  grid.visible = false;
  const cellGeo = new THREE.PlaneGeometry(1, 1);
  const cellEdge = new THREE.EdgesGeometry(cellGeo);
  const cells = [];
  for (let i = 0; i < 9; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: 0x4aa8ff, transparent: true, opacity: 0.14, side: THREE.DoubleSide, depthTest: false, depthWrite: false });
    const m = new THREE.Mesh(cellGeo, mat);
    const line = new THREE.LineSegments(cellEdge, new THREE.LineBasicMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0.85, depthTest: false }));
    m.add(line);
    m.renderOrder = 30; line.renderOrder = 31;
    grid.add(m);
    cells.push(m);
  }
  scene.add(grid);

  function layoutGrid() {
    const g = edit.g;
    setTransform(grid, g);
    for (let i = 0; i < 9; i++) {
      const c = i % 3, r = (i / 3) | 0, m = cells[i];
      m.rotation.set(0, 0, 0);
      if (g.type === 'wall') {
        m.rotation.y = Math.PI / 2;
        m.position.set(0, CH * (r + 0.5), -TILE / 2 + CW * (c + 0.5));
        m.scale.set(CW - 0.05, CH - 0.05, 1);
      } else {
        m.rotation.x = -Math.PI / 2;
        m.position.set(-TILE / 2 + CW * (c + 0.5), SLAB + 0.03, -TILE / 2 + CW * (r + 0.5));
        m.scale.set(CW - 0.05, CW - 0.05, 1);
      }
    }
    grid.visible = true;
  }
  function paintGrid() {
    for (let i = 0; i < 9; i++) {
      const m = cells[i].material, gone = (edit.mask >> i) & 1, hov = i === edit.hover;
      m.color.setHex(gone ? 0xff4d4d : hov ? 0xffe14a : 0x4aa8ff);
      m.opacity = gone ? (hov ? 0.6 : 0.42) : hov ? 0.42 : 0.12;
    }
  }
  function previewMask() {
    const s = edit.spec;
    const geo = getGeo(s.type, s.tier, edit.mask);
    if (edit.piece) { edit.piece.mesh.geometry = geo; if (edit.piece.fx) edit.piece.fx.mesh.geometry = geo; }
    else { ghost.geometry = geo; ghostLines.geometry = getEdges(geo); }
  }
  function closeEdit() {
    if (edit.piece) {
      const geo = getGeo(edit.spec.type, edit.spec.tier, edit.piece.spec.e | 0);
      edit.piece.mesh.geometry = geo;
    }
    edit.on = false; edit.piece = null; edit.hover = -1;
    grid.visible = false;
  }
  function applyEdit(pc, mask, remote) {
    dropCols(pc);
    if (mask) pc.spec.e = mask; else delete pc.spec.e;
    pc.mesh.geometry = getGeo(pc.spec.type, pc.spec.tier, mask);
    if (pc.fx) pc.fx.mesh.geometry = pc.mesh.geometry;
    makeCols(pc);
    if (!remote) { // game.js's onPlace hook already forwards the spec to the server (it now includes the tile mask)
      if (hooks.onEdit) hooks.onEdit(pc.spec, pc);
      else if (hooks.onPlace) hooks.onPlace(pc.spec, pc, false);
    }
  }

  /** piece = a built piece to edit, or null to pre-edit the next piece (the ghost). Returns null or an error string. */
  function beginEdit(piece) {
    let spec, g, mask;
    if (piece) {
      if (!canEditType(piece.spec.type)) return 'type';
      spec = piece.spec; g = piece.geom; mask = piece.spec.e | 0;
    } else {
      if (!lastSpec || !canEditType(lastSpec.type)) return 'type';
      spec = { ...lastSpec }; g = specGeom(spec); mask = tpl[spec.type] | 0;
    }
    if (edit.on) closeEdit();
    edit.on = true; edit.piece = piece || null; edit.spec = spec; edit.g = g; edit.mask = edit.orig = mask; edit.hover = -1;
    layoutGrid();
    previewMask();
    paintGrid();
    return null;
  }
  const editRay = (o, d, maxT) => { edit.hover = edit.on ? rayTile(edit.g, o, d, maxT) : -1; return edit.hover; };
  function editSet(i, gone) {
    if (!edit.on || i < 0 || i > 8) return;
    const m = gone ? edit.mask | (1 << i) : edit.mask & ~(1 << i);
    if (m === edit.mask) return;
    edit.mask = m;
    previewMask();
  }
  const editBit = (i) => ((edit.mask >> i) & 1) === 1;
  const editReset = () => { if (edit.on) { edit.mask = 0; previewMask(); } };
  /** 'empty' (nothing left), 'pre' (next-piece template set), 'edited', or 'same' */
  function confirmEdit() {
    if (!edit.on) return null;
    if (edit.mask === EDIT_FULL) return 'empty';
    const pc = edit.piece, t = edit.spec.type, mask = edit.mask, orig = edit.orig;
    if (pc) {
      edit.on = false; edit.piece = null; grid.visible = false;
      if (mask === orig) { pc.mesh.geometry = getGeo(t, pc.spec.tier, orig); return 'same'; }
      applyEdit(pc, mask, false);
      return 'edited';
    }
    tpl[t] = mask;
    edit.on = false; grid.visible = false;
    return 'pre';
  }
  const cancelEdit = () => { if (edit.on) closeEdit(); };
  function pieceAt(o, d, maxT) {
    const r = raycastWorld(o.x, o.y, o.z, d.x, d.y, d.z, maxT);
    return r && r.c && r.c.piece ? r.c.piece : null;
  }

  // ---------- per-frame ----------
  /** p = { x, y, z, yaw, pitch }; hold = place button is down (auto-repeats) */
  function update(dt, p, hold) {
    time += dt;
    if (mats < MATS_CAP) mats = Math.min(MATS_CAP, mats + MATS_REGEN * dt);
    cd -= dt;
    updateDebris(dt);
    stepGrow(dt);
    if (!active || !p) {
      ghost.visible = ghostLines.visible = false;
      lastSpec = null;
      return;
    }
    if (edit.on) {
      paintGrid();
      if (!edit.piece) { // pre-edit: the ghost stays where it was when the edit began
        setTransform(ghost, edit.g); setTransform(ghostLines, edit.g);
        ghost.scale.setScalar(1.003); ghostLines.scale.setScalar(1.003);
        ghostMat.color.setHex(0x55ffb0); ghostLineMat.color.setHex(0xbaffe0);
        ghost.visible = ghostLines.visible = true;
      } else ghost.visible = ghostLines.visible = false;
      return;
    }
    const s = target(p);
    const why = check(s, false);
    lastSpec = s; lastWhy = why;
    const g = specGeom(s);
    const geo = getGeo(s.type, s.tier, s.e | 0);
    if (ghost.geometry !== geo) { ghost.geometry = geo; ghostLines.geometry = getEdges(geo); }
    setTransform(ghost, g); setTransform(ghostLines, g);
    ghost.scale.setScalar(1.004); ghostLines.scale.setScalar(1.004);
    ghostMat.opacity = 0.2 + 0.07 * Math.sin(time * 9);
    ghostMat.color.setHex(why ? 0xff5555 : 0x55ff88);
    ghostLineMat.color.setHex(why ? 0xff5555 : TIERS[s.tier].glow);
    ghost.visible = ghostLines.visible = true;
    if (hold && cd <= 0) {
      if (!why) { place(s); cd = PLACE_CD; }
      else { if (hooks.onDenied && why !== 'occupied') hooks.onDenied(why); cd = 0.25; }
    }
  }

  /** Place whatever the ghost shows right now (for a single tap) */
  function placeNow(p) {
    const s = target(p);
    return place(s);
  }

  function setActive(on) {
    active = !!on;
    if (!active) { ghost.visible = ghostLines.visible = false; if (edit.on) closeEdit(); }
  }

  function clear() {
    if (edit.on) closeEdit();
    for (const pc of [...pieces.values()]) destroy(pc, true);
    order.length = 0;
    tpl.wall = tpl.floor = 0;
  }

  return {
    get active() { return active; },
    get type() { return type; },
    get tier() { return tier; },
    get mats() { return Math.floor(mats); },
    get lastWhy() { return lastWhy; },
    get preview() { return lastSpec; },
    get count() { return pieces.size; },
    get placedCount() { return placedCount; },
    get editing() { return edit.on; },
    get editMask() { return edit.mask; },
    get editHover() { return edit.hover; },
    get editPre() { return edit.on && !edit.piece; },
    template: (t) => tpl[t] | 0,
    pieces,
    setActive,
    toggle() { setActive(!active); return active; },
    select(t) { if (TYPES.includes(t)) type = t; },
    cycleType(dir = 1) { type = TYPES[(TYPES.indexOf(type) + dir + TYPES.length) % TYPES.length]; },
    setTier(i) { tier = Math.max(0, Math.min(TIERS.length - 1, i)); },
    cycleTier() { tier = (tier + 1) % TIERS.length; return TIERS[tier].name; },
    addMats(n) { mats = Math.min(999, mats + n); },
    update,
    placeNow,
    place,
    placeRemote(spec) { return place(spec, { remote: true }); },
    damage,
    damageByKey(key, dmg) { return damage(pieces.get(key), dmg); },
    destroy: (pc) => destroy(pc, false),
    destroyByKey(key) { destroy(pieces.get(key), false); },
    pieceFromCollider: (c) => (c && c.piece) || null,
    hasKey: (k) => pieces.has(k),
    serialize() { return [...pieces.values()].map((p) => ({ ...p.spec })); },
    // editing
    canEdit: canEditType,
    pieceAt,
    beginEdit,
    editRay,
    editSet,
    editBit,
    editReset,
    confirmEdit,
    cancelEdit,
    clear,
  };
}
