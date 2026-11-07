/**
 * Procedural animation: walk / crouch / sprint, arm IK, per-weapon poses, data-driven reloads (arsenal.js),
 * bolt / pump cycles, melee swings, weapon swaps, the scout drone deploy / tablet sequence (droneKit.js)
 * and the Ridgeback Lottery ritual (lotteryKit.js).
 * All functions accept the rig's userData (or the group that owns it).
 */
import * as THREE from 'three';
import { HIP_Y, ARM_A, ARM_B } from './parts.js';
import { ALL, reloadSpec } from './arsenal.js';
import { buildWeapon } from './weaponModels.js';
import { buildDroneKit, DEPLOY, STOW, REST } from './droneKit.js';
import { buildLotteryKit, LOT_DEPLOY, LOT_REST, LOT, lotteryFx, lotteryIdleFx } from './lotteryKit.js';

const PI = Math.PI;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
const damp = (c, t, rate, dt) => c + (t - c) * (1 - Math.exp(-rate * dt));
const pulse = (t, at, len) => (t < at || t > at + len ? 0 : Math.sin(((t - at) / len) * PI));

/** legacy export (reload time is per weapon now: see arsenal.reloadDuration) */
export const RELOAD = { total: 2.85, marks: {} };

import { OVR } from './ovr.js';
export { OVR };

/** Animation level of detail (set every frame by game.js). on = far characters animate less often. */
export const LOD = { on: false, x: 0, z: 0 };

/**
 * Tuning. p = position, r = rotation (x, y, z).
 * fp = viewmodel space (camera at origin, -Z forward). tp = chest space of the 3rd-person rig.
 */
export const TUNE = {
  fp: {
    long: {
      hip: { p: [0.19, -0.185, -0.48], r: [0.02, 0.05, 0] },
      sprint: { p: [0.13, -0.27, -0.42], r: [0.55, -0.75, 0.18] },
      reload: { p: [0.07, -0.13, -0.5], r: [-0.1, 0.18, 0.3] },
    },
    short: {
      hip: { p: [0.14, -0.19, -0.42], r: [0.02, 0.04, 0] },
      sprint: { p: [0.12, -0.25, -0.36], r: [0.5, -0.5, 0.1] },
      reload: { p: [0.07, -0.16, -0.36], r: [-0.1, 0.15, 0.3] },
    },
    ads: { x: 0, y: 0 },
    lower: { y: -0.3, rx: 0.9 },
    pouch: [-0.32, -0.75, -0.35],
    poleR: [0.6, -1, 0.3],
    poleL: [-0.5, -1, 0.2],
    meleeOff: [0, 0.16, -0.03],
    restL: [-0.22, -0.2, -0.3],
  },
  tp: {
    long: {
      hip: { p: [0.13, 0.36, -0.36], r: [-0.12, 0.08, 0] },
      sprint: { p: [0.1, 0.26, -0.3], r: [0.8, -0.5, 0.25] },
      reload: { p: [0.14, 0.4, -0.34], r: [-0.15, 0.22, 0.34] },
    },
    short: {
      hip: { p: [0.12, 0.38, -0.28], r: [-0.1, 0.06, 0] },
      sprint: { p: [0.1, 0.3, -0.24], r: [0.7, -0.4, 0.2] },
      reload: { p: [0.12, 0.42, -0.26], r: [-0.12, 0.18, 0.3] },
    },
    ads: { x: 0.12, y: 0.648 },
    lower: { y: -0.25, rx: 0.8 },
    pouch: [-0.1, 0.2, -0.15],
    poleR: [0.5, -1, 0.35],
    poleL: [-0.4, -1, 0.25],
    meleeOff: [0, 0.75, -0.12],
    restL: [-0.22, 0.43, -0.44],
  },
};

const IDLE = PI * 0.8;
const REST_PARTS = ['charge', 'bolt', 'pump', 'slide', 'cyl', 'break'];
const MAG_HOLD = new THREE.Vector3(-0.005, 0.01, -0.02); // mag origin (top) relative to the gripping wrist, weapon space
const JOLT = { // [drop y, tilt x, push z] on named events
  magIn: [0.012, 0.06, 0], boltFwd: [0, 0, 0.01], pumpFwd: [0, 0, 0.012], close: [0.004, 0.02, 0.01],
  cylIn: [0.004, 0.03, 0], boltLock: [0, 0, 0.008], shellIn: [0.004, 0.02, 0],
};
const HAND_L = 0.095; // wrist -> centre of the closed fist, along the forearm
const HAND_P = 0.025; // ... and towards the palm side
const TAP_REACH = 0.15; // wrist -> index fingertip when pointing at the tablet

// ---------- scratch ----------
const DOWN = new THREE.Vector3(0, -1, 0), NEGZ = new THREE.Vector3(0, 0, -1), IDQ = new THREE.Quaternion();
const Z3 = [0, 0, 0];
const _s = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3(), _w = new THREE.Vector3();
const _pp = new THREE.Vector3(), _u = new THREE.Vector3(), _f = new THREE.Vector3(), _qi = new THREE.Quaternion();
const _P = { p: [0, 0, 0], r: [0, 0, 0] };
const _pouch = new THREE.Vector3(), _zero = new THREE.Vector3();
const _tr = new THREE.Vector3(), _lh = new THREE.Vector3(), _lw = new THREE.Vector3(), _le = new THREE.Vector3();
const _wl = new THREE.Vector3(), _k0 = new THREE.Vector3(), _k1 = new THREE.Vector3(), _mh = new THREE.Vector3();
const _dir = new THREE.Vector3(), _hp = new THREE.Vector3(), _tmp = new THREE.Vector3(), _pole = new THREE.Vector3();
const _inv = new THREE.Matrix4();
const _resR = { roll: 0, curl: 0 }, _resL = { roll: 0, curl: 0 };
const _vals = {};
const _hc = new THREE.Vector3(), _pn = new THREE.Vector3(), _ha = new THREE.Vector3(), _hb = new THREE.Vector3();
const _qa = new THREE.Quaternion(), _xa = new THREE.Vector3(), _za = new THREE.Vector3();
let _axR = null, _axL = null; // melee: handle axis (rig space) the fist should close around
let _active = null, _ts = 0;

const U = (r) => (r && r.userData && r.userData.hold ? r.userData : r);

// ---------- two-bone IK ----------
/** target + pole are in the shoulder's parent space. Leaves the elbow in _e and the wrist in _w. */
function solveArm(arm, target, pole) {
  _s.copy(arm.shoulder.position);
  _d.subVectors(target, _s);
  let dist = _d.length();
  dist = clamp(dist, Math.abs(ARM_A - ARM_B) * 1.05 + 0.01, (ARM_A + ARM_B) * 0.999);
  _d.normalize();
  const x = (ARM_A * ARM_A - ARM_B * ARM_B + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, ARM_A * ARM_A - x * x));
  _pp.copy(pole).addScaledVector(_d, -pole.dot(_d));
  if (_pp.lengthSq() < 1e-6) _pp.set(1, 0, 0).addScaledVector(_d, -_d.x);
  _pp.normalize();
  _e.copy(_s).addScaledVector(_d, x).addScaledVector(_pp, h);
  _w.copy(_s).addScaledVector(_d, dist);
  _u.subVectors(_e, _s).normalize();
  arm.shoulder.quaternion.setFromUnitVectors(DOWN, _u);
  _f.subVectors(_w, _e).normalize().applyQuaternion(_qi.copy(arm.shoulder.quaternion).invert());
  arm.elbow.quaternion.setFromUnitVectors(DOWN, _f);
}

/** hand roll that makes the fist's curl axis parallel to `axis` (rig space); picks the solution closest to `near` */
function alignRoll(arm, axis, prev, near) {
  _qa.copy(arm.shoulder.quaternion).multiply(arm.elbow.quaternion);
  _xa.set(1, 0, 0).applyQuaternion(_qa);
  _za.set(0, 0, 1).applyQuaternion(_qa);
  const hx = axis.dot(_xa), hz = axis.dot(_za);
  if (hx * hx + hz * hz < 0.03) return prev;
  let r = Math.atan2(-hz, hx);
  if (Math.cos(r - near) < 0) r += PI;
  return r;
}

