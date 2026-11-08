/**
 * Build mode item: the "Constructor", a handheld blueprint projector. It projects a hologram of the piece you have selected,
 * glows in the material colour, kicks when you place and flicks the hologram when you switch piece.
 * poseBuildTool() runs AFTER the normal weapon animation (first-person viewmodel and third-person body) and blends both
 * arms from the weapon pose onto the tool, so entering / leaving build mode is one smooth motion.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ARM_A, ARM_B, makeMaterials } from './parts.js';
import { TIERS } from './build.js';

const PI = Math.PI;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
const easeBack = (k) => { const c = 1.5, x = clamp(k) - 1; return 1 + (c + 1) * x * x * x + c * x * x; };
const HAND_L = 0.095, HAND_P = 0.025;

// ---------- model ----------
const RB = (w, h, d, r = 0.008) => new RoundedBoxGeometry(w, h, d, 2, r);

function mini(kind, fill, line) {
  const g = new THREE.Group();
  const add = (geo, x, y, z) => {
    const m = new THREE.Mesh(geo, fill);
    m.position.set(x, y, z);
    m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo), line));
    g.add(m);
  };
  if (kind === 'ramp') {
    for (let i = 0; i < 6; i++) add(new THREE.BoxGeometry(0.014, 0.012 * (i + 1), 0.07), -0.035 + i * 0.014 + 0.007, -0.036 + 0.006 * (i + 1), 0);
    g.position.y = 0.005;
    return g;
  }
  const geo = kind === 'wall' ? new THREE.BoxGeometry(0.026, 0.02, 0.006) : new THREE.BoxGeometry(0.026, 0.006, 0.026);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) add(geo, (c - 1) * 0.029, kind === 'wall' ? (r - 1) * 0.023 : 0, kind === 'wall' ? 0 : (r - 1) * 0.029);
  return g;
}

export function createBuildTool(tex) {
  const M = makeMaterials(tex);
  const group = new THREE.Group();
  group.visible = false;
  const accent = new THREE.MeshBasicMaterial({ color: 0xffb25e });
  const fill = new THREE.MeshBasicMaterial({ color: 0xffb25e, transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const line = new THREE.LineBasicMaterial({ color: 0xffe0b0, transparent: true, opacity: 0.95 });
  const part = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    group.add(m);
    return m;
  };
  part(RB(0.064, 0.078, 0.23), M.poly, 0, 0, 0);
  part(RB(0.05, 0.02, 0.2, 0.006), M.gun, 0, 0.046, -0.01);
  part(new THREE.BoxGeometry(0.004, 0.022, 0.13), accent, 0.033, 0.0, 0.02);
  part(new THREE.BoxGeometry(0.004, 0.022, 0.13), accent, -0.033, 0.0, 0.02);
  part(RB(0.04, 0.115, 0.052, 0.012), M.rubber, 0, -0.098, 0.078, -0.22);
  part(new THREE.BoxGeometry(0.008, 0.006, 0.07), M.gunDark, 0, -0.045, -0.03);
  part(new THREE.CylinderGeometry(0.026, 0.03, 0.1, 14), M.gun, 0, 0.004, -0.165, PI / 2);
  const lens = part(new THREE.TorusGeometry(0.03, 0.006, 8, 20), accent, 0, 0.004, -0.218);
  const core = part(new THREE.CircleGeometry(0.024, 16), accent, 0, 0.004, -0.2175);
  core.material = fill;
  part(new THREE.CylinderGeometry(0.028, 0.034, 0.014, 14), M.gun, 0, 0.06, -0.04);
  const dial = part(new THREE.CylinderGeometry(0.02, 0.02, 0.014, 12), M.gunDark, -0.038, 0.012, -0.035, 0, 0, PI / 2);
  dial.add(new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.016, 0.006), accent));
  const holo = new THREE.Group();
  holo.position.set(0, 0.125, -0.04);
  const minis = { wall: mini('wall', fill, line), floor: mini('floor', fill, line), ramp: mini('ramp', fill, line) };
  for (const k in minis) holo.add(minis[k]);
  group.add(holo);

  const st = { type: null, tier: -1, popT: 1, flashT: 0, flickT: 0, spin: 0, dialA: 0, bad: false };
  return {
    group, st,
    pulse(kind) { if (kind === 'place') st.flashT = 1; else { st.popT = 0; st.flickT = 1; st.flashT = Math.max(st.flashT, 0.5); } },
    update(dt, o) {
      if (o.type !== st.type) { if (st.type) { st.popT = 0; st.flickT = 1; } st.type = o.type; for (const k in minis) minis[k].visible = k === o.type; }
      if (o.tier !== st.tier) { st.tier = o.tier; accent.color.setHex(TIERS[o.tier].glow); if (st.tier >= 0) st.flashT = Math.max(st.flashT, 0.6); }
      st.bad = !!o.bad;
      const glow = st.bad ? 0xff5a4a : TIERS[st.tier < 0 ? 0 : st.tier].glow;
      fill.color.setHex(glow);
      line.color.setHex(st.bad ? 0xffb0a0 : 0xffffff);
      accent.color.setHex(glow);
      st.popT = Math.min(1, st.popT + dt / 0.24);
      st.flashT = Math.max(0, st.flashT - dt * 4);
      st.flickT = Math.max(0, st.flickT - dt * 3.5);
      st.spin += dt * (o.editing ? 3.2 : 1.1);
      const pop = easeBack(st.popT);
      holo.scale.setScalar(Math.max(0.05, pop) * (1 + st.flashT * 0.18));
      holo.position.y = 0.125 + Math.sin(o.time * 2.4) * 0.004;
      holo.rotation.y = o.type === 'wall' ? Math.sin(st.spin * 0.7) * 0.9 : st.spin;
      fill.opacity = 0.26 + 0.12 * Math.sin(o.time * 6) + st.flashT * 0.35;
      lens.scale.setScalar(1 + st.flashT * 0.45);
      st.dialA += (st.flickT > 0 ? dt * 14 : 0);
      dial.rotation.x = st.dialA;
    },
  };
}

// ---------- arm pose ----------
const DOWN = new THREE.Vector3(0, -1, 0);
const _s = new THREE.Vector3(), _d = new THREE.Vector3(), _e = new THREE.Vector3(), _w = new THREE.Vector3(), _pp = new THREE.Vector3();
const _u = new THREE.Vector3(), _f = new THREE.Vector3(), _qi = new THREE.Quaternion(), _q = new THREE.Quaternion();
const _c = new THREE.Vector3(), _t = new THREE.Vector3(), _pn = new THREE.Vector3(), _ax = new THREE.Vector3(), _pole = new THREE.Vector3();
const _xa = new THREE.Vector3(), _za = new THREE.Vector3();
const _gR = new THREE.Vector3(0, -0.105, 0.072), _axR = new THREE.Vector3(0, -1, 0.22);
const _gL = new THREE.Vector3(-0.058, -0.052, -0.098), _axL = new THREE.Vector3(0, 0, -1);
const POLES = {
  fp: { R: [0.6, -1, 0.3], L: [-0.5, -1, 0.2] },
  tp: { R: [0.5, -1, 0.35], L: [-0.4, -1, 0.25] },
};

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
function palmDir(arm, roll, out) {
  _q.copy(arm.shoulder.quaternion).multiply(arm.elbow.quaternion);
  return out.set(Math.sin(roll), 0, Math.cos(roll)).applyQuaternion(_q);
}
function alignRoll(arm, axis, prev, near) {
  _q.copy(arm.shoulder.quaternion).multiply(arm.elbow.quaternion);
  _xa.set(1, 0, 0).applyQuaternion(_q);
  _za.set(0, 0, 1).applyQuaternion(_q);
  const hx = axis.dot(_xa), hz = axis.dot(_za);
  if (hx * hx + hz * hz < 0.03) return prev;
  let r = Math.atan2(-hz, hx);
  if (Math.cos(r - near) < 0) r += PI;
  return r;
}

const _sq = new THREE.Quaternion(), _eq = new THREE.Quaternion();
/** solve one arm onto a fist position (rig space) and blend it in from whatever the weapon animation just posed */
function armTo(arm, side, bk, centerRig, axisRig, near, curl, kk, pole) {
  const sq0 = arm.shoulder.quaternion.clone(), eq0 = arm.elbow.quaternion.clone(), roll0 = arm.hand.rotation.y;
  const fd = bk['fd' + side];
  let roll = bk['rl' + side];
  for (let i = 0; i < 2; i++) { // the wrist sits back from the fist centre along the forearm; refine once with the new forearm
    palmDir(arm, roll, _pn);
    _t.copy(centerRig).addScaledVector(fd, -HAND_L).addScaledVector(_pn, -HAND_P);
    solveArm(arm, _t, pole);
    fd.subVectors(_w, _e).normalize();
  }
  roll = alignRoll(arm, axisRig, roll, near);
  bk['rl' + side] = roll;
  _sq.copy(arm.shoulder.quaternion); _eq.copy(arm.elbow.quaternion);
  arm.shoulder.quaternion.copy(sq0).slerp(_sq, kk);
  arm.elbow.quaternion.copy(eq0).slerp(_eq, kk);
  arm.hand.rotation.y = lerp(roll0, roll, kk);
  if (arm.curl) arm.curl(lerp(0.85, curl, kk));
}

