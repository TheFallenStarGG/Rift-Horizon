/**
 * The big map (12 km x 12 km), streamed around the camera and the player:
 *  - ground: 160 m chunks + far LOD ring (terrainMesh.js)
 *  - POIs: majors + vehicle-service POIs are built once and stay; the ~250 other minors build/unload by distance
 *  - roads: ribbons per 256 m tile, draped over the ground
 *  - trees / rocks / grass: generated per cell on demand (deterministic), colliders added/removed with the cell
 * Returns { scene, sun, sunDir, spawns, arena, pois, update(fx, fz, dt), setDetail, setPropScale, setCheapMats, setView, cull, pickups, nearestPickup, consumePickup }.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { addCollider, clearColliders, removeCollider, colliders } from './collision.js';
import { heightAt } from './ground.js';
import { makeRng } from './rng.js';
import { createBuilder } from './sceneBuild.js';
import { createTerrainMesh } from './terrainMesh.js';
import { ARENA, POIS, ROAD_PATHS, ROAD_SEGS, distToRoad } from './mapLayout.js';
import { buildPoi } from './poiBuilders.js';
import { buildExtra, EXTRA_TYPES } from './poiExtra.js';
import { MAP_HALF, lakeAt, forestDensity, dryness } from './terrain.js';
import { settings } from './settings.js';
import { VEHICLE_TYPES } from './vehicles.js';

const PI = Math.PI;
export { ARENA };

// the map is ~6x bigger per side: every vehicle gets ~5x the fuel range
for (const t of Object.values(VEHICLE_TYPES)) t.tank = Math.round(t.tank * 5);

const at = (x, z, yaw = 0) => ({ x, z, yaw, y: heightAt(x, z) });
const poi = (name) => POIS.find((p) => p.name === name);
const near = (name, dx, dz, yaw = 0) => { const p = poi(name); return at(p.x + dx, p.z + dz, yaw); };

export const SPAWNS = {
  player: [at(0, 8), at(-6, 9), at(6, 9), at(0, 12)],
  enemy: [
    near('Port Haven', 0, 40), near('Iron Works', -40, 0), near('Fort Keller', 0, 60), near('Green Acres', 40, 0),
    near('Hill Fort', -60, 0), near('Standing Stones', 0, -60), near('Mercy Airfield', 0, -40), near('Ridgeback Camp', 30, 30),
    near('Summit Lodge', 20, -20), near('Granite Quarry', 0, 40),
  ],
  ffa: [
    near('Crossroads', 0, 14), near('Port Haven', 20, 0), near('Iron Works', 40, 0), near('Fort Keller', 0, -60),
    near('Hill Fort', 0, 20), near('Lakeside', -20, -20), near('Green Acres', 60, 0), near('Standing Stones', 30, 0),
    near('Sky Tower', 8, 0), near('Granite Quarry', -40, 0), near('Mercy Airfield', 40, 0), near('Summit Lodge', -20, 0),
    near('Ridgeback Camp', -40, 0), near('Crossroads', -30, 0), near('Iron Works', -30, 30),
  ],
  teamA: [at(ARENA.x - 26, ARENA.z - 5, -PI / 2), at(ARENA.x - 26, ARENA.z + 5, -PI / 2), at(ARENA.x - 28, ARENA.z - 12, -PI / 2), at(ARENA.x - 28, ARENA.z + 12, -PI / 2)],
  teamB: [at(ARENA.x + 26, ARENA.z - 5, PI / 2), at(ARENA.x + 26, ARENA.z + 5, PI / 2), at(ARENA.x + 28, ARENA.z - 12, PI / 2), at(ARENA.x + 28, ARENA.z + 12, PI / 2)],
  duelA: at(ARENA.x - 26, ARENA.z, -PI / 2),
  duelB: at(ARENA.x + 26, ARENA.z, PI / 2),
};

const TCELL = 128, GCELL = 64, TREE_TRIES = 56, ROCK_TRIES = 14;
const GRASS_DIST = [0, 90, 130, 170];
const LEVELS = [
  { grass: 0.0012, trees: 0.28, fol: 0, rocks: 0.35 },
  { grass: 0.0030, trees: 0.55, fol: 0, rocks: 0.7 },
  { grass: 0.0100, trees: 0.8, fol: 1, rocks: 0.85 },
  { grass: 0.0300, trees: 1, fol: 2, rocks: 1 },
];
const smooth01 = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
const slopeAt = (x, z) => Math.hypot((heightAt(x + 2, z) - heightAt(x - 2, z)) / 4, (heightAt(x, z + 2) - heightAt(x, z - 2)) / 4);

// one pine = trunk + cone tiers merged into ONE geometry (one draw call per cell)
const TIERS = [[2.2, 2.1, 3.8], [3.9, 1.6, 3.4], [5.5, 1.05, 3.0], [7.0, 0.7, 2.4]];
const SHADE = [0.9, 1.0, 1.1, 1.15];
function pineGeometry(segs, tiers) {
  const parts = [];
  for (let k = 0; k < tiers; k++) {
    const [by, rad, hh] = TIERS[k];
    const g = new THREE.ConeGeometry(1, 1, segs);
    g.translate(0, 0.5, 0); g.scale(rad, hh, rad); g.translate(0, by, 0);
    const n = g.attributes.position.count, c = new Float32Array(n * 3).fill(SHADE[k]);
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    parts.push(g);
  }
  return mergeGeometries(parts);
}
function broadGeometry(sub) {
  const parts = [];
  for (const [x, y, z, r, sy, shade] of [[0, 5.4, 0, 2.2, 0.85, 1.0], [1.1, 4.4, 0.6, 1.5, 0.85, 0.9], [-1.0, 4.6, -0.7, 1.6, 0.85, 1.1]]) {
    const g = new THREE.IcosahedronGeometry(1, sub);
    g.scale(r, r * sy, r); g.translate(x, y, z);
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(shade), 3));
    parts.push(g);
  }
  return mergeGeometries(parts);
}

export function createWorld(renderer, tex) {
  clearColliders();
  const scene = new THREE.Scene();
  scene.background = tex.sky;
  scene.fog = new THREE.Fog(0xd3e0ea, 160, 720);
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromEquirectangular(tex.sky).texture;
  scene.environmentIntensity = 0.65;
  pm.dispose();

  scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x4a5a3a, 0.75));
  const sunDir = new THREE.Vector3(25, 40, 12).normalize();
  const sun = new THREE.DirectionalLight(0xfff0d2, 3.0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -60; sc.right = 60; sc.top = 60; sc.bottom = -60; sc.near = 1; sc.far = 220;
  sc.updateProjectionMatrix();
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  const sunSpriteMat = (o) => new THREE.SpriteMaterial({ map: tex.glow, color: 0xfff4cf, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const sunSprite = new THREE.Sprite(sunSpriteMat(1)); sunSprite.scale.setScalar(40);
  const halo = new THREE.Sprite(sunSpriteMat(0.28)); halo.scale.setScalar(140);
  scene.add(sunSprite, halo);

  const terrain = createTerrainMesh(tex);
  scene.add(terrain.group);
  terrain.prime(0, 0, 420);

  const b = createBuilder(scene, tex);
  const { blocked } = b;
  b.setRoads(ROAD_SEGS);

  let view = 400, detail = Math.max(0, Math.min(3, settings.detail | 0)), propScale = 1, cheap = false, sunDist = 150;
  const foci = [{ x: 0, z: 0, y: 0 }, { x: 0, z: 0, y: 0 }]; // camera, player
  const dFocus = (x, z) => Math.min(Math.hypot(foci[0].x - x, foci[0].z - z), Math.hypot(foci[1].x - x, foci[1].z - z));

  // ---------- pickups ----------
  const KINDS = ['ammo', 'mats', 'ammo', 'health', 'mats'];
  const pkMat = {
    ammo: new THREE.MeshStandardMaterial({ color: 0x4d6b2f, emissive: 0x2e5a1c, emissiveIntensity: 0.9, roughness: 0.5 }),
    mats: new THREE.MeshStandardMaterial({ color: 0x3b6a8c, emissive: 0x1f4a78, emissiveIntensity: 0.9, roughness: 0.5 }),
    health: new THREE.MeshStandardMaterial({ color: 0xe8e8e8, emissive: 0x9a1c1c, emissiveIntensity: 0.8, roughness: 0.5 }),
  };
  const pkGeo = new THREE.BoxGeometry(0.55, 0.38, 0.38);
  const pickups = [];
  let pkN = 0, pkId = 0;
  function addPickups(spots) {
    const made = [];
    for (const s of spots) {
      if (pickups.length >= 900) break;
      const kind = s.kind || KINDS[pkN++ % KINDS.length];
      const mesh = new THREE.Mesh(pkGeo, pkMat[kind]);
      mesh.position.set(s.x, s.y, s.z); mesh.castShadow = true; mesh.visible = false;
      scene.add(mesh);
      const p = { id: pkId++, x: s.x, z: s.z, y: s.y, kind, mesh, active: true, t: 0 };
      pickups.push(p); made.push(p);
    }
    return made;
  }
  function removePickups(list) {
    for (const p of list) { scene.remove(p.mesh); const i = pickups.indexOf(p); if (i >= 0) pickups.splice(i, 1); }
  }
  const nearestPickup = (x, y, z, r = 1.6) => {
    let best = null, bd = r * r;
    for (const p of pickups) {
      if (!p.active || Math.abs(p.y - y) > 2.4) continue;
      const d = (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  };
  const consumePickup = (p) => { if (p && p.active) { p.active = false; p.mesh.visible = false; p.t = 45; } };

  // ---------- POIs ----------
  function buildOne(p, idx) {
    const c0 = colliders.length, z0 = b.zones.length, s0 = b.spots.length, n0 = scene.children.length;
    if (EXTRA_TYPES.has(p.type)) buildExtra(b, p, idx); else buildPoi(b, p, idx);
    b.finish();
    const st = { p, meshes: scene.children.slice(n0), cols: colliders.slice(c0), zones: b.zones.slice(z0), spots: b.spots.slice(s0), pick: [] };
    st.pick = addPickups(st.spots);
    return st;
  }
  const loaded = new Map(); // id -> state (streamed POIs only)
  const streamList = [];
  for (let i = 0; i < POIS.length; i++) {
    if (POIS[i].persist) buildOne(POIS[i], i); // majors + fuel/garage/checkpoint stay for good (vehicles spawn at them)
    else streamList.push({ p: POIS[i], idx: i });
  }
  function unloadPoi(st) {
    for (const m of st.meshes) { scene.remove(m); if (m.geometry) m.geometry.dispose(); }
    for (const c of st.cols) removeCollider(c);
    for (const z of st.zones) { const i = b.zones.indexOf(z); if (i >= 0) b.zones.splice(i, 1); }
    for (const s of st.spots) { const i = b.spots.indexOf(s); if (i >= 0) b.spots.splice(i, 1); }
    removePickups(st.pick);
    loaded.delete(st.p.id);
  }
  const poiReach = (f) => view + Math.max(0, Math.min(900, f.y - 60)) * 0.8; // see more POIs when high up (hot drop)
  function streamPois() {
    for (const st of [...loaded.values()]) {
      let keep = false;
      for (const f of foci) if (Math.hypot(f.x - st.p.x, f.z - st.p.z) < poiReach(f) + st.p.r + 320) keep = true;
      if (!keep) unloadPoi(st);
    }
    let best = null, bd = 1e9;
    for (const q of streamList) {
      if (loaded.has(q.p.id)) continue;
      for (const f of foci) {
        const d = Math.hypot(f.x - q.p.x, f.z - q.p.z);
        if (d < poiReach(f) + q.p.r + 140 && d < bd) { bd = d; best = q; }
      }
    }
    if (best) loaded.set(best.p.id, buildOne(best.p, best.idx)); // one POI per frame
  }

  // ---------- roads (256 m tiles) ----------
  const RT = 256, ROAD_HW = 3.6;
  const roadTiles = new Map();
  for (const rp of ROAD_PATHS) {
    let i0 = 0;
    const tileOf = (pt) => Math.floor((pt[0] + MAP_HALF) / RT) * 1000 + Math.floor((pt[1] + MAP_HALF) / RT);
    for (let k = 1; k < rp.pts.length; k++) {
      if (k === rp.pts.length - 1 || tileOf(rp.pts[k]) !== tileOf(rp.pts[i0]) || k - i0 >= 14) {
        const key = tileOf(rp.pts[i0]);
        (roadTiles.get(key) || roadTiles.set(key, []).get(key)).push({ path: rp, i0, i1: k });
        i0 = k;
      }
    }
  }
  const roadLive = new Map();
  const skipRow = (x, z) => b.inRect(x, z) || !!lakeAt(x, z, 0.95);
  function buildRoadPiece(pc) {
    const pts = pc.path.pts, rows = [];
    const rowAt = (k) => {
      const a = pts[Math.max(0, k - 1)], c = pts[Math.min(pts.length - 1, k + 1)];
      let tx = c[0] - a[0], tz = c[1] - a[1]; const l = Math.hypot(tx, tz) || 1; tx /= l; tz /= l;
      return { x: pts[k][0], z: pts[k][1], nx: tz, nz: -tx };
    };
    let u = 0, prev = rowAt(pc.i0); prev.u = 0; rows.push(prev);
    for (let k = pc.i0 + 1; k <= pc.i1; k++) {
      const cur = rowAt(k), len = Math.hypot(cur.x - prev.x, cur.z - prev.z), sub = Math.max(1, Math.ceil(len / 4));
      for (let s = 1; s <= sub; s++) {
        const t = s / sub; let nx = prev.nx + (cur.nx - prev.nx) * t, nz = prev.nz + (cur.nz - prev.nz) * t; const nl = Math.hypot(nx, nz) || 1;
        rows.push({ x: prev.x + (cur.x - prev.x) * t, z: prev.z + (cur.z - prev.z) * t, nx: nx / nl, nz: nz / nl, u: u + len * t });
      }
      u += len; prev = cur;
    }
    const rp = [], ru = [], mp = [];
    const V = (arr, x, y, z) => arr.push(x, y, z);
    for (let r = 0; r < rows.length - 1; r++) {
      const A = rows[r], B = rows[r + 1];
      if (skipRow((A.x + B.x) / 2, (A.z + B.z) / 2)) continue;
      const pa = [A.x - A.nx * ROAD_HW, A.z - A.nz * ROAD_HW, A.x + A.nx * ROAD_HW, A.z + A.nz * ROAD_HW];
      const pb = [B.x - B.nx * ROAD_HW, B.z - B.nz * ROAD_HW, B.x + B.nx * ROAD_HW, B.z + B.nz * ROAD_HW];
      const ya0 = heightAt(pa[0], pa[1]) + 0.07, ya1 = heightAt(pa[2], pa[3]) + 0.07, yb0 = heightAt(pb[0], pb[1]) + 0.07, yb1 = heightAt(pb[2], pb[3]) + 0.07;
      V(rp, pa[0], ya0, pa[1]); V(rp, pb[0], yb0, pb[1]); V(rp, pa[2], ya1, pa[3]);
      V(rp, pb[0], yb0, pb[1]); V(rp, pb[2], yb1, pb[3]); V(rp, pa[2], ya1, pa[3]);
      const ua = A.u / 4, ub = B.u / 4;
      ru.push(ua, 0, ub, 0, ua, 1.75, ub, 0, ub, 1.75, ua, 1.75);
      if (Math.floor(A.u / 4) % 3 === 0) { // dashed centre line
        const hw = 0.13, ym0 = heightAt(A.x, A.z) + 0.11, ym1 = heightAt(B.x, B.z) + 0.11;
        V(mp, A.x - A.nx * hw, ym0, A.z - A.nz * hw); V(mp, B.x - B.nx * hw, ym1, B.z - B.nz * hw); V(mp, A.x + A.nx * hw, ym0, A.z + A.nz * hw);
        V(mp, B.x - B.nx * hw, ym1, B.z - B.nz * hw); V(mp, B.x + B.nx * hw, ym1, B.z + B.nz * hw); V(mp, A.x + A.nx * hw, ym0, A.z + A.nz * hw);
      }
    }
    const meshes = [];
    const mk = (pos, mat, uv) => {
      if (!pos.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const n = new Float32Array(pos.length); for (let i = 1; i < n.length; i += 3) n[i] = 1;
      g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv || new Array((pos.length / 3) * 2).fill(0.5), 2));
      g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat); m.receiveShadow = true; scene.add(m); meshes.push(m);
    };
    mk(rp, b.mats.road, ru); mk(mp, b.mats.mark);
    return meshes;
  }
  function streamRoads(foc) {
    const need = [];
    for (const f of foc) {
      const R = poiReach(f) + 160, a0 = Math.floor((f.x - R + MAP_HALF) / RT), a1 = Math.floor((f.x + R + MAP_HALF) / RT), c0 = Math.floor((f.z - R + MAP_HALF) / RT), c1 = Math.floor((f.z + R + MAP_HALF) / RT);
      for (let c = c0; c <= c1; c++) for (let a = a0; a <= a1; a++) {
        const key = a * 1000 + c;
        if (roadTiles.has(key) && !roadLive.has(key)) need.push({ key, d: Math.hypot(-MAP_HALF + (a + 0.5) * RT - f.x, -MAP_HALF + (c + 0.5) * RT - f.z) });
      }
    }
    for (const [key, ms] of roadLive) {
      const a = Math.floor(key / 1000), c = key % 1000, d = dFocus(-MAP_HALF + (a + 0.5) * RT, -MAP_HALF + (c + 0.5) * RT);
      if (d > view + 700 && d > 1500) { for (const m of ms) { scene.remove(m); m.geometry.dispose(); } roadLive.delete(key); }
    }
    need.sort((p, q) => p.d - q.d);
    const end = performance.now() + 2.5;
    for (const n of need) {
      if (roadLive.has(n.key)) continue;
      const ms = []; for (const pc of roadTiles.get(n.key)) ms.push(...buildRoadPiece(pc));
      roadLive.set(n.key, ms);
      if (performance.now() > end) break;
    }
  }

  // ---------- trees / rocks / grass (cells) ----------
  const o3 = new THREE.Object3D(), tcol = new THREE.Color();
  const trunkG = new THREE.CylinderGeometry(0.2, 0.32, 1, 7);
  trunkG.translate(0, 0.5, 0); trunkG.scale(1, 5.5, 1); trunkG.translate(0, -0.15, 0);
  const pines = [pineGeometry(8, 3), pineGeometry(14, 3), pineGeometry(14, 4)], broads = [broadGeometry(0), broadGeometry(1), broadGeometry(1)];
  const rockG = new THREE.IcosahedronGeometry(1, 0);
  const windU = { value: 0 };
  const bladePos = [], bladeCol = [];
  for (let k = 0; k < 3; k++) {
    const a = (k * PI) / 3, cx = Math.cos(a) * 0.05, cz = Math.sin(a) * 0.05;
    bladePos.push(-cx, 0, -cz, cx, 0, cz, 0, 0.6, 0); bladeCol.push(0.35, 0.35, 0.35, 0.35, 0.35, 0.35, 1, 1, 1);
  }
  const grassG = new THREE.BufferGeometry();
  grassG.setAttribute('position', new THREE.Float32BufferAttribute(bladePos, 3));
  grassG.setAttribute('color', new THREE.Float32BufferAttribute(bladeCol, 3));
  const grassHook = (sh) => {
    sh.uniforms.uWind = windU;
    sh.vertexShader = 'uniform float uWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vec3 gp = vec3(instanceMatrix[3]);
      float sway = sin(uWind * 1.7 + gp.x * 0.35 + gp.z * 0.27) * 0.12 * position.y;
      transformed.x += sway; transformed.z += sway * 0.5;`);
  };
  const MATS = {
    std: {
      bark: new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex.bark, roughness: 1 }),
      leaf: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, flatShading: true, roughness: 0.95 }),
      rock: new THREE.MeshStandardMaterial({ color: 0x8b877d, flatShading: true, roughness: 1 }),
      grass: new THREE.MeshStandardMaterial({ color: 0x7aa048, vertexColors: true, side: THREE.DoubleSide, roughness: 1 }),
    },
    cheap: {
      bark: new THREE.MeshLambertMaterial({ color: 0xffffff, map: tex.bark }),
      leaf: new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true }),
      rock: new THREE.MeshLambertMaterial({ color: 0x8b877d }),
      grass: new THREE.MeshLambertMaterial({ color: 0x7aa048, vertexColors: true, side: THREE.DoubleSide }),
    },
  };
  MATS.std.grass.onBeforeCompile = grassHook; MATS.cheap.grass.onBeforeCompile = grassHook;
  const M = () => (cheap ? MATS.cheap : MATS.std);

  function finishMesh(mesh, cx, cz, half, y0, y1, shadow) {
    mesh.castShadow = shadow; mesh.receiveShadow = true; mesh.frustumCulled = true;
    mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, (y0 + y1) / 2, cz), Math.hypot(half, half, (y1 - y0) / 2) + 6);
    scene.add(mesh);
  }
  const cellSeed = (a, c, s) => ((a * 73856093) ^ (c * 19349663) ^ (s * 83492791)) >>> 0;

  function genTrees(a, c) {
    const x0 = -MAP_HALF + a * TCELL, z0 = -MAP_HALF + c * TCELL, R = makeRng(cellSeed(a, c, 1));
    const L = LEVELS[detail], frac = L.trees * propScale, items = [], seen = new Set();
    let y0 = 1e9, y1 = -1e9;
    for (let g = 0; g < TREE_TRIES; g++) {
      const x = x0 + R() * TCELL, z = z0 + R() * TCELL, p = R(), q = R(), s = 1.1 + R() * 1.0, ry = R() * 6.28, kr = R();
      if (q >= frac) continue;
      const h = heightAt(x, z);
      if (p > forestDensity(x, z, h) || lakeAt(x, z, 1.15) || slopeAt(x, z) > 0.55 || blocked(x, z) || distToRoad(x, z) < 6) continue;
      const key = Math.round(x / 4) + ',' + Math.round(z / 4);
      if (seen.has(key)) continue;
      seen.add(key);
      const broad = kr < smooth01(95, 40, h) * (1 - dryness(x, z)) * 0.8 + 0.04;
      items.push({ x, z, s, ry, h, broad, k: R() });
      if (h < y0) y0 = h; if (h + 24 > y1) y1 = h + 24;
    }
    const cell = { meshes: [], cols: [], cx: x0 + TCELL / 2, cz: z0 + TCELL / 2 };
    if (!items.length) return cell;
    items.sort((p, q) => (p.broad === q.broad ? 0 : p.broad ? 1 : -1)); // pines first, then broadleaf
    const np = items.filter((t) => !t.broad).length, nb = items.length - np, m = M();
    const trunk = new THREE.InstancedMesh(trunkG, m.bark, items.length);
    const pl = np ? new THREE.InstancedMesh(pines[L.fol], m.leaf, np) : null;
    const bl = nb ? new THREE.InstancedMesh(broads[L.fol], m.leaf, nb) : null;
    items.forEach((t, j) => {
      o3.position.set(t.x, t.h, t.z); o3.rotation.set(0, t.ry, 0); o3.scale.setScalar(t.s); o3.updateMatrix();
      trunk.setMatrixAt(j, o3.matrix);
      if (!t.broad) { pl.setMatrixAt(j, o3.matrix); pl.setColorAt(j, tcol.setHSL(0.27 + t.k * 0.04, 0.4, 0.2 + t.k * 0.08)); }
      else { bl.setMatrixAt(j - np, o3.matrix); bl.setColorAt(j - np, tcol.setHSL(0.2 + t.k * 0.06, 0.5, 0.27 + t.k * 0.09)); }
      const tw = Math.max(0.28, 0.36 * t.s);
      cell.cols.push(addCollider(t.x, t.z, tw, t.h + 4.2 * t.s, tw, { y0: t.h, noCover: true }));
    });
    for (const mm of [trunk, pl, bl]) if (mm) { finishMesh(mm, cell.cx, cell.cz, TCELL * 0.5, y0, y1, true); cell.meshes.push(mm); }
    return cell;
  }
  function genRocks(a, c) {
    const x0 = -MAP_HALF + a * TCELL, z0 = -MAP_HALF + c * TCELL, R = makeRng(cellSeed(a, c, 2));
    const frac = LEVELS[detail].rocks * propScale, items = [];
    let y0 = 1e9, y1 = -1e9;
    for (let g = 0; g < ROCK_TRIES; g++) {
      const x = x0 + R() * TCELL, z = z0 + R() * TCELL, p = R(), q = R(), s = 0.8 + R() * 1.8, ry = R() * 6.28, sy = 0.6 + R() * 0.5;
      if (q >= frac) continue;
      const h = heightAt(x, z), rough = Math.min(1, smooth01(40, 200, h) + slopeAt(x, z) * 1.2);
      if (p > 0.08 + 0.9 * rough || lakeAt(x, z, 1.1) || blocked(x, z) || distToRoad(x, z) < 4) continue;
      items.push({ x, z, s: s * (1 + rough), ry, sy, h });
      if (h < y0) y0 = h; if (h + 6 > y1) y1 = h + 6;
    }
    const cell = { meshes: [], cols: [], cx: x0 + TCELL / 2, cz: z0 + TCELL / 2 };
    if (!items.length) return cell;
    const mesh = new THREE.InstancedMesh(rockG, M().rock, items.length);
    items.forEach((r, j) => {
      o3.position.set(r.x, r.h + r.s * r.sy * 0.3, r.z); o3.rotation.set(0, r.ry, 0); o3.scale.set(r.s, r.s * r.sy, r.s); o3.updateMatrix();
      mesh.setMatrixAt(j, o3.matrix);
      const rw = Math.max(0.5, r.s * 0.95);
      cell.cols.push(addCollider(r.x, r.z, rw, r.h + r.s * r.sy * 0.75, rw, { y0: r.h - 0.2, noCover: true }));
    });
    finishMesh(mesh, cell.cx, cell.cz, TCELL * 0.5, y0, y1, true); cell.meshes.push(mesh);
    return cell;
  }
  function genGrass(a, c) {
    const x0 = -MAP_HALF + a * GCELL, z0 = -MAP_HALF + c * GCELL, R = makeRng(cellSeed(a, c, 3));
    const tries = Math.round(LEVELS[detail].grass * propScale * GCELL * GCELL), items = [];
    let y0 = 1e9, y1 = -1e9;
    for (let g = 0; g < tries; g++) {
      const x = x0 + R() * GCELL, z = z0 + R() * GCELL, ry = R() * 6.28, s = 0.7 + R() * 0.8, hy = 0.8 + R() * 0.5, hue = R(), li = R();
      const h = heightAt(x, z);
      if (h > 150 || lakeAt(x, z, 0.95) || slopeAt(x, z) > 0.7 || blocked(x, z) || distToRoad(x, z) < 4.2) continue;
      if (forestDensity(x, z, h) > 0.85) continue;
      items.push({ x, z, h, ry, s, hy, hue, li });
      if (h < y0) y0 = h; if (h + 1.2 > y1) y1 = h + 1.2;
    }
    const cell = { meshes: [], cols: [], cx: x0 + GCELL / 2, cz: z0 + GCELL / 2 };
    if (!items.length) return cell;
    const mesh = new THREE.InstancedMesh(grassG, M().grass, items.length);
    items.forEach((t, j) => {
      o3.position.set(t.x, t.h, t.z); o3.rotation.set(0, t.ry, 0); o3.scale.set(t.s, t.s * t.hy, t.s); o3.updateMatrix();
      mesh.setMatrixAt(j, o3.matrix);
      mesh.setColorAt(j, tcol.setHSL(0.2 + t.hue * 0.07, 0.45, 0.26 + t.li * 0.14));
    });
    finishMesh(mesh, cell.cx, cell.cz, GCELL * 0.5, y0, y1, false); cell.meshes.push(mesh);
    return cell;
  }
  const treeCells = new Map(), rockCells = new Map(), grassCells = new Map();
  function disposeCell(cell) {
    for (const m of cell.meshes) { scene.remove(m); m.dispose(); }
    for (const col of cell.cols) removeCollider(col);
  }
  function clearProps() { for (const map of [treeCells, rockCells, grassCells]) { for (const c of map.values()) disposeCell(c); map.clear(); } }
  function streamCells(map, size, reach, gen, budget) {
    if (reach <= 0) { for (const c of map.values()) disposeCell(c); map.clear(); return; }
    const n = (MAP_HALF * 2) / size, need = [];
    for (const f of foci) {
      const a0 = Math.max(0, Math.floor((f.x - reach + MAP_HALF) / size)), a1 = Math.min(n - 1, Math.floor((f.x + reach + MAP_HALF) / size));
      const c0 = Math.max(0, Math.floor((f.z - reach + MAP_HALF) / size)), c1 = Math.min(n - 1, Math.floor((f.z + reach + MAP_HALF) / size));
      for (let c = c0; c <= c1; c++) for (let a = a0; a <= a1; a++) {
        const key = a * 4096 + c;
        if (map.has(key)) continue;
        const d = Math.hypot(-MAP_HALF + (a + 0.5) * size - f.x, -MAP_HALF + (c + 0.5) * size - f.z);
        if (d <= reach + size * 0.71) need.push({ a, c, key, d });
      }
    }
    for (const [key, cell] of map) if (dFocus(cell.cx, cell.cz) > reach + size * 1.3) { disposeCell(cell); map.delete(key); }
    need.sort((p, q) => p.d - q.d);
    const end = performance.now() + budget;
    for (const q of need) {
      if (map.has(q.key)) continue;
      map.set(q.key, gen(q.a, q.c));
      if (performance.now() > end) break;
    }
  }

  // ---------- public API ----------
  function setDetail(level) { detail = Math.max(0, Math.min(3, level | 0)); clearProps(); }
  function setPropScale(s) { propScale = Math.max(0.15, Math.min(1, Number(s) || 0)); clearProps(); }
  function setView(d) {
    view = Math.max(60, Number(d) || 400);
    sunDist = Math.min(150, view * 0.8);
    sunSprite.scale.setScalar(40 * (sunDist / 150)); halo.scale.setScalar(140 * (sunDist / 150));
  }
  function setCheapMats(on) {
    on = !!on;
    if (on === cheap) return;
    cheap = on; terrain.setCheap(on);
    const m = M();
    for (const c of treeCells.values()) { if (c.meshes[0]) c.meshes[0].material = m.bark; for (let i = 1; i < c.meshes.length; i++) c.meshes[i].material = m.leaf; }
    for (const c of rockCells.values()) for (const mm of c.meshes) mm.material = m.rock;
    for (const c of grassCells.values()) for (const mm of c.meshes) mm.material = m.grass;
  }

  const _cp = new THREE.Vector3();
  /** gfx.render() calls this every frame with the camera: everything streams around the camera and the player */
  function cull(camera) {
    camera.getWorldPosition(_cp);
    foci[0].x = _cp.x; foci[0].z = _cp.z; foci[0].y = _cp.y;
    terrain.update(foci, view, camera.far, 3);
    streamPois();
    streamRoads(foci);
    streamCells(treeCells, TCELL, view + 8, genTrees, 2.5);
    streamCells(rockCells, TCELL, view + 8, genRocks, 1.5);
    streamCells(grassCells, GCELL, Math.min(view, GRASS_DIST[detail]) + 8, genGrass, 2);
  }

  let clock = 0;
  function update(fx, fz, dt = 0.016) {
    clock += dt; windU.value = clock;
    foci[1].x = fx; foci[1].z = fz;
    const sx = Math.round(fx / 2) * 2, sz = Math.round(fz / 2) * 2;
    sun.target.position.set(sx, 0, sz);
    sun.position.copy(sun.target.position).addScaledVector(sunDir, 90);
    sun.target.updateMatrixWorld();
    sunSprite.position.set(fx, 0, fz).addScaledVector(sunDir, sunDist);
    halo.position.copy(sunSprite.position);
    const vr = view + 6, vr2 = vr * vr;
    for (const p of pickups) {
      if (!p.active) { p.t -= dt; if (p.t <= 0) p.active = true; else continue; }
      const dx = p.x - fx, dz = p.z - fz, inRange = dx * dx + dz * dz < vr2;
      if (p.mesh.visible !== inRange) p.mesh.visible = inRange;
      if (inRange && Math.abs(dx) < 70 && Math.abs(dz) < 70) { p.mesh.position.y = p.y + 0.1 * Math.sin(clock * 2.2 + p.id); p.mesh.rotation.y = clock * 1.2 + p.id; }
    }
  }

  return { scene, sun, sunDir, spawns: SPAWNS, arena: ARENA, pois: POIS, update, setDetail, setPropScale, setCheapMats, setView, cull, pickups, nearestPickup, consumePickup };
}