/** direction (rig space) of the palm side for the arm's current orientation */
function palmDir(arm, roll, out) {
  _qa.copy(arm.shoulder.quaternion).multiply(arm.elbow.quaternion);
  return out.set(Math.sin(roll), 0, Math.cos(roll)).applyQuaternion(_qa);
}

// ---------- surface-contact finger wrap ----------
const _wrapO = new THREE.Vector3(), _wrapA = new THREE.Vector3(), _wrapT = new THREE.Vector3();
const _wrapQ = new THREE.Quaternion();
const _wrapSeed = { thumb: 0.5, index: 0.82, middle: 0.9, ring: 0.84, pinky: 0.72 };

/** Curl each finger so its tip sits on a cylinder (origin + axis, radius) in world space. */
function wrapFingers(arm, origin, axis, radius, baseCurl) {
  const hand = arm.hand;
  if (!hand || !hand.userData) return;
  if (!hand.userData.curlEach || !hand.userData.chains) {
    if (hand.userData.curl) hand.userData.curl(baseCurl);
    return;
  }
  const chains = hand.userData.chains;
  const keys = ['index', 'middle', 'ring', 'pinky', 'thumb'];
  const amounts = {};
  for (let i = 0; i < keys.length; i++) {
    const seed = _wrapSeed[keys[i]] * (0.75 + baseCurl * 0.35);
    let lo = Math.max(0.12, seed - 0.5), hi = Math.min(1.2, seed + 0.45);
    let best = seed, bestAbs = 1e9;
    for (let iter = 0; iter < 8; iter++) {
      const mid = (lo + hi) * 0.5;
      const ch = chains[i];
      for (let j = 0; j < ch.bones.length; j++) {
        _wrapQ.setFromAxisAngle(ch.axis, ch.bend[j] * mid);
        ch.bones[j].quaternion.copy(ch.qa[j]).multiply(_wrapQ).multiply(ch.qb[j]);
      }
      hand.updateWorldMatrix(true, true);
      ch.bones[ch.bones.length - 1].getWorldPosition(_wrapT);
      _wrapO.copy(_wrapT).sub(origin);
      const along = _wrapO.dot(axis);
      _wrapA.copy(origin).addScaledVector(axis, along);
      const dist = _wrapT.distanceTo(_wrapA);
      const err = dist - radius;
      if (Math.abs(err) < bestAbs) { bestAbs = Math.abs(err); best = mid; }
      if (err > 0) lo = mid; else hi = mid;
    }
    amounts[keys[i]] = best;
  }
  hand.userData.curlEach(amounts);
}

/** index finger out, the rest curled; k blends from a normal curl (base) to the pointing pose */
function pointHand(arm, k, base) {
  const ud = arm.hand && arm.hand.userData;
  if (ud && ud.curlEach) {
    ud.curlEach({
      index: lerp(base, 0.1, k), middle: lerp(base, 0.95, k), ring: lerp(base, 0.95, k),
      pinky: lerp(base, 0.95, k), thumb: lerp(base, 0.75, k),
    });
  } else arm.curl(lerp(base, 0.75, k));
}

// ---------- keyframe evaluation ----------
function evalTrack(tr, t) {
  if (t <= tr[0][0]) return tr[0][1];
  for (let i = 1; i < tr.length; i++) {
    if (t < tr[i][0]) {
      const a = tr[i - 1], b = tr[i];
      return lerp(a[1], b[1], (t - a[0]) / Math.max(1e-4, b[0] - a[0]));
    }
  }
  return tr[tr.length - 1][1];
}

/** Wrist position for an anchor + offset, in rig space (offsets on weapon anchors are in weapon space) */
let _fpMode = false;
function anchorRig(w, name, o, out) {
  if (name === 'pouch') return out.set(_pouch.x + o[0], _pouch.y + o[1], _pouch.z + o[2]);
  const b = name === 'origin' ? _zero : (w.anchors[name] || w.anchors.fore);
  const v = _fpMode && w.def ? OVR[w.def.id] : null, t = v && (name === 'grip' || name === 'fore') ? v[name] : null;
  return out.set(b.x + o[0] + (t ? t[0] : 0), b.y + o[1] + (t ? t[1] : 0), b.z + o[2] + (t ? t[2] : 0)).applyMatrix4(w.group.matrix);
}

function evalHand(keys, t, w, out, res) {
  let i = 0;
  while (i < keys.length - 2 && t >= keys[i + 1].t) i++;
  const a = keys[i], b = keys[i + 1];
  const u = sstep((t - a.t) / Math.max(1e-4, b.t - a.t));
  anchorRig(w, a.a, a.o, _k0);
  anchorRig(w, b.a, b.o, _k1);
  out.lerpVectors(_k0, _k1, u);
  res.roll = lerp(a.roll, b.roll, u);
  res.curl = lerp(a.curl, b.curl, u);
  // optional per-finger amounts on the keyframes
  if (a.fingers || b.fingers) {
    const fa = a.fingers || {}, fb = b.fingers || {};
    const keysF = ['index', 'middle', 'ring', 'pinky', 'thumb'];
    res.fingers = {};
    for (const k of keysF) {
      const va = fa[k] != null ? fa[k] : res.curl;
      const vb = fb[k] != null ? fb[k] : res.curl;
      res.fingers[k] = lerp(va, vb, u);
    }
  } else {
    res.fingers = null;
  }
}

// ---------- weapon management ----------
export function initRig(ud, tex) {
  Object.assign(ud, {
    tex, cache: {}, w: null, def: null, id: null, pending: null,
    swapState: 0, swapping: false, lower: 0,
    mel: null, swingIdx: 0, cyOn: false, cycleT: 0, cyPrev: -1, rlPrev: -1, rlSpec: null, wasReloading: false,
    fdR: new THREE.Vector3(0, 0.6, -0.8).normalize(), fdL: new THREE.Vector3(0, 0.6, -0.8).normalize(),
    rlR: -PI / 2, rlL: PI / 2, accDt: 0, lodN: 0,
  });
  return ud;
}

export function ensureWeapon(r, id) {
  const g = U(r);
  let w = g.cache[id];
  if (!w) {
    const def = ALL[id];
    w = def.perk === 'drone' ? buildDroneKit(g.tex)
      : def.perk === 'lottery' ? buildLotteryKit(g.tex)
        : buildWeapon(def.model, g.tex);
    w.def = def;
    g.cache[id] = w;
  }
  return w;
}

function resetMag(w) {
  if (!w.mag) return;
  w.mag.visible = true;
  w.mag.position.copy(w.magHome);
  w.mag.rotation.set(w.magTilt, 0, 0);
}

/** Put a weapon in the hands immediately (no swap animation) */
export function equipNow(r, id) {
  const g = U(r);
  if (!ALL[id]) return;
  const w = ensureWeapon(g, id);
  if (g.w && g.w !== w) g.hold.remove(g.w.group);
  g.hold.add(w.group);
  g.w = w; g.def = ALL[id]; g.id = id;
  g.muzzle = w.muzzle; g.eject = w.eject; g.mag = w.mag;
  g.rlPrev = -1; g.cyPrev = -1; g.cyOn = false; g.mel = null; g.rlSpec = null; g.wasReloading = false;
  w.group.visible = true;
  for (const n of REST_PARTS) if (w.parts[n]) w.parts[n].set(0);
  for (const k in w.props) w.props[k].visible = false;
  resetMag(w);
}

