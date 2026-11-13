/**
 * RIFT HORIZON launch trailer. F8 in game, or open the game with ?trailer and press Start.
 * Cut list = PLAN below. Score, cards and flashes all hang off it, so re-timing a shot is a one-number edit.
 * Body-language clips live in overlay() (slide, dive, stagger, die*, fly, lunge, slam, dash...). Tune the numbers there.
 * Abilities are staged in REEL (inside buildShots).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { heightAt } from './ground.js';
import { POIS } from './mapLayout.js';
import { nearby } from './collision.js';
import './weaponsPlus.js';
import { ALL } from './arsenal.js';
import { updateHumanoidAnim, triggerShootKick, triggerMelee, ensureWeapon, equipNow, LOD } from './anim.js';
import { VEHICLE_TYPES } from './vehicles.js';
import { createBuild, SLAB, HEIGHT } from './build.js';
import { HIP_Y } from './parts.js';
import { settings } from './settings.js';

const PI = Math.PI;
// ===================== config =====================
const TITLE = 'RIFT HORIZON';
const TAGLINE = 'COMING SOON';
const SCRIPT_URL = './assets/trailer/script.json';
const VO_DIR = './assets/trailer/vo/';
const AC_URL = {
  plane: new URL('../assets/single-engine-light-aircraft-24478f.glb', import.meta.url).href,
  heli: new URL('../assets/helicopter-9d1986.glb', import.meta.url).href,
};
const AC_GLASS = { plane: [[0.168, 0.266, 0.342]], heli: [[0.021, 0.028, 0.05]] };

// [shot, seconds]. Keep the starts on even numbers (120 bpm) so the score lands on the cuts.
const PLAN = [
  ['vista', 6], ['plane', 6], ['freefall', 4], ['landing', 4], ['contact', 4], ['guns', 6],
  ['prim', 8], ['sec', 8], ['melee', 6], ['util', 4], ['chase', 6], ['blast', 4], ['flyby', 4], ['heli', 4],
  ['build', 8], ['silence', 4], ['charge', 12], ['title', 8],
];
const TM = {}; let END = 0;
for (const [n, d] of PLAN) { TM[n] = { t0: END, t1: END + d }; END += d; }
const HITS = ['plane', 'freefall', 'contact', 'guns', 'prim', 'sec', 'melee', 'chase', 'blast', 'flyby', 'heli', 'build', 'charge', 'title'].map((n) => TM[n].t0);
const CARDS = [
  { t0: TM.guns.t0 + 0.2, t1: TM.guns.t0 + 2.3, text: 'EVERY WEAPON.' },
  { t0: TM.prim.t0 + 0.1, t1: TM.prim.t0 + 1.5, text: 'EVERY ABILITY.' },
  { t0: TM.chase.t0 + 0.3, t1: TM.chase.t0 + 2.4, text: 'EVERY VEHICLE.' },
  { t0: TM.flyby.t0 + 0.2, t1: TM.flyby.t0 + 2.0, text: 'TAKE TO THE SKY.' },
  { t0: TM.build.t0 + 0.2, t1: TM.build.t0 + 2.2, text: 'BUILD ANYTHING.' },
  { t0: TM.silence.t0 + 0.6, t1: TM.silence.t0 + 3.2, text: 'EVERY SECOND.' },
  { t0: TM.title.t0 + 0.3, t1: TM.title.t1 - 0.6, text: TITLE, sub: TAGLINE, big: true },
];
// quality while the trailer plays (restored afterwards)
const BEST = {
  godRays: true, ao: true, bloom: true, grade: true, viewDist: 500, shadows: 3, detail: 3, propScale: 1,
  renderScale: 1, maxDpr: 1.5, cheapMats: false, muzzleLights: true, debris: true, autoPerf: false,
  charCull: 0, animLod: false, simpleVm: false,
};
const SND = { hailstorm: 'stinger', aegis: 'p9', spectre: 'marshal', sentinel: 'marshal', gale: 'breacher', cinder: 'cutter', lifeline: 'p9', wisp: 'spitfire', snare: 'marshal', beacon: 'p9' };

// ===================== helpers =====================
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const sst = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const gy = (x, z) => heightAt(x, z);
function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function slope(x, z) { const e = 2; return Math.hypot(gy(x + e, z) - gy(x - e, z), gy(x, z + e) - gy(x, z - e)) / (2 * e); }
function findStage(R, cx, cz, rMin, rMax, clear) {
  for (let i = 0; i < 160; i++) {
    const a = R() * 6.283, r = rMin + R() * (rMax - rMin), x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    if (slope(x, z) < 0.09 && nearby(x, z, clear).length === 0) return { x, z };
  }
  return { x: cx + rMax, z: cz };
}
/** a flat, empty spot on the 4 m build grid whose ground height is close to a build level */
function findBuildStage(R) {
  let best = null, bd = 9;
  for (let i = 0; i < 300; i++) {
    const p = POIS[Math.floor(R() * POIS.length)] || { x: 0, z: 0 }, a = R() * 6.283, r = 25 + R() * 90;
    const x = Math.round((p.x + Math.cos(a) * r) / 4) * 4, z = Math.round((p.z + Math.sin(a) * r) / 4) * 4;
    if (slope(x, z) > 0.04 || nearby(x + 12, z, 34).length) continue;
    const h0 = gy(x, z);
    let flat = true;
    for (const [dx, dz] of [[-8, 0], [8, 0], [16, 0], [24, 0], [32, 0], [0, -8], [0, 8]]) if (Math.abs(gy(x + dx, z + dz) - h0) > 0.6) { flat = false; break; }
    if (!flat) continue;
    const off = Math.abs(h0 - Math.round(h0 / HEIGHT) * HEIGHT);
    if (off < bd) { bd = off; best = { x, z }; if (off < 0.2) break; }
  }
  return best || findStage(R, POIS[0] ? POIS[0].x : 0, POIS[0] ? POIS[0].z : 0, 30, 100, 30);
}
/** local frame on a stage: f = forward, r = right, h = height above ground */
function frame(S, hd) {
  const fx = Math.sin(hd), fz = Math.cos(hd);
  return {
    S, hd, fx, fz,
    pt: (f, r = 0, h = 0) => { const x = S.x + fx * f + fz * r, z = S.z + fz * f - fx * r; return V3(x, gy(x, z) + h, z); },
  };
}
const facing = (fr) => Math.atan2(-fr.fx, -fr.fz);
const orb = (c, ang, rad, h) => V3(c.x + Math.sin(ang) * rad, c.y + h, c.z + Math.cos(ang) * rad);
const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _n = new THREE.Vector3(), _t = new THREE.Vector3(), _a = new THREE.Vector3(), _bd = new THREE.Vector3();
const AX = V3(1, 0, 0), AY = V3(0, 1, 0), AZ = V3(0, 0, 1), DOWN = V3(0, -1, 0);

// ===================== free-fall / canopy poses (same maths as lib/dropship.js) =====================
const POSE_FREE = { chestX: 0.18, headX: 0.75, thighX: -0.32, thighZ: 0.3, shinX: -0.85, u: [0.96, 0.1, -0.05], f: [0.28, 0.95, -0.12] };
const POSE_CHUTE = { chestX: 0.12, headX: -0.05, thighX: 0.2, thighZ: 0.06, shinX: -0.3, u: [0.2, 0.97, -0.05], f: [0.1, 0.99, -0.05] };
const POSE_FLARE = { chestX: -0.1, headX: -0.1, thighX: 0.95, thighZ: 0.05, shinX: -0.15, u: [0.18, 0.98, -0.05], f: [0.1, 0.99, -0.05] };
function blendPose(a, b, w) {
  const o = { u: [0, 0, 0], f: [0, 0, 0] };
  for (const k of ['chestX', 'headX', 'thighX', 'thighZ', 'shinX']) o[k] = lerp(a[k], b[k], w);
  for (const k of ['u', 'f']) for (let i = 0; i < 3; i++) o[k][i] = lerp(a[k][i], b[k][i], w);
  return o;
}
const _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3();
function applyArmPose(u, p, k) {
  u.chest.rotation.x = lerp(u.chest.rotation.x, p.chestX, k);
  u.head.rotation.x = lerp(u.head.rotation.x, p.headX, k);
  for (const [leg, s] of [[u.legL, -1], [u.legR, 1]]) {
    leg.thigh.rotation.x = lerp(leg.thigh.rotation.x, p.thighX, k);
    leg.thigh.rotation.z = lerp(leg.thigh.rotation.z, s * p.thighZ, k);
    leg.shin.rotation.x = lerp(leg.shin.rotation.x, p.shinX, k);
  }
  for (const [arm, s] of [[u.armL, -1], [u.armR, 1]]) {
    _q1.setFromUnitVectors(DOWN, _v1.set(s * p.u[0], p.u[1], p.u[2]).normalize());
    _v2.set(s * p.f[0], p.f[1], p.f[2]).normalize().applyQuaternion(_q2.copy(_q1).invert());
    _q3.setFromUnitVectors(DOWN, _v2);
    arm.shoulder.quaternion.slerp(_q1, k);
    arm.elbow.quaternion.slerp(_q3, k);
  }
}

// ===================== custom body animation (runs AFTER the stock humanoid animation) =====================
// Joint targets: py/pz = hips position, rx/ry/rz = hips rotation, cx/cy/cz = chest, hx/hy/hz = head,
// lt/ls = left thigh/shin, rt/rs = right thigh/shin, ltz/rtz = thigh splay.  +x on hips/chest = lean BACK, -x = lean forward.
const envl = (k, d, a, b) => Math.min(sst(k / a), sst((d - k) / b));
function setPose(a, w, o) {
  const u = a.ud, H = u.hips, C = u.chest, Hd = u.head, L = u.legL, R = u.legR;
  const m = (obj, key, v) => { if (v !== undefined) obj[key] += (v - obj[key]) * w; };
  m(H.position, 'y', o.py); m(H.position, 'z', o.pz);
  m(H.rotation, 'x', o.rx); m(H.rotation, 'y', o.ry); m(H.rotation, 'z', o.rz);
  m(C.rotation, 'x', o.cx); m(C.rotation, 'y', o.cy); m(C.rotation, 'z', o.cz);
  m(Hd.rotation, 'x', o.hx); m(Hd.rotation, 'y', o.hy); m(Hd.rotation, 'z', o.hz);
  m(L.thigh.rotation, 'x', o.lt); m(L.shin.rotation, 'x', o.ls); m(R.thigh.rotation, 'x', o.rt); m(R.shin.rotation, 'x', o.rs);
  m(L.thigh.rotation, 'z', o.ltz); m(R.thigh.rotation, 'z', o.rtz);
}
function ambient(a, T) {
  if (a.dead) return;
  const u = a.ud, t = T + a.ph;
  if (a.speed < 0.4) { // idle: breathing, weight shift, looking around
    u.chest.rotation.x += Math.sin(t * 1.7) * 0.012;
    u.head.rotation.y += Math.sin(t * 0.55) * (a.ads ? 0.05 : 0.32);
    u.head.rotation.x += Math.sin(t * 0.8 + 1) * 0.04;
    u.hips.rotation.z += Math.sin(t * 0.6) * 0.03;
    u.hips.position.y += Math.sin(t * 1.7) * 0.004;
  } else { // locomotion polish: pelvis sway, counter-twist, banking into turns
    const ph = u.walkPhase, k = clamp(a.speed / 8);
    u.hips.rotation.z += Math.sin(ph) * 0.06 * k - a.turn * 0.05;
    u.hips.rotation.y += Math.sin(ph) * 0.05 * k;
    u.chest.rotation.y += -Math.sin(ph) * 0.14 * k * (a.ads ? 0.3 : 1);
    u.head.rotation.y -= Math.sin(ph) * 0.06 * k;
  }
}
function overlay(a, dt, T) {
  const ac = a.act;
  if (!ac) { ambient(a, T); return; }
  ac.t += dt;
  const k = ac.t, d = ac.dur, x = clamp(k / d), dir = ac.dir || 1;
  switch (ac.name) {
    case 'slide': setPose(a, envl(k, d, 0.1, 0.25), { py: 0.34, rx: 1.0, cx: -0.3, hx: -0.5, lt: 0.35, ls: -0.2, rt: 0.9, rs: -1.8 }); break;
    case 'dive': { // forward combat roll
      const s = Math.sin(PI * x), e = sst((x - 0.04) / 0.92);
      setPose(a, sst(k / 0.06), { py: lerp(HIP_Y, 0.62, Math.pow(s, 0.6)), rx: -2 * PI * e, cx: -0.7 * s, hx: 0.4 * s, lt: 1.9 * s, ls: -2.1 * s, rt: 1.9 * s, rs: -2.1 * s });
      break;
    }
    case 'stagger': {
      const p = Math.sin(PI * Math.pow(x, 0.55));
      setPose(a, p, { rx: 0.16, cx: 0.5, hx: 0.5, rz: 0.14 * dir, lt: 0.5, ls: -0.7, rt: -0.2, rs: -0.4 });
      break;
    }
    case 'dieBack': case 'dieFwd': case 'dieSide': {
      const e1 = sst(k / 0.4), e2 = sst((k - 0.22) / 0.7), fwd = ac.name === 'dieFwd', side = ac.name === 'dieSide';
      const snap = ac.head ? Math.sin(PI * clamp(k / 0.3)) * 0.6 : 0;
      setPose(a, 1, {
        py: lerp(lerp(HIP_Y, 0.52, e1), 0.17, e2), rx: (fwd ? -1.52 : side ? 0.25 : 1.5) * e2 + 0.1 * e1 * (fwd ? -1 : 1), rz: side ? 1.5 * dir * e2 : 0,
        cx: fwd ? -0.25 * e2 : 0.15 * e2, cy: 0.3 * dir * e2, hx: 0.3 * e2 + snap,
        lt: lerp(0.7 * e1, 0.15, e2), ls: lerp(-1.3 * e1, -0.15, e2), rt: lerp(0.3 * e1, -0.1, e2), rs: lerp(-1.0 * e1, -0.2, e2),
      });
      break;
    }
    case 'fly': { // blown off its feet: tumble about the hips, limbs flailing
      ac.ang = (ac.ang || 0) + (ac.rate || 7) * dir * dt;
      const ph = ac.ph || 0;
      setPose(a, 1, { py: HIP_Y + 0.1, rx: ac.ang, rz: Math.sin(k * 3 + ph) * 0.4, cx: Math.sin(k * 6 + ph) * 0.5, hx: Math.sin(k * 5) * 0.4,
        lt: Math.sin(k * 9 + ph) + 0.3, ls: -0.9 - 0.5 * Math.sin(k * 7), rt: -Math.sin(k * 9 + ph) + 0.3, rs: -0.9 - 0.5 * Math.cos(k * 7), ltz: 0.3, rtz: -0.3 });
      break;
    }
    case 'settle': { // end of the tumble: land flat
      const e = sst(x), fin = ac.from >= 0 ? 1.52 : -1.52;
      setPose(a, 1, { py: lerp(HIP_Y + 0.1, 0.17, e), rx: lerp(ac.from, fin, e), rz: 0, cx: 0.1, hx: 0.2, lt: 0.2, ls: -0.3, rt: 0, rs: -0.3 });
      break;
    }
    case 'lunge': { const p = Math.sin(PI * Math.pow(x, 0.7)); setPose(a, p, { py: 0.66, pz: -0.3, cx: -0.28, lt: 0.95, ls: -0.2, rt: -0.45, rs: -0.5 }); break; }
    case 'slam': {
      const up = Math.sin(PI * clamp(x / 0.5)), hit = sst((x - 0.5) / 0.08) * (1 - sst((x - 0.62) / 0.3));
      setPose(a, sst(k / 0.05), { py: HIP_Y + 0.65 * up - 0.3 * hit, cx: 0.25 * up - 1.0 * hit, hx: 0.2 * hit, lt: 0.9 * up + 1.0 * hit, ls: -1.2 * up - 1.4 * hit, rt: 0.5 * up + 0.2 * hit, rs: -1.0 * up - 0.8 * hit });
      break;
    }
    case 'dash': setPose(a, envl(k, d, 0.05, 0.12), { py: 0.78, cx: -0.7, rx: -0.3, hx: 0.5, lt: 1.0, ls: -0.3, rt: -0.9, rs: -1.3 }); break;
    case 'landFlare': setPose(a, Math.max(0.001, 1 - sst(x)), { py: 0.55, lt: 0.9, ls: -1.4, rt: 0.9, rs: -1.4, cx: -0.3 }); break;
    default: break;
  }
  if (!ac.hold && k >= d) a.act = null;
}

