/**
 * The big map: real terrain, POIs, roads, forests, rocks, grass and pickups.
 * Deterministic (seeded) so every client builds the same world and collision.
 * Returns { scene, sun, sunDir, spawns, arena, pois, update(fx, fz, dt), setDetail, setView, cull, pickups, nearestPickup, consumePickup }.
 *
 * VIEW-DISTANCE STREAMING
 * Trees, rocks and grass are no longer one giant InstancedMesh each. They live in square cells (128 m for trees and
 * rocks, 64 m for grass), one small InstancedMesh per cell. gfx.render() calls world.cull(camera) every frame:
 * cells further than the Graphics "View distance" from the camera are switched off, and three.js frustum-culls the
 * remaining cells on top of that (main pass AND shadow pass), so only what you can actually see is drawn.
 * Terrain and building batches were already chunked; the camera far plane + frustum culling handle those.
 */
import * as THREE from 'three';
import { addCollider, clearColliders } from './collision.js';
import { heightAt } from './ground.js';
import { makeRng } from './rng.js';
import { createBuilder } from './sceneBuild.js';
import { createTerrainMesh } from './terrainMesh.js';
import { ARENA, POIS, ROADS } from './mapLayout.js';
import { buildPoi } from './poiBuilders.js';
import { MAP_HALF, WATER_Y } from './terrain.js';
import { settings } from './settings.js';

const PI = Math.PI;
export { ARENA };

const at = (x, z, yaw = 0) => ({ x, z, yaw, y: heightAt(x, z) });
const poi = (name) => POIS.find((p) => p.name === name);
const near = (name, dx, dz, yaw = 0) => {
  const p = poi(name);
  return at(p.x + dx, p.z + dz, yaw);
};

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

const LEVEL_GRASS_N = 120000;
const TREE_BASE = 1400, TREE_MAX = 2400, ROCK_BASE = 700, ROCK_MAX = 1000;
const TREE_CELL = 128; // metres: trees and rocks are switched on / off per cell
const GRASS_CELL = 64; // grass is tiny and dense, so its cells are smaller
const GRASS_DIST = [0, 90, 130, 170]; // grass is never drawn further than this (metres), per detail level

function slopeAt(x, z) {
  const dx = (heightAt(x + 2, z) - heightAt(x - 2, z)) / 4;
  const dz = (heightAt(x, z + 2) - heightAt(x, z - 2)) / 4;
  return Math.hypot(dx, dz);
}

function distToRoads(x, z, segs) {
  let best = Infinity;
  for (const [x0, z0, x1, z1] of segs) {
    const vx = x1 - x0, vz = z1 - z0, L2 = vx * vx + vz * vz || 1;
    const t = Math.max(0, Math.min(1, ((x - x0) * vx + (z - z0) * vz) / L2));
    best = Math.min(best, Math.hypot(x0 + vx * t - x, z0 + vz * t - z));
  }
  return best;
}

function forestNoise(x, z) {
  return Math.sin(x * 0.0031 + z * 0.0017) + Math.sin(z * 0.0047 - x * 0.0023 + 1.7) + 0.6 * Math.sin((x + z) * 0.0113 + 0.4);
}

/** how many entries of the ascending array `arr` are below v */
function countBelow(arr, v) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < v) lo = mid + 1; else hi = mid;
  }
  return lo;
}

/** Square-cell index. Each cell keeps the (ascending) ids of the items inside it and their extents. */
function makeGrid(size) {
  const cells = new Map();
  const list = [];
  return {
    list,
    put(id, x, y, z, top) {
      const a = Math.floor((x + MAP_HALF) / size), b = Math.floor((z + MAP_HALF) / size), key = a * 4096 + b;
      let c = cells.get(key);
      if (!c) {
        c = {
          ids: [], data: [], n: 0, cap: 0, mesh: null, mesh2: null,
          bx0: Infinity, bx1: -Infinity, bz0: Infinity, bz1: -Infinity, y0: Infinity, y1: -Infinity,
        };
        cells.set(key, c);
        list.push(c);
      }
      c.ids.push(id);
      if (x < c.bx0) c.bx0 = x;
      if (x > c.bx1) c.bx1 = x;
      if (z < c.bz0) c.bz0 = z;
      if (z > c.bz1) c.bz1 = z;
      if (y - 2 < c.y0) c.y0 = y - 2;
      if (y + top > c.y1) c.y1 = y + top;
      return c;
    },
  };
}

