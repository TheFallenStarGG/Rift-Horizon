/**
 * Flyable aircraft: a single-engine light plane and a utility helicopter.
 *  - real GLB models (assets/*.glb): window glass is split out of the airframe by vertex colour and rendered transparent
 *  - flight physics live in lib/flight.js (6-DOF rigid body, stall, ground effect, rotor RPM, autorotation, ...)
 *  - the plane's procedural interior (panel, seats, live gauges, yoke, pedals) and the IK pilot live in lib/cockpit.js
 *  - first-person cockpit view + chase view, animated control surfaces / gear / flaps / rotors / doors / pilot + controls
 *  - a different HUD and different touch controls for each aircraft
 * Model credit: "Single-Engine Light Aircraft" and "Helicopter" by Polyfork (https://polyfork.dev), CC BY 4.0. Glass is made transparent at runtime.
 * Game convention: yaw 0 faces -Z. The GLBs have their nose on +Z, so each model sits inside a pivot turned 180° about Y.
 * Public API: createAircraft({ scene, audio, hud, isTouch }) -> { list, tryUse, toggleCam, update, isPiloting, resetAll, spawnAt, scrollThrottle, setNet, onVeh, onVehExit, onVehClaim, onVehDeny }
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { heightAt } from './ground.js';
import { floorAt, addCollider, removeCollider, queryRect, WORLD_HALF } from './collision.js';
import { POIS } from './mapLayout.js';
import { settings } from './settings.js';
import * as FL from './flight.js';
import { buildPlaneCockpit, createPilot } from './cockpit.js';

const PI = Math.PI, TAU = PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);
const damp = (c, t, rate, dt) => c + (t - c) * (1 - Math.exp(-rate * dt));
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const FAR2 = 900 * 900;
const ZERO_IN = { pitch: 0, roll: 0, yaw: 0, up: 0 };

/**
 * Per-aircraft model data. All positions are in MODEL coordinates (nose = +Z, left = +X, up = +Y, origin at ground level).
 * If the cockpit camera or the pilot / stick look slightly off, these are the numbers to nudge.
 */
const TYPES = {
  plane: {
    id: 'plane', name: 'Light Plane', cfg: FL.PLANE, url: new URL('../assets/single-engine-light-aircraft-24478f.glb', import.meta.url).href,
    glass: [[0.168, 0.266, 0.342]],
    eye: [0.31, 1.85, 0.29], seat: [0.31, 1.14, 0.15], yoke: [0.31, 1.52, 0.66],
    reach: 5.5, exitSide: 2.6, camDist: 12.5, camH: 3.4,
    // parked collision chain: [x_m, z_m, size, top, y0]
    cols: [[0, 2.2, 1.3, 2.2, 0.3], [0, 1.0, 1.4, 2.2, 0.3], [0, -0.2, 1.4, 2.2, 0.3], [0, -1.4, 1.2, 2.1, 0.3], [0, -2.6, 1.0, 2.0, 0.5], [0, -3.8, 0.8, 2.6, 0.8],
      ...[-4.8, -3.2, -1.6, 0, 1.6, 3.2, 4.8].map((x) => [x, -0.3, 1.5, 1.6, 0.6]), [-1.2, -4.3, 1.2, 2.1, 1.0], [0, -4.3, 1.2, 2.1, 1.0], [1.2, -4.3, 1.2, 2.1, 1.0]],
    lights: [[5.3, 1.3, -0.3, 0xff2a2a], [-5.3, 1.3, -0.3, 0x2aff5a], [0, 2.5, -4.9, 0xffffff]], landing: [0, 0.9, 2.3],
  },
  heli: {
    id: 'heli', name: 'Helicopter', cfg: FL.HELI, url: new URL('../assets/helicopter-9d1986.glb', import.meta.url).href,
    glass: [[0.021, 0.028, 0.05]],
    eye: [-0.38, 1.98, 2.3], seat: [-0.38, 1.0, 2.0], yoke: [-0.38, 1.35, 2.75],
    reach: 6, exitSide: 2.5, camDist: 15, camH: 3.8,
    cols: [[0, 3.2, 2.0, 3.4, 0.2], [0, 1.4, 2.1, 3.4, 0.2], [0, -0.4, 2.1, 3.4, 0.2], [0, -2.2, 1.6, 3.0, 0.4], [0, -4.0, 0.9, 2.9, 1.5], [0, -5.8, 0.9, 2.9, 1.5]],
    lights: [[0.9, 2.3, -0.7, 0xff2a2a], [-0.9, 2.3, -0.7, 0x2aff5a], [0, 2.9, -6.7, 0xffffff], [0, 3.35, -0.2, 0xff4040]], landing: [0, 0.9, 4.2],
    doors: [{ n: 'door-left', hinge: [0.83, 1.4, 0.42], dir: -1 }, { n: 'door-right', hinge: [-0.83, 1.4, 0.42], dir: 1 }],
  },
};
const KIND = { plane: 'plane', helicopter: 'heli', heli: 'heli' };

const GLASS_MAT = new THREE.MeshStandardMaterial({
  color: 0x9fc6de, roughness: 0.04, metalness: 0.05, transparent: true, opacity: 0.24, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.4,
});
const DARK = new THREE.MeshStandardMaterial({ color: 0x1b1c20, roughness: 0.6, metalness: 0.3 });
const BURNT = new THREE.MeshStandardMaterial({ color: 0x1b1b1c, roughness: 0.95, metalness: 0.1 });

// ======================================================================================
// model loading
// ======================================================================================
/** pull the window triangles out of every mesh (by vertex colour) into their own transparent mesh */
function splitGlass(root, glassCols) {
  const jobs = [];
  root.traverse((o) => { if (o.isMesh && o.geometry && o.geometry.getAttribute('color')) jobs.push(o); });
  const near = (col, i, g) => Math.abs(col.getX(i) - g[0]) < 0.012 && Math.abs(col.getY(i) - g[1]) < 0.012 && Math.abs(col.getZ(i) - g[2]) < 0.012;
  for (const mesh of jobs) {
    const geo = mesh.geometry, col = geo.getAttribute('color'), idx = geo.index ? geo.index.array : null;
    const n = idx ? idx.length : geo.getAttribute('position').count;
    const gl = [], body = [];
    for (let i = 0; i < n; i += 3) {
      const a = idx ? idx[i] : i, b = idx ? idx[i + 1] : i + 1, c = idx ? idx[i + 2] : i + 2;
      const isGlass = glassCols.some((g) => near(col, a, g) && near(col, b, g) && near(col, c, g));
      const dst = isGlass ? gl : body;
      dst.push(a, b, c);
    }
    if (!gl.length) continue;
    const mk = (arr) => {
      const ng = new THREE.BufferGeometry();
      for (const k in geo.attributes) ng.setAttribute(k, geo.attributes[k]);
      ng.setIndex(arr);
      return ng;
    };
    mesh.geometry = mk(body);
    const gm = new THREE.Mesh(mk(gl), GLASS_MAT);
    gm.name = 'glass'; gm.userData.glass = true; gm.renderOrder = 4;
    gm.position.copy(mesh.position); gm.quaternion.copy(mesh.quaternion); gm.scale.copy(mesh.scale);
    mesh.parent.add(gm);
  }
}

/** simple stand-in so the game still works if the GLB is missing / still loading */
function fallbackModel(T) {
  const g = new THREE.Group(), box = (w, h, d, x, y, z, c) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 })); m.position.set(x, y, z); g.add(m); return m; };
  if (T.id === 'plane') {
    box(1.2, 1.2, 7, 0, 1.3, -1, 0xe8e8ec); box(10.6, 0.15, 1.6, 0, 1.0, -0.3, 0xe8e8ec); box(3.4, 0.12, 1.0, 0, 1.6, -4.5, 0xe8e8ec); box(0.12, 1.2, 1.0, 0, 2.2, -4.5, 0xb32d2d);
    const p = new THREE.Group(); p.name = 'propeller'; p.position.set(0, 1.28, 2.62); p.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.7, 0.1), DARK)); g.add(p);
  } else {
    box(1.7, 1.6, 5.5, 0, 1.6, 1.2, 0x8fa3b3); box(0.5, 0.6, 5, 0, 2.3, -4.5, 0x5a7ea3);
    const r = new THREE.Group(); r.name = 'rotor-main'; r.position.set(0, 3.8, 0); r.add(new THREE.Mesh(new THREE.BoxGeometry(7.9, 0.06, 0.3), DARK)); g.add(r);
    const t = new THREE.Group(); t.name = 'rotor-tail'; t.position.set(0.3, 2.13, -6.43); t.add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.5, 0.2), DARK)); g.add(t);
    for (const sx of [-1, 1]) box(0.08, 0.08, 4.5, sx * 1.1, 0.07, 0.4, 0x333333);
  }
  return g;
}

const templates = {};
const waiting = [];
let allReady = false;
function loadTemplates() {
  const loader = new GLTFLoader();
  const jobs = Object.values(TYPES).map((T) => new Promise((res) => {
    loader.load(T.url, (gltf) => {
      const g = gltf.scene;
      g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; } });
      splitGlass(g, T.glass);
      templates[T.id] = { scene: g, real: true };
      res();
    }, undefined, () => { templates[T.id] = { scene: fallbackModel(T), real: false }; res(); });
  }));
  return Promise.all(jobs).then(() => { allReady = true; for (const f of waiting.splice(0)) f(); });
}
const whenReady = (f) => (allReady ? f() : waiting.push(f));

// ======================================================================================
// instance (visuals)
// ======================================================================================
function instantiate(T, spec) {
  const tpl = templates[T.id];
  const model = tpl.scene.clone(true);
  const glassMat = GLASS_MAT.clone();
  const nodes = {};
  model.traverse((o) => {
    if (o.name) nodes[o.name] = o;
    if (o.userData.glass) o.material = glassMat;
  });
  // helicopter doors: swing about their front edge
  const doors = [];
  for (const d of T.doors || []) {
    const n = nodes[d.n];
    if (!n) continue;
    const piv = new THREE.Group();
    piv.position.set(...d.hinge);
    n.position.set(n.position.x - d.hinge[0], n.position.y - d.hinge[1], n.position.z - d.hinge[2]);
    n.parent.add(piv); piv.add(n);
    doors.push({ piv, dir: d.dir });
  }
  const pivot = new THREE.Group();
  pivot.rotation.y = PI; // nose +Z -> game forward -Z
  pivot.add(model);
  const root = new THREE.Group();
  root.rotation.order = 'YXZ';
  root.add(pivot);
  const pilot = createPilot(T.seat);
  model.add(pilot.g);
  // controls the pilot holds (plane: full procedural cockpit with yoke, heli: cyclic + collective)
  let ctrl, stick = null, lever = null, ck = null;
  if (T.id === 'plane') {
    ck = buildPlaneCockpit(T);
    model.add(ck.group);
    ctrl = ck.ctrl; stick = ck.stick;
  } else {
    const yokeMat = DARK;
    ctrl = new THREE.Group();
    ctrl.position.set(...T.yoke);
    stick = new THREE.Group();
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.024, 0.55, 6), yokeMat); rod.position.y = 0.27;
    const grip = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), yokeMat); grip.position.y = 0.56;
    stick.add(rod, grip); ctrl.add(stick);
    lever = new THREE.Group(); lever.position.set(0.3, -0.05, -0.55);
    const rod2 = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.5, 6), yokeMat); rod2.rotation.x = PI / 2; rod2.position.z = 0.25;
    lever.add(rod2); ctrl.add(lever);
    model.add(ctrl);
  }
  // lights
  const navs = T.lights.map(([x, y, z, c]) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color: c }));
    m.position.set(x, y, z); m.visible = false; model.add(m); return m;
  });
  const lamp = new THREE.SpotLight(0xfff2d8, 0, 120, 0.42, 0.6, 1.2);
  const lampT = new THREE.Object3D(); lampT.position.set(0, -3, 30); // pivot space = model space (nose +Z)
  pivot.add(lamp, lampT); lamp.target = lampT;
  lamp.position.set(...T.landing);
  // optional blurred disc so fast propellers / rotors read as a disc
  const disc = new THREE.Mesh(new THREE.CircleGeometry(T.id === 'plane' ? 0.95 : 3.95, 28), new THREE.MeshBasicMaterial({ color: 0xdddddd, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }));
  disc.visible = false;
  if (T.id === 'plane' && nodes.propeller) { disc.rotation.y = 0; disc.position.z = 0.15; nodes.propeller.add(disc); }
  else if (nodes['rotor-main']) { disc.rotation.x = -PI / 2; disc.position.y = -0.2; nodes['rotor-main'].add(disc); }
  return { root, pivot, model, nodes, glassMat, pilot, ctrl, stick, lever, ck, navs, lamp, doors, disc, real: tpl.real, burnt: false };
}