/** Request a weapon (animated lower -> swap -> raise). instant = skip the animation. */
export function setWeapon(r, id, instant) {
  const g = U(r);
  if (!ALL[id]) return;
  if (instant || !g.w) {
    equipNow(g, id);
    g.swapState = 0; g.lower = 0; g.pending = null; g.swapping = false;
    return;
  }
  if (id === g.id) {
    if (g.swapState === 1) { g.pending = null; g.swapState = 2; }
    return;
  }
  g.pending = id;
  g.swapState = 1;
  g.swapping = true;
}

function syncWeapon(g, o, dt) {
  const want = o.weapon || g.id || 'vanguard';
  if (!g.w) equipNow(g, want);
  else if (want !== (g.pending || g.id)) setWeapon(g, want);
  if (g.swapState === 1) {
    g.lower = Math.min(1, g.lower + dt / 0.16);
    if (g.lower >= 1) {
      if (g.pending) { equipNow(g, g.pending); g.pending = null; }
      g.swapState = 2;
    }
  } else if (g.swapState === 2) {
    g.lower = Math.max(0, g.lower - dt / Math.max(0.12, g.def.draw || 0.4));
    if (g.lower <= 0) g.swapState = 0;
  }
  g.swapping = g.swapState !== 0;
}

function beginReload(g, o) {
  const rl = !!o.reloading && g.def.kind === 'gun' && !g.swapping;
  if (rl && !g.wasReloading) {
    const ov0 = (g.fp && OVR[g.def.id]) || {};
    g.rlSpec = ov0.reload ? JSON.parse(JSON.stringify(ov0.reload)) : reloadSpec(g.def, o.missing || 1);
    if (ov0.reloadScale && ov0.reloadScale !== 1 && g.rlSpec) {
      const s = ov0.reloadScale;
      g.rlSpec.total = +(g.rlSpec.total * s).toFixed(4);
      if (g.rlSpec.events) for (const e of g.rlSpec.events) e[0] = +(e[0] * s).toFixed(4);
      for (const hand of ['lh', 'rh']) if (g.rlSpec[hand]) for (const k of g.rlSpec[hand]) k.t = +(k.t * s).toFixed(4);
      if (g.rlSpec.tracks) for (const part in g.rlSpec.tracks) for (const kv of g.rlSpec.tracks[part]) kv[0] = +(kv[0] * s).toFixed(4);
      if (g.rlSpec.held) for (const h of g.rlSpec.held) { h.t0 = +(h.t0 * s).toFixed(4); h.t1 = +(h.t1 * s).toFixed(4); }
    }
    g.rlPrev = -1; g.cyOn = false;
  }
  if (!rl && g.wasReloading) { g.rlSpec = null; g.rlPrev = -1; }
  g.wasReloading = rl;
  return rl;
}

function stepCycle(g, dt, rl) {
  if (rl) g.cyOn = false;
  if (!g.cyOn) return;
  g.cycleT += dt;
  if (!g.def.cycle || g.cycleT >= g.def.cycle.dur) g.cyOn = false;
}

function outPos(g, v) {
  const p = v.clone();
  if (!g.fp && g.chest) { g.chest.updateWorldMatrix(true, false); g.chest.localToWorld(p); }
  return p;
}

// ---------- per-frame weapon driving ----------
function fireEvents(g, w, evs, t, key, emit) {
  const prev = g[key];
  if (emit && evs) {
    for (const e of evs) {
      if (prev < e[0] && t >= e[0]) {
        let info = null;
        if (e[1] === 'toss') info = { pos: outPos(g, _lh), fp: !!g.fp };
        else if (e[1] === 'eject' && w.eject) info = { pos: outPos(g, _tmp.copy(w.eject.position).applyMatrix4(w.group.matrix)), fp: !!g.fp };
        emit(e[1], info);
      }
    }
  }
  g[key] = t;
}

function driveMag(w, spec, t) {
  const mk = spec.mag, mag = w.mag;
  if (!mk || t < mk.rel) { resetMag(w); return; }
  if (t >= mk.toss && t < mk.pouch) { mag.visible = false; return; } // thrown away
  mag.visible = true;
  _mh.copy(_wl).add(MAG_HOLD);
  let k = 1, tilt = 0, roll = 0;
  if (t < mk.toss) {
    k = sstep((t - mk.rel) / 0.1);
    roll = sstep((t - (mk.toss - 0.18)) / 0.18) * 0.9;
  } else if (t < mk.ins) {
    const a0 = mk.pouch + (mk.ins - mk.pouch) * 0.32, len = (mk.ins - mk.pouch) * 0.62;
    const f = 1 - sstep((t - a0) / len);
    tilt = f * 0.6;
    roll = -f * 0.5;
  } else k = 1 - sstep((t - mk.ins) / 0.06);
  mag.position.lerpVectors(w.magHome, _mh, k);
  mag.rotation.set(w.magTilt + tilt, 0, roll);
}

function driveProps(w, spec, t) {
  for (const k in w.props) w.props[k].visible = false;
  if (!spec || !spec.held) return;
  for (const h of spec.held) {
    if (t < h.t0 || t >= h.t1) continue;
    const pr = w.props[h.kind];
    if (!pr) continue;
    pr.visible = true;
    _dir.subVectors(_lw, _le).normalize();
    _hp.copy(_lw).addScaledVector(_dir, 0.09).applyMatrix4(_inv);
    _dir.transformDirection(_inv);
    const u = sstep((t - (h.t1 - 0.18)) / 0.18);
    pr.position.lerpVectors(_hp, w.anchors.port, u);
    pr.quaternion.setFromUnitVectors(NEGZ, _dir).slerp(IDQ, u);
  }
}

function driveParts(g, w, spec, t) {
  for (const k in _vals) delete _vals[k];
  if (spec && spec.tracks) for (const n in spec.tracks) _vals[n] = evalTrack(spec.tracks[n], t);
  for (const n of REST_PARTS) if (w.parts[n]) w.parts[n].set(_vals[n] || 0);
  if (_vals.string !== undefined && w.parts.string) w.parts.string.set(_vals.string);
  if (_vals.loaded !== undefined && w.parts.loaded) w.parts.loaded.set(_vals.loaded);
  if (w.parts.kick) w.parts.kick.set(g.kick);
}

