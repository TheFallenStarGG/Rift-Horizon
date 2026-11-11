/**
 * 3D models for every weapon. buildWeapon(model, tex) ->
 * { group, cls, sightY, adsZ, anchors{grip,fore,mag,port,handle,string,hold...}, parts{name:{set(v)}},
 *   props{shell,round,speed,bolt}, mag, magHome, magTilt, muzzle, eject, setAmmo(n) }
 * Gun space: -Z forward, +Y up, origin near the receiver. Melee: blade / head along -Z, edge faces -Y (the chop direction),
 * anchors.hold = where the fist closes on the handle.
 */
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { makeMaterials, makeRifle, makeMag, ANCHOR, CHARGE_Z, CHARGE_TRAVEL, MAG_TILT } from './parts.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const B = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const RB = (w, h, d, r = 0.007) => new RoundedBoxGeometry(w, h, d, 2, r);
const CY = (rt, rb, h, s = 12) => new THREE.CylinderGeometry(rt, rb, h, s);
const SP = (r) => new THREE.SphereGeometry(r, 10, 8);
const H = Math.PI / 2;
const c01 = (v) => Math.max(0, Math.min(1, v));

function mesh(geo, mat, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  return m;
}

const matCache = new WeakMap();
function mats(tex) {
  let m = matCache.get(tex);
  if (!m) {
    const S = (o) => new THREE.MeshStandardMaterial(o);
    m = {
      ...makeMaterials(tex),
      wood: S({ color: 0x6b4527, roughness: 0.7 }),
      steel: S({ color: 0xb9bcc0, metalness: 1, roughness: 0.22 }),
      blade: S({ color: 0xcfd3d6, metalness: 1, roughness: 0.18 }),
      shell: S({ color: 0xb8301f, roughness: 0.6 }),
      glass: S({ color: 0x1b3144, metalness: 0.9, roughness: 0.08 }),
      string: S({ color: 0xd8d2c0, roughness: 0.9 }),
    };
    matCache.set(tex, m);
  }
  return m;
}

function ctx(tex) {
  const M = mats(tex), g = new THREE.Group();
  const p = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0, parent = g) => {
    const m = mesh(geo, mat, x, y, z, rx, ry, rz);
    parent.add(m);
    return m;
  };
  const node = (x, y, z, parent = g) => {
    const n = new THREE.Group();
    n.position.set(x, y, z);
    parent.add(n);
    return n;
  };
  return { M, g, p, node };
}

const PROP = {
  shell: (M) => {
    const o = new THREE.Group();
    o.add(mesh(CY(0.0095, 0.0095, 0.045, 8), M.shell, 0, 0, 0, H), mesh(CY(0.01, 0.01, 0.012, 8), M.brass, 0, 0, 0.026, H));
    return o;
  },
  round: (M) => {
    const o = new THREE.Group();
    o.add(mesh(CY(0.006, 0.006, 0.04, 8), M.brass, 0, 0, 0, H), mesh(CY(0.0035, 0.006, 0.02, 8), M.steel, 0, 0, -0.03, H));
    return o;
  },
  speed: (M) => {
    const o = new THREE.Group();
    o.add(mesh(RB(0.04, 0.03, 0.014, 0.004), M.poly, 0, 0, 0.03));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      o.add(mesh(CY(0.005, 0.005, 0.03, 6), M.brass, Math.cos(a) * 0.012, Math.sin(a) * 0.012, 0, H));
    }
    return o;
  },
  bolt: (M) => {
    const o = new THREE.Group();
    o.add(mesh(CY(0.004, 0.004, 0.3, 8), M.black, 0, 0, 0, H), mesh(CY(0.0015, 0.005, 0.03, 8), M.steel, 0, 0, -0.165, H));
    return o;
  },
};

function out(c, o, propNames = []) {
  const props = {};
  for (const n of propNames) {
    const m = PROP[n](c.M);
    m.visible = false;
    c.g.add(m);
    props[n] = m;
  }
  return { group: c.g, props, parts: {}, mag: null, magHome: null, magTilt: 0, setAmmo() {}, adsZ: 0.36, ...o };
}

function smallMag(M, len) {
  const m = new THREE.Group();
  m.add(mesh(RB(0.026, len, 0.036, 0.004), M.poly, 0, -len / 2, 0), mesh(B(0.03, 0.01, 0.042), M.gunDark, 0, -len - 0.003, 0.002));
  return m;
}