/**
 * rig = the viewmodel's / body's userData. o = { k (0..1 build-mode blend), dt, time, kick (0..1), type, tier, bad, editing }
 */
export function poseBuildTool(rig, o) {
  if (!rig || !rig.hold || !rig.armR) return;
  let bk = rig.bk;
  if (o.k <= 0.002) { if (bk) bk.kit.group.visible = false; return; }
  if (rig.root && !rig.root.visible) { if (bk) bk.kit.group.visible = false; return; } // invisible body: nothing to animate
  if (!bk) {
    bk = rig.bk = { kit: createBuildTool(rig.tex), fdR: rig.fdR.clone(), fdL: rig.fdL.clone(), rlR: -PI / 2, rlL: PI / 2, flick: 0 };
    rig.hold.add(bk.kit.group);
    if (rig.fp) bk.kit.group.traverse((m) => { if (m.isMesh || m.isLineSegments) m.frustumCulled = false; });
  }
  const kit = bk.kit, tool = kit.group, fp = !!rig.fp;
  kit.update(o.dt, o);
  tool.visible = true;

  const kk = sstep(o.k), rise = easeBack(o.k), ent = 1 - rise;
  // sway / bob copied from the weapon rigs so the tool moves with the body
  let ox, oy;
  if (fp) {
    const ba = rig.bobAmp || 0;
    ox = Math.sin(rig.bob || 0) * 0.012 * ba + (rig.swayX || 0);
    oy = Math.abs(Math.cos(rig.bob || 0)) * 0.011 * ba + Math.sin((rig.time || 0) * 1.5) * 0.0012 + (rig.swayY || 0);
  } else {
    const bob = rig.moveBlend || 0;
    ox = Math.sin(rig.walkPhase || 0) * 0.008 * bob;
    oy = Math.abs(Math.cos(rig.walkPhase || 0)) * 0.01 * bob + Math.sin(o.time * 1.6) * 0.002;
  }
  const kick = o.kick || 0;
  if (fp) {
    tool.position.set(0.17 + ox, -0.205 + oy - ent * 0.26, -0.42 + ent * 0.1 + kick * 0.035);
    tool.rotation.set(0.05 + ent * 1.0 - kick * 0.16, 0.12, 0);
  } else {
    const sh = rig.armR.shoulder.position;
    tool.position.set(sh.x - 0.07 + ox, sh.y - 0.1 + oy - ent * 0.22, sh.z - 0.34 + ent * 0.08 + kick * 0.03);
    tool.rotation.set(-0.1 + ent * 0.9 - kick * 0.14, 0.08, 0);
  }
  tool.updateMatrix();

  const poles = fp ? POLES.fp : POLES.tp;
  // right hand: around the grip
  _c.copy(_gR).applyMatrix4(tool.matrix);
  _ax.copy(_axR).transformDirection(tool.matrix);
  armTo(rig.armR, 'R', bk, _c, _ax, -PI / 2, 0.95, kk, _pole.fromArray(poles.R));
  // left hand: cradles the front, flicks when you change piece, pushes when you place
  const flick = kit.st.flickT;
  _t.copy(_gL);
  _t.y += Math.sin(flick * PI) * 0.03;
  _t.z -= kick * 0.02 + Math.sin(flick * PI) * 0.015;
  _c.copy(_t).applyMatrix4(tool.matrix);
  _ax.copy(_axL).transformDirection(tool.matrix);
  armTo(rig.armL, 'L', bk, _c, _ax, PI / 2, 0.6 + 0.2 * flick, kk, _pole.fromArray(poles.L));

  if (!fp && rig.head) rig.head.rotation.x -= 0.2 * kk; // look down at the hologram
}

/** 'place' = a piece went down, 'type' = switched piece / material */
export function buildToolPulse(rig, kind) {
  if (rig && rig.bk) rig.bk.kit.pulse(kind);
}