// ---------- poses ----------
function poseGun(g, T, st) {
  const w = g.w, def = g.def, m = w.group;
  const ov = (g.fp && OVR[def.id]) || {};
  // allow full timeline replace + length scale
  let rlSpec = st.rl ? g.rlSpec : null;
  if (rlSpec && ov.reload) rlSpec = ov.reload;
  if (rlSpec && ov.reloadScale && ov.reloadScale !== 1) {
    // scale is applied once when the spec is first built; here we only stretch the clock
    _ts = Math.min(st.t / ov.reloadScale, rlSpec.total);
  } else {
    _ts = rlSpec ? Math.min(st.t, rlSpec.total) : g.cycleT;
  }
  let cy = (g.cyOn && g.cycleT >= 0 && def.cycle) ? (ov.cycle || def.cycle) : null;
  if (cy && ov.cycleScale && ov.cycleScale !== 1) {
    _ts = g.cycleT / ov.cycleScale;
  }
  _active = rlSpec || cy;
  if (!rlSpec) _ts = g.cycleT;
  if (rlSpec && !(ov.reloadScale && ov.reloadScale !== 1)) _ts = Math.min(st.t, rlSpec.total);
  m.visible = !st.hidden;

  const cls = def.cls === 'short' ? T.short : T.long;
  const a = st.a, k = st.s * (1 - a);
  const hp = ov.hip || Z3;
  // optional full pose replacements
  const hipP = (ov.hipPose && ov.hipPose.p) || cls.hip.p;
  const hipR = (ov.hipPose && ov.hipPose.r) || cls.hip.r;
  const sprP = (ov.sprintPose && ov.sprintPose.p) || cls.sprint.p;
  const sprR = (ov.sprintPose && ov.sprintPose.r) || cls.sprint.r;
  const relP = (ov.reloadPose && ov.reloadPose.p) || cls.reload.p;
  const relR = (ov.reloadPose && ov.reloadPose.r) || cls.reload.r;
  const ads = [T.ads.x, T.ads.y - w.sightY, -(w.adsZ + (ov.ads || 0))];
  const p = _P.p, r = _P.r;
  for (let i = 0; i < 3; i++) {
    p[i] = lerp(lerp(hipP[i] + hp[i], ads[i], a), sprP[i], k);
    r[i] = lerp(lerp(hipR[i], 0, a), sprR[i], k);
  }
  if (rlSpec) {
    const wgt = sstep(_ts / 0.35) * (1 - sstep((_ts - (rlSpec.total - 0.35)) / 0.35));
    for (let i = 0; i < 3; i++) {
      p[i] = lerp(p[i], relP[i], wgt);
      r[i] = lerp(r[i], relR[i], wgt);
    }
  }
  if (_active) {
    for (const e of _active.events) {
      const j = JOLT[e[1]];
      if (!j) continue;
      const pl = pulse(_ts, e[0], 0.11);
      p[1] -= j[0] * pl; r[0] += j[1] * pl; p[2] += j[2] * pl;
    }
  }

  const ks = clamp(0.5 + def.recoil * 30, 0.6, 2.4), kk = st.kick, low = st.lower;
  m.position.set(p[0] + st.ox, p[1] + st.oy + kk * 0.008 * ks + T.lower.y * low, p[2] + st.oz + kk * 0.05 * ks);
  m.rotation.set(r[0] + st.rx + kk * 0.09 * ks + T.lower.rx * low, r[1] + st.ry, r[2] + st.rz + kk * st.kickRoll * 0.03);
  m.updateMatrix();

  // Hands locked to gun anchors unless a reload/cycle track drives them.
  // Wrist sits on the authored anchor. Fingers are surface-wrapped in finishArms.
  const rh = _active && _active.rh;
  const rhDriven = !!(rh && _ts >= rh[0].t && _ts <= rh[rh.length - 1].t);
  g._wrapR = null;
  g._wrapL = null;
  if (_active && _active.lh) {
    evalHand(_active.lh, _ts, w, _lh, _resL);
  } else {
    anchorRig(w, 'fore', Z3, _lh);
    _resL.roll = ov.rollL != null ? ov.rollL : IDLE;
    _resL.curl = ov.curlL != null ? ov.curlL : (a > 0.5 ? 0.8 : 0.68);
    if (ov.fingersL) _resL.fingers = ov.fingersL;
    g._wrapL = {
      origin: _lh.clone(),
      axis: new THREE.Vector3(0, 0, -1).transformDirection(m.matrix).normalize(),
      radius: 0.03,
      curl: _resL.curl,
      fingers: _resL.fingers || null,
    };
  }
  if (rhDriven) {
    evalHand(rh, _ts, w, _tr, _resR);
  } else {
    anchorRig(w, 'grip', Z3, _tr);
    _resR.roll = ov.rollR != null ? ov.rollR : -PI / 2;
    _resR.curl = ov.curlR != null ? ov.curlR : 0.92;
    if (ov.fingersR) _resR.fingers = ov.fingersR;
    _axR = _ha.set(0, -1, 0.1).normalize().transformDirection(m.matrix);
    g._wrapR = {
      origin: _tr.clone(),
      axis: new THREE.Vector3(0, -1, 0.05).transformDirection(m.matrix).normalize(),
      radius: def.cls === 'short' ? 0.023 : 0.027,
      curl: _resR.curl,
      fingers: _resR.fingers || null,
    };
  }
}

function postGun(g, st) {
  const w = g.w;
  _inv.copy(w.group.matrix).invert();
  _wl.copy(_lh).applyMatrix4(_inv);
  driveParts(g, w, _active, _ts);
  driveProps(w, st.rl ? _active : null, _ts);
  if (w.mag) { if (st.rl && _active && _active.mag) driveMag(w, _active, _ts); else resetMag(w); }
  if (_active) fireEvents(g, w, _active.events, _ts, st.rl ? 'rlPrev' : 'cyPrev', st.emit);
  else {
    g.rlPrev = -1; g.cyPrev = -1;
    if (st.ammo !== undefined) w.setAmmo(st.ammo);
  }
}

function poseMelee(g, T, st) {
  const w = g.w, def = g.def, m = w.group, off = T.meleeOff;
  g._wrapR = null; // (a gun pose leaves wrap data behind; melee hands use plain curls)
  g._wrapL = null;
  let a = def.idle, b = def.idle, u = 0, done = false;
  const mel = g.mel;
  let spec = null;
  if (mel) {
    spec = mel.kind === 'throw' ? def.throw : def.swings[mel.i];
    mel.t += st.dt;
    const keys = spec.keys;
    let i = 0;
    while (i < keys.length - 2 && mel.t >= keys[i + 1].t) i++;
    a = keys[i]; b = keys[i + 1];
    u = sstep((mel.t - a.t) / Math.max(1e-4, b.t - a.t));
    done = mel.t >= spec.dur;
  }
  const sp = st.s, low = st.lower;
  const R = [0, 0, 0], rot = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    R[i] = lerp(a.R[i], b.R[i], u) + off[i];
    rot[i] = lerp(a.rot[i], b.rot[i], u);
  }
  m.position.set(R[0] + 0.04 * sp + st.ox * 0.5, R[1] - 0.06 * sp + st.oy * 0.5 + T.lower.y * low, R[2] + 0.1 * sp + st.oz);
  m.rotation.set(rot[0] + 0.3 * sp + T.lower.rx * low, rot[1], rot[2]);
  m.updateMatrix();

  if (mel) {
    if (!mel.started) {
      mel.started = true;
      if (st.emit) {
        if (mel.kind === 'throw') st.emit('throwStart', { i: mel.i });
        else st.emit('swing', { i: mel.i });
      }
    }
    if (mel.kind === 'swing' && !mel.hit && mel.t >= spec.hit) { mel.hit = true; if (st.emit) st.emit('meleeHit', { i: mel.i }); }
    if (mel.kind === 'throw' && !mel.rel && mel.t >= spec.release) {
      mel.rel = true;
      if (st.emit) st.emit('throwRelease', { pos: outPos(g, m.position), fp: !!g.fp });
    }
  }
  const thrown = !!(mel && mel.kind === 'throw' && mel.rel);
  m.visible = !st.hidden && !thrown;
  for (const child of m.children) child.visible = !st.hidden && !thrown;
  // bare knuckles: hide the tiny prop — the hands *are* the weapon
  if (def.model === 'fists') m.visible = false;

  // ----- right hand -----
  const hold = w.anchors.hold;
  if (hold && !thrown) {
    _hc.copy(hold);
    const ov = g.fp && OVR[def.id];
    if (ov && ov.grip) { _hc.x += ov.grip[0]; _hc.y += ov.grip[1]; _hc.z += ov.grip[2]; }
    _hc.applyMatrix4(m.matrix);
    palmDir(g.armR, g.rlR, _pn);
    _tr.copy(_hc).addScaledVector(g.fdR, -HAND_L).addScaledVector(_pn, -HAND_P);
    // handle runs along weapon -Z (blade tip away); fist curls around that axis
    _axR = _ha.set(0, 0, -1).transformDirection(m.matrix);
    _resR.roll = -PI / 2;
    _resR.curl = def.model === 'fists' ? 1.15 : 1.0;
  } else {
    anchorRig(w, 'grip', Z3, _tr);
    _resR.roll = -PI / 2;
    _resR.curl = thrown ? 0.3 : (def.model === 'fists' ? 1.05 : 0.7);
  }

  // ----- left hand -----
  const twoHand = !!hold && (a.L === 'weapon' || b.L === 'weapon');
  if (twoHand) _axL = _hb.set(0, 0, -1).transformDirection(m.matrix);
  const lp = (key, out) => {
    if (Array.isArray(key.L)) return out.set(key.L[0] + off[0], key.L[1] + off[1], key.L[2] + off[2]);
    if (key.L === 'weapon') {
      if (!hold) return anchorRig(w, 'fore', Z3, out);
      palmDir(g.armL, g.rlL, _pn);
      return out.copy(w.anchors.fore).applyMatrix4(m.matrix).addScaledVector(g.fdL, -HAND_L).addScaledVector(_pn, -HAND_P);
    }
    return out.set(T.restL[0], T.restL[1], T.restL[2]);
  };
  lp(a, _k0); lp(b, _k1);
  _lh.lerpVectors(_k0, _k1, u);
  _resL.roll = PI / 2;
  if (def.model === 'fists') {
    _resL.curl = 1.15;
    _resR.curl = 1.15;
  } else {
    _resL.curl = a.L === 'weapon' ? 0.95 : 0.8;
  }

  if (done) g.mel = null;
}