function addBolt(c, x, y, z) {
  const { M, p, node } = c;
  const bolt = node(x, y, z);
  p(CY(0.007, 0.007, 0.08, 10), M.steel, 0, 0, 0, H, 0, 0, bolt);
  const arm = node(0, 0, 0.04, bolt);
  p(CY(0.0045, 0.0045, 0.05, 8), M.steel, 0.025, 0, 0, 0, 0, H, arm);
  p(SP(0.012), M.black, 0.052, 0, 0, 0, 0, 0, arm);
  const set = (v) => {
    arm.rotation.z = -0.9 + c01(v / 0.2) * 1.2;
    bolt.position.z = z + c01((v - 0.2) / 0.8) * 0.1;
  };
  set(0);
  return { set };
}

// ---------------- mains ----------------
function ar(tex) {
  const r = makeRifle(tex), u = r.userData, ch = u.charge;
  return {
    group: r, props: {}, cls: 'long', sightY: 0.098, adsZ: 0.38,
    anchors: { grip: ANCHOR.gripR.clone(), fore: ANCHOR.foreL.clone(), mag: ANCHOR.magHome.clone(), port: V(0.01, 0.03, -0.04), handle: V(-0.07, 0.045, -0.01) },
    mag: u.mag, magHome: ANCHOR.magHome.clone(), magTilt: MAG_TILT,
    parts: { charge: { set: (v) => { ch.position.z = CHARGE_Z + v * CHARGE_TRAVEL; } } },
    muzzle: u.muzzle, eject: u.eject, setAmmo() {},
  };
}

function smg(tex) {
  const c = ctx(tex), { M, g, p, node } = c;
  p(RB(0.05, 0.07, 0.22, 0.008), M.poly, 0, -0.02, 0);
  p(RB(0.046, 0.034, 0.24, 0.006), M.gun, 0, 0.032, -0.01);
  p(B(0.022, 0.008, 0.3), M.gunDark, 0, 0.054, -0.02);
  p(CY(0.017, 0.017, 0.15, 12), M.gunDark, 0, 0.012, -0.185, H);
  p(CY(0.02, 0.02, 0.1, 12), M.black, 0, 0.012, -0.31, H);
  p(B(0.004, 0.02, 0.004), M.black, 0, 0.068, -0.22);
  p(new THREE.TorusGeometry(0.011, 0.0025, 8, 14), M.black, 0, 0.074, 0.09);
  p(B(0.012, 0.012, 0.16), M.gunDark, 0, 0, 0.18);
  p(RB(0.04, 0.07, 0.012, 0.004), M.rubber, 0, -0.01, 0.265);
  p(RB(0.032, 0.1, 0.042, 0.01), M.poly, 0, -0.1, 0.075, -0.25);
  p(RB(0.03, 0.075, 0.034, 0.008), M.poly, 0, -0.085, -0.13);
  p(B(0.008, 0.006, 0.07), M.gunDark, 0, -0.066, 0.02);
  const mag = makeMag(tex);
  mag.scale.set(0.9, 1, 0.85);
  mag.position.set(0, -0.055, -0.045);
  g.add(mag);
  const ch = node(0, 0.05, 0.03);
  p(RB(0.018, 0.012, 0.028, 0.004), M.gunDark, 0, 0, 0, 0, 0, 0, ch);
  return out(c, {
    cls: 'long', sightY: 0.076, adsZ: 0.34,
    anchors: { grip: V(0.012, -0.15, 0.115), fore: V(-0.012, -0.08, -0.12), mag: V(0, -0.055, -0.045), port: V(0, 0.03, 0), handle: V(0, 0.05, 0.03) },
    mag, magHome: V(0, -0.055, -0.045), magTilt: MAG_TILT,
    parts: { charge: { set: (v) => { ch.position.z = 0.03 + v * 0.07; } } },
    muzzle: node(0, 0.012, -0.375), eject: node(0.028, 0.03, 0),
  });
}

