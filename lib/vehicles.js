/**
 * Driveable vehicles — sedan, pickup truck, van, motorcycle.
 *  - real models (profile-extruded bodies, wheel arches, glass, full interior, driver, steering wheel)
 *  - animations: wheel spin + steering, suspension pitch/roll, door swing, brake / reverse / indicator lights, motorbike lean
 *  - arcade physics with drift, collisions, crash damage, bullet damage, fire, explosion + burnt wreck
 *  - self-contained touch driving UI (steer pad, gas / brake / handbrake, EXIT, CAM, lights, horn, map, pause)
 *  - chase cam + cabin cam (free-look by dragging / mouse), engine + horn + crash sounds
 * Model forward = -Z (yaw 0), +X = right, driver sits on the left.
 * Public API is unchanged: createVehicles({ scene, audio, hud, damagePlayer? }) -> { list, tryUse, toggleDriveCam, update, hurtAt, isDriving }
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { heightAt } from './ground.js';
import { resolveCircle, raycastWorld, addCollider, removeCollider, floorAt } from './collision.js';
import { POIS } from './mapLayout.js';
import { settings } from './settings.js';

const PI = Math.PI, TAU = PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
const sgn = (v) => (v < 0 ? -1 : 1);

/** Handling profiles (wb = wheelbase, wr = wheel radius, track = half wheel track) */
export const VEHICLE_TYPES = {
  sedan: {
    id: 'sedan', name: 'Sedan', maxSpeed: 30, accel: 17, brake: 34, turn: 2.1, offroad: 0.55, tank: 55, hp: 120, seats: 1,
    size: { L: 4.5, W: 1.82, H: 1.5 }, mass: 1.0, wb: 2.7, wr: 0.34, track: 0.78, camDist: 6.4, camH: 2.1, pitch: 1.0,
  },
  truck: {
    id: 'truck', name: 'Truck', maxSpeed: 24, accel: 13, brake: 30, turn: 1.6, offroad: 0.95, tank: 80, hp: 200, seats: 1,
    size: { L: 5.3, W: 2.0, H: 1.95 }, mass: 1.6, wb: 3.1, wr: 0.42, track: 0.85, camDist: 7.6, camH: 2.6, pitch: 0.75,
  },
  van: {
    id: 'van', name: 'Van', maxSpeed: 25, accel: 14, brake: 28, turn: 1.75, offroad: 0.7, tank: 70, hp: 160, seats: 1,
    size: { L: 5.2, W: 2.0, H: 2.3 }, mass: 1.3, wb: 3.2, wr: 0.4, track: 0.84, camDist: 8.0, camH: 3.0, pitch: 0.85,
  },
  motorcycle: {
    id: 'motorcycle', name: 'Motorcycle', maxSpeed: 36, accel: 26, brake: 38, turn: 2.8, offroad: 0.45, tank: 28, hp: 130, seats: 1,
    size: { L: 2.1, W: 0.75, H: 1.5 }, mass: 0.45, wb: 1.4, wr: 0.33, track: 0, camDist: 4.6, camH: 1.9, pitch: 1.7,
  },
};

const COLORS = [0xb32d2d, 0x2f5fb3, 0xd1a92c, 0x2f8f54, 0x7a2fa8, 0xd0702a, 0x24242a, 0xe6e6ea, 0x4a5560, 0x1f6f78];
const FAR2 = 190 * 190, NEAR2 = 46 * 46;

// ======================================================================================
// materials + textures
// ======================================================================================
const stdMat = (color, r = 0.55, m = 0.2, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: r, metalness: m, ...extra });
const M = {
  trim: stdMat(0x17181b, 0.75, 0.2),
  chrome: stdMat(0xdfe3e8, 0.18, 1),
  glass: stdMat(0x9bc3da, 0.05, 0.35, { transparent: true, opacity: 0.34, depthWrite: false }),
  int: stdMat(0x2c2e33, 0.85, 0.05),
  fab: stdMat(0x474c55, 0.95, 0),
  liner: stdMat(0x8d8c85, 0.95, 0),
  tire: stdMat(0x0f0f10, 0.95, 0),
  rim: stdMat(0xc9ccd1, 0.3, 0.9),
  skin: stdMat(0xd7a581, 0.8, 0),
  shirt: stdMat(0x3b5b86, 0.9, 0),
  pants: stdMat(0x2b2f3a, 0.9, 0),
  hair: stdMat(0x2a1d14, 0.9, 0),
  helmet: stdMat(0x1c1c20, 0.25, 0.4),
  burnt: stdMat(0x1b1b1c, 0.95, 0.1),
  burntGlass: stdMat(0x0b0b0c, 0.9, 0, { transparent: true, opacity: 0.92 }),
};
const paintCache = new Map();
function paintMat(c) {
  let m = paintCache.get(c);
  if (!m) { m = stdMat(c, 0.32, 0.55); paintCache.set(c, m); }
  return m;
}

function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function plateMat() {
  const L = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  const txt = L[(Math.random() * L.length) | 0] + L[(Math.random() * L.length) | 0] + L[(Math.random() * L.length) | 0] + ' ' + (100 + ((Math.random() * 900) | 0));
  const t = canvasTex(256, 64, (g, w, h) => {
    g.fillStyle = '#e9e6da'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1d3f8f'; g.fillRect(0, 0, w, 10);
    g.strokeStyle = '#222'; g.lineWidth = 4; g.strokeRect(2, 2, w - 4, h - 4);
    g.fillStyle = '#16161a'; g.font = 'bold 38px monospace'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(txt, w / 2, h / 2 + 6);
  });
  return new THREE.MeshStandardMaterial({ map: t, roughness: 0.5, metalness: 0.1 });
}
const PLATES = Array.from({ length: 6 }, () => plateMat());
const DASH_MAT = new THREE.MeshStandardMaterial({
  roughness: 0.4,
  emissive: 0xffffff,
  emissiveIntensity: 0.35,
  map: canvasTex(256, 128, (g, w, h) => {
    g.fillStyle = '#0b0c0e'; g.fillRect(0, 0, w, h);
    for (const [cx, big] of [[72, true], [184, false]]) {
      g.strokeStyle = '#d8e2ee'; g.lineWidth = 3; g.beginPath(); g.arc(cx, 66, 46, PI * 0.75, PI * 2.25); g.stroke();
      for (let i = 0; i <= 10; i++) {
        const a = PI * 0.75 + (i / 10) * PI * 1.5;
        g.strokeStyle = i > 8 && big ? '#ff5a4a' : '#9fb0c2'; g.lineWidth = 2;
        g.beginPath(); g.moveTo(cx + Math.cos(a) * 38, 66 + Math.sin(a) * 38); g.lineTo(cx + Math.cos(a) * 46, 66 + Math.sin(a) * 46); g.stroke();
      }
      g.strokeStyle = '#ffb347'; g.lineWidth = 3; g.beginPath(); g.moveTo(cx, 66); g.lineTo(cx + Math.cos(PI * (big ? 1.1 : 0.95)) * 36, 66 + Math.sin(PI * (big ? 1.1 : 0.95)) * 36); g.stroke();
    }
    g.fillStyle = '#9fb0c2'; g.font = '12px monospace'; g.textAlign = 'center'; g.fillText('KM/H', 72, 108); g.fillText('FUEL', 184, 108);
  }),
});

// ======================================================================================
// geometry helpers
// ======================================================================================
const _o3 = new THREE.Object3D();
const P = (x, v, u) => new THREE.Vector3(x, v, -u); // model point from (x, height, forward-distance)

class Bag {
  constructor() { this.m = {}; }
  add(key, geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    _o3.position.set(x, y, z); _o3.rotation.set(rx, ry, rz); _o3.scale.set(sx, sy, sz); _o3.updateMatrix();
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    g.applyMatrix4(_o3.matrix);
    (this.m[key] || (this.m[key] = [])).push(g);
    return this;
  }
  box(key, w, h, d, x, y, z, rx, ry, rz) { return this.add(key, new THREE.BoxGeometry(w, h, d), x, y, z, rx, ry, rz); }
  cyl(key, rt, rb, h, seg, x, y, z, rx, ry, rz) { return this.add(key, new THREE.CylinderGeometry(rt, rb, h, seg), x, y, z, rx, ry, rz); }
  ball(key, r, x, y, z, sx, sy, sz) { return this.add(key, new THREE.SphereGeometry(r, 14, 10), x, y, z, 0, 0, 0, sx, sy, sz); }
  beam(key, a, b, w = 0.06, h = w) {
    const g = new THREE.BoxGeometry(w, h, a.distanceTo(b)).toNonIndexed();
    _o3.position.copy(a).add(b).multiplyScalar(0.5);
    _o3.scale.set(1, 1, 1);
    _o3.up.set(0, 1, 0);
    _o3.lookAt(b);
    _o3.updateMatrix();
    g.applyMatrix4(_o3.matrix);
    (this.m[key] || (this.m[key] = [])).push(g);
    return this;
  }
  build() {
    const out = {};
    for (const k in this.m) out[k] = mergeGeometries(this.m[k], false);
    return out;
  }
}

/** Side profile (u = forward, v = up) extruded across `width`, then rotated so u -> -Z and the extrusion -> X. */
function extrude(draw, width, bevel = 0) {
  const s = new THREE.Shape();
  draw(s);
  const d = width - 2 * bevel;
  const g = new THREE.ExtrudeGeometry(s, {
    depth: d, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelOffset: 0, bevelSegments: 2, curveSegments: 12, steps: 1,
  });
  g.translate(0, 0, -d / 2);
  g.rotateY(PI / 2);
  return g;
}

function wheelGeos(r, w) {
  const hw = w / 2;
  const pts = [[r * 0.6, -hw], [r * 0.93, -hw], [r * 0.99, -hw * 0.75], [r, -hw * 0.3], [r, hw * 0.3], [r * 0.99, hw * 0.75], [r * 0.93, hw], [r * 0.6, hw]]
    .map(([x, y]) => new THREE.Vector2(x, y));
  const tire = new THREE.LatheGeometry(pts, 24);
  tire.rotateZ(PI / 2);
  const R = new Bag();
  R.cyl('m', r * 0.6, r * 0.6, w * 0.9, 20, 0, 0, 0, 0, 0, PI / 2);
  R.cyl('m', r * 0.14, r * 0.14, w * 1.04, 10, 0, 0, 0, 0, 0, PI / 2);
  for (const sx of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const a = (i * TAU) / 5;
      R.box('m', 0.025, r * 0.5, r * 0.12, sx * w * 0.47, Math.cos(a) * r * 0.3, Math.sin(a) * r * 0.3, a);
    }
  }
  return { tire, rim: R.build().m };
}

function steerGeos() {
  const S = new Bag(), H = new Bag();
  S.add('t', new THREE.TorusGeometry(0.18, 0.017, 8, 22));
  S.box('t', 0.34, 0.02, 0.02, 0, 0, 0);
  S.box('t', 0.02, 0.17, 0.02, 0, -0.085, 0);
  S.cyl('t', 0.045, 0.045, 0.05, 10, 0, 0, 0, PI / 2);
  H.ball('s', 0.04, -0.125, 0.13, 0.01);
  H.ball('s', 0.04, 0.125, 0.13, 0.01);
  return { trim: S.build().t, hands: H.build().s };
}

/** door skin + handle + mirror, local to the hinge (door extends toward +Z by len). sign = outward direction */
function addDoor(bag, sign, ox, oz, len, h0, h1, handleZ, mirrorY) {
  bag.box('paint', 0.03, h1 - h0, len, ox, (h0 + h1) / 2, oz + len / 2);
  bag.box('trim', 0.036, 0.03, len, ox, h1 + 0.01, oz + len / 2);
  bag.box('chrome', 0.03, 0.03, 0.16, ox + sign * 0.02, h1 - 0.1, oz + handleZ);
  bag.box('trim', 0.1, 0.03, 0.04, ox + sign * 0.06, mirrorY - 0.05, oz + 0.14);
  bag.box('paint', 0.1, 0.09, 0.14, ox + sign * 0.12, mirrorY, oz + 0.16);
}