// ---------- scout drone: deploy / tablet hold / stow (sequence data + models: droneKit.js) ----------
const AX_X = new THREE.Vector3(1, 0, 0), AX_Y = new THREE.Vector3(0, 1, 0), AX_Z = new THREE.Vector3(0, 0, 1);
const UP = new THREE.Vector3(0, 1, 0);
const _R = [0, 0, 0], _rot = [0, 0, 0], _info = { a: REST, b: REST, u: 0 };
const _eye = new THREE.Vector3(), _bx = new THREE.Vector3(), _by = new THREE.Vector3(), _bz = new THREE.Vector3();
const _basis = new THREE.Matrix4(), _dq = new THREE.Quaternion(), _rq = new THREE.Quaternion(), _mq = new THREE.Quaternion();
const _gR = new THREE.Vector3(), _gD = new THREE.Vector3(), _free = new THREE.Vector3(), _lt = new THREE.Vector3();
const _eyeL = new THREE.Vector3(0, 0.1, -0.05); // eye, relative to the head pivot

const hermite = (p0, p1, m0, m1, u) => {
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * m1;
};

/** Smooth (cubic Hermite) pass through keyframes: continuous velocity, but it still stops dead on held keys. */
function evalSeq(keys, t, R, rot, info) {
  let i = 0;
  while (i < keys.length - 2 && t >= keys[i + 1].t) i++;
  const a = keys[i], b = keys[i + 1];
  const p = i > 0 ? keys[i - 1] : null, n = i + 2 < keys.length ? keys[i + 2] : null;
  const dt = Math.max(1e-4, b.t - a.t), u = clamp((t - a.t) / dt);
  for (let j = 0; j < 6; j++) {
    const k = j % 3, src = j < 3 ? 'R' : 'rot';
    const A = a[src][k], B = b[src][k];
    let m0 = 0, m1 = 0;
    if (A !== B) {
      if (p && p[src][k] !== A) m0 = ((B - p[src][k]) / (b.t - p.t)) * dt;
      if (n && n[src][k] !== B) m1 = ((n[src][k] - A) / (n.t - a.t)) * dt;
    }
    const v = hermite(A, B, m0, m1, u);
    if (j < 3) R[j] = v; else rot[k] = v;
  }
  info.a = a; info.b = b; info.u = u;
}

/** the operator's eyes in rig space (first person: the camera, at the origin) */
function eyeInRig(g, out) {
  if (g.fp || !g.head || !g.hold) return out.set(0, 0, 0);
  g.head.updateWorldMatrix(true, false);
  g.hold.updateWorldMatrix(true, false);
  out.copy(_eyeL);
  g.head.localToWorld(out);
  return g.hold.worldToLocal(out);
}
const toRig = (tab, m, p, out) => out.copy(p).applyMatrix4(tab.matrix).applyMatrix4(m.matrix);
const dirRig = (tab, m, d, out) => out.copy(d).transformDirection(tab.matrix).transformDirection(m.matrix);