function toWreck(inst) {
  inst.model.traverse((o) => { if (o.isMesh && !o.userData.glass) o.material = BURNT; });
  inst.glassMat.opacity = 0.9; inst.glassMat.color.set(0x0b0b0c);
  inst.pilot.g.visible = false; inst.burnt = true;
  if (inst.ck) inst.ck.fill.intensity = 0;
}

// ======================================================================================
// particles (smoke / fire / explosion / prop-wash dust)
// ======================================================================================
function makeFx(scene) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mk = (blend) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: blend, opacity: 0 }));
    s.visible = false; scene.add(s);
    return { s, life: 0, max: 1, v: new THREE.Vector3(), s0: 1, s1: 2, o: 0.5, drag: 1, up: 0 };
  };
  const smoke = Array.from({ length: 70 }, () => mk(THREE.NormalBlending)), fire = Array.from({ length: 30 }, () => mk(THREE.AdditiveBlending));
  let si = 0, fi = 0, flash = 0;
  const light = new THREE.PointLight(0xff9a40, 0, 60, 2);
  scene.add(light);
  const emit = (pool, i, x, y, z, vx, vy, vz, s0, s1, life, o, color, drag, up) => {
    const p = pool[i];
    p.s.visible = true; p.s.position.set(x, y, z); p.v.set(vx, vy, vz);
    p.s0 = s0; p.s1 = s1; p.max = p.life = life; p.o = o; p.drag = drag; p.up = up; p.s.material.color.setHex(color);
  };
  const api = {
    smoke(x, y, z, vx, vy, vz, s0, s1, life, o, color = 0x555555) { emit(smoke, si, x, y, z, vx, vy, vz, s0, s1, life, o, color, 0.8, 0.6); si = (si + 1) % smoke.length; },
    fire(x, y, z, vx, vy, vz, s0, s1, life, o, color = 0xff8a2a) { emit(fire, fi, x, y, z, vx, vy, vz, s0, s1, life, o, color, 1.5, 1.2); fi = (fi + 1) % fire.length; },
    dust(x, y, z, vx, vz) { this.smoke(x, y, z, vx, rnd(0.2, 0.9), vz, 0.7, 3.2, 1.3, 0.3, 0xb8a98a); },
    spark(x, y, z) { for (let i = 0; i < 3; i++) this.fire(x, y, z, rnd(-2, 2), rnd(0.5, 3), rnd(-2, 2), 0.18, 0.02, 0.35, 0.9, 0xffd27a); },
    blast(x, y, z) {
      flash = 1; light.position.set(x, y + 1.5, z);
      for (let i = 0; i < 18; i++) this.fire(x + rnd(-1.5, 1.5), y + rnd(0.3, 2), z + rnd(-1.5, 1.5), rnd(-6, 6), rnd(1, 8), rnd(-6, 6), rnd(1.8, 3.4), rnd(4, 7), rnd(0.5, 1.2), 0.95, i % 3 ? 0xff7a1a : 0xffd070);
      for (let i = 0; i < 22; i++) this.smoke(x + rnd(-1.5, 1.5), y + rnd(0.5, 2.5), z + rnd(-1.5, 1.5), rnd(-3, 3), rnd(1, 5), rnd(-3, 3), rnd(1.4, 2.6), rnd(5, 9), rnd(1.8, 3.6), 0.7, 0x222222);
    },
    update(dt) {
      for (const pool of [smoke, fire]) {
        for (const p of pool) {
          if (p.life <= 0) continue;
          p.life -= dt;
          if (p.life <= 0) { p.s.visible = false; continue; }
          const k = 1 - p.life / p.max;
          p.v.multiplyScalar(Math.max(0, 1 - p.drag * dt)); p.v.y += p.up * dt;
          p.s.position.addScaledVector(p.v, dt);
          const sz = lerp(p.s0, p.s1, k);
          p.s.scale.set(sz, sz, 1);
          p.s.material.opacity = p.o * Math.pow(1 - k, 1.4);
        }
      }
      flash = Math.max(0, flash - dt * 2.2);
      light.intensity = flash * 1100;
    },
  };
  return api;
}