function shotgun(tex) {
  const c = ctx(tex), { M, g, p, node } = c;
  p(RB(0.054, 0.08, 0.22, 0.01), M.gun, 0, -0.01, 0.03);
  p(CY(0.0155, 0.0155, 0.5, 12), M.gunDark, 0, 0.022, -0.32, H);
  p(CY(0.013, 0.013, 0.42, 12), M.gunDark, 0, -0.018, -0.27, H);
  p(CY(0.017, 0.017, 0.02, 12), M.black, 0, -0.018, -0.485, H);
  p(B(0.01, 0.006, 0.44), M.black, 0, 0.042, -0.3);
  p(SP(0.0055), M.brass, 0, 0.05, -0.56);
  const pump = node(0, -0.03, -0.27);
  p(RB(0.05, 0.05, 0.15, 0.012), M.poly, 0, 0, 0, 0, 0, 0, pump);
  for (let i = 0; i < 4; i++) p(B(0.054, 0.006, 0.01), M.black, 0, -0.01, -0.05 + i * 0.03, 0, 0, 0, pump);
  p(RB(0.046, 0.09, 0.26, 0.014), M.poly, 0, -0.035, 0.27, 0.06);
  p(B(0.048, 0.1, 0.014), M.rubber, 0, -0.04, 0.405);
  p(RB(0.034, 0.1, 0.042, 0.01), M.poly, 0, -0.1, 0.1, -0.28);
  p(B(0.008, 0.006, 0.07), M.gunDark, 0, -0.07, -0.02);
  p(B(0.03, 0.004, 0.05), M.black, 0, -0.052, -0.02);
  return out(c, {
    cls: 'long', sightY: 0.056, adsZ: 0.36,
    anchors: { grip: V(0.012, -0.15, 0.155), fore: V(0, -0.085, -0.22), port: V(0, -0.055, -0.02), handle: V(0, -0.085, -0.22) },
    parts: { pump: { set: (v) => { pump.position.z = -0.27 + v * 0.13; } } },
    muzzle: node(0, 0.022, -0.585), eject: node(0.028, 0.03, 0.04),
  }, ['shell']);
}

function sniper(tex) {
  const c = ctx(tex), { M, g, p, node } = c;
  p(RB(0.052, 0.07, 0.26, 0.008), M.gun, 0, -0.01, 0);
  p(CY(0.014, 0.014, 0.62, 12), M.gunDark, 0, 0.012, -0.44, H);
  p(CY(0.019, 0.019, 0.08, 12), M.black, 0, 0.012, -0.78, H);
  p(RB(0.05, 0.05, 0.28, 0.012), M.poly, 0, -0.012, -0.28);
  p(RB(0.048, 0.095, 0.3, 0.012), M.poly, 0, -0.03, 0.25);
  p(RB(0.036, 0.03, 0.17, 0.008), M.poly, 0, 0.036, 0.26);
  p(B(0.05, 0.1, 0.014), M.rubber, 0, -0.03, 0.4);
  p(RB(0.034, 0.1, 0.044, 0.01), M.poly, 0, -0.1, 0.1, -0.3);
  p(B(0.008, 0.006, 0.08), M.gunDark, 0, -0.07, -0.01);
  p(B(0.01, 0.01, 0.22), M.gunDark, -0.025, -0.045, -0.42);
  p(B(0.01, 0.01, 0.22), M.gunDark, 0.025, -0.045, -0.42);
  // scope
  p(CY(0.022, 0.022, 0.28, 16), M.black, 0, 0.088, -0.04, H);
  p(CY(0.032, 0.026, 0.07, 16), M.black, 0, 0.088, -0.2, H);
  p(CY(0.028, 0.022, 0.05, 16), M.black, 0, 0.088, 0.12, H);
  p(CY(0.027, 0.027, 0.004, 16), M.glass, 0, 0.088, -0.236, H);
  p(B(0.02, 0.03, 0.03), M.gun, 0, 0.056, -0.1);
  p(B(0.02, 0.03, 0.03), M.gun, 0, 0.056, 0.02);
  p(CY(0.011, 0.011, 0.012, 10), M.gunDark, 0, 0.116, -0.04);
  const bolt = addBolt(c, 0.034, 0.012, 0.03);
  const mag = smallMag(M, 0.07);
  mag.scale.set(1.3, 1, 1.6);
  mag.position.set(0, -0.055, -0.03);
  g.add(mag);
  return out(c, {
    cls: 'long', sightY: 0.088, adsZ: 0.25,
    anchors: { grip: V(0.012, -0.15, 0.155), fore: V(0, -0.08, -0.22), mag: V(0, -0.055, -0.03), port: V(0, 0.02, 0), handle: V(0.085, -0.025, 0.065) },
    mag, magHome: V(0, -0.055, -0.03), magTilt: 0,
    parts: { bolt },
    muzzle: node(0, 0.012, -0.825), eject: node(0.03, 0.02, 0.04),
  });
}

