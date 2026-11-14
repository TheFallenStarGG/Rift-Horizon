/**
 * RIFT HORIZON launch trailer. F8 in game, or open the game with ?trailer and press Start.
 * Cut list = PLAN below. Score, cards, flashes and transitions all hang off it, so re-timing a shot is a one-number edit.
 * Voice = the radio lines only (RADIO table). Narrator is gone.
 * Effects live in lib/trailerFx.js, music + SFX in lib/trailerScore.js. The transport is the real in-game dropship (lib/dropshipModel.js).
 * URL flags: ?subs shows radio subtitles, ?lite turns off the grade overlay and CSS blur (phones) and thins the score.
 * Body-language clips live in overlay() (slide, dive, stagger, die*, fly, lunge, slam, dash...). Abilities are staged in REEL.
 * Scenes are kept out of lakes (findStage / wetNear).
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { heightAt } from './ground.js';
import { lakeAt, WATER_Y } from './terrain.js';
import { POIS } from './mapLayout.js';
import { nearby } from './collision.js';
import './weaponsPlus.js';
import { ALL } from './arsenal.js';
import { updateHumanoidAnim, triggerShootKick, triggerMelee, ensureWeapon, equipNow, LOD } from './anim.js';
import { VEHICLE_TYPES } from './vehicles.js';
import { createBuild, SLAB, HEIGHT } from './build.js';
import { HIP_Y } from './parts.js';
import { settings } from './settings.js';
import { makeFx, makeRift } from './trailerFx.js';
import { buildScore, loadTrack } from './trailerScore.js';
import { naturalMotion, bodyYaw, paceOf, kickBody } from './trailerMotion.js';
import { buildPlane, RAMP_OPEN, RAMP_Z } from './dropshipModel.js';

const PI = Math.PI;
// ===================== config =====================
const TITLE = 'RIFT HORIZON';
const TAGLINE = 'COMING SOON';
const LITE = /[?&]lite\b/.test(location.search);
const SCRIPT_URL = './assets/trailer/script.json';
const VO_DIR = './assets/trailer/vo/';
const AC_URL = {
  plane: new URL('../assets/single-engine-light-aircraft-24478f.glb', import.meta.url).href,
  heli: new URL('../assets/helicopter-9d1986.glb', import.meta.url).href,
};
const AC_GLASS = { plane: [[0.168, 0.266, 0.342]], heli: [[0.021, 0.028, 0.05]] };

// [shot, seconds]. Keep the starts on even numbers (120 bpm) so the score lands on the cuts.
const PLAN = [
  ['rift', 6], ['plane', 6], ['freefall', 4], ['landing', 4], ['contact', 6], ['guns', 6],
  ['prim', 8], ['sec', 8], ['melee', 6], ['util', 4], ['bullet', 4], ['chase', 6], ['blast', 4], ['flyby', 4], ['heli', 4],
  ['build', 8], ['silence', 4], ['charge', 12], ['title', 8],
];
const TM = {}; let END = 0;
for (const [n, d] of PLAN) { TM[n] = { t0: END, t1: END + d }; END += d; }
const TAIL = 1.6; // black + music tail after the last shot
const HIT_N = ['plane', 'freefall', 'contact', 'guns', 'prim', 'sec', 'melee', 'bullet', 'chase', 'blast', 'flyby', 'heli', 'build', 'charge', 'title'];
const HITS = HIT_N.map((n) => TM[n].t0);
// transition played on every shot start: smash = white flash, whip = fast pan streak + blur, strobe, dip = black dip, glitch
const CUTL = [['plane', 'whip'], ['freefall', 'smash'], ['landing', 'dip'], ['contact', 'smash'], ['guns', 'strobe'], ['prim', 'smash'], ['sec', 'glitch'], ['melee', 'smash'],
  ['util', 'whip'], ['bullet', 'dip'], ['chase', 'whip'], ['blast', 'smash'], ['flyby', 'whip'], ['heli', 'whip'], ['build', 'smash'], ['charge', 'strobe'], ['title', 'smash']]
  .map(([n, k]) => ({ t: TM[n].t0, k }));
// radio lines (the only voice in the trailer): id -> start time in seconds. Tune these if a line sits off its beat.
const RADIO = {
  r01: TM.plane.t0 + 1.0,    // "Dropship's over the zone. Green light. Go, go, go!"
  r02: TM.freefall.t0 + 0.9, // "Chutes! Pull your chutes!"
  r03: TM.landing.t0 + 1.0,  // "Boots down. Weapons free."
  r04: TM.contact.t0 + 0.3,  // "Contact front! All units, engage!"
  r05: TM.contact.t0 + 3.4,  // "Reloading! Cover me!"
  r06: TM.chase.t0 + 4.2,    // "Truck's moving. Take it out!"
  r07: TM.heli.t0 + 0.2,     // "Bird's inbound. Cover the landing zone!"
  r08: TM.build.t0 + 0.4,    // "Walls up! Hold this position!"
  r09: TM.silence.t0 + 2.9,  // "All units, push! Push!"
};
const CARDS = [
  { t0: TM.rift.t0 + 1.2, t1: TM.rift.t0 + 3.6, text: 'EVERY WORLD HAS A BREAKING POINT.', size: 's' },
  { t0: TM.rift.t0 + 4.3, t1: TM.rift.t1 - 0.1, text: 'THEY CAME TO FIND IT.', size: 's' },
  { t0: TM.guns.t0 + 0.2, t1: TM.guns.t0 + 2.3, text: 'EVERY WEAPON.' },
  { t0: TM.prim.t0 + 0.1, t1: TM.prim.t0 + 1.5, text: 'EVERY ABILITY.' },
  { t0: TM.melee.t0 + 0.1, t1: TM.melee.t0 + 1.3, text: 'EVERY BLADE.' },
  { t0: TM.bullet.t0 + 0.15, t1: TM.bullet.t0 + 1.7, text: 'ONE ROUND.' },
  { t0: TM.chase.t0 + 0.3, t1: TM.chase.t0 + 2.4, text: 'EVERY VEHICLE.' },
  { t0: TM.flyby.t0 + 0.2, t1: TM.flyby.t0 + 2.0, text: 'TAKE TO THE SKY.' },
  { t0: TM.build.t0 + 0.2, t1: TM.build.t0 + 2.2, text: 'BUILD ANYTHING.' },
  { t0: TM.silence.t0 + 0.6, t1: TM.silence.t0 + 3.2, text: 'EVERY SECOND.' },
  { t0: TM.title.t0 + 0.9, t1: END - 0.5, title: true },
];
// colour grade overlay per shot (soft-light, drawn over the game canvas)
const GRADES = {
  def: 'rgba(255,170,90,.12)', rift: 'rgba(40,80,170,.38)', plane: 'rgba(255,140,70,.22)', freefall: 'rgba(120,190,255,.22)', landing: 'rgba(255,180,100,.18)',
  contact: 'rgba(255,120,60,.2)', bullet: 'rgba(60,110,200,.3)', chase: 'rgba(255,150,60,.24)', blast: 'rgba(255,110,40,.26)', build: 'rgba(80,200,200,.14)',
  charge: 'rgba(255,100,40,.28)', title: 'rgba(255,120,50,.2)', silence: 'rgba(0,0,0,0)',
};
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
/** true if open water is at, or within r metres of, (x, z). The lakes have flat bowls that pass the slope test, so stages have to be checked against them separately. */
function wetNear(x, z, r) {
  if (lakeAt(x, z, 1.2) || gy(x, z) < WATER_Y + 0.3) return true;
  for (let k = 1; k <= 3; k++) for (let i = 0; i < 8; i++) { const a = i * 0.7854, d = (r * k) / 3; if (lakeAt(x + Math.cos(a) * d, z + Math.sin(a) * d, 1.2)) return true; }
  return false;
}
const STAGE_WET = 90; // keep every scene at least this far from a lake
function findStage(R, cx, cz, rMin, rMax, clear) {
  let hit = null;
  for (let i = 0; i < 160; i++) {
    const a = R() * 6.283, r = rMin + R() * (rMax - rMin), x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    if (slope(x, z) < 0.09 && nearby(x, z, clear).length === 0) { hit = { x, z }; break; }
  }
  if (hit && !wetNear(hit.x, hit.z, STAGE_WET)) return hit;
  // the first pick sat in or beside a lake (or nothing was found): search again on a private random stream, so every other scene keeps its place
  const Q = rng(((Math.floor(cx) * 73856093) ^ (Math.floor(cz) * 19349663) ^ 0x51ed27) >>> 0);
  for (let i = 0; i < 700; i++) {
    const far = i >= 350 && POIS.length > 0, p = far ? POIS[Math.floor(Q() * POIS.length)] : { x: cx, z: cz };
    const a = Q() * 6.283, r = rMin + Q() * (rMax * (far ? 1 : 1.6) - rMin), x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
    if (slope(x, z) < 0.09 && nearby(x, z, clear).length === 0 && !wetNear(x, z, STAGE_WET)) return { x, z };
  }
  return hit || { x: cx + rMax, z: cz };
}
/** a flat, empty spot on the 4 m build grid whose ground height is close to a build level */
function findBuildStage(R) {
  let best = null, bd = 9;
  for (let i = 0; i < 300; i++) {
    const p = POIS[Math.floor(R() * POIS.length)] || { x: 0, z: 0 }, a = R() * 6.283, r = 25 + R() * 90;
    const x = Math.round((p.x + Math.cos(a) * r) / 4) * 4, z = Math.round((p.z + Math.sin(a) * r) / 4) * 4;
    if (slope(x, z) > 0.04 || nearby(x + 12, z, 34).length || wetNear(x + 16, z, 60)) continue;
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

function overlay(a, dt, T) {
  const ac = a.act;
  naturalMotion(a, dt, T);
  if (!ac) return;
  ac.t += dt;
  const k = ac.t, d = ac.dur, x = clamp(k / d), dir = ac.dir || 1;
  switch (ac.name) {
    case 'slide': setPose(a, envl(k, d, 0.1, 0.25), { py: 0.34, rx: 1.0, cx: -0.3, hx: -0.5, lt: 0.35, ls: -0.2, rt: 0.9, rs: -1.8 }); break;
    case 'dive': { // forward combat roll (ac.mv = world-space travel in metres, applied by tickActor so the roll actually goes somewhere)
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

// ===================== props: parachute, transport plane, GLB aircraft, scout drone =====================
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
/** the REAL in-game hot-drop transport (lib/dropshipModel.js, same cabin as lib/dropship.js), wrapped as a trailer prop */
function makeTransport(accent = 0xff8a2b) {
  const pl = buildPlane(accent), g = pl.group; g.rotation.order = 'YXZ'; g.visible = false;
  return { root: g, ramp: pl.ramp, props: pl.props, plane: pl, kind: 'transport', nodes: {}, spin: 0 };
}
/** the cabin jump light: red (blinking) while the bay is closed, green once it is open */
function jumpLight(tr, go, t) {
  const p = tr && tr.plane; if (!p) return;
  const red = !go && ((t * 2.2) % 1) < 0.5;
  p.lampRed.material.color.setHex(red ? 0xff2a1a : 0x400a08); p.lampGreen.material.color.setHex(go ? 0x35ff66 : 0x0a3010);
  p.glowR.material.opacity = red ? 0.9 : 0; p.glowG.material.opacity = go ? 0.9 : 0;
}
/** the Scout Drone, as a flying prop */
function makeDrone(scene) {
  const g = new THREE.Group(), rot = [];
  const body = new THREE.Mesh(G_BOX, new THREE.MeshStandardMaterial({ color: 0x23262b, metalness: 0.7, roughness: 0.35 })); body.scale.set(0.42, 0.12, 0.42); g.add(body);
  const eye = new THREE.Mesh(G_SPH, new THREE.MeshBasicMaterial({ color: 0xff3030 })); eye.scale.setScalar(0.06); eye.position.set(0, -0.04, -0.22); g.add(eye);
  for (const [x, z] of [[0.3, 0.3], [-0.3, 0.3], [0.3, -0.3], [-0.3, -0.3]]) {
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.01, 14), new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.4 }));
    r.position.set(x, 0.08, z); g.add(r); rot.push(r);
  }
  g.visible = false; scene.add(g);
  return { root: g, rot };
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
  if (t >= ch.t1) { // white-out clears onto the burning battlefield, then settles darker under the logo and fades out
    const k = t - ch.t1;
    if (t >= END - 1.2) return ['#000', 0.4 + 0.6 * sst((t - (END - 1.2)) / 1.2)];
    if (k < 1.1) return ['#fff', 1 - sst(k / 1.1)];
    return ['#000', 0.4 * sst((k - 1.1) / 0.8)];
  }
  return ['#000', 0];
}

// ===================== director =====================
export function createTrailer(o) {
  const { scene, camera, tex, audio, bullets, vehicles, world, gfx, makeHumanoid, playerMesh, viewmodel } = o;
  const R = rng(20261112);
  const fx = makeFx(scene, tex);
  const rift = makeRift(scene, tex);
  const actors = [], A = [], B = [], cars = {}, later = [], timed = [], chutes = [];
  const P = { transport: null, plane: null, heli: null, drone: null };
  let active = false, ready = false, T = 0, gs = 0, shotIdx = -1, shake = 0, cutI = 0, waitT = 0, kickT = -9;
  let stages = null, shots = [], saved = null, ui = null, music = null, vo = [], tb = null, audioCtx = null, silent = null, voMissing = 0, callEx = null;
  let punchF = 0, rollK = 0, slowK = 1, slowT0 = -9, slowD = 0, freezeUntil = -9, imp = -9, spd = 0, fired = {}, tr = null, flr = null, filt = '', cvs = null;
  const cam = { p: new THREE.Vector3(), l: new THREE.Vector3(), fov: 40, roll: 0 };
  const fakePlayer = { x: 0, y: 0, z: 0, alive: false, hp: 100, inVehicle: false };
  const W = (id) => (ALL[id] ? id : 'vanguard');
  // sound-effect budget: the game audio's voice limiter lets every "local" sound through, so a big firefight would flood the audio thread. Cap per category and overall (per real second).
  const sfxAll = [], sfxLog = {}, SFX_CAP = { shot: 7, heroShot: 10, bigshot: 4, hit: 7, headshot: 4, death: 3, thud: 4, land: 3, clang: 5, swing: 4, stab: 4 };
  const sfxOk = (cat) => {
    const now = performance.now() / 1000;
    while (sfxAll.length && now - sfxAll[0] > 1) sfxAll.shift();
    if (sfxAll.length >= 26) return false;
    const L = sfxLog[cat] || (sfxLog[cat] = []);
    while (L.length && now - L[0] > 1) L.shift();
    if (L.length >= (SFX_CAP[cat] || 12)) return false;
    L.push(now); sfxAll.push(now); return true;
  };
  const sfx = (n, v = 1, x = {}, cat = n) => { if (!sfxOk(cat)) return; try { audio.play(n, null, null, Object.assign({ vol: v }, x)); } catch (_) {} };
  const snd = (n, v = 1) => { try { if (music) music.play(n, v); } catch (_) {} };
  const delay = (sec, fn) => later.push({ t: gs + sec, fn });
  const call = (name, sub = '', dur = 1.4) => { callEx = { name, sub, until: T + dur }; };
  const gnd = (a) => (a.fy == null ? gy(a.x, a.z) : a.fy);
  // ---------- cinematic toggles ----------
  const punch = (v = 4) => { punchF = Math.max(punchF, v); };            // quick FOV zoom-in that relaxes
  const slow = (k, d) => { slowK = k; slowT0 = T; slowD = d; snd('sweep', 0.6); }; // bullet time for d seconds, then ease back
  const slowF = (t) => { const te = t - slowT0 - slowD; return te < 0 ? slowK : lerp(slowK, 1, sst(te / 0.35)); };
  const hitStop = (d = 0.07) => { freezeUntil = T + d; };
  const impactFrame = (d = 0.07) => { imp = T + d; };                    // inverted anime-style frame
  const flare = (p, s = 1) => { flr = { p: p.clone(), t0: T, s }; };     // anamorphic streak + glow at a world point
  /** cut style: smash | whip | strobe | dip | glitch */
  function trans(type, quiet) { tr = { type, t0: T, dir: Math.random() < 0.5 ? -1 : 1 }; if (!quiet) snd(type === 'whip' ? 'whoosh' : 'hit', 0.7); }
  const ev1 = (k, c, fn) => { if (c && !fired[k]) { fired[k] = 1; fn(); } };  // fire-once helper, reset on every shot change

  // ---------- timed visuals ----------
  const addT = (obj, dur, fn, own) => { scene.add(obj); const e = { obj, t: 0, dur, fn, own, pulse: 0, end: null }; timed.push(e); return e; };
  const rmT = (e) => { scene.remove(e.obj); if (e.obj.material) e.obj.material.dispose(); if (e.own && e.obj.geometry) e.obj.geometry.dispose(); };
  function stepTimed(dt) {
    for (let i = timed.length - 1; i >= 0; i--) {
      const e = timed[i]; e.t += dt; const k = e.t / e.dur;
      if (k >= 1) { if (e.end) { try { e.end(); } catch (_) {} } rmT(e); timed.splice(i, 1); continue; }
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
  /** a jagged bolt of light between two points */
  const lightningFx = (p0, p1, color, w, dur, jag = 3) => {
    const g = new THREE.Group(), mat = mkMat(color, 1), N = 9; g.material = mat;
    let prev = p0.clone();
    for (let i = 1; i <= N; i++) {
      const q = i === N ? p1.clone() : p0.clone().lerp(p1, i / N).add(V3((Math.random() - 0.5) * jag, (Math.random() - 0.5) * jag * 0.5, (Math.random() - 0.5) * jag));
      const m = new THREE.Mesh(G_BOX, mat), d = q.clone().sub(prev), len = d.length() || 0.01;
      m.position.copy(prev).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(AZ, d.normalize()); m.scale.set(w, w, len); g.add(m); prev = q;
    }
    return addT(g, dur, (k) => { mat.opacity = (1 - k) * (0.6 + 0.4 * Math.sin(k * 90)); });
  };
  /** a rocket with a smoke trail; `end` fires on impact */
  const rocketFx = (p0, p1, dur, end) => {
    const a = p0.clone(), b = p1.clone(), dir = b.clone().sub(a).normalize();
    const m = new THREE.Mesh(G_BOX, mkMat(0xffe8c0, 1)); m.scale.set(0.14, 0.14, 0.8); m.quaternion.setFromUnitVectors(AZ, dir);
    const e = addT(m, dur, (k, ob) => {
      ob.position.lerpVectors(a, b, k);
      for (let i = 0; i < 2; i++) { const q = ob.position; fx.smokeTrail(q.x - dir.x * 0.6 * i, q.y - dir.y * 0.6 * i, q.z - dir.z * 0.6 * i, 1.1); }
      fx.flame(ob.position.x, ob.position.y, ob.position.z, 0.45);
    });
    e.end = end; snd('rocket', 0.7); return e;
  };
  const grenadeFx = (a, b, dur, end) => {
    const m = new THREE.Mesh(G_SPH, new THREE.MeshStandardMaterial({ color: 0x3a4036, roughness: 0.6 })); m.scale.setScalar(0.1);
    const e = addT(m, dur, (k, ob) => { ob.position.lerpVectors(a, b, k); ob.position.y += Math.sin(PI * k) * 3.2; ob.rotation.x += 0.3; });
    e.end = end; return e;
  };
  /** explosion with everything on it: fireball, debris, shockwave, flare, sound, camera punch */
  function explode(x, y, z, sc = 1) {
    fx.blast(x, y, z, sc); shake = Math.max(shake, 0.7 + 0.4 * sc); punch(3 + 2 * sc); snd('boom', 0.55 + 0.3 * sc);
    sfx('shot', 1, { snd: 'breacher' }, 'bigshot'); flare(V3(x, y + 1, z), Math.min(1.5, 0.5 + 0.5 * sc));
    if (sc >= 1.3) ringFx(x, y + 0.3, z, 0xffd9a0, 22 * sc, 0.7);
  }
  // scripted vehicle tumble (no physics): h = height of the car's centre above the ground
  const mkTum = (x, z, vx, vy, vz, ap, ar, yaw) => ({ x, z, h: 0.4, vx, vy, vz, p: 0, r: 0, ap, ar, yaw });
  function stepTum(m, dt) {
    m.x += m.vx * dt; m.z += m.vz * dt; m.vy -= 22 * dt; m.h += m.vy * dt;
    if (m.h < 0.4) { m.h = 0.4; m.vy = Math.abs(m.vy) * 0.35; m.vx *= 0.75; m.vz *= 0.75; m.ap *= 0.55; m.ar *= 0.55; }
    m.p += m.ap * dt; m.r += m.ar * dt;
  }
  const tumOp = (m) => ({ lift: m.h - 0.4 + 0.8 * Math.abs(Math.sin(m.p)) + 0.6 * Math.abs(Math.sin(m.r)), pitch: m.p, roll: m.r });

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
    a.dvA = null; a.dox = 0; a.doz = 0; // dive travel (see tickActor)
  }
  const place = (a, p, yaw) => { if (a.dead) return; a.x = p.x + (a.dox || 0); a.z = p.z + (a.doz || 0); a.yaw = yaw; };
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
    // a combat roll with a travel vector (act extra `mv`): the actor really covers the ground instead of rolling on the spot. place() adds the offset, and it is kept after the roll ends.
    if (a.act && a.act.name === 'dive' && a.act.mv) a.dvA = a.act;
    if (a.dvA) { const q = a.dvA, k = a.act === q && q.t < q.dur ? sst(q.t / q.dur) : 1; a.dox = q.mv[0] * k; a.doz = q.mv[1] * k; }
    a.mesh.position.set(a.x, gnd(a), a.z); a.mesh.rotation.set(0, bodyYaw(a, dt), 0);
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
      dt, moving: a.speed > 0.4, speed: a.speed * paceOf(a), grounded: !(a.air || a.free), ads: a.ads, sprint: a.speed > 5.2, crouch: a.crouch, pitch: a.pitch,
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
    triggerShootKick(a.ud); kickBody(a);
    bullets.ejectShell(_o, _n.set(1.2, 1.2, 0));
    sfx('shot', 0.85, { snd: SND[a.weapon] || a.weapon, enemy: a.hostile }, a === A[0] ? 'heroShot' : 'shot');
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
    if (head) { punch(2.5); hitStop(0.05); }
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

  // ---------- vehicles (scripted: physics is off, every car is posed by hand) ----------
  const _cm = new THREE.Vector3(), _eu = new THREE.Euler();
  function spawnCar(type, S, off) {
    const v = vehicles.spawnAt({ type, x: S.x + off, z: S.z + off, yaw: 0 }); if (!v) return null;
    v.awake = false; v.inst.driver.visible = true;
    return { v, ty: VEHICLE_TYPES[type], hid: false };
  }
  /** op: roll / steer, lift (m above ground), pitch (added to the slope pitch) */
  function poseCar(c, x, z, yaw, speed, dt, op) {
    if (!c || c.hid) return; op = op || {};
    const v = c.v, ty = c.ty, fx_ = -Math.sin(yaw), fz_ = -Math.cos(yaw);
    v.x = x; v.z = z; v.yaw = yaw; v.y = gy(x, z) + (op.lift || 0);
    const pitch = Math.atan2(gy(x + fx_ * 1.6, z + fz_ * 1.6) - gy(x - fx_ * 1.6, z - fz_ * 1.6), 3.2) + (op.pitch || 0);
    v.q.setFromEuler(_eu.set(pitch, yaw, op.roll || 0, 'YXZ'));
    _cm.set(0, ty.phys.comY, ty.phys.comZ).applyQuaternion(v.q); v.p.set(x, v.y, z).add(_cm);
    v.vel.set(fx_ * speed, 0, fz_ * speed); v.w.set(0, 0, 0); v.steer = op.steer || 0;
    for (const w of v.wh) { w.ang += (speed * dt) / ty.wr; w.om = speed / ty.wr; if (w.front) w.steerAng = op.steer || 0; w.off = 0; }
    v.awake = false; v.sleepT = 0;
  }
  function hideCar(c) { if (c) { c.hid = true; c.v.x = c.v.z = 40000; c.v.y = 0; } }
  function parkCars() { for (const k in cars) { const c = cars[k]; if (c) { c.hid = false; c.v.x = c.v.z = 40000; c.v.y = 0; } } }
  const dust = (x, z, sc) => fx.dust(x, gy(x, z) + 0.2, z, sc);
  function look(p, l, fov, roll) { cam.p.copy(p); cam.p.y = Math.max(cam.p.y, gy(p.x, p.z) + 0.35); cam.l.copy(l); cam.fov = fov; cam.roll = roll || 0; }
  const showProp = (p) => { if (p && p.root) p.root.visible = true; };
  function hideProps() { for (const k in P) if (P[k] && P[k].root) P[k].root.visible = false; for (const c of chutes) c.hide(); rift.hide(); }

  // ---------- shots ----------
  function buildShots() {
    const S = [], st = stages;
    const add = (name, d) => S.push(Object.assign({ name, t0: TM[name].t0, t1: TM[name].t1, s: 0 }, d));
    const guns = ['vanguard', 'stinger', 'breacher', 'longbow', 'ridgeback', 'p9', 'marshal', 'spitfire', 'cutter', 'whisper'];
    const droneId = (Object.values(ALL).find((d) => d.perk === 'drone') || {}).id;
    const lotId = (Object.values(ALL).find((d) => d.perk === 'lottery') || {}).id;

    { // 1. cold open: the sky tears open above the squad
      const fr = frame(st.vista, 0.7), ya = Math.atan2(-fr.fz, fr.fx), rp = fr.pt(330, -40, 150);
      add('rift', {
        enter() { kit([A[0], A[1], A[2]], ['vanguard']); A[1].crouch = true; },
        update(s, dt, e, u) {
          place(A[0], fr.pt(0, 0), facing(fr)); place(A[1], fr.pt(-5, 5), facing(fr)); place(A[2], fr.pt(-4, -6), facing(fr));
          rift.place(rp.x, rp.y, rp.z, 80, sst((e - 0.3) / 4.2));
          ev1('rum', e > 1.6, () => { snd('rumble', 0.9); shake = Math.max(shake, 0.35); });
          [2.5, 3.3, 4.6, 5.2].forEach((tt, i) => ev1('b' + i, e > tt, () => {
            const g = fr.pt(230 + Math.random() * 60, (Math.random() - 0.5) * 160);
            lightningFx(rp, g, 0xffd9a0, 1.4, 0.4, 16); flare(g, 0.8); snd('crack', 0.5); shake = Math.max(shake, 0.4);
          }));
          ev1('crack', e > 4.05, () => { punch(9); shake = 1.2; flare(rp, 1.5); impactFrame(0.05); snd('crack', 1); });
          if (P.transport) { const tp = fr.pt(170, lerp(-120, 90, u), 85); poseAir(P.transport, tp.x, tp.y, tp.z, ya, 0, 0.05); spinProps(P.transport, dt); jumpLight(P.transport, false, s); }
          const k = sst(u);
          look(fr.pt(lerp(-30, -9, 1 - Math.pow(1 - u, 2.2)), lerp(7, 2, k), lerp(0.9, 4.6, k)), fr.pt(0, 0, 1.8).lerp(rp, sst((e - 1.6) / 3.2) * 0.78), lerp(38, 30, k), lerp(0.06, -0.03, k));
        },
      });
    }
    { // 2. the real hot-drop transport takes flak, drops its ramp, the squad jumps out of the cabin
      const fr = frame(st.air, 1.2), ALT = 140, y0 = gy(st.air.x, st.air.z) + ALT, ya = facing(fr), SP = 58, rx = fr.fz, rz = -fr.fx;
      const RAMP_END = 7.3, rampY = (z) => (z > RAMP_Z ? -(z - RAMP_Z) * Math.sin(RAMP_OPEN) : 0); // cabin floor is y 0, the lowered ramp slopes down behind it
      let nf = 0, nt = 0;
      add('plane', {
        enter() { kit(A.slice(0, 4), ['vanguard', 'stinger']); nf = nt = 0; },
        update(s, dt, e, u) {
          const tr = P.transport, f = -70 + SP * s, px = st.air.x + fr.fx * f, pz = st.air.z + fr.fz * f, dm = Math.max(0, e - 3.9);
          poseAir(tr, px, y0 + Math.sin(s * 0.8) * 0.25 - dm * dm * 2.2, pz, ya, 0.012 * Math.sin(s * 0.6) + 0.1 * dm, -0.05 + 0.3 * dm); spinProps(tr, dt);
          tr.ramp.rotation.x = lerp(-PI / 2, RAMP_OPEN, sst((s - 0.3) / 1.5)); jumpLight(tr, s > 1.8, s); tr.root.updateMatrixWorld(true);
          rift.place(st.air.x + fr.fx * 520, y0 + 60, st.air.z + fr.fz * 520, 110, 1);
          for (let i = 0; i < 4; i++) {
            const a = A[i], lx = i % 2 ? 0.55 : -0.55, lz = 1.4 + i * 0.55, dur = (RAMP_END - lz) / 5, tau = s - (1.9 + i * 0.35); // each one jogs down the cabin and off the ramp, a beat after the last
            if (tau < dur) {
              const w = clamp(tau / dur), z = lerp(lz, RAMP_END, w);
              _a.set(lerp(lx, 0, sst(w)), rampY(z), z); tr.root.localToWorld(_a);
              a.x = _a.x; a.z = _a.z; a.fy = _a.y; a.yaw = ya + PI; a.fixSpeed = tau < 0 ? 0 : 5;
            } else {
              if (!a.jv) { _a.set(0, rampY(RAMP_END) - 0.1, RAMP_END + 0.2); tr.root.localToWorld(_a); a.x = _a.x; a.z = _a.z; a.fy = _a.y; a.jv = { vy: 1.5, t: 0 }; a.free = { tilt: 0, bank: 0, twist: 0, p: POSE_FREE, k: 0 }; a.air = true; a.fixSpeed = 0; }
              const j = a.jv; j.t += dt; j.vy = lerp(j.vy, -30, 1 - Math.exp(-0.7 * dt));
              const h = SP * Math.exp(-0.55 * j.t); a.x += fr.fx * h * dt; a.z += fr.fz * h * dt; a.fy += j.vy * dt; a.yaw = ya;
              const k = sst(j.t / 0.5); a.free.k = k; a.free.tilt = -1.46 * k + Math.sin(j.t * 3 + i) * 0.03 * k; a.free.bank = Math.sin(j.t * 1.7 + i) * 0.12 * k; a.free.twist = 0.3 * Math.sin(j.t * 1.2 + i);
            }
          }
          // flak bursts and ground tracers
          if (e > 0.4 && e < 3.8 && e > nf) {
            nf = e + 0.25 + Math.random() * 0.2;
            fx.puff(px + (Math.random() - 0.5) * 36 + fr.fx * 12, y0 + (Math.random() - 0.3) * 22, pz + (Math.random() - 0.5) * 36 + fr.fz * 12, 1.2 + Math.random());
            shake = Math.max(shake, 0.3); snd('flak', 0.5);
          }
          if (e < 3.8 && e > nt) {
            nt = e + 0.09; const gx = px + (Math.random() - 0.5) * 200, gz = pz + (Math.random() - 0.5) * 200;
            beamFx(V3(gx, gy(gx, gz), gz), V3(px + (Math.random() - 0.5) * 10, y0 + (Math.random() - 0.5) * 6, pz + (Math.random() - 0.5) * 10), 0xffd27a, 0.3, 0.22);
          }
          ev1('hit', e > 3.9, () => { _a.set(0, 3.6, 9.5); tr.root.localToWorld(_a); explode(_a.x, _a.y, _a.z, 1.5); });
          if (e > 3.95) { _a.set(0, 3.6, 9.5); tr.root.localToWorld(_a); fx.flame(_a.x, _a.y, _a.z, 1.3); fx.smokeTrail(_a.x, _a.y, _a.z, 2.2); }
          ev1('c1', e > 2.0, () => trans('whip')); ev1('c2', e > 3.8, () => trans('whip'));
          const lead = V3(A[0].x, (A[0].fy == null ? y0 : A[0].fy) + 0.5, A[0].z), pp = V3(px, y0, pz);
          let cp, cl, fv, rl;
          if (e < 2.0) { // exterior, behind and below, flak bursting around, the ramp swinging down
            const k = e / 2;
            cp = V3(px + fr.fx * lerp(-26, -14, k) + rx * lerp(-15, -22, k), y0 + lerp(-3, 3, k), pz + fr.fz * lerp(-26, -14, k) + rz * lerp(-15, -22, k));
            cl = V3(px - fr.fx * 3, y0 + 1.2, pz - fr.fz * 3); fv = lerp(36, 30, k); rl = 0.05 * Math.sin(s);
          } else if (e < 3.8) { // inside the cabin, looking down the bay at the squad jogging out of the open ramp
            const k = (e - 2.0) / 1.8;
            _a.set(0.15 * Math.sin(e * 1.3), 1.65, lerp(-2.0, 0.2, k)); tr.root.localToWorld(_a); cp = _a.clone(); _a.set(0, 1.1, 7.0); tr.root.localToWorld(_a); cl = _a.clone();
            fv = 60; shake = Math.max(shake, 0.2); rl = 0.03 * Math.sin(e * 9);
          } else { // wide: the burning transport above, the squad falling below
            cp = pp.clone().add(V3(rx * 34 - fr.fx * 6, -10, rz * 34 - fr.fz * 6)); cl = pp.clone().lerp(lead, 0.45);
            fv = lerp(36, 44, clamp((e - 3.8) / 2.2)); rl = -0.05;
          }
          look(cp, cl, fv, rl);
        },
      });
    }
    { // 3. free-fall, canopies pop
      const fr = frame(st.run, 2.0), ALT0 = 130, OPEN = 2.2, form = [[0, 0], [-3.5, 4], [-3.5, -4], [-7, 0.5]];
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
          if (s > OPEN && !popped) { popped = true; shake = 1; punch(10); sfx('thud', 0.9); snd('thud', 0.8); trans('smash'); }
          ev1('c1', e > 1.3, () => trans('whip'));
          const lead = V3(A[0].x, A[0].fy + 0.4, A[0].z), tp = sst((e - OPEN) / 1.6);
          let cp, fv, rl = 0;
          if (e < 1.3) { cp = V3(lead.x - fr.fx * 3, lead.y - 8, lead.z - fr.fz * 3); fv = 62; rl = 0.12; }                    // from below, silhouette against the sky
          else if (e < OPEN) { cp = orb(lead, fr.hd + 1.2 + (e - 1.3) * 1.4, 9, 0.8); fv = 44; rl = -0.1; }                    // fast orbit
          else { cp = orb(lead, fr.hd + 2.6 + (e - OPEN) * 0.5, lerp(7, 13, tp), lerp(2.6, 5, tp)); fv = lerp(30, 42, tp); }   // canopy bloom, pull back
          spd = e < OPEN ? 0.9 : 0;
          look(cp, lead, fv, rl + 0.05 * Math.sin(s * 2));
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
              fx.burst(p.x, gy(p.x, p.z) + 0.2, p.z, 0xcdb88a, 14, 5, 0.6, 0.35, 2, 6);
              if (i === 0) { slow(0.35, 0.55); punch(6); shake = Math.max(shake, 0.7); snd('thud', 0.9); }
            }
            const run = s - a.lt - 0.5, p = fr.pt(a.lf + (run > 0 ? 6.5 * run : 0), start[i][1]);
            place(a, p, facing(fr));
            if (s - a.lt < 1) ch.place(V3(a.x, gy(a.x, a.z), a.z), a.yaw, 0, 1, clamp((s - a.lt) / 0.8)); else ch.hide();
            if (i === 1 && run > 0.3 && !dived) { dived = true; act(a, 'dive', 0.9); }
          }
          spd = s > 2.2 ? 0.45 : 0;
          look(fr.pt(lerp(16, 6, sst(u)), lerp(3.5, 5.5, u), lerp(1.0, 1.8, u)), fr.pt(2.4 * Math.min(s, 1.4) + 6.5 * Math.max(0, s - 1.7), 0, lerp(2.5, 1.3, sst(s / 1.3))), 34, 0);
        },
      });
    }
    { // 5. contact: rush, slow-mo dive, reload, grenade
      const fr = frame(st.fight, 1.0), dies = [1.7, 2.3, 2.9];
      add('contact', {
        ts: (e) => 1 - 0.8 * Math.min(sst((e - 1.9) / 0.12), 1 - sst((e - 2.6) / 0.5)) - 0.72 * Math.min(sst((e - 4.75) / 0.1), 1 - sst((e - 5.4) / 0.5)),
        enter() { kit([...A.slice(0, 4), ...B.slice(0, 6)], ['vanguard', 'stinger', 'p9']); A.slice(0, 4).forEach((a, i) => { a.ads = true; a.crouch = i % 2 === 1; }); },
        update(s, dt, e) {
          for (let i = 0; i < 4; i++) place(A[i], fr.pt(0, (i - 1.5) * 2.6), facing(fr));
          for (let i = 0; i < 6; i++) {
            if (i < 3) place(B[i], fr.pt(Math.max(9, 38 - 5.5 * s) + (i % 2) * 3, (i - 1.5) * 3 + Math.sin(s * 3 + i) * 1.2), facing(fr) + PI);
            else place(B[i], fr.pt(Math.max(12, 42 - 5.2 * s) + (i % 2) * 2, (i - 4) * 3.4), facing(fr) + PI);
          }
          for (let i = 0; i < 3; i++) if (!B[i].dead && e > dies[i]) kill(B[i], i === 2);
          // the slow-mo dive now travels (5.5 m forward, a little to the right) instead of rolling on the spot
          ev1('dive', e > 1.9, () => { A[2].crouch = false; act(A[2], 'dive', 0.9, { mv: [fr.fx * 5.5 + fr.fz * 1.4, fr.fz * 5.5 - fr.fx * 1.4] }); });
          ev1('hurt', e > 2.2, () => hurt(A[1]));
          ev1('rl', e > 3.35, () => { A[1].rl = true; });
          ev1('throw', e > 4.0, () => {
            triggerMelee(A[2].ud, 'swing');
            grenadeFx(chest(A[2]), fr.pt(19, 0, 0.3), 0.85, () => {
              const p = fr.pt(19, 0); explode(p.x, p.y, p.z, 1.6); impactFrame(0.05);
              for (let i = 3; i < 6; i++) launch(B[i], fr.fx * 7 + fr.fz * (i - 4) * 3, 8 + i, fr.fz * 7 - fr.fx * (i - 4) * 3);
            });
          });
          if (e < 3.3) volley(A.slice(0, 4), B.slice(0, 3), s, 0.14, 0.02);
          else if (e < 4.6) volley([A[0], A[2], A[3]], B.slice(3, 6), s, 0.1, 0.03);
          let cp, cl, fv = 34, rl = 0;
          if (e < 2.0) { cp = fr.pt(-3.2 + e * 0.35, 1.3, 1.1); cl = fr.pt(18, 0, 1.3); fv = lerp(36, 30, e / 2); }
          else if (e < 3.2) { const c = chest(A[2]); cp = orb(c, fr.hd + lerp(0.4, 2.4, (e - 2.0) / 1.2), 3.4, 0.2); cl = c; fv = 40; rl = 0.1 * Math.sin(e * 5); }
          else if (e < 4.7) { cp = fr.pt(1.2, -0.1, 1.25); cl = fr.pt(0.3, -1.3, 1.15); fv = 26; }
          else { const k = clamp((e - 4.7) / 1.3); cp = fr.pt(lerp(-6, -16, k), lerp(4, 8, k), lerp(1.8, 5, k)); cl = fr.pt(14, 0, 1.5); fv = 36; }
          ev1('c1', e > 2.0, () => trans('whip')); ev1('c2', e > 3.2, () => trans('smash')); ev1('c3', e > 4.7, () => trans('whip'));
          look(cp, cl, fv, rl);
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
            h.cut = ci; h.weapon = W(guns[ci]); equipNow(h.ud, h.weapon); h.ads = ci % 2 === 1; h._f = 0; shake = Math.max(shake, 0.5); punch(4);
            if (ci > 0) trans(ci % 3 === 0 ? 'strobe' : ci % 2 ? 'whip' : 'smash');
            const d0 = ALL[h.weapon]; call(d0.name.toUpperCase(), d0.slot === 'side' ? 'SECONDARY' : 'PRIMARY', cd + 0.04);
          }
          place(h, fr.pt(0, 0), facing(fr));
          const d = ALL[h.weapon], tgt = fr.pt(40, 0, 1.5), n = d.auto ? 4 : 1, gap = d.auto ? 0.07 : 0;
          while (h._f < n && ce > 0.2 + h._f * gap) { fire(h, tgt.x, tgt.y, tgt.z, 0.004); h._f++; }
          const c = cams[ci](); ensureWeapon(h.ud, h.weapon).group.getWorldPosition(_t);
          const lt = c[3] ? fr.pt(12, 0, 1.4) : _t.clone();
          look(c[0].lerp(lt, ce * 0.2), lt, c[1] - ce * 3, c[2] + (ci % 2 ? ce * 0.1 : -ce * 0.1)); // slow push-in on every cut
        },
      });
    }

    // ---------- ability reels ----------
    const RF = frame(st.reel, 1.9);
    let done = {}, bs = [], cutI2 = -1, dome = null, waveE = null, mineE = null;
    const once = (k, c, fn) => { if (c && !done[k]) { done[k] = 1; fn(); } };
    const stand = (a, f, r, off = 0) => place(a, RF.pt(f, r), facing(RF) + off);
    const rcam = (cs, cd, p, c, l) => { const k = clamp(cs / cd); look(orb(c, RF.hd + lerp(p[0], p[1], k), lerp(p[2], p[3], k), lerp(p[4], p[5], k)), l || c, lerp(p[6], p[7], k), p[8] || 0); };
    const opChest = () => chest(A[0]);
    const foes = (f, rs, off = PI) => bs.forEach((b, i) => stand(b, f, rs(i), off));
    const slay = (b, head, style) => { kill(b, head, style); punch(3); if (head) hitStop(0.06); };
    const blowBack = (b, v = 6) => { launch(b, RF.fx * v + (Math.random() - 0.5) * 2, 6 + Math.random() * 3, RF.fz * v + (Math.random() - 0.5) * 2); punch(3); };
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
          if (cs > 0.2) { volley([A[0]], bs, cs, 0.062, 0.04); shake = Math.max(shake, 0.18); if (Math.random() < 0.6) fx.burst(A[0].x, gnd(A[0]) + 0.15, A[0].z, 0xff8a2b, 1, 2.2, 0.5, 0.25, 1.5, -2); }
          once('k0', cs > 0.65, () => blowBack(bs[0], 7)); once('k1', cs > 0.95, () => { blowBack(bs[1], 6); hitStop(0.06); }); once('k2', cs > 1.25, () => blowBack(bs[2], 8));
          rcam(cs, 1.6, [2.5, 3.9, 3.2, 2.4, 0.5, 1.4, 38, 32, 0.05], opChest(), RF.pt(10, 0, 1.3));
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
          once('k', cs > 1.3, () => { // the dome detonates outward
            ringFx(A[0].x, gnd(A[0]) + 0.3, A[0].z, 0x4cc9ff, 9, 0.5); fx.burst(A[0].x, gnd(A[0]) + 1, A[0].z, 0x7fe3ff, 30, 9, 0.7, 0.3);
            shake = 1; punch(6); snd('boom', 0.5); bs.forEach((b) => blowBack(b, 6));
          });
          rcam(cs, 1.6, [2.6, 3.4, 3.4, 4.2, 0.9, 1.3, 36, 32], opChest(), RF.pt(8, 0, 1.2));
        } },
      spectre: { sub: 'PHASE ROUNDS', nB: 2,
        go() { blockProp(RF.pt(8, 0), 7, 3, 0.5, RF.hd, 1.7); ringFx(A[0].x, gnd(A[0]) + 0.1, A[0].z, 0xa78bff, 2.4, 0.6); sfx('crossLatch', 1); },
        run(cs) {
          stand(A[0], 0, 0); stand(bs[0], 14, 1.2, PI); stand(bs[1], 16, -2, PI);
          [0.45, 0.85].forEach((t, i) => once('s' + i, cs > t, () => {
            const b = bs[i], c = chest(b), m = opChest(), fe = i ? 16 : 14, k = (8 - 0.6) / (fe - 0.6);
            fakeShot(A[0], c.x, c.y, c.z, 0xa78bff, 0.08, true); snd('zap', 0.7);
            ringFx(lerp(m.x, c.x, k), lerp(m.y, c.y, k), lerp(m.z, c.z, k), 0xc9b6ff, 1.1, 0.35, false);
            delay(0.12, () => slay(b, i === 0));
          }));
          rcam(cs, 1.6, [1.57, 1.9, 7, 6, 1.2, 1.6, 34, 30], RF.pt(6, 0, 0.8), RF.pt(8, 0, 1.4));
        } },
      sentinel: { sub: 'PULSE SCAN', nB: 3,
        go() { blockProp(RF.pt(7, 0), 8, 3, 0.5, RF.hd, 1.7); ringFx(A[0].x, gnd(A[0]) + 0.15, A[0].z, 0xff7a4a, 44, 0.9); sfx('crossCock', 1); },
        run(cs) {
          stand(A[0], 0, 0); stand(bs[0], 13, 6.2, PI); stand(bs[1], 12, -1.5, PI); stand(bs[2], 16, 2, PI);
          bs.forEach((b, i) => once('m' + i, cs > 0.12 + Math.hypot(b.x - A[0].x, b.z - A[0].z) / 48, () => { markerFx(b, 0xff5a3c, 1.5); pillarFx(b.x, gnd(b), b.z, 0xff5a3c, 9, 1.2); snd('zap', 0.4); }));
          if (cs > 1.0) volley([A[0]], [bs[0]], cs, 0.1, 0.015);
          once('k', cs > 1.35, () => slay(bs[0], true));
          rcam(cs, 1.6, [2.7, 3.1, 3.0, 2.4, 0.7, 1.1, 34, 30], opChest(), RF.pt(10, 1, 1.8));
        } },
      gale: { sub: 'BLAST JUMP', nB: 3,
        go() {},
        run(cs, dt) {
          const o = A[0]; foes(15, (i) => (i - 1) * 3);
          if (!o.jv && !done.j) stand(o, 0, 0);
          once('j', cs > 0.3, () => {
            o.jv = { vx: RF.fx * 12, vz: RF.fz * 12, vy: 10 }; o.air = true; o.fy = gy(o.x, o.z);
            explode(o.x, o.fy + 0.2, o.z, 0.9); ringFx(o.x, o.fy + 0.2, o.z, 0xbff3ff, 3, 0.5);
          });
          if (o.jv) {
            const j = o.jv; o.x += j.vx * dt; o.z += j.vz * dt; j.vy -= 18 * dt; o.fy += j.vy * dt;
            fx.smokeTrail(o.x, o.fy, o.z, 1.2); fx.flame(o.x, o.fy + 0.2, o.z, 0.6);
            const g = gy(o.x, o.z);
            if (o.fy <= g && j.vy < 0) { o.fy = null; o.jv = null; o.air = false; act(o, 'landFlare', 0.5); dust(o.x, o.z, 2.4); sfx('land', 0.8); ringFx(o.x, g + 0.2, o.z, 0xffd9a0, 7, 0.5); }
          }
          once('f1', cs > 0.85, () => { const c = chest(bs[1]); fire(o, c.x, c.y, c.z, 0.01); delay(0.06, () => slay(bs[1], false)); });
          once('f2', cs > 1.1, () => { const c = chest(bs[0]); fire(o, c.x, c.y, c.z, 0.01); delay(0.06, () => slay(bs[0], true)); });
          rcam(cs, 1.6, [1.6, 2.2, 6.5, 7.5, 0.5, 1.8, 38, 34], chest(o), RF.pt(8, 0, 3));
        } },
      cinder: { sub: 'FIRESTORM', nB: 3,
        go() {},
        run(cs) {
          stand(A[0], 0, 0); const z0 = RF.pt(14, 0);
          bs.forEach((b, i) => { if (cs < 0.55) stand(b, 14 + (i - 1) * 1.2, (i - 1) * 2.4, PI); else if (!b.dead) place(b, RF.pt(14 + Math.sin(cs * 9 + i * 2) * 1.6, (i - 1) * 2.4 + Math.cos(cs * 8 + i) * 1.4), facing(RF) + cs * 3 * (i - 1)); });
          once('fl', cs > 0.2, () => fire(A[0], z0.x, z0.y + 0.5, z0.z, 0.004));
          once('z', cs > 0.5, () => {
            zoneFx(z0.x, z0.y, z0.z, 4.2, 0xff6a1a, 1.1); explode(z0.x, z0.y, z0.z, 0.8);
            for (let i = -1; i <= 1; i++) pillarFx(z0.x + RF.fz * i * 2.6, z0.y, z0.z - RF.fx * i * 2.6, 0xff7a2a, 9, 1.0);
          });
          if (cs > 0.55) fx.ember(z0.x, z0.y + 1, z0.z, 2, 3);
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
          once('m', cs > 0.9, () => { ringFx(A[0].x, gnd(A[0]) + 0.1, A[0].z, 0x6dffb0, 2.2, 0.8); sfx('pouch', 1); punch(4); snd('zap', 0.5); });
          if (cs > 0.9 && cs < 1.5) fx.rise(A[0].x, gnd(A[0]) + 0.2, A[0].z, 0x6dffb0, 2);
          if (cs > 1.0) volley([A[0]], bs, cs, 0.12, 0.02);
          once('k0', cs > 1.25, () => slay(bs[0], false)); once('k1', cs > 1.45, () => slay(bs[1], true));
          rcam(cs, 1.6, [0.3, -0.3, 2.6, 2.0, 0.3, 0.45, 32, 28], opChest());
        } },
      wisp: { sub: 'PHASE THROUGH WALLS', nB: 2,
        go() {
          // the wall the dash goes through: solid at first, a glowing ghost while the operator is inside it
          const wl = blockProp(RF.pt(4.6, 0), 8, 3.4, 1.2, RF.hd, 1.75), wm = wl.obj.material;
          wm.transparent = true; wm.depthWrite = false; wm.emissive = new THREE.Color(0x2a6ad0);
          wl.fn = (k, ob, dt, e) => { const ph = sst((e.t - 0.3) / 0.1) * (1 - sst((e.t - 0.95) / 0.2)); wm.opacity = 1 - 0.8 * ph; wm.emissiveIntensity = 1.2 * ph; };
          ringFx(A[0].x, gnd(A[0]) + 0.1, A[0].z, 0x6ad0ff, 2.4, 0.5); sfx('crossLatch', 1);
        },
        run(cs) {
          const o = A[0], WD = 0.25, DT = 0.75;
          // 0..4 m: fast run-up, 4..5.2 m (the wall's thickness): slow wade through, 5.2..9.5 m: burst out the far side
          const dashP = (c) => { const x = clamp((c - WD) / DT); return x < 0.34 ? 4.0 * Math.pow(x / 0.34, 1.7) : x < 0.66 ? lerp(4.0, 5.2, (x - 0.34) / 0.32) : 5.2 + 4.3 * (1 - Math.pow(1 - (x - 0.66) / 0.34, 2.2)); };
          const p = dashP(cs);
          stand(o, p, 0); stand(bs[0], 12.2, 1.4, PI); stand(bs[1], 13.4, -1.5, PI);
          once('d', cs > WD, () => {
            const a = RF.pt(0, 0, 1.1), b2 = RF.pt(9.5, 0, 1.1);
            beamFx(a, b2, 0x6ad0ff, 0.5, 0.8, true); ringFx(a.x, a.y, a.z, 0x6ad0ff, 2, 0.4, false); act(o, 'dash', 0.7); sfx('jump2', 1); shake = Math.max(shake, 0.4); snd('whoosh', 0.8);
          });
          once('in', p >= 4.0, () => { const q = RF.pt(3.85, 0, 1.3); ringFx(q.x, q.y, q.z, 0x9fe8ff, 2.6, 0.45, false); fx.burst(q.x, q.y, q.z, 0x6ad0ff, 16, 5, 0.5, 0.26, 1.5, 0); snd('zap', 0.7); punch(4); });
          once('out', p >= 5.2, () => {
            const q = RF.pt(5.35, 0, 1.3); ringFx(q.x, q.y, q.z, 0x9fe8ff, 3, 0.45, false); fx.burst(q.x, q.y, q.z, 0x6ad0ff, 20, 6, 0.5, 0.28, 1.5, 0);
            snd('whoosh', 0.8); punch(6); shake = Math.max(shake, 0.7); flare(q, 0.9);
          });
          if (cs > WD && cs < WD + DT) fx.burst(o.x, gnd(o) + 1.1, o.z, 0x6ad0ff, 2, 3, 0.5, 0.22, 1.5, 0); // ghost sparks trailing the operator
          spd = cs > WD && cs < WD + DT ? 0.9 : 0;
          if (cs > 1.0) volley([o], bs, cs, 0.07, 0.04);
          once('k0', cs > 1.2, () => slay(bs[0], false)); once('k1', cs > 1.4, () => slay(bs[1], true));
          // three-quarter view from behind-right so the operator is seen sinking into the wall and coming out the other side
          const kk = sst((cs - 0.8) / 0.7), cc = RF.pt(lerp(4.4, 8.2, kk), 0, 1.0);
          look(orb(cc, RF.hd + lerp(1.95, 1.65, clamp(cs / 1.6)), lerp(13.5, 10.5, kk), 1.6), RF.pt(lerp(4.6, 9.8, kk), 0, 1.3), lerp(40, 33, kk), 0.03);
          cam.fov += 12 * Math.sin(PI * clamp((cs - WD) / DT));
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
            const p = RF.pt(5.2, 0); explode(p.x, p.y, p.z, 1.4); launch(b, RF.fx * 5, 9, RF.fz * 5); slow(0.2, 0.5); impactFrame(0.05); if (mineE) mineE.t = mineE.dur;
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
            stand(o, 0, 0); ringFx(p0.x, p0.y, p0.z, 0x7affd1, 3.2, 0.5, false); fx.burst(p0.x, p0.y, p0.z, 0x7affd1, 18, 6, 0.6, 0.3); sfx('respawn', 1); shake = 0.5; punch(6); snd('zap', 0.8);
          });
          once('k', cs > 0.8, () => slay(bs[0], false));
          rcam(cs, 1.6, [1.7, 1.9, 6, 5, 0.8, 1.3, 34, 36], chest(o), RF.pt(6, 0, 1.2));
        } },
      katana: { sub: 'BLINK SLASH', nB: 3, go() {},
        run(cs) {
          const o = A[0]; foes(0, () => 0); bs.forEach((b, i) => stand(b, 7 + i * 2.6, i % 2 ? 0.7 : -0.6, PI));
          once('s', cs > 0.3, () => { triggerMelee(o.ud, 'swing'); act(o, 'dash', 0.26); beamFx(RF.pt(0, 0, 1.0), RF.pt(14, 0, 1.0), 0x9fe8ff, 0.5, 0.35); sfx('jump2', 1); snd('whoosh', 0.9); });
          stand(o, 14 * sst((cs - 0.3) / 0.14), 0);
          spd = cs > 0.3 && cs < 0.5 ? 1 : 0;
          bs.forEach((b, i) => once('c' + i, cs > 0.3 + ((7 + i * 2.6) / 14) * 0.14 + 0.02, () => {
            const p = chest(b); beamFx(V3(p.x - RF.fz * 1.3, p.y + 0.5, p.z + RF.fx * 1.3), V3(p.x + RF.fz * 1.3, p.y - 0.5, p.z - RF.fx * 1.3), 0xe8fbff, 0.12, 0.25);
            sfx('stab', 0.7); punch(3); delay(0.14, () => kill(b, i === 1, 'dieSide'));
          }));
          once('fin', cs > 0.62, () => { impactFrame(0.06); slow(0.25, 0.6); });
          rcam(cs, 1.2, [1.2, 0.5, 6, 5, 0.6, 1.0, 34, 30], RF.pt(6, 0, 0.4), RF.pt(7, 0, 1.2));
        } },
      maul: { sub: 'GROUND SLAM', nB: 3, go() {},
        run(cs) {
          const o = A[0]; stand(o, 5 * sst((cs - 0.15) / 0.4), 0);
          once('l', cs > 0.15, () => { act(o, 'slam', 0.7); triggerMelee(o.ud, 'swing'); });
          bs.forEach((b, i) => { if (cs < 0.55) stand(b, 8 + (i === 1 ? 1.5 : 0), (i - 1) * 2.8, PI); });
          once('s', cs > 0.55, () => {
            const p = RF.pt(5, 0); ringFx(p.x, p.y + 0.1, p.z, 0xff9a3c, 9, 0.55); ringFx(p.x, p.y + 0.1, p.z, 0xffd070, 5, 0.4); explode(p.x, p.y, p.z, 1.5);
            sfx('thud', 1); hitStop(0.08);
            bs.forEach((b, i) => launch(b, RF.fx * 4 + (i - 1) * RF.fz * 3, 7, RF.fz * 4 - (i - 1) * RF.fx * 3));
          });
          rcam(cs, 1.2, [0.2, 0.5, 6, 5, 0.6, 1.0, 34, 38], RF.pt(3, 0, 1), RF.pt(5, 0, 1.4));
        } },
      hookblade: { sub: 'GRAPPLE PULL', nB: 1,
        go() { blockProp(RF.pt(14, 0), 5, 7, 5, RF.hd, 1.3); },
        run(cs) {
          const o = A[0], b = bs[0], top = RF.pt(14, 0, 7), g0 = gy(top.x, top.z), g1 = gy(RF.pt(0, 0).x, RF.pt(0, 0).z);
          stand(b, 14, 0.8, PI); b.fy = g0 + 7;
          once('h', cs > 0.15, () => { ropeFx(o, V3(top.x - RF.fx * 2.6, g0 + 7, top.z - RF.fz * 2.6), 1.0); sfx('crossLatch', 1); snd('whoosh', 0.7); });
          const k = sst((cs - 0.3) / 0.55);
          spd = k > 0 && k < 1 ? 0.8 : 0;
          if (cs < 0.3) stand(o, 0, 0);
          else { const p = RF.pt(lerp(0, 12, k), 0); o.x = p.x; o.z = p.z; o.fy = lerp(g1, g0 + 7, k); o.air = k > 0 && k < 1; o.yaw = facing(RF); }
          once('a', cs > 0.9, () => { triggerMelee(o.ud, 'swing'); act(o, 'lunge', 0.4); sfx('stab', 0.8); punch(5); delay(0.15, () => slay(b, true, 'dieBack')); });
          rcam(cs, 1.2, [1.4, 1.8, 7, 6, 0.8, 3.5, 36, 32], chest(o), RF.pt(11, 0, 4));
        } },
      rapier: { sub: 'RIPOSTE', nB: 1,
        go() { bs[0].weapon = 'knife'; equipNow(bs[0].ud, 'knife'); },
        run(cs) {
          const o = A[0], b = bs[0]; stand(o, 0, 0); stand(b, lerp(4.5, 2.1, sst(cs / 0.3)), 0.1, PI);
          once('s', cs > 0.18, () => triggerMelee(b.ud, 'swing'));
          once('p', cs > 0.4, () => {
            const p = RF.pt(1.2, 0.2, 1.4); fx.burst(p.x, p.y, p.z, 0xffffff, 14, 6, 0.4, 0.28); fx.burst(p.x, p.y, p.z, 0x9fe8ff, 10, 4, 0.5, 0.3);
            ringFx(p.x, p.y, p.z, 0xcfeaff, 2.2, 0.35, false); sfx('clang', 1); hurt(b, -1, false); shake = 0.6; impactFrame(0.05); hitStop(0.06); flare(p, 0.9);
          });
          once('c', cs > 0.6, () => { triggerMelee(o.ud, 'swing'); act(o, 'lunge', 0.4); });
          once('k', cs > 0.78, () => { slay(b, true, 'dieBack'); sfx('stab', 0.8); });
          rcam(cs, 1.2, [1.57, 1.57, 4.2, 3.0, 0.6, 0.9, 34, 28], RF.pt(1.2, 0, 0.5), RF.pt(1.2, 0, 1.3));
        } },
      riftblade: { sub: 'WAVE SLASH', nB: 3, go() {},
        run(cs) {
          const o = A[0]; stand(o, 0, 0); bs.forEach((b, i) => stand(b, 8 + i * 4.2, (i - 1) * 0.8, PI));
          once('sw', cs > 0.15, () => { triggerMelee(o.ud, 'swing'); sfx('swing', 1); });
          once('w', cs > 0.3, () => {
            const p = RF.pt(1.2, 0, 1.3); waveE = waveFx(p, V3(RF.fx, 0, RF.fz), 34, 1.0); sfx('swing', 1); shake = 0.6; punch(5);
            lightningFx(V3(p.x + RF.fx * 8, p.y + 40, p.z + RF.fz * 8), V3(p.x + RF.fx * 8, p.y, p.z + RF.fz * 8), 0xbff3ff, 0.5, 0.3, 5); snd('crack', 0.6);
          });
          if (waveE) {
            const wp = waveE.obj.position, wf = (wp.x - RF.S.x) * RF.fx + (wp.z - RF.S.z) * RF.fz;
            bs.forEach((b, i) => once('k' + i, wf > 8 + i * 4.2, () => { fx.burst(b.x, gnd(b) + 1.2, b.z, 0x7fe8ff, 12, 5, 0.5, 0.3); slay(b, false, i === 1 ? 'dieFwd' : 'dieBack'); }));
          }
          rcam(cs, 1.2, [3.3, 3.7, 4.5, 6.5, 1.2, 2.4, 36, 32], RF.pt(2, 0, 0.8), RF.pt(10, 0, 1.2));
        } },
    };
    const addReel = (name, ids) => {
      const each = (TM[name].t1 - TM[name].t0) / ids.length;
      add(name, {
        enter() { cutI2 = -1; },
        update(s, dt, e) {
          const i = Math.min(ids.length - 1, Math.floor(e / each)), r = REEL[ids[i]], cs = e - i * each;
          if (i !== cutI2) {
            cutI2 = i; cutKit(ids[i], r.nB); const d0 = ALL[ids[i]]; call(((d0 && d0.name) || ids[i]).toUpperCase(), r.sub, each + 0.05); shake = Math.max(shake, 0.4); punch(5);
            if (i > 0) trans(i % 2 ? 'whip' : 'smash');
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

    { // utilities: Scout Drone takes off and marks the enemy, then the Ridgeback Lottery
      const fr = frame(st.ops, 1.0), dr = P.drone || (P.drone = makeDrone(scene));
      let dd = false, ll = false;
      add('util', {
        enter() { dd = ll = false; kit([A[0], B[0], B[1], B[2]], [droneId || 'vanguard', 'vanguard', 'vanguard', 'vanguard']); },
        update(s, dt, e) {
          const h = A[0]; place(h, fr.pt(0, 0), facing(fr));
          B.slice(0, 3).forEach((b, i) => place(b, fr.pt(36 + i * 3.5, (i - 1) * 6), facing(fr) + PI));
          const k = clamp((e - 0.9) / 1.5), dp = fr.pt(lerp(0.5, 36, k * k), Math.sin(k * 4) * 1.5, lerp(1.4, 11, sst(k)));
          if (e < 2.3) {
            if (droneId && !dd && s > 0.15) { dd = true; triggerMelee(h.ud, 'deploy'); }
            if (e > 0.9) { dr.root.visible = true; dr.root.position.copy(dp); dr.root.rotation.set(0.25, facing(fr), 0); dr.rot.forEach((r) => { r.rotation.y += 40 * dt; }); }
            ev1('lift', e > 0.9, () => { ringFx(h.x, gnd(h) + 0.1, h.z, 0x9fe8ff, 2.4, 0.5); snd('zap', 0.6); punch(4); });
            ev1('mk', e > 1.7, () => { B.slice(0, 3).forEach((b) => markerFx(b, 0xff5a3c, 1.4)); trans('whip'); });
            if (e < 1.7) look(orb(chest(h), fr.hd + 2.9 - 2.5 * sst(e / 1.7), lerp(2.8, 2.1, e / 1.7), 0.25), chest(h).add(V3(0, -0.12, 0)), 34, 0);
            else look(V3(dp.x - fr.fx * 6 + fr.fz * 2, dp.y + 1.8, dp.z - fr.fz * 6 - fr.fx * 2), dp, 42, 0.06);
          } else {
            dr.root.visible = false;
            if (!ll) {
              ll = true; h.weapon = W(lotId || 'vanguard'); equipNow(h.ud, h.weapon); if (lotId) triggerMelee(h.ud, 'deploy');
              const p = fr.pt(0, 0); ringFx(p.x, p.y + 0.1, p.z, 0xc77dff, 5, 0.9); pillarFx(p.x, p.y, p.z, 0xc77dff, 6, 1.6); snd('zap', 0.8); trans('smash'); punch(5);
            }
            fx.rise(h.x, gnd(h) + 0.2, h.z, 0xd9a0ff, 2);
            const k2 = (e - 2.3) / 1.7; look(orb(chest(h), fr.hd + lerp(0.2, 1.3, sst(k2)), lerp(3.4, 2.4, k2), lerp(-0.6, 0.5, k2)), chest(h), 28, 0);
          }
        },
      });
    }
    { // sniper bullet-cam: one round, one kill
      const fr = frame(st.air2, 2.2), TG = 72, hold = { p: V3(0, 0, 0), m: null };
      let p0 = null, p1 = null;
      add('bullet', {
        ts: (e) => (e < 0.85 ? 1 : e < 3.7 ? 0.2 : lerp(0.2, 1, sst((e - 3.7) / 0.3))),
        enter() {
          kit([A[0], B[0], B[1]], ['longbow', 'vanguard', 'vanguard']); A[0].ads = true; A[0].crouch = true; p0 = p1 = null;
          const bm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.34, 8), mkMat(0xffe9b0, 1)); bm.visible = false; hold.m = bm;
          addT(bm, 5, (k, ob) => { ob.position.copy(hold.p); }, true);
        },
        update(s, dt, e) {
          const a = A[0], b = B[0], dec = B[1];
          place(a, fr.pt(0, 0), facing(fr)); place(b, fr.pt(TG, 0), facing(fr) + PI); place(dec, fr.pt(TG * 0.42, 2.4), facing(fr) + PI);
          const head = V3(b.x, gnd(b) + 1.62, b.z);
          ev1('glint', e > 0.35, () => flare(fr.pt(0.5, 0.2, 1.3), 1.1));
          ev1('shot', e > 0.85, () => {
            const w = ensureWeapon(a.ud, a.weapon), m = w && w.muzzle;
            if (m) { m.getWorldPosition(_o); (a.flashes[a.weapon] || (a.flashes[a.weapon] = bullets.attachFlash(m, 0.7))).fire(); } else _o.copy(fr.pt(0.5, 0, 1.3));
            triggerShootKick(a.ud); sfx('shot', 1, { snd: 'marshal' }, 'heroShot'); shake = 0.8; punch(6); snd('sweep', 0.6);
            p0 = _o.clone(); p1 = head.clone(); hold.m.visible = true; hold.m.quaternion.setFromUnitVectors(AY, p1.clone().sub(p0).normalize());
          });
          const k = p0 ? clamp((e - 0.85) / 1.95) : 0;
          if (p0 && k < 1) {
            hold.p.lerpVectors(p0, p1, k); fx.smokeTrail(hold.p.x, hold.p.y, hold.p.z, 0.4); fx.burst(hold.p.x, hold.p.y, hold.p.z, 0xffd080, 1, 0.5, 0.4, 0.12, 0, 0);
          }
          ev1('near', k > 0.42, () => { ringFx(hold.p.x, hold.p.y, hold.p.z, 0xcfeaff, 2.4, 0.5, false); snd('whoosh', 0.7); hurt(dec, 1, false); punch(4); });
          ev1('imp', !!p0 && e >= 2.8, () => {
            hold.m.visible = false; kill(b, true, 'dieBack');
            ringFx(head.x, head.y, head.z, 0xffffff, 3.2, 0.45, false); fx.burst(head.x, head.y, head.z, 0xffd27a, 18, 6, 0.6, 0.25);
            impactFrame(0.08); hitStop(0.1); shake = 1.1; punch(8); snd('impact', 1); trans('smash', true);
          });
          ev1('eject', e > 3.78, () => { ensureWeapon(a.ud, a.weapon).group.getWorldPosition(_t); bullets.ejectShell(_t, _n.set(1.2, 1.4, 0)); sfx('click', 0.6); trans('dip', true); });
          let cp, cl, fv, rl = 0;
          if (e < 0.85) { cp = fr.pt(lerp(-0.4, 0.4, e / 0.85), 1.6, 1.15); cl = fr.pt(0.5, 0, 1.2); fv = lerp(30, 24, e / 0.85); }
          else if (p0 && e < 2.8) { // riding the bullet, spiralling
            const dir = p1.clone().sub(p0).normalize(), side = V3(dir.z, 0, -dir.x).normalize(), ang = e * 3.4;
            cp = hold.p.clone().addScaledVector(dir, -2.4).addScaledVector(side, Math.cos(ang) * 0.6).addScaledVector(AY, 0.25 + Math.sin(ang) * 0.5);
            cl = hold.p.clone().addScaledVector(dir, 4); fv = 46; rl = Math.sin(ang) * 0.18; spd = 0.5;
          } else if (e < 3.75) { cp = orb(head, fr.hd + 1.1 + (e - 2.8) * 0.9, 2.8, 0.2); cl = head; fv = 34; }
          else { cp = fr.pt(0.9, 1.5, 1.25); cl = fr.pt(0.4, 0, 1.2); fv = 26; }
          look(cp, cl, fv, rl);
        },
      });
    }
    { // car + bike chase: ramp jump, barrel roll, a van that gets blown up
      const fr = frame(st.chase, 0.4), FJ = 16.4;
      const path = (f, lat, extraYaw) => {
        const r = lat + 16 * Math.sin(f * 0.045), dr = 0.72 * Math.cos(f * 0.045), dx = fr.fx + fr.fz * dr, dz = fr.fz - fr.fx * dr;
        return { p: fr.pt(f, r), yaw: Math.atan2(-dx, -dz) + extraYaw, dr };
      };
      const jmp = (f) => { const d = (f - FJ) / 10; return Math.abs(d) >= 1 ? { l: 0, p: 0, d: -1 } : { l: 4.5 * (1 - d * d), p: -d * 0.42, d }; };
      let dt_ = 0, vt = null, vl = V3(0, 0, 0);
      add('chase', {
        ts: (e) => (e < 3.0 ? 1 : e < 4.1 ? 0.35 : lerp(0.35, 1, sst((e - 4.1) / 0.35))),
        enter() {
          kit([], []); dt_ = 0; vt = null;
          const rp0 = path(FJ - 11, 0), ramp = new THREE.Mesh(new THREE.BoxGeometry(9, 0.5, 11), new THREE.MeshStandardMaterial({ color: 0x8a7a5e, roughness: 0.9 }));
          ramp.position.set(rp0.p.x, rp0.p.y + 0.55, rp0.p.z); ramp.rotation.set(0.2, rp0.yaw, 0, 'YXZ'); ramp.castShadow = true; addT(ramp, 9, null, true);
        },
        update(s, dt, e, u) {
          const f = -70 + 27 * s, f2 = f - 14, f3 = f - 34;
          const c1 = path(f, 0, 0.5 * Math.sin(f * 0.045)), c2 = path(f2, 2.5, 0), c3 = path(f3, -3, 0.3 * Math.sin(f * 0.045));
          const j1 = jmp(f), j2 = jmp(f2), j3 = jmp(f3);
          poseCar(cars.sedan, c1.p.x, c1.p.z, c1.yaw, 27, dt, { roll: -0.07 * Math.sin(f * 0.045) + (j1.l > 0 ? ((j1.d + 1) / 2) * PI * 2 : 0), steer: 0.2 * Math.sin(f * 0.045), lift: j1.l, pitch: j1.p });
          poseCar(cars.moto, c2.p.x, c2.p.z, c2.yaw, 27, dt, { roll: 0.5 * Math.cos(f2 * 0.045), lift: j2.l, pitch: j2.p * 1.2 });
          if (!vt) poseCar(cars.van, c3.p.x, c3.p.z, c3.yaw, 25, dt, { roll: -0.05, lift: j3.l, pitch: j3.p });
          else {
            stepTum(vt, dt); poseCar(cars.van, vt.x, vt.z, vt.yaw, 0, dt, tumOp(vt));
            vl.set(vt.x, gy(vt.x, vt.z) + vt.h, vt.z);
            if (e > 5.25) { explode(vl.x, vl.y, vl.z, 2.1); impactFrame(0.05); hideCar(cars.van); zoneFx(vl.x, gy(vl.x, vl.z), vl.z, 3.5, 0xff6a1a, 2.5); vt = null; }
          }
          ev1('van', e > 4.35, () => {
            const aim = path(f3 + 9.5, -3, 0), p = c3.p.clone(); vl.copy(p);
            rocketFx(V3(aim.p.x + 18, aim.p.y + 16, aim.p.z + 10), V3(aim.p.x, aim.p.y + 1, aim.p.z), 0.4, () => {
              explode(aim.p.x, aim.p.y + 1, aim.p.z, 1.3);
              vt = mkTum(aim.p.x, aim.p.z, -Math.sin(c3.yaw) * 15, 12, -Math.cos(c3.yaw) * 15, 3.2, 1.4, c3.yaw);
            });
          });
          dt_ += dt; if (dt_ > 0.045) { dt_ = 0; dust(c1.p.x, c1.p.z, 1.3); dust(c2.p.x, c2.p.z, 1); if (!vt) dust(c3.p.x, c3.p.z, 1.4); }
          const rear = V3(c1.p.x + Math.sin(c1.yaw) * 2.3, c1.p.y + 0.6 + j1.l, c1.p.z + Math.cos(c1.yaw) * 2.3); // nitro flame + drift sparks
          fx.flame(rear.x, rear.y, rear.z, 0.9);
          if (j1.l === 0) fx.burst(rear.x, c1.p.y + 0.15, rear.z, 0xffc060, 2, 5, 0.4, 0.18, 1, 8);
          const behind = V3(Math.sin(c1.yaw), 0, Math.cos(c1.yaw));
          let cp, cl, fv, rl = 0;
          if (e < 1.4) { cp = fr.pt(-10, 8, 0.7); cl = c1.p.clone().add(V3(0, 0.8, 0)); fv = lerp(26, 34, e / 1.4); rl = 0.05; }
          else if (e < 3.0) { cp = c1.p.clone().addScaledVector(behind, 7.5).add(V3(0, 2.2, 0)); cl = c1.p.clone().addScaledVector(behind, -6).add(V3(0, 1, 0)); fv = 52; }
          else if (e < 4.2) { const ac = V3(c1.p.x, c1.p.y + j1.l + 1, c1.p.z); cp = orb(ac, c1.yaw + PI * 0.5 + (e - 3.0) * 1.4, 9, 0.5); cl = ac; fv = 34; rl = 0.1; }
          else { cp = orb(vl, c3.yaw + 2.4 + (e - 4.2) * 0.4, 15, 4); cl = vl.clone(); fv = lerp(40, 32, clamp((e - 4.2) / 1.8)); }
          ev1('c1', e > 1.4, () => trans('whip')); ev1('c2', e > 3.0, () => trans('smash')); ev1('c3', e > 4.3, () => trans('whip'));
          spd = e < 3.0 || e > 4.2 ? 0.55 : 0.2;
          look(cp, cl, fv, rl);
        },
      });
    }
    { // the truck charges the squad: rockets, a mid-air tumble, a fireball
      const fr = frame(st.blast, 5.1);
      let tum = null, bl = false;
      const ex = V3(0, 0, 0);
      add('blast', {
        ts: (e) => (e < 1.15 ? 1 : e < 2.45 ? 0.3 : lerp(0.3, 0.9, sst((e - 2.45) / 0.8))),
        enter() { tum = null; bl = false; kit([A[0], A[1], A[2], B[0], B[1]], ['vanguard', 'stinger']); A.slice(0, 3).forEach((a) => { a.ads = true; }); },
        update(s, dt, e) {
          const tf = Math.max(14, 44 - 26 * s), tp = fr.pt(tf, 0), yawT = facing(fr);
          if (!tum) poseCar(cars.truck, tp.x, tp.z, yawT, 24, dt, {});
          else if (!bl) { stepTum(tum, dt); poseCar(cars.truck, tum.x, tum.z, yawT, 0, dt, tumOp(tum)); }
          for (let i = 0; i < 3; i++) place(A[i], fr.pt(-6 - i * 0.6, (i - 1) * 2.4), facing(fr));
          place(B[0], fr.pt(tf + 4, 4.5), facing(fr) + PI); place(B[1], fr.pt(tf + 5, -4.5), facing(fr) + PI);
          const tc = tum ? V3(tum.x, gy(tum.x, tum.z) + tum.h + 1, tum.z) : V3(tp.x, tp.y + 1.2, tp.z);
          if (!tum && e > 0.3 && e < 0.7 && Math.floor(s * 9) !== A[0]._k) { A[0]._k = Math.floor(s * 9); fire(A[0], tc.x, tc.y, tc.z, 0.004); }
          ev1('rk', e > 0.7, () => {
            const tgt = fr.pt(14.1, 0, 1.4);
            [0, 1, 2].forEach((i) => rocketFx(chest(A[i]), tgt, 0.42 + i * 0.05, () => {
              if (i < 2) { explode(tgt.x, tgt.y, tgt.z, 0.8); return; }
              explode(tgt.x, tgt.y, tgt.z, 1.4);
              const p = fr.pt(14.1, 0); tum = mkTum(p.x, p.z, -fr.fx * 9, 15, -fr.fz * 9, -2.6, 1.3, yawT);
              launch(B[0], fr.fx * 4 + fr.fz * 6, 9, fr.fz * 4 - fr.fx * 6); launch(B[1], fr.fx * 4 - fr.fz * 6, 8, fr.fz * 4 + fr.fx * 6);
            }));
          });
          ev1('big', e > 2.2 && !!tum, () => {
            const x = tum.x, z = tum.z, y = gy(x, z) + tum.h; ex.set(x, y, z);
            explode(x, y, z, 2.7); impactFrame(0.06); hitStop(0.08); hideCar(cars.truck); bl = true; zoneFx(x, gy(x, z), z, 4, 0xff6a1a, 2.8);
            // dive for cover: each roll travels (3 m forward, spreading sideways) instead of tumbling on the spot
            A.slice(0, 3).forEach((a, i) => act(a, 'dive', 0.9, { mv: [fr.fx * 3 + fr.fz * (i - 1) * 2.2, fr.fz * 3 - fr.fx * (i - 1) * 2.2] }));
          });
          let cp, cl = tc, fv;
          if (e < 1.15) { cp = fr.pt(-9, 3.2, 1.0); fv = 30; }
          else if (e < 2.6) { cp = orb(tc, fr.hd + PI * 0.85 + (e - 1.15) * 0.75, 11, 1.8); fv = 36; }
          else { const k = sst((e - 2.6) / 1.4); cp = fr.pt(lerp(-9, -24, k), lerp(3, -9, k), lerp(1.5, 6, k)); if (bl) cl = ex.clone(); fv = lerp(34, 46, k); }
          ev1('c1', e > 1.15, () => trans('smash')); ev1('c2', e > 2.6, () => trans('whip'));
          look(cp, cl, fv, 0);
        },
      });
    }
    { // light-plane bombing run
      const fr = frame(st.air2, 0.5), ya = facing(fr), SPD = 54;
      let nb = 0;
      add('flyby', {
        enter() { kit([A[0], A[1]], ['vanguard']); A[0].pitch = A[1].pitch = 0.45; nb = 0; },
        update(s, dt, e, u) {
          const pl = P.plane, fpos = -95 + SPD * s, pp = fr.pt(fpos, 0, 11 + 1.5 * Math.sin(s * 1.3));
          poseAir(pl, pp.x, pp.y, pp.z, ya, 0.05 + 0.04 * Math.sin(s * 2), 0.18 * Math.sin(s * 1.1)); animAir(pl, dt, 1 - sst((s - 0.2) / 0.9));
          if (Math.floor(s * 16) !== pl.dk) { pl.dk = Math.floor(s * 16); dust(pp.x, pp.z, 3); }
          while (nb < 6 && e > 0.8 + nb * 0.42) { const bp = fr.pt(fpos + 14, nb % 2 ? 5 : -5); explode(bp.x, bp.y + 0.3, bp.z, 1.1); nb++; }
          const c0 = fr.pt(2, 18), c1 = fr.pt(2, 21);
          for (const [a, c] of [[A[0], c0], [A[1], c1]]) { a.x = c.x; a.z = c.z; a.yaw = Math.atan2(-(pp.x - a.x), -(pp.z - a.z)); }
          ev1('c', e > 2.5, () => trans('whip'));
          if (e < 2.5) look(fr.pt(0, 22, 1.5), V3(pp.x, pp.y + 0.6, pp.z), lerp(26, 34, e / 2.5), 0);
          else look(fr.pt(-18, 12, 2.2), fr.pt(24, 0, 5), 40, -0.06);
        },
      });
    }
    { // helicopter swoops in, rocket salvo, flares
      const fr = frame(st.ops, 2.0), ya = facing(fr);
      add('heli', {
        enter() { kit([...A.slice(0, 4), B[0], B[1], B[2]], ['vanguard', 'stinger']); },
        update(s, dt, e, u) {
          const h = P.heli, ap = 1 - sst(s / 2.4), pos = fr.pt(-80 * ap, 0, 3.5 + 22 * ap);
          poseAir(h, pos.x, pos.y, pos.z, ya, 0.22 * Math.sin(PI * clamp(s / 2.4)), 0.06 * Math.sin(s)); animAir(h, dt);
          if (pos.y - gy(pos.x, pos.z) < 14 && Math.floor(s * 30) !== h.dk) {
            h.dk = Math.floor(s * 30); const a = Math.random() * 6.283, r = 4 + Math.random() * 5; dust(pos.x + Math.cos(a) * r, pos.z + Math.sin(a) * r, 2.4);
          }
          if (pos.y - gy(pos.x, pos.z) < 12 && Math.floor(s * 3) !== h.rw) { h.rw = Math.floor(s * 3); ringFx(pos.x, gy(pos.x, pos.z) + 0.2, pos.z, 0xc9b48a, 16, 0.9); }
          for (let i = 0; i < 3; i++) place(A[i], fr.pt(-30 + Math.min(22, 9 * s) - i * 2, (i - 1) * 3), facing(fr));
          place(A[3], fr.pt(-6, 6), facing(fr) + 1.2);
          for (let i = 0; i < 3; i++) place(B[i], fr.pt(24 + i * 3, -8 + i * 8), facing(fr) + PI);
          ev1('rk', e > 1.2, () => {
            const o2 = V3(pos.x + fr.fx * 2, pos.y - 1, pos.z + fr.fz * 2);
            [0, 1, 2].forEach((i) => rocketFx(o2, chest(B[i]), 0.5 + i * 0.1, () => {
              const c = chest(B[i]); explode(c.x, gnd(B[i]), c.z, 1.0); launch(B[i], fr.fx * 5 + (i - 1) * fr.fz * 4, 9, fr.fz * 5 - (i - 1) * fr.fx * 4);
            }));
          });
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
      const put = (k, t, s) => {
        if (s >= t && !ph[k]) {
          ph[k] = 1; pcs[k] = tb.place(SP[k], { remote: true });
          const q = SP[k]; fx.burst(q.ix * 4, q.lv * HEIGHT + SLAB + 0.3, q.iz * 4, 0x7fe8ff, 12, 5, 0.5, 0.25, 2, 4); punch(2); snd('place', 0.6);
        }
      };
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
          ev1('rkt', s > 3.6, () => { // a rocket slams into the east wall
            const w = V3(cx0 + 17, topY + 1.5, cz0);
            rocketFx(chest(B[2]), w, 0.5, () => { explode(w.x, w.y, w.z, 1.0); fx.debris(w.x, w.y, w.z, 10, 8, 0.3); if (pcs.wE) tb.damage(pcs.wE, 70); });
          });
          if (pcs.wE && s > nextHit && s < 5.3) { nextHit = s + 0.22; tb.damage(pcs.wE, 28); }
          if (s > 4.3 && !edit && pcs.wS) { edit = 1; tb.beginEdit(pcs.wS); }
          if (edit === 1 && s > 4.55) { tb.editSet(4, true); edit = 2; }
          if (edit === 2 && s > 4.7) { tb.editSet(1, true); edit = 3; }
          if (edit === 3 && s > 4.95) { tb.confirmEdit(); edit = 4; }
          if (s > 5.0 && s < 7.6) { if (!B[0].dead && s >= o.nf) { o.nf = s + 0.14; const c = chest(B[0]); fire(o, c.x, c.y, c.z, 0.01); } }
          if (s > 5.6 && !B[0].dead) kill(B[0], true); if (s > 6.1 && !B[1].dead) kill(B[1], false);
          ev1('c1', s > 3.0, () => trans('whip')); ev1('c2', s > 5.6, () => trans('smash'));
          spd = s < 3.0 ? 0.4 : 0;
          let cp, cl;
          if (s < 3.0) { const u3 = s / 3; cp = V3(o.x + 3 + 2 * u3, o.fy + lerp(0.8, 3, u3), cz0 + lerp(9, 11, u3)); cl = V3(o.x + 2, o.fy + 1, cz0); }
          else if (s < 5.6) { const C = V3(cx0 + 16, topY + 1.5, cz0); cp = orb(C, PI / 2 + lerp(0.2, 1.1, sst((s - 3) / 2.6)), 9, 1.0); cl = C; }
          else { const k = sst((s - 5.6) / 2.4), C = V3(cx0 + 16, topY + 1.5, cz0); cp = V3(lerp(cx0 + 24, cx0 - 4, k), lerp(topY + 2, topY + 13, k), lerp(cz0 + 8, cz0 + 16, k)); cl = C; }
          look(cp, cl, 36, 0);
        },
      });
    }
    add('silence', { enter() { kit([], []); }, update() {} });
    { // finale: both lines charge, strikes from orbit, a slow-motion ground slam, the rift opens
      const fr = frame(st.fight, 0.3), yaR = Math.atan2(-fr.fz, fr.fx), yaF = facing(fr), rp = fr.pt(150, 0, 85);
      const BL = [[1.0, -8, 4], [1.8, -4, -5], [2.6, -1, 6], [3.4, 2, -4], [6.2, 0, 8], [7.0, 3, -9], [7.8, -3, 2], [9.0, 5, 6]];
      const STR = [[8.3, 8, 7], [8.9, 2, -8], [9.5, -5, 3]];
      let bi = 0, shotT = 0, nextBolt = 0, tum = null;
      add('charge', {
        ts: (e) => 0.62 - 0.32 * Math.min(sst((e - 4.2) / 0.15), 1 - sst((e - 5.0) / 0.6)),
        enter() {
          bi = 0; shotT = 0; nextBolt = 0.5; tum = null;
          kit([...A, ...B], ['aegis', 'stinger', 'marshal', 'sentinel', 'spitfire', 'breacher', 'vanguard', 'stinger', 'p9', 'marshal', 'spitfire', 'hailstorm']);
          actors.forEach((a) => { a.ads = false; });
        },
        update(s, dt, e, u) {
          for (let i = 0; i < 6; i++) {
            const lat = (i - 2.5) * 3.2;
            place(A[i], fr.pt(-30 + 5 * s - (i % 2) * 2, lat), facing(fr)); place(B[i], fr.pt(30 - 5 * s + (i % 2) * 2, lat + 1.2), facing(fr) + PI);
          }
          volley(A, B, s, 0.15, 0.03); volley(B, A, s, 0.17, 0.03);
          rift.place(rp.x, rp.y, rp.z, 85, 0.5 + 0.5 * sst(e / 10));
          if (e > nextBolt) { // sky lightning
            nextBolt = e + 0.55 + Math.random() * 0.5; const g = fr.pt(Math.random() * 60, (Math.random() - 0.5) * 80);
            lightningFx(rp, g, 0xffd9a0, 1.2, 0.35, 12); flare(g, 0.7); snd('crack', 0.35);
          }
          while (bi < BL.length && e >= BL[bi][0]) {
            const b = BL[bi], p = fr.pt(b[1], b[2]); explode(p.x, p.y, p.z, 1.3);
            launch(B[bi % 6], 5, 8, 4); launch(A[(bi * 2 + 1) % 6], -5, 8, -4); bi++;
          }
          // hero charge + ground slam (slow motion)
          if (e > 3.7 && e < 4.4 && !A[0].dead) place(A[0], fr.pt(lerp(-4, 4, (e - 3.7) / 0.7), 0), facing(fr));
          ev1('slam', e > 4.15, () => { A[0].crouch = false; act(A[0], 'slam', 0.45); });
          ev1('slamHit', e > 4.95, () => {
            const p = fr.pt(5, 0); explode(p.x, p.y, p.z, 2.4); ringFx(p.x, p.y + 0.2, p.z, 0xffd9a0, 40, 1.0); impactFrame(0.08); hitStop(0.1); trans('smash', true);
            B.forEach((b) => launch(b, (b.x - p.x) * 0.4, 9, (b.z - p.z) * 0.4));
            A.slice(1, 4).forEach((a) => act(a, 'dive', 0.9, { mv: [fr.fx * 3.5, fr.fz * 3.5] })); // dive forward, the roll covers ground
          });
          // orbital strikes
          STR.forEach((q, i) => ev1('str' + i, e > q[0], () => {
            const p = fr.pt(q[1], q[2]), top = V3(p.x, p.y + 140, p.z);
            beamFx(top, p, 0xfff4d0, 1.4, 0.5); beamFx(top, p, 0xff9a3c, 4.2, 0.4); explode(p.x, p.y, p.z, 2.0); snd('crack', 0.6);
            if (i === 1 && cars.truck) tum = mkTum(p.x, p.z, 4, 13, 2, 2.4, 1.2, facing(fr));
          }));
          if (tum) { stepTum(tum, dt); poseCar(cars.truck, tum.x, tum.z, tum.yaw, 0, dt, tumOp(tum)); }
          else if (e < 8.9) poseCar(cars.truck, fr.pt(-45 + 20 * s, 9).x, fr.pt(-45 + 20 * s, 9).z, facing(fr), 20, dt, {});
          // transport overhead, then the helicopter strafing run
          const trn = P.transport, tOn = e > 1.5 && e < 6.5;
          if (tOn) { const tp = fr.pt(0, lerp(-110, 110, (e - 1.5) / 5), 52); poseAir(trn, tp.x, tp.y, tp.z, yaR, 0, 0.08); spinProps(trn, dt); trn.ramp.rotation.x = RAMP_OPEN; jumpLight(trn, true, s); } else trn.root.visible = false;
          const h = P.heli, hOn = e > 6.2 && e < 9.4;
          if (hOn) {
            const hp = fr.pt(lerp(95, -95, (e - 6.2) / 3.2), 6, 24);
            poseAir(h, hp.x, hp.y, hp.z, yaF + PI, 0.12, 0); animAir(h, dt);
            shotT -= dt;
            if (e > 6.8 && e < 9.0 && shotT <= 0) { shotT = 0.07; _o.set(hp.x - fr.fx * 5, hp.y - 1.5, hp.z - fr.fz * 5); _d.set(-fr.fx * 0.8, -0.55, -fr.fz * 0.8).normalize(); bullets.spawn(_o, _d, 120, false); }
          } else h.root.visible = false;
          // cameras
          let cp, cl, fv = 34, rl = 0;
          if (e < 2.0) { const k = e / 2; cp = fr.pt(lerp(-40, -26, k), lerp(5, 3, k), lerp(1.2, 1.5, k)); cl = fr.pt(2, 0, lerp(2.5, 7, k)); fv = 36; spd = 0.6; }                  // low charge behind the squad
          else if (e < 4.1) { const k = (e - 2) / 2.1, a = lerp(0.9, 2.3, sst(k)), rad = lerp(32, 22, k); cp = fr.pt(Math.sin(a) * rad, Math.cos(a) * rad, lerp(1.6, 12, sst(k))); cl = fr.pt(0, 0, 1.5); fv = lerp(34, 44, k); } // crane orbit
          else if (e < 5.6) { const c = chest(A[0]), k = (e - 4.1) / 1.5; cp = orb(c, fr.hd + lerp(2.6, 3.9, k), lerp(4.2, 2.8, k), lerp(-0.3, 0.8, k)); cl = c.clone().add(V3(0, 0.2, 0)); fv = 30; rl = 0.1; } // hero low angle
          else if (e < 8.0) { const k = (e - 5.6) / 2.4; cp = fr.pt(lerp(-18, 4, k), lerp(14, -16, k), lerp(4, 2, k)); cl = fr.pt(2, 0, 3); fv = 40; }                                // sweeping dolly
          else if (e < 10.4) { const k = (e - 8.0) / 2.4; cp = fr.pt(34, lerp(-5, 6, k), 1.6); cl = fr.pt(-18, 0, 3); fv = 34; spd = 0.5; }                                        // from the enemy side
          else { const k = sst((e - 10.4) / 1.6); cp = fr.pt(-30, 0, lerp(3, 42, k)); cl = rp.clone().lerp(fr.pt(30, 0, 10), 0.25); fv = lerp(38, 52, k); shake = Math.max(shake, 0.5); }  // pull back to the rift
          ev1('c1', e > 2.0, () => trans('whip')); ev1('c2', e > 4.1, () => trans('smash')); ev1('c3', e > 5.6, () => trans('strobe')); ev1('c4', e > 8.0, () => trans('whip')); ev1('c5', e > 10.4, () => trans('smash'));
          look(cp, cl, fv, rl);
        },
      });
    }
    { // title: the white-out clears onto the burning battlefield under the open rift
      const fr = frame(st.fight, 0.3), rp = fr.pt(170, 0, 95);
      add('title', {
        enter() {
          kit([], []);
          [[6, -8], [14, 10], [-6, 12]].forEach(([f, r]) => { const p = fr.pt(f, r); zoneFx(p.x, p.y, p.z, 4.5, 0xff6a1a, 9); });
          nextBolt2 = 0.4;
        },
        update(s, dt, e, u) {
          rift.place(rp.x, rp.y, rp.z, 110, 1);
          if (e > nextBolt2) { nextBolt2 = e + 0.9 + Math.random() * 0.8; const g = fr.pt(40 + Math.random() * 60, (Math.random() - 0.5) * 90); lightningFx(rp, g, 0xffd9a0, 1.4, 0.4, 14); flare(g, 0.8); snd('crack', 0.3); }
          fx.ember(fr.S.x + (Math.random() - 0.5) * 40, gy(fr.S.x, fr.S.z) + 1, fr.S.z + (Math.random() - 0.5) * 40, 1, 3);
          ev1('w1', e > 0.95, () => { shake = 1; punch(6); flare(rp, 1.2); });
          ev1('w2', e > 1.5, () => { shake = 1.2; punch(8); flare(rp, 1.5); impactFrame(0.05); });
          const k = sst(u);
          look(orb(fr.pt(0, 0, 6), fr.hd + PI + lerp(0.2, -0.35, k), lerp(34, 46, k), lerp(5, 22, k)), rp.clone().lerp(fr.pt(60, 0, 8), 0.45), lerp(36, 30, k), 0);
        },
      });
    }
    return S;
  }
  let nextBolt2 = 0;

  // ---------- UI ----------
  // every class is prefixed "tr" so the game's own stylesheet (.card, .bar, .hint ...) can never leak into the trailer overlay
  function buildUI() {
    if (ui) { ui.root.style.display = 'block'; ui.grade.style.display = LITE ? 'none' : 'block'; return; }
    const st = document.createElement('style');
    st.textContent = `
body.trailer-mode *{visibility:hidden!important}
body.trailer-mode #c,body.trailer-mode #trailerUI,body.trailer-mode #trailerUI *,body.trailer-mode #trailerGrade{visibility:visible!important}
#trailerGrade{position:fixed;inset:0;z-index:99989;pointer-events:none;mix-blend-mode:soft-light;background:rgba(255,170,90,.12);transition:background .5s}
#trailerUI{position:fixed;inset:0;z-index:99990;pointer-events:none;overflow:hidden;font-family:'Arial Black',Impact,system-ui,sans-serif;color:#fff}
#trailerUI .trbar{position:absolute;left:0;right:0;background:#000;z-index:4}
#trailerUI .trfade{position:absolute;inset:0;z-index:2;opacity:1}
#trailerUI .trvig{position:absolute;inset:0;z-index:1;background:radial-gradient(ellipse at 50% 50%,rgba(0,0,0,0) 52%,rgba(0,0,0,.55) 100%)}
#trailerUI .trspeed{position:absolute;inset:-25%;z-index:1;opacity:0;background:repeating-conic-gradient(from 0deg at 50% 50%,rgba(255,255,255,0) 0deg 3.2deg,rgba(255,255,255,.3) 3.4deg 3.7deg);-webkit-mask-image:radial-gradient(circle,transparent 30%,#000 75%);mask-image:radial-gradient(circle,transparent 30%,#000 75%)}
#trailerUI .trflash{position:absolute;inset:0;z-index:3;background:#fff;opacity:0}
#trailerUI .trwhip{position:absolute;inset:0;z-index:3;opacity:0;background:linear-gradient(90deg,rgba(255,255,255,0),rgba(255,255,255,.55) 45%,rgba(255,255,255,0))}
#trailerUI .trgl{position:absolute;inset:0;z-index:3;display:none}
#trailerUI .trgl div{position:absolute;left:0;right:0}
#trailerUI .trgl div:nth-child(odd){background:rgba(0,255,255,.35)}#trailerUI .trgl div:nth-child(even){background:rgba(255,0,120,.35)}
#trailerUI .trflk{position:absolute;left:0;right:0;height:5px;margin-top:-2.5px;z-index:3;opacity:0;background:linear-gradient(90deg,rgba(120,170,255,0),rgba(190,220,255,.95) 50%,rgba(120,170,255,0));filter:blur(1.2px)}
#trailerUI .trflg{position:absolute;width:38vmin;height:38vmin;margin:-19vmin 0 0 -19vmin;z-index:3;opacity:0;background:radial-gradient(circle,rgba(255,220,170,.85),rgba(255,140,40,.25) 40%,rgba(255,100,0,0) 70%)}
@keyframes trSlam{0%{opacity:0;transform:translateY(-50%) scale(1.7);filter:blur(12px)}45%{opacity:1;transform:translateY(-50%) scale(.97);filter:blur(0)}100%{opacity:1;transform:translateY(-50%) scale(1)}}
@keyframes trWord{0%{opacity:0;transform:scale(2.4);letter-spacing:.9em;filter:blur(16px)}60%{opacity:1;transform:scale(.97);filter:blur(0)}100%{opacity:1;transform:scale(1)}}
@keyframes trFade{from{opacity:0}to{opacity:1}}
#trailerUI .trcard{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;z-index:5;opacity:0;transition:opacity .25s;letter-spacing:.22em;text-shadow:0 0 28px rgba(255,160,60,.55),0 4px 18px #000;font-weight:900;font-size:min(7vw,76px)}
#trailerUI .trcard.s{font-size:min(3.4vw,40px);letter-spacing:.3em}
#trailerUI .trcard.on{opacity:1;animation:trSlam .32s cubic-bezier(.2,.9,.3,1) both}
#trailerUI .trcard.big{font-size:min(9vw,118px);letter-spacing:.24em;text-shadow:3px 0 rgba(255,40,80,.6),-3px 0 rgba(0,200,255,.6),0 0 40px rgba(255,160,60,.7),0 4px 24px #000}
#trailerUI .trcard.big.on{animation:none}
#trailerUI .trcard .w{display:block;opacity:0}
#trailerUI .trcard.big .w1{animation:trWord .6s both}
#trailerUI .trcard.big .w2{animation:trWord .6s .55s both}
#trailerUI .trcard small{display:block;margin-top:.45em;font-size:.2em;letter-spacing:.7em;color:#ffc247}
#trailerUI .trcard.big small{opacity:0;animation:trFade 1s 1.9s both}
#trailerUI .trcall{position:absolute;left:7%;bottom:17%;z-index:5;opacity:0;transform:translateX(-14px);transition:opacity .12s,transform .18s;font-weight:900;letter-spacing:.14em;text-shadow:0 2px 14px #000}
#trailerUI .trcall.on{opacity:1;transform:none}
#trailerUI .trcall b{display:block;font-size:min(3.4vw,34px)}
#trailerUI .trcall i{display:block;margin-top:.25em;font:800 min(1.8vw,17px) system-ui;font-style:normal;letter-spacing:.42em;color:#ffc247}
#trailerUI .trsub{position:absolute;left:8%;right:8%;bottom:12%;text-align:center;z-index:5;font:600 min(2.6vw,22px) system-ui;text-shadow:0 2px 8px #000;opacity:0}
#trailerUI .trdisc{position:absolute;left:0;right:0;bottom:6%;text-align:center;z-index:5;opacity:0;font:700 clamp(10px,1.5vw,14px) system-ui;letter-spacing:.34em;text-transform:uppercase;color:rgba(255,255,255,.86);text-shadow:0 1px 8px #000,0 0 3px #000}
#trailerUI .trsnd{position:absolute;left:14px;top:10px;z-index:7;font:700 12px system-ui;padding:6px 10px;border-radius:6px;background:rgba(0,0,0,.6);color:#fff;pointer-events:auto;display:none;cursor:pointer}
#trailerUI .trhint{position:absolute;right:14px;top:10px;font:600 12px system-ui;opacity:.7;z-index:6;transition:opacity 1s}`;
    document.head.appendChild(st);
    const grade = document.createElement('div'); grade.id = 'trailerGrade'; grade.style.display = LITE ? 'none' : 'block'; document.body.appendChild(grade);
    const root = document.createElement('div'); root.id = 'trailerUI';
    root.innerHTML = '<div class="trvig"></div><div class="trspeed"></div><div class="trfade"></div><div class="trwhip"></div>'
      + '<div class="trgl"><div></div><div></div><div></div><div></div><div></div></div><div class="trflash"></div><div class="trflk"></div><div class="trflg"></div>'
      + '<div class="trbar" id="trBarT" style="top:0"></div><div class="trbar" id="trBarB" style="bottom:0"></div><div class="trcard"></div><div class="trcall"></div><div class="trsub"></div><div class="trdisc">gameplay captured ingame</div><div class="trsnd"></div><div class="trhint">ESC or double-tap to exit</div>';
    document.body.appendChild(root);
    const q = (s) => root.querySelector(s);
    ui = {
      root, grade, fade: q('.trfade'), flash: q('.trflash'), whip: q('.trwhip'), gl: q('.trgl'), glBars: Array.from(root.querySelectorAll('.trgl div')), flk: q('.trflk'), flg: q('.trflg'), speed: q('.trspeed'),
      card: q('.trcard'), call: q('.trcall'), sub: q('.trsub'), disc: q('.trdisc'), snd: q('.trsnd'), hint: q('.trhint'), bt: q('#trBarT'), bb: q('#trBarB'), cardKey: '', callKey: '', sndMsg: '',
    };
    ui.snd.addEventListener('click', (e) => { e.stopPropagation(); resumeAudio(); });
    ui.snd.addEventListener('dblclick', (e) => e.stopPropagation());
    addEventListener('resize', bars);
    addEventListener('keydown', (e) => { if (active && e.code === 'Escape') stop(); });
    addEventListener('dblclick', () => { if (active) stop(); });
  }
  function bars() {
    if (!ui) return;
    const h = Math.max(0, (innerHeight - innerWidth / 2.39) / 2);
    ui.bt.style.height = ui.bb.style.height = h + 'px';
    if (ui.disc) ui.disc.style.bottom = (h + 14) + 'px'; // the disclaimer sits just above the bottom bar
  }
  function overlays(t) {
    const [col, a] = overlayAt(t);
    ui.fade.style.background = col; ui.fade.style.opacity = a;
    ui.disc.style.opacity = Math.min(sst((t - 0.5) / 0.5), 1 - sst((t - 4.3) / 0.7)).toFixed(2); // "gameplay captured ingame": visible for the first five seconds
    while (cutI < CUTL.length && t >= CUTL[cutI].t) { trans(CUTL[cutI].k, true); shake = Math.max(shake, 0.7); punch(5); cutI++; }
    // transition layer
    let fc = '#fff', fa = 0, wa = 0, wx = 0, bl = 0, gl = 0;
    if (tr) {
      const k = T - tr.t0;
      switch (tr.type) {
        case 'smash': fa = clamp(1 - k / 0.28) * 0.55; break;
        case 'strobe': if (k < 0.3) fa = Math.floor(k / 0.075) % 2 === 0 ? 0.85 : 0; break;
        case 'dip': fc = '#000'; fa = clamp(1 - k / 0.3) * 0.9; break;
        case 'whip': { const w = clamp(1 - k / 0.24); wa = w; wx = tr.dir * (1 - w) * 60; bl = w * 8; fa = w * 0.12; break; }
        case 'glitch': if (k < 0.24) { gl = 1; fa = 0.25 * (Math.floor(k / 0.04) % 2); } break;
        default: break;
      }
      if (k > 0.4) tr = null;
    }
    ui.flash.style.background = fc; ui.flash.style.opacity = fa;
    ui.whip.style.opacity = wa; ui.whip.style.transform = 'translateX(' + wx.toFixed(1) + '%)';
    ui.gl.style.display = gl ? 'block' : 'none';
    if (gl) for (const b of ui.glBars) { b.style.top = (Math.random() * 100).toFixed(1) + '%'; b.style.height = (2 + Math.random() * 10).toFixed(1) + '%'; b.style.transform = 'translateX(' + ((Math.random() - 0.5) * 14).toFixed(1) + '%)'; }
    if (cvs) { // CSS filter on the game canvas: whip blur + inverted impact frame
      const parts = [];
      if (!LITE && bl > 0.4) parts.push('blur(' + bl.toFixed(1) + 'px)');
      if (T < imp) parts.push('invert(1) contrast(1.5)');
      const f = parts.join(' ');
      if (f !== filt) { filt = f; cvs.style.filter = f || 'none'; }
    }
    // lens flare at a world point
    if (flr) {
      const k = (T - flr.t0) / 0.7;
      let on = false;
      if (k < 1) {
        _v1.copy(flr.p).project(camera);
        if (_v1.z < 1 && Math.abs(_v1.x) < 1.4 && Math.abs(_v1.y) < 1.4) {
          const px = (_v1.x * 0.5 + 0.5) * innerWidth, py = (-_v1.y * 0.5 + 0.5) * innerHeight, a2 = flr.s * Math.pow(1 - k, 2);
          ui.flk.style.top = py + 'px'; ui.flk.style.opacity = clamp(a2); ui.flg.style.left = px + 'px'; ui.flg.style.top = py + 'px'; ui.flg.style.opacity = clamp(a2 * 0.8); on = true;
        }
      } else flr = null;
      if (!on) { ui.flk.style.opacity = 0; ui.flg.style.opacity = 0; }
    } else { ui.flk.style.opacity = 0; ui.flg.style.opacity = 0; }
    ui.speed.style.opacity = spd.toFixed(2); ui.speed.style.transform = 'rotate(' + ((T * 540) % 360).toFixed(1) + 'deg)';
    // cards
    const cd = CARDS.find((c) => t >= c.t0 && t < c.t1), key = cd ? (cd.title ? 'TITLE' : cd.text) : '';
    if (key !== ui.cardKey) {
      ui.cardKey = key; ui.card.className = 'trcard'; void ui.card.offsetWidth;
      if (cd) {
        const w = TITLE.split(' ');
        ui.card.innerHTML = cd.title ? `<span class="w w1">${w[0]}</span><span class="w w2">${w[1] || ''}</span><small>${TAGLINE}</small>` : cd.text;
        ui.card.className = 'trcard on ' + (cd.size || 'm') + (cd.title ? ' big' : '');
      }
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
    else if (voMissing && T < 9) m = `⚠ ${voMissing} radio line(s) not found in ${VO_DIR}`;
    if (m !== ui.sndMsg) { ui.sndMsg = m; ui.snd.textContent = m; ui.snd.style.display = m ? 'block' : 'none'; }
  }
  function resumeAudio() { try { if (audio.unlock) audio.unlock(); const c = audio.getCtx ? audio.getCtx() : null; if (c && c.state !== 'running') c.resume(); } catch (_) {} }

  // ---------- lifecycle ----------
  function pickStages() {
    const Pp = (i) => POIS[i % POIS.length] || { x: 0, z: 0 };
    const mk = (i, a, b, c) => findStage(R, Pp(i).x, Pp(i).z, a, b, c);
    return { vista: mk(0, 40, 120, 20), run: mk(1, 30, 110, 22), fight: mk(2, 30, 110, 26), chase: mk(3, 40, 150, 30), blast: mk(4, 30, 110, 24), ops: mk(5, 30, 110, 16), reel: mk(5, 20, 100, 14), air: mk(6, 40, 150, 26), air2: mk(7, 40, 150, 26), build: findBuildStage(R) };
  }
  /** only the radio lines are used; their start times come from RADIO */
  async function loadVO(c, script) {
    voMissing = 0;
    const lines = (script.lines || []).filter((l) => RADIO[l.id] != null);
    return Promise.all(lines.map(async (l) => {
      let buf = null;
      if (c) {
        try { const r = await fetch(VO_DIR + l.id + '.mp3'); if (r.ok) buf = await c.decodeAudioData(await r.arrayBuffer()); else voMissing++; } catch (_) { voMissing++; }
      }
      return Object.assign({}, l, { at: RADIO[l.id], buf });
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
    active = true; ready = false; shotIdx = -1; cutI = 0; gs = 0; shake = 0; T = -0.35; waitT = 0; kickT = -9; callEx = null; later.length = 0;
    punchF = rollK = spd = 0; slowK = 1; slowT0 = -9; freezeUntil = -9; imp = -9; tr = null; flr = null; fired = {}; filt = '';
    document.body.classList.add('trailer-mode');
    cvs = document.getElementById('c') || document.querySelector('canvas');
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
      const track = await loadTrack(c);
      if (!active) return;
      if (!actors.length) { for (let i = 0; i < 6; i++) A.push(makeActor('remote', false, i)); for (let i = 0; i < 6; i++) B.push(makeActor('enemy', true, i + 6)); }
      if (!tb) tb = createBuild(scene, tex, { onPlace: () => sfx('click', 0.6), onBreak: () => sfx('thud', 0.8), onHit: () => sfx('clang', 0.4) });
      if (!chutes.length) for (let i = 0; i < 4; i++) chutes.push(makeChute(scene));
      stages = pickStages();
      if (!cars.sedan) {
        const S = stages.chase;
        cars.sedan = spawnCar('sedan', S, 0); cars.moto = spawnCar('motorcycle', S, 6); cars.van = spawnCar('van', S, 12);
        cars.truck = spawnCar('truck', S, 18);
      }
      await loadProps();
      if (!active) return;
      prewarm();
      shots = buildShots(); parkCars();
      if (c && audio.getMaster) music = buildScore(c, audio.getMaster(), vo, { TM, HITS, END, PLAN, lite: LITE, track });
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
    parkCars();
    if (cvs) cvs.style.filter = '';
    document.body.classList.remove('trailer-mode'); if (ui) { ui.root.style.display = 'none'; ui.grade.style.display = 'none'; }
    camera.up.set(0, 1, 0); camera.fov = settings.fov; camera.updateProjectionMatrix();
    if (o.onStop) o.onStop();
  }
  function update(rawFull) {
    if (!active) return;
    if (!ready) { if (ui) { ui.fade.style.opacity = 1; sndChip(); } return; }
    const raw = Math.min(rawFull, 0.25), dtc = Math.min(raw, 0.05);
    if (audioCtx && audioCtx.state !== 'running' && T - kickT > 1) { kickT = T; try { audioCtx.resume(); } catch (_) {} } // phones sometimes park the context mid-trailer: wake it
    if (music) {
      if (music.ctx.state !== 'running' && waitT < 2.5) { waitT += raw; ui.fade.style.opacity = 1; sndChip(); return; } // wait for sound (a few seconds), then go on silently
      music.update();
    }
    T += raw;
    if (music && music.ctx.state === 'running') { const dd = music.ctx.currentTime - music.t0 - T; if (Math.abs(dd) < 1) T += dd * 0.1; } // stay locked to the audio clock
    if (T >= END + TAIL) { stop(); return; }
    const Tc = Math.max(0, T);
    let idx = shots.findIndex((s) => Tc >= s.t0 && Tc < s.t1); if (idx < 0) idx = shots.length - 1;
    if (idx !== shotIdx) {
      shotIdx = idx; const sh = shots[idx]; sh.s = 0; fired = {};
      for (const a of actors) { a.mesh.visible = false; a.free = null; a.air = false; a.fixSpeed = null; a.act = null; a.bal = null; }
      hideProps(); clearTimed(); later.length = 0; if (tb) tb.clear(); parkCars();
      if (ui) ui.grade.style.background = GRADES[sh.name] || GRADES.def;
      try { if (sh.enter) sh.enter(); } catch (e) { console.error('[trailer] enter', sh.name, e); }
    }
    const sh = shots[shotIdx], e = Tc - sh.t0, u = clamp(e / (sh.t1 - sh.t0));
    const ts = (sh.ts ? sh.ts(e, u) : 1) * (Tc < freezeUntil ? 0.04 : 1) * (slowK < 1 ? slowF(Tc) : 1), dt = Math.max(0.0005, dtc * ts);
    sh.s += dt; gs += dt; spd = 0;
    try { sh.update(sh.s, dt, e, u); } catch (err) { if (!sh._err) { sh._err = 1; console.error('[trailer] shot', sh.name, err); } }
    for (const a of actors) tickActor(a, dt);
    for (let i = later.length - 1; i >= 0; i--) if (gs >= later[i].t) { const f = later[i].fn; later.splice(i, 1); try { f(); } catch (_) {} }
    fakePlayer.x = cam.p.x; fakePlayer.z = cam.p.z; fakePlayer.y = cam.p.y;
    vehicles.update(dt, fakePlayer, {}, null);
    fx.update(dt); stepTimed(dt); if (tb) tb.update(dt); bullets.update(dt); world.update(cam.p.x, cam.p.z, dtc);
    camera.position.copy(cam.p); camera.up.set(0, 1, 0); camera.lookAt(cam.l); camera.rotateZ(cam.roll + rollK);
    const k = shake + 0.05;
    camera.position.x += Math.sin(T * 43) * k * 0.05; camera.position.y += Math.sin(T * 51 + 1) * k * 0.05; camera.rotateZ(Math.sin(T * 37) * k * 0.01);
    shake *= Math.exp(-3.5 * dtc); punchF *= Math.exp(-8 * dtc); rollK *= Math.exp(-5 * dtc);
    const fv = Math.max(8, cam.fov - punchF);
    if (Math.abs(camera.fov - fv) > 1e-3) { camera.fov = fv; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();
    rift.update(dt, camera);
    try { _d.set(0, 0, -1).applyQuaternion(camera.quaternion); audio.setListener(camera.position.x, camera.position.z, Math.atan2(-_d.x, -_d.z)); } catch (_) {}
    overlays(Tc); sndChip();
  }

  return { start, stop, update, get active() { return active; } };
}