function poseDrone(g, T, st) {
  const w = g.w, m = w.group, off = T.meleeOff, fp = !!g.fp, hid = !!st.hidden, tab = w.tablet, prop = w.prop;
  g._wrapR = null;
  g._wrapL = null;
  if (g.mel && g.mel.kind !== 'deploy' && g.mel.kind !== 'stow') g.mel = null;
  const mel = g.mel;

  // ----- which sequence, and where are we in it -----
  let spec = null, t = 0, done = false;
  if (mel) {
    spec = mel.kind === 'deploy' ? DEPLOY : STOW;
    // an invisible rig (your own body in first person) doesn't animate: when the camera moves to the drone, skip straight to the hold
    if (st.tabletHold && mel.kind === 'deploy' && !mel.holding) { mel.holding = true; mel.started = true; mel.prevT = spec.dur; }
    if (mel.holding) mel.t = spec.dur; else mel.t += st.dt;
    t = Math.min(mel.t, spec.dur);
    if (!mel.started) { mel.started = true; if (st.emit && mel.kind === 'deploy') st.emit('deployStart', { i: 0 }); }
    if (mel.kind === 'deploy' && !mel.holding) {
      for (const e of DEPLOY.events) if (mel.prevT < e[0] && mel.t >= e[0] && st.emit) st.emit(e[1], { t: mel.t, fp });
      mel.prevT = mel.t;
      if (mel.t >= spec.dur) mel.holding = true;
    } else if (mel.kind === 'stow' && mel.t >= spec.dur) done = true;
  } else if (st.tabletHold) { spec = DEPLOY; t = DEPLOY.dur; }

  if (spec) evalSeq(spec.keys, t, _R, _rot, _info);
  else { for (let i = 0; i < 3; i++) { _R[i] = REST.R[i]; _rot[i] = REST.rot[i]; } _info.a = REST; _info.b = REST; _info.u = 0; }
  const a = _info.a, b = _info.b, uL = sstep(_info.u);

  // ----- what's visible / how the props look right now -----
  const clock = performance.now() / 1000;
  const D = DEPLOY.drone, B = DEPLOY.tablet;
  let showDrone = false, showTab = false, unfold = 1, droneS = 1, tabS = 1, ant = 0, scr = 'off', scrP = 9, press = false;
  let kD = 0, kT = 0; // how much the right hand is on the drone handle / the tablet grip
  if (spec === DEPLOY) {
    showDrone = t >= D.show[0] && t < D.show[1];
    unfold = sstep((t - D.unfold[0]) / (D.unfold[1] - D.unfold[0]));
    droneS = 0.85 + 0.15 * sstep((t - D.show[0]) / 0.25);
    showTab = t >= B.show;
    tabS = 0.2 + 0.8 * sstep((t - B.show) / 0.3);
    ant = sstep((t - B.ant[0]) / (B.ant[1] - B.ant[0]));
    if (t < B.boot[0]) scr = 'off';
    else if (t < B.boot[1]) { scr = 'boot'; scrP = (t - B.boot[0]) / (B.boot[1] - B.boot[0]); }
    else if (t < B.live) { scr = 'link'; press = B.taps.some((x) => t >= x && t < x + 0.14); }
    else { scr = 'live'; scrP = t - B.live; }
    kD = sstep((t - D.show[0]) / 0.2) * (1 - sstep((t - D.show[1]) / 0.2));
    kT = sstep((t - B.show) / 0.3);
  } else if (spec === STOW) {
    showTab = t < STOW.hide;
    tabS = 1 - 0.8 * sstep((t - STOW.shrink[0]) / (STOW.shrink[1] - STOW.shrink[0]));
    ant = 1 - sstep((t - STOW.ant[0]) / (STOW.ant[1] - STOW.ant[0]));
    scr = t < STOW.off ? 'live' : 'off';
    kT = 1 - sstep((t - (STOW.hide - 0.2)) / 0.2);
  }
  const tabOn = showTab && !hid;
  w.setDrone(showDrone && !hid, unfold, droneS);
  w.setTablet(tabOn, { ant, state: scr, p: scrP, time: clock, press });
  m.visible = !hid && (showDrone || showTab);

  // ----- third person: lean while placing, look down at the tablet -----
  if (!fp && g.chest && g.head) {
    let bend = 0;
    if (spec === DEPLOY) {
      const bb = DEPLOY.bend;
      bend = sstep((t - bb[0]) / (bb[1] - bb[0])) * (1 - sstep((t - bb[2]) / (bb[3] - bb[2])));
    }
    g.tabLook = damp(g.tabLook || 0, tabOn ? 1 : 0, 5, st.dt);
    g.chest.rotation.x -= bend * 0.7;
    g.head.rotation.x -= g.tabLook * 0.42;
  }

  // ----- the group (drone prop / tablet carrier) -----
  const sp = st.s, low = st.lower;
  m.position.set(_R[0] + off[0] + 0.04 * sp + st.ox * 0.5, _R[1] + off[1] - 0.06 * sp + st.oy * 0.5 + T.lower.y * low, _R[2] + off[2] + 0.1 * sp + st.oz);
  m.rotation.set(_rot[0] + 0.3 * sp + T.lower.rx * low, _rot[1], _rot[2]);
  m.updateMatrix();

  // ----- tablet: screen always faces the operator's eyes -----
  tab.scale.setScalar((fp ? 0.85 : 1.0) * tabS);
  if (tabOn) {
    eyeInRig(g, _eye);
    _bz.subVectors(_eye, m.position);
    if (_bz.lengthSq() < 1e-6) _bz.set(0, 0, 1);
    _bz.normalize();
    _bx.crossVectors(UP, _bz);
    if (_bx.lengthSq() < 1e-4) _bx.set(1, 0, 0);
    _bx.normalize();
    _by.crossVectors(_bz, _bx);
    _basis.makeBasis(_bx, _by, _bz);
    _dq.setFromRotationMatrix(_basis);
    // slightly canted while it comes out of the pouch, then level
    const roll = spec === DEPLOY ? 0.5 * (1 - sstep((t - B.show) / 0.85)) - 0.05
      : spec === STOW ? -0.05 + 0.5 * sstep(t / STOW.hide) : -0.05;
    _dq.multiply(_rq.setFromAxisAngle(AX_Z, roll));
    // the tablet is a child of the group: cancel the group's rotation so it keeps the orientation above
    tab.quaternion.copy(_mq.copy(m.quaternion).invert().multiply(_dq));
    tab.position.set(0, 0, 0);
    tab.updateMatrix();
  }

  // ----- right hand: free -> drone handle -> free -> tablet grip -----
  _free.set(0, 0, 0).applyMatrix4(m.matrix);
  _tr.copy(_free);
  if (kD > 0) {
    _hc.set(0, w.handleY * prop.scale.y, 0).applyMatrix4(m.matrix);
    palmDir(g.armR, g.rlR, _pn);
    _gD.copy(_hc).addScaledVector(g.fdR, -HAND_L).addScaledVector(_pn, -HAND_P);
    _tr.addScaledVector(_gD.sub(_free), kD);
  }
  if (kT > 0 && tabOn) {
    toRig(tab, m, w.tab.gripR, _gR);
    palmDir(g.armR, g.rlR, _pn);
    _gR.addScaledVector(g.fdR, -HAND_L).addScaledVector(_pn, -HAND_P);
    _tr.addScaledVector(_gR.sub(_free), kT);
  }
  const open = spec ? 0.3 : 0.7;
  _resR.roll = -PI / 2;
  _resR.curl = open + (1.0 - open) * kD + (0.9 - open) * kT;
  if (kT > 0.3 && kT >= kD && tabOn) _axR = dirRig(tab, m, AX_Y, _ha); // fist around the vertical grip
  else if (kD > 0.3) _axR = _ha.set(0, 0, -1).transformDirection(m.matrix); // ... or the carry handle

  // ----- left hand: rest / steady the drone / tablet grip / hover + tap the screen -----
  const isPt = (L) => L === 'hover' || L === 'tap';
  const leftPos = (L, out) => {
    if (Array.isArray(L)) return out.set(L[0] + off[0], L[1] + off[1], L[2] + off[2]);
    if (L === 'drone') _lt.set(-0.075 * prop.scale.x, 0.02, 0).applyMatrix4(m.matrix);
    else if (tabOn && L === 'grip') toRig(tab, m, w.tab.gripL, _lt);
    else if (tabOn && isPt(L)) {
      _lt.copy(w.tab.tap);
      if (L === 'hover') _lt.z += 0.07;
      toRig(tab, m, _lt, _lt);
      return out.copy(_lt).addScaledVector(g.fdL, -TAP_REACH); // wrist sits back from the fingertip
    } else return out.set(T.restL[0], T.restL[1], T.restL[2]);
    palmDir(g.armL, g.rlL, _pn);
    return out.copy(_lt).addScaledVector(g.fdL, -HAND_L).addScaledVector(_pn, -HAND_P);
  };
  leftPos(a.L, _k0); leftPos(b.L, _k1);
  _lh.lerpVectors(_k0, _k1, uL);
  const pt = tabOn ? lerp(isPt(a.L) ? 1 : 0, isPt(b.L) ? 1 : 0, uL) : 0;
  const gp = tabOn ? lerp(a.L === 'grip' ? 1 : 0, b.L === 'grip' ? 1 : 0, uL) : 0;
  if (gp + pt > 0.01) {
    dirRig(tab, m, AX_Y, _hb).multiplyScalar(gp);
    dirRig(tab, m, AX_X, _tmp).multiplyScalar(pt);
    _axL = _hb.add(_tmp).normalize();
  }
  g._pointAmt = pt;
  const cl = (L) => (L === 'grip' ? 0.9 : L === 'drone' ? 0.55 : isPt(L) ? 0.6 : 0.8);
  _resL.roll = PI / 2;
  _resL.curl = lerp(cl(a.L), cl(b.L), uL);

  if (done) g.mel = null;
}

// ---------- Ridgeback Lottery: draw the round, conjure the rune rings, seal it (sequence + model: lotteryKit.js) ----------
const _lotFx = {};
const _lq = new THREE.Quaternion();