function hunter(tex) {
  const c = ctx(tex), { M, g, p, node } = c;
  p(RB(0.046, 0.06, 0.22, 0.008), M.gun, 0, -0.008, 0);
  p(CY(0.0125, 0.0125, 0.6, 12), M.gunDark, 0, 0.012, -0.41, H);
  p(RB(0.04, 0.045, 0.34, 0.012), M.wood, 0, -0.025, -0.3);
  p(RB(0.042, 0.1, 0.3, 0.014), M.wood, 0, -0.035, 0.24, 0.05);
  p(B(0.045, 0.1, 0.012), M.rubber, 0, -0.04, 0.4);
  p(RB(0.03, 0.09, 0.04, 0.01), M.wood, 0, -0.09, 0.09, -0.3);
  p(B(0.008, 0.006, 0.07), M.gunDark, 0, -0.058, -0.01);
  p(B(0.008, 0.02, 0.008), M.black, 0, 0.045, -0.7);
  p(B(0.018, 0.012, 0.008), M.black, 0, 0.034, -0.05);
  const bolt = addBolt(c, 0.03, 0.012, 0.04);
  return out(c, {
    cls: 'long', sightY: 0.055, adsZ: 0.34,
    anchors: { grip: V(0.012, -0.14, 0.14), fore: V(0, -0.07, -0.28), port: V(0, 0.015, 0.02), handle: V(0.075, -0.02, 0.075) },
    parts: { bolt },
    muzzle: node(0, 0.012, -0.715), eject: node(0.03, 0.02, 0.05),
  }, ['round']);
}

// ---------------- secondaries ----------------
function pistol(tex, ext) {
  const c = ctx(tex), { M, g, p, node } = c;
  const slide = node(0, 0.016, 0);
  p(RB(0.03, 0.04, ext ? 0.19 : 0.2, 0.006), ext ? M.gunDark : M.gun, 0, 0, -0.02, 0, 0, 0, slide);
  p(B(0.004, 0.009, 0.006), M.black, 0, 0.0245, -0.11, 0, 0, 0, slide);
  p(B(0.018, 0.011, 0.008), M.black, 0, 0.0245, 0.065, 0, 0, 0, slide);
  p(RB(0.03, 0.026, 0.18, 0.006), M.poly, 0, -0.022, -0.01);
  p(RB(0.034, 0.11, 0.05, 0.008), M.poly, 0, -0.085, 0.055, -0.18);
  p(B(0.006, 0.006, 0.06), M.gunDark, 0, -0.046, -0.03);
  p(CY(0.007, 0.007, 0.02, 8), M.black, 0, 0.016, -0.125, H);
  if (ext) p(B(0.026, 0.018, 0.03), M.black, 0, 0.026, -0.1);
  const mag = smallMag(M, ext ? 0.19 : 0.1);
  mag.position.set(0, -0.045, 0.052);
  mag.rotation.x = -0.18;
  g.add(mag);
  const st = { v: 0, kick: 0, lock: 0 };
  const upd = () => { slide.position.z = Math.max(st.v * 0.045, st.kick * 0.03, st.lock * 0.045); };
  return out(c, {
    cls: 'short', sightY: 0.045, adsZ: 0.44,
    anchors: { grip: V(0, -0.135, 0.115), fore: V(-0.03, -0.12, 0.03), mag: V(0, -0.045, 0.052), port: V(0, 0.03, 0.02), handle: V(0, 0.04, 0.075) },
    mag, magHome: V(0, -0.045, 0.052), magTilt: -0.18,
    parts: {
      slide: { set: (v) => { st.v = v; upd(); } },
      kick: { set: (k) => { st.kick = k; upd(); } },
    },
    setAmmo: (n) => { st.lock = n <= 0 ? 1 : 0; upd(); },
    muzzle: node(0, 0.016, -0.135), eject: node(0.02, 0.026, 0),
  });
}