/** seats, dash, floor, door cards, headliner (spec s) */
function interior(B, s) {
  const midU = (s.u0 + s.u1) / 2, len = s.u0 - s.u1;
  B.box('int', s.halfW * 2 - 0.04, 0.05, len, 0, s.floorY, -midU);
  for (const sx of [-1, 1]) B.box('int', 0.05, s.beltV - s.floorY, len, sx * (s.halfW - 0.025), (s.floorY + s.beltV) / 2, -midU);
  B.box('int', s.halfW * 2 - 0.06, s.dashH, s.dashU0 - s.dashU1, 0, s.dashY, -(s.dashU0 + s.dashU1) / 2);
  B.box('int', 0.5, 0.1, 0.2, -s.seatX, s.dashY + s.dashH / 2 + 0.04, -(s.dashU1 + 0.12));
  B.add('dash', new THREE.PlaneGeometry(0.34, 0.15), -s.seatX, s.dashY + s.dashH / 2 - 0.05, -s.dashU1 + 0.02, -0.25);
  const seat = (x) => {
    B.box('fab', 0.46, 0.14, 0.52, x, s.seatY - 0.07, -s.seatU);
    B.box('fab', 0.46, 0.6, 0.12, x, s.seatY + 0.33, -s.seatU + 0.28, 0.16);
    B.box('fab', 0.24, 0.17, 0.09, x, s.seatY + 0.7, -s.seatU + 0.37, 0.16);
  };
  seat(-s.seatX); seat(s.seatX);
  if (s.rearU != null) {
    B.box('fab', s.halfW * 1.7, 0.14, 0.5, 0, s.seatY - 0.07, -s.rearU);
    B.box('fab', s.halfW * 1.7, 0.55, 0.1, 0, s.seatY + 0.3, -s.rearU + 0.27, 0.2);
  }
  B.box('int', 0.24, 0.3, 0.8, 0, s.seatY - 0.02, -(s.seatU + 0.2));
  B.cyl('chrome', 0.012, 0.012, 0.18, 6, 0, s.seatY + 0.2, -(s.seatU + 0.4));
  B.ball('trim', 0.03, 0, s.seatY + 0.3, -(s.seatU + 0.4));
  B.cyl('int', 0.028, 0.032, 0.34, 8, -s.seatX, s.wheelY - 0.14, -(s.wheelU + 0.08), -0.55);
  B.box('liner', s.halfW * 2 - 0.1, 0.02, len * 0.9, 0, s.roofV - 0.02, -midU);
  B.box('trim', 0.2, 0.07, 0.04, 0, s.roofV - 0.12, -(s.u0 - 0.25));
}

function driverBag(s) {
  const D = new Bag(), x = -s.seatX, hz = -s.seatU, sy = s.seatY;
  const shin = Math.max(0.2, sy + 0.04 - (s.floorY + 0.08));
  D.box('pants', 0.34, 0.16, 0.5, x, sy + 0.04, hz - 0.2);
  D.box('pants', 0.15, shin, 0.15, x, sy + 0.04 - shin / 2, hz - 0.45);
  D.box('shirt', 0.4, 0.52, 0.22, x, sy + 0.31, hz + 0.06, -0.08);
  D.ball('skin', 0.105, x, sy + 0.72, hz + 0.04);
  D.ball('hair', 0.11, x, sy + 0.76, hz + 0.07, 1, 0.82, 1);
  for (const sx of [-1, 1]) {
    const hand = new THREE.Vector3(x + sx * 0.12, s.wheelY + 0.1, -s.wheelU + 0.02);
    D.beam('shirt', new THREE.Vector3(x + sx * 0.22, sy + 0.5, hz + 0.02), hand, 0.09, 0.09);
  }
  return D;
}

// ======================================================================================
// model builders  (each returns { B, DR, D, X, meta })
// ======================================================================================
function lights(B, o) {
  for (const sx of [-1, 1]) {
    B.box('head', o.hw, o.hh, 0.12, sx * o.hx, o.hy, -o.fz);
    B.box('tail', o.tw, o.th, 0.1, sx * o.tx, o.ty, o.rz);
    B.box(sx < 0 ? 'sigL' : 'sigR', 0.12, 0.08, 0.1, sx * (o.hx + o.hw / 2 + 0.12), o.hy - 0.05, -o.fz + 0.02);
    B.box(sx < 0 ? 'sigL' : 'sigR', 0.12, 0.08, 0.1, sx * (o.tx + o.tw / 2 + 0.1), o.ty - 0.12, o.rz - 0.01);
    B.box('rev', 0.12, 0.07, 0.1, sx * 0.3, o.ty - 0.12, o.rz - 0.01);
  }
}

function buildSedan() {
  const B = new Bag(), DR = new Bag(), X = {};
  const W = 1.82;
  B.add('paint', extrude((s) => {
    s.moveTo(-2.25, 0.3); s.lineTo(-1.77, 0.3); s.absarc(-1.35, 0.3, 0.42, PI, 0, true);
    s.lineTo(0.93, 0.3); s.absarc(1.35, 0.3, 0.42, PI, 0, true); s.lineTo(2.25, 0.3);
    s.lineTo(2.28, 0.52); s.lineTo(2.24, 0.66); s.lineTo(2.16, 0.83); s.lineTo(1.1, 0.95);
    s.lineTo(0.2, 1.0); s.lineTo(-1.0, 1.0); s.lineTo(-1.8, 0.98); s.lineTo(-2.2, 0.92); s.lineTo(-2.27, 0.7);
  }, W, 0.045));
  B.add('glass', extrude((s) => { s.moveTo(1.05, 0.97); s.lineTo(0.28, 1.5); s.lineTo(-0.72, 1.5); s.lineTo(-1.45, 0.98); }, 1.5, 0));
  B.box('paint', 1.58, 0.05, 1.14, 0, 1.525, 0.22);
  for (const sx of [-1, 1]) {
    B.beam('trim', P(sx * 0.77, 0.97, 1.05), P(sx * 0.77, 1.5, 0.28), 0.07, 0.06);
    B.beam('paint', P(sx * 0.77, 1.5, -0.72), P(sx * 0.77, 0.98, -1.45), 0.1, 0.07);
    B.beam('trim', P(sx * 0.77, 0.98, -0.2), P(sx * 0.77, 1.5, -0.2), 0.05, 0.06);
    B.box('trim', 0.05, 0.06, 2.9, sx * 0.9, 0.36, 0);
  }
  addDoor(DR, -1, 0, 0, 1.8, 0.45, 0.97, 1.45, 1.07);
  addDoor(B, 1, 0.915, -0.9, 1.8, 0.45, 0.97, 1.45, 1.07);
  B.box('trim', 1.8, 0.2, 0.14, 0, 0.4, -2.3); B.box('trim', 1.8, 0.2, 0.14, 0, 0.42, 2.28);
  B.box('trim', 0.85, 0.2, 0.06, 0, 0.62, -2.27); B.box('chrome', 0.85, 0.025, 0.07, 0, 0.62, -2.28);
  B.box('trim', 1.3, 0.2, 3.9, 0, 0.32, 0);
  B.cyl('chrome', 0.04, 0.04, 0.2, 10, -0.6, 0.34, 2.32, PI / 2);
  lights(B, { hw: 0.42, hh: 0.14, hx: 0.62, hy: 0.74, fz: 2.2, tw: 0.4, th: 0.14, tx: 0.62, ty: 0.86, rz: 2.23 });
  interior(B, { halfW: 0.74, floorY: 0.45, beltV: 1.0, u0: 1.0, u1: -1.45, dashU0: 1.05, dashU1: 0.62, dashY: 0.96, dashH: 0.3, seatX: 0.36, seatU: -0.1, seatY: 0.56, wheelU: 0.55, wheelY: 1.08, roofV: 1.47, rearU: -1.0 });
  const sp = new Bag(); sp.box('paint', 1.5, 0.05, 0.3, 0, 1.12, 2.05); sp.box('trim', 0.05, 0.14, 0.12, -0.55, 1.04, 2.05); sp.box('trim', 0.05, 0.14, 0.12, 0.55, 1.04, 2.05);
  X.spoiler = sp;
  const rk = new Bag(); rk.box('chrome', 0.04, 0.04, 1.3, -0.62, 1.58, 0.2); rk.box('chrome', 0.04, 0.04, 1.3, 0.62, 1.58, 0.2); rk.box('chrome', 1.28, 0.04, 0.04, 0, 1.58, -0.3); rk.box('chrome', 1.28, 0.04, 0.04, 0, 1.58, 0.7);
  X.rack = rk;
  const D = driverBag({ seatX: 0.36, seatU: -0.1, seatY: 0.56, floorY: 0.45, wheelU: 0.55, wheelY: 1.08 });
  return {
    B, DR, D, X,
    meta: {
      wheelW: 0.22,
      wheels: [[-0.78, 0.34, -1.35, 1], [0.78, 0.34, -1.35, 1], [-0.78, 0.34, 1.35, 0], [0.78, 0.34, 1.35, 0]],
      door: [-0.915, 0, -0.9], steer: [-0.36, 1.08, -0.55], tilt: -0.5, eye: [-0.36, 1.26, -0.12],
      plates: [[0, 0.42, -2.38, 1], [0, 0.64, 2.34, 0]], exitSide: 1.55,
    },
  };
}

function buildTruck() {
  const B = new Bag(), DR = new Bag(), X = {};
  const W = 2.0;
  B.add('paint', extrude((s) => {
    s.moveTo(-0.45, 0.45); s.lineTo(1.03, 0.45); s.absarc(1.55, 0.45, 0.52, PI, 0, true); s.lineTo(2.65, 0.45);
    s.lineTo(2.68, 0.75); s.lineTo(2.66, 1.0); s.lineTo(2.55, 1.18); s.lineTo(1.2, 1.25); s.lineTo(1.15, 1.28); s.lineTo(-0.45, 1.28);
  }, W, 0.05));
  for (const sx of [-1, 1]) {
    B.add('paint', extrude((s) => {
      s.moveTo(-0.5, 0.5); s.lineTo(-1.05, 0.5); s.absarc(-1.55, 0.5, 0.5, PI, 0, true); s.lineTo(-2.65, 0.5);
      s.lineTo(-2.65, 1.22); s.lineTo(-0.5, 1.22);
    }, 0.1, 0.012), sx * 0.95);
    B.box('int', 0.3, 0.26, 1.0, sx * 0.78, 0.98, 1.55);
    B.box('trim', 0.12, 0.05, 2.2, sx * 1.0, 1.24, 1.55);
  }
  B.box('paint', 1.9, 0.5, 0.07, 0, 0.98, 2.65); B.box('trim', 1.9, 0.04, 0.09, 0, 1.24, 2.65);
  B.box('int', 1.8, 0.06, 2.15, 0, 0.84, 1.58);
  B.box('chrome', 1.9, 0.14, 0.2, 0, 0.58, 2.78); B.box('chrome', 2.04, 0.3, 0.16, 0, 0.58, -2.74);
  B.box('trim', 1.5, 0.3, 0.07, 0, 0.92, -2.7); B.box('chrome', 1.5, 0.04, 0.08, 0, 0.98, -2.71); B.box('chrome', 1.5, 0.04, 0.08, 0, 0.86, -2.71);
  B.box('trim', 1.4, 0.25, 4.7, 0, 0.45, -0.1);
  B.cyl('chrome', 0.05, 0.05, 0.28, 10, 0.55, 0.42, 2.7, PI / 2);
  B.add('glass', extrude((s) => { s.moveTo(1.15, 1.28); s.lineTo(0.55, 1.93); s.lineTo(-0.35, 1.93); s.lineTo(-0.42, 1.3); }, 1.7, 0));
  B.box('paint', 1.78, 0.05, 1.05, 0, 1.955, -0.1);
  for (const sx of [-1, 1]) {
    B.beam('trim', P(sx * 0.86, 1.28, 1.15), P(sx * 0.86, 1.93, 0.55), 0.08, 0.07);
    B.beam('paint', P(sx * 0.86, 1.93, -0.35), P(sx * 0.86, 1.3, -0.42), 0.1, 0.07);
    B.beam('trim', P(sx * 0.86, 1.3, 0.1), P(sx * 0.86, 1.93, 0.1), 0.05, 0.06);
  }
  addDoor(DR, -1, 0, 0, 1.45, 0.55, 1.28, 1.1, 1.38);
  addDoor(B, 1, 1.015, -1.05, 1.45, 0.55, 1.28, 1.1, 1.38);
  lights(B, { hw: 0.5, hh: 0.2, hx: 0.78, hy: 0.98, fz: 2.68, tw: 0.1, th: 0.34, tx: 0.9, ty: 1.0, rz: 2.68 });
  interior(B, { halfW: 0.84, floorY: 0.62, beltV: 1.28, u0: 1.15, u1: -0.42, dashU0: 1.2, dashU1: 0.72, dashY: 1.16, dashH: 0.3, seatX: 0.4, seatU: 0.05, seatY: 0.86, wheelU: 0.7, wheelY: 1.36, roofV: 1.9, rearU: -0.18 });
  const bb = new Bag();
  bb.cyl('chrome', 0.04, 0.04, 0.8, 8, -0.5, 0.8, -2.8); bb.cyl('chrome', 0.04, 0.04, 0.8, 8, 0.5, 0.8, -2.8);
  bb.box('chrome', 1.1, 0.05, 0.05, 0, 1.18, -2.8); bb.box('chrome', 1.1, 0.05, 0.05, 0, 0.62, -2.8);
  X.bullbar = bb;
  const lb = new Bag(); lb.box('trim', 1.3, 0.1, 0.16, 0, 2.03, 0.55);
  for (let i = -3; i <= 3; i++) lb.box('head', 0.14, 0.08, 0.05, i * 0.18, 2.03, 0.46);
  X.lightbar = lb;
  const hr = new Bag(); hr.cyl('chrome', 0.035, 0.035, 0.9, 8, -0.8, 1.7, 0.6); hr.cyl('chrome', 0.035, 0.035, 0.9, 8, 0.8, 1.7, 0.6); hr.box('chrome', 1.7, 0.05, 0.05, 0, 2.15, 0.6);
  X.rack = hr;
  const D = driverBag({ seatX: 0.4, seatU: 0.05, seatY: 0.86, floorY: 0.62, wheelU: 0.7, wheelY: 1.36 });
  return {
    B, DR, D, X,
    meta: {
      wheelW: 0.28,
      wheels: [[-0.85, 0.42, -1.55, 1], [0.85, 0.42, -1.55, 1], [-0.85, 0.42, 1.55, 0], [0.85, 0.42, 1.55, 0]],
      door: [-1.015, 0, -1.05], steer: [-0.4, 1.36, -0.7], tilt: -0.5, eye: [-0.4, 1.56, -0.06],
      plates: [[0, 0.6, -2.83, 1], [0, 0.8, 2.87, 0]], exitSide: 1.8,
    },
  };
}