/** squared horizontal distance from (px, pz) to the cell's extents grown by `pad` */
function cellGap2(c, px, pz, pad) {
  const dx = px < c.bx0 - pad ? c.bx0 - pad - px : px > c.bx1 + pad ? px - c.bx1 - pad : 0;
  const dz = pz < c.bz0 - pad ? c.bz0 - pad - pz : pz > c.bz1 + pad ? pz - c.bz1 - pad : 0;
  return dx * dx + dz * dz;
}

// one tree = trunk + cone tiers [base height, radius, height] at scale 1
const TIERS = [[2.2, 2.1, 3.8], [3.9, 1.6, 3.4], [5.5, 1.05, 3.0], [7.0, 0.7, 2.4]];
const SHADE = [0.9, 1.0, 1.1, 1.15]; // brightness per tier, baked into the vertex colours

/** the cone tiers of one tree merged into ONE geometry (one draw call per cell instead of 3-4) */
function foliageGeometry(segs, tiers) {
  const pos = [], nrm = [], uv = [], col = [], idx = [];
  const m = new THREE.Matrix4();
  for (let k = 0; k < tiers; k++) {
    const [by, rad, hh] = TIERS[k];
    const g = new THREE.ConeGeometry(1, 1, segs);
    g.translate(0, 0.5, 0);
    g.applyMatrix4(m.makeScale(rad, hh, rad));
    g.translate(0, by, 0);
    const p = g.attributes.position.array, n = g.attributes.normal.array, u = g.attributes.uv.array;
    const base = pos.length / 3, ia = g.index.array;
    for (let i = 0; i < p.length; i++) { pos.push(p[i]); nrm.push(n[i]); }
    for (let i = 0; i < u.length; i++) uv.push(u[i]);
    for (let i = 0; i < p.length / 3; i++) col.push(SHADE[k], SHADE[k], SHADE[k]);
    for (let i = 0; i < ia.length; i++) idx.push(ia[i] + base);
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(idx);
  return out;
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
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);
  const sunSpriteMat = (o) => new THREE.SpriteMaterial({
    map: tex.glow, color: 0xfff4cf, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false, fog: false,
  });
  const sunSprite = new THREE.Sprite(sunSpriteMat(1));
  sunSprite.scale.setScalar(40);
  const halo = new THREE.Sprite(sunSpriteMat(0.28));
  halo.scale.setScalar(140);
  scene.add(sunSprite, halo);

  {
    const terrain = createTerrainMesh(tex);
    terrain.traverse((n) => { if (n.isMesh) n.userData.terrain = true; });
    scene.add(terrain);
  }

  const b = createBuilder(scene, tex);
  const { blocked } = b;

  // road centrelines (known first so town/minor buildings can stay off the roads)
  const roadSegs = [];
  for (const [i, j] of ROADS) roadSegs.push([POIS[i].x, POIS[i].z, POIS[j].x, POIS[j].z]);
  b.setRoads(roadSegs);

  POIS.forEach((p, i) => buildPoi(b, p, i));

  // roads: continuous ribbons draped over the ground, skipping building footprints and water
  const skip = (x, z) => b.inRect(x, z) || heightAt(x, z) < WATER_Y + 0.25;
  const nodes = new Set();
  for (const [i, j] of ROADS) {
    const A = POIS[i], B = POIS[j];
    b.road('road', A.x, A.z, B.x, B.z, 7, { skip });
    b.roadMarks('mark', A.x, A.z, B.x, B.z, { skip });
    nodes.add(i); nodes.add(j);
  }
  for (const i of nodes) {
    const p = POIS[i];
    if (!skip(p.x, p.z)) b.disc('roadJ', p.x, p.z, 4.1); // junction patch so every road meets cleanly
  }

  // ---------- streaming state ----------
  const o3 = new THREE.Object3D(), tcol = new THREE.Color();
  let view = 400; // view distance in metres (gfx.js calls setView)
  let detail = Math.max(0, Math.min(3, settings.detail | 0));
  let sunDist = 150;

  /** bounding sphere around a cell's instances: lets three.js frustum-cull the cell without touching its instances */
  function setBounds(mesh, c, pad) {
    const hx = (c.bx1 - c.bx0) / 2 + pad, hz = (c.bz1 - c.bz0) / 2 + pad, hy = (c.y1 - c.y0) / 2;
    mesh.boundingSphere = new THREE.Sphere(
      new THREE.Vector3((c.bx0 + c.bx1) / 2, (c.y0 + c.y1) / 2, (c.bz0 + c.bz1) / 2),
      Math.hypot(hx, hy, hz),
    );
  }
  function place(mesh, c, shadow, pad) {
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    mesh.frustumCulled = true;
    mesh.visible = false; // cull() switches it on when it is in range
    setBounds(mesh, c, pad);
    scene.add(mesh);
  }

  // ---------- trees ----------
  const rng = makeRng(1337);
  const trees = [], tkeys = new Set();
  for (let g = 0; g < 80000 && trees.length < TREE_MAX; g++) {
    const x = (rng() * 2 - 1) * (MAP_HALF - 20), z = (rng() * 2 - 1) * (MAP_HALF - 20);
    const r2 = rng(), s = 1.2 + rng() * 0.9, ry = rng() * 6.28;
    const h = heightAt(x, z);
    if (forestNoise(x, z) < 0.15 && r2 > 0.04) continue;
    if (h < WATER_Y + 1.2 || h > 95 || slopeAt(x, z) > 0.55) continue;
    if (blocked(x, z) || distToRoads(x, z, roadSegs) < 6) continue;
    const key = Math.round(x / 4) + ',' + Math.round(z / 4);
    if (tkeys.has(key)) continue;
    tkeys.add(key);
    trees.push({ x, z, s, ry, h });
  }
  const NT = trees.length;
  const NT0 = Math.min(TREE_BASE, NT);

  const trunkG = new THREE.CylinderGeometry(0.2, 0.32, 1, 7);
  trunkG.translate(0, 0.5, 0);
  trunkG.scale(1, 5.5, 1);
  trunkG.translate(0, -0.15, 0); // trunk base sunk a little so it never hovers on a slope
  const foliage = [foliageGeometry(8, 3), foliageGeometry(14, 3), foliageGeometry(14, 4)]; // low / high / ultra
  const barkM = new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex.bark, roughness: 1 });
  const leafM = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, flatShading: true, roughness: 0.95 });

  const treeGrid = makeGrid(TREE_CELL);
  trees.forEach((t, i) => {
    // Tight trunk core only (foliage is visual — never a hitbox).
    const tw = Math.max(0.28, 0.36 * t.s);
    const th = t.h + 4.2 * t.s;
    addCollider(t.x, t.z, tw, th, tw, { y0: t.h, noCover: true });
    treeGrid.put(i, t.x, t.h, t.z, 24);
  });
  for (const c of treeGrid.list) {
    const trunk = new THREE.InstancedMesh(trunkG, barkM, c.ids.length);
    const leaves = new THREE.InstancedMesh(foliage[0], leafM, c.ids.length);
    c.ids.forEach((id, j) => {
      const t = trees[id];
      o3.position.set(t.x, t.h, t.z);
      o3.rotation.set(0, t.ry, 0);
      o3.scale.setScalar(t.s);
      o3.updateMatrix();
      trunk.setMatrixAt(j, o3.matrix);
      leaves.setMatrixAt(j, o3.matrix);
      const rnd = makeRng(id * 7919 + 17);
      leaves.setColorAt(j, tcol.setHSL(0.27 + rnd() * 0.04, 0.4, 0.2 + rnd() * 0.08));
    });
    place(trunk, c, true, 6);
    place(leaves, c, true, 6);
    c.mesh = trunk;
    c.mesh2 = leaves;
  }

  // ---------- rocks ----------
  const rocks = [];
  const rockRng = makeRng(9001);
  for (let g = 0; g < 30000 && rocks.length < ROCK_MAX; g++) {
    const x = (rockRng() * 2 - 1) * (MAP_HALF - 20), z = (rockRng() * 2 - 1) * (MAP_HALF - 20);
    const s = 0.8 + rockRng() * 1.8, ry = rockRng() * 6.28, sy = 0.6 + rockRng() * 0.5;
    if (blocked(x, z) || distToRoads(x, z, roadSegs) < 4) continue;
    rocks.push({ x, z, s, ry, sy, h: heightAt(x, z) });
  }
  const NR = rocks.length;
  const NR0 = Math.min(ROCK_BASE, NR);
  const rockG = new THREE.IcosahedronGeometry(1, 0);
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x8b877d, flatShading: true, roughness: 1 });
  const rockGrid = makeGrid(TREE_CELL);
  rocks.forEach((r, i) => {
    // Slightly smaller than the visible rock so you never "hit air" beside it
    const rw = Math.max(0.5, r.s * 0.95);
    const top = r.h + r.s * r.sy * 0.75;
    addCollider(r.x, r.z, rw, top, rw, { y0: r.h - 0.2, noCover: true });
    rockGrid.put(i, r.x, r.h, r.z, 5);
  });
  for (const c of rockGrid.list) {
    const m = new THREE.InstancedMesh(rockG, rockMat, c.ids.length);
    c.ids.forEach((id, j) => {
      const r = rocks[id];
      o3.position.set(r.x, r.h + r.s * r.sy * 0.3, r.z); // half-buried
      o3.rotation.set(0, r.ry, 0);
      o3.scale.set(r.s, r.s * r.sy, r.s);
      o3.updateMatrix();
      m.setMatrixAt(j, o3.matrix);
    });
    place(m, c, true, 5);
    c.mesh = m;
  }

  // ---------- grass (generated lazily: only as many blades as the Detail level needs) ----------
  const windU = { value: 0 };
  const bladePos = [], bladeCol = [];
  for (let k = 0; k < 3; k++) {
    const a = (k * PI) / 3, cx = Math.cos(a) * 0.05, cz = Math.sin(a) * 0.05;
    bladePos.push(-cx, 0, -cz, cx, 0, cz, 0, 0.6, 0);
    bladeCol.push(0.35, 0.35, 0.35, 0.35, 0.35, 0.35, 1, 1, 1);
  }
  const grassG = new THREE.BufferGeometry();
  grassG.setAttribute('position', new THREE.Float32BufferAttribute(bladePos, 3));
  grassG.setAttribute('color', new THREE.Float32BufferAttribute(bladeCol, 3));
  const grassM = new THREE.MeshStandardMaterial({ color: 0x7aa048, vertexColors: true, side: THREE.DoubleSide, roughness: 1 });
  grassM.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = windU;
    sh.vertexShader = 'uniform float uWind;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vec3 gp = vec3(instanceMatrix[3]);
      float sway = sin(uWind * 1.7 + gp.x * 0.35 + gp.z * 0.27) * 0.12 * position.y;
      transformed.x += sway; transformed.z += sway * 0.5;`);
  };
  const grassGrid = makeGrid(GRASS_CELL);
  const grassRng = makeRng(2024);
  let gTry = 0, gGen = 0;
  /** keeps generating blades (same seeded sequence as always) until `target` exist */
  function growGrass(target) {
    target = Math.min(LEVEL_GRASS_N, target);
    const maxTry = LEVEL_GRASS_N * 4;
    while (gGen < target && gTry < maxTry) {
      gTry++;
      const x = (grassRng() * 2 - 1) * (MAP_HALF - 20), z = (grassRng() * 2 - 1) * (MAP_HALF - 20);
      const ry = grassRng() * 6.28, s = 0.7 + grassRng() * 0.8, hy = 0.8 + grassRng() * 0.5;
      const h = heightAt(x, z);
      if (h < WATER_Y + 0.3 || h > 110 || slopeAt(x, z) > 0.7 || blocked(x, z)) continue;
      if (forestNoise(x, z) > 0.9) continue;
      if (distToRoads(x, z, roadSegs) < 4.2) continue; // keep the road surface clear
      const c = grassGrid.put(gGen, x, h, z, 1.2);
      c.data.push(x, h, z, ry, s, s * hy, grassRng(), grassRng()); // x y z yaw width height hue light
      gGen++;
    }
  }
  /** make sure the cell's grass mesh holds the blades allowed by `limit` (global blade index), then set its count */
  function syncGrass(c, limit) {
    const need = countBelow(c.ids, limit);
    if (need > c.cap) {
      if (c.mesh) { scene.remove(c.mesh); c.mesh.dispose(); c.mesh = null; }
      c.cap = 0;
      if (need > 0) {
        const m = new THREE.InstancedMesh(grassG, grassM, need), d = c.data;
        for (let j = 0; j < need; j++) {
          const k = j * 8;
          o3.position.set(d[k], d[k + 1], d[k + 2]);
          o3.rotation.set(0, d[k + 3], 0);
          o3.scale.set(d[k + 4], d[k + 5], d[k + 4]);
          o3.updateMatrix();
          m.setMatrixAt(j, o3.matrix);
          m.setColorAt(j, tcol.setHSL(0.2 + d[k + 6] * 0.07, 0.45, 0.26 + d[k + 7] * 0.14));
        }
        place(m, c, false, 1);
        c.mesh = m;
        c.cap = need;
      }
    }
    c.n = need;
    if (c.mesh) c.mesh.count = need;
  }

  // Detail levels: 0 off, 1 normal, 2 high, 3 ultra. fol = foliage tier.
  // propScale (0–1) multiplies tree/rock/grass counts so Ultra Perf can strip the world without a new detail step.
  let propScale = 1;
  const LEVELS = [
    { grass: 0, trees: Math.min(40, NT0), fol: 0, rocks: Math.min(20, NR0) },
    { grass: 12000, trees: Math.min(NT0, Math.floor(NT0 * 0.55)), fol: 0, rocks: Math.min(NR0, Math.floor(NR0 * 0.7)) },
    { grass: 40000, trees: Math.min(NT, NT0 + 400), fol: 1, rocks: Math.min(NR, NR0 + 120) },
    { grass: LEVEL_GRASS_N, trees: NT, fol: 2, rocks: NR },
  ];
  function applyPropCounts() {
    const L = LEVELS[detail];
    const ps = Math.max(0, Math.min(1, propScale));
    const treeN = Math.max(0, Math.floor(L.trees * ps));
    const rockN = Math.max(0, Math.floor(L.rocks * ps));
    const grassN = Math.max(0, Math.floor(L.grass * ps));
    for (const c of treeGrid.list) {
      c.n = countBelow(c.ids, treeN);
      c.mesh2.geometry = foliage[L.fol];
      c.mesh.count = c.mesh2.count = c.n;
      if (c.n === 0) { c.mesh.visible = false; c.mesh2.visible = false; }
    }
    for (const c of rockGrid.list) {
      c.n = countBelow(c.ids, rockN);
      c.mesh.count = c.n;
      if (c.n === 0) c.mesh.visible = false;
    }
    growGrass(grassN);
    for (const c of grassGrid.list) syncGrass(c, grassN);
  }
  function setDetail(level) {
    detail = Math.max(0, Math.min(3, level | 0));
    applyPropCounts();
  }
  function setPropScale(s) {
    propScale = Math.max(0, Math.min(1, Number(s) || 0));
    applyPropCounts();
  }
  setDetail(detail);

  b.finish();

  // ---------- pickups ----------
  const KINDS = ['ammo', 'mats', 'ammo', 'health', 'mats'];
  const pkMat = {
    ammo: new THREE.MeshStandardMaterial({ color: 0x4d6b2f, emissive: 0x2e5a1c, emissiveIntensity: 0.9, roughness: 0.5 }),
    mats: new THREE.MeshStandardMaterial({ color: 0x3b6a8c, emissive: 0x1f4a78, emissiveIntensity: 0.9, roughness: 0.5 }),
    health: new THREE.MeshStandardMaterial({ color: 0xe8e8e8, emissive: 0x9a1c1c, emissiveIntensity: 0.8, roughness: 0.5 }),
  };
  const pkGeo = new THREE.BoxGeometry(0.55, 0.38, 0.38);
  const pickups = [];
  for (const s of b.spots) {
    if (pickups.length >= 140) break;
    const kind = KINDS[pickups.length % KINDS.length];
    const mesh = new THREE.Mesh(pkGeo, pkMat[kind]);
    mesh.position.set(s.x, s.y, s.z);
    mesh.castShadow = true;
    scene.add(mesh);
    pickups.push({ id: pickups.length, x: s.x, z: s.z, y: s.y, kind, mesh, active: true, t: 0 });
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

  // ---------- view distance ----------
  /** called by gfx.js whenever the View distance setting changes */
  function setView(d) {
    view = Math.max(60, Number(d) || 400);
    sunDist = Math.min(150, view * 0.8); // keep the sun inside the camera's far plane
    const k = sunDist / 150;
    sunSprite.scale.setScalar(40 * k);
    halo.scale.setScalar(140 * k);
  }

  const _cp = new THREE.Vector3();
  /** called by gfx.render() every frame: switch whole cells on/off by distance to the camera */
  function cull(camera) {
    camera.getWorldPosition(_cp);
    const px = _cp.x, pz = _cp.z, r = view + 8, r2 = r * r;
    const gr = Math.min(view, GRASS_DIST[detail]) + 8, gr2 = gr * gr;
    for (const c of treeGrid.list) {
      const on = c.n > 0 && cellGap2(c, px, pz, 5) <= r2;
      if (c.mesh.visible !== on) c.mesh.visible = c.mesh2.visible = on;
    }
    for (const c of rockGrid.list) {
      const on = c.n > 0 && cellGap2(c, px, pz, 4) <= r2;
      if (c.mesh.visible !== on) c.mesh.visible = on;
    }
    for (const c of grassGrid.list) {
      if (!c.mesh) continue;
      const on = c.n > 0 && cellGap2(c, px, pz, 1) <= gr2;
      if (c.mesh.visible !== on) c.mesh.visible = on;
    }
  }

  let clock = 0;
  function update(fx, fz, dt = 0.016) {
    clock += dt;
    windU.value = clock;
    const sx = Math.round(fx / 2) * 2, sz = Math.round(fz / 2) * 2;
    sun.target.position.set(sx, 0, sz);
    sun.position.copy(sun.target.position).addScaledVector(sunDir, 90);
    sun.target.updateMatrixWorld();
    sunSprite.position.set(fx, 0, fz).addScaledVector(sunDir, sunDist);
    halo.position.copy(sunSprite.position);
    const vr = view + 6, vr2 = vr * vr;
    for (const p of pickups) {
      if (!p.active) {
        p.t -= dt;
        if (p.t <= 0) p.active = true; // reappears below if it is in range
        else continue;
      }
      const dx = p.x - fx, dz = p.z - fz;
      const inRange = dx * dx + dz * dz < vr2;
      if (p.mesh.visible !== inRange) p.mesh.visible = inRange;
      if (inRange && Math.abs(dx) < 70 && Math.abs(dz) < 70) {
        p.mesh.position.y = p.y + 0.1 * Math.sin(clock * 2.2 + p.id);
        p.mesh.rotation.y = clock * 1.2 + p.id;
      }
    }
  }


  // ---------- cheap materials (Lambert) vs standard (PBR) ----------
  const stdMats = { bark: barkM, leaf: leafM, rock: rockMat, grass: grassM };
  const cheapMats = {
    bark: new THREE.MeshLambertMaterial({ color: 0xffffff, map: tex.bark }),
    leaf: new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true }),
    rock: new THREE.MeshLambertMaterial({ color: 0x8b877d }),
    grass: new THREE.MeshLambertMaterial({ color: 0x7aa048, vertexColors: true, side: THREE.DoubleSide }),
  };
  // copy wind hook onto cheap grass if present
  if (grassM.onBeforeCompile) cheapMats.grass.onBeforeCompile = grassM.onBeforeCompile;
  let usingCheap = false;
  function setCheapMats(on) {
    on = !!on;
    if (on === usingCheap) return;
    usingCheap = on;
    const pack = on ? cheapMats : stdMats;
    for (const c of treeGrid.list) {
      c.mesh.material = pack.bark;
      c.mesh2.material = pack.leaf;
    }
    for (const c of rockGrid.list) c.mesh.material = pack.rock;
    for (const c of grassGrid.list) if (c.mesh) c.mesh.material = pack.grass;
    // terrain chunks (Mesh with vertex colors)
    scene.traverse((n) => {
      if (!n.isMesh || !n.material) return;
      if (n.userData && n.userData.terrain) {
        if (on) {
          if (!n.userData._stdMat) n.userData._stdMat = n.material;
          if (!n.userData._cheapMat) {
            const sm = n.userData._stdMat;
            n.userData._cheapMat = new THREE.MeshLambertMaterial({
              color: sm.color ? sm.color.getHex() : 0xffffff,
              map: sm.map || null,
              vertexColors: !!sm.vertexColors,
            });
          }
          n.material = n.userData._cheapMat;
        } else if (n.userData._stdMat) {
          n.material = n.userData._stdMat;
        }
      }
    });
  }

  return { scene, sun, sunDir, spawns: SPAWNS, arena: ARENA, pois: POIS, update, setDetail, setPropScale, setCheapMats, setView, cull, pickups, nearestPickup, consumePickup };

  }