function revolver(tex) {
  const c = ctx(tex), { M, g, p, node } = c;
  p(RB(0.034, 0.06, 0.13, 0.01), M.gun, 0, -0.005, 0.045);
  p(CY(0.011, 0.011, 0.26, 12), M.gun, 0, 0.02, -0.16, H);
  p(B(0.01, 0.008, 0.26), M.gunDark, 0, 0.037, -0.16);
  p(CY(0.007, 0.007, 0.2, 8), M.gunDark, 0, -0.008, -0.15, H);
  const crane = node(-0.028, 0, -0.04);
  p(CY(0.03, 0.03, 0.085, 16), M.steel, 0.028, 0, 0.04, H, 0, 0, crane);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    p(B(0.008, 0.012, 0.087), M.black, 0.028 + Math.cos(a) * 0.03, Math.sin(a) * 0.03, 0.04, 0, 0, a, crane);
  }
  p(RB(0.036, 0.1, 0.05, 0.012), M.wood, 0, -0.075, 0.1, -0.35);
  p(B(0.008, 0.026, 0.012), M.gunDark, 0, 0.03, 0.085, 0.3);
  p(B(0.006, 0.006, 0.07), M.gunDark, 0, -0.05, 0.04);
  p(B(0.005, 0.014, 0.005), M.black, 0, 0.048, -0.285);
  p(B(0.014, 0.008, 0.012), M.gun, 0, 0.04, 0.085);
  return out(c, {
    cls: 'short', sightY: 0.05, adsZ: 0.44,
    anchors: { grip: V(0.005, -0.125, 0.15), fore: V(-0.03, -0.12, 0.06), port: V(-0.052, 0, 0.04) },
    parts: { cyl: { set: (v) => { crane.rotation.y = -v * 1.15; } } },
    muzzle: node(0, 0.02, -0.295), eject: node(-0.03, 0, 0.02),
  }, ['speed']);
}

function sawnoff(tex) {
  const c = ctx(tex), { M, g, p, node } = c;
  p(RB(0.05, 0.07, 0.14, 0.008), M.gun, 0, -0.01, 0.02);
  p(RB(0.038, 0.08, 0.13, 0.012), M.wood, 0, -0.045, 0.14, 0.2);
  p(RB(0.034, 0.1, 0.04, 0.01), M.wood, 0, -0.095, 0.06, -0.3);
  p(B(0.006, 0.01, 0.03), M.steel, 0, 0.026, 0.07);
  const brk = node(0, -0.012, -0.075);
  p(CY(0.0125, 0.0125, 0.28, 12), M.gunDark, -0.0125, 0.0125, -0.14, H, 0, 0, brk);
  p(CY(0.0125, 0.0125, 0.28, 12), M.gunDark, 0.0125, 0.0125, -0.14, H, 0, 0, brk);
  p(B(0.03, 0.006, 0.28), M.black, 0, 0.027, -0.14, 0, 0, 0, brk);
  p(RB(0.045, 0.035, 0.1, 0.01), M.wood, 0, -0.012, -0.1, 0, 0, 0, brk);
  p(SP(0.004), M.brass, 0, 0.035, -0.27, 0, 0, 0, brk);
  return out(c, {
    cls: 'short', sightY: 0.03, adsZ: 0.42,
    anchors: { grip: V(0.012, -0.145, 0.11), fore: V(0, -0.07, -0.2), port: V(0, 0, -0.05) },
    parts: { break: { set: (v) => { brk.rotation.x = -v * 0.55; } } },
    muzzle: node(0, 0, -0.36, brk), eject: node(0, 0, -0.05),
  }, ['shell']);
}