// ===================== shared geometry / materials =====================
const G_RING = new THREE.RingGeometry(0.88, 1, 56), G_SPH = new THREE.SphereGeometry(1, 28, 18), G_CYL = new THREE.CylinderGeometry(1, 1, 1, 28, 1, true);
const G_BOX = new THREE.BoxGeometry(1, 1, 1), G_CIRC = new THREE.CircleGeometry(1, 40), G_ARC = new THREE.TorusGeometry(0.9, 0.07, 6, 28, PI);
const mkMat = (color, op = 1, side = THREE.DoubleSide) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, side, fog: false });
const GLASS = new THREE.MeshStandardMaterial({ color: 0x9fc6de, roughness: 0.04, metalness: 0.05, transparent: true, opacity: 0.24, side: THREE.DoubleSide, depthWrite: false });
let DIAMOND = null;
function diamondTex() {
  if (DIAMOND) return DIAMOND;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'); x.strokeStyle = '#fff'; x.lineWidth = 7; x.lineJoin = 'round';
  x.beginPath(); x.moveTo(32, 6); x.lineTo(58, 32); x.lineTo(32, 58); x.lineTo(6, 32); x.closePath(); x.stroke();
  DIAMOND = new THREE.CanvasTexture(c); DIAMOND.colorSpace = THREE.SRGBColorSpace;
  return DIAMOND;
}

// ===================== particles / explosions =====================
function makeFx(scene, tex) {
  const pool = (n, blend) => Array.from({ length: n }, () => {
    const m = new THREE.SpriteMaterial({ map: tex.glow, transparent: true, depthWrite: false, blending: blend, opacity: 0 });
    const s = new THREE.Sprite(m); s.visible = false; scene.add(s);
    return { s, m, life: 0, max: 1, v: new THREE.Vector3(), s0: 1, s1: 2, o: 1, g: 0, drag: 1 };
  });
  const fire = pool(90, THREE.AdditiveBlending), smoke = pool(80, THREE.NormalBlending), spark = pool(150, THREE.AdditiveBlending);
  let fi = 0, si = 0, pi = 0, flash = 0, ringT = 0, ringS = 1;
  const light = new THREE.PointLight(0xffa050, 0, 90, 2); scene.add(light);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 56), new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.visible = false; scene.add(ring);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const emit = (arr, i, x, y, z, vx, vy, vz, s0, s1, life, o, color, g, drag) => {
    const p = arr[i % arr.length];
    p.s.visible = true; p.s.position.set(x, y, z); p.v.set(vx, vy, vz);
    p.s0 = s0; p.s1 = s1; p.max = p.life = life; p.o = o; p.g = g; p.drag = drag; p.m.color.setHex(color);
  };
  return {
    blast(x, y, z, sc = 1) {
      flash = 1; light.position.set(x, y + 2, z);
      for (let i = 0; i < 24; i++) emit(fire, fi++, x + rnd(-1, 1) * sc, y + rnd(0.2, 1.4) * sc, z + rnd(-1, 1) * sc, rnd(-6, 6) * sc, rnd(1, 9) * sc, rnd(-6, 6) * sc, 1.6 * sc, 5.5 * sc, rnd(0.5, 1.2), 0.95, i % 3 ? 0xff7a1a : 0xffd070, -1.5, 1.6);
      for (let i = 0; i < 30; i++) emit(smoke, si++, x + rnd(-1.5, 1.5) * sc, y + rnd(0.5, 2) * sc, z + rnd(-1.5, 1.5) * sc, rnd(-3, 3) * sc, rnd(1, 6) * sc, rnd(-3, 3) * sc, 1.6 * sc, 6.5 * sc, rnd(1.8, 3.6), 0.7, 0x222222, -0.4, 0.8);
      for (let i = 0; i < 40; i++) emit(spark, pi++, x, y + 1, z, rnd(-14, 14) * sc, rnd(2, 18) * sc, rnd(-14, 14) * sc, 0.3, 0.02, rnd(0.6, 1.4), 1, 0xffd27a, 14, 0.4);
      ringT = 1; ringS = sc; ring.position.set(x, y + 0.3, z); ring.visible = true;
    },
    dust(x, y, z, sc = 1) { emit(smoke, si++, x, y, z, rnd(-0.6, 0.6), rnd(0.4, 1.2), rnd(-0.6, 0.6), 0.5 * sc, 2.4 * sc, rnd(0.7, 1.2), 0.35, 0xb59f7a, -0.2, 1.2); },
    burst(x, y, z, color, n = 8, sp = 4, life = 0.6, size = 0.3, up = 0, g = 6) { for (let i = 0; i < n; i++) emit(spark, pi++, x, y, z, rnd(-1, 1) * sp, rnd(-0.3, 1) * sp + up, rnd(-1, 1) * sp, size, size * 0.1, life * rnd(0.6, 1.2), 1, color, g, 1.2); },
    flame(x, y, z, sc = 1) { emit(fire, fi++, x + rnd(-1, 1) * sc, y, z + rnd(-1, 1) * sc, rnd(-0.5, 0.5), rnd(2, 5), rnd(-0.5, 0.5), 1.1 * sc, 0.2, rnd(0.4, 0.8), 0.9, fi % 2 ? 0xff7a1a : 0xffd070, -2.5, 1.3); },
    rise(x, y, z, color, n = 3) { for (let i = 0; i < n; i++) emit(spark, pi++, x + rnd(-0.5, 0.5), y, z + rnd(-0.5, 0.5), rnd(-0.3, 0.3), rnd(1.2, 2.6), rnd(-0.3, 0.3), 0.28, 0.06, rnd(0.7, 1.2), 1, color, -0.5, 0.6); },
    update(dt) {
      for (const arr of [fire, smoke, spark]) {
        for (const p of arr) {
          if (p.life <= 0) continue;
          p.life -= dt;
          if (p.life <= 0) { p.s.visible = false; continue; }
          const k = 1 - p.life / p.max;
          p.v.y -= p.g * dt; p.v.multiplyScalar(Math.max(0, 1 - p.drag * dt));
          p.s.position.addScaledVector(p.v, dt);
          const z = lerp(p.s0, p.s1, k); p.s.scale.set(z, z, 1);
          p.m.opacity = p.o * Math.pow(1 - k, 1.4);
        }
      }
      flash = Math.max(0, flash - dt * 2.2); light.intensity = flash * 1400;
      if (ringT > 0) {
        ringT = Math.max(0, ringT - dt * 1.6);
        const s = 1 + (1 - ringT) * 18 * ringS; ring.scale.set(s, s, s); ring.material.opacity = ringT * 0.7;
        if (ringT === 0) ring.visible = false;
      }
    },
  };
}

// ===================== props: parachute, transport plane, GLB aircraft =====================
function makeChute(scene) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 32;
  const g = c.getContext('2d');
  for (let i = 0; i < 16; i++) { g.fillStyle = i % 2 ? '#f1ead8' : '#ff8a2b'; g.fillRect((i * 512) / 16, 0, 512 / 16 + 1, 32); g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect((i * 512) / 16, 0, 2, 32); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  const mat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.85, side: THREE.DoubleSide });
  const group = new THREE.Group(); group.add(new THREE.Mesh(new THREE.SphereGeometry(1, 28, 12, 0, PI * 2, 0, PI / 2), mat));
  const geo = new THREE.BufferGeometry(), arr = new Float32Array(16 * 6); geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xe8e8e8, transparent: true, opacity: 0.8 })); lines.frustumCulled = false;
  scene.add(group, lines); group.visible = false; lines.visible = false;
  const eu = new THREE.Euler(), tmp = new THREE.Vector3();
  return {
    show() { group.visible = true; lines.visible = true; },
    hide() { group.visible = false; lines.visible = false; },
    place(p, yaw, bank, u, collapse = 0) {
      const e = sst(u), over = 1 + Math.sin(clamp(u) * PI) * 0.1;
      const sxz = lerp(0.18, 1, e) * lerp(1, 1.35, collapse), sy = lerp(0.12, 1, e) * over * (1 - collapse * 0.93);
      group.scale.set(5.4 * sxz, 2.6 * sy, 5.4 * sxz);
      const lineLen = lerp(1.2, 7.6, e), cos = Math.cos(yaw), sin = Math.sin(yaw);
      eu.set(-bank * 0.1, yaw, bank * 0.22, 'YXZ'); group.quaternion.setFromEuler(eu);
      const back = (1 - e) * 0.35;
      group.position.set(p.x + sin * back, p.y + HIP_Y + 0.5 + lineLen, p.z + cos * back);
      if (collapse > 0) group.position.y = lerp(group.position.y, p.y + 0.4, collapse);
      group.updateMatrixWorld(true);
      const rx = cos, rz = -sin;
      for (let i = 0; i < 16; i++) {
        const ang = (i / 16) * PI * 2, side = Math.cos(ang) > 0 ? 1 : -1;
        tmp.set(Math.cos(ang), 0, Math.sin(ang)); group.localToWorld(tmp);
        arr[i * 6] = tmp.x; arr[i * 6 + 1] = tmp.y; arr[i * 6 + 2] = tmp.z;
        arr[i * 6 + 3] = p.x + rx * side * 0.22; arr[i * 6 + 4] = p.y + HIP_Y + 0.5; arr[i * 6 + 5] = p.z + rz * side * 0.22;
      }
      geo.attributes.position.needsUpdate = true;
      group.visible = true; lines.visible = collapse < 0.6;
    },
  };
}
/** stand-in for the hot-drop transport (lib/dropship.js does not export its model) */
function makeTransport(accent = 0xff8a2b) {
  const g = new THREE.Group(); g.rotation.order = 'YXZ';
  const S = (c, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.7, metalness: 0.3 }, o));
  const hull = S(0x5a6455, { side: THREE.DoubleSide }), dark = S(0x24282c, { metalness: 0.5 }), steel = S(0x9aa1a8, { roughness: 0.35, metalness: 0.8 });
  const acc = S(accent, { roughness: 0.6, metalness: 0.1 }), glass = S(0x9fd0ff, { transparent: true, opacity: 0.4, roughness: 0.1 });
  const lit = new THREE.MeshBasicMaterial({ color: 0xffe2a8 }), blur = new THREE.MeshBasicMaterial({ color: 0xcfd3d6, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false });
  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, parent = g) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); parent.add(m); return m; };
  const box = (w, h, d, mat, x, y, z, parent, rx, ry, rz) => add(new THREE.BoxGeometry(w, h, d), mat, x, y, z, rx, ry, rz, parent);
  add(new THREE.CylinderGeometry(1.5, 1.5, 10, 28, 1, true), hull, 0, 1.6, -0.4, PI / 2);
  add(new THREE.CylinderGeometry(0.45, 1.5, 3.8, 28), hull, 0, 1.6, -7.2, -PI / 2);
  add(new THREE.SphereGeometry(0.62, 16, 10, 0, PI * 2, 0, PI / 2), glass, 0, 2.2, -8.1, -0.65);
  box(2.9, 0.12, 10, dark, 0, 0.45, -0.4);
  box(2.6, 2.3, 0.1, lit, 0, 1.7, -5.3);
  box(0.3, 0.05, 8, lit, 0, 2.95, -0.4);
  box(1.3, 1.5, 5.2, hull, 0, 2.6, 6.2, undefined, -0.2); box(0.16, 3.4, 2.6, acc, 0, 4.7, 8.2, undefined, -0.18); box(5.4, 0.14, 1.6, hull, 0, 6.2, 8.6);
  const props = [];
  for (const s of [-1, 1]) {
    box(8.6, 0.26, 3.2, hull, s * 6.0, 3.15, -0.6); box(0.5, 0.3, 3.2, acc, s * 10.0, 3.15, -0.6);
    add(new THREE.CylinderGeometry(0.46, 0.5, 2.8, 14), hull, s * 4.6, 2.55, -1.2, PI / 2);
    add(new THREE.ConeGeometry(0.24, 0.55, 12), steel, s * 4.6, 2.55, -2.9, -PI / 2);
    const p = new THREE.Group(); p.position.set(s * 4.6, 2.55, -3.25); g.add(p);
    for (const r of [0, PI / 3, (2 * PI) / 3]) box(0.17, 2.1, 0.03, dark, 0, 0, 0, p, 0, 0, r);
    add(new THREE.CircleGeometry(1.05, 24), blur, 0, 0, 0, 0, 0, 0, p);
    props.push(p);
  }
  box(0.6, 0.02, 6.5, acc, 0, 3.12, -0.6);
  box(0.3, 0.1, 0.1, new THREE.MeshBasicMaterial({ color: 0x35ff66 }), 0, 2.7, 4.5);
  const ramp = new THREE.Group(); ramp.position.set(0, 0.45, 4.6); g.add(ramp);
  box(2.6, 0.12, 3.2, dark, 0, -0.06, 1.6, ramp); box(2.4, 0.02, 0.2, new THREE.MeshBasicMaterial({ color: 0xe9b520 }), 0, 0, 3.0, ramp);
  ramp.rotation.x = -PI / 2;
  g.visible = false;
  return { root: g, ramp, props, kind: 'transport', nodes: {}, spin: 0 };
}
const gltf = new GLTFLoader();
function loadGLB(url, ms = 9000) {
  return new Promise((res) => {
    let done = false;
    const to = setTimeout(() => { if (!done) { done = true; res(null); } }, ms);
    gltf.load(url, (g) => { if (done) return; done = true; clearTimeout(to); res(g.scene); }, undefined, () => { if (!done) { done = true; clearTimeout(to); res(null); } });
  });
}
function splitGlass(root, cols) {
  const jobs = [];
  root.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; if (o.geometry && o.geometry.getAttribute('color')) jobs.push(o); } });
  const near = (c, i, g) => Math.abs(c.getX(i) - g[0]) < 0.012 && Math.abs(c.getY(i) - g[1]) < 0.012 && Math.abs(c.getZ(i) - g[2]) < 0.012;
  for (const mesh of jobs) {
    const geo = mesh.geometry, col = geo.getAttribute('color'), idx = geo.index ? geo.index.array : null;
    const n = idx ? idx.length : geo.getAttribute('position').count, gl = [], body = [];
    for (let i = 0; i < n; i += 3) {
      const a = idx ? idx[i] : i, b = idx ? idx[i + 1] : i + 1, c = idx ? idx[i + 2] : i + 2;
      (cols.some((g) => near(col, a, g) && near(col, b, g) && near(col, c, g)) ? gl : body).push(a, b, c);
    }
    if (!gl.length) continue;
    const mk = (arr) => { const ng = new THREE.BufferGeometry(); for (const k in geo.attributes) ng.setAttribute(k, geo.attributes[k]); ng.setIndex(arr); return ng; };
    mesh.geometry = mk(body);
    const gm = new THREE.Mesh(mk(gl), GLASS); gm.renderOrder = 4; gm.position.copy(mesh.position); gm.quaternion.copy(mesh.quaternion); gm.scale.copy(mesh.scale);
    mesh.parent.add(gm);
  }
}
function fallbackModel(kind) {
  const g = new THREE.Group(), mk = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 });
  const box = (w, h, d, x, y, z, c) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mk(c)); m.position.set(x, y, z); g.add(m); return m; };
  if (kind === 'plane') {
    box(1.2, 1.2, 7, 0, 1.3, -1, 0xe8e8ec); box(10.6, 0.15, 1.6, 0, 1.0, -0.3, 0xe8e8ec); box(3.4, 0.12, 1.0, 0, 1.6, -4.5, 0xe8e8ec); box(0.12, 1.2, 1.0, 0, 2.2, -4.5, 0xb32d2d);
    const p = new THREE.Group(); p.name = 'propeller'; p.position.set(0, 1.28, 2.62); p.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.7, 0.1), mk(0x1b1c20))); g.add(p);
  } else {
    box(1.7, 1.6, 5.5, 0, 1.6, 1.2, 0x8fa3b3); box(0.5, 0.6, 5, 0, 2.3, -4.5, 0x5a7ea3);
    const r = new THREE.Group(); r.name = 'rotor-main'; r.position.set(0, 3.8, 0); r.add(new THREE.Mesh(new THREE.BoxGeometry(7.9, 0.06, 0.3), mk(0x1b1c20))); g.add(r);
    const t = new THREE.Group(); t.name = 'rotor-tail'; t.position.set(0.3, 2.13, -6.43); t.add(new THREE.Mesh(new THREE.BoxGeometry(0.06, 1.5, 0.2), mk(0x1b1c20))); g.add(t);
  }
  return g;
}
function wrapAircraft(scene, model, kind) {
  const pivot = new THREE.Group(); pivot.rotation.y = PI; pivot.add(model); // the GLBs have their nose on +Z
  const root = new THREE.Group(); root.rotation.order = 'YXZ'; root.add(pivot); root.visible = false; scene.add(root);
  const nodes = {}; model.traverse((o) => { if (o.name) nodes[o.name] = o; });
  return { root, nodes, kind, spin: 0 };
}
function poseAir(p, x, y, z, yaw, pitch = 0, roll = 0) { p.root.position.set(x, y, z); p.root.rotation.set(pitch, yaw, roll, 'YXZ'); p.root.visible = true; }
function spinProps(tr, dt) { for (const p of tr.props) p.rotation.z += 32 * dt; }
function animAir(p, dt, gear = 1) {
  const N = p.nodes, set = (n, k, v) => { if (N[n]) N[n].rotation[k] = v; };
  p.spin += 21 * dt;
  if (p.kind === 'plane') {
    set('propeller', 'z', p.spin);
    const rt = 1 - gear, door = Math.sin(PI * clamp(rt)) * 1.1;
    set('gear-main-l', 'z', -rt * 1.45); set('gear-main-r', 'z', rt * 1.45); set('gear-nose', 'x', rt * 1.5);
    for (const n of ['gear-door-main-l-fwd', 'gear-door-main-l-aft']) set(n, 'z', -door);
    for (const n of ['gear-door-main-r-fwd', 'gear-door-main-r-aft']) set(n, 'z', door);
  } else { set('rotor-main', 'y', p.spin * 1.3); set('rotor-tail', 'x', p.spin * 2.8); }
}