function buildVan() {
  const B = new Bag(), DR = new Bag(), X = {};
  const W = 2.0;
  B.add('paint', extrude((s) => {
    s.moveTo(-2.6, 0.4); s.lineTo(-2.1, 0.4); s.absarc(-1.6, 0.4, 0.5, PI, 0, true); s.lineTo(1.1, 0.4); s.absarc(1.6, 0.4, 0.5, PI, 0, true);
    s.lineTo(2.6, 0.4); s.lineTo(2.65, 0.72); s.lineTo(2.58, 1.02); s.lineTo(2.45, 1.13); s.lineTo(1.95, 1.25); s.lineTo(-2.55, 1.25); s.lineTo(-2.63, 1.0);
  }, W, 0.05));
  B.box('paint', 1.96, 0.9, 3.12, 0, 1.7, 1.06);
  B.box('paint', 1.8, 0.05, 0.8, 0, 2.175, -0.9);
  B.add('glass', extrude((s) => { s.moveTo(1.95, 1.25); s.lineTo(1.25, 2.12); s.lineTo(0.5, 2.12); s.lineTo(0.5, 1.25); }, 1.8, 0));
  for (const sx of [-1, 1]) {
    B.beam('trim', P(sx * 0.9, 1.25, 1.95), P(sx * 0.9, 2.12, 1.25), 0.08, 0.07);
    B.beam('trim', P(sx * 0.9, 1.25, 0.62), P(sx * 0.9, 2.12, 0.62), 0.05, 0.06);
    B.box('glass', 0.03, 0.55, 0.7, sx * 0.99, 1.75, 1.7 * 0 + 1.9);
  }
  B.box('trim', 0.025, 1.4, 0.02, 0.995, 1.4, 0.15); B.box('trim', 0.025, 1.4, 0.02, 0.995, 1.4, 1.45);
  B.box('trim', 0.025, 0.02, 1.3, 0.995, 2.08, 0.8); B.box('trim', 0.025, 0.02, 1.3, 0.995, 0.72, 0.8);
  B.box('chrome', 0.03, 0.03, 0.18, 1.0, 1.35, 0.3);
  B.box('trim', 0.02, 1.3, 0.015, 0, 1.7, 2.625); B.box('glass', 0.7, 0.5, 0.03, -0.4, 1.78, 2.62); B.box('glass', 0.7, 0.5, 0.03, 0.4, 1.78, 2.62);
  B.box('trim', 2.04, 0.22, 0.14, 0, 0.5, -2.66); B.box('trim', 2.04, 0.22, 0.14, 0, 0.5, 2.66);
  B.box('trim', 0.9, 0.25, 0.06, 0, 0.74, -2.67); B.box('chrome', 0.9, 0.03, 0.07, 0, 0.74, -2.68);
  B.box('trim', 1.5, 0.25, 5.0, 0, 0.45, 0);
  B.box('int', 1.8, 0.05, 3.1, 0, 0.62, 1.05);
  addDoor(DR, -1, 0, 0, 1.1, 0.55, 1.2, 0.85, 1.32);
  addDoor(B, 1, 1.015, -1.8, 1.1, 0.55, 1.2, 0.85, 1.32);
  lights(B, { hw: 0.4, hh: 0.2, hx: 0.72, hy: 0.88, fz: 2.64, tw: 0.1, th: 0.42, tx: 0.93, ty: 0.98, rz: 2.64 });
  interior(B, { halfW: 0.86, floorY: 0.62, beltV: 1.25, u0: 1.95, u1: 0.4, dashU0: 1.95, dashU1: 1.45, dashY: 1.25, dashH: 0.3, seatX: 0.42, seatU: 0.9, seatY: 0.92, wheelU: 1.5, wheelY: 1.46, roofV: 2.12, rearU: null });
  const rk = new Bag();
  for (const sx of [-0.7, 0.7]) rk.box('chrome', 0.04, 0.04, 3.0, sx, 2.22, 1.05);
  for (let u = 0; u < 4; u++) rk.box('chrome', 1.44, 0.04, 0.04, 0, 2.22, -0.1 + u * 0.9);
  X.rack = rk;
  const D = driverBag({ seatX: 0.42, seatU: 0.9, seatY: 0.92, floorY: 0.62, wheelU: 1.5, wheelY: 1.46 });
  return {
    B, DR, D, X,
    meta: {
      wheelW: 0.26,
      wheels: [[-0.84, 0.4, -1.6, 1], [0.84, 0.4, -1.6, 1], [-0.84, 0.4, 1.6, 0], [0.84, 0.4, 1.6, 0]],
      door: [-1.015, 0, -1.8], steer: [-0.42, 1.46, -1.5], tilt: -0.5, eye: [-0.42, 1.62, -0.88],
      plates: [[0, 0.5, -2.75, 1], [0, 0.55, 2.75, 0]], exitSide: 1.8,
    },
  };
}

function buildMoto() {
  const B = new Bag(), F = new Bag(), D = new Bag(), DR = new Bag();
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  B.beam('trim', V3(0, 0.92, -0.4), V3(0, 0.82, 0.55), 0.06); B.beam('trim', V3(0, 0.88, -0.42), V3(0, 0.38, -0.05), 0.06); B.beam('trim', V3(0, 0.8, 0.4), V3(0, 0.72, 0.95), 0.05);
  B.box('trim', 0.28, 0.3, 0.45, 0, 0.5, 0.02);
  for (let i = 0; i < 4; i++) B.box('chrome', 0.34, 0.03, 0.24, 0, 0.62 + i * 0.045, -0.14);
  B.ball('paint', 0.5, 0, 0.99, -0.14, 0.4, 0.34, 0.64);
  B.cyl('chrome', 0.04, 0.04, 0.02, 10, 0, 1.15, -0.14);
  B.box('int', 0.27, 0.1, 0.58, 0, 0.88, 0.5);
  B.box('paint', 0.22, 0.04, 0.42, 0, 0.74, 1.0, 0.25); B.box('tail', 0.14, 0.07, 0.05, 0, 0.8, 1.2);
  B.box('rev', 0.05, 0.04, 0.04, 0.1, 0.72, 1.18);
  B.cyl('chrome', 0.04, 0.04, 1.0, 10, 0.2, 0.34, 0.45, PI / 2); B.cyl('trim', 0.05, 0.05, 0.08, 10, 0.2, 0.34, 0.96, PI / 2);
  for (const sx of [-1, 1]) {
    B.beam('trim', V3(sx * 0.1, 0.42, 0.1), V3(sx * 0.1, 0.33, 0.7), 0.05);
    B.beam('chrome', V3(sx * 0.12, 0.8, 0.62), V3(sx * 0.1, 0.4, 0.74), 0.03);
    B.box('chrome', 0.06, 0.03, 0.16, sx * 0.24, 0.4, 0.3);
  }
  B.add('plate', new THREE.PlaneGeometry(0.2, 0.1), 0, 0.62, 1.22);
  // front end (rotates with the steering): origin = head tube
  const fp = V3(0, 0.95, -0.42);
  for (const sx of [-1, 1]) {
    F.beam('chrome', V3(sx * 0.1, 0.98, -0.42), V3(sx * 0.1, 0.33, -0.7), 0.045);
    F.box('chrome', 0.04, 0.12, 0.04, sx * 0.34, 1.07, -0.36, 0, 0, 0.4); F.box('trim', 0.06, 0.06, 0.1, sx * 0.4, 1.12, -0.34);
    F.box('trim', 0.1, 0.04, 0.03, sx * 0.34, 1.06, -0.34);
  }
  F.beam('chrome', V3(-0.34, 1.05, -0.36), V3(0.34, 1.05, -0.36), 0.03); F.box('trim', 0.25, 0.04, 0.08, 0, 0.99, -0.42);
  F.ball('head', 0.12, 0, 0.95, -0.62, 0.9, 0.9, 0.7);
  F.box('paint', 0.1, 0.03, 0.46, 0, 0.66, -0.7, 0.18);
  // rider
  D.box('pants', 0.34, 0.16, 0.42, 0, 0.9, 0.48);
  for (const sx of [-1, 1]) {
    D.beam('pants', V3(sx * 0.15, 0.9, 0.45), V3(sx * 0.22, 0.78, 0.02), 0.13); D.beam('pants', V3(sx * 0.22, 0.78, 0.02), V3(sx * 0.22, 0.42, 0.34), 0.11);
    D.beam('shirt', V3(sx * 0.19, 1.4, 0.2), V3(sx * 0.33, 1.07, -0.34), 0.09);
    D.ball('skin', 0.04, sx * 0.34, 1.06, -0.36);
  }
  D.box('shirt', 0.34, 0.52, 0.22, 0, 1.2, 0.3, -0.45);
  D.ball('helmet', 0.14, 0, 1.58, 0.1, 1, 1.05, 1.15);
  return {
    B, DR, D, X: {}, F,
    meta: {
      wheelW: 0.14, wheels: [[0, 0.33, -0.7, 1], [0, 0.33, 0.7, 0]], fork: [fp.x, fp.y, fp.z], door: null, steer: null, eye: [0, 1.52, 0.1],
      plates: [[0, 0.62, 1.25, 0]], exitSide: 0.9,
    },
  };
}

const BUILDERS = { sedan: buildSedan, truck: buildTruck, van: buildVan, motorcycle: buildMoto };
const templates = {};
function template(id) {
  if (templates[id]) return templates[id];
  const t = (BUILDERS[id] || buildSedan)();
  const type = VEHICLE_TYPES[id] || VEHICLE_TYPES.sedan;
  const T = {
    geo: t.B.build(), dr: t.DR.build(), drv: t.D.build(), meta: t.meta,
    wg: wheelGeos(type.wr, t.meta.wheelW), steer: t.meta.steer ? steerGeos() : null,
    extras: {}, fork: null,
  };
  for (const k in t.X) T.extras[k] = t.X[k].build();
  if (t.F) {
    T.fork = t.F.build();
    const f = t.meta.fork;
    for (const k in T.fork) T.fork[k].translate(-f[0], -f[1], -f[2]);
  }
  templates[id] = T;
  return T;
}
const plateGeo = new THREE.PlaneGeometry(0.5, 0.12);