// ======================================================================================
// main
// ======================================================================================
export function createAircraft(opts) {
  const { scene, audio, hud, isTouch } = opts;
  const list = [];
  let occupied = null, lastPlayer = null, time = 0, idSeq = 0, netApi = null, lastSend = 0, view = 'first', bailT = -9, sound = null, camSaved = null;
  const remoteOwner = Object.create(null);
  const orbit = { yaw: 0, pitch: 0, idle: 9 };
  const fx = makeFx(scene);
  const C = {
    keys: new Set(), thr: 0, flaps: 0, gear: 1, engine: true, assist: true, lights: false, colLever: 0.6, brake: 0,
    t: { sx: 0, sy: 0, thr: null, rud: 0, col: 0, ped: 0, brake: 0 }, in: { pitch: 0, roll: 0, yaw: 0, up: 0 },
  };
  const V3 = THREE.Vector3;
  const _v = new V3(), _w = new V3(), _q = new THREE.Quaternion();
  // pilot targets for the helicopter (the plane gets its grips / feet from the cockpit)
  const _hl = { p: new V3(), q: new THREE.Quaternion() }, _hr = { p: new V3(), q: new THREE.Quaternion() }, _fl = new V3(), _fr = new V3();
  const AX = new V3(1, 0, 0), AY = new V3(0, 1, 0);

  loadTemplates();

  const sync = (v) => {
    const o = FL.originOf(v.s);
    v.inst.root.position.set(o[0], o[1], o[2]);
    v.inst.root.quaternion.set(v.s.q[0], v.s.q[1], v.s.q[2], v.s.q[3]);
    v.x = o[0]; v.y = o[1]; v.z = o[2];
  };
  const groundOf = (v) => (x, z) => floorAt(x, z, v.s.p[1] - 0.4, 0.2);
  const att = (v) => FL.attitude(v.s, v._a || (v._a = {}));

  // ---------- colliders while parked ----------
  function registerCols(v) {
    if (occupied === v || !v.alive && !v.wreck) return;
    unregisterCols(v);
    const a = att(v), fx0 = a.fwd[0], fz0 = a.fwd[2], hl = Math.hypot(fx0, fz0) || 1, f = [fx0 / hl, fz0 / hl], r = [-f[1], f[0]];
    for (const [xm, zm, size, top, y0] of v.T.cols) {
      const px = v.x + f[0] * zm - r[0] * xm, pz = v.z + f[1] * zm - r[1] * xm;
      const c = addCollider(px, pz, size, v.y + top, size, { y0: v.y + y0 });
      c.aircraft = v; c.noCover = true;
      c.onShot = (dmg, pt) => hit(v, dmg * 0.55, pt);
      v.cols.push(c);
    }
  }
  function unregisterCols(v) {
    for (const c of v.cols) { try { removeCollider(c); } catch (_) {} }
    v.cols.length = 0;
  }

  // ---------- spawning ----------
  function spawnOne(spec) {
    const kind = KIND[spec.type] || 'plane', T = TYPES[kind];
    const v = {
      id: spec.id || 'ac' + idSeq++, T, spec: { type: kind, x: spec.x, z: spec.z, yaw: spec.yaw || 0 }, hp: T.cfg.hp, alive: true, wreck: false, awake: false, sleepT: 0,
      cols: [], x: 0, y: 0, z: 0, imp: { wheel: 0, hull: 0, rotor: 0, name: '' }, dmgCd: 0, smokeT: 0, burning: false, respawnT: 0, spin: 0, spin2: 0, doorT: 0, doorUntil: 0,
      lights: false, blink: 0, engineFail: false, camBlend: 1, shake: 0, camQ: new THREE.Quaternion(), camInit: false, in: { pitch: 0, roll: 0, yaw: 0, up: 0 },
      inst: null, s: FL.createState(T.cfg),
    };
    v.inst = instantiate(T, spec);
    v.ground = groundOf(v);
    FL.placeOnGround(v.s, spec.x, spec.z, spec.yaw || 0, (x, z) => heightAt(x, z));
    scene.add(v.inst.root);
    sync(v);
    animate(v, 0.016);
    v.inst.root.updateMatrixWorld(true);
    list.push(v);
    registerCols(v);
    return v;
  }
  function spawnAt(spec) {
    if (!spec || !spec.type) return null;
    const kind = KIND[spec.type];
    if (!kind) return null;
    let out = null;
    whenReady(() => { out = spawnOne({ type: kind, x: spec.x || 0, z: spec.z || 0, yaw: spec.yaw || 0 }); });
    return out;
  }
  function defaultSpawns() {
    const at = (name) => POIS.find((p) => p.name === name);
    const af = at('Mercy Airfield'), fk = at('Fort Keller');
    if (af) {
      // runway runs along X; both planes face west (-X); the wreck on the apron sits at x + 60
      spawnOne({ type: 'plane', x: af.x + 38, z: af.z + 6, yaw: PI / 2 });
      spawnOne({ type: 'plane', x: af.x - 20, z: af.z - 7, yaw: PI / 2 });
      spawnOne({ type: 'heli', x: af.x - 12, z: af.z + 27, yaw: PI / 2 });
    }
    if (fk) spawnOne({ type: 'heli', x: fk.x + 26, z: fk.z, yaw: PI / 2 });
  }
  whenReady(defaultSpawns);

  // ---------- damage ----------
  function hurtPlayer(pl, dmg, x, z) {
    if (!pl || !pl.alive || dmg <= 0) return;
    if (opts.damagePlayer) opts.damagePlayer(dmg, x, z);
    else pl.hp = Math.max(1, pl.hp - dmg);
  }
  function hit(v, dmg, pt) {
    if (!v.alive || dmg <= 0) return;
    if (pt) fx.spark(pt.x, pt.y, pt.z);
    v.hp -= dmg;
    if (v.hp <= 0) explode(v);
    else if (occupied === v && dmg > 12) { v.shake = Math.min(1, v.shake + dmg / 80); if (hud) hud.setMsg(`Aircraft damaged · ${Math.round((v.hp / v.T.cfg.hp) * 100)}%`, 900); }
  }
  function explode(v) {
    if (!v.alive) return;
    v.alive = false; v.wreck = true; v.hp = 0; v.burning = false; v.respawnT = 150;
    toWreck(v.inst);
    fx.blast(v.x, v.y + 1, v.z);
    boom(1);
    if (audio) try { audio.play('thud', v.x, v.z); } catch (_) {}
    if (hud) hud.setMsg('Aircraft destroyed', 1500);
    v.s.w[0] += rnd(-1, 1); v.s.w[2] += rnd(-1, 1); v.s.v[1] += 3;
    v.s.engine = false; v.s.thr = 0;
    const pl = lastPlayer;
    if (occupied === v) {
      const spd = Math.hypot(v.s.v[0], v.s.v[1], v.s.v[2]), air = v.s.aglV > 8;
      hurtPlayer(pl, air ? 130 : clamp(40 + spd * 4, 40, 130), v.x, v.z);
      release(pl, v, true);
    } else if (pl && pl.alive) {
      const d = Math.hypot(pl.x - v.x, pl.z - v.z);
      if (d < 9) hurtPlayer(pl, 80 * (1 - d / 9), v.x, v.z);
    }
    v.awake = true; v.sleepT = 0;
    registerCols(v);
  }

  /** turn the impact speeds from the last physics step into damage */
  function applyImpacts(v, dt) {
    const T = v.T, im = v.imp, plane = T.id === 'plane', s = v.s;
    v.dmgCd = Math.max(0, v.dmgCd - dt);
    let dmg = 0;
    if (v.dmgCd <= 0) {
      if (plane) {
        if (im.wheel > 4.6) dmg += im.wheel > 9.5 ? 999 : (im.wheel - 4.6) * 32;
        if (im.hull > 2.4) dmg += (im.hull - 2.4) * 48;
      } else {
        if (im.wheel > 3.4) dmg += im.wheel > 9 ? 999 : (im.wheel - 3.4) * 42;
        if (im.hull > 2) dmg += (im.hull - 2) * 55;
        if (im.rotor > 0.5) dmg += 90 + im.rotor * 25;
      }
      if (dmg > 0) {
        v.dmgCd = 0.3;
        const big = Math.max(im.wheel, im.hull);
        if (big > 2.5) { v.shake = Math.min(1, big / 12); fx.spark(v.x, v.y + 0.5, v.z); if (audio) try { audio.play(big > 5 ? 'clang' : 'thud', v.x, v.z); } catch (_) {} }
        hit(v, dmg, null);
      }
    }
    im.wheel = im.hull = im.rotor = 0;
    if (!v.alive) return;
    if (plane && s.V > T.cfg.vne) hit(v, (s.V - T.cfg.vne) * 1.8 * dt, null);
    if (s.gLoad > 8.5 || s.gLoad < -4) hit(v, 30 * dt, null);
    if (T.id === 'heli' && s.Tn > 0 && s.vh > T.cfg.vne + 6) hit(v, (s.vh - T.cfg.vne) * 2 * dt, null);
  }

  /** point-vs-AABB collisions with buildings / walls / other vehicles (not with the ground, which the physics handle) */
  const PTS = {};
  function pointsOf(v) {
    const T = v.T;
    if (PTS[T.id]) return PTS[T.id];
    const cfg = T.cfg, out = cfg._hull.map((h) => ({ r: h.r, n: h.n, rotor: !!h.rotor }));
    if (T.id === 'plane') for (const w of cfg._wheels) out.push({ r: w.r0, n: 'wheel' });
    else { for (const p of cfg._rotorPts) out.push({ r: p, n: 'rotor', rotor: true }); for (const k of cfg._skids) out.push({ r: k.r, n: 'skid' }); }
    return (PTS[T.id] = out);
  }
  function obstacles(v) {
    const s = v.s, pts = pointsOf(v), spin = v.T.id === 'heli' ? s.rpm : 0;
    for (const pt of pts) {
      const wp = FL.rot(s.q, pt.r), px = s.p[0] + wp[0], py = s.p[1] + wp[1], pz = s.p[2] + wp[2];
      if (pt.rotor && spin < 0.25) continue;
      const near = queryRect(px - 0.4, pz - 0.4, px + 0.4, pz + 0.4);
      for (let i = 0; i < near.length; i++) {
        const c = near[i];
        if (c.aircraft === v || c.ramp || c._off) continue;
        if (px < c.minX || px > c.maxX || pz < c.minZ || pz > c.maxZ || py < c.y0 + 0.05 || py > c.h - 0.45) continue;
        const dl = px - c.minX, dr = c.maxX - px, du = pz - c.minZ, dd = c.maxZ - pz, m = Math.min(dl, dr, du, dd);
        const nx = m === dl ? -1 : m === dr ? 1 : 0, nz = m === du ? -1 : m === dd ? 1 : 0;
        s.p[0] += nx * (m + 0.03); s.p[2] += nz * (m + 0.03);
        const vn = s.v[0] * nx + s.v[2] * nz;
        if (vn < 0) {
          s.v[0] -= 1.2 * vn * nx; s.v[2] -= 1.2 * vn * nz;
          s.w[0] *= 0.6; s.w[1] *= 0.6; s.w[2] *= 0.6;
          const spd = -vn;
          if (spd > 3 && v.dmgCd <= 0) {
            v.dmgCd = 0.3; v.shake = Math.min(1, spd / 14);
            fx.spark(px, py, pz);
            if (audio) try { audio.play('thud', px, pz); audio.play('clang', px, pz, { vol: 0.5 }); } catch (_) {}
            hit(v, (pt.rotor ? 140 : 0) + (spd - 3) * 38, null);
          }
          if (c.onShot && c.aircraft == null && c.vehicle == null) { /* props / builds: leave them alone */ }
        }
        break;
      }
      if (!v.alive) return;
    }
    // world edge
    const lim = WORLD_HALF - 4;
    if (Math.abs(s.p[0]) > lim) { s.p[0] = Math.sign(s.p[0]) * lim; s.v[0] *= -0.2; }
    if (Math.abs(s.p[2]) > lim) { s.p[2] = Math.sign(s.p[2]) * lim; s.v[2] *= -0.2; }
  }

  /** one frame of physics for an aircraft: substeps, impacts, obstacles */
  function simulate(v, dt, ctl) {
    const n = Math.min(5, Math.max(1, Math.ceil(dt / 0.0095))), h = dt / n, step = v.T.id === 'plane' ? FL.stepPlane : FL.stepHeli, s = v.s;
    v.imp.wheel = v.imp.hull = v.imp.rotor = 0;
    for (let i = 0; i < n; i++) {
      step(s, h, ctl, v.ground);
      const im = s.impact;
      if (im.wheel > v.imp.wheel) v.imp.wheel = im.wheel;
      if (im.hull > v.imp.hull) { v.imp.hull = im.hull; v.imp.name = im.hullName; }
      if (im.rotor > v.imp.rotor) v.imp.rotor = im.rotor;
    }
    if (!(Number.isFinite(s.p[0] + s.p[1] + s.p[2] + s.v[0] + s.v[1] + s.v[2] + s.q[0] + s.q[3]))) { // numeric blow-up: put it back on the ground
      FL.placeOnGround(s, v.spec.x, v.spec.z, v.spec.yaw, (x, z) => heightAt(x, z));
    }
    if (s.p[1] < heightAt(s.p[0], s.p[2]) - 6) { s.p[1] = heightAt(s.p[0], s.p[2]) + 3; s.v[1] = 0; }
    for (const k of [0, 1, 2]) { const m = Math.abs(s.v[k]); if (m > 140) s.v[k] = Math.sign(s.v[k]) * 140; }
    sync(v);
    obstacles(v);
    applyImpacts(v, dt);
  }

  // ======================================================================================
  // DOM: HUDs + touch controls (a different set for each aircraft)
  // ======================================================================================
  const $ = (id) => document.getElementById(id);
  const css = `
body.in-aircraft #cross,body.in-aircraft #ammoBox,body.in-aircraft #slots,body.in-aircraft #reloadWrap,body.in-aircraft #buildBar,body.in-aircraft #hitm,body.in-aircraft #hint,body.in-aircraft #vitals{display:none!important}
body.mobile.in-aircraft #mobile,body.mobile.in-aircraft #chatWrap{display:none!important}
#acHud{display:none;position:fixed;inset:0;z-index:26;pointer-events:none;font:700 11px ui-monospace,Menlo,monospace;color:#e8eef6;text-shadow:0 1px 3px rgba(0,0,0,.8)}
body.in-aircraft #acHud{display:block}
#acHud canvas{display:block}
#acPlane,#acHeli{display:none;position:absolute;inset:0}
body.ac-plane #acPlane,body.ac-heli #acHeli{display:block}
.acHdg{position:absolute;left:50%;top:calc(46px + env(safe-area-inset-top));transform:translateX(-50%)}
.acRow{position:absolute;left:50%;bottom:calc(12px + env(safe-area-inset-bottom));transform:translateX(-50%);display:flex;gap:6px;align-items:flex-end}
.acRow canvas{background:rgba(8,12,18,.62);border:1px solid rgba(255,255,255,.18);border-radius:10px}
.acRow canvas.rnd{border-radius:50%}
.acSide{position:absolute;bottom:calc(14px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:5px;padding:8px 10px;border-radius:10px;background:rgba(8,12,18,.66);border:1px solid rgba(255,255,255,.16);min-width:130px}
.acSide.L{left:14px}.acSide.R{right:14px}
.acBar{display:flex;align-items:center;gap:6px;font-size:10px}.acBar span{width:34px;opacity:.7}
.acBar i{flex:1;height:7px;border-radius:4px;background:rgba(255,255,255,.12);overflow:hidden;position:relative}.acBar i b{position:absolute;left:0;top:0;bottom:0;width:0}
.acBar.thr b{background:linear-gradient(90deg,#3a7ec4,#7ec8ff)}.acBar.fuel b{background:linear-gradient(90deg,#3a9e5c,#6dff9a)}.acBar.hp b{background:linear-gradient(90deg,#c43c3c,#ff7a5c)}.acBar.col b{background:linear-gradient(90deg,#b8801a,#ffc247)}.acBar.low b{background:linear-gradient(90deg,#d63a3a,#ffc247)}
.acChip{display:flex;justify-content:space-between;gap:10px;padding:3px 7px;border-radius:5px;background:rgba(255,255,255,.08);font-size:10px}.acChip b{color:#6dff9a}.acChip b.bad{color:#ff7a5c}.acChip b.warn{color:#ffc247}
#acWarn{position:absolute;left:50%;top:calc(110px + env(safe-area-inset-top));transform:translateX(-50%);font:900 20px ui-monospace,Menlo,monospace;letter-spacing:.16em;color:#ff5a4a;text-align:center;animation:acfl .5s steps(2) infinite}
@keyframes acfl{50%{opacity:.25}}
#acHelp{position:absolute;left:50%;bottom:calc(178px + env(safe-area-inset-bottom));transform:translateX(-50%);font-size:10px;opacity:.55;white-space:nowrap}
body.mobile #acHelp{display:none}
body.mobile .acSide.L{left:auto;right:12px;bottom:auto;top:calc(90px + env(safe-area-inset-top));min-width:110px}
body.mobile .acSide.R{display:none}
body.mobile .acRow{transform:translateX(-50%) scale(.72);transform-origin:bottom center}
#acPrompt{display:none;position:fixed;left:50%;bottom:calc(110px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:24;padding:7px 14px;border-radius:8px;background:rgba(0,0,0,.6);border:1px solid rgba(255,255,255,.2);color:#fff;font:800 14px ui-monospace,Menlo,monospace;pointer-events:none;white-space:nowrap}
#acPrompt.on{display:block}
#acT{display:none;position:fixed;inset:0;z-index:30;pointer-events:none;touch-action:none}
body.mobile.in-aircraft #acT{display:block}
#acT *{touch-action:none;user-select:none;-webkit-user-select:none}
#acLook{position:absolute;inset:0;pointer-events:auto}
#acT .tb{position:absolute;pointer-events:auto;border-radius:12px;border:2px solid rgba(255,255,255,.4);background:rgba(255,255,255,.12);color:#fff;font:800 11px system-ui;display:flex;align-items:center;justify-content:center;text-align:center;letter-spacing:.04em}
#acT .tb.down,#acT .tb.on{background:rgba(255,194,71,.45);border-color:#ffc247}
#acT .pl,#acT .he{display:none}
body.ac-plane #acT .pl,body.ac-heli #acT .he{display:flex}
#acT .pad{position:absolute;pointer-events:auto;left:calc(18px + env(safe-area-inset-left));bottom:calc(20px + env(safe-area-inset-bottom));width:150px;height:150px;border-radius:50%;background:rgba(255,255,255,.08);border:2px solid rgba(255,255,255,.35)}
#acT .pad:before,#acT .pad:after{content:'';position:absolute;background:rgba(255,255,255,.18)}
#acT .pad:before{left:50%;top:10px;bottom:10px;width:1px}#acT .pad:after{top:50%;left:10px;right:10px;height:1px}
#acT .pad i{position:absolute;left:50%;top:50%;width:58px;height:58px;margin:-29px;border-radius:50%;background:rgba(255,255,255,.32);border:2px solid rgba(255,255,255,.6);pointer-events:none}
#acT .pad em{position:absolute;left:0;right:0;top:-18px;text-align:center;font:800 9px system-ui;letter-spacing:.14em;opacity:.7;font-style:normal}
#acT .vs{position:absolute;pointer-events:auto;right:calc(16px + env(safe-area-inset-right));bottom:calc(24px + env(safe-area-inset-bottom));width:64px;height:190px;border-radius:32px;background:rgba(255,255,255,.08);border:2px solid rgba(255,255,255,.35)}
#acT .vs i{position:absolute;left:3px;right:3px;bottom:3px;border-radius:28px;background:rgba(109,200,255,.38)}
#acT .vs.col i{background:rgba(255,194,71,.4)}
#acT .vs.col b{top:50%}
#acT .vs em{position:absolute;left:0;right:0;top:-18px;text-align:center;font:800 9px system-ui;letter-spacing:.14em;opacity:.7;font-style:normal}
#acT .vs b{position:absolute;left:4px;right:4px;height:22px;margin-top:-11px;border-radius:10px;background:#fff;opacity:.85}
#acT .hs{position:absolute;pointer-events:auto;left:50%;transform:translateX(-50%);bottom:calc(14px + env(safe-area-inset-bottom));width:min(34vw,240px);height:54px;border-radius:27px;background:rgba(255,255,255,.08);border:2px solid rgba(255,255,255,.35)}
#acT .hs:before{content:'RUDDER';position:absolute;left:0;right:0;top:-16px;text-align:center;font:800 9px system-ui;letter-spacing:.14em;opacity:.7}
#acT .hs b{position:absolute;top:5px;bottom:5px;width:50px;left:50%;margin-left:-25px;border-radius:22px;background:rgba(255,255,255,.55)}
#acTop{position:absolute;right:calc(10px + env(safe-area-inset-right));top:calc(46px + env(safe-area-inset-top));display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;max-width:94vw;pointer-events:none}
#acTop .tb{position:relative;width:48px;height:38px}
#acTop #atExit{width:84px;border-color:rgba(255,110,110,.9);background:rgba(210,60,60,.45);font-size:13px}
#acSide2,#acSide3{position:absolute;right:calc(96px + env(safe-area-inset-right));bottom:calc(24px + env(safe-area-inset-bottom));display:none;flex-direction:column;gap:6px;pointer-events:none}
body.ac-plane #acSide2,body.ac-heli #acSide3{display:flex}
#acSide2 .tb,#acSide3 .tb{position:relative;width:76px;height:42px}
#acPed{display:none;position:absolute;left:calc(184px + env(safe-area-inset-left));bottom:calc(26px + env(safe-area-inset-bottom));display:flex;gap:8px;pointer-events:none}
body.ac-heli #acPed{display:flex}
#acPed .tb{position:relative;width:78px;height:78px}`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  const hudEl = document.createElement('div');
  hudEl.id = 'acHud';
  hudEl.innerHTML = `<div id="acWarn"></div><div id="acHelp"></div>
<div id="acPlane"><canvas id="acpHdg" class="acHdg" width="380" height="34"></canvas>
<div class="acRow"><canvas id="acpAsi" class="rnd" width="150" height="150"></canvas><canvas id="acpAtt" class="rnd" width="170" height="170"></canvas><canvas id="acpAlt" class="rnd" width="150" height="150"></canvas></div>
<div class="acSide L"><div class="acBar thr"><span>THR</span><i><b id="apThr"></b></i></div><div class="acBar fuel"><span>FUEL</span><i><b id="apFuel"></b></i></div><div class="acBar hp"><span>BODY</span><i><b id="apHp"></b></i></div><div class="acChip">RPM<b id="apRpm">0</b></div><div class="acChip">G<b id="apG">1.0</b></div></div>
<div class="acSide R"><div class="acChip">GEAR<b id="apGear">DOWN</b></div><div class="acChip">FLAPS<b id="apFlap">0°</b></div><div class="acChip">BRAKE<b id="apBrk">OFF</b></div><div class="acChip">ASSIST<b id="apAs">ON</b></div><div class="acChip">LIGHTS<b id="apLt">OFF</b></div></div></div>
<div id="acHeli"><canvas id="achHdg" class="acHdg" width="380" height="34"></canvas>
<div class="acRow"><canvas id="achAlt" width="74" height="190"></canvas><canvas id="achAtt" class="rnd" width="170" height="170"></canvas><canvas id="achRot" class="rnd" width="150" height="150"></canvas><canvas id="achSpd" width="74" height="190"></canvas></div>
<div class="acSide L"><div class="acBar col"><span>COLL</span><i><b id="ahCol"></b></i></div><div class="acBar fuel"><span>FUEL</span><i><b id="ahFuel"></b></i></div><div class="acBar hp"><span>BODY</span><i><b id="ahHp"></b></i></div><div class="acChip">VSI<b id="ahVsi">0</b></div></div>
<div class="acSide R"><div class="acChip">ENGINE<b id="ahEng">OFF</b></div><div class="acChip">ROTOR<b id="ahNr">0%</b></div><div class="acChip">SAS<b id="ahSas">ON</b></div><div class="acChip">LIGHTS<b id="ahLt">OFF</b></div></div></div>`;
  document.body.appendChild(hudEl);
  const prompt = document.createElement('div'); prompt.id = 'acPrompt'; document.body.appendChild(prompt);

  const ui = document.createElement('div');
  ui.id = 'acT';
  ui.innerHTML = `<div id="acLook"></div>
<div class="pad pl" id="atpPad"><em>YOKE</em><i></i></div><div class="vs pl" id="atpThr"><em>THROTTLE</em><i></i></div><div class="hs pl" id="atpRud"><b></b></div>
<div id="acSide2" class="pl"><div class="tb pl" id="atpGear">GEAR</div><div class="tb pl" id="atpFlap">FLAPS</div><div class="tb pl" id="atpBrk">BRAKE</div></div>
<div class="pad he" id="athPad"><em>CYCLIC</em><i></i></div><div class="vs col he" id="athCol"><em>COLLECTIVE</em><b></b></div>
<div id="acPed" class="he"><div class="tb he" id="athPL">◄ YAW</div><div class="tb he" id="athPR">YAW ►</div></div>
<div id="acSide3" class="he"><div class="tb he" id="athEng">ENGINE</div></div>
<div id="acTop"><div class="tb" id="atExit">EXIT</div><div class="tb" id="atCam">CAM</div><div class="tb" id="atAs">ASSIST</div><div class="tb" id="atLt">LIGHT</div><div class="tb" id="atMap">MAP</div><div class="tb" id="atPause">II</div></div>`;
  document.body.appendChild(ui);

  function press(el, onDown, onUp) {
    let on = false;
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); try { el.setPointerCapture(e.pointerId); } catch (_) {} on = true; el.classList.add('down'); if (onDown) onDown(e); });
    const up = (e) => { e.preventDefault(); if (!on) return; on = false; el.classList.remove('down'); if (onUp) onUp(e); };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
  }
  function pad(el, onMove, onEnd) {
    const knob = el.querySelector('i');
    let pid = null;
    const set = (e) => {
      const r = el.getBoundingClientRect(), R = r.width / 2 - 20;
      let dx = (e.clientX - (r.left + r.width / 2)) / R, dy = (e.clientY - (r.top + r.height / 2)) / R;
      const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; }
      knob.style.transform = `translate(${dx * R}px,${dy * R}px)`;
      onMove(dx, dy);
    };
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); pid = e.pointerId; try { el.setPointerCapture(pid); } catch (_) {} set(e); });
    el.addEventListener('pointermove', (e) => { if (e.pointerId === pid) { e.preventDefault(); set(e); } });
    const end = (e) => { if (e.pointerId !== pid) return; pid = null; knob.style.transform = ''; onEnd(); };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end); el.addEventListener('lostpointercapture', end);
  }
  /** vertical slider; spring = returns to centre on release (value -1..1), else absolute 0..1 */
  function vslider(el, onVal, spring, onEnd) {
    const thumb = el.querySelector('b'), fill = el.querySelector('i');
    let pid = null;
    const set = (e) => {
      const r = el.getBoundingClientRect(), t = clamp(1 - (e.clientY - r.top - 16) / (r.height - 32), 0, 1);
      if (spring) { onVal(t * 2 - 1); if (thumb) thumb.style.top = (1 - t) * 100 + '%'; } else onVal(t);
    };
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); pid = e.pointerId; try { el.setPointerCapture(pid); } catch (_) {} set(e); });
    el.addEventListener('pointermove', (e) => { if (e.pointerId === pid) { e.preventDefault(); set(e); } });
    const end = (e) => { if (e.pointerId !== pid) return; pid = null; if (spring) { onVal(0); if (thumb) thumb.style.top = '50%'; } if (onEnd) onEnd(); };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end); el.addEventListener('lostpointercapture', end);
    return { fill, thumb };
  }
  pad($('atpPad'), (x, y) => { C.t.sx = x; C.t.sy = y; }, () => { C.t.sx = C.t.sy = 0; });
  pad($('athPad'), (x, y) => { C.t.sx = x; C.t.sy = y; }, () => { C.t.sx = C.t.sy = 0; });
  const thrUi = vslider($('atpThr'), (t) => { C.thr = t; }, false);
  vslider($('athCol'), (t) => { C.t.col = t; }, true);
  { // rudder slider
    const el = $('atpRud'), b = el.querySelector('b');
    let pid = null;
    const set = (e) => { const r = el.getBoundingClientRect(), n = clamp((e.clientX - (r.left + r.width / 2)) / (r.width / 2 - 28), -1, 1); C.t.rud = n; b.style.transform = `translateX(${n * (r.width / 2 - 28)}px)`; };
    el.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); pid = e.pointerId; try { el.setPointerCapture(pid); } catch (_) {} set(e); });
    el.addEventListener('pointermove', (e) => { if (e.pointerId === pid) set(e); });
    const end = (e) => { if (e.pointerId !== pid) return; pid = null; C.t.rud = 0; b.style.transform = ''; };
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end); el.addEventListener('lostpointercapture', end);
  }
  press($('atpGear'), () => toggleGear());
  press($('atpFlap'), () => cycleFlaps());
  press($('atpBrk'), () => { C.t.brake = 1; }, () => { C.t.brake = 0; });
  press($('athPL'), () => { C.t.ped = -1; }, () => { C.t.ped = 0; });
  press($('athPR'), () => { C.t.ped = 1; }, () => { C.t.ped = 0; });
  press($('athEng'), () => toggleEngine());
  press($('atExit'), () => { if (lastPlayer) tryUse(lastPlayer); });
  press($('atCam'), () => toggleCam());
  press($('atAs'), () => toggleAssist());
  press($('atLt'), () => toggleLights());
  press($('atMap'), () => dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'm' })));
  press($('atPause'), () => { const b = document.getElementById('btnPause'); if (b) b.click(); });
  { // look pad: drag anywhere free to look around
    const lk = $('acLook');
    let pid = null, lx = 0, ly = 0;
    lk.addEventListener('pointerdown', (e) => { e.preventDefault(); pid = e.pointerId; lx = e.clientX; ly = e.clientY; try { lk.setPointerCapture(pid); } catch (_) {} });
    lk.addEventListener('pointermove', (e) => { if (e.pointerId !== pid) return; e.preventDefault(); orbitBy(e.clientX - lx, e.clientY - ly, 0.0065 * settings.sens); lx = e.clientX; ly = e.clientY; });
    const end = (e) => { if (e.pointerId === pid) pid = null; };
    lk.addEventListener('pointerup', end); lk.addEventListener('pointercancel', end); lk.addEventListener('lostpointercapture', end);
  }
  function orbitBy(dx, dy, k) {
    orbit.yaw = clamp(orbit.yaw - dx * k, -3.2, 3.2);
    orbit.pitch = clamp(orbit.pitch - dy * k * 0.7, -0.9, 0.9);
    orbit.idle = 0;
  }
  addEventListener('mousemove', (e) => {
    if (!occupied || document.pointerLockElement == null || Math.abs(e.movementX) > 350) return;
    orbitBy(e.movementX, e.movementY, 0.0022 * settings.sens);
  });

  // ---------- keyboard ----------
  const typing = () => { const a = document.activeElement; return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'); };
  const msg = (t, ms = 900) => { if (hud) hud.setMsg(t, ms); };
  function toggleGear() {
    const v = occupied;
    if (!v || v.T.id !== 'plane') return;
    if (v.s.onGround && C.gear) { msg('Gear locked: you are on the ground'); return; }
    C.gear = C.gear ? 0 : 1;
    msg(C.gear ? 'Gear down' : 'Gear up', 800);
  }
  function cycleFlaps() {
    if (!occupied || occupied.T.id !== 'plane') return;
    C.flaps = (C.flaps + 1) % 4;
    msg(`Flaps ${[0, 10, 20, 30][C.flaps]}°`, 800);
  }
  function toggleEngine() {
    const v = occupied;
    if (!v) return;
    if (v.engineFail || v.s.fuel <= 0) { msg(v.s.fuel <= 0 ? 'Out of fuel' : 'Engine damaged', 1000); return; }
    C.engine = !C.engine;
    msg(C.engine ? (v.T.id === 'heli' ? 'Engine start: rotor spooling up' : 'Engine on') : 'Engine off', 1200);
  }
  function toggleAssist() {
    C.assist = !C.assist;
    msg(occupied && occupied.T.id === 'heli' ? (C.assist ? 'Stability assist ON (attitude + altitude hold)' : 'Stability assist OFF: full manual') : (C.assist ? 'Flight assist ON' : 'Flight assist OFF'), 1300);
  }
  function toggleLights() { C.lights = !C.lights; msg(C.lights ? 'Lights on' : 'Lights off', 700); }
  addEventListener('keydown', (e) => {
    if (!occupied || typing()) return;
    const k = e.code;
    C.keys.add(k);
    if (e.repeat) return;
    if (k === 'KeyL') toggleLights();
    else if (k === 'KeyU') toggleAssist();
    else if (k === 'KeyR') toggleEngine();
    else if (k === 'KeyH') toggleGear();
    else if (k === 'KeyF') cycleFlaps();
  });
  addEventListener('keyup', (e) => { C.keys.delete(e.code); });
  const resetInputs = () => { C.keys.clear(); C.t.sx = C.t.sy = C.t.rud = C.t.col = C.t.ped = C.t.brake = 0; ui.querySelectorAll('.down').forEach((n) => n.classList.remove('down')); };
  addEventListener('blur', resetInputs);
  document.addEventListener('visibilitychange', resetInputs);

  /** read pilot input into the controls the flight model wants */
  function readControls(v, dt) {
    const K = C.keys, t = C.t, plane = v.T.id === 'plane', has = (...c) => c.some((x) => K.has(x));
    const inv = settings.invertY ? -1 : 1;
    const ax = (has('KeyD') ? 1 : 0) - (has('KeyA') ? 1 : 0) + t.sx, rud = (has('ArrowRight') ? 1 : 0) - (has('ArrowLeft') ? 1 : 0) + t.rud + t.ped;
    const out = v.in;
    if (plane) {
      out.pitch = clamp((has('KeyS', 'ArrowDown') ? 1 : 0) - (has('KeyW', 'ArrowUp') ? 1 : 0) + t.sy * inv, -1, 1);
      out.roll = clamp(ax, -1, 1); out.yaw = clamp(rud, -1, 1);
      if (has('ShiftLeft', 'ShiftRight')) C.thr = Math.min(1, C.thr + 0.55 * dt);
      if (has('KeyC')) C.thr = Math.max(0, C.thr - 0.55 * dt);
      return { pitch: out.pitch, roll: out.roll, yaw: out.yaw, thr: C.thr, brake: has('Space') || t.brake ? 1 : 0, flaps: C.flaps, gear: C.gear, assist: C.assist, engine: C.engine && !v.engineFail };
    }
    out.pitch = clamp((has('KeyW', 'ArrowUp') ? 1 : 0) - (has('KeyS', 'ArrowDown') ? 1 : 0) - t.sy * inv, -1, 1); // + = nose down / forward
    out.roll = clamp(ax, -1, 1); out.yaw = clamp(rud, -1, 1);
    out.up = clamp((has('Space') ? 1 : 0) - (has('KeyC') ? 1 : 0) + t.col, -1, 1);
    C.colLever = clamp(C.colLever + out.up * 0.45 * dt, 0, 1);
    return { pitch: out.pitch, roll: out.roll, yaw: out.yaw, up: out.up, colLever: C.colLever, assist: C.assist, engine: C.engine && !v.engineFail };
  }

  // ======================================================================================
  // gauges
  // ======================================================================================
  const AMB = '#ffc247', INK = '#e8eef6';
  const cvs = {}, getC = (id) => cvs[id] || (cvs[id] = (() => { const c = $(id); return { c, g: c.getContext('2d') }; })());
  function dial(id, val, min, max, o) {
    const { c, g } = getC(id), S = c.width, R = S / 2;
    g.clearRect(0, 0, S, S);
    g.save(); g.translate(R, R);
    const a0 = PI * 0.75, sw = PI * 1.5, ang = (x) => a0 + clamp((x - min) / (max - min), 0, 1) * sw;
    g.lineWidth = 6;
    for (const [from, to, col] of o.arcs || []) { g.strokeStyle = col; g.beginPath(); g.arc(0, 0, R - 9, ang(from), ang(to)); g.stroke(); }
    g.strokeStyle = 'rgba(255,255,255,.75)'; g.fillStyle = INK; g.font = `700 ${S * 0.075}px ui-monospace,monospace`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineWidth = 2;
    for (let x = min; x <= max + 1e-6; x += o.minor) {
      const a = ang(x), major = Math.abs((x - min) % o.major) < 1e-6 || Math.abs(((x - min) % o.major) - o.major) < 1e-6;
      g.beginPath(); g.moveTo(Math.cos(a) * (R - 20 + (major ? 0 : 5)), Math.sin(a) * (R - 20 + (major ? 0 : 5))); g.lineTo(Math.cos(a) * (R - 12), Math.sin(a) * (R - 12)); g.stroke();
      if (major) g.fillText(String(Math.round(x / (o.div || 1))), Math.cos(a) * (R - 34), Math.sin(a) * (R - 34));
    }
    g.fillStyle = 'rgba(255,255,255,.55)'; g.font = `700 ${S * 0.07}px system-ui`; g.fillText(o.label, 0, R * 0.42);
    if (o.read != null) { g.fillStyle = AMB; g.font = `800 ${S * 0.11}px ui-monospace,monospace`; g.fillText(o.read, 0, R * 0.62); }
    const a = ang(val);
    g.strokeStyle = AMB; g.lineWidth = 3.5; g.lineCap = 'round'; g.beginPath(); g.moveTo(-Math.cos(a) * 10, -Math.sin(a) * 10); g.lineTo(Math.cos(a) * (R - 18), Math.sin(a) * (R - 18)); g.stroke();
    g.fillStyle = '#222'; g.beginPath(); g.arc(0, 0, 6, 0, TAU); g.fill();
    g.restore();
  }
  function horizon(id, pitch, roll) {
    const { c, g } = getC(id), S = c.width, R = S / 2, k = (S * 0.5) / 0.6; // px per radian of pitch (+-34 degrees on the ball)
    g.clearRect(0, 0, S, S);
    g.save(); g.translate(R, R);
    g.beginPath(); g.arc(0, 0, R - 4, 0, TAU); g.clip();
    g.rotate(-roll); // right wing down -> the horizon turns counter-clockwise on screen
    const py = pitch * k;
    g.fillStyle = '#3f7fbf'; g.fillRect(-S, -S * 2 + py, S * 2, S * 2);
    g.fillStyle = '#6b4a2b'; g.fillRect(-S, py, S * 2, S * 2);
    g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(-S, py); g.lineTo(S, py); g.stroke();
    g.font = `700 ${S * 0.065}px system-ui`; g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (let d = -30; d <= 30; d += 10) {
      if (!d) continue;
      const y = py - d * (PI / 180) * k, w = d % 20 ? S * 0.1 : S * 0.18;
      g.beginPath(); g.moveTo(-w / 2, y); g.lineTo(w / 2, y); g.stroke();
      if (!(d % 20)) { g.fillText(String(Math.abs(d)), -w / 2 - 12, y); g.fillText(String(Math.abs(d)), w / 2 + 12, y); }
    }
    g.restore();
    g.save(); g.translate(R, R);
    g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, R - 4, 0, TAU); g.stroke();
    g.rotate(-roll);
    for (const d of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) { const a = -PI / 2 + (d * PI) / 180; g.beginPath(); g.moveTo(Math.cos(a) * (R - 4), Math.sin(a) * (R - 4)); g.lineTo(Math.cos(a) * (R - (d % 30 === 0 ? 16 : 10)), Math.sin(a) * (R - (d % 30 === 0 ? 16 : 10))); g.stroke(); }
    g.restore();
    g.save(); g.translate(R, R); g.strokeStyle = AMB; g.lineWidth = 4; g.lineCap = 'round';
    g.beginPath(); g.moveTo(-S * 0.3, 0); g.lineTo(-S * 0.1, 0); g.lineTo(-S * 0.1, S * 0.04); g.moveTo(S * 0.3, 0); g.lineTo(S * 0.1, 0); g.lineTo(S * 0.1, S * 0.04); g.stroke();
    g.fillStyle = AMB; g.beginPath(); g.arc(0, 0, 3, 0, TAU); g.fill(); g.restore();
  }
  function tape(id, val, step, o) {
    const { c, g } = getC(id), W = c.width, H = c.height, ppu = (H * 0.5) / (step * 2.5);
    g.clearRect(0, 0, W, H);
    g.font = '700 11px ui-monospace,monospace'; g.textBaseline = 'middle'; g.fillStyle = INK; g.strokeStyle = 'rgba(255,255,255,.6)';
    const first = Math.floor((val - step * 3) / (step / 2)) * (step / 2);
    for (let x = first; x < val + step * 3; x += step / 2) {
      const y = H / 2 - (x - val) * ppu, major = Math.abs(x / step - Math.round(x / step)) < 1e-6;
      g.beginPath(); g.moveTo(o.right ? 0 : W, y); g.lineTo(o.right ? (major ? 14 : 8) : W - (major ? 14 : 8), y); g.stroke();
      if (major && x >= (o.min == null ? -1e9 : o.min)) { g.textAlign = o.right ? 'left' : 'right'; g.fillText(String(Math.round(x)), o.right ? 18 : W - 18, y); }
    }
    g.fillStyle = 'rgba(0,0,0,.78)'; g.fillRect(2, H / 2 - 12, W - 4, 24); g.strokeStyle = AMB; g.lineWidth = 2; g.strokeRect(2, H / 2 - 12, W - 4, 24);
    g.fillStyle = AMB; g.textAlign = 'center'; g.font = '800 13px ui-monospace,monospace'; g.fillText(String(Math.round(val)), W / 2, H / 2 + 1);
    g.fillStyle = 'rgba(255,255,255,.6)'; g.font = '700 9px system-ui'; g.fillText(o.label, W / 2, 9);
  }
  function compass(id, hdg) {
    const { c, g } = getC(id), W = c.width, H = c.height, ppd = W / 110;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(8,12,18,.55)'; g.fillRect(0, 0, W, H);
    g.font = '700 11px ui-monospace,monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.strokeStyle = 'rgba(255,255,255,.7)'; g.fillStyle = INK;
    const CARD = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
    for (let d = Math.floor(hdg - 60); d <= hdg + 60; d++) {
      if (d % 5) continue;
      const x = W / 2 + (d - hdg) * ppd, dd = ((d % 360) + 360) % 360;
      g.beginPath(); g.moveTo(x, H); g.lineTo(x, H - (dd % 10 ? 5 : 9)); g.stroke();
      if (dd % 30 === 0) g.fillText(CARD[dd] || String(dd), x, 11);
    }
    g.fillStyle = AMB; g.beginPath(); g.moveTo(W / 2 - 6, 0); g.lineTo(W / 2 + 6, 0); g.lineTo(W / 2, 8); g.fill();
    g.font = '800 11px ui-monospace,monospace'; g.fillText(String(Math.round(((hdg % 360) + 360) % 360)).padStart(3, '0'), W / 2, H - 9);
  }
  const bar = (id, f, low) => { const e = $(id); if (!e) return; e.style.width = clamp(f, 0, 1) * 100 + '%'; e.parentElement.parentElement.classList.toggle('low', !!low); };
  const chip = (id, txt, cls) => { const e = $(id); if (e) { e.textContent = txt; e.className = cls || ''; } };

  function updateHud(v) {
    const s = v.s, a = att(v), plane = v.T.id === 'plane', hdg = ((-a.yaw * 180) / PI + 360) % 360; // game yaw is counter-clockwise: compass heading is the opposite
    const spd = Math.hypot(s.v[0], s.v[1], s.v[2]), kmh = spd * 3.6, agl = s.aglV, vsi = s.v[1];
    let warn = '';
    const helpEl = $('acHelp');
    if (plane) {
      compass('acpHdg', hdg);
      dial('acpAsi', kmh, 0, 360, { minor: 20, major: 40, label: 'KM/H', read: Math.round(kmh), arcs: [[100, 270, '#3fb56b'], [270, 331, '#d6b23a'], [331, 360, '#d63a3a']] });
      horizon('acpAtt', a.pitch, a.roll);
      dial('acpAlt', ((s.p[1] % 1000) + 1000) % 1000, 0, 1000, { minor: 50, major: 100, div: 100, label: 'ALT M', read: Math.round(s.p[1]) });
      bar('apThr', C.thr); bar('apFuel', s.fuel / v.T.cfg.fuel, s.fuel / v.T.cfg.fuel < 0.15); bar('apHp', v.hp / v.T.cfg.hp, v.hp / v.T.cfg.hp < 0.3);
      chip('apRpm', Math.round(s.rpm * 2400), s.engine ? '' : 'bad'); chip('apG', s.gLoad.toFixed(1), Math.abs(s.gLoad) > 5 ? 'bad' : '');
      chip('apGear', s.gear > 0.95 ? 'DOWN' : s.gear < 0.05 ? 'UP' : 'MOVING', s.gear > 0.95 ? '' : s.gear < 0.05 ? 'warn' : 'warn');
      chip('apFlap', [0, 10, 20, 30][C.flaps] + '°'); chip('apBrk', C.keys.has('Space') || C.t.brake ? 'ON' : 'OFF', C.keys.has('Space') || C.t.brake ? 'warn' : '');
      chip('apAs', C.assist ? 'ON' : 'OFF', C.assist ? '' : 'warn'); chip('apLt', C.lights ? 'ON' : 'OFF');
      if (s.stall > 0.25) warn = 'STALL';
      else if (spd > v.T.cfg.vne) warn = 'OVERSPEED';
      else if (!s.onGround && agl < 150 && vsi < -9 && s.gear > 0.9 === false) warn = 'PULL UP';
      else if (!s.onGround && agl < 90 && spd < 48 && s.gear < 0.5 && s.thr < 0.5) warn = 'GEAR UP';
      else if (!s.engine && C.engine) warn = s.fuel <= 0 ? 'OUT OF FUEL' : 'ENGINE OUT';
      else if (s.fuel / v.T.cfg.fuel < 0.1 && s.fuel > 0) warn = 'LOW FUEL';
      if (helpEl && !isTouch) helpEl.textContent = 'W/S pitch · A/D roll · ←/→ rudder · Shift/C throttle · Space brake · F flaps · H gear · R engine · U assist · L lights · V camera · E exit';
      const th = thrUi.fill; if (th) th.style.height = Math.max(6, C.thr * 100) + '%';
    } else {
      compass('achHdg', hdg);
      tape('achAlt', s.p[1], 20, { label: 'ALT M', right: false });
      horizon('achAtt', a.pitch, a.roll);
      dial('achRot', s.rpm * 100, 0, 120, { minor: 10, major: 20, label: 'ROTOR %', read: Math.round(s.rpm * 100), arcs: [[0, 85, '#d63a3a'], [85, 98, '#d6b23a'], [98, 108, '#3fb56b'], [108, 120, '#d63a3a']] });
      tape('achSpd', kmh, 20, { label: 'KM/H', right: true, min: 0 });
      bar('ahCol', s.col); bar('ahFuel', s.fuel / v.T.cfg.fuel, s.fuel / v.T.cfg.fuel < 0.15); bar('ahHp', v.hp / v.T.cfg.hp, v.hp / v.T.cfg.hp < 0.3);
      chip('ahVsi', (vsi >= 0 ? '+' : '') + vsi.toFixed(1), vsi < -8 ? 'bad' : '');
      chip('ahEng', s.engine ? (s.rpm < 0.95 ? 'SPOOL' : 'ON') : 'OFF', s.engine ? (s.rpm < 0.95 ? 'warn' : '') : 'bad'); chip('ahNr', Math.round(s.rpm * 100) + '%', s.rpm < 0.85 ? 'bad' : '');
      chip('ahSas', C.assist ? 'ON' : 'OFF', C.assist ? '' : 'warn'); chip('ahLt', C.lights ? 'ON' : 'OFF');
      if (!s.engine && s.rpm > 0.1 && !s.onGround) warn = v.engineFail ? 'ENGINE FAILURE · AUTOROTATE' : 'ENGINE OFF · AUTOROTATE';
      else if (s.engine && s.rpm < 0.85 && s.rpm > 0.1 && !s.onGround) warn = 'LOW ROTOR RPM';
      else if (!s.onGround && vsi < -9 && agl < 45) warn = 'SINK RATE';
      else if (s.fuel / v.T.cfg.fuel < 0.1 && s.fuel > 0) warn = 'LOW FUEL';
      if (helpEl && !isTouch) helpEl.textContent = C.assist
        ? 'W/S nose · A/D bank · ←/→ pedals · Space/C climb-descend · R engine · U assist off · L lights · V camera · E exit'
        : 'MANUAL · W/S cyclic · A/D cyclic · ←/→ pedals · Space/C collective · R engine · U assist on · V camera · E exit';
    }
    const wEl = $('acWarn');
    if (wEl.textContent !== warn) wEl.textContent = warn;
  }

  // ======================================================================================
  // sound (own WebAudio, same approach as the cars)
  // ======================================================================================
  let actx = null, master = null, noiseBuf = null;
  function getCtx() {
    if (actx) return actx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      actx = new AC(); master = actx.createGain(); master.gain.value = 0.55; master.connect(actx.destination);
      noiseBuf = actx.createBuffer(1, actx.sampleRate * 2, actx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch (_) { actx = null; }
    return actx;
  }
  const wake = () => { const c = getCtx(); if (c && c.state === 'suspended') c.resume().catch(() => {}); };
  ['pointerdown', 'touchstart', 'keydown', 'mousedown'].forEach((ev) => addEventListener(ev, wake, { passive: true }));
  const vol = () => clamp(settings.volume == null ? 1 : settings.volume, 0, 1);
  function boom(power = 1) {
    const c = getCtx();
    if (!c) return;
    const t = c.currentTime, s = c.createBufferSource(); s.buffer = noiseBuf;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(1800 * power, t); f.frequency.exponentialRampToValueAtTime(90, t + 1.3);
    const g = c.createGain(); g.gain.setValueAtTime(0.9 * power * vol(), t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
    s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + 1.6);
  }
  function makeSound(kind) {
    const c = getCtx();
    if (!c) return null;
    const srcs = [];
    const noise = (freq, q, type = 'bandpass') => {
      const s = c.createBufferSource(); s.buffer = noiseBuf; s.loop = true; srcs.push(s);
      const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = c.createGain(); g.gain.value = 0; s.connect(f); f.connect(g); g.connect(master); s.start();
      return { s, f, g };
    };
    const osc = (type, freq) => { const o = c.createOscillator(); o.type = type; o.frequency.value = freq; o.start(); srcs.push(o); return o; };
    const wind = noise(900, 0.6);
    const horn = osc('square', 1180), hg = c.createGain(); hg.gain.value = 0; horn.connect(hg); hg.connect(master);
    let nodes;
    if (kind === 'plane') {
      const o1 = osc('sawtooth', 60), o2 = osc('square', 30), f = c.createBiquadFilter(), g = c.createGain();
      f.type = 'lowpass'; f.frequency.value = 600; g.gain.value = 0; o1.connect(f); o2.connect(f); f.connect(g); g.connect(master);
      const prop = noise(520, 0.8);
      nodes = { o1, o2, f, g, prop };
    } else {
      const thump = noise(260, 0.9), lfo = osc('sine', 11), lg = c.createGain();
      lg.gain.value = 0; lfo.connect(lg); lg.connect(thump.g.gain); // blade-pass amplitude modulation: the "whop-whop"
      const turb = osc('sawtooth', 900), tf = c.createBiquadFilter(), tg = c.createGain();
      tf.type = 'bandpass'; tf.frequency.value = 1800; tf.Q.value = 3; tg.gain.value = 0; turb.connect(tf); tf.connect(tg); tg.connect(master);
      const rum = noise(90, 0.7, 'lowpass');
      nodes = { thump, lfo, lg, turb, tg, rum };
    }
    return {
      update(v, hornOn) {
        const t = c.currentTime, s = v.s, spd = Math.hypot(s.v[0], s.v[1], s.v[2]), vv = vol();
        master.gain.value = 0.55 * vv;
        wind.g.gain.setTargetAtTime(clamp(spd / 90, 0, 1) ** 1.5 * 0.35, t, 0.1);
        wind.f.frequency.setTargetAtTime(500 + spd * 14, t, 0.1);
        if (kind === 'plane') {
          const rpm = s.rpm, on = s.engine || rpm > 0.1;
          nodes.o1.frequency.setTargetAtTime(30 + rpm * 78, t, 0.06); nodes.o2.frequency.setTargetAtTime(15 + rpm * 39, t, 0.06);
          nodes.f.frequency.setTargetAtTime(300 + rpm * 900, t, 0.1);
          nodes.g.gain.setTargetAtTime(on ? 0.06 + s.thr * 0.12 : 0, t, 0.1);
          nodes.prop.g.gain.setTargetAtTime(on ? 0.03 + s.thr * 0.12 + clamp(rpm, 0, 1) * 0.04 : 0, t, 0.1);
          nodes.prop.f.frequency.setTargetAtTime(380 + rpm * 700, t, 0.1);
          hg.gain.setTargetAtTime(s.stall > 0.25 && Math.floor(time * 6) % 2 === 0 ? 0.05 : 0, t, 0.02);
        } else {
          const om = s.rpm, on = om > 0.05;
          nodes.lfo.frequency.setTargetAtTime(4 + om * 7, t, 0.1);
          nodes.thump.g.gain.setTargetAtTime(on ? 0.1 + om * 0.1 : 0, t, 0.1);
          nodes.lg.gain.setTargetAtTime(on ? 0.2 * om : 0, t, 0.1);
          nodes.thump.f.frequency.setTargetAtTime(200 + om * 150, t, 0.1);
          nodes.turb.frequency.setTargetAtTime(500 + om * 1500, t, 0.1);
          nodes.tg.gain.setTargetAtTime(s.engine ? om * 0.022 : 0, t, 0.1);
          nodes.rum.g.gain.setTargetAtTime(on ? om * 0.35 : 0, t, 0.1);
          hg.gain.setTargetAtTime(((s.engine && om < 0.85 && om > 0.1) || (!s.engine && om > 0.1 && s.aglV > 3)) && Math.floor(time * 4) % 2 === 0 ? 0.04 : 0, t, 0.02);
        }
      },
      stop() {
        const t = c.currentTime;
        try { master.gain.setTargetAtTime(0, t, 0.08); } catch (_) {}
        setTimeout(() => { for (const n of srcs) { try { n.stop(); } catch (_) {} } try { master.gain.value = 0.55 * vol(); } catch (_) {} }, 500);
      },
    };
  }

  // ======================================================================================
  // animation
  // ======================================================================================
  const sstep = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
  function animate(v, dt) {
    const I = v.inst, N = I.nodes, s = v.s, plane = v.T.id === 'plane', here = occupied === v, fp = here && view === 'first', rpm = s.rpm;
    const set = (n, k, val) => { if (N[n]) N[n].rotation[k] = val; };
    if (plane) {
      v.spin += (rpm < 0.5 ? rpm * 26 : 13 + rpm * 8) * dt;
      set('propeller', 'z', v.spin);
      const blur = sstep((rpm - 0.3) / 0.35);
      I.disc.visible = blur > 0.02; I.disc.material.opacity = blur * 0.3;
      if (N.propeller) for (const c of N.propeller.children) if (c !== I.disc) c.visible = rpm < 0.6;
      const da = s.da * 1.2;
      set('aileron-l', 'x', -da); set('aileron-r', 'x', da); set('elevator', 'x', s.de); set('rudder', 'y', s.dr);
      set('flap-l', 'x', -s.flaps * 0.55); set('flap-r', 'x', -s.flaps * 0.55);
      const rt = 1 - s.gear;
      set('gear-main-l', 'z', -rt * 1.45); set('gear-main-r', 'z', rt * 1.45); set('gear-nose', 'x', rt * 1.5);
      const door = Math.sin(PI * clamp(rt, 0, 1)) * 1.1;
      for (const n of ['gear-door-main-l-fwd', 'gear-door-main-l-aft']) set(n, 'z', -door);
      for (const n of ['gear-door-main-r-fwd', 'gear-door-main-r-aft']) set(n, 'z', door);
      for (const n of ['wheel-main-l', 'wheel-main-r', 'wheel-nose']) set(n, 'x', s.wheelAng);
      set('steer-nose', 'y', s.steer);
      v.doorT = damp(v.doorT, v.doorUntil > time ? 1 : 0, 3.5, dt);
      set('door', 'z', -1.25 * v.doorT);
    } else {
      v.spin += rpm * 30 * dt;
      set('rotor-main', 'y', v.spin); set('rotor-tail', 'x', v.spin * 2.2);
      if (N['rotor-main']) { N['rotor-main'].rotation.x = damp(N['rotor-main'].rotation.x, -v.in.pitch * 0.05, 6, dt); N['rotor-main'].rotation.z = damp(N['rotor-main'].rotation.z, v.in.roll * 0.05, 6, dt); }
      const blur = sstep((rpm - 0.4) / 0.4);
      I.disc.visible = blur > 0.02; I.disc.material.opacity = blur * 0.2;
      v.doorT = damp(v.doorT, v.doorUntil > time ? 1 : 0, 3.5, dt);
      for (const d of I.doors) d.piv.rotation.y = d.dir * 1.2 * v.doorT;
    }
    // cockpit (plane) + pilot: IK arms / legs reaching the controls
    const P = I.pilot, T = v.T, ck = I.ck;
    P.g.visible = here;
    if (ck) {
      ck.fill.intensity = here && !I.burnt ? (fp ? 1.1 : 0.5) : 0;
      if (here || v.ckHot) { // run while flown, plus one last pass after exit so the yoke / pedals return to neutral
        v.ckHot = here;
        const a = att(v), iN = here ? v.in : ZERO_IN;
        ck.update({
          in: iN, thr: s.thr, gear: s.gear, flaps: here ? C.flaps : 0, stall: s.stall, brake: here && !!C.brake,
          kmh: Math.hypot(s.v[0], s.v[1], s.v[2]) * 3.6, pitch: a.pitch, roll: a.roll, hdg: ((-a.yaw * 180) / PI + 360) % 360, alt: s.p[1], vsi: s.v[1],
          rpm: s.rpm, fuel: s.fuel / T.cfg.fuel, slip: iN.yaw * 0.3, draw: fp && !I.burnt, dt, time,
        });
      }
    }
    if (here) {
      if (plane) {
        P.pose(fp, ck.grips.l, ck.grips.r, ck.feet.l, ck.feet.r);
      } else {
        const iN = v.in;
        I.stick.rotation.x = -iN.pitch * 0.35; I.stick.rotation.z = iN.roll * 0.35;
        I.lever.rotation.x = -clamp(s.col, 0, 1) * 0.6;
        // right hand (-X) flies the cyclic, left hand (+X) holds the collective
        _hr.p.set(0, 0.45, 0).applyQuaternion(I.stick.quaternion).add(I.ctrl.position); _hr.q.copy(I.stick.quaternion);
        _w.set(0, 0, 1).applyAxisAngle(AX, I.lever.rotation.x);
        _hl.p.copy(I.lever.position).addScaledVector(_w, 0.3).add(I.ctrl.position); _hl.q.setFromUnitVectors(AY, _w);
        _fl.set(T.seat[0] + 0.1, T.seat[1] - 0.12, T.seat[2] + 0.6); _fr.set(T.seat[0] - 0.1, T.seat[1] - 0.12, T.seat[2] + 0.6);
        P.pose(fp, _hl, _hr, _fl, _fr);
      }
    }
    const lightsOn = here ? C.lights : v.lights;
    const blink = Math.floor(time * 1.7) % 2 === 0 && (time % 1.7) < 0.12 * 1.7;
    I.navs.forEach((n, i) => { n.visible = lightsOn && (i < 3 || blink); }); // wing / tail lights steady, beacon flashes
    I.lamp.intensity = here && lightsOn ? 700 : 0;
    I.glassMat.opacity = I.burnt ? 0.9 : fp ? 0.1 : 0.26;
  }

  // ======================================================================================
  // camera
  // ======================================================================================
  function cameraRig(v, dt, camera) {
    const I = v.inst, T = v.T, s = v.s, spd = Math.hypot(s.v[0], s.v[1], s.v[2]), a = att(v);
    I.root.updateMatrixWorld(true);
    orbit.idle += dt;
    if (orbit.idle > 2.2 && !(C.t.sx || C.t.sy)) { orbit.yaw = damp(orbit.yaw, 0, 2.4, dt); orbit.pitch = damp(orbit.pitch, 0, 2.4, dt); }
    v.camBlend = Math.min(1, v.camBlend + dt * 1.6);
    const fov = settings.fov + (T.id === 'plane' ? clamp((spd - 30) / 60, 0, 1) * 7 : clamp(spd / 50, 0, 1) * 3);
    if (Math.abs(camera.fov - fov) > 0.05) { camera.fov = damp(camera.fov, fov, 4, dt); camera.updateProjectionMatrix(); }
    const sh = v.shake * 0.05 + s.buffet * 0.025;
    if (view === 'first') {
      _v.set(...T.eye); I.model.localToWorld(_v);
      const look = new THREE.Quaternion().setFromEuler(new THREE.Euler(orbit.pitch, orbit.yaw, 0, 'YXZ'));
      camera.quaternion.copy(I.root.quaternion).multiply(look);
      camera.position.copy(_v);
      if (sh > 0.001) { camera.position.x += rnd(-sh, sh); camera.position.y += rnd(-sh, sh); camera.position.z += rnd(-sh, sh); }
    } else {
      // chase: follows the heading (not the roll) so the horizon stays readable
      const fast = spd > 14 && T.id === 'plane';
      const targetYaw = fast ? a.yaw + angDiff(Math.atan2(-s.v[0], -s.v[2]), a.yaw) * 0.6 : a.yaw;
      if (!v.camInit) { v.camYaw = a.yaw; v.camPitch = 0.12; v.camInit = true; }
      v.camYaw += angDiff(targetYaw, v.camYaw) * (1 - Math.exp(-3.2 * dt));
      v.camPitch = damp(v.camPitch, 0.1 + clamp(a.pitch, -0.6, 0.6) * 0.35, 2.5, dt);
      const cy = v.camYaw + orbit.yaw, cp = clamp(v.camPitch + orbit.pitch, -0.5, 1.2), dist = T.camDist * (1 + clamp(spd / 100, 0, 0.25));
      const tx = v.x + s.v[0] * 0.04, ty = v.y + 1.7, tz = v.z + s.v[2] * 0.04;
      let cx = tx + Math.sin(cy) * Math.cos(cp) * dist, cyy = ty + Math.sin(cp) * dist + 0.8, cz = tz + Math.cos(cy) * Math.cos(cp) * dist;
      cyy = Math.max(cyy, heightAt(cx, cz) + 0.7);
      // blend from the on-foot camera to the chase position when entering
      if (v.camBlend < 1) { const k = sstep(v.camBlend); cx = lerp(camera.position.x, cx, k); cyy = lerp(camera.position.y, cyy, k); cz = lerp(camera.position.z, cz, k); }
      camera.position.set(cx, cyy, cz);
      camera.lookAt(tx, ty + 0.4, tz);
      if (sh > 0.001) { camera.position.x += rnd(-sh, sh); camera.position.y += rnd(-sh, sh); }
    }
    v.shake = Math.max(0, v.shake - dt * 1.6);
  }
  function toggleCam() {
    if (!occupied) return false;
    view = view === 'first' ? 'third' : 'first';
    occupied.camBlend = 0; occupied.camInit = false; orbit.yaw = orbit.pitch = 0;
    msg(view === 'first' ? 'Cockpit view' : 'Chase view', 700);
    return true;
  }

  // ======================================================================================
  // enter / exit
  // ======================================================================================
  const reachOf = (v) => v.T.reach;
  function nearest(pl) {
    let best = null, bd = 1e9;
    for (const v of list) {
      if (v.wreck || !v.inst) continue;
      const d = Math.hypot(v.x - pl.x, v.z - pl.z);
      if (d < reachOf(v) && Math.abs(v.y - pl.y) < 5 && d < bd) { best = v; bd = d; }
    }
    return best;
  }
  function enter(pl, v) {
    occupied = v; lastPlayer = pl;
    unregisterCols(v);
    v.awake = true; v.sleepT = 0; v.camBlend = 0; v.camInit = false;
    pl.inVehicle = true; pl.vehicle = v;
    view = 'first'; orbit.yaw = orbit.pitch = 0; orbit.idle = 9;
    C.thr = 0; C.flaps = 0; C.gear = 1; C.engine = true; C.lights = v.lights; C.colLever = v.s.col; C.brake = 0; v.in.pitch = v.in.roll = v.in.yaw = v.in.up = 0;
    document.body.classList.add('in-aircraft', 'ac-' + v.T.id);
    v.doorUntil = time + 1.5;
    if (sound) sound.stop();
    wake();
    sound = makeSound(v.T.id);
    msg(v.T.id === 'plane' ? 'Light plane: hold Shift for throttle, pull back at ~100 km/h' : 'Helicopter: engine starting · Space to climb', 2600);
    if (netApi && netApi.sendVehClaim) { try { netApi.sendVehClaim(v.id); } catch (_) {} }
  }
  function freeSpot(v, a) {
    const gy = (x, z) => floorAt(x, z, v.y + 2, 0.3);
    const cands = [];
    for (const side of [1, -1]) for (const k of [1, 1.4]) cands.push([v.x + a.right[0] * side * v.T.exitSide * k, v.z + a.right[2] * side * v.T.exitSide * k]);
    cands.push([v.x - a.fwd[0] * 6, v.z - a.fwd[2] * 6], [v.x + a.fwd[0] * 6, v.z + a.fwd[2] * 6]);
    for (const [x, z] of cands) {
      const y = gy(x, z), hit = queryRect(x - 0.4, z - 0.4, x + 0.4, z + 0.4).some((c) => c.aircraft !== v && x > c.minX - 0.3 && x < c.maxX + 0.3 && z > c.minZ - 0.3 && z < c.maxZ + 0.3 && c.y0 < y + 1.7 && c.h > y + 0.4);
      if (!hit) return [x, z, y];
    }
    const [x, z] = cands[0];
    return [x, z, gy(x, z)];
  }
  function release(pl, v, mode) {
    if (occupied !== v) return;
    occupied = null;
    document.body.classList.remove('in-aircraft', 'ac-plane', 'ac-heli');
    if (sound) { sound.stop(); sound = null; }
    if (camSaved) { opts.camera && (opts.camera.far = camSaved.far); if (scene.fog && camSaved.fogFar != null) { scene.fog.far = camSaved.fogFar; scene.fog.near = camSaved.fogNear; } if (opts.camera) opts.camera.updateProjectionMatrix(); camSaved = null; }
    resetInputs();
    v.lights = C.lights; v.awake = true; v.sleepT = 0; v.doorUntil = time + 1.5;
    v.s.steer = 0;
    if (pl) {
      pl.inVehicle = false; pl.vehicle = null;
      const a = att(v);
      if (mode === 'bail') { pl.x = v.x; pl.z = v.z; pl.y = v.y + 1.5; if (typeof pl.vy === 'number') pl.vy = Math.max(-6, v.s.v[1] * 0.3); if (hud) hud.setMsg('You bailed out', 1200); }
      else if (mode === true || mode === 'dead') { pl.x = v.x; pl.z = v.z; pl.y = heightAt(v.x, v.z); }
      else { const [x, z, y] = freeSpot(v, a); pl.x = x; pl.z = z; pl.y = y; }
      pl.yaw = a.yaw; if ('pitch' in pl) pl.pitch = 0;
      if (typeof pl.vx === 'number') pl.vx = 0; if (typeof pl.vz === 'number') pl.vz = 0;
    }
    if (netApi && netApi.sendVehExit) { try { netApi.sendVehExit({ id: v.id, x: v.x, y: v.y, z: v.z }); } catch (_) {} }
  }
  function tryUse(pl) {
    lastPlayer = pl;
    if (occupied) {
      const v = occupied, s = v.s, plane = v.T.id === 'plane';
      const ok = s.onGround && (plane ? s.V < 4 : s.skidSpeed < 2 && s.nGround > 1 && s.rpm < 1.1);
      if (ok) { release(pl, v, false); return true; }
      if (time - bailT < 1.8 && s.aglV > 4) { release(pl, v, 'bail'); return true; }
      bailT = time;
      msg(s.aglV > 4 ? 'Land first · press E again to bail out' : 'Slow down to get out', 1500);
      return true;
    }
    if (!pl || !pl.alive || pl.inVehicle) return false;
    const v = nearest(pl);
    if (!v) return false;
    if (remoteOwner[v.id]) { msg('Someone else is flying this', 1000); return true; }
    enter(pl, v);
    return true;
  }

  // ======================================================================================
  // per-frame update
  // ======================================================================================
  const IDLE_PLANE = { pitch: 0, roll: 0, yaw: 0, thr: 0, brake: 1, flaps: 0, gear: 1, assist: false, engine: false };
  const IDLE_HELI = { pitch: 0, roll: 0, yaw: 0, up: 0, colLever: 0, assist: false, engine: false };
  function respawn(v) {
    unregisterCols(v);
    scene.remove(v.inst.root);
    if (v.inst.ck) v.inst.ck.dispose();
    v.inst = instantiate(v.T, v.spec);
    scene.add(v.inst.root);
    v.s = FL.createState(v.T.cfg);
    FL.placeOnGround(v.s, v.spec.x, v.spec.z, v.spec.yaw, (x, z) => heightAt(x, z));
    v.hp = v.T.cfg.hp; v.alive = true; v.wreck = false; v.burning = false; v.engineFail = false; v.awake = false; v.respawnT = 0; v.lights = false; v.camInit = false; v.ckHot = false;
    sync(v); animate(v, 0.016); registerCols(v);
  }

  function netSend(v, dt) {
    lastSend += dt;
    if (!netApi || !netApi.sendVeh || lastSend < 0.07) return;
    lastSend = 0;
    const a = att(v), s = v.s;
    try { netApi.sendVeh({ id: v.id, ac: 1, k: v.T.id, x: v.x, y: v.y, z: v.z, yaw: a.yaw, pitch: a.pitch, roll: a.roll, spd: Math.hypot(s.v[0], s.v[1], s.v[2]), rpm: s.rpm, hp: v.hp, de: s.de, da: s.da, dr: s.dr, fl: s.flaps, gr: s.gear }); } catch (_) {}
  }
  function stepRemote(v, dt) {
    const n = v.net;
    if (!n) return;
    if (time - v.netT > 2.5) { remoteOwner[v.id] = null; v.net = null; v.awake = true; return; }
    const k = 1 - Math.exp(-12 * dt), s = v.s;
    const gx = n.x, gy = n.y, gz = n.z;
    // the message carries the model origin; flight state is at the centre of gravity
    const o = FL.originOf(s);
    s.p[0] += (gx - o[0]) * k; s.p[1] += (gy - o[1]) * k; s.p[2] += (gz - o[2]) * k;
    const q = FL.qmul(FL.qFromYaw(n.yaw), [Math.sin((n.pitch || 0) / 2), 0, 0, Math.cos((n.pitch || 0) / 2)]);
    const q2 = FL.qmul(q, [0, 0, Math.sin(-(n.roll || 0) / 2), Math.cos(-(n.roll || 0) / 2)]);
    const cur = new THREE.Quaternion(s.q[0], s.q[1], s.q[2], s.q[3]).slerp(new THREE.Quaternion(q2[0], q2[1], q2[2], q2[3]), k);
    s.q = [cur.x, cur.y, cur.z, cur.w];
    s.rpm = n.rpm == null ? 0.9 : n.rpm; s.de = n.de || 0; s.da = n.da || 0; s.dr = n.dr || 0; s.flaps = n.fl || 0; s.gear = n.gr == null ? 1 : n.gr; s.v = [0, 0, 0]; s.engine = s.rpm > 0.1;
    v.hp = n.hp == null ? v.hp : n.hp;
    sync(v);
  }

  function update(dt, pl, inp, camera) {
    dt = Math.min(dt, 0.05);
    time += dt; lastPlayer = pl;
    if (!opts.camera) opts.camera = camera;
    for (const k in remoteOwner) if (remoteOwner[k] == null) delete remoteOwner[k];
    if (occupied && !pl.alive) release(pl, occupied, 'dead');
    for (const v of list) {
      const mine = occupied === v, remote = remoteOwner[v.id] != null && !mine, d2 = (v.x - pl.x) ** 2 + (v.z - pl.z) ** 2;
      v.inst.root.visible = mine || d2 < 1500 * 1500;
      if (remote) { stepRemote(v, dt); if (v.inst.root.visible) animate(v, dt); continue; }
      if (v.wreck) {
        if (v.awake) { simulate(v, dt, v.T.id === 'plane' ? IDLE_PLANE : IDLE_HELI); const calm = v.s.onGround && Math.hypot(v.s.v[0], v.s.v[2]) < 0.4; v.sleepT = calm ? v.sleepT + dt : 0; if (v.sleepT > 1) { v.awake = false; } }
        if (d2 < 60 * 60 && Math.random() < dt * 14) fx.smoke(v.x + rnd(-1, 1), v.y + 1.4, v.z + rnd(-1, 1), rnd(-0.4, 0.4), rnd(1.4, 2.6), rnd(-0.4, 0.4), 0.8, 3.4, 2.8, 0.5, 0x222222);
        if (d2 < 40 * 40 && Math.random() < dt * 6) fx.fire(v.x + rnd(-0.8, 0.8), v.y + 0.9, v.z + rnd(-0.8, 0.8), 0, rnd(1, 2), 0, 0.7, 0.2, 0.7, 0.8);
        v.respawnT -= dt;
        if (v.respawnT <= 0 && d2 > 30 * 30 && !(occupied === v)) respawn(v);
        if (v.inst.root.visible) animate(v, dt);
        continue;
      }
      if (!mine && !v.awake) { if (d2 < 220 * 220) animate(v, dt); continue; }
      const plane = v.T.id === 'plane', s = v.s;
      let ctl;
      if (mine) {
        ctl = readControls(v, dt);
        if (plane) s.steer = clamp(-(ctl.yaw * 0.8 + ctl.roll * 0.35) / (1 + s.V / 9), -0.7, 0.7);
        C.brake = ctl.brake || 0;
      } else { ctl = plane ? IDLE_PLANE : IDLE_HELI; if (plane) s.steer = 0; }
      if (v.engineFail) ctl.engine = false;
      simulate(v, dt, ctl);
      if (!v.alive) { if (v.inst.root.visible) animate(v, dt); continue; }
      // sleeping
      if (!mine) {
        const calm = s.onGround && Math.hypot(s.v[0], s.v[1], s.v[2]) < 0.35 && Math.hypot(s.w[0], s.w[1], s.w[2]) < 0.08 && s.rpm < 0.05;
        v.sleepT = calm ? v.sleepT + dt : 0;
        if (v.sleepT > 1.2) { v.awake = false; v.s.v = [0, 0, 0]; v.s.w = [0, 0, 0]; registerCols(v); }
      }
      // damage states
      const hf = v.hp / v.T.cfg.hp;
      if (hf < 0.3 && !v.engineFail && hf < (plane ? 0.15 : 0.22)) { v.engineFail = true; if (mine) msg(plane ? 'ENGINE FAILURE' : 'ENGINE FAILURE · AUTOROTATE', 2000); }
      if (hf < 0.12 && !v.burning) { v.burning = true; if (mine) msg('FIRE!', 1500); }
      if (v.burning) hit(v, 7 * dt, null);
      v.smokeT -= dt;
      if (v.alive && hf < 0.5 && v.smokeT <= 0 && d2 < 500 * 500) {
        v.smokeT = hf < 0.25 ? 0.05 : 0.12;
        const P = plane ? [0, 1.3, 1.4] : [0, 3.0, 0.6];
        _v.set(...P); v.inst.model.localToWorld(_v);
        fx.smoke(_v.x, _v.y, _v.z, s.v[0] * 0.8 + rnd(-0.3, 0.3), s.v[1] * 0.5 + rnd(0.5, 1.2), s.v[2] * 0.8 + rnd(-0.3, 0.3), 0.5, 2.4, 2.2, hf < 0.25 ? 0.75 : 0.45, hf < 0.25 ? 0x151515 : 0x555555);
        if (v.burning) fx.fire(_v.x, _v.y, _v.z, s.v[0] * 0.8, s.v[1] * 0.5 + 1, s.v[2] * 0.8, 0.6, 0.1, 0.5, 0.9);
      }
      // prop-wash dust / tyre smoke
      if (d2 < 300 * 300) {
        if (!plane && s.rpm > 0.5 && s.aglV < 14 && Math.random() < dt * 40 * (1 - s.aglV / 14)) {
          const g = heightAt(v.x, v.z), ang = rnd(0, TAU), sp = rnd(4, 9) * (1 - s.aglV / 18);
          fx.dust(v.x + Math.cos(ang) * 1.5, g + 0.3, v.z + Math.sin(ang) * 1.5, Math.cos(ang) * sp, Math.sin(ang) * sp);
        } else if (plane && s.onGround && s.thr > 0.7 && Math.hypot(s.v[0], s.v[2]) < 22 && Math.random() < dt * 14) {
          const a = att(v);
          fx.dust(v.x - a.fwd[0] * 3, heightAt(v.x, v.z) + 0.3, v.z - a.fwd[2] * 3, rnd(-1, 1), rnd(-1, 1));
        }
      }
      if (v.inst.root.visible) animate(v, dt);
      if (mine) {
        const a = att(v);
        pl.x = v.x; pl.z = v.z; pl.y = v.y + 0.5; pl.yaw = a.yaw; pl.inVehicle = true; pl.vehicle = v;
        if ('pitch' in pl) pl.pitch = 0;
        if (camera && !camSaved) camSaved = { far: camera.far, fogFar: scene.fog && scene.fog.far != null ? scene.fog.far : null, fogNear: scene.fog ? scene.fog.near : null };
        if (camera && camera.far < 1800) { camera.far = 1800; camera.updateProjectionMatrix(); }
        if (scene.fog && scene.fog.far != null && scene.fog.far < 1200) { scene.fog.far = 1200; scene.fog.near = Math.min(scene.fog.near, 220); }
        cameraRig(v, dt, camera);
        updateHud(v);
        if (sound) sound.update(v, false);
        if (audio && audio.setListener) { try { audio.setListener(v.x, v.z, a.yaw); } catch (_) {} }
        netSend(v, dt);
        const th = thrUi && thrUi.thumb; if (th) th.style.top = (1 - C.thr) * 100 + '%';
      }
    }
    fx.update(dt);
    // prompt
    if (!occupied && pl.alive && !pl.inVehicle) {
      const v = nearest(pl);
      if (v && !remoteOwner[v.id]) { prompt.textContent = `E · fly the ${v.T.name.toLowerCase()}`; prompt.classList.add('on'); } else prompt.classList.remove('on');
    } else prompt.classList.remove('on');
    return occupied;
  }

  // ======================================================================================
  // net (best effort: needs the server to relay "veh" messages for ids it doesn't know)
  // ======================================================================================
  function onVeh(m) {
    if (!m || !m.id || !String(m.id).startsWith('ac')) return false;
    const v = list.find((x) => x.id === m.id);
    if (!v || occupied === v) return true;
    remoteOwner[v.id] = m.pid != null ? m.pid : 'x';
    v.net = m; v.netT = time; v.awake = false; v.sleepT = 0; unregisterCols(v);
    return true;
  }
  function onVehExit(m) {
    if (!m || !m.id || !String(m.id).startsWith('ac')) return false;
    const v = list.find((x) => x.id === m.id);
    if (v) { remoteOwner[v.id] = null; v.net = null; v.awake = true; }
    return true;
  }
  const onVehClaim = (m) => !!(m && m.id && String(m.id).startsWith('ac'));
  function onVehDeny(m) {
    if (!m || !m.id || !String(m.id).startsWith('ac')) return false;
    if (occupied && occupied.id === m.id) { release(lastPlayer, occupied, false); msg('Someone else is flying this', 1200); }
    return true;
  }

  function resetAll(pl) {
    if (occupied) release(pl, occupied, true);
    for (const v of list) respawn(v);
  }
  function scrollThrottle(dir) {
    if (!occupied) return false;
    if (occupied.T.id === 'plane') C.thr = clamp(C.thr + dir * 0.05, 0, 1); else C.colLever = clamp(C.colLever + dir * 0.04, 0, 1);
    return true;
  }

  return {
    list, tryUse, toggleCam, update, resetAll, spawnAt, scrollThrottle, onVeh, onVehExit, onVehClaim, onVehDeny,
    isPiloting: () => !!occupied,
    pilotKind: () => (occupied ? occupied.T.id : null),
    hidePrompt: () => prompt.classList.remove('on'),
    setNet: (api) => { netApi = api; },
  };
}