// ===================== score + voice-over (WebAudio, routed through the game's master bus) =====================
function buildAudio(c, out, lines) {
  const bus = c.createGain(); bus.connect(out);
  const mg = c.createGain(); mg.gain.value = 0.85; mg.connect(bus);
  const conv = c.createConvolver();
  { const n = Math.floor(c.sampleRate * 2.2), ir = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.8); }
    conv.buffer = ir; }
  const rv = c.createGain(); rv.gain.value = 0.5; rv.connect(conv); conv.connect(mg);
  const nb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
  { const d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const t0 = c.currentTime + 0.45, at = (t) => t0 + t;
  const route = (node, wet) => { node.connect(mg); if (wet > 0) { const w = c.createGain(); w.gain.value = wet; node.connect(w); w.connect(rv); } };
  function tone({ type = 'sawtooth', f, f2, t, a = 0.01, d = 0.3, g = 0.2, lp = 0, det = 0, wet = 0.2 }) {
    const osc = c.createOscillator(); osc.type = type; osc.detune.value = det;
    osc.frequency.setValueAtTime(f, at(t));
    if (f2) osc.frequency.exponentialRampToValueAtTime(f2, at(t) + a + d);
    const e = c.createGain();
    e.gain.setValueAtTime(0.0001, at(t)); e.gain.linearRampToValueAtTime(g, at(t) + a); e.gain.exponentialRampToValueAtTime(0.0001, at(t) + a + d);
    let n = osc;
    if (lp) { const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp; osc.connect(fl); n = fl; }
    n.connect(e); route(e, wet); osc.start(at(t)); osc.stop(at(t) + a + d + 0.1);
  }
  function noise({ t, d = 0.3, g = 0.3, type = 'lowpass', f = 800, f2 = 0, q = 0.7, wet = 0.2, a = 0.002 }) {
    const s = c.createBufferSource(); s.buffer = nb; s.loop = true;
    const fl = c.createBiquadFilter(); fl.type = type; fl.Q.value = q; fl.frequency.setValueAtTime(f, at(t));
    if (f2) fl.frequency.exponentialRampToValueAtTime(Math.max(20, f2), at(t) + a + d);
    const e = c.createGain();
    e.gain.setValueAtTime(0.0001, at(t)); e.gain.exponentialRampToValueAtTime(Math.max(g, 0.0002), at(t) + a); e.gain.exponentialRampToValueAtTime(0.0001, at(t) + a + d);
    s.connect(fl); fl.connect(e); route(e, wet); s.start(at(t), Math.random() * 1.5); s.stop(at(t) + a + d + 0.1);
  }
  const boom = (t, p = 1) => {
    tone({ type: 'sine', f: 95, f2: 28, t, a: 0.004, d: 1.7, g: 0.95 * p, wet: 0.45 });
    noise({ t, d: 1.8, g: 0.8 * p, f: 1400, f2: 60, wet: 0.55 });
    tone({ type: 'triangle', f: 55, t, a: 0.01, d: 2.4, g: 0.45 * p, wet: 0.4 });
  };
  const kick = (t, g = 0.55) => tone({ type: 'sine', f: 150, f2: 44, t, a: 0.002, d: 0.22, g, wet: 0.05 });
  const snare = (t, g = 0.35) => { noise({ t, d: 0.2, g, type: 'bandpass', f: 1900, q: 0.8, wet: 0.35 }); tone({ type: 'triangle', f: 210, f2: 140, t, a: 0.002, d: 0.1, g: g * 0.6, wet: 0.2 }); };
  const hat = (t, g = 0.07) => noise({ t, d: 0.05, g, type: 'highpass', f: 7000, wet: 0.02 });
  const whoosh = (t) => noise({ t, a: 0.3, d: 0.3, g: 0.14, type: 'bandpass', f: 400, f2: 5000, q: 0.9, wet: 0.35 });
  const riser = (t, dur, g = 0.3) => {
    noise({ t, d: dur * 0.1, a: dur * 0.9, g, type: 'bandpass', f: 300, f2: 9000, q: 1.2, wet: 0.3 });
    tone({ type: 'sawtooth', f: 90, f2: 1400, t, a: dur * 0.9, d: dur * 0.1, g: g * 0.35, lp: 3000, wet: 0.3 });
  };
  const stab = (t, notes, d, g) => notes.forEach((f) => {
    for (const det of [-9, 0, 9]) tone({ type: 'sawtooth', f, t, a: 0.03, d, g, lp: 1500, det, wet: 0.5 });
    tone({ type: 'sawtooth', f: f * 2, t, a: 0.05, d, g: g * 0.5, lp: 2600, wet: 0.5 });
  });
  const beat = (t) => { tone({ type: 'sine', f: 58, f2: 40, t, d: 0.18, g: 0.8, wet: 0.1 }); tone({ type: 'sine', f: 58, f2: 40, t: t + 0.18, d: 0.18, g: 0.55, wet: 0.1 }); };

  const CH = { Dm: [146.8, 174.6, 220], Bb: [116.5, 146.8, 174.6], Gm: [98, 116.5, 146.8], A: [110, 138.6, 164.8] };
  const NAMES = ['Dm', 'Bb', 'Gm', 'A'], ROOT = [73.4, 58.3, 49, 55], PAT = [0, 0, 7, 0, 3, 0, 7, 12];
  const rootIdx = (t) => { let k = 0; for (let i = 0; i < HITS.length; i++) if (t >= HITS[i]) k = i; return k % 4; };
  // events are scheduled lazily (about 1.5 s ahead) so a phone never has to build thousands of nodes at once
  const E = [], ev = (t, fn) => E.push({ t, fn });
  const si = TM.silence.t0, ch = TM.charge;
  ev(0, () => { tone({ f: 36.7, t: 0, a: 5, d: 1.4, g: 0.3, lp: 140, wet: 0.3 }); tone({ f: 55, t: 0, a: 5, d: 1.4, g: 0.18, lp: 200, wet: 0.3 }); riser(1.8, 4.0, 0.32); });
  HITS.forEach((h, i) => {
    if (h > 8 && h < si) ev(h - 2.2, () => riser(h - 2.2, 2.2, 0.24));
    ev(h, () => {
      boom(h, h === ch.t0 || h === TM.title.t0 ? 1.4 : 1);
      if (h === TM.title.t0) { tone({ f: 36.7, t: h, a: 0.5, d: 7, g: 0.35, lp: 160, wet: 0.4 }); stab(h + 0.6, [293.7, 349.2, 440], 6, 0.035); }
      else stab(h, CH[NAMES[i % 4]], 2.6, 0.05);
    });
  });
  PLAN.forEach(([n], i) => { if (i > 0 && n !== 'silence' && n !== 'title') { const w = TM[n].t0 - 0.25; ev(w, () => whoosh(w)); } });
  { let k = 0;
    for (let t = TM.plane.t0; t < si - 0.3; k++) {
      const tt = t, kk = k, r = ROOT[rootIdx(tt)], k01 = (tt - TM.plane.t0) / (si - TM.plane.t0);
      ev(tt, () => tone({ f: r * Math.pow(2, PAT[kk % 8] / 12), t: tt, a: 0.005, d: tt < TM.prim.t0 ? 0.22 : 0.1, g: 0.05 + 0.1 * k01, lp: 350 + 2200 * k01, wet: 0.12 }));
      t += tt < TM.prim.t0 ? 0.25 : 0.125;
    } }
  for (let t = TM.freefall.t0; t < si - 0.3; t += 0.5) ev(t, () => kick(t));
  for (let t = TM.contact.t0 + 0.5; t < si - 0.3; t += 1) ev(t, () => snare(t));
  for (let t = TM.guns.t0; t < si - 0.3; t += 0.25) ev(t, () => hat(t));
  [0.8, 1.85, 2.9].forEach((o) => ev(si + o, () => beat(si + o)));
  { let k = 0;
    for (let t = ch.t0; t < ch.t1 - 0.3; t += 0.125, k++) { const tt = t, kk = k; ev(tt, () => tone({ f: 73.4 * Math.pow(2, PAT[kk % 8] / 12), t: tt, a: 0.004, d: 0.1, g: 0.17, lp: 3000, wet: 0.12 })); } }
  for (let t = ch.t0; t < ch.t1 - 0.3; t += 0.5) ev(t, () => kick(t, 0.65));
  for (let t = ch.t0 + 0.5; t < ch.t1 - 0.3; t += 1) ev(t, () => snare(t, 0.4));
  ev(ch.t1 - 2.8, () => riser(ch.t1 - 2.8, 2.6, 0.38));
  E.sort((a, b) => a.t - b.t);
  let ei = 0;

  // voice-over (+ music ducking)
  const voSrc = [];
  for (const l of [...lines].sort((a, b) => a.at - b.at)) {
    if (!l.buf) continue;
    const s = c.createBufferSource(); s.buffer = l.buf;
    const g = c.createGain(); g.gain.value = l.gain != null ? l.gain : 1;
    let n = s;
    if (l.voice === 'radio') {
      const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 480;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3400;
      s.connect(hp); hp.connect(lp); n = lp;
    }
    n.connect(g); g.connect(bus); s.start(at(l.at)); voSrc.push(s);
    mg.gain.setTargetAtTime(0.42, at(l.at) - 0.12, 0.06);
    mg.gain.setTargetAtTime(0.85, at(l.at) + l.buf.duration + 0.1, 0.3);
  }
  return {
    ctx: c, t0,
    update() { const lim = c.currentTime - t0 + 1.6; while (ei < E.length && E[ei].t <= lim) { try { E[ei].fn(); } catch (_) {} ei++; } },
    stop() {
      try { bus.gain.setTargetAtTime(0, c.currentTime, 0.05); } catch (_) {}
      voSrc.forEach((s) => { try { s.stop(); } catch (_) {} });
      setTimeout(() => { try { bus.disconnect(); } catch (_) {} }, 400);
    },
  };
}
function silentLoop() { // keeps the iOS audio session in "playback" so the silent switch does not mute WebAudio
  const n = 4410, b = new DataView(new ArrayBuffer(44 + n * 2)), w = (o, s) => { for (let i = 0; i < s.length; i++) b.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); b.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
  b.setUint32(24, 44100, true); b.setUint32(28, 88200, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); w(36, 'data'); b.setUint32(40, n * 2, true);
  const url = URL.createObjectURL(new Blob([b.buffer], { type: 'audio/wav' })), el = new Audio(url);
  el.loop = true; el.volume = 0.01; el.play().catch(() => {});
  return { el, url };
}
function overlayAt(t) { // [colour, alpha] of the full-screen fade
  const si = TM.silence.t0, ch = TM.charge;
  if (t < 0) return ['#000', 1];
  if (t < 1.8) return ['#000', 1 - sst(t / 1.8)];
  if (t >= si - 0.3 && t < si) return ['#000', sst((t - (si - 0.3)) / 0.3)];
  if (t >= si && t < ch.t0 - 0.05) return ['#000', 1];
  if (t >= ch.t1 - 1.1 && t < ch.t1) return ['#fff', sst((t - (ch.t1 - 1.1)) / 1.1)];
  if (t >= ch.t1) return ['#000', 1];
  return ['#000', 0];
}