function crossbow(tex) {
  const c = ctx(tex), { M, g, p, node } = c;
  p(RB(0.04, 0.07, 0.5, 0.01), M.poly, 0, -0.02, 0.02);
  p(B(0.018, 0.012, 0.5), M.gunDark, 0, 0.025, -0.05);
  p(RB(0.05, 0.03, 0.04, 0.008), M.gunDark, 0, 0.01, -0.2);
  p(RB(0.032, 0.1, 0.045, 0.01), M.poly, 0, -0.085, 0.1, -0.25);
  p(B(0.006, 0.006, 0.06), M.gunDark, 0, -0.06, 0.05);
  p(B(0.004, 0.016, 0.004), M.black, 0, 0.04, -0.15);
  p(B(0.018, 0.012, 0.006), M.black, 0, 0.04, 0.12);
  const limbR = node(0.02, 0.012, -0.2), limbL = node(-0.02, 0.012, -0.2);
  p(RB(0.15, 0.014, 0.016, 0.005), M.black, 0.075, 0, -0.018, 0, 0, 0, limbR);
  p(RB(0.15, 0.014, 0.016, 0.005), M.black, -0.075, 0, -0.018, 0, 0, 0, limbL);
  const strL = mesh(B(0.004, 0.004, 1), M.string), strR = mesh(B(0.004, 0.004, 1), M.string);
  g.add(strL, strR);
  const tipL = V(-0.17, 0.012, -0.254), tipR = V(0.17, 0.012, -0.254), np = V(0, 0.012, -0.254), a = V(), b = V();
  const seg = (m, from, to) => {
    m.position.addVectors(from, to).multiplyScalar(0.5);
    m.scale.z = from.distanceTo(to);
    m.rotation.set(0, Math.atan2(to.x - from.x, to.z - from.z), 0);
  };
  const setString = (v) => {
    limbR.rotation.y = 0.25 - v * 0.1;
    limbL.rotation.y = -0.25 + v * 0.1;
    np.z = -0.254 + v * 0.274;
    a.set(tipL.x, tipL.y, tipL.z + v * 0.02);
    b.set(tipR.x, tipR.y, tipR.z + v * 0.02);
    seg(strL, a, np);
    seg(strR, b, np);
  };
  const loadedBolt = new THREE.Group();
  loadedBolt.add(mesh(CY(0.004, 0.004, 0.3, 8), M.black, 0, 0, 0, H), mesh(CY(0.0015, 0.005, 0.03, 8), M.steel, 0, 0, -0.165, H));
  loadedBolt.position.set(0, 0.036, -0.05);
  g.add(loadedBolt);
  setString(1);
  return out(c, {
    cls: 'long', sightY: 0.052, adsZ: 0.34,
    anchors: { grip: V(0.01, -0.135, 0.15), fore: V(0, -0.07, -0.1), port: V(0, 0.03, -0.05), string: V(0, 0.02, -0.254) },
    parts: {
      string: { set: setString },
      loaded: { set: (v) => { loadedBolt.visible = v > 0.5; } },
    },
    setAmmo: (n) => { setString(n > 0 ? 1 : 0); loadedBolt.visible = n > 0; },
    muzzle: node(0, 0.036, -0.2), eject: node(0, 0.03, 0),
  }, ['bolt']);
}

// ---------------- melee ----------------
function melee(tex, kind) {
  const c = ctx(tex), { M, p } = c;
  const anchors = { grip: V(0, 0, 0), fore: V(0, 0, 0) };
  if (kind === 'knife') {
    p(RB(0.026, 0.03, 0.11, 0.008), M.rubber, 0, 0, 0.03);
    p(B(0.008, 0.046, 0.012), M.steel, 0, 0, -0.03);
    p(B(0.005, 0.034, 0.19), M.blade, 0, 0.004, -0.13);
    p(B(0.006, 0.008, 0.17), M.steel, 0, 0.02, -0.12);
    anchors.hold = V(0, 0, 0.03);
  } else if (kind === 'machete') {
    p(RB(0.028, 0.034, 0.12, 0.008), M.rubber, 0, 0, 0.035);
    p(B(0.01, 0.05, 0.014), M.steel, 0, 0, -0.03);
    p(B(0.005, 0.06, 0.42), M.blade, 0, 0.01, -0.26);
    p(B(0.008, 0.01, 0.42), M.steel, 0, 0.04, -0.26);
    anchors.hold = V(0, 0, 0.035);
  } else if (kind === 'tomahawk') {
    // handle along -Z, head plate in the YZ plane, cutting edge at the bottom (-Y = chop direction)
    p(CY(0.014, 0.016, 0.4, 10), M.wood, 0, 0, -0.12, H);
    p(B(0.02, 0.07, 0.085), M.steel, 0, 0.0, -0.325);
    p(B(0.012, 0.03, 0.1), M.steel, 0, -0.045, -0.325);
    p(B(0.004, 0.012, 0.11), M.blade, 0, -0.065, -0.325);
    p(B(0.014, 0.025, 0.04), M.steel, 0, 0.045, -0.31);
    anchors.hold = V(0, 0, -0.02);
  } else if (kind === 'sledge') {
    // head's long axis runs along Y (the swing direction), striking faces at +/-Y
    p(CY(0.018, 0.02, 0.95, 10), M.wood, 0, 0, -0.35, H);
    p(RB(0.1, 0.24, 0.1, 0.012), M.steel, 0, 0, -0.85);
    p(B(0.108, 0.02, 0.108), M.gunDark, 0, 0.1, -0.85);
    p(B(0.108, 0.02, 0.108), M.gunDark, 0, -0.1, -0.85);
    p(B(0.045, 0.045, 0.04), M.gunDark, 0, 0, -0.79);
    anchors.fore = V(0, 0, -0.3);
    anchors.hold = V(0, 0, 0.03);
  }
  return out(c, { cls: 'melee', sightY: 0, adsZ: 0.38, anchors, muzzle: null, eject: null });
}