function poseLottery(g, T, st) {
  const w = g.w, m = w.group, off = T.meleeOff, fp = !!g.fp, hid = !!st.hidden;
  g._wrapR = null;
  g._wrapL = null;
  if (g.mel && g.mel.kind !== 'deploy') g.mel = null;
  const mel = g.mel;
  const clock = performance.now() / 1000;

  // ----- where are we in the ritual (and what does the model look like) -----
  let t = 0, done = false;
  if (mel) {
    mel.t += st.dt;
    t = Math.min(mel.t, LOT_DEPLOY.dur);
    if (st.emit) for (const e of LOT_DEPLOY.events) if (mel.prevT < e[0] && mel.t >= e[0]) st.emit(e[1], { t: mel.t, fp });
    mel.prevT = mel.t;
    done = mel.t >= LOT_DEPLOY.dur;
    evalSeq(LOT_DEPLOY.keys, t, _R, _rot, _info);
    lotteryFx(t, _lotFx);
  } else {
    for (let i = 0; i < 3; i++) { _R[i] = LOT_REST.R[i]; _rot[i] = LOT_REST.rot[i]; }
    _info.a = LOT_REST; _info.b = LOT_REST; _info.u = 0;
    lotteryIdleFx(_lotFx, clock, LOT.state);
  }
  _lotFx.time = clock;
  _lotFx.dt = st.dt;
  _lotFx.fxScale = fp ? 1 : 1.35;
  const a = _info.a, b = _info.b, uL = sstep(_info.u);
  w.setFx(_lotFx);
  m.visible = !hid;

  // ----- third person: look down at the round while it's being conjured -----
  if (!fp && g.head) {
    g.lotLook = damp(g.lotLook || 0, mel && t > 0.45 && t < 2.3 ? 1 : 0, 5, st.dt);
    g.head.rotation.x -= g.lotLook * 0.3;
  }

  // ----- the group (round + rings) -----
  const sp = st.s, low = st.lower;
  m.position.set(_R[0] + off[0] + 0.04 * sp + st.ox * 0.5, _R[1] + off[1] - 0.06 * sp + st.oy * 0.5 + T.lower.y * low, _R[2] + off[2] + 0.1 * sp + st.oz);
  m.rotation.set(_rot[0] + 0.3 * sp + T.lower.rx * low, _rot[1], _rot[2]);
  m.updateMatrix();

  // ----- casting sigil: faces the operator's eyes, sits just behind the round -----
  const sg = w.sigil;
  if (sg.visible && !hid) {
    eyeInRig(g, _eye);
    _bz.subVectors(_eye, m.position);
    if (_bz.lengthSq() < 1e-6) _bz.set(0, 0, 1);
    _bz.normalize();
    _bx.crossVectors(UP, _bz);
    if (_bx.lengthSq() < 1e-4) _bx.set(1, 0, 0);
    _bx.normalize();
    _by.crossVectors(_bz, _bx);
    _basis.makeBasis(_bx, _by, _bz);
    _dq.setFromRotationMatrix(_basis);
    _lq.copy(m.quaternion).invert(); // the sigil is a child of the group: cancel its rotation
    sg.quaternion.copy(_lq).multiply(_dq);
    sg.position.copy(_bz).multiplyScalar(-0.07 * _lotFx.fxScale).applyQuaternion(_lq);
  }

  // ----- right hand: empty -> closes around the round -----
  const kHold = sstep(_lotFx.show);
  _free.set(0, 0, 0).applyMatrix4(m.matrix);
  _tr.copy(_free);
  if (kHold > 0.001) {
    _hc.copy(w.anchors.hold).applyMatrix4(m.matrix);
    palmDir(g.armR, g.rlR, _pn);
    _gD.copy(_hc).addScaledVector(g.fdR, -HAND_L).addScaledVector(_pn, -HAND_P);
    _tr.addScaledVector(_gD.sub(_free), kHold);
    if (kHold > 0.3) _axR = _ha.set(0, 0, -1).transformDirection(m.matrix); // fist closes around the case
  }
  _resR.roll = -PI / 2;
  _resR.curl = 0.4 + 0.55 * kHold;

  // ----- left hand: rest -> open palm conjuring around the round (offsets are relative to the round) -----
  const leftAt = (L, out) => (Array.isArray(L)
    ? out.set(L[0], L[1], L[2]).add(m.position)
    : out.set(T.restL[0], T.restL[1], T.restL[2]));
  leftAt(a.L, _k0); leftAt(b.L, _k1);
  _lh.lerpVectors(_k0, _k1, uL);
  const lc = (L) => (Array.isArray(L) ? 0.25 : 0.8);
  _resL.roll = PI / 2;
  _resL.curl = lerp(lc(a.L), lc(b.L), uL);

  if (done) g.mel = null;
}

function finishArms(g, T) {
  const ov = (g.fp && g.def && OVR[g.def.id]) || {};
  const poleR = ov.poleR || T.poleR;
  const poleL = ov.poleL || T.poleL;
  solveArm(g.armR, _tr, _pole.fromArray(poleR));
  g.fdR.subVectors(_w, _e).normalize();
  if (_axR) { g.rlR = alignRoll(g.armR, _axR, g.rlR, -PI / 2); _resR.roll = g.rlR; }
  g.armR.hand.rotation.y = _resR.roll;
  if (g._wrapR) {
    if (g._wrapR.fingers || (_resR.fingers)) {
      const f = g._wrapR.fingers || _resR.fingers;
      if (g.armR.hand && g.armR.hand.userData && g.armR.hand.userData.curlEach) {
        g.armR.hand.userData.curlEach(f);
      } else {
        wrapFingers(g.armR, g._wrapR.origin, g._wrapR.axis, g._wrapR.radius, g._wrapR.curl);
      }
    } else {
      wrapFingers(g.armR, g._wrapR.origin, g._wrapR.axis, g._wrapR.radius, g._wrapR.curl);
    }
  } else if (_resR.fingers && g.armR.hand && g.armR.hand.userData && g.armR.hand.userData.curlEach) {
    g.armR.hand.userData.curlEach(_resR.fingers);
  } else {
    g.armR.curl(_resR.curl);
  }
  solveArm(g.armL, _lh, _pole.fromArray(poleL));
  _lw.copy(_w); _le.copy(_e);
  g.fdL.subVectors(_w, _e).normalize();
  if (_axL) { g.rlL = alignRoll(g.armL, _axL, g.rlL, PI / 2); _resL.roll = g.rlL; }
  g.armL.hand.rotation.y = _resL.roll;
  if (g._wrapL) {
    if (g._wrapL.fingers || _resL.fingers) {
      const f = g._wrapL.fingers || _resL.fingers;
      if (g.armL.hand && g.armL.hand.userData && g.armL.hand.userData.curlEach) {
        g.armL.hand.userData.curlEach(f);
      } else {
        wrapFingers(g.armL, g._wrapL.origin, g._wrapL.axis, g._wrapL.radius, g._wrapL.curl);
      }
    } else {
      wrapFingers(g.armL, g._wrapL.origin, g._wrapL.axis, g._wrapL.radius, g._wrapL.curl);
    }
  } else if (g._pointAmt > 0.01) {
    pointHand(g.armL, g._pointAmt, _resL.curl);
  } else if (_resL.fingers && g.armL.hand && g.armL.hand.userData && g.armL.hand.userData.curlEach) {
    g.armL.hand.userData.curlEach(_resL.fingers);
  } else {
    g.armL.curl(_resL.curl);
  }
}

function poseRig(g, T, st) {
  if (!g.w) return;
  _pouch.fromArray(T.pouch);
  _fpMode = !!g.fp;
  _axR = _axL = null;
  g._pointAmt = 0;
  if (g.def.perk === 'drone') {
    poseDrone(g, T, st);
    finishArms(g, T);
  } else if (g.def.perk === 'lottery') {
    poseLottery(g, T, st);
    finishArms(g, T);
  } else if (g.def.kind === 'melee' || g.def.kind === 'utility') {
    poseMelee(g, T, st);
    finishArms(g, T);
  } else {
    poseGun(g, T, st);
    finishArms(g, T);
    postGun(g, st);
  }
}

// ---------- public API ----------
export function triggerShootKick(r) {
  const g = U(r);
  if (!g) return;
  g.kick = 1;
  g.kickRoll = Math.random() * 2 - 1;
  if (g.def && g.def.cycle) { g.cyOn = true; g.cycleT = -0.12; g.cyPrev = -1; }
}

/** Start a melee animation. kind: 'swing' | 'throw' | 'deploy' | 'stow'. Returns false if busy / not a melee weapon. */
export function triggerMelee(r, kind = 'swing') {
  const g = U(r);
  if (!g || !g.def) return false;
  if (g.def.kind !== 'melee' && g.def.kind !== 'utility') return false;
  const drone = g.def.perk === 'drone', lottery = g.def.perk === 'lottery';
  if (kind === 'throw' && !g.def.throw) return false;
  if (kind === 'stow' && !drone) return false;
  if (kind === 'deploy' && !drone && !lottery) return false;
  // allow interrupting a held (or nearly finished) deploy pose with stow
  const canStow = kind === 'stow' && g.mel && g.mel.kind === 'deploy' && (g.mel.holding || g.mel.t >= DEPLOY.dur - 0.6);
  if (g.mel && !canStow) return false;
  if (g.swapping) return false;
  const i = kind === 'swing' ? (g.swingIdx++ % g.def.swings.length) : 0;
  g.mel = { kind, i, t: 0, hit: false, rel: false, started: false, prevT: -1, holding: false };
  return true;
}
export function meleeBusy(r) {
  const g = U(r);
  return !!(g && g.mel);
}

export function resetViewmodelReload(vm) { const g = U(vm); if (g) g.rlPrev = -1; }
export function resetReloadAnim(ud) { const g = U(ud); if (g) g.rlPrev = -1; }