// ======================================================================================
// instance
// ======================================================================================
function instantiate(type, color, opt) {
  const T = template(type.id), meta = T.meta;
  const root = new THREE.Group(); root.rotation.order = 'YXZ';
  const body = new THREE.Group(), far = new THREE.Group(), near = new THREE.Group();
  root.add(body); body.add(far, near);
  const paint = paintMat(color);
  const em = {
    head: new THREE.MeshStandardMaterial({ color: 0xfff1cf, emissive: 0xffe6a8, emissiveIntensity: 0.2, roughness: 0.2 }),
    tail: new THREE.MeshStandardMaterial({ color: 0x7a0c0c, emissive: 0xff1a1a, emissiveIntensity: 0.25, roughness: 0.3 }),
    sigL: new THREE.MeshStandardMaterial({ color: 0xffa020, emissive: 0xff8c00, emissiveIntensity: 0, roughness: 0.3 }),
    sigR: new THREE.MeshStandardMaterial({ color: 0xffa020, emissive: 0xff8c00, emissiveIntensity: 0, roughness: 0.3 }),
    rev: new THREE.MeshStandardMaterial({ color: 0xdddddd, emissive: 0xffffff, emissiveIntensity: 0, roughness: 0.3 }),
  };
  const paintMeshes = [], glassMeshes = [], litMeshes = [];
  const FARKEYS = { paint, trim: M.trim, glass: M.glass, head: em.head, tail: em.tail, sigL: em.sigL, sigR: em.sigR, rev: em.rev };
  const NEARKEYS = { chrome: M.chrome, int: M.int, fab: M.fab, liner: M.liner, dash: DASH_MAT };
  const put = (grp, geo, mat, shadow) => {
    if (!geo) return null;
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = !!shadow;
    grp.add(m);
    return m;
  };
  for (const k in T.geo) {
    const isFar = k in FARKEYS, mat = isFar ? FARKEYS[k] : NEARKEYS[k] || M.trim;
    const m = put(isFar ? far : near, T.geo[k], mat, k === 'paint' || k === 'trim');
    if (k === 'paint') paintMeshes.push(m);
    else if (k === 'glass') glassMeshes.push(m);
    else if (k === 'head' || k === 'tail') litMeshes.push(m);
  }
  const extras = {};
  for (const name of Object.keys(opt || {})) {
    if (!opt[name] || !T.extras[name]) continue;
    for (const k in T.extras[name]) {
      const m = put(far, T.extras[name][k], k === 'paint' ? paint : FARKEYS[k] || M[k] || M.trim, false);
      if (k === 'paint') paintMeshes.push(m);
    }
  }
  // doors
  let door = null;
  if (meta.door) {
    door = new THREE.Group();
    door.position.set(meta.door[0], meta.door[1], meta.door[2]);
    for (const k in T.dr) {
      const m = put(door, T.dr[k], k === 'paint' ? paint : M[k] || M.trim, k === 'paint');
      if (k === 'paint') paintMeshes.push(m);
    }
    far.add(door);
  }
  // number plates
  const pm = PLATES[(Math.random() * PLATES.length) | 0];
  for (const [x, y, z, flip] of meta.plates) {
    const m = new THREE.Mesh(plateGeo, pm);
    m.position.set(x, y, z);
    if (flip) m.rotation.y = PI;
    near.add(m);
  }
  // steering wheel
  let steerWheel = null;
  if (meta.steer) {
    const pv = new THREE.Group();
    pv.position.set(...meta.steer); pv.rotation.x = meta.tilt;
    steerWheel = new THREE.Group();
    steerWheel.add(new THREE.Mesh(T.steer.trim, M.trim), new THREE.Mesh(T.steer.hands, M.skin));
    pv.add(steerWheel);
    near.add(pv);
  }
  // driver
  const driver = new THREE.Group();
  const DK = { shirt: M.shirt, skin: M.skin, pants: M.pants, hair: M.hair, helmet: M.helmet };
  for (const k in T.drv) put(driver, T.drv[k], DK[k], false);
  driver.visible = false;
  near.add(driver);
  // front end of the bike
  let forkG = null;
  if (T.fork) {
    forkG = new THREE.Group();
    forkG.position.set(...meta.fork);
    for (const k in T.fork) {
      const isFar = k in FARKEYS;
      const m = put(forkG, T.fork[k], isFar ? FARKEYS[k] : M[k] || M.chrome, k === 'paint');
      if (k === 'paint') paintMeshes.push(m);
      else if (k === 'head') litMeshes.push(m);
    }
    far.add(forkG);
  }
  // wheels (children of root so they stay on the ground while the body leans)
  const wheels = [];
  for (const [x, y, z, front] of meta.wheels) {
    const pivot = new THREE.Group(), spin = new THREE.Group();
    spin.add(new THREE.Mesh(T.wg.tire, M.tire), new THREE.Mesh(T.wg.rim, M.rim));
    pivot.add(spin);
    if (forkG && front) { pivot.position.set(x - meta.fork[0], y - meta.fork[1], z - meta.fork[2]); forkG.add(pivot); }
    else { pivot.position.set(x, y, z); root.add(pivot); }
    wheels.push({ pivot, spin, front: !!front, onFork: !!(forkG && front) });
  }
  return { root, body, far, near, door, steerWheel, driver, forkG, wheels, paint, paintMeshes, glassMeshes, litMeshes, em, meta };
}

function toWreck(inst) {
  for (const m of inst.paintMeshes) m.material = M.burnt;
  for (const m of inst.glassMeshes) m.material = M.burntGlass;
  for (const m of inst.litMeshes) m.material = M.burnt;
  inst.root.traverse((o) => { if (o.isMesh && (o.material === M.chrome || o.material === M.fab || o.material === M.liner)) o.material = M.burnt; });
  inst.driver.visible = false;
}

// ======================================================================================
// sound (own WebAudio so it works without touching audio.js)
// ======================================================================================
let actx = null, master = null, noiseBuf = null;
function getCtx() {
  if (actx) return actx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    actx = new AC();
    master = actx.createGain();
    master.gain.value = 0.5;
    master.connect(actx.destination);
    noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch (_) { actx = null; }
  return actx;
}
const wake = () => { const c = getCtx(); if (c && c.state === 'suspended') c.resume().catch(() => {}); };
['pointerdown', 'touchstart', 'keydown', 'mousedown'].forEach((ev) => addEventListener(ev, wake, { passive: true }));

function makeEngine() {
  const c = getCtx();
  if (!c) return null;
  const o1 = c.createOscillator(), o2 = c.createOscillator(), sk = c.createOscillator();
  o1.type = 'sawtooth'; o2.type = 'square'; sk.type = 'sawtooth'; sk.frequency.value = 780;
  const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 600; f.Q.value = 1.2;
  const g = c.createGain(); g.gain.value = 0;
  const sg = c.createGain(); sg.gain.value = 0;
  const sf = c.createBiquadFilter(); sf.type = 'bandpass'; sf.frequency.value = 900; sf.Q.value = 3;
  o1.connect(f); o2.connect(f); f.connect(g); g.connect(master);
  sk.connect(sf); sf.connect(sg); sg.connect(master);
  o1.start(); o2.start(); sk.start();
  let horn = null;
  return {
    update(sf01, thr, pitch, slip, hornOn) {
      const t = c.currentTime;
      master.gain.value = 0.5 * clamp(settings.volume == null ? 1 : settings.volume, 0, 1);
      const gi = Math.min(4, Math.floor(sf01 * 5)), gf = clamp(sf01 * 5 - gi, 0, 1);
      const rpm = 1100 + (gi === 0 ? gf * 3800 : 1800 + gf * 3600);
      const fr = (rpm / 60) * 2 * pitch;
      o1.frequency.setTargetAtTime(fr, t, 0.05); o2.frequency.setTargetAtTime(fr * 0.5, t, 0.05);
      f.frequency.setTargetAtTime(380 + rpm * 0.22 + thr * 520, t, 0.08);
      g.gain.setTargetAtTime(0.05 + thr * 0.07 + sf01 * 0.03, t, 0.08);
      sg.gain.setTargetAtTime(clamp(slip, 0, 1) * 0.05, t, 0.05);
      if (hornOn && !horn) {
        horn = [c.createOscillator(), c.createOscillator()];
        const hg = c.createGain(); hg.gain.value = 0.08; hg.connect(master);
        horn[0].type = horn[1].type = 'square'; horn[0].frequency.value = 330; horn[1].frequency.value = 415;
        horn.forEach((o) => { o.connect(hg); o.start(); });
        horn.g = hg;
      } else if (!hornOn && horn) { horn.forEach((o) => { try { o.stop(); } catch (_) {} }); horn = null; }
    },
    stop() {
      const t = c.currentTime;
      g.gain.setTargetAtTime(0, t, 0.05); sg.gain.setTargetAtTime(0, t, 0.05);
      if (horn) { horn.forEach((o) => { try { o.stop(); } catch (_) {} }); horn = null; }
      setTimeout(() => { try { o1.stop(); o2.stop(); sk.stop(); } catch (_) {} }, 400);
    },
  };
}
function boom(power = 1, delay = 0) {
  const c = getCtx();
  if (!c) return;
  const t = c.currentTime + delay;
  const s = c.createBufferSource(); s.buffer = noiseBuf;
  const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(1800 * power, t); f.frequency.exponentialRampToValueAtTime(90, t + 1.2);
  const g = c.createGain(); g.gain.setValueAtTime(0.9 * power * clamp(settings.volume == null ? 1 : settings.volume, 0, 1), t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
  s.connect(f); f.connect(g); g.connect(master || c.destination);
  s.start(t); s.stop(t + 1.5);
}

// ======================================================================================
// particles / explosion fx
// ======================================================================================
function makeFx(scene) {
  const tex = canvasTex(64, 64, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  });
  const mk = (blend) => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: blend, opacity: 0 }));
    s.visible = false; scene.add(s);
    return { s, life: 0, max: 1, v: new THREE.Vector3(), s0: 1, s1: 2, o: 0.5, drag: 1, up: 0 };
  };
  const smoke = Array.from({ length: 56 }, () => mk(THREE.NormalBlending));
  const fire = Array.from({ length: 28 }, () => mk(THREE.AdditiveBlending));
  let si = 0, fi = 0;
  const light = new THREE.PointLight(0xff9a40, 0, 45, 2);
  scene.add(light);
  let flash = 0;
  const debris = Array.from({ length: 10 }, () => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(rnd(0.2, 0.5), rnd(0.08, 0.2), rnd(0.2, 0.4)), M.burnt);
    m.visible = false; m.castShadow = true; scene.add(m);
    return { m, v: new THREE.Vector3(), w: new THREE.Vector3(), t: 0 };
  });
  function emit(pool, idx, x, y, z, vx, vy, vz, s0, s1, life, o, color, drag = 1.2, up = 0) {
    const p = pool[idx];
    p.s.visible = true; p.s.position.set(x, y, z); p.v.set(vx, vy, vz);
    p.s0 = s0; p.s1 = s1; p.max = p.life = life; p.o = o; p.drag = drag; p.up = up;
    p.s.material.color.setHex(color);
  }
  return {
    smoke(x, y, z, vx, vy, vz, s0, s1, life, o, color = 0x555555) { emit(smoke, si, x, y, z, vx, vy, vz, s0, s1, life, o, color, 0.8, 0.6); si = (si + 1) % smoke.length; },
    fire(x, y, z, vx, vy, vz, s0, s1, life, o, color = 0xff8a2a) { emit(fire, fi, x, y, z, vx, vy, vz, s0, s1, life, o, color, 1.5, 1.2); fi = (fi + 1) % fire.length; },
    spark(x, y, z) { for (let i = 0; i < 3; i++) this.fire(x, y, z, rnd(-2, 2), rnd(0.5, 3), rnd(-2, 2), 0.18, 0.02, 0.35, 0.9, 0xffd27a); },
    blast(x, y, z) {
      flash = 1;
      light.position.set(x, y + 1.5, z);
      for (let i = 0; i < 16; i++) this.fire(x + rnd(-1, 1), y + rnd(0.3, 1.5), z + rnd(-1, 1), rnd(-5, 5), rnd(1, 7), rnd(-5, 5), rnd(1.5, 3), rnd(3, 5.5), rnd(0.5, 1.1), 0.95, i % 3 ? 0xff7a1a : 0xffd070);
      for (let i = 0; i < 18; i++) this.smoke(x + rnd(-1.2, 1.2), y + rnd(0.5, 2), z + rnd(-1.2, 1.2), rnd(-3, 3), rnd(1, 5), rnd(-3, 3), rnd(1.2, 2.2), rnd(4, 7), rnd(1.6, 3.2), 0.7, 0x222222);
      for (const d of debris) {
        d.m.visible = true; d.m.position.set(x, y + 1, z); d.v.set(rnd(-8, 8), rnd(4, 12), rnd(-8, 8)); d.w.set(rnd(-8, 8), rnd(-8, 8), rnd(-8, 8)); d.t = 9;
      }
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
      for (const d of debris) {
        if (d.t <= 0) continue;
        d.t -= dt;
        if (d.t <= 0) { d.m.visible = false; continue; }
        d.v.y -= 20 * dt;
        d.m.position.addScaledVector(d.v, dt);
        const gy = heightAt(d.m.position.x, d.m.position.z) + 0.1;
        if (d.m.position.y < gy) { d.m.position.y = gy; d.v.y *= -0.35; d.v.x *= 0.6; d.v.z *= 0.6; d.w.multiplyScalar(0.6); }
        d.m.rotation.x += d.w.x * dt; d.m.rotation.y += d.w.y * dt; d.m.rotation.z += d.w.z * dt;
      }
      flash = Math.max(0, flash - dt * 2.4);
      light.intensity = flash * 900;
    },
  };
}

// ======================================================================================
// spawn points
// ======================================================================================
function defaultSpawns() {
  const out = [];
  const types = ['sedan', 'truck', 'van', 'motorcycle'];
  POIS.forEach((p, i) => {
    const ang = (i * 1.7) % TAU;
    out.push({ type: types[i % types.length], x: p.x + Math.cos(ang) * 12, z: p.z + Math.sin(ang) * 14, yaw: ang + PI / 2 });
    if (i % 2 === 0) out.push({ type: types[(i + 2) % types.length], x: p.x - Math.cos(ang) * 18, z: p.z - Math.sin(ang) * 16, yaw: ang });
  });
  for (let i = 0; i < 6; i++) out.push({ type: types[i % types.length], x: (i - 2.5) * 40, z: (i % 2 === 0 ? 1 : -1) * 25, yaw: i % 2 === 0 ? 0 : PI });
  return out;
}