function drone(tex) {
  const c = ctx(tex), { M, p } = c;
  p(RB(0.16, 0.05, 0.22, 0.012), M.poly, 0, 0.03, 0);
  p(RB(0.07, 0.035, 0.07, 0.01), M.glass, 0, 0.06, -0.03);
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    p(B(0.2, 0.012, 0.024), M.steel, sx * 0.1, 0.03, sz * 0.1, 0, Math.atan2(-sz, sx), 0);
    p(CY(0.07, 0.07, 0.008, 16), M.glass, sx * 0.14, 0.05, sz * 0.14);
  }
  const w = out(c, { cls: 'melee', anchors: { grip: V(0, 0, 0), fore: V(0, 0, -0.1), hold: V(0, 0, 0) } });
  // remember body parts so deploy can hide them while showing the tablet
  w.droneParts = w.group.children.slice();

  // Handheld control tablet — VERTICAL by construction.
  // Local axes: X = width, Y = height (up), Z = thickness. Screen sits on +Z (faces camera).
  const tab = new THREE.Group();
  const shell = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.24, 0.012),
    new THREE.MeshStandardMaterial({ color: 0x12161c, roughness: 0.4, metalness: 0.5 })
  );
  const bezel = new THREE.Mesh(
    new THREE.BoxGeometry(0.145, 0.22, 0.004),
    new THREE.MeshStandardMaterial({ color: 0x080b10, roughness: 0.5, metalness: 0.3 })
  );
  bezel.position.z = 0.007;
  const screen = new THREE.Mesh(
    new THREE.BoxGeometry(0.13, 0.195, 0.003),
    new THREE.MeshStandardMaterial({
      color: 0x0b3d2e, roughness: 0.18, metalness: 0.12,
      emissive: 0x0c4a30, emissiveIntensity: 0.9,
    })
  );
  screen.position.z = 0.01;
  // top status strip
  const bar = new THREE.Mesh(
    new THREE.BoxGeometry(0.11, 0.014, 0.002),
    new THREE.MeshStandardMaterial({ color: 0x1a5c40, emissive: 0x1aff88, emissiveIntensity: 0.55 })
  );
  bar.position.set(0, 0.082, 0.012);
  // drone icon in the centre of the screen
  const icon = new THREE.Mesh(
    new THREE.BoxGeometry(0.055, 0.055, 0.003),
    new THREE.MeshStandardMaterial({
      color: 0x3dff9a, roughness: 0.25, metalness: 0.2,
      emissive: 0x1aff88, emissiveIntensity: 1.15,
    })
  );
  icon.position.set(0, 0.01, 0.012);
  // corner LEDs on the screen face
  for (const [sx, sy] of [[-0.055, 0.08], [0.055, 0.08], [-0.055, -0.07], [0.055, -0.07]]) {
    const led = new THREE.Mesh(
      new THREE.BoxGeometry(0.01, 0.01, 0.002),
      new THREE.MeshStandardMaterial({ color: 0x3dff9a, emissive: 0x3dff9a, emissiveIntensity: 0.95 })
    );
    led.position.set(sx, sy, 0.012);
    tab.add(led);
  }
  // back panel
  const back = new THREE.Mesh(
    new THREE.BoxGeometry(0.15, 0.23, 0.003),
    new THREE.MeshStandardMaterial({ color: 0x1c2430, roughness: 0.5, metalness: 0.35 })
  );
  back.position.z = -0.007;
  tab.add(shell, bezel, screen, bar, icon, back);
  tab.visible = false;
  tab.userData.front = screen;
  // edge grips for hand IK (local space)
  tab.userData.gripR = new THREE.Vector3(0.085, -0.02, 0);
  tab.userData.gripL = new THREE.Vector3(-0.085, 0.04, 0.02);
  w.group.add(tab);
  w.tablet = tab;
  return w;
}