/**
 * First-person viewmodel.
 * opts: dt, moving, sprint, grounded, ads, reloading, reloadT, missing, ammo, weapon, weaponHidden,
 *       lookDX, lookDY, shot, tabletHold, onEvent(name, info)
 */
export function updateViewmodel(vm, o) {
  const u = U(vm);
  if (!u) return;
  const dt = Math.min(o.dt || 0.016, 0.05);
  u.time += dt;
  syncWeapon(u, o, dt);
  const def = u.def, gun = def.kind === 'gun';
  const rl = beginReload(u, o);
  stepCycle(u, dt, rl);

  const adsOn = !!o.ads && gun && !rl && !u.swapping;
  u.aimBlend = damp(u.aimBlend, adsOn ? 1 : 0, clamp(6 / (def.draw || 0.4), 7, 22), dt);
  u.sprintBlend = damp(u.sprintBlend, o.sprint && o.moving && !adsOn && !rl ? 1 : 0, 9, dt);
  const a = u.aimBlend, s = u.sprintBlend;
  const mv = !!o.moving && o.grounded !== false;
  u.bobAmp = damp(u.bobAmp, mv ? 1 : 0, 8, dt);
  if (mv) u.bob += dt * (o.sprint ? 12 : 8.5);
  const ba = u.bobAmp * (1 - a * 0.85) * (1 + s * 0.8);

  u.swayX = clamp(u.swayX - (o.lookDX || 0) * 0.0006, -0.05, 0.05);
  u.swayY = clamp(u.swayY + (o.lookDY || 0) * 0.0006, -0.05, 0.05);
  u.swayX = damp(u.swayX, 0, 8, dt);
  u.swayY = damp(u.swayY, 0, 8, dt);
  if (o.shot) triggerShootKick(u);
  u.kick = damp(u.kick, 0, 16, dt);
  const sw = 1 - a * 0.7;

  poseRig(u, TUNE.fp, {
    a, s, kick: u.kick, kickRoll: u.kickRoll, lower: sstep(u.lower), dt,
    ox: Math.sin(u.bob) * 0.012 * ba + u.swayX * sw,
    oy: Math.abs(Math.cos(u.bob)) * 0.011 * ba + Math.sin(u.time * 1.5) * 0.0012 * (1 - a * 0.5) + u.swayY * sw + (o.grounded === false ? -0.02 : 0),
    oz: 0, rx: u.swayY * 1.2, ry: u.swayX * 1.2, rz: -u.swayX * 1.5 + Math.sin(u.bob) * 0.01 * ba,
    rl, t: o.reloadT || 0, ammo: o.ammo, hidden: !!o.weaponHidden, tabletHold: !!o.tabletHold, emit: o.onEvent,
  });
}

/**
 * 3rd-person body (player, remotes, enemies).
 * opts: dt, moving, speed, grounded, ads, sprint, crouch, pitch, reloading, reloadT, missing, ammo, weapon,
 *       weaponHidden, dead, tabletHold, onEvent(name, info), onStep()
 */
export function updateHumanoidAnim(r, o) {
  const ud = U(r);
  if (!ud || !ud.hips) return;
  let dt = Math.min(o.dt || 0.016, 0.05);

  if (!o.dead && ud.root) {
    // invisible rig (e.g. your own body in first person): skip the whole animation, just keep reload state in sync
    if (!ud.root.visible) {
      if (o.reloading && ud.def && ud.def.kind === 'gun') {
        if (!ud.wasReloading) { ud.rlSpec = reloadSpec(ud.def, o.missing || 1); ud.wasReloading = true; }
        ud.rlPrev = Math.min(o.reloadT || 0, ud.rlSpec.total);
      } else { ud.wasReloading = false; ud.rlSpec = null; ud.rlPrev = -1; }
      return;
    }
    // distant characters animate less often (optional)
    if (LOD.on) {
      const dx = ud.root.position.x - LOD.x, dz = ud.root.position.z - LOD.z, d2 = dx * dx + dz * dz;
      const skip = d2 > 8100 ? 4 : d2 > 3025 ? 2 : 1;
      ud.accDt += dt;
      if (skip > 1 && ++ud.lodN % skip) return;
      dt = Math.min(ud.accDt, 0.1);
      ud.accDt = 0;
    }
  }

  if (o.dead) {
    ud.deathT += dt;
    const k = sstep(ud.deathT / 0.55);
    ud.hips.rotation.x = k * 1.5;
    ud.hips.position.y = lerp(HIP_Y, 0.17, k);
    ud.hips.position.z = 0;
    return;
  }
  ud.deathT = 0;
  ud.hips.rotation.x = 0;

  syncWeapon(ud, o, dt);
  const def = ud.def, gun = def.kind === 'gun';
  const rl = beginReload(ud, o);
  stepCycle(ud, dt, rl);

  const grounded = o.grounded !== false;
  const spd = grounded ? Math.max(0, o.speed || 0) : 0;
  const moving = !!o.moving && spd > 0.2;
  const adsOn = !!o.ads && gun && !rl && !ud.swapping;

  ud.aimBlend = damp(ud.aimBlend, adsOn ? 1 : 0, clamp(6 / (def.draw || 0.4), 7, 20), dt);
  ud.sprintBlend = damp(ud.sprintBlend, o.sprint && moving && !adsOn && !rl ? 1 : 0, 9, dt);
  ud.crouchBlend = damp(ud.crouchBlend, o.crouch ? 1 : 0, 10, dt);
  ud.airBlend = damp(ud.airBlend, grounded ? 0 : 1, 9, dt);
  ud.moveBlend = damp(ud.moveBlend, moving ? 1 : 0, 10, dt);
  const a = ud.aimBlend, s = ud.sprintBlend, c = ud.crouchBlend, air = ud.airBlend, m = ud.moveBlend;

  if (moving) ud.walkPhase += dt * spd * 1.5;
  const w = ud.walkPhase;
  const ampN = clamp(spd / 8.5);
  const swing = Math.sin(w) * (0.35 + 0.45 * ampN) * m * (1 - c * 0.4);
  const flexAmp = (0.5 + 0.5 * ampN) * m;
  const flexL = Math.max(0, Math.cos(w)) * flexAmp;
  const flexR = Math.max(0, -Math.cos(w)) * flexAmp;

  ud.legL.thigh.rotation.x = swing + c * 0.9 + air * 0.5;
  ud.legR.thigh.rotation.x = -swing + c * 0.9 + air * 0.35;
  ud.legL.shin.rotation.x = -(flexL + 0.04 + c * 1.4 + air * 0.9);
  ud.legR.shin.rotation.x = -(flexR + 0.04 + c * 1.4 + air * 0.6);

  ud.hips.position.y = HIP_Y - 0.23 * c + Math.abs(Math.sin(w)) * 0.04 * ampN * m * (1 - c);
  ud.hips.position.z = 0.127 * c;

  const pitch = o.pitch || 0;
  const lean = s * 0.18 + c * 0.15;
  ud.chest.rotation.x = pitch * 0.85 - lean; // negative = lean forward
  ud.head.rotation.x = pitch * 0.15 + lean * 0.8;

  if (o.onStep && moving && grounded) {
    const idx = Math.floor(w / PI);
    if (idx !== ud.stepIdx) {
      ud.stepIdx = idx;
      o.onStep();
    }
  }

  ud.kick = damp(ud.kick, 0, 16, dt);
  const bob = m * (1 - a * 0.8);
  poseRig(ud, TUNE.tp, {
    a, s, kick: ud.kick, kickRoll: ud.kickRoll, lower: sstep(ud.lower), dt,
    ox: Math.sin(w) * 0.008 * bob,
    oy: Math.abs(Math.cos(w)) * 0.01 * bob + Math.sin(performance.now() * 0.0016) * 0.002,
    oz: 0, rx: 0, ry: 0, rz: 0,
    rl, t: o.reloadT || 0, ammo: o.ammo, hidden: !!o.weaponHidden, tabletHold: !!o.tabletHold, emit: o.onEvent,
  });
}