// ===================== director =====================
export function createTrailer(o) {
  const { scene, camera, tex, audio, bullets, vehicles, world, gfx, makeHumanoid, playerMesh, viewmodel } = o;
  const R = rng(20261112);
  const fx = makeFx(scene, tex);
  const actors = [], A = [], B = [], cars = {}, later = [], timed = [], chutes = [];
  const P = { transport: null, plane: null, heli: null };
  let active = false, ready = false, T = 0, gs = 0, shotIdx = -1, shake = 0, hitIdx = 0, waitT = 0;
  let stages = null, shots = [], saved = null, ui = null, music = null, vo = [], tb = null, audioCtx = null, silent = null, voMissing = 0, callEx = null;
  const cam = { p: new THREE.Vector3(), l: new THREE.Vector3(), fov: 40, roll: 0 };
  const fakePlayer = { x: 0, y: 0, z: 0, alive: false, hp: 100, inVehicle: false };
  const W = (id) => (ALL[id] ? id : 'vanguard');
  const sfx = (n, v = 1, x = {}) => { try { audio.play(n, null, null, Object.assign({ vol: v }, x)); } catch (_) {} };
  const delay = (sec, fn) => later.push({ t: gs + sec, fn });
  const call = (name, sub = '', dur = 1.4) => { callEx = { name, sub, until: T + dur }; };
  const gnd = (a) => (a.fy == null ? gy(a.x, a.z) : a.fy);

  // ---------- timed visuals ----------
  const addT = (obj, dur, fn, own) => { scene.add(obj); const e = { obj, t: 0, dur, fn, own, pulse: 0 }; timed.push(e); return e; };
  const rmT = (e) => { scene.remove(e.obj); if (e.obj.material) e.obj.material.dispose(); if (e.own && e.obj.geometry) e.obj.geometry.dispose(); };
  function stepTimed(dt) {
    for (let i = timed.length - 1; i >= 0; i--) {
      const e = timed[i]; e.t += dt; const k = e.t / e.dur;
      if (k >= 1) { rmT(e); timed.splice(i, 1); continue; }
      e.pulse = Math.max(0, e.pulse - dt * 4);
      if (e.fn) e.fn(k, e.obj, dt, e);
    }
  }
  function clearTimed() { for (const e of timed) rmT(e); timed.length = 0; }
  const ringFx = (x, y, z, color, maxR, dur, flat = true) => {
    const m = new THREE.Mesh(G_RING, mkMat(color, 0.9)); m.position.set(x, y, z);
    if (flat) m.rotation.x = -PI / 2; else m.lookAt(cam.p);
    return addT(m, dur, (k, ob) => { const s = lerp(0.3, maxR, 1 - Math.pow(1 - k, 2.2)); ob.scale.set(s, s, s); ob.material.opacity = 0.9 * (1 - k); });
  };
  const beamFx = (p0, p1, color, w, dur, through = false) => {
    const m = new THREE.Mesh(G_BOX, mkMat(color, 1)); _bd.subVectors(p1, p0);
    const len = _bd.length() || 0.01; m.position.copy(p0).addScaledVector(_bd, 0.5); m.quaternion.setFromUnitVectors(AZ, _bd.normalize()); m.scale.set(w, w, len);
    if (through) { m.material.depthTest = false; m.renderOrder = 10; }
    return addT(m, dur, (k, ob) => { ob.material.opacity = 1 - k; const s = w * (1 - 0.7 * k); ob.scale.x = s; ob.scale.y = s; });
  };
  const ropeFx = (a, end, dur) => {
    const m = new THREE.Mesh(G_BOX, mkMat(0xe8e2cc, 1));
    return addT(m, dur, (k, ob) => {
      _a.set(a.x, gnd(a) + 1.3, a.z); _bd.subVectors(end, _a); const len = _bd.length() || 0.01;
      ob.position.copy(_a).addScaledVector(_bd, 0.5); ob.quaternion.setFromUnitVectors(AZ, _bd.normalize()); ob.scale.set(0.035, 0.035, len);
      ob.material.opacity = k > 0.85 ? (1 - k) / 0.15 : 1;
    });
  };
  const domeFx = (a, color, dur) => addT(new THREE.Mesh(G_SPH, mkMat(color, 0.2)), dur, (k, ob, dt, e) => {
    ob.position.set(a.x, gnd(a) + 1.0, a.z); ob.scale.setScalar(1.45 * sst(k / 0.08));
    ob.material.opacity = (0.16 + e.pulse * 0.45 + 0.04 * Math.sin(k * 90)) * (1 - sst((k - 0.85) / 0.15));
  });
  const markerFx = (a, color, dur) => {
    const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: diamondTex(), color, transparent: true, depthTest: false, fog: false })); m.renderOrder = 999;
    return addT(m, dur, (k, ob) => { ob.position.set(a.x, gnd(a) + 2.5, a.z); const s = lerp(1.6, 0.9, sst(k / 0.15)); ob.scale.set(s, s, 1); ob.material.opacity = 1 - sst((k - 0.8) / 0.2); });
  };
  const pillarFx = (x, y, z, color, h, dur) => {
    const m = new THREE.Mesh(G_CYL, mkMat(color, 0.4)); m.scale.set(0.45, h, 0.45); m.position.set(x, y + h / 2, z);
    return addT(m, dur, (k, ob) => { ob.rotation.y += 0.1; ob.material.opacity = 0.4 * (1 - sst((k - 0.8) / 0.2)) * (0.8 + 0.2 * Math.sin(k * 60)); });
  };
  const zoneFx = (x, y, z, r, color, dur) => {
    const m = new THREE.Mesh(G_CIRC, mkMat(color, 0.4)); m.rotation.x = -PI / 2; m.position.set(x, y + 0.06, z); m.scale.set(r, r, r);
    return addT(m, dur, (k, ob) => {
      ob.material.opacity = (0.3 + 0.12 * Math.sin(k * 70)) * (1 - sst((k - 0.85) / 0.15));
      for (let i = 0; i < 2; i++) { const aa = Math.random() * 6.283, rr = Math.sqrt(Math.random()) * r; fx.flame(x + Math.cos(aa) * rr, y + 0.1, z + Math.sin(aa) * rr, 0.6); }
    });
  };
  const waveFx = (p, d, speed, dur) => {
    const m = new THREE.Mesh(G_ARC, mkMat(0x5ad8ff, 0.85)); m.quaternion.setFromUnitVectors(AZ, d); m.position.copy(p); m.scale.setScalar(1.2);
    const dd = d.clone();
    return addT(m, dur, (k, ob, dt) => { ob.position.addScaledVector(dd, speed * dt); ob.material.opacity = 0.85 * (1 - sst((k - 0.7) / 0.3)); });
  };
  const blockProp = (p, w, h, d, hd, dur) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({ color: 0xffffff, map: tex.concrete, roughness: 0.9 }));
    m.position.set(p.x, p.y + h / 2, p.z); m.rotation.y = hd; m.castShadow = true;
    return addT(m, dur, null, true);
  };

  // ---------- actors ----------
  function makeActor(kind, hostile, idx) {
    const mesh = makeHumanoid(tex, kind); mesh.visible = false; scene.add(mesh);
    const ud = mesh.userData;
    const a = {
      mesh, ud, idx, x: 0, z: 0, yaw: 0, pyaw: 0, turn: 0, px: 0, pz: 0, speed: 0, hostile, weapon: 'vanguard', flashes: {}, ph: Math.random() * 6.28,
      b0: [ud.hips.rotation.y, ud.hips.rotation.z, ud.chest.rotation.y, ud.chest.rotation.z, ud.head.rotation.y, ud.head.rotation.z, ud.legL.thigh.rotation.z, ud.legR.thigh.rotation.z],
    };
    resetActor(a); actors.push(a); return a;
  }
  function resetActor(a) {
    a.dead = false; a.rl = false; a.rlT = 0; a.ads = false; a.crouch = false; a.init = false; a.speed = 0; a.fy = null; a.bal = null; a.pitch = 0; a.nf = 0; a.cut = -1;
    a.act = null; a.free = null; a.air = false; a.fixSpeed = null; a.jv = null; a.hb = 0; a.turn = 0; a.ud.walkPhase = a.idx * 1.7; a.mesh.rotation.set(0, a.yaw, 0);
  }
  const place = (a, p, yaw) => { if (a.dead) return; a.x = p.x; a.z = p.z; a.yaw = yaw; };
  const chest = (a) => V3(a.x, gnd(a) + 1.25, a.z);
  function show(list) { for (const a of actors) { const on = list.includes(a); a.mesh.visible = on; if (on) resetActor(a); } }
  function kit(list, ids) { show(list); list.forEach((a, i) => { a.weapon = W(ids[i % ids.length]); equipNow(a.ud, a.weapon); a.nf = Math.random() * 0.3; }); }
  const act = (a, name, dur, extra) => { if (a.dead || (a.act && a.act.hold)) return; a.act = Object.assign({ name, t: 0, dur }, extra); };
  function actorEvent(a, n, info) {
    if (n === 'toss' && info) bullets.dropMag(info.pos, _n.set(-1.5, 1, 0.3));
    else if (n === 'eject' && info) bullets.ejectShell(info.pos, _n.set(1.2, 1.2, 0));
    else if (n === 'swing') sfx('swing', 0.7);
    else if (n === 'meleeHit') return;
    else sfx(n, 0.7);
  }
  function placeFree(a) {
    const f = a.free; _q1.setFromAxisAngle(AY, a.yaw);
    _q1.multiply(_q2.setFromAxisAngle(AX, f.tilt)).multiply(_q3.setFromAxisAngle(AY, f.twist || 0)).multiply(new THREE.Quaternion().setFromAxisAngle(AZ, f.bank || 0));
    a.mesh.quaternion.copy(_q1); _t.set(0, HIP_Y, 0).applyQuaternion(_q1);
    a.mesh.position.set(a.x - _t.x, gnd(a) + HIP_Y - _t.y, a.z - _t.z);
  }
  function tickActor(a, dt) {
    if (!a.mesh.visible) return;
    const u = a.ud;
    if (a.bal) {
      const b = a.bal; a.x += b.vx * dt; a.z += b.vz * dt; a.fy = (a.fy == null ? gy(a.x, a.z) : a.fy) + b.vy * dt; b.vy -= 18 * dt;
      if (a.fy <= gy(a.x, a.z)) {
        const ang = a.act && a.act.name === 'fly' ? a.act.ang || 0 : 0;
        a.fy = null; a.bal = null; a.act = { name: 'settle', t: 0, dur: 0.5, hold: true, from: wrapA(ang) }; sfx('land', 0.5);
      }
    }
    a.mesh.position.set(a.x, gnd(a), a.z); a.mesh.rotation.set(0, a.yaw, 0);
    const dy = wrapA(a.yaw - a.pyaw); a.turn += (clamp(dy / Math.max(dt, 1e-3), -6, 6) - a.turn) * Math.min(1, dt * 8); a.pyaw = a.yaw;
    const sp = a.init ? Math.hypot(a.x - a.px, a.z - a.pz) / Math.max(dt, 1e-3) : 0;
    a.init = true; a.px = a.x; a.pz = a.z; a.speed += (Math.min(sp, 12) - a.speed) * Math.min(1, dt * 10);
    if (a.fixSpeed != null) a.speed = a.fixSpeed;
    const def = ALL[a.weapon];
    if (a.rl) a.rlT += dt; else a.rlT = 0;
    const b0 = a.b0; // joints the base animation does not rewrite every frame go back to rest first
    u.hips.rotation.y = b0[0]; u.hips.rotation.z = b0[1]; u.chest.rotation.y = b0[2]; u.chest.rotation.z = b0[3]; u.head.rotation.y = b0[4]; u.head.rotation.z = b0[5];
    u.legL.thigh.rotation.z = b0[6]; u.legR.thigh.rotation.z = b0[7];
    updateHumanoidAnim(u, {
      dt, moving: a.speed > 0.4, speed: a.speed, grounded: !(a.air || a.free), ads: a.ads, sprint: a.speed > 5.2, crouch: a.crouch, pitch: a.pitch,
      reloading: a.rl && def.kind === 'gun', reloadT: a.rlT, missing: def.mag || 1, ammo: 1, weapon: a.weapon, dead: a.dead, weaponHidden: !!a.free,
      onEvent: (n, i) => actorEvent(a, n, i), onStep: () => {},
    });
    if (a.free) applyArmPose(u, a.free.p, a.free.k == null ? 1 : a.free.k);
    overlay(a, dt, T);
    if (a.free) placeFree(a);
  }
  function fire(a, tx, ty, tz, spread = 0.012) {
    const w = ensureWeapon(a.ud, a.weapon), m = w && w.muzzle; if (!m) return;
    m.getWorldPosition(_o);
    const def = ALL[a.weapon], np = Math.min(5, def.pellets || 1);
    for (let k = 0; k < np; k++) {
      const sp = np > 1 ? spread * 4 : spread;
      _d.set(tx - _o.x, ty - _o.y, tz - _o.z).normalize();
      _d.x += (Math.random() - 0.5) * sp * 2; _d.y += (Math.random() - 0.5) * sp * 2; _d.z += (Math.random() - 0.5) * sp * 2; _d.normalize();
      bullets.spawn(_o, _d, def.bulletSpeed || 230, a.hostile);
    }
    (a.flashes[a.weapon] || (a.flashes[a.weapon] = bullets.attachFlash(m, 0.55))).fire();
    triggerShootKick(a.ud);
    bullets.ejectShell(_o, _n.set(1.2, 1.2, 0));
    sfx('shot', 0.85, { snd: SND[a.weapon] || a.weapon, enemy: a.hostile });
  }
  /** a shot that is only a glowing beam (ability visuals: phase rounds, shield hits...) */
  function fakeShot(a, tx, ty, tz, color = 0xffc060, w = 0.05, through = false) {
    const wp = ensureWeapon(a.ud, a.weapon), m = wp && wp.muzzle; if (!m) return;
    m.getWorldPosition(_o);
    (a.flashes[a.weapon] || (a.flashes[a.weapon] = bullets.attachFlash(m, 0.55))).fire();
    triggerShootKick(a.ud);
    beamFx(_o, V3(tx, ty, tz), color, w, 0.1, through);
    sfx('shot', 0.8, { snd: SND[a.weapon] || a.weapon, enemy: a.hostile });
  }
  function volley(shooters, targets, s, rate, spread) {
    for (const a of shooters) {
      if (a.dead || !a.mesh.visible || s < a.nf) continue;
      const alive = targets.filter((t) => !t.dead && t.mesh.visible); if (!alive.length) continue;
      const t = alive[Math.floor(Math.random() * alive.length)], p = chest(t);
      fire(a, p.x, p.y, p.z, spread || 0.02);
      const dist = Math.hypot(p.x - a.x, p.z - a.z);
      delay(dist / 260, () => { if (!t.dead) bullets.impact(p, _n.set(0, 0.2, 1).normalize(), 'body'); });
      a.nf = s + rate * (0.7 + Math.random() * 0.6);
    }
  }
  function kill(a, head, style) {
    if (a.dead) return; a.dead = true;
    a.act = { name: style || (head ? 'dieBack' : ['dieBack', 'dieFwd', 'dieSide'][Math.floor(Math.random() * 3)]), t: 0, dur: 1.1, hold: true, dir: Math.random() < 0.5 ? -1 : 1, head: !!head };
    bullets.impact(chest(a), _n.set(0, 0.3, 1).normalize(), 'body'); sfx(head ? 'headshot' : 'hit', 0.9); delay(0.08, () => sfx('death', 0.8));
  }
  function hurt(a, dir, blood = true) {
    if (a.dead || (a.act && a.act.hold)) return;
    a.act = { name: 'stagger', t: 0, dur: 0.5, dir: dir || (Math.random() < 0.5 ? -1 : 1) };
    if (blood) bullets.impact(chest(a), _n.set(0, 0.2, 1).normalize(), 'body');
    sfx('hit', 0.6);
  }
  function launch(a, vx, vy, vz) {
    if (a.bal) return; a.dead = true; a.bal = { vx, vy, vz };
    a.act = { name: 'fly', t: 0, dur: 99, hold: true, rate: 5 + Math.random() * 4, dir: Math.random() < 0.5 ? -1 : 1, ph: Math.random() * 6, ang: 0 };
  }

  // ---------- vehicles (scripted: physics is off until we blow one up) ----------
  const _cm = new THREE.Vector3(), _eu = new THREE.Euler();
  function spawnCar(type, S, off) {
    const v = vehicles.spawnAt({ type, x: S.x + off, z: S.z + off, yaw: 0 }); if (!v) return null;
    v.awake = false; v.inst.driver.visible = true;
    return { v, ty: VEHICLE_TYPES[type], free: false };
  }
  function poseCar(c, x, z, yaw, speed, dt, op) {
    if (!c || c.free) return; op = op || {};
    const v = c.v, ty = c.ty, fx_ = -Math.sin(yaw), fz_ = -Math.cos(yaw);
    v.x = x; v.z = z; v.yaw = yaw; v.y = gy(x, z);
    const pitch = Math.atan2(gy(x + fx_ * 1.6, z + fz_ * 1.6) - gy(x - fx_ * 1.6, z - fz_ * 1.6), 3.2);
    v.q.setFromEuler(_eu.set(pitch, yaw, op.roll || 0, 'YXZ'));
    _cm.set(0, ty.phys.comY, ty.phys.comZ).applyQuaternion(v.q); v.p.set(x, v.y, z).add(_cm);
    v.vel.set(fx_ * speed, 0, fz_ * speed); v.w.set(0, 0, 0); v.steer = op.steer || 0;
    for (const w of v.wh) { w.ang += (speed * dt) / ty.wr; w.om = speed / ty.wr; if (w.front) w.steerAng = op.steer || 0; w.off = 0; }
    v.awake = false; v.sleepT = 0;
  }
  function parkCars(all) { for (const k in cars) { const c = cars[k]; if (c && (all || !c.free) && !c.free) { c.v.x = c.v.z = 40000; c.v.y = 0; } } }
  const dust = (x, z, sc) => fx.dust(x, gy(x, z) + 0.2, z, sc);
  function look(p, l, fov, roll) { cam.p.copy(p); cam.p.y = Math.max(cam.p.y, gy(p.x, p.z) + 0.35); cam.l.copy(l); cam.fov = fov; cam.roll = roll || 0; }
  const showProp = (p) => { if (p && p.root) p.root.visible = true; };
  function hideProps() { for (const k in P) if (P[k] && P[k].root) P[k].root.visible = false; for (const c of chutes) c.hide(); }

  // ---------- shots ----------
  function buildShots() {
    const S = [], st = stages;
    const add = (name, d) => S.push(Object.assign({ name, t0: TM[name].t0, t1: TM[name].t1, s: 0 }, d));
    const guns = ['vanguard', 'stinger', 'breacher', 'longbow', 'ridgeback', 'p9', 'marshal', 'spitfire', 'cutter', 'whisper'];
    const droneId = (Object.values(ALL).find((d) => d.perk === 'drone') || {}).id;
    const lotId = (Object.values(ALL).find((d) => d.perk === 'lottery') || {}).id;

    { // 1. vista (a transport crosses the far sky: foreshadowing)
      const fr = frame(st.vista, 0.7), ya = Math.atan2(-fr.fz, fr.fx);
      add('vista', {
        enter() { kit([A[0], A[1], A[2]], ['vanguard']); A[1].crouch = true; },
        update(s, dt, e, u) {
          place(A[0], fr.pt(0, 0), facing(fr)); place(A[1], fr.pt(-5, 5), facing(fr)); place(A[2], fr.pt(-4, -6), facing(fr));
          look(fr.pt(lerp(-85, -34, 1 - Math.pow(1 - u, 3)), lerp(10, -4, u), lerp(1.2, 15, sst(u))), fr.pt(0, 0, 1.6 + u * 2), lerp(40, 30, u), 0);
          if (P.transport) { const tp = fr.pt(170, lerp(-120, 90, u), 85); poseAir(P.transport, tp.x, tp.y, tp.z, ya, 0, 0.05); spinProps(P.transport, dt); }
        },
      });
    }
    { // 2. the transport opens its ramp and the squad jumps
      const fr = frame(st.air, 1.2), ALT = 140, y0 = gy(st.air.x, st.air.z) + ALT, ya = facing(fr), SP = 58;
      add('plane', {
        enter() { kit(A.slice(0, 4), ['vanguard', 'stinger']); },
        update(s, dt, e, u) {
          const tr = P.transport, f = -70 + SP * s, px = st.air.x + fr.fx * f, pz = st.air.z + fr.fz * f;
          poseAir(tr, px, y0 + Math.sin(s * 0.8) * 0.25, pz, ya, 0.012 * Math.sin(s * 0.6), -0.05); spinProps(tr, dt);
          tr.ramp.rotation.x = lerp(-PI / 2, 0.17, sst((s - 0.3) / 1.5)); tr.root.updateMatrixWorld(true);
          for (let i = 0; i < 4; i++) {
            const a = A[i], tau = s - (2.0 + i * 0.45), lx = i % 2 ? 0.6 : -0.6, lz = 1.0 + i * 0.5;
            if (tau < 0.4) {
              const w = sst(tau / 0.4); _a.set(lerp(lx, 0, w), lerp(0.5, 0.0, w), lerp(lz, 7.6, w)); tr.root.localToWorld(_a);
              a.x = _a.x; a.z = _a.z; a.fy = _a.y; a.yaw = ya + PI; a.fixSpeed = tau < 0 ? 0 : 5;
            } else {
              if (!a.jv) { _a.set(0, -0.1, 7.8); tr.root.localToWorld(_a); a.x = _a.x; a.z = _a.z; a.fy = _a.y; a.jv = { vy: 1.5, t: 0 }; a.free = { tilt: 0, bank: 0, twist: 0, p: POSE_FREE, k: 0 }; a.air = true; a.fixSpeed = 0; }
              const j = a.jv; j.t += dt; j.vy = lerp(j.vy, -30, 1 - Math.exp(-0.7 * dt));
              const h = SP * Math.exp(-0.55 * j.t); a.x += fr.fx * h * dt; a.z += fr.fz * h * dt; a.fy += j.vy * dt; a.yaw = ya;
              const k = sst(j.t / 0.5); a.free.k = k; a.free.tilt = -1.46 * k + Math.sin(j.t * 3 + i) * 0.03 * k; a.free.bank = Math.sin(j.t * 1.7 + i) * 0.12 * k; a.free.twist = 0.3 * Math.sin(j.t * 1.2 + i);
            }
          }
          const ang = sst(u), rx = fr.fz, rz = -fr.fx, cf = lerp(-26, 6, ang), cr = lerp(-15, -30, ang);
          look(V3(px + fr.fx * cf + rx * cr, y0 + lerp(-3, 7, ang), pz + fr.fz * cf + rz * cr), V3(px + fr.fx * lerp(-6, -1, ang), y0 + 1.2, pz + fr.fz * lerp(-6, -1, ang)), lerp(36, 30, u), 0.04 * Math.sin(s));
        },
      });
    }
    { // 3. free-fall, canopies pop
      const fr = frame(st.run, 2.0), ALT0 = 130, OPEN = 2.4, form = [[0, 0], [-3.5, 4], [-3.5, -4], [-7, 0.5]];
      let popped = false;
      const alt = (s) => (s < OPEN ? ALT0 - 31 * s : ALT0 - 31 * OPEN - (7 * (s - OPEN) + 23 * 0.35 * (1 - Math.exp(-(s - OPEN) / 0.35))));
      add('freefall', {
        enter() { popped = false; kit(A.slice(0, 4), ['vanguard']); A.slice(0, 4).forEach((a) => { a.free = { tilt: -1.46, bank: 0, twist: 0, p: POSE_FREE, k: 1 }; a.air = true; a.fixSpeed = 0; }); },
        update(s, dt, e, u) {
          const t = Math.max(0, s - OPEN), cb = sst(t / 0.7), pose = blendPose(POSE_FREE, POSE_CHUTE, cb);
          for (let i = 0; i < 4; i++) {
            const a = A[i], p = fr.pt(form[i][0] + Math.sin(s * 0.9 + i) * 0.6, form[i][1] + Math.cos(s * 0.8 + i * 2) * 0.6);
            a.x = p.x; a.z = p.z; a.fy = gy(p.x, p.z) + alt(s + i * 0.07); a.yaw = facing(fr);
            a.free.p = pose; a.free.tilt = lerp(-1.46 + Math.sin(s * 3 + i) * 0.03, -0.05, cb); a.free.bank = Math.sin(s * 1.5 + i) * lerp(0.12, 0.05, cb); a.free.twist = lerp(0.2 * Math.sin(s * 1.1 + i), 0, cb);
            if (s > OPEN) chutes[i].place(V3(a.x, a.fy, a.z), a.yaw, a.free.bank, sst(t / 0.8), 0); else chutes[i].hide();
          }
          if (s > OPEN && !popped) { popped = true; shake = 1; sfx('thud', 0.9); }
          const lead = V3(A[0].x, A[0].fy + 0.4, A[0].z);
          look(orb(lead, fr.hd + lerp(0.5, 2.6, u), lerp(7, 11, u), lerp(2.6, 5, u)), lead, lerp(52, 40, u), 0.05 * Math.sin(s * 2));
        },
      });
    }
    { // 4. touchdown: flare, absorb, roll, sprint
      const fr = frame(st.run, 2.4), start = [[0, 0], [-3.5, 4], [-3.5, -4], [-7, 0.5]];
      let dived = false;
      add('landing', {
        enter() { dived = false; kit(A.slice(0, 4), ['vanguard', 'stinger']); A.slice(0, 4).forEach((a) => { a.free = { tilt: -0.05, bank: 0, twist: 0, p: POSE_CHUTE, k: 1 }; a.air = true; a.fixSpeed = 0; a.lt = null; }); },
        update(s, dt, e, u) {
          for (let i = 0; i < 4; i++) {
            const a = A[i], ch = chutes[i];
            if (a.lt == null) {
              const f = start[i][0] + 2.4 * Math.min(s, 1.4), p = fr.pt(f, start[i][1]), alt = 15 + i - 12.5 * s;
              if (alt > 0) {
                const fl = alt < 5 ? 1 - alt / 5 : 0;
                a.x = p.x; a.z = p.z; a.fy = gy(p.x, p.z) + alt; a.yaw = facing(fr);
                a.free.p = fl > 0 ? blendPose(POSE_CHUTE, POSE_FLARE, fl) : POSE_CHUTE; a.free.tilt = -0.05 - fl * 0.25;
                ch.place(V3(a.x, a.fy, a.z), a.yaw, 0, 1, 0);
                continue;
              }
              a.lt = s; a.lf = f; a.free = null; a.air = false; a.fixSpeed = null; a.fy = null; act(a, 'landFlare', 0.55); sfx('land', 0.7); dust(p.x, p.z, 2.4);
            }
            const run = s - a.lt - 0.5, p = fr.pt(a.lf + (run > 0 ? 6.5 * run : 0), start[i][1]);
            place(a, p, facing(fr));
            if (s - a.lt < 1) ch.place(V3(a.x, gy(a.x, a.z), a.z), a.yaw, 0, 1, clamp((s - a.lt) / 0.8)); else ch.hide();
            if (i === 1 && run > 0.3 && !dived) { dived = true; act(a, 'dive', 0.9); }
          }
          look(fr.pt(lerp(16, 6, sst(u)), lerp(3.5, 5.5, u), lerp(1.0, 1.8, u)), fr.pt(2.4 * Math.min(s, 1.4) + 6.5 * Math.max(0, s - 1.7), 0, lerp(2.5, 1.3, sst(s / 1.3))), 34, 0);
        },
      });
    }
    { // 5. contact
      const fr = frame(st.fight, 1.0), dies = [1.0, 1.7, 2.3, 3.0];
      let dv = false, hu = false;
      add('contact', {
        enter() { dv = hu = false; kit([...A.slice(0, 4), ...B.slice(0, 4)], ['vanguard', 'stinger', 'p9']); A.slice(0, 4).forEach((a, i) => { a.ads = true; a.crouch = i % 2 === 1; }); },
        update(s) {
          for (let i = 0; i < 4; i++) {
            place(A[i], fr.pt(0, (i - 1.5) * 2.6), facing(fr));
            place(B[i], fr.pt(34 - 5.5 * s, (i - 1.5) * 3 + Math.sin(s * 3 + i) * 1.2), facing(fr) + PI);
            if (!B[i].dead && s > dies[i]) kill(B[i], i === 2);
          }
          if (s > 0.6 && !dv) { dv = true; A[2].crouch = false; act(A[2], 'dive', 0.9); }
          if (s > 2.0 && !hu) { hu = true; hurt(A[1]); }
          volley(A.slice(0, 4), B.slice(0, 4), s, 0.14, 0.02);
          look(fr.pt(-3.2 + s * 0.25, 1.0, 1.75), fr.pt(18, 0, 1.3), 34, 0);
        },
      });
    }
    { // 6. the stock guns: hard cuts
      const fr = frame(st.run, 4.4), cd = 0.6;
      const cams = [
        () => [fr.pt(2.4, 0.4, 0.55), 28, 0, 0], () => [fr.pt(0.3, 1.5, 1.35), 30, 0, 0], () => [fr.pt(-1.8, 0.6, 1.8), 36, 0, 1], () => [fr.pt(3.2, -0.8, 1.3), 34, 0.18, 0],
        () => [fr.pt(1.6, 0.9, 0.15), 24, 0, 0], () => [fr.pt(1.2, 1.4, 3.6), 40, 0, 0], () => [fr.pt(1.1, 0.2, 1.55), 26, 0, 0], () => [fr.pt(7, 3, 2.4), 32, 0, 0],
        () => [fr.pt(0.6, -1.4, 1.2), 30, -0.12, 0], () => [fr.pt(2.0, 0, 2.6), 32, 0.08, 0],
      ];
      add('guns', {
        enter() { kit([A[0]], ['vanguard']); },
        update(s, dt, e) {
          const h = A[0], ci = Math.min(9, Math.floor(e / cd)), ce = e - ci * cd;
          if (ci !== h.cut) {
            h.cut = ci; h.weapon = W(guns[ci]); equipNow(h.ud, h.weapon); h.ads = ci % 2 === 1; h._f = 0; shake = Math.max(shake, 0.4);
            const d0 = ALL[h.weapon]; call(d0.name.toUpperCase(), d0.slot === 'side' ? 'SECONDARY' : 'PRIMARY', cd + 0.04);
          }
          place(h, fr.pt(0, 0), facing(fr));
          const d = ALL[h.weapon], tgt = fr.pt(40, 0, 1.5), n = d.auto ? 4 : 1, gap = d.auto ? 0.07 : 0;
          while (h._f < n && ce > 0.2 + h._f * gap) { fire(h, tgt.x, tgt.y, tgt.z, 0.004); h._f++; }
          const c = cams[ci](); ensureWeapon(h.ud, h.weapon).group.getWorldPosition(_t);
          look(c[0], c[3] ? fr.pt(12, 0, 1.4) : _t.clone(), c[1], c[2]);
        },
      });
    }

    // ---------- ability reels ----------
    const RF = frame(st.reel, 1.9);
    let done = {}, bs = [], cutI = -1, dome = null, waveE = null, mineE = null;
    const once = (k, c, fn) => { if (c && !done[k]) { done[k] = 1; fn(); } };
    const stand = (a, f, r, off = 0) => place(a, RF.pt(f, r), facing(RF) + off);
    const rcam = (cs, cd, p, c, l) => { const k = clamp(cs / cd); look(orb(c, RF.hd + lerp(p[0], p[1], k), lerp(p[2], p[3], k), lerp(p[4], p[5], k)), l || c, lerp(p[6], p[7], k), p[8] || 0); };
    const opChest = () => chest(A[0]);
    const foes = (f, rs, off = PI) => bs.forEach((b, i) => stand(b, f, rs(i), off));
    function cutKit(id, nB) {
      later.length = 0; clearTimed(); done = {}; dome = waveE = mineE = null; chutes.forEach((c) => c.hide());
      bs = B.slice(0, nB); show([A[0], ...bs]);
      A[0].weapon = W(id); equipNow(A[0].ud, A[0].weapon); A[0].nf = 0;
      bs.forEach((b, i) => { b.weapon = 'vanguard'; equipNow(b.ud, 'vanguard'); b.nf = 0.15 + i * 0.08; });
      stand(A[0], 0, 0);
    }
    const REEL = {
      hailstorm: { sub: 'OVERDRIVE', nB: 3,
        go() { ringFx(A[0].x, gnd(A[0]) + 0.1, A[0].z, 0xff8a2b, 3, 0.7); sfx('crossLatch', 1); },
        run(cs) {
          stand(A[0], 0, 0); foes(18, (i) => (i - 1) * 3.6);
          if (cs > 0.2) { volley([A[0]], bs, cs, 0.062, 0.04); if (Math.random() < 0.6) fx.burst(A[0].x, gnd(A[0]) + 0.15, A[0].z, 0xff8a2b, 1, 2.2, 0.5, 0.25, 1.5, -2); }
          once('k0', cs > 0.65, () => kill(bs[0], false)); once('k1', cs > 0.95, () => kill(bs[1], true)); once('k2', cs > 1.25, () => kill(bs[2], false));
          rcam(cs, 1.6, [2.5, 3.9, 3.2, 2.4, 0.5, 1.4, 38, 32], opChest(), RF.pt(10, 0, 1.3));
        } },
      aegis: { sub: 'BARRIER', nB: 3,
        go() { dome = domeFx(A[0], 0x4cc9ff, 1.55); ringFx(A[0].x, gnd(A[0]) + 0.1, A[0].z, 0x4cc9ff, 2.6, 0.6); sfx('crossLatch', 1); },
        run(cs) {
          stand(A[0], 0, 0); foes(16, (i) => (i - 1) * 4);
          bs.forEach((b, i) => {
            if (b.dead || cs < 0.3 + i * 0.05 || cs < b.nf) return;
            b.nf = cs + 0.13 + Math.random() * 0.06;
            const c = opChest(), dx = b.x - c.x, dz = b.z - c.z, l = Math.hypot(dx, dz) || 1, hx = c.x + (dx / l) * 1.4, hy = c.y + (Math.random() - 0.5) * 0.8, hz = c.z + (dz / l) * 1.4;
            fakeShot(b, hx, hy, hz, 0xff7a4a, 0.04); if (dome) dome.pulse = 1; fx.burst(hx, hy, hz, 0x7fe3ff, 3, 3, 0.35, 0.22); sfx('clang', 0.35);
          });
          if (cs > 0.9) volley([A[0]], bs, cs, 0.12, 0.02);
          once('k', cs > 1.3, () => kill(bs[0], false));
          rcam(cs, 1.6, [2.6, 3.4, 3.4, 4.2, 0.9, 1.3, 36, 32], opChest(), RF.pt(8, 0, 1.2));
        } },
      spectre: { sub: 'PHASE ROUNDS', nB: 2,
        go() { blockProp(RF.pt(8, 0), 7, 3, 0.5, RF.hd, 1.7); ringFx(A[0].x, gnd(A[0]) + 0.1, A[0].z, 0xa78bff, 2.4, 0.6); sfx('crossLatch', 1); },
        run(cs) {
          stand(A[0], 0, 0); stand(bs[0], 14, 1.2, PI); stand(bs[1], 16, -2, PI);
          [0.45, 0.85].forEach((t, i) => once('s' + i, cs > t, () => {
            const b = bs[i], c = chest(b), m = opChest(), fe = i ? 16 : 14, k = (8 - 0.6) / (fe - 0.6);
            fakeShot(A[0], c.x, c.y, c.z, 0xa78bff, 0.08, true);
            ringFx(lerp(m.x, c.x, k), lerp(m.y, c.y, k), lerp(m.z, c.z, k), 0xc9b6ff, 1.1, 0.35, false);
            delay(0.12, () => kill(b, i === 0));
          }));
          rcam(cs, 1.6, [1.57, 1.9, 7, 6, 1.2, 1.6, 34, 30], RF.pt(6, 0, 0.8), RF.pt(8, 0, 1.4));
        } },
      sentinel: { sub: 'PULSE SCAN', nB: 3,
        go() { blockProp(RF.pt(7, 0), 8, 3, 0.5, RF.hd, 1.7); ringFx(A[0].x, gnd(A[0]) + 0.15, A[0].z, 0xff7a4a, 44, 0.9); sfx('crossCock', 1); },
        run(cs) {
          stand(A[0], 0, 0); stand(bs[0], 13, 6.2, PI); stand(bs[1], 12, -1.5, PI); stand(bs[2], 16, 2, PI);
          bs.forEach((b, i) => once('m' + i, cs > 0.12 + Math.hypot(b.x - A[0].x, b.z - A[0].z) / 48, () => markerFx(b, 0xff5a3c, 1.5)));
          if (cs > 1.0) volley([A[0]], [bs[0]], cs, 0.1, 0.015);
          once('k', cs > 1.35, () => kill(bs[0], true));
          rcam(cs, 1.6, [2.7, 3.1, 3.0, 2.4, 0.7, 1.1, 34, 30], opChest(), RF.pt(10, 1, 1.8));
        } },
      gale: { sub: 'BLAST JUMP', nB: 3,
        go() {},
        run(cs, dt) {
          const o = A[0]; foes(15, (i) => (i - 1) * 3);
          if (!o.jv && !done.j) stand(o, 0, 0);
          once('j', cs > 0.3, () => {
            o.jv = { vx: RF.fx * 12, vz: RF.fz * 12, vy: 10 }; o.air = true; o.fy = gy(o.x, o.z);
            fx.blast(o.x, o.fy + 0.2, o.z, 0.65); ringFx(o.x, o.fy + 0.2, o.z, 0xbff3ff, 3, 0.5); sfx('shot', 1, { snd: 'breacher' }); shake = 0.8;
          });
          if (o.jv) {
            const j = o.jv; o.x += j.vx * dt; o.z += j.vz * dt; j.vy -= 18 * dt; o.fy += j.vy * dt;
            const g = gy(o.x, o.z);
            if (o.fy <= g && j.vy < 0) { o.fy = null; o.jv = null; o.air = false; act(o, 'landFlare', 0.5); dust(o.x, o.z, 2.4); sfx('land', 0.8); }
          }
          once('f1', cs > 0.85, () => { const c = chest(bs[1]); fire(o, c.x, c.y, c.z, 0.01); delay(0.06, () => kill(bs[1], false)); });
          once('f2', cs > 1.1, () => { const c = chest(bs[0]); fire(o, c.x, c.y, c.z, 0.01); delay(0.06, () => kill(bs[0], true)); });
          rcam(cs, 1.6, [1.6, 2.2, 6.5, 7.5, 0.5, 1.8, 38, 34], chest(o), RF.pt(8, 0, 3));
        } },
      cinder: { sub: 'FIRESTORM', nB: 3,
        go() {},
        run(cs) {
          stand(A[0], 0, 0); const z0 = RF.pt(14, 0);
          bs.forEach((b, i) => { if (cs < 0.55) stand(b, 14 + (i - 1) * 1.2, (i - 1) * 2.4, PI); else if (!b.dead) place(b, RF.pt(14 + Math.sin(cs * 9 + i * 2) * 1.6, (i - 1) * 2.4 + Math.cos(cs * 8 + i) * 1.4), facing(RF) + cs * 3 * (i - 1)); });
          once('fl', cs > 0.2, () => fire(A[0], z0.x, z0.y + 0.5, z0.z, 0.004));
          once('z', cs > 0.5, () => { zoneFx(z0.x, z0.y, z0.z, 4.2, 0xff6a1a, 1.1); fx.blast(z0.x, z0.y, z0.z, 0.6); sfx('shot', 0.9, { snd: 'cutter' }); });
          bs.forEach((b) => { if (cs > 0.6 && !b.dead && cs >= b.hb) { b.hb = cs + 0.28; hurt(b, 0, false); } });
          bs.forEach((b, i) => once('k' + i, cs > 1.15 + i * 0.12, () => kill(b, false, 'dieSide')));
          rcam(cs, 1.6, [0.5, 0.9, 6, 7, 0.5, 1.6, 36, 32], RF.pt(2, 0, 0.5), RF.pt(14, 0, 1.2));
        } },
      lifeline: { sub: 'MEND', nB: 2,
        go() {},
        run(cs) {
          stand(A[0], 0, 0); foes(13, (i) => (i - 1) * 3 + 1.5);
          if (cs < 0.85) volley(bs, [A[0]], cs, 0.16, 0.03);
          [0.25, 0.5, 0.75].forEach((t, i) => once('h' + i, cs > t, () => hurt(A[0])));
          once('m', cs > 0.9, () => { ringFx(A[0].x, gnd(A[0]) + 0.1, A[0].z, 0x6dffb0, 2.2, 0.8); sfx('pouch', 1); });
          if (cs > 0.9 && cs < 1.5) fx.rise(A[0].x, gnd(A[0]) + 0.2, A[0].z, 0x6dffb0, 2);
          if (cs > 1.0) volley([A[0]], bs, cs, 0.12, 0.02);
          once('k0', cs > 1.25, () => kill(bs[0], false)); once('k1', cs > 1.45, () => kill(bs[1], true));
          rcam(cs, 1.6, [0.3, -0.3, 2.6, 2.0, 0.3, 0.45, 32, 28], opChest());
        } },
      wisp: { sub: 'PHASE DASH', nB: 2,
        go() {},
        run(cs) {
          const o = A[0]; foes(13, (i) => (i - 0.5) * 3.6);
          once('d', cs > 0.35, () => { const a = RF.pt(0, 0, 1.1), b2 = RF.pt(9, 0, 1.1); beamFx(a, b2, 0x6ad0ff, 0.55, 0.4); ringFx(a.x, a.y, a.z, 0x6ad0ff, 2, 0.4, false); sfx('jump2', 1); act(o, 'dash', 0.3); shake = 0.4; });
          stand(o, 9 * sst((cs - 0.35) / 0.17), 0);
          if (cs > 0.6) volley([o], bs, cs, 0.07, 0.04);
          once('k0', cs > 1.0, () => kill(bs[0], false)); once('k1', cs > 1.2, () => kill(bs[1], true));
          rcam(cs, 1.6, [2.2, 1.8, 3.2, 4.6, 0.5, 0.9, 34, 32], chest(o), RF.pt(12, 0, 1.2));
          cam.fov += 20 * Math.sin(PI * clamp((cs - 0.3) / 0.4));
        } },
      snare: { sub: 'PROXIMITY MINE', nB: 1,
        go() { A[0].crouch = true; },
        run(cs) {
          const b = bs[0]; stand(A[0], 0, 0);
          once('t', cs > 0.25, () => {
            const g = new THREE.Group(), body = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.28, 0.1, 14), new THREE.MeshStandardMaterial({ color: 0x2b2f36, metalness: 0.8, roughness: 0.4 }));
            const led = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff3030 })); led.position.y = 0.1; g.add(body, led);
            sfx('pouch', 1);
            mineE = addT(g, 1.5, (k, ob, dt, e) => { const kk = clamp(e.t / 0.35), p = RF.pt(lerp(0.8, 5.2, kk), 0); ob.position.set(p.x, p.y + 0.1 + Math.sin(PI * kk) * 1.6, p.z); led.scale.setScalar(0.6 + 0.5 * Math.sin(e.t * 18)); });
          });
          if (cs > 0.2) stand(b, lerp(12, 5.2, clamp((cs - 0.2) / 0.8)), 0.1, PI); else stand(b, 12, 0.1, PI);
          once('b', cs > 1.0, () => {
            const p = RF.pt(5.2, 0); fx.blast(p.x, p.y, p.z, 1.1); launch(b, RF.fx * 5, 9, RF.fz * 5); shake = 1; sfx('shot', 1, { snd: 'breacher' }); if (mineE) mineE.t = mineE.dur;
          });
          rcam(cs, 1.6, [1.1, 2.0, 3.4, 5.5, 0.35, 1.4, 30, 38], RF.pt(4, 0, 0.3), RF.pt(5.2, 0, 0.5));
        } },
      beacon: { sub: 'RECALL BEACON', nB: 2,
        go() { const p = RF.pt(0, 0); pillarFx(p.x, p.y, p.z, 0x7affd1, 3, 1.6); ringFx(p.x, p.y + 0.1, p.z, 0x7affd1, 2.2, 0.6); sfx('crossLatch', 1); },
        run(cs) {
          const o = A[0]; foes(16, (i) => (i - 0.5) * 4);
          if (cs < 1.0) { stand(o, 10 * sst((cs - 0.25) / 0.7), 0); if (cs > 0.3) volley([o], bs, cs, 0.12, 0.03); }
          once('r', cs > 1.0, () => {
            const a = chest(o), p0 = RF.pt(0, 0, 1);
            ringFx(a.x, a.y, a.z, 0x7affd1, 3.2, 0.5, false); fx.burst(a.x, a.y, a.z, 0x7affd1, 18, 6, 0.6, 0.3);
            stand(o, 0, 0); ringFx(p0.x, p0.y, p0.z, 0x7affd1, 3.2, 0.5, false); fx.burst(p0.x, p0.y, p0.z, 0x7affd1, 18, 6, 0.6, 0.3); sfx('respawn', 1); shake = 0.5;
          });
          once('k', cs > 0.8, () => kill(bs[0], false));
          rcam(cs, 1.6, [1.7, 1.9, 6, 5, 0.8, 1.3, 34, 36], chest(o), RF.pt(6, 0, 1.2));
        } },
      katana: { sub: 'BLINK SLASH', nB: 3, go() {},
        run(cs) {
          const o = A[0]; foes(0, () => 0); bs.forEach((b, i) => stand(b, 7 + i * 2.6, i % 2 ? 0.7 : -0.6, PI));
          once('s', cs > 0.3, () => { triggerMelee(o.ud, 'swing'); act(o, 'dash', 0.26); beamFx(RF.pt(0, 0, 1.0), RF.pt(14, 0, 1.0), 0x9fe8ff, 0.5, 0.35); sfx('jump2', 1); });
          stand(o, 14 * sst((cs - 0.3) / 0.14), 0);
          bs.forEach((b, i) => once('c' + i, cs > 0.3 + ((7 + i * 2.6) / 14) * 0.14 + 0.02, () => {
            const p = chest(b); beamFx(V3(p.x - RF.fz * 1.3, p.y + 0.5, p.z + RF.fx * 1.3), V3(p.x + RF.fz * 1.3, p.y - 0.5, p.z - RF.fx * 1.3), 0xe8fbff, 0.12, 0.25);
            sfx('stab', 0.7); delay(0.14, () => kill(b, i === 1, 'dieSide'));
          }));
          rcam(cs, 1.2, [1.2, 0.5, 6, 5, 0.6, 1.0, 34, 30], RF.pt(6, 0, 0.4), RF.pt(7, 0, 1.2));
        } },
      maul: { sub: 'GROUND SLAM', nB: 3, go() {},
        run(cs) {
          const o = A[0]; stand(o, 5 * sst((cs - 0.15) / 0.4), 0);
          once('l', cs > 0.15, () => { act(o, 'slam', 0.7); triggerMelee(o.ud, 'swing'); });
          bs.forEach((b, i) => { if (cs < 0.55) stand(b, 8 + (i === 1 ? 1.5 : 0), (i - 1) * 2.8, PI); });
          once('s', cs > 0.55, () => {
            const p = RF.pt(5, 0); ringFx(p.x, p.y + 0.1, p.z, 0xff9a3c, 7, 0.55); ringFx(p.x, p.y + 0.1, p.z, 0xffd070, 4, 0.4); fx.blast(p.x, p.y, p.z, 0.9);
            sfx('thud', 1); sfx('shot', 0.9, { snd: 'breacher' }); shake = 1.1;
            bs.forEach((b, i) => launch(b, RF.fx * 4 + (i - 1) * RF.fz * 3, 7, RF.fz * 4 - (i - 1) * RF.fx * 3));
          });
          rcam(cs, 1.2, [0.2, 0.5, 6, 5, 0.6, 1.0, 34, 38], RF.pt(3, 0, 1), RF.pt(5, 0, 1.4));
        } },
      hookblade: { sub: 'GRAPPLE PULL', nB: 1,
        go() { blockProp(RF.pt(14, 0), 5, 7, 5, RF.hd, 1.3); },
        run(cs) {
          const o = A[0], b = bs[0], top = RF.pt(14, 0, 7), g0 = gy(top.x, top.z), g1 = gy(RF.pt(0, 0).x, RF.pt(0, 0).z);
          stand(b, 14, 0.8, PI); b.fy = g0 + 7;
          once('h', cs > 0.15, () => { ropeFx(o, V3(top.x - RF.fx * 2.6, g0 + 7, top.z - RF.fz * 2.6), 1.0); sfx('crossLatch', 1); });
          const k = sst((cs - 0.3) / 0.55);
          if (cs < 0.3) stand(o, 0, 0);
          else { const p = RF.pt(lerp(0, 12, k), 0); o.x = p.x; o.z = p.z; o.fy = lerp(g1, g0 + 7, k); o.air = k > 0 && k < 1; o.yaw = facing(RF); }
          once('a', cs > 0.9, () => { triggerMelee(o.ud, 'swing'); act(o, 'lunge', 0.4); sfx('stab', 0.8); delay(0.15, () => kill(b, false, 'dieBack')); });
          rcam(cs, 1.2, [1.4, 1.8, 7, 6, 0.8, 3.5, 36, 32], chest(o), RF.pt(11, 0, 4));
        } },
      rapier: { sub: 'RIPOSTE', nB: 1,
        go() { bs[0].weapon = 'knife'; equipNow(bs[0].ud, 'knife'); },
        run(cs) {
          const o = A[0], b = bs[0]; stand(o, 0, 0); stand(b, lerp(4.5, 2.1, sst(cs / 0.3)), 0.1, PI);
          once('s', cs > 0.18, () => triggerMelee(b.ud, 'swing'));
          once('p', cs > 0.4, () => {
            const p = RF.pt(1.2, 0.2, 1.4); fx.burst(p.x, p.y, p.z, 0xffffff, 14, 6, 0.4, 0.28); fx.burst(p.x, p.y, p.z, 0x9fe8ff, 10, 4, 0.5, 0.3);
            ringFx(p.x, p.y, p.z, 0xcfeaff, 2.2, 0.35, false); sfx('clang', 1); hurt(b, -1, false); shake = 0.6;
          });
          once('c', cs > 0.6, () => { triggerMelee(o.ud, 'swing'); act(o, 'lunge', 0.4); });
          once('k', cs > 0.78, () => { kill(b, true, 'dieBack'); sfx('stab', 0.8); });
          rcam(cs, 1.2, [1.57, 1.57, 4.2, 3.0, 0.6, 0.9, 34, 28], RF.pt(1.2, 0, 0.5), RF.pt(1.2, 0, 1.3));
        } },
      riftblade: { sub: 'WAVE SLASH', nB: 3, go() {},
        run(cs) {
          const o = A[0]; stand(o, 0, 0); bs.forEach((b, i) => stand(b, 8 + i * 4.2, (i - 1) * 0.8, PI));
          once('sw', cs > 0.15, () => { triggerMelee(o.ud, 'swing'); sfx('swing', 1); });
          once('w', cs > 0.3, () => { waveE = waveFx(RF.pt(1.2, 0, 1.3), V3(RF.fx, 0, RF.fz), 34, 1.0); sfx('swing', 1); shake = 0.4; });
          if (waveE) {
            const wp = waveE.obj.position, wf = (wp.x - RF.S.x) * RF.fx + (wp.z - RF.S.z) * RF.fz;
            bs.forEach((b, i) => once('k' + i, wf > 8 + i * 4.2, () => { fx.burst(b.x, gnd(b) + 1.2, b.z, 0x7fe8ff, 12, 5, 0.5, 0.3); kill(b, false, i === 1 ? 'dieFwd' : 'dieBack'); }));
          }
          rcam(cs, 1.2, [3.3, 3.7, 4.5, 6.5, 1.2, 2.4, 36, 32], RF.pt(2, 0, 0.8), RF.pt(10, 0, 1.2));
        } },
    };
    const addReel = (name, ids) => {
      const each = (TM[name].t1 - TM[name].t0) / ids.length;
      add(name, {
        enter() { cutI = -1; },
        update(s, dt, e) {
          const i = Math.min(ids.length - 1, Math.floor(e / each)), r = REEL[ids[i]], cs = e - i * each;
          if (i !== cutI) {
            cutI = i; cutKit(ids[i], r.nB); const d0 = ALL[ids[i]]; call(((d0 && d0.name) || ids[i]).toUpperCase(), r.sub, each + 0.05); shake = Math.max(shake, 0.4);
            try { r.go(); } catch (err) { console.error('[trailer] ability go', ids[i], err); }
          }
          try { r.run(cs, dt); } catch (err) {
            if (!r.err) { r.err = 1; console.error('[trailer] ability cut', ids[i], err); }
            rcam(cs, each, [2.4, 3.4, 4, 5, 1, 1.5, 34, 34], opChest(), RF.pt(8, 0, 1.3));
          }
        },
      });
    };
    addReel('prim', ['hailstorm', 'aegis', 'spectre', 'sentinel', 'gale']);
    addReel('sec', ['cinder', 'lifeline', 'wisp', 'snare', 'beacon']);
    addReel('melee', ['katana', 'maul', 'hookblade', 'rapier', 'riftblade']);

    { // utilities: Scout Drone, then the Ridgeback Lottery
      const fr = frame(st.ops, 1.0);
      let dd = false, ll = false;
      add('util', {
        enter() { dd = ll = false; kit([A[0]], [droneId || 'vanguard']); },
        update(s, dt, e) {
          const h = A[0]; place(h, fr.pt(0, 0), facing(fr));
          if (e < 2.3) {
            if (droneId && !dd && s > 0.15) { dd = true; triggerMelee(h.ud, 'deploy'); }
            look(orb(chest(h), fr.hd + 2.9 - 2.5 * sst(e / 2.3), lerp(2.8, 2.1, e / 2.3), 0.25), chest(h).add(V3(0, -0.12, 0)), 34, 0);
          } else {
            if (!ll) { ll = true; h.weapon = W(lotId || 'vanguard'); equipNow(h.ud, h.weapon); if (lotId) triggerMelee(h.ud, 'deploy'); }
            const k = (e - 2.3) / 1.7; look(orb(chest(h), fr.hd + lerp(0.2, 1.3, sst(k)), lerp(3.4, 2.4, k), lerp(-0.6, 0.5, k)), chest(h), 28, 0);
          }
        },
      });
    }
    { // car + bike chase
      const fr = frame(st.chase, 0.4);
      const path = (f, lat, extraYaw) => {
        const r = lat + 16 * Math.sin(f * 0.045), dr = 0.72 * Math.cos(f * 0.045), dx = fr.fx + fr.fz * dr, dz = fr.fz - fr.fx * dr;
        return { p: fr.pt(f, r), yaw: Math.atan2(-dx, -dz) + extraYaw, dr };
      };
      let dt_ = 0;
      add('chase', {
        enter() { kit([], []); dt_ = 0; },
        update(s, dt, e, u) {
          const f = -70 + 26 * s, c1 = path(f, 0, 0.5 * Math.sin(f * 0.045)), c2 = path(f - 14, 2.5, 0), c3 = path(f - 34, -3, 0.3 * Math.sin(f * 0.045));
          poseCar(cars.sedan, c1.p.x, c1.p.z, c1.yaw, 26, dt, { roll: -0.07 * Math.sin(f * 0.045), steer: 0.2 * Math.sin(f * 0.045) });
          poseCar(cars.moto, c2.p.x, c2.p.z, c2.yaw, 27, dt, { roll: 0.5 * Math.cos(f * 0.045) });
          poseCar(cars.van, c3.p.x, c3.p.z, c3.yaw, 25, dt, { roll: -0.05 });
          dt_ += dt; if (dt_ > 0.045) { dt_ = 0; dust(c1.p.x, c1.p.z, 1.3); dust(c2.p.x, c2.p.z, 1); dust(c3.p.x, c3.p.z, 1.4); }
          const low = fr.pt(-10, 8, 0.7), hi = c1.p.clone().add(V3(-Math.sin(c1.yaw) * -14, 7, -Math.cos(c1.yaw) * -14));
          look(low.lerp(hi, sst((u - 0.5) / 0.3)), c1.p.clone().add(V3(0, 0.8, 0)), lerp(30, 46, u), 0);
          shake = Math.max(shake, 0.15);
        },
      });
    }
    { // the truck charges the squad and goes up
      const fr = frame(st.blast, 5.1);
      let boomed = false;
      add('blast', {
        ts: (e) => (e < 1.2 ? 1 : e < 2.0 ? 0.2 : lerp(0.2, 0.8, sst((e - 2.0) / 1))),
        enter() { boomed = false; if (cars.truck) cars.truck.free = false; kit([A[0], A[1], A[2], B[0], B[1]], ['vanguard', 'stinger']); A.slice(0, 3).forEach((a) => { a.ads = true; }); },
        update(s, dt, e) {
          const tf = Math.max(11, 44 - 26 * s), tp = fr.pt(tf, 0);
          if (!boomed) poseCar(cars.truck, tp.x, tp.z, facing(fr), 24, dt, {});
          for (let i = 0; i < 3; i++) place(A[i], fr.pt(-6 - i * 0.6, (i - 1) * 2.4), facing(fr));
          place(B[0], fr.pt(tf + 4, 4.5), facing(fr) + PI); place(B[1], fr.pt(tf + 5, -4.5), facing(fr) + PI);
          const tc = V3(tp.x, tp.y + 1.2, tp.z);
          if (!boomed && s > 0.3 && Math.floor(s * 9) !== A[0]._k) { A[0]._k = Math.floor(s * 9); fire(A[0], tc.x, tc.y, tc.z, 0.004); }
          if (!boomed && s >= 1.25) {
            boomed = true; fx.blast(tp.x, tp.y, tp.z, 1.7); vehicles.hurtAt(tp.x, tp.z, 10, 3000); shake = 1.2; sfx('shot', 1, { snd: 'breacher' });
            launch(B[0], 6, 9, 5); launch(B[1], -5, 8, 6); launch(A[2], -4, 5, -3);
            if (cars.truck) cars.truck.free = true;
          }
          const k = sst((e - 1.2) / 2);
          look(fr.pt(-9, 3.2, 1.0).lerp(fr.pt(-22, -6, 4.5), k), tc, lerp(30, 45, k), 0);
        },
      });
    }
    { // light-plane flyby
      const fr = frame(st.air2, 0.5), ya = facing(fr), SPD = 54;
      add('flyby', {
        enter() { kit([A[0], A[1]], ['vanguard']); A[0].pitch = A[1].pitch = 0.45; },
        update(s, dt, e, u) {
          const pl = P.plane, pp = fr.pt(-95 + SPD * s, 0, 11 + 1.5 * Math.sin(s * 1.3));
          poseAir(pl, pp.x, pp.y, pp.z, ya, 0.05 + 0.04 * Math.sin(s * 2), 0.18 * Math.sin(s * 1.1)); animAir(pl, dt, 1 - sst((s - 0.2) / 0.9));
          if (Math.floor(s * 16) !== pl.dk) { pl.dk = Math.floor(s * 16); dust(pp.x, pp.z, 3); }
          const c0 = fr.pt(2, 18), c1 = fr.pt(2, 21);
          for (const [a, c] of [[A[0], c0], [A[1], c1]]) { a.x = c.x; a.z = c.z; a.yaw = Math.atan2(-(pp.x - a.x), -(pp.z - a.z)); }
          look(fr.pt(0, 22, 1.5), V3(pp.x, pp.y + 0.6, pp.z), lerp(26, 34, u), 0);
        },
      });
    }
    { // helicopter swoops in and flares
      const fr = frame(st.ops, 2.0), ya = facing(fr);
      add('heli', {
        enter() { kit(A.slice(0, 4), ['vanguard', 'stinger']); },
        update(s, dt, e, u) {
          const h = P.heli, ap = 1 - sst(s / 2.4), pos = fr.pt(-80 * ap, 0, 3.5 + 22 * ap);
          poseAir(h, pos.x, pos.y, pos.z, ya, 0.22 * Math.sin(PI * clamp(s / 2.4)), 0.06 * Math.sin(s)); animAir(h, dt);
          if (pos.y - gy(pos.x, pos.z) < 14 && Math.floor(s * 30) !== h.dk) {
            h.dk = Math.floor(s * 30); const a = Math.random() * 6.283, r = 4 + Math.random() * 5; dust(pos.x + Math.cos(a) * r, pos.z + Math.sin(a) * r, 2.4);
          }
          for (let i = 0; i < 3; i++) place(A[i], fr.pt(-30 + Math.min(22, 9 * s) - i * 2, (i - 1) * 3), facing(fr));
          place(A[3], fr.pt(-6, 6), facing(fr) + 1.2);
          look(orb(V3(pos.x, gy(pos.x, pos.z) + 1.5, pos.z), fr.hd + lerp(2.2, 4.4, u), lerp(16, 12, u), 0.5), V3(pos.x, pos.y, pos.z), lerp(34, 38, u), 0);
        },
      });
    }
    { // building: ramp rush, walls, edit, enemy fire, roof
      const SB = st.build, ix0 = Math.round(SB.x / 4), iz0 = Math.round(SB.z / 4), cx0 = ix0 * 4, cz0 = iz0 * 4, h0 = gy(cx0, cz0);
      const lv0 = Math.max(0, Math.floor((h0 + 0.3) / HEIGHT)), yE = -PI / 2, yb0 = lv0 * HEIGHT + SLAB;
      const surf = (p) => {
        if (p < 1) return h0; if (p < 2) return lerp(h0, yb0, sst(p - 1));
        for (let k = 0; k < 3; k++) { const lo = 2 + 4 * k; if (p < lo + 4) return (lv0 + k) * HEIGHT + SLAB + (HEIGHT * (p - lo)) / 4; }
        return (lv0 + 3) * HEIGHT + SLAB;
      };
      const SP = {
        r0: { type: 'ramp', ix: ix0 + 1, iz: iz0, lv: lv0, o: 0, tier: 0 }, r1: { type: 'ramp', ix: ix0 + 2, iz: iz0, lv: lv0 + 1, o: 0, tier: 1 }, r2: { type: 'ramp', ix: ix0 + 3, iz: iz0, lv: lv0 + 2, o: 0, tier: 2 },
        fl: { type: 'floor', ix: ix0 + 4, iz: iz0, lv: lv0 + 3, o: 0, tier: 1 }, wE: { type: 'wall', ix: ix0 + 4, iz: iz0, lv: lv0 + 3, o: 0, tier: 0 },
        wS: { type: 'wall', ix: ix0 + 4, iz: iz0, lv: lv0 + 3, o: 1, tier: 1 }, wN: { type: 'wall', ix: ix0 + 4, iz: iz0 - 1, lv: lv0 + 3, o: 1, tier: 1 }, roof: { type: 'floor', ix: ix0 + 4, iz: iz0, lv: lv0 + 4, o: 0, tier: 2 },
      };
      let pcs = {}, ph = {}, edit = 0, nextHit = 0;
      const put = (k, t, s) => { if (s >= t && !ph[k]) { ph[k] = 1; pcs[k] = tb.place(SP[k], { remote: true }); } };
      const topY = (lv0 + 3) * HEIGHT + SLAB;
      add('build', {
        enter() { pcs = {}; ph = {}; edit = 0; nextHit = 3.9; kit([A[0], B[0], B[1], B[2]], ['vanguard', 'stinger']); },
        update(s, dt, e, u) {
          const o = A[0];
          put('r0', 0.2, s); put('r1', 0.9, s); put('r2', 1.55, s); put('fl', 2.2, s); put('wE', 3.2, s); put('wS', 3.35, s); put('wN', 3.5, s); put('roof', 5.9, s);
          const p = clamp((s - 0.45) * 6.2, 0, 16);
          o.x = cx0 + p; o.z = cz0; o.fy = surf(p); o.yaw = yE; o.fixSpeed = p > 0 && p < 16 ? 5.5 : 0;
          B.slice(0, 3).forEach((b, i) => { b.x = cx0 + 30 + (i === 2 ? 4 : 0); b.z = cz0 + (i - 1) * 4; b.yaw = -yE; b.fy = null; });
          const wt = V3(cx0 + 18, topY + 1.6, cz0);
          if (s > 3.4 && s < 5.6) for (let i = 0; i < 2; i++) { const b = B[i]; if (!b.dead && s >= b.nf) { b.nf = s + 0.2; fire(b, wt.x, wt.y, wt.z + (Math.random() - 0.5) * 1.5, 0.02); } }
          if (pcs.wE && s > nextHit && s < 5.3) { nextHit = s + 0.22; tb.damage(pcs.wE, 28); }
          if (s > 4.3 && !edit && pcs.wS) { edit = 1; tb.beginEdit(pcs.wS); }
          if (edit === 1 && s > 4.55) { tb.editSet(4, true); edit = 2; }
          if (edit === 2 && s > 4.7) { tb.editSet(1, true); edit = 3; }
          if (edit === 3 && s > 4.95) { tb.confirmEdit(); edit = 4; }
          if (s > 5.0 && s < 7.6) { if (!B[0].dead && s >= o.nf) { o.nf = s + 0.14; const c = chest(B[0]); fire(o, c.x, c.y, c.z, 0.01); } }
          if (s > 5.6 && !B[0].dead) kill(B[0], true); if (s > 6.1 && !B[1].dead) kill(B[1], false);
          let cp, cl;
          if (s < 3.0) { const u3 = s / 3; cp = V3(o.x + 3 + 2 * u3, o.fy + lerp(0.8, 3, u3), cz0 + lerp(9, 11, u3)); cl = V3(o.x + 2, o.fy + 1, cz0); }
          else if (s < 5.6) { const C = V3(cx0 + 16, topY + 1.5, cz0); cp = orb(C, PI / 2 + lerp(0.2, 1.1, sst((s - 3) / 2.6)), 9, 1.0); cl = C; }
          else { const k = sst((s - 5.6) / 2.4), C = V3(cx0 + 16, topY + 1.5, cz0); cp = V3(lerp(cx0 + 24, cx0 - 4, k), lerp(topY + 2, topY + 13, k), lerp(cz0 + 8, cz0 + 16, k)); cl = C; }
          look(cp, cl, 36, 0);
        },
      });
    }
    add('silence', { enter() { kit([], []); }, update() {} });
    { // finale
      const fr = frame(st.fight, 0.3), blasts = [1.0, 1.9, 2.7, 3.5, 4.3, 5.1], yaR = Math.atan2(-fr.fz, fr.fx), yaF = facing(fr);
      let bi = 0, f1 = false, f2 = false, shotT = 0;
      add('charge', {
        ts: () => 0.5,
        enter() {
          bi = 0; f1 = f2 = false; shotT = 0;
          kit([...A, ...B], ['aegis', 'stinger', 'marshal', 'sentinel', 'spitfire', 'breacher', 'vanguard', 'stinger', 'p9', 'marshal', 'spitfire', 'hailstorm']);
          actors.forEach((a) => { a.ads = false; });
        },
        update(s, dt, e, u) {
          for (let i = 0; i < 6; i++) {
            const lat = (i - 2.5) * 3.2;
            place(A[i], fr.pt(-30 + 5 * s - (i % 2) * 2, lat), facing(fr)); place(B[i], fr.pt(30 - 5 * s + (i % 2) * 2, lat + 1.2), facing(fr) + PI);
          }
          volley(A, B, s, 0.15, 0.03); volley(B, A, s, 0.17, 0.03);
          while (bi < blasts.length && s >= blasts[bi]) {
            const p = fr.pt(-8 + bi * 3.2, ((bi % 3) - 1) * 5); fx.blast(p.x, p.y, p.z, 1.4); shake = 1;
            launch(B[bi], 5, 8, 4); launch(A[(bi * 2 + 1) % 6], -5, 8, -4); sfx('shot', 1, { snd: 'breacher' }); bi++;
          }
          if (s > 1.2 && !f1) { f1 = true; domeFx(A[0], 0x4cc9ff, 3.2); call('AEGIS CARBINE', 'BARRIER', 1.6); }
          if (s > 2.6 && !f2) { f2 = true; const p = fr.pt(-6, 0); ringFx(p.x, p.y + 0.15, p.z, 0xff7a4a, 40, 1.0); call('SENTINEL BATTLE RIFLE', 'PULSE SCAN', 1.6); sfx('crossCock', 1); }
          // transport overhead
          const tr = P.transport, tOn = s > 1.2 && s < 5.8;
          if (tOn) { const tp = fr.pt(0, lerp(-110, 110, (s - 1.2) / 4.6), 52); poseAir(tr, tp.x, tp.y, tp.z, yaR, 0, 0.08); spinProps(tr, dt); tr.ramp.rotation.x = 0.17; } else tr.root.visible = false;
          // helicopter strafing run
          const h = P.heli, hOn = s > 3.4 && s < 6.3;
          if (hOn) {
            const hp = fr.pt(lerp(95, -95, (s - 3.4) / 2.9), 6, 24 + gy(fr.S.x, fr.S.z) * 0 + 0);
            poseAir(h, hp.x, hp.y, hp.z, yaF + PI, 0.12, 0); animAir(h, dt);
            shotT -= dt;
            if (s > 4.2 && s < 5.8 && shotT <= 0) { shotT = 0.07; _o.set(hp.x - fr.fx * 5, hp.y - 1.5, hp.z - fr.fz * 5); _d.set(-fr.fx * 0.8, -0.55, -fr.fz * 0.8).normalize(); bullets.spawn(_o, _d, 120, false); }
          } else h.root.visible = false;
          const a = lerp(0.9, 2.5, sst(u)), rad = lerp(30, 20, u);
          look(fr.pt(Math.sin(a) * rad, Math.cos(a) * rad, lerp(1.6, 11, sst(u))), fr.pt(0, 0, 1.5), lerp(34, 46, u), 0);
        },
      });
    }
    add('title', { enter() { kit([], []); }, update() {} });
    return S;
  }

  // ---------- UI ----------
  function buildUI() {
    if (ui) { ui.root.style.display = 'block'; return; }
    const st = document.createElement('style');
    st.textContent = `
body.trailer-mode *{visibility:hidden!important}
body.trailer-mode #c,body.trailer-mode #trailerUI,body.trailer-mode #trailerUI *{visibility:visible!important}
#trailerUI{position:fixed;inset:0;z-index:99990;pointer-events:none;font-family:'Arial Black',Impact,system-ui,sans-serif;color:#fff}
#trailerUI .bar{position:absolute;left:0;right:0;background:#000;z-index:4}
#trailerUI .fade{position:absolute;inset:0;z-index:2;opacity:1}
#trailerUI .flash{position:absolute;inset:0;z-index:3;background:#fff;opacity:0}
#trailerUI .card{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;z-index:5;opacity:0;transition:opacity .25s;letter-spacing:.22em;text-shadow:0 0 28px rgba(255,160,60,.55),0 4px 18px #000;font-weight:900;font-size:min(7vw,76px)}
#trailerUI .card.big{font-size:min(10.5vw,130px);letter-spacing:.3em}
#trailerUI .card.on{opacity:1}
#trailerUI .card small{display:block;margin-top:.45em;font-size:.2em;letter-spacing:.7em;color:#ffc247}
#trailerUI .call{position:absolute;left:7%;bottom:17%;z-index:5;opacity:0;transform:translateX(-14px);transition:opacity .12s,transform .18s;font-weight:900;letter-spacing:.14em;text-shadow:0 2px 14px #000}
#trailerUI .call.on{opacity:1;transform:none}
#trailerUI .call b{display:block;font-size:min(3.4vw,34px)}
#trailerUI .call i{display:block;margin-top:.25em;font:800 min(1.8vw,17px) system-ui;font-style:normal;letter-spacing:.42em;color:#ffc247}
#trailerUI .sub{position:absolute;left:8%;right:8%;bottom:12%;text-align:center;z-index:5;font:600 min(2.6vw,22px) system-ui;text-shadow:0 2px 8px #000;opacity:0}
#trailerUI .snd{position:absolute;left:14px;top:10px;z-index:7;font:700 12px system-ui;padding:6px 10px;border-radius:6px;background:rgba(0,0,0,.6);color:#fff;pointer-events:auto;display:none;cursor:pointer}
#trailerUI .hint{position:absolute;right:14px;top:10px;font:600 12px system-ui;opacity:.7;z-index:6;transition:opacity 1s}`;
    document.head.appendChild(st);
    const root = document.createElement('div'); root.id = 'trailerUI';
    root.innerHTML = '<div class="fade"></div><div class="flash"></div><div class="bar" id="trBarT" style="top:0"></div><div class="bar" id="trBarB" style="bottom:0"></div><div class="card"></div><div class="call"></div><div class="sub"></div><div class="snd"></div><div class="hint">ESC or double-tap to exit</div>';
    document.body.appendChild(root);
    const q = (s) => root.querySelector(s);
    ui = { root, fade: q('.fade'), flash: q('.flash'), card: q('.card'), call: q('.call'), sub: q('.sub'), snd: q('.snd'), hint: q('.hint'), bt: q('#trBarT'), bb: q('#trBarB'), cardKey: '', callKey: '', sndMsg: '' };
    ui.snd.addEventListener('click', (e) => { e.stopPropagation(); resumeAudio(); });
    ui.snd.addEventListener('dblclick', (e) => e.stopPropagation());
    addEventListener('resize', bars);
    addEventListener('keydown', (e) => { if (active && e.code === 'Escape') stop(); });
    addEventListener('dblclick', () => { if (active) stop(); });
  }
  function bars() { if (!ui) return; const h = Math.max(0, (innerHeight - innerWidth / 2.39) / 2); ui.bt.style.height = ui.bb.style.height = h + 'px'; }
  function overlays(t) {
    const [col, a] = overlayAt(t);
    ui.fade.style.background = col; ui.fade.style.opacity = a;
    while (hitIdx < HITS.length && t >= HITS[hitIdx]) { shake = Math.max(shake, 0.7); hitIdx++; }
    let f = 0; for (const h of HITS) if (t >= h) f = Math.max(f, 1 - (t - h) / 0.28);
    ui.flash.style.opacity = clamp(f) * 0.5;
    const cd = CARDS.find((c) => t >= c.t0 && t < c.t1);
    const key = cd ? cd.text + (cd.sub && t > cd.t0 + 2 ? '+' : '') : '';
    if (key !== ui.cardKey) {
      ui.cardKey = key;
      if (cd) { ui.card.className = 'card on' + (cd.big ? ' big' : ''); ui.card.innerHTML = cd.text + (cd.sub && t > cd.t0 + 2 ? `<small>${cd.sub}</small>` : ''); } else ui.card.className = 'card';
    }
    if (callEx && t < callEx.until) {
      const k = callEx.name + '|' + callEx.sub;
      if (ui.callKey !== k) { ui.callKey = k; ui.call.innerHTML = `<b>${callEx.name}</b><i>${callEx.sub}</i>`; }
      ui.call.classList.add('on');
    } else { ui.call.classList.remove('on'); ui.callKey = ''; }
    const showAll = /[?&]subs\b/.test(location.search);
    const line = vo.find((l) => (showAll || !l.buf) && t >= l.at && t < l.at + (l.buf ? l.buf.duration : 1.6 + l.text.length * 0.05));
    ui.sub.textContent = line ? line.text : ''; ui.sub.style.opacity = line ? 1 : 0;
    if (t > 4) ui.hint.style.opacity = 0;
  }
  function sndChip() {
    if (!ui) return;
    const c = audioCtx; let m = '';
    if (!c) m = '🔇 No audio context: click the game once, then press F8 again';
    else if (c.state !== 'running') m = '🔇 Sound is blocked: tap here to enable it';
    else if (voMissing && T < 9) m = `⚠ ${voMissing} voice line(s) not found: run the "Generate trailer voices" workflow`;
    if (m !== ui.sndMsg) { ui.sndMsg = m; ui.snd.textContent = m; ui.snd.style.display = m ? 'block' : 'none'; }
  }
  function resumeAudio() { try { if (audio.unlock) audio.unlock(); const c = audio.getCtx ? audio.getCtx() : null; if (c && c.state !== 'running') c.resume(); } catch (_) {} }

  // ---------- lifecycle ----------
  function pickStages() {
    const Pp = (i) => POIS[i % POIS.length] || { x: 0, z: 0 };
    const mk = (i, a, b, c) => findStage(R, Pp(i).x, Pp(i).z, a, b, c);
    return { vista: mk(0, 40, 120, 20), run: mk(1, 30, 110, 22), fight: mk(2, 30, 110, 26), chase: mk(3, 40, 150, 30), blast: mk(4, 30, 110, 24), ops: mk(5, 30, 110, 16), reel: mk(5, 20, 100, 14), air: mk(6, 40, 150, 26), air2: mk(7, 40, 150, 26), build: findBuildStage(R) };
  }
  async function loadVO(c, script) {
    voMissing = 0;
    return Promise.all((script.lines || []).map(async (l) => {
      let buf = null;
      if (c) {
        try { const r = await fetch(VO_DIR + l.id + '.mp3'); if (r.ok) buf = await c.decodeAudioData(await r.arrayBuffer()); else voMissing++; } catch (_) { voMissing++; }
      }
      return Object.assign({}, l, { buf });
    }));
  }
  async function primeAudio() {
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (_) {}
    try { if (audio.unlock) audio.unlock(); } catch (_) {}
    try { silent = silentLoop(); } catch (_) {}
    const c = audio.getCtx ? audio.getCtx() : null; audioCtx = c;
    if (c && c.state !== 'running') { try { await Promise.race([c.resume(), new Promise((r) => setTimeout(r, 900))]); } catch (_) {} }
    return c;
  }
  async function loadProps() {
    if (!P.transport) { P.transport = makeTransport(); scene.add(P.transport.root); }
    for (const k of ['plane', 'heli']) {
      if (P[k]) continue;
      const m = await loadGLB(AC_URL[k]);
      if (m) splitGlass(m, AC_GLASS[k]);
      P[k] = wrapAircraft(scene, m || fallbackModel(k), k);
    }
  }
  function prewarm() { // build every weapon model now (behind the black fade) so no cut hitches
    try {
      const ids = [...Object.keys(ALL)].filter((id) => ALL[id] && ALL[id].model);
      for (const id of ids) ensureWeapon(A[0].ud, id);
      ensureWeapon(B[0].ud, 'vanguard'); ensureWeapon(B[0].ud, 'knife');
    } catch (e) { console.warn('[trailer] prewarm', e); }
  }
  async function start() {
    if (active) return;
    active = true; ready = false; shotIdx = -1; hitIdx = 0; gs = 0; shake = 0; T = -0.35; waitT = 0; callEx = null; later.length = 0;
    document.body.classList.add('trailer-mode');
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch (_) {}
    buildUI(); bars(); ui.fade.style.background = '#000'; ui.fade.style.opacity = 1; ui.hint.style.opacity = 0.7; ui.cardKey = ''; ui.callKey = ''; ui.sndMsg = '';
    saved = {}; for (const k in BEST) { saved[k] = settings[k]; settings[k] = BEST[k]; }
    try { gfx.apply(); } catch (_) {}
    LOD.on = false; playerMesh.visible = false; viewmodel.visible = false;
    try {
      const c = await primeAudio();
      let script = { lines: [] };
      try { script = await (await fetch(SCRIPT_URL, { cache: 'no-cache' })).json(); } catch (e) { console.warn('[trailer] script.json', e); }
      vo = await loadVO(c, script);
      if (!active) return;
      if (!actors.length) { for (let i = 0; i < 6; i++) A.push(makeActor('remote', false, i)); for (let i = 0; i < 6; i++) B.push(makeActor('enemy', true, i + 6)); }
      if (!tb) tb = createBuild(scene, tex, { onPlace: () => sfx('click', 0.6), onBreak: () => sfx('thud', 0.8), onHit: () => sfx('clang', 0.4) });
      if (!chutes.length) for (let i = 0; i < 4; i++) chutes.push(makeChute(scene));
      stages = pickStages();
      if (!cars.sedan) {
        const S = stages.chase;
        cars.sedan = spawnCar('sedan', S, 0); cars.moto = spawnCar('motorcycle', S, 6); cars.van = spawnCar('van', S, 12);
        cars.truck = spawnCar('truck', S, 18); cars.truck2 = spawnCar('truck', S, 24);
      }
      await loadProps();
      if (!active) return;
      prewarm();
      shots = buildShots(); parkCars(false);
      if (c && audio.getMaster) music = buildAudio(c, audio.getMaster(), vo);
      else console.warn('[trailer] audio.getCtx/getMaster missing');
      ready = true;
    } catch (err) {
      console.error('[trailer] failed to start', err);
      if (ui) { ui.snd.textContent = 'TRAILER ERROR: ' + ((err && err.message) || err); ui.snd.style.display = 'block'; }
      setTimeout(() => stop(), 3500);
    }
  }
  function stop() {
    if (!active) return;
    active = false; ready = false;
    if (music) { music.stop(); music = null; }
    if (silent) { try { silent.el.pause(); URL.revokeObjectURL(silent.url); } catch (_) {} silent = null; }
    if (saved) { for (const k in saved) settings[k] = saved[k]; saved = null; try { gfx.apply(); } catch (_) {} }
    for (const a of actors) { a.mesh.visible = false; a.free = null; a.act = null; a.bal = null; }
    hideProps(); clearTimed(); later.length = 0;
    if (tb) { tb.clear(); tb.setActive(false); }
    parkCars(false);
    document.body.classList.remove('trailer-mode'); if (ui) ui.root.style.display = 'none';
    camera.up.set(0, 1, 0); camera.fov = settings.fov; camera.updateProjectionMatrix();
    if (o.onStop) o.onStop();
  }
  function update(rawFull) {
    if (!active) return;
    if (!ready) { if (ui) { ui.fade.style.opacity = 1; sndChip(); } return; }
    const raw = Math.min(rawFull, 0.25), dtc = Math.min(raw, 0.05);
    if (music) {
      if (music.ctx.state !== 'running' && waitT < 2.5) { waitT += raw; ui.fade.style.opacity = 1; sndChip(); return; } // wait for sound (a few seconds), then go on silently
      music.update();
    }
    T += raw;
    if (music && music.ctx.state === 'running') { const dd = music.ctx.currentTime - music.t0 - T; if (Math.abs(dd) < 1) T += dd * 0.1; } // stay locked to the audio clock
    if (T >= END) { stop(); return; }
    const Tc = Math.max(0, T);
    let idx = shots.findIndex((s) => Tc >= s.t0 && Tc < s.t1); if (idx < 0) idx = shots.length - 1;
    if (idx !== shotIdx) {
      shotIdx = idx; const sh = shots[idx]; sh.s = 0;
      for (const a of actors) { a.mesh.visible = false; a.free = null; a.air = false; a.fixSpeed = null; a.act = null; a.bal = null; }
      hideProps(); clearTimed(); later.length = 0; if (tb) tb.clear(); parkCars(false);
      try { if (sh.enter) sh.enter(); } catch (e) { console.error('[trailer] enter', sh.name, e); }
    }
    const sh = shots[shotIdx], e = Tc - sh.t0, u = clamp(e / (sh.t1 - sh.t0));
    const ts = sh.ts ? sh.ts(e, u) : 1, dt = Math.max(0.0005, dtc * ts);
    sh.s += dt; gs += dt;
    try { sh.update(sh.s, dt, e, u); } catch (err) { if (!sh._err) { sh._err = 1; console.error('[trailer] shot', sh.name, err); } }
    for (const a of actors) tickActor(a, dt);
    for (let i = later.length - 1; i >= 0; i--) if (gs >= later[i].t) { const f = later[i].fn; later.splice(i, 1); try { f(); } catch (_) {} }
    fakePlayer.x = cam.p.x; fakePlayer.z = cam.p.z; fakePlayer.y = cam.p.y;
    vehicles.update(dt, fakePlayer, {}, null);
    fx.update(dt); stepTimed(dt); if (tb) tb.update(dt); bullets.update(dt); world.update(cam.p.x, cam.p.z, dtc);
    camera.position.copy(cam.p); camera.up.set(0, 1, 0); camera.lookAt(cam.l); if (cam.roll) camera.rotateZ(cam.roll);
    const k = shake + 0.05;
    camera.position.x += Math.sin(T * 43) * k * 0.05; camera.position.y += Math.sin(T * 51 + 1) * k * 0.05; camera.rotateZ(Math.sin(T * 37) * k * 0.01);
    shake *= Math.exp(-3.5 * dtc);
    if (Math.abs(camera.fov - cam.fov) > 1e-3) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();
    try { _d.set(0, 0, -1).applyQuaternion(camera.quaternion); audio.setListener(camera.position.x, camera.position.z, Math.atan2(-_d.x, -_d.z)); } catch (_) {}
    overlays(Tc); sndChip();
  }

  return { start, stop, update, get active() { return active; } };
}