/** Golden single cartridge in a small rift cradle — Ridgeback Lottery utility prop. */
function lottery(tex) {
  const c = ctx(tex), { M, g, p, node } = c;
  // dark cradle
  p(RB(0.07, 0.04, 0.12, 0.008), M.poly, 0, 0, 0);
  p(RB(0.055, 0.008, 0.09, 0.004), new THREE.MeshStandardMaterial({
    color: 0x1a1208, metalness: 0.6, roughness: 0.35, emissive: 0x3a2808, emissiveIntensity: 0.25,
  }), 0, 0.022, 0);
  // oversized golden ridgeback round
  const brass = new THREE.MeshStandardMaterial({
    color: 0xffc247, metalness: 0.95, roughness: 0.22, emissive: 0xffa020, emissiveIntensity: 0.45,
  });
  const tip = new THREE.MeshStandardMaterial({
    color: 0xffe9a8, metalness: 1, roughness: 0.15, emissive: 0xffd060, emissiveIntensity: 0.35,
  });
  p(CY(0.014, 0.014, 0.055, 12), brass, 0, 0.045, 0.01, H);
  p(CY(0.008, 0.014, 0.028, 12), tip, 0, 0.045, -0.032, H);
  // rift ring under the shell
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.038, 0.004, 8, 24),
    new THREE.MeshStandardMaterial({
      color: 0xff8a2b, metalness: 0.7, roughness: 0.25, emissive: 0xff6a00, emissiveIntensity: 0.8,
    })
  );
  ring.rotation.x = H;
  ring.position.set(0, 0.018, 0.01);
  g.add(ring);
  // side fins
  for (const sx of [-1, 1]) {
    p(B(0.012, 0.028, 0.05), M.steel, sx * 0.04, 0.02, 0.01, 0, 0, sx * 0.2);
  }
  const w = out(c, {
    cls: 'melee',
    anchors: { grip: V(0, 0, 0.02), hold: V(0, 0, 0.02), fore: V(0, 0.04, -0.04) },
  });
  w.lotteryParts = w.group.children.slice();
  return w;
}

/** Cursed bone-handled ritual dagger with glowing runes — Hellgate Summon utility prop. */
function summon(tex) {
  const c = ctx(tex), { p } = c;
  const S = (o) => new THREE.MeshStandardMaterial(o);
  const bone = S({ color: 0xd9cfb4, roughness: 0.7 });
  const iron = S({ color: 0x1c0d0d, metalness: 0.9, roughness: 0.3, emissive: 0x4a0600, emissiveIntensity: 0.4 });
  const rune = S({ color: 0xff3a14, emissive: 0xff2200, emissiveIntensity: 1.6 });
  p(RB(0.024, 0.028, 0.11, 0.008), bone, 0, 0, 0.03);
  p(B(0.05, 0.012, 0.014), iron, 0, 0, -0.03);
  p(SP(0.013), rune, 0, 0, 0.092);
  const bl = p(new THREE.ConeGeometry(0.02, 0.26, 4), iron, 0, 0, -0.17, -H, 0, 0);
  bl.scale.set(0.3, 1, 1);
  p(B(0.003, 0.012, 0.12), rune, 0.004, 0, -0.12);
  p(B(0.003, 0.012, 0.12), rune, -0.004, 0, -0.12);
  return out(c, { cls: 'melee', sightY: 0, adsZ: 0.38, anchors: { grip: V(0, 0, 0), fore: V(0, 0, 0), hold: V(0, 0, 0.03) }, muzzle: null, eject: null });
}

const BUILDERS = {
  drone, lottery, summon, ar, smg, shotgun, sniper, hunter,
  pistol: (t) => pistol(t, false), mpistol: (t) => pistol(t, true),
  revolver, sawnoff, crossbow,
  fists: (t) => {
    const c = ctx(t), { M, p } = c;
    // tiny knuckle plates so fists aren't completely empty (hands do the real work)
    p(RB(0.04, 0.03, 0.055, 0.008), M.rubber, 0.02, 0, -0.02);
    p(RB(0.04, 0.03, 0.055, 0.008), M.rubber, -0.02, 0, -0.02);
    return out(c, { cls: 'melee', anchors: { grip: V(0, 0, 0), fore: V(0, 0, 0), hold: V(0, 0, 0) } });
  },
  knife: (t) => melee(t, 'knife'), machete: (t) => melee(t, 'machete'),
  tomahawk: (t) => melee(t, 'tomahawk'), sledge: (t) => melee(t, 'sledge'),
};

export function buildWeapon(model, tex) {
  const b = BUILDERS[model];
  if (!b) throw new Error('Unknown weapon model: ' + model);
  const w = b(tex);
  w.model = model;
  w.group.traverse((o) => { if (o.isMesh) o.frustumCulled = false; });
  return w;
}