// ======================================================================================
// main
// ======================================================================================
export function createVehicles(opts) {
  const { scene, audio, hud } = opts;
  const list = [];
  let occupied = null, driveCam = 'chase', lastPlayer = null, time = 0, engine = null;
  const remoteOwner = Object.create(null);
  let netApi = null, lastVehSend = 0, pendingClaim = null;
  const fx = makeFx(scene);
  const orbit = { yaw: 0, pitch: 0, idle: 9 };
  const touch = { gas: 0, brake: 0, hand: 0, steer: 0 };
  const keys = { horn: false, lights: true };
  let hornTouch = false;

  const spots = [0, 1].map(() => {
    const s = new THREE.SpotLight(0xfff0d0, 0, 70, 0.5, 0.6, 1.2);
    s.castShadow = false;
    scene.add(s); scene.add(s.target);
    return s;
  });

  // ---------- DOM: HUD, touch controls, prompt ----------
  const css = `
#vhud{display:none;position:fixed;left:50%;bottom:calc(14px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:26;width:190px;padding:8px 12px 9px;border-radius:12px;background:rgba(8,12,18,.72);border:1px solid rgba(255,255,255,.16);color:#e8eef6;font:600 11px system-ui,sans-serif;pointer-events:none;text-align:center}
body.in-vehicle #vhud{display:block}
#vhud .n{font:800 12px system-ui;color:#ffc247;letter-spacing:.06em;display:flex;justify-content:space-between}
#vhud .s{font:800 34px/1.05 ui-monospace,Menlo,monospace;margin:2px 0 4px}#vhud .s i{font:600 11px system-ui;opacity:.6;margin-left:4px;font-style:normal}
#vhud .b{display:flex;align-items:center;gap:6px;margin:3px 0;font-size:9px;opacity:.9}#vhud .b span{width:30px;text-align:left;opacity:.7}
#vhud .t{flex:1;height:7px;border-radius:4px;background:rgba(255,255,255,.12);overflow:hidden}#vhud .t i{display:block;height:100%;width:0}
#vhud .gas i{background:linear-gradient(90deg,#3a9e5c,#6dff9a)}#vhud .hp i{background:linear-gradient(90deg,#c43c3c,#ff7a5c)}#vhud .low i{background:linear-gradient(90deg,#d63a3a,#ffc247)}
#vhud .h{opacity:.5;font-size:9px;margin-top:4px}body.mobile #vhud .h{display:none}
#vprompt{display:none;position:fixed;left:50%;bottom:calc(110px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:24;padding:7px 14px;border-radius:8px;background:rgba(0,0,0,.6);border:1px solid rgba(255,255,255,.2);color:#fff;font:800 14px ui-monospace,Menlo,monospace;pointer-events:none;white-space:nowrap}
#vprompt.on{display:block}
body.in-vehicle #cross,body.in-vehicle #ammoBox,body.in-vehicle #slots,body.in-vehicle #reloadWrap,body.in-vehicle #buildBar,body.in-vehicle #hitm,body.in-vehicle #hint{display:none!important}
body.mobile.in-vehicle #mobile,body.mobile.in-vehicle #chatWrap{display:none!important}
#vtouch{display:none;position:fixed;inset:0;z-index:30;touch-action:none;pointer-events:none}
body.mobile.in-vehicle #vtouch{display:block}
#vtouch *{touch-action:none;user-select:none;-webkit-user-select:none}
#vtLook{position:absolute;inset:0;pointer-events:auto}
#vtouch .vb{position:absolute;pointer-events:auto;border-radius:12px;border:2px solid rgba(255,255,255,.4);background:rgba(255,255,255,.12);color:#fff;font:800 11px system-ui;display:flex;align-items:center;justify-content:center;text-align:center;letter-spacing:.04em}
#vtouch .vb.down{background:rgba(255,194,71,.5);border-color:#ffc247}
#vtGas{right:calc(14px + env(safe-area-inset-right));bottom:calc(18px + env(safe-area-inset-bottom));width:92px;height:128px;border-color:rgba(90,255,150,.8);background:rgba(40,160,90,.3);font-size:14px}
#vtBrake{right:calc(116px + env(safe-area-inset-right));bottom:calc(18px + env(safe-area-inset-bottom));width:78px;height:100px;border-color:rgba(255,90,90,.8);background:rgba(200,50,50,.3);font-size:12px}
#vtHand{right:calc(116px + env(safe-area-inset-right));bottom:calc(128px + env(safe-area-inset-bottom));width:78px;height:40px;font-size:10px}
#vtSteer{position:absolute;pointer-events:auto;left:calc(14px + env(safe-area-inset-left));bottom:calc(18px + env(safe-area-inset-bottom));width:min(44vw,300px);height:96px;border-radius:48px;background:rgba(255,255,255,.1);border:2px solid rgba(255,255,255,.35)}
#vtSteer:before{content:'';position:absolute;left:50%;top:14px;bottom:14px;width:2px;background:rgba(255,255,255,.2)}
#vtWheel{position:absolute;left:50%;top:50%;width:70px;height:70px;margin:-35px;border-radius:50%;border:7px solid rgba(255,255,255,.75);background:rgba(0,0,0,.25);pointer-events:none}
#vtWheel:before{content:'';position:absolute;left:50%;top:50%;width:46px;height:6px;margin:-3px -23px;background:rgba(255,255,255,.7)}
#vtWheel:after{content:'';position:absolute;left:50%;top:50%;width:6px;height:23px;margin:0 -3px;background:rgba(255,255,255,.7)}
#vtTop{position:absolute;right:calc(10px + env(safe-area-inset-right));top:calc(46px + env(safe-area-inset-top));display:flex;gap:7px;flex-wrap:wrap;justify-content:flex-end;max-width:92vw;pointer-events:none}
#vtTop .vb{position:relative;width:46px;height:40px;pointer-events:auto}
#vtTop #vtExit{width:92px;border-color:rgba(255,110,110,.9);background:rgba(210,60,60,.45);font-size:13px}
#vtTop .on{background:rgba(255,194,71,.4);border-color:#ffc247}`;
  const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

  const hudEl = document.createElement('div');
  hudEl.id = 'vhud';
  hudEl.innerHTML = '<div class="n"><span id="vhName">VEHICLE</span><span id="vhGear">N</span></div><div class="s"><b id="vhSpd">0</b><i>km/h</i></div>'
    + '<div class="b"><span>FUEL</span><div class="t gas" id="vhGasT"><i id="vhGas"></i></div></div><div class="b"><span>BODY</span><div class="t hp" id="vhHpT"><i id="vhHp"></i></div></div>'
    + '<div class="h">WASD drive · Space handbrake · E exit · V camera · H horn · L lights</div>';
  document.body.appendChild(hudEl);
  const $ = (id) => document.getElementById(id);

  const prompt = document.createElement('div'); prompt.id = 'vprompt'; document.body.appendChild(prompt);
  const isTouchUi = () => document.body.classList.contains('mobile');

  const ui = document.createElement('div');
  ui.id = 'vtouch';
  ui.innerHTML = '<div id="vtLook"></div><div id="vtSteer"><div id="vtWheel"></div></div>'
    + '<div class="vb" id="vtGas">GAS</div><div class="vb" id="vtBrake">BRAKE<br>REVERSE</div><div class="vb" id="vtHand">HANDBRAKE</div>'
    + '<div id="vtTop"><div class="vb" id="vtExit">EXIT</div><div class="vb" id="vtCam">CAM</div><div class="vb" id="vtLight">LIGHTS</div><div class="vb" id="vtHorn">HORN</div><div class="vb" id="vtMap">MAP</div><div class="vb" id="vtPause">II</div></div>';
  document.body.appendChild(ui);

  function press(el, onDown, onUp) {
    let on = false;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); e.stopPropagation();
      try { el.setPointerCapture(e.pointerId); } catch (_) {}
      on = true; el.classList.add('down');
      if (onDown) onDown(e);
    });
    const up = (e) => { e.preventDefault(); if (!on) return; on = false; el.classList.remove('down'); if (onUp) onUp(e); };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
  }
  press($('vtGas'), () => { touch.gas = 1; }, () => { touch.gas = 0; });
  press($('vtBrake'), () => { touch.brake = 1; }, () => { touch.brake = 0; });
  press($('vtHand'), () => { touch.hand = 1; }, () => { touch.hand = 0; });
  press($('vtExit'), () => { if (lastPlayer) exit(lastPlayer); });
  press($('vtCam'), () => toggleDriveCam());
  press($('vtLight'), () => toggleLights());
  press($('vtHorn'), () => { hornTouch = true; }, () => { hornTouch = false; });
  press($('vtMap'), () => dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'm' })));
  press($('vtPause'), () => { const b = document.getElementById('btnPause'); if (b) b.click(); });

  // steer pad: finger position across the pad = steering
  {
    const pad = $('vtSteer'), knob = $('vtWheel');
    let pid = null;
    const set = (e) => {
      const r = pad.getBoundingClientRect();
      const n = clamp((e.clientX - (r.left + r.width / 2)) / (r.width / 2 - 38), -1, 1);
      touch.steer = -n; // right of centre = turn right = negative "left" input
      knob.style.transform = `translateX(${n * (r.width / 2 - 38)}px) rotate(${n * 160}deg)`;
    };
    pad.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); pid = e.pointerId; try { pad.setPointerCapture(pid); } catch (_) {} set(e); });
    pad.addEventListener('pointermove', (e) => { if (e.pointerId === pid) { e.preventDefault(); set(e); } });
    const end = (e) => { if (e.pointerId !== pid) return; pid = null; touch.steer = 0; knob.style.transform = ''; };
    pad.addEventListener('pointerup', end); pad.addEventListener('pointercancel', end); pad.addEventListener('lostpointercapture', end);
  }
  // look pad: drag anywhere free to orbit the camera / turn your head
  {
    const lk = $('vtLook');
    let pid = null, lx = 0, ly = 0;
    lk.addEventListener('pointerdown', (e) => { e.preventDefault(); pid = e.pointerId; lx = e.clientX; ly = e.clientY; try { lk.setPointerCapture(pid); } catch (_) {} });
    lk.addEventListener('pointermove', (e) => {
      if (e.pointerId !== pid) return;
      e.preventDefault();
      orbitBy(e.clientX - lx, e.clientY - ly, 0.0065 * settings.sens);
      lx = e.clientX; ly = e.clientY;
    });
    const end = (e) => { if (e.pointerId === pid) pid = null; };
    lk.addEventListener('pointerup', end); lk.addEventListener('pointercancel', end); lk.addEventListener('lostpointercapture', end);
  }
  function orbitBy(dx, dy, k) {
    orbit.yaw = clamp(orbit.yaw - dx * k, -3.2, 3.2);
    orbit.pitch = clamp(orbit.pitch - dy * k * 0.7, -0.7, 0.9);
    orbit.idle = 0;
  }
  addEventListener('mousemove', (e) => {
    if (!occupied || document.pointerLockElement == null || Math.abs(e.movementX) > 350) return;
    orbitBy(e.movementX, e.movementY, 0.0022 * settings.sens);
  });
  addEventListener('keydown', (e) => {
    if (!occupied) return;
    const a = document.activeElement;
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA')) return;
    if (e.code === 'KeyH') keys.horn = true;
    else if (e.code === 'KeyL' && !e.repeat) toggleLights();
  });
  addEventListener('keyup', (e) => { if (e.code === 'KeyH') keys.horn = false; });
  const resetTouch = () => { touch.gas = touch.brake = touch.hand = touch.steer = 0; hornTouch = false; keys.horn = false; $('vtWheel').style.transform = ''; ui.querySelectorAll('.down').forEach((n) => n.classList.remove('down')); };
  addEventListener('blur', resetTouch);
  document.addEventListener('visibilitychange', resetTouch);

  function toggleLights() {
    keys.lights = !keys.lights;
    $('vtLight').classList.toggle('on', keys.lights);
    if (hud) hud.setMsg(keys.lights ? 'Headlights on' : 'Headlights off', 700);
  }
  $('vtLight').classList.add('on');

  // ---------- vehicles ----------
  function registerCols(v) {
    // Never solid while occupied (driver would be trapped / cols would go stale).
    if (occupied === v) return;
    if (!v.alive && !v.wreck) return;
    // Always rebuild so AABBs track the current pose (fixes "lost collision after driving").
    unregisterCols(v);
    const t = v.type;
    const W = t.size.W, L = t.size.L;
    // Chain of AABBs along the vehicle long axis so the hull roughly matches the mesh.
    const n = Math.max(2, Math.min(6, Math.round(L / Math.max(0.9, W * 0.85))));
    const fx0 = -Math.sin(v.yaw), fz0 = -Math.cos(v.yaw);
    const top = v.y + t.size.H;
    const span = Math.max(0.01, L - W * 0.9);
    for (let i = 0; i < n; i++) {
      const off = (i - (n - 1) / 2) * (span / Math.max(1, n - 1));
      const cx = v.x + fx0 * off, cz = v.z + fz0 * off;
      // Slightly tighter than visual width so invisible "fat" hitboxes don't stick out.
      const c = addCollider(cx, cz, W * 0.88, top, W * 0.88, { y0: v.y + 0.05 });
      c.vehicle = v;
      c.noCover = true;
      c.onShot = (dmg, pt) => hit(v, dmg * 0.55, pt);
      v.cols.push(c);
    }
  }
  function unregisterCols(v) {
    if (!v || !v.cols) return;
    for (const c of v.cols) {
      try { removeCollider(c); } catch (_) {}
    }
    v.cols.length = 0;
  }

  function spawnOne(spec) {
    const type = VEHICLE_TYPES[spec.type] || VEHICLE_TYPES.sedan;
    // nudge out of walls / other vehicles
    let x = spec.x, z = spec.z, ok = false;
    for (let i = 0; i < 9 && !ok; i++) {
      const a = i * 2.4, r = i * 2.2, tx = spec.x + Math.cos(a) * r, tz = spec.z + Math.sin(a) * r;
      const res = resolveCircle(tx, tz, type.size.W * 0.9, heightAt(tx, tz), type.size.H);
      if (Math.hypot(res.x - tx, res.z - tz) < 0.02) { x = tx; z = tz; ok = true; }
    }
    if (!ok) return null;
    const color = COLORS[(Math.random() * COLORS.length) | 0];
    const opt = { spoiler: type.id === 'sedan' && Math.random() < 0.4, rack: (type.id === 'sedan' || type.id === 'van') && Math.random() < 0.35, bullbar: type.id === 'truck' && Math.random() < 0.5, lightbar: type.id === 'truck' && Math.random() < 0.4 };
    const inst = instantiate(type, color, opt);
    const v = {
      id: 'v' + list.length, type, spec, inst, mesh: inst.root, x, z, y: heightAt(x, z), yaw: spec.yaw || 0, vx: 0, vz: 0, vy: 0, steer: 0, steerIn: 0,
      gas: type.tank * rnd(0.55, 1), hp: type.hp, alive: true, wreck: false, awake: true, sleepT: 0, cols: [],
      wheelSpin: 0, door: 0, doorUntil: 0, bodyP: 0, bodyR: 0, bodyY: 0, pitch: 0, roll: 0, lastVf: 0, yawRate: 0, braking: false, reversing: false,
      smokeT: 0, burning: false, respawnT: 0, camHeading: spec.yaw || 0, shake: 0, camBlend: 1, lightsOn: false, blink: 0, rough: 0,
      airborne: false, prevGy: heightAt(x, z), angP: 0, angR: 0,
    };
    scene.add(inst.root);
    place(v, 1);
    // place() only writes v.y/pitch/roll — mesh must be synced or it stays at 0,0,0
    inst.root.position.set(v.x, v.y, v.z);
    inst.root.rotation.set(v.pitch, v.yaw, v.roll);
    inst.root.updateMatrixWorld(true);
    list.push(v);
    return v;
  }

  /** Sample driveable surface (terrain + ramps + floors), not just bare terrain. */
  function groundAt(x, z, yHint) {
    return floorAt(x, z, (yHint != null ? yHint : heightAt(x, z)) + 3, 0.85);
  }

  /** Wheel heights + pitch/roll from real surface (includes ramps). */
  function sampleWheels(v) {
    const t = v.type, sy = Math.sin(v.yaw), cy = Math.cos(v.yaw), hb = t.wb / 2, tr = Math.max(0.35, t.track);
    const fx0 = -sy, fz0 = -cy, rx = cy, rz = -sy;
    const yH = v.y;
    const hFL = groundAt(v.x + fx0 * hb - rx * tr, v.z + fz0 * hb - rz * tr, yH);
    const hFR = groundAt(v.x + fx0 * hb + rx * tr, v.z + fz0 * hb + rz * tr, yH);
    const hRL = groundAt(v.x - fx0 * hb - rx * tr, v.z - fz0 * hb - rz * tr, yH);
    const hRR = groundAt(v.x - fx0 * hb + rx * tr, v.z - fz0 * hb + rz * tr, yH);
    const pitch = Math.atan2((hFL + hFR) / 2 - (hRL + hRR) / 2, t.wb);
    const roll = Math.atan2((hFR + hRR) / 2 - (hFL + hRL) / 2, tr * 2);
    const y = (hFL + hFR + hRL + hRR) / 4;
    return { hFL, hFR, hRL, hRR, pitch, roll, y, min: Math.min(hFL, hFR, hRL, hRR), max: Math.max(hFL, hFR, hRL, hRR) };
  }

  /** Soft stick when grounded (called rarely). Prefer step()'s spring integration. */
  function place(v, k) {
    const w = sampleWheels(v);
    v.pitch += (w.pitch - v.pitch) * k;
    v.roll += (w.roll - v.roll) * k;
    v.y += (w.y - v.y) * k;
    v.slope = Math.tan(v.pitch);
  }

  for (const s of defaultSpawns()) { const v = spawnOne(s); if (v) registerCols(v); }

  function reach(v, px, pz) {
    const sy = Math.sin(v.yaw), cy = Math.cos(v.yaw), dx = px - v.x, dz = pz - v.z;
    const lr = dx * cy - dz * sy, lf = -dx * sy - dz * cy;
    return Math.hypot(Math.max(Math.abs(lr) - v.type.size.W / 2, 0), Math.max(Math.abs(lf) - v.type.size.L / 2, 0));
  }
  function nearestFree(px, pz, maxD) {
    let best = null, bd = maxD;
    const my = netApi && netApi.getMyId ? netApi.getMyId() : null;
    for (const v of list) {
      if (!v.alive || occupied === v) continue;
      if (remoteOwner[v.id] && remoteOwner[v.id] !== my) continue;
      if ((v.x - px) ** 2 + (v.z - pz) ** 2 > 64) continue;
      const d = reach(v, px, pz);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  function showHud(v) {
    document.body.classList.toggle('in-vehicle', !!v);
    if (!v) { resetTouch(); return; }
    $('vhName').textContent = v.type.name.toUpperCase();
  }

  function enter(player, v) {
    if (!v || !v.alive || occupied) return false;
    const my = netApi && netApi.getMyId ? netApi.getMyId() : null;
    if (remoteOwner[v.id] && remoteOwner[v.id] !== my) {
      if (hud) hud.setMsg('Someone else is driving that', 1200);
      return false;
    }
    occupied = v;
    v.awake = true;
    unregisterCols(v);
    if (netApi && netApi.isConnected && netApi.isConnected() && netApi.sendVehClaim) {
      netApi.sendVehClaim(v.id);
      pendingClaim = v.id;
    }
    player.inVehicle = true; player.vehicle = v;
    player.vx = player.vz = 0; player.ads = false; player.reloading = false;
    player.x = v.x; player.z = v.z; player.y = v.y;
    v.doorUntil = time + 0.9;
    v.camBlend = 0; v.camFrom = null;
    v.lightsOn = keys.lights;
    orbit.yaw = orbit.pitch = 0; orbit.idle = 9;
    resetTouch();
    showHud(v);
    if (engine) engine.stop();
    engine = makeEngine();
    if (hud) hud.setMsg('Entered ' + v.type.name, 1100);
    if (audio) try { audio.play('click'); } catch (_) {}
    return true;
  }

  function release(player, v) {
    if (engine) { engine.stop(); engine = null; }
    v.driver = false;
    if (v.inst && v.inst.driver) v.inst.driver.visible = false;
    if (v && netApi && netApi.isConnected && netApi.isConnected() && netApi.sendVehExit) {
      netApi.sendVehExit({ id: v.id, x: v.x, z: v.z, yaw: v.yaw });
    }
    if (v && remoteOwner[v.id] && netApi && netApi.getMyId && remoteOwner[v.id] === netApi.getMyId()) {
      delete remoteOwner[v.id];
    }
    occupied = null;
    pendingClaim = null;
    if (player) { player.inVehicle = false; player.vehicle = null; }
    showHud(null);
    spots.forEach((s) => { s.intensity = 0; });
    if (v) {
      v.doorUntil = time + 1;
      v.awake = true; v.sleepT = 0;
      registerCols(v);
    }
  }

  function exit(player) {
    if (!occupied) return false;
    const v = occupied, sy = Math.sin(v.yaw), cy = Math.cos(v.yaw);
    const side = v.inst.meta.exitSide;
    const cands = [[-cy * side, sy * side], [cy * side, -sy * side], [sy * (v.type.size.L / 2 + 1), cy * (v.type.size.L / 2 + 1)]];
    let px = v.x + cands[0][0], pz = v.z + cands[0][1];
    for (const [ox, oz] of cands) {
      const tx = v.x + ox, tz = v.z + oz, res = resolveCircle(tx, tz, 0.45, heightAt(tx, tz), 1.8);
      if (Math.hypot(res.x - tx, res.z - tz) < 0.03) { px = tx; pz = tz; break; }
    }
    player.x = px; player.z = pz; player.y = heightAt(px, pz);
    player.velY = 0; player.onGround = true; player.yaw = v.yaw; player.pitch = 0.05;
    release(player, v);
    if (hud) hud.setMsg('Exited vehicle', 900);
    return true;
  }

  function tryUse(player) {
    lastPlayer = player;
    if (occupied) return exit(player);
    const v = nearestFree(player.x, player.z, 2.4);
    return v ? enter(player, v) : false;
  }

  function toggleDriveCam() {
    if (!occupied) return false;
    driveCam = driveCam === 'chase' ? 'cabin' : 'chase';
    orbit.yaw = orbit.pitch = 0;
    occupied.camBlend = 0; occupied.camFrom = null;
    if (hud) hud.setMsg(driveCam === 'cabin' ? 'Cabin view' : 'Chase cam', 800);
    return true;
  }

  // ---------- damage / fire / explosion ----------
  function hurtPlayer(player, dmg, x, z) {
    if (!player || !player.alive || dmg <= 0) return;
    if (opts.damagePlayer) opts.damagePlayer(dmg, x, z);
    else player.hp = Math.max(1, player.hp - dmg);
  }
  function hit(v, dmg, pt) {
    if (!v.alive || dmg <= 0) return;
    if (pt) fx.spark(pt.x, pt.y, pt.z);
    v.hp -= dmg;
    if (v.hp <= 0) explode(v);
  }
  function explode(v) {
    if (!v.alive) return null;
    v.alive = false; v.wreck = true; v.hp = 0; v.vx = v.vz = 0; v.burning = false; v.respawnT = 150;
    toWreck(v.inst);
    v.inst.em.head.emissiveIntensity = 0; v.inst.em.tail.emissiveIntensity = 0;
    fx.blast(v.x, v.y, v.z);
    boom(1);
    if (audio) try { audio.play('thud', v.x, v.z); } catch (_) {}
    if (hud) hud.setMsg('Vehicle destroyed', 1400);
    const wasMine = occupied === v;
    const pl = lastPlayer;
    if (wasMine) { if (pl) { hurtPlayer(pl, 110, v.x, v.z); release(pl, v); pl.y = heightAt(pl.x, pl.z); } }
    else if (pl && pl.alive) {
      const d = Math.hypot(pl.x - v.x, pl.z - v.z);
      if (d < 7) hurtPlayer(pl, 70 * (1 - d / 7), v.x, v.z);
    }
    for (const o of list) {
      if (o === v || !o.alive) continue;
      const d = Math.hypot(o.x - v.x, o.z - v.z);
      if (d < 7) hit(o, 90 * (1 - d / 7), null);
    }
    v.awake = true; v.sleepT = 0;
    registerCols(v);
    return { x: v.x, z: v.z, radius: 7, dmg: 70 };
  }
  function hurtAt(x, z, radius, dmg) {
    let blast = null;
    for (const v of list) {
      if (!v.alive) continue;
      const d = Math.hypot(v.x - x, v.z - z);
      if (d < radius) { hit(v, dmg * (1 - d / radius), null); if (!v.alive) blast = { x: v.x, z: v.z, radius: 7, dmg: 70 }; }
    }
    return blast;
  }

  // ---------- physics ----------
  function step(v, dt, inp) {
    const t = v.type, sy0 = Math.sin(v.yaw), cy0 = Math.cos(v.yaw);
    let fx0 = -sy0, fz0 = -cy0, rx = cy0, rz = -sy0;
    let vf = v.vx * fx0 + v.vz * fz0;
    const h0 = heightAt(v.x, v.z), h1 = heightAt(v.x + 2, v.z + 2);
    const rough = clamp(Math.abs(h1 - h0) * 2, 0, 1);
    v.rough += (rough - v.rough) * Math.min(1, dt * 3);
    const surface = 1 - rough * (1 - t.offroad) * 0.85, vmax = t.maxSpeed * surface;
    const gasIn = v.gas > 0 ? inp.gas : 0, revIn = inp.brake, hand = inp.hand;
    v.braking = (revIn > 0 && vf > 0.6) || hand > 0;
    v.reversing = vf < -0.4;
    if (gasIn > 0) vf += t.accel * (0.25 + 0.75 * clamp(1 - Math.max(vf, 0) / vmax, 0, 1)) * gasIn * dt;
    if (revIn > 0) vf -= (vf > 0.6 ? t.brake : t.accel * 0.55) * revIn * dt;
    if (!gasIn && !revIn) vf -= sgn(vf) * Math.min(Math.abs(vf), (0.9 + Math.abs(vf) * 0.05) * dt);
    if (hand > 0) vf -= sgn(vf) * Math.min(Math.abs(vf), t.brake * 0.5 * dt);
    if (v.gas <= 0 && !hand) vf *= Math.max(0, 1 - 1.2 * dt);
    vf -= (v.slope || 0) * 9.8 * 0.5 * dt;
    vf = clamp(vf, -vmax * 0.35, vmax);
    v.vx = fx0 * vf + rx * (v.vx * rx + v.vz * rz);
    v.vz = fz0 * vf + rz * (v.vx * rx + v.vz * rz);
    // steering (bicycle model)
    const spdK = 1 / (1 + Math.pow(Math.abs(vf) / 12, 1.5));
    const maxSteer = clamp(0.55 * (t.turn / 2.1), 0.3, 0.8) * (0.25 + 0.75 * spdK);
    v.steer += (inp.steer * maxSteer - v.steer) * Math.min(1, dt * (inp.analog ? 12 : 7));
    v.yawRate = (vf / t.wb) * Math.tan(v.steer) * (hand > 0 && Math.abs(vf) > 3 ? 1.35 : 1);
    v.yaw += v.yawRate * dt;
    // re-split the (world) velocity in the new heading: lateral grip bleeds into forward speed
    const sy = Math.sin(v.yaw), cy = Math.cos(v.yaw);
    fx0 = -sy; fz0 = -cy; rx = cy; rz = -sy;
    vf = v.vx * fx0 + v.vz * fz0;
    let vl = v.vx * rx + v.vz * rz;
    const keep = Math.exp(-(hand > 0 ? 1.6 : 7 * (0.4 + 0.6 * surface)) * dt), moved = vl * (1 - keep);
    vl *= keep;
    vf += Math.abs(moved) * (hand > 0 ? 0.25 : 0.85) * sgn(vf);
    v.slip = clamp((Math.abs(vl) - 1.2) / 5, 0, 1);
    v.vx = fx0 * vf + rx * vl; v.vz = fz0 * vf + rz * vl;
    v.gas = Math.max(0, v.gas - (Math.abs(vf) * 0.012 + (gasIn ? 0.3 : 0.05)) * dt);
    // collisions (two circles along the body)
    let nx = v.x + v.vx * dt, nz = v.z + v.vz * dt;
    const off = t.size.L * 0.3, rad = t.size.W * 0.48;
    let cx = 0, cz = 0, cm = 0;
    for (const s of [1, -1]) {
      const ax = nx + fx0 * off * s, az = nz + fz0 * off * s, r = resolveCircle(ax, az, rad, v.y, t.size.H);
      const dx = r.x - ax, dz = r.z - az, m = Math.hypot(dx, dz);
      if (m > 0.003) { if (m > cm) { cx += dx * 0.5; cz += dz * 0.5; cx = cx * 0 + dx + cx * 0; cz = dz; cm = m; } else { cx += dx * 0.5; cz += dz * 0.5; } }
    }
    if (cm > 0) {
      nx += cx; nz += cz;
      const nl = Math.hypot(cx, cz) || 1, nnx = cx / nl, nnz = cz / nl, vn = v.vx * nnx + v.vz * nnz;
      if (vn < 0) {
        v.vx -= nnx * vn * 1.25; v.vz -= nnz * vn * 1.25;
        const imp = -vn;
        if (imp > 3) {
          v.shake = Math.min(1, imp / 18);
          if (audio) try { audio.play('thud', v.x, v.z); audio.play('clang', v.x, v.z, { vol: 0.5 }); } catch (_) {}
          fx.spark(v.x + fx0 * 1.5 * sgn(vf), v.y + 0.7, v.z + fz0 * 1.5 * sgn(vf));
          // Real crashes only — bikes were dying from tiny curb scrapes
          const isMoto = t.id === 'motorcycle';
          const thr = isMoto ? 12 : 8;
          if (imp > thr) {
            const raw = Math.pow(imp - (thr - 1), 1.25) * (isMoto ? 0.28 : 0.7);
            hit(v, Math.min(isMoto ? 18 : 40, raw), null);
          }
        }
      }
    }
    v.x = nx; v.z = nz;

    // ---------- suspension + gravity + air (uses floorAt so ramps work) ----------
    const aLong = (vf - v.lastVf) / Math.max(dt, 1e-3);
    v.lastVf = vf;
    v.vfNow = vf;

    const wheels = sampleWheels(v);
    const support = wheels.y;
    const dSup = support - (v.prevGy != null ? v.prevGy : support);
    v.prevGy = support;
    v.slope = Math.tan(wheels.pitch);

    // Gravity always
    const G = 22;
    v.vy = (v.vy || 0) - G * dt;

    // Bumps: sharp surface changes toss the chassis
    if (Math.abs(dSup) > 0.04 && Math.abs(vf) > 3) {
      v.vy += clamp(dSup * Math.abs(vf) * 0.55, -6, 8);
    }

    v.y += v.vy * dt;

    const ride = 0.06;
    const target = support + ride;
    const gap = v.y - target;

    if (gap < 0) {
      // Wheels in compression — spring + damper
      const impact = -v.vy;
      v.y = target;
      // Restitution (bounce) scales with impact
      if (impact > 1.5) v.vy = impact * (impact > 10 ? 0.28 : 0.12);
      else v.vy = Math.max(0, v.vy) * 0.15;
      if (impact > 11) {
        const isMoto = t.id === 'motorcycle';
        hit(v, Math.min(isMoto ? 24 : 38, (impact - 10) * (isMoto ? 1.0 : 1.5)), null);
        v.shake = Math.min(1, impact / 14);
        if (audio) try { audio.play('thud', v.x, v.z); } catch (_) {}
      }
      v.airborne = false;
      // Align to surface while planted
      v.pitch += (wheels.pitch - v.pitch) * Math.min(1, dt * 10);
      v.roll += (wheels.roll - v.roll) * Math.min(1, dt * 10);
      // High-speed landing / side slope → tip toward rollover
      if (Math.abs(wheels.roll) > 0.55 && Math.abs(vf) > 14 && impact > 4) {
        v.angR = Math.sign(wheels.roll) * (1.5 + Math.abs(vf) * 0.05);
        v.vy += 3;
        v.y += 0.4;
        v.airborne = true;
      }
    } else if (gap > 0.45) {
      // Fully airborne
      v.airborne = true;
      v.yaw += v.steer * 0.45 * dt;
      v.pitch += (v.angP || 0) * dt;
      v.roll += (v.angR || 0) * dt;
      // Carry surface pitch into air when leaving a ramp
      if (Math.abs(dSup) > 0.2 && Math.abs(vf) > 8) {
        v.angP = clamp(-dSup * Math.abs(vf) * 0.12, -2.5, 2.5);
        v.angR = (v.steer || 0) * Math.abs(vf) * 0.06;
      }
      v.angP = (v.angP || 0) * Math.max(0, 1 - 0.55 * dt);
      v.angR = (v.angR || 0) * Math.max(0, 1 - 0.4 * dt);
      v.pitch = clamp(v.pitch, -1.6, 1.6);
      // Rollover settle
      if (Math.abs(v.roll) > Math.PI * 0.55) {
        v.roll = Math.sign(v.roll) * Math.min(Math.PI, Math.abs(v.roll));
        v.vx *= 0.92; v.vz *= 0.92;
      }
    } else {
      // Near ground — soft attraction
      v.airborne = gap > 0.2;
      v.vy -= gap * 18 * dt;
      v.pitch += (wheels.pitch - v.pitch) * Math.min(1, dt * 6);
      v.roll += (wheels.roll - v.roll) * Math.min(1, dt * 6);
    }

    // Body lean visuals
    const bump = Math.sin(time * 21 + v.x * 0.3) * 0.003 * clamp(Math.abs(vf) / Math.max(1, vmax), 0, 1) * (0.4 + v.rough * 5);
    v.bodyP += (clamp(aLong * 0.006, -0.08, 0.08) + bump - v.bodyP) * Math.min(1, dt * 7);
    v.bodyR += (-clamp(v.yawRate * vf * 0.005, -0.09, 0.09) - v.bodyR) * Math.min(1, dt * 7);

    return vf;
  }

  function vehicleFx(v, dt, vf) {
    const t = v.type, sy = Math.sin(v.yaw), cy = Math.cos(v.yaw);
    const speed = Math.abs(vf);
    if (speed > 4 && v.rough > 0.25) {
      v.smokeT -= dt;
      if (v.smokeT <= 0) { v.smokeT = 0.06; const s = v.type.wb / 2; fx.smoke(v.x + sy * s, v.y + 0.2, v.z + cy * s, rnd(-1, 1), rnd(0.3, 1), rnd(-1, 1), 0.4, 1.6, 0.9, 0.35, 0x8a7a5a); }
    }
    if (v.slip > 0.35 || (v.braking && speed > 14)) {
      const s = t.wb / 2;
      fx.smoke(v.x + sy * s + cy * rnd(-0.6, 0.6), v.y + 0.15, v.z + cy * s - sy * rnd(-0.6, 0.6), rnd(-0.4, 0.4), 0.3, rnd(-0.4, 0.4), 0.4, 1.4, 0.8, 0.4, 0xc9c9c9);
    }
  }

  // ---------- per-frame ----------
  function animate(v, dt) {
    const I = v.inst, t = v.type;
    I.root.position.set(v.x, v.y, v.z);
    I.root.rotation.set(v.pitch, v.yaw, v.roll + (t.id === 'motorcycle' ? v.leanBike || 0 : 0));
    I.body.rotation.set(t.id === 'motorcycle' ? 0 : v.bodyP, 0, t.id === 'motorcycle' ? 0 : v.bodyR);
    I.body.position.y = v.bodyY;
    const driven = occupied === v;
    // doors
    if (I.door) {
      v.door += ((time < v.doorUntil ? 1 : 0) - v.door) * Math.min(1, dt * 7);
      I.door.rotation.y = -1.15 * v.door;
    }
    // wheels
    const sp = v.wheelSpin;
    for (const w of I.wheels) {
      w.spin.rotation.x = sp;
      if (w.front && !w.onFork) w.pivot.rotation.y = clamp(v.steer, -0.6, 0.6);
    }
    if (I.forkG) I.forkG.rotation.y = clamp(v.steer, -0.7, 0.7) * 1.4;
    if (I.steerWheel) I.steerWheel.rotation.z = v.steer * 4.2;
    // lights
    const L = (driven ? v.lightsOn : false);
    I.em.head.emissiveIntensity = v.alive ? (L ? 1.6 : 0.12) : 0;
    I.em.tail.emissiveIntensity = v.alive ? (v.braking ? 2.2 : L ? 0.7 : 0.15) : 0;
    I.em.rev.emissiveIntensity = v.reversing && driven ? 1.5 : 0;
    v.blink += dt;
    const on = driven && Math.abs(v.steer) > 0.16 && Math.floor(v.blink * 3.2) % 2 === 0;
    I.em.sigL.emissiveIntensity = on && v.steer > 0 ? 2 : 0;
    I.em.sigR.emissiveIntensity = on && v.steer < 0 ? 2 : 0;
  }

  function update(dt, player, input, camera) {
    time += dt;
    lastPlayer = player;
    fx.update(dt);
    const px = player.x, pz = player.z;
    for (const v of list) {
      const d2 = (v.x - px) ** 2 + (v.z - pz) ** 2, driven = occupied === v;
      const vis = d2 < FAR2 || driven;
      v.mesh.visible = vis;
      v.inst.near.visible = d2 < NEAR2 || driven;
      if (v.wreck) {
        v.respawnT -= dt;
        v.smokeT -= dt;
        if (v.smokeT <= 0 && vis) { v.smokeT = 0.25; fx.smoke(v.x + rnd(-0.6, 0.6), v.y + 1, v.z + rnd(-0.6, 0.6), rnd(-0.3, 0.3), 1.2, rnd(-0.3, 0.3), 0.8, 3, 3, 0.5, 0x1a1a1a); }
        if (v.respawnT <= 0 && d2 > 70 * 70) { unregisterCols(v); scene.remove(v.mesh); list.splice(list.indexOf(v), 1); const n = spawnOne(v.spec); if (n) registerCols(n); }
        continue;
      }
      if (!v.alive) continue;
      // burning / smoking
      const frac = v.hp / v.type.hp;
      if (frac < 0.35 && vis) {
        v.smokeT -= dt;
        if (v.smokeT <= 0) {
          v.smokeT = frac < 0.18 ? 0.08 : 0.16;
          const f = v.type.size.L * 0.35, sy = Math.sin(v.yaw), cy = Math.cos(v.yaw);
          fx.smoke(v.x - sy * f, v.y + 1.1, v.z - cy * f, rnd(-0.3, 0.3), rnd(1, 2), rnd(-0.3, 0.3), 0.4, 2.2, 1.6, 0.55, frac < 0.18 ? 0x1b1b1b : 0x777777);
          if (frac < 0.18) fx.fire(v.x - sy * f, v.y + 1, v.z - cy * f, rnd(-0.3, 0.3), rnd(0.8, 1.8), rnd(-0.3, 0.3), 0.5, 0.15, 0.5, 0.9);
        }
      }
      const fireLine = v.type.id === 'motorcycle' ? 0.12 : 0.18;
      if (frac < fireLine) {
        if (!v.burning) { v.burning = true; if (driven && hud) hud.setMsg('ON FIRE — GET OUT!', 2500); }
        v.hp -= v.type.hp * (v.type.id === 'motorcycle' ? 0.02 : 0.035) * dt;
        if (v.hp <= 0) { explode(v); continue; }
      }
      if (driven) continue;
      // parked / coasting
      if (v.awake) {
        const vf = step(v, dt, { gas: 0, brake: 0, hand: 1, steer: 0 });
        v.wheelSpin -= (vf * dt) / v.type.wr;
        const mv = Math.abs(v.vx) + Math.abs(v.vz);
        if (mv < 0.1) { v.sleepT += dt; if (v.sleepT > 1.2 && !v.burning && frac >= 0.35) { v.awake = false; if (occupied !== v) registerCols(v); } } else { v.sleepT = 0; if (occupied !== v && Math.hypot(v.vx, v.vz) > 0.4) unregisterCols(v); }
        if (vis) animate(v, dt);
      } else if (vis) {
        // Parked: still must keep mesh at v.x/z (was never synced → all cars stuck at origin)
        animate(v, dt);
      }
    }

    // on-foot prompt
    if (!occupied && player.alive) {
      const v = nearestFree(px, pz, 2.4);
      if (v) { prompt.textContent = isTouchUi() ? `Tap USE · drive ${v.type.name}` : `E · drive ${v.type.name}`; prompt.classList.add('on'); } else prompt.classList.remove('on');
    } else prompt.classList.remove('on');

    if (!occupied) return null;
    const v = occupied;
    if (!player.inVehicle || !player.alive || !v.alive || Math.hypot(px - v.x, pz - v.z) > 3) {
      release(player, v);
      if (!player.alive || !v.alive) player.y = heightAt(player.x, player.z);
      return v.alive ? null : { explosion: true };
    }
    drive(v, dt, player, input || {}, camera);
    return { driving: true, vehicle: v };
  }

  function drive(v, dt, player, input, camera) {
    const t = v.type;
    const kb = (input.left ? 1 : 0) - (input.right ? 1 : 0);
    const analog = touch.steer !== 0;
    const inp = {
      gas: Math.max(input.forward ? 1 : 0, touch.gas), brake: Math.max(input.back ? 1 : 0, touch.brake), hand: Math.max(input.jump ? 1 : 0, touch.hand),
      steer: analog ? touch.steer : kb, analog,
    };
    const vf = step(v, dt, inp);
    v.wheelSpin -= (vf * dt) / t.wr;
    if (t.id === 'motorcycle') v.leanBike = clamp(v.steer * Math.min(Math.abs(vf) / 7, 1) * 1.5 + (inp.hand ? 0 : 0), -0.8, 0.8);
    vehicleFx(v, dt, vf);
    animate(v, dt);

    if (netApi && netApi.isConnected && netApi.isConnected() && netApi.sendVeh) {
      const nowMs = performance.now();
      if (nowMs - lastVehSend > 50) {
        lastVehSend = nowMs;
        netApi.sendVeh({
          id: v.id,
          x: +v.x.toFixed(2), y: +v.y.toFixed(2), z: +v.z.toFixed(2),
          yaw: +v.yaw.toFixed(3),
          spd: +(v.vfNow || 0).toFixed(2),
          hp: Math.round(v.hp),
          gas: +v.gas.toFixed(1),
        });
      }
    }

    player.x = v.x; player.z = v.z; player.y = v.y; player.yaw = v.yaw; player.pitch = 0.04;
    player.vx = player.vz = 0;
    if (audio && audio.setListener) try { audio.setListener(v.x, v.z, v.yaw); } catch (_) {}

    // lights
    const sy = Math.sin(v.yaw), cy = Math.cos(v.yaw);
    spots.forEach((s, i) => {
      const side = (i ? 1 : -1) * (t.id === 'motorcycle' ? 0 : t.size.W * 0.3);
      s.position.set(v.x - sy * t.size.L * 0.45 + cy * side, v.y + 0.85, v.z - cy * t.size.L * 0.45 - sy * side);
      s.target.position.set(v.x - sy * 30, v.y, v.z - cy * 30);
      s.intensity = v.lightsOn && (i === 0 || t.id !== 'motorcycle') ? 260 : 0;
    });

    // engine sound
    if (engine) {
      const sf = clamp(Math.abs(vf) / t.maxSpeed, 0, 1);
      engine.update(sf, inp.gas, t.pitch, v.slip + (v.braking && Math.abs(vf) > 12 ? 0.4 : 0), keys.horn || hornTouch);
    }

    // HUD
    const gasPct = clamp(v.gas / t.tank, 0, 1), hpPct = clamp(v.hp / t.hp, 0, 1);
    $('vhSpd').textContent = Math.round(Math.abs(vf) * 3.6);
    $('vhGear').textContent = vf < -0.5 ? 'R' : Math.abs(vf) < 0.5 ? 'N' : String(1 + Math.min(4, Math.floor((Math.abs(vf) / t.maxSpeed) * 5)));
    $('vhGas').style.width = gasPct * 100 + '%'; $('vhHp').style.width = hpPct * 100 + '%';
    $('vhGasT').classList.toggle('low', gasPct < 0.2); $('vhHpT').classList.toggle('low', hpPct < 0.3);
    if (v.gas <= 0 && hud && Math.random() < 0.01) hud.setMsg('Out of gas', 800);

    // driver visibility
    v.inst.driver.visible = driveCam !== 'cabin';
    if (v.inst.steerWheel) v.inst.steerWheel.visible = true;

    // ---- camera ----
    orbit.idle += dt;
    if (orbit.idle > 2) { const k = Math.exp(-3 * dt); orbit.yaw *= k; orbit.pitch *= k; }
    v.shake = Math.max(0, v.shake - dt * 2.5);
    if (!camera) return;
    v.mesh.updateMatrixWorld(true);
    const sf = clamp(Math.abs(vf) / t.maxSpeed, 0, 1);
    const baseFov = settings.fov || 75;
    let tx, ty, tz;
    const q = new THREE.Quaternion();
    if (driveCam === 'cabin') {
      const e = v.inst.body.localToWorld(new THREE.Vector3(...v.inst.meta.eye));
      tx = e.x; ty = e.y; tz = e.z;
      v.inst.body.getWorldQuaternion(q);
      q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(clamp(orbit.pitch, -0.7, 0.8), clamp(orbit.yaw, -2.2, 2.2), 0, 'YXZ')));
    } else {
      v.camHeading += angDiff(v.yaw, v.camHeading) * Math.min(1, dt * 4.5);
      const ang = v.camHeading + orbit.yaw, dist = t.camDist + sf * 1.6, ca = -orbit.pitch;
      const lookX = v.x - Math.sin(v.yaw) * 3, lookY = v.y + 1.1, lookZ = v.z - Math.cos(v.yaw) * 3;
      let cx = v.x + Math.sin(ang) * dist * Math.cos(ca * 0.6), cz = v.z + Math.cos(ang) * dist * Math.cos(ca * 0.6);
      let cy2 = v.y + t.camH + Math.sin(ca) * dist * 0.8;
      const ox = v.x, oy = v.y + 1.4, oz = v.z, dx = cx - ox, dy = cy2 - oy, dz = cz - oz, L = Math.hypot(dx, dy, dz);
      const h = raycastWorld(ox, oy, oz, dx / L, dy / L, dz / L, L + 0.3);
      if (h && h.t < L + 0.3) { const k = Math.max(1.2, h.t - 0.35) / L; cx = ox + dx * k; cy2 = oy + dy * k; cz = oz + dz * k; }
      cy2 = Math.max(cy2, heightAt(cx, cz) + 0.7);
      tx = cx; ty = cy2; tz = cz;
      const m = new THREE.Matrix4().lookAt(new THREE.Vector3(tx, ty, tz), new THREE.Vector3(lookX, lookY, lookZ), new THREE.Vector3(0, 1, 0));
      q.setFromRotationMatrix(m);
    }
    const sh = v.shake * 0.12;
    if (sh > 0.001) { tx += rnd(-sh, sh); ty += rnd(-sh, sh); tz += rnd(-sh, sh); }
    camera.position.set(tx, ty, tz);
    camera.quaternion.copy(q);
    const wantFov = baseFov + sf * 10 + (driveCam === 'cabin' ? 4 : 0);
    camera.fov += (wantFov - camera.fov) * Math.min(1, dt * 6);
    camera.updateProjectionMatrix();
    // smooth hop into the vehicle
    if (v.camBlend < 1) {
      if (!v.camFrom) v.camFrom = { p: camera.position.clone(), q: camera.quaternion.clone() };
      v.camBlend = Math.min(1, v.camBlend + dt / 0.5);
      const k = v.camBlend * v.camBlend * (3 - 2 * v.camBlend);
      if (v.camBlend < 1) {
        const tp = camera.position.clone(), tq = camera.quaternion.clone();
        camera.position.lerpVectors(v.camFrom.p, tp, k);
        camera.quaternion.slerpQuaternions(v.camFrom.q, tq, k);
      }
    }
    camera.updateMatrixWorld();
  }

  function findById(id) {
    return list.find((x) => x.id === id) || null;
  }


  function spawnAt(spec) {
    if (!spec || !spec.type) return null;
    const v = spawnOne({
      type: spec.type,
      x: spec.x || 0,
      y: spec.y || 0,
      z: spec.z || 0,
      yaw: spec.yaw || 0,
    });
    if (v) registerCols(v);
    return v;
  }
  function resetAll(player) {
    if (occupied) release(player || lastPlayer, occupied);
    occupied = null;
    pendingClaim = null;
    for (const k of Object.keys(remoteOwner)) delete remoteOwner[k];
    for (const v of list) {
      try { unregisterCols(v); } catch (_) {}
      v.alive = true;
      v.wreck = false;
      v.burning = false;
      v.hp = v.type.hp;
      v.gas = v.type.tank * 0.85;
      v.vx = 0; v.vz = 0; v.steer = 0;
      v.awake = true; v.sleepT = 0;
      v.x = v.spec.x; v.z = v.spec.z; v.yaw = v.spec.yaw || 0;
      place(v, 1);
      v.mesh.visible = true;
      if (v.inst && v.inst.root) {
        v.inst.root.position.set(v.x, v.y, v.z);
        v.inst.root.rotation.set(v.pitch || 0, v.yaw, v.roll || 0);
      }
      registerCols(v);
      try { animate(v, 0.016); } catch (_) {}
    }
  }

  function setNet(api) { netApi = api || null; }

  function onVehClaim(msg) {
    if (!msg || msg.id == null) return;
    remoteOwner[msg.id] = msg.pid;
    if (pendingClaim === msg.id && netApi && msg.pid === netApi.getMyId()) pendingClaim = null;
  }
  function onVehDeny(msg) {
    if (!msg) return;
    if (occupied && occupied.id === msg.id) {
      release(lastPlayer, occupied);
      if (hud) hud.setMsg('Could not take vehicle', 1200);
    }
  }
  function onVeh(msg) {
    if (!msg || msg.id == null) return;
    if (netApi && msg.pid === netApi.getMyId()) return;
    remoteOwner[msg.id] = msg.pid;
    const v = findById(msg.id);
    if (!v || !v.alive) return;
    v.awake = true;
    try { unregisterCols(v); } catch (_) {}
    // Snap if far (teleport / first packet), else light blend so passengers/body don't trail a car length behind
    const nx = +msg.x, ny = +msg.y, nz = +msg.z, nyaw = +msg.yaw;
    const jump = Math.hypot(nx - v.x, nz - v.z) > 12;
    if (jump) { v.x = nx; v.y = ny; v.z = nz; v.yaw = nyaw; }
    else {
      v.x += (nx - v.x) * 0.55;
      v.y += (ny - v.y) * 0.55;
      v.z += (nz - v.z) * 0.55;
      let dy = nyaw - v.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2;
      while (dy < -Math.PI) dy += Math.PI * 2;
      v.yaw += dy * 0.55;
    }
    if (typeof msg.hp === 'number' && msg.hp >= 0) v.hp = msg.hp;
    if (typeof msg.gas === 'number') v.gas = msg.gas;
    place(v, 1);
    try { animate(v, 0.05); } catch (_) {}
  }
  function onVehExit(msg) {
    if (!msg) return;
    if (msg.id != null) delete remoteOwner[msg.id];
    const v = msg.id != null ? findById(msg.id) : null;
    if (v) {
      if (typeof msg.x === 'number') { v.x = msg.x; v.z = msg.z; v.yaw = msg.yaw || v.yaw; }
      place(v, 1);
      try { animate(v, 0.05); } catch (_) {}
      registerCols(v);
    }
  }
  function onVehReset() { resetAll(lastPlayer); }

  return {
    list,
    tryUse,
    toggleDriveCam,
    update,
    hurtAt,
    resetAll,
    spawnAt,
    setNet,
    onVehClaim,
    onVehDeny,
    onVeh,
    onVehExit,
    onVehReset,
    get occupied() { return occupied; },
    get driveCam() { return driveCam; },
    isDriving: () => !!occupied,
  };
}
