/**
 * Procedural cockpit for the light plane + a proper articulated pilot (IK arms, legs, gripping hands).
 *  - buildPlaneCockpit(T) -> { group, ctrl, stick, fill, grips, feet, update(st), dispose() }
 *  - createPilot(seat)    -> { g, pose(fp, handL, handR, footL, footR) }
 * Everything is built in MODEL coordinates (nose = +Z, left = +X, up = +Y), the same space as the GLB, and added to the model.
 * Measured from the GLB: cabin is ~1.2 m wide at the belt line, narrows above it (roof half-width ~0.47),
 * windshield spans z 0.89..1.34 with its lower edge at y ~1.70, roof inside at ~y 2.03, door is on the right (-X) side.
 */
import * as THREE from 'three';

const PI = Math.PI, TAU = PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const V3 = THREE.Vector3;
const AXY = new V3(0, 1, 0);

// ======================================================================================
// materials (shared)
// ======================================================================================
const M = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...o });
const MAT = {
  skin: M(0xd7a581, { roughness: 0.8 }), shirt: M(0x3b5b86, { roughness: 0.9 }), pants: M(0x2b2f3a, { roughness: 0.9 }), glove: M(0x202127, { roughness: 0.7 }),
  shoe: M(0x18181a, { roughness: 0.8 }), cap: M(0x2d3340, { roughness: 0.9 }), strap: M(0x2a2d33, { roughness: 0.9 }),
  seat: M(0x5a4636, { roughness: 0.75 }), seatLite: M(0x72594a, { roughness: 0.75 }), carpet: M(0x34383e, { roughness: 1 }), trim: M(0xb4aa94, { roughness: 0.9 }),
  trimDark: M(0x6d6556, { roughness: 0.9 }), head: M(0xd4cdbd, { roughness: 0.95 }), dash: M(0x26272a, { roughness: 0.9 }), dashTop: M(0x1a1b1d, { roughness: 1 }),
  black: M(0x121316, { roughness: 0.55, metalness: 0.2 }), chrome: M(0xa4aab0, { roughness: 0.3, metalness: 0.8 }), red: M(0xb3261e, { roughness: 0.5 }),
  blue: M(0x2457a6, { roughness: 0.5 }), steel: M(0x3a3d42, { roughness: 0.5, metalness: 0.6 }), white: M(0xe6e3da, { roughness: 0.7 }),
};

// ======================================================================================
// tiny helpers
// ======================================================================================
const mesh = (parent, geo, mat, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z); m.castShadow = false; m.receiveShadow = true; m.frustumCulled = false;
  parent.add(m);
  return m;
};
const box = (parent, w, h, d, mat, x, y, z) => mesh(parent, new THREE.BoxGeometry(w, h, d), mat, x, y, z);
const cyl = (parent, r0, r1, len, mat, x, y, z, axis = 'y') => {
  const m = mesh(parent, new THREE.CylinderGeometry(r0, r1, len, 10), mat, x, y, z);
  if (axis === 'z') m.rotation.x = PI / 2; else if (axis === 'x') m.rotation.z = PI / 2;
  return m;
};
const _d = new V3(), _n = new V3(), _p = new V3();

/** stretch a unit-height (along Y) mesh between two points */
function seg(m, p0, p1) {
  _d.subVectors(p1, p0);
  const L = _d.length() || 1e-4;
  m.position.addVectors(p0, p1).multiplyScalar(0.5);
  m.scale.set(1, L, 1);
  m.quaternion.setFromUnitVectors(AXY, _d.multiplyScalar(1 / L));
}
/** two-bone IK: elbow / knee position for a root a, a target b, bone lengths l1 / l2 and a pole direction */
function ik(a, b, l1, l2, pole, out) {
  _d.subVectors(b, a);
  const L = _d.length() || 1e-4;
  _n.copy(_d).multiplyScalar(1 / L);
  if (L >= l1 + l2 - 1e-3) { out.copy(a).addScaledVector(_d, l1 / (l1 + l2)); return; } // out of reach: stretch evenly so the limb never detaches
  const x = (l1 * l1 - l2 * l2 + L * L) / (2 * L), h = Math.sqrt(Math.max(l1 * l1 - x * x, 0));
  _p.copy(pole).addScaledVector(_n, -pole.dot(_n));
  if (_p.lengthSq() < 1e-6) _p.set(0, 1, 0).addScaledVector(_n, -_n.y);
  _p.normalize();
  out.copy(a).addScaledVector(_n, x).addScaledVector(_p, h);
}
const limb = (parent, r0, r1, mat) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, 1, 8), mat); m.castShadow = false; m.frustumCulled = false; parent.add(m); return m; };

// ======================================================================================
// hand: fingers wrap around a bar that runs along local Y. Wrist is behind the palm (-Z). k = +1 left hand, -1 right hand.
// ======================================================================================
function mkHand(k) {
  const h = new THREE.Group(), R = 0.031;
  box(h, 0.03, 0.088, 0.05, MAT.glove, 0, 0, -R - 0.02);
  cyl(h, 0.033, 0.033, 0.035, MAT.shirt, 0, 0, -R - 0.065, 'z'); // sleeve cuff
  const arc = [-90, -35, 20, 75].map((d) => { const t = (d * PI) / 180; return [k * R * Math.cos(t), R * Math.sin(t)]; });
  for (let f = 0; f < 4; f++) {
    const y = -0.033 + f * 0.022;
    for (let i = 0; i < 3; i++) {
      const [x0, z0] = arc[i], [x1, z1] = arc[i + 1], dx = x1 - x0, dz = z1 - z0;
      const m = box(h, 0.013, 0.019, Math.hypot(dx, dz) + 0.006, MAT.skin, (x0 + x1) / 2, y, (z0 + z1) / 2);
      m.rotation.y = Math.atan2(dx, dz);
    }
  }
  const t1 = box(h, 0.016, 0.02, 0.04, MAT.skin, -k * 0.026, 0.012, -0.04); t1.rotation.y = k * 0.25;
  box(h, 0.014, 0.018, 0.035, MAT.skin, -k * 0.027, 0.012, -0.006);
  return h;
}

// ======================================================================================
// pilot (shared by plane + helicopter). seat = model-space point on the cushion; +Y up, +Z forward, +X left.
// ======================================================================================
export function createPilot(seat) {
  const g = new THREE.Group(), body = new THREE.Group(), legs = new THREE.Group(), arms = new THREE.Group();
  g.position.set(seat[0], seat[1], seat[2]);
  g.add(body, legs, arms);
  const S = new V3(seat[0], seat[1], seat[2]);
  // torso + head (hidden in first person: the camera sits inside the head)
  box(body, 0.34, 0.46, 0.2, MAT.shirt, 0, 0.33, -0.07);
  box(body, 0.4, 0.1, 0.18, MAT.shirt, 0, 0.53, -0.07);
  cyl(body, 0.04, 0.045, 0.08, MAT.skin, 0, 0.61, -0.04);
  const head = mesh(body, new THREE.SphereGeometry(0.095, 14, 10), MAT.skin, 0, 0.71, -0.02);
  head.scale.set(0.92, 1.05, 1);
  const cap = mesh(body, new THREE.SphereGeometry(0.1, 14, 8, 0, TAU, 0, PI * 0.5), MAT.cap, 0, 0.73, -0.025);
  cap.rotation.x = -0.12;
  mesh(body, new THREE.TorusGeometry(0.1, 0.008, 6, 16, PI), MAT.black, 0, 0.71, -0.02);
  for (const sx of [-1, 1]) cyl(body, 0.034, 0.034, 0.028, MAT.black, sx * 0.1, 0.71, -0.02, 'x');
  // lap belt (stays visible in first person when looking down)
  box(legs, 0.4, 0.014, 0.07, MAT.strap, 0, 0.125, 0.07);
  box(legs, 0.05, 0.02, 0.05, MAT.chrome, 0, 0.13, 0.07);
  const sh = [new V3(0.185, 0.54, -0.07), new V3(-0.185, 0.54, -0.07)], hip = [new V3(0.09, 0.07, -0.02), new V3(-0.09, 0.07, -0.02)];
  const upper = [limb(arms, 0.046, 0.04, MAT.shirt), limb(arms, 0.046, 0.04, MAT.shirt)], fore = [limb(arms, 0.04, 0.032, MAT.shirt), limb(arms, 0.04, 0.032, MAT.shirt)];
  const hands = [mkHand(1), mkHand(-1)];
  arms.add(hands[0], hands[1]);
  const thigh = [limb(legs, 0.065, 0.05, MAT.pants), limb(legs, 0.065, 0.05, MAT.pants)], shin = [limb(legs, 0.05, 0.04, MAT.pants), limb(legs, 0.05, 0.04, MAT.pants)];
  const shoe = [box(legs, 0.09, 0.06, 0.25, MAT.shoe, 0, 0, 0), box(legs, 0.09, 0.06, 0.25, MAT.shoe, 0, 0, 0)];
  const poleA = [new V3(0.7, -0.75, -0.25), new V3(-0.7, -0.75, -0.25)], poleL = new V3(0, 1, 0.1);
  const knee = new V3(), elbow = new V3(), ankle = new V3(), wrist = new V3(), grip = new V3();
  const arm = (i, tgt) => {
    grip.subVectors(tgt.p, S);
    wrist.set(0, 0, -0.1).applyQuaternion(tgt.q).add(grip);
    ik(sh[i], wrist, 0.29, 0.27, poleA[i], elbow);
    seg(upper[i], sh[i], elbow); seg(fore[i], elbow, wrist);
    hands[i].position.copy(grip); hands[i].quaternion.copy(tgt.q);
  };
  const leg = (i, foot) => {
    ankle.subVectors(foot, S);
    ik(hip[i], ankle, 0.43, 0.43, poleL, knee);
    seg(thigh[i], hip[i], knee); seg(shin[i], knee, ankle);
    shoe[i].position.set(ankle.x, ankle.y - 0.04, ankle.z + 0.06);
  };
  return {
    g,
    /** targets are in MODEL space: hands = { p: Vector3 (grip centre), q: Quaternion (bar along local Y, wrist behind along -Z) }, feet = Vector3 (ankle) */
    pose(fp, handL, handR, footL, footR) {
      body.visible = !fp;
      arm(0, handL); arm(1, handR); leg(0, footL); leg(1, footR);
    },
  };
}

// ======================================================================================
// textures
// ======================================================================================
const PX = 1142.857; // panel pixels per metre (1280 px = 1.12 m)
let panelTex = null;
function mkTex(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}
function panelTexture() {
  if (panelTex) return panelTex;
  const W = 1280, H = 411, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#2a2b2e'; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? 255 : 0},${Math.random() < 0.5 ? 255 : 0},${Math.random() < 0.5 ? 255 : 0},0.03)`; g.fillRect(Math.random() * W, Math.random() * H, 2, 2); }
  const rr = (x, y, w, h, r, fill, stroke) => { g.beginPath(); g.roundRect(x, y, w, h, r); if (fill) { g.fillStyle = fill; g.fill(); } if (stroke) { g.strokeStyle = stroke; g.lineWidth = 3; g.stroke(); } };
  const lbl = (t, x, y, s = 14, col = '#d8d8d8', al = 'center') => { g.fillStyle = col; g.font = `700 ${s}px system-ui,sans-serif`; g.textAlign = al; g.textBaseline = 'middle'; g.fillText(t, x, y); };
  // flight-instrument plate + six bezels
  rr(48, 10, 476, 370, 14, '#16171a', '#3a3c40');
  for (const cy of [97, 280]) for (const cx of [137, 286, 435]) { g.fillStyle = '#0b0b0d'; g.beginPath(); g.arc(cx, cy, 73, 0, TAU); g.fill(); g.strokeStyle = '#74777c'; g.lineWidth = 5; g.beginPath(); g.arc(cx, cy, 71, 0, TAU); g.stroke(); }
  // engine column
  rr(560, 10, 160, 370, 14, '#16171a', '#3a3c40');
  g.fillStyle = '#0b0b0d'; g.beginPath(); g.arc(640, 97, 73, 0, TAU); g.fill(); g.strokeStyle = '#74777c'; g.lineWidth = 5; g.beginPath(); g.arc(640, 97, 71, 0, TAU); g.stroke();
  rr(570, 218, 140, 142, 10, '#0b0b0d', '#74777c');
  // indicator lamps (gear x3 + stall)
  for (const cy of [140, 185, 230]) { g.fillStyle = '#08090a'; g.beginPath(); g.arc(539, cy, 12, 0, TAU); g.fill(); g.strokeStyle = '#74777c'; g.lineWidth = 2; g.stroke(); }
  lbl('GEAR', 539, 112, 11, '#9fd6aa'); lbl('STALL', 539, 280, 10, '#e89a90'); g.fillStyle = '#08090a'; g.beginPath(); g.arc(539, 305, 12, 0, TAU); g.fill(); g.strokeStyle = '#74777c'; g.stroke();
  // radio stack
  const rad = [['COM 1', '118.30', '#ffb340'], ['COM 2', '127.50', '#ffb340'], ['NAV 1', '110.50', '#6dff9a'], ['XPDR', '1200', '#ffb340']];
  rad.forEach(([n, v, col], i) => {
    const y = 18 + i * 88;
    rr(760, y, 210, 78, 8, '#101114', '#4a4c51');
    lbl(n, 790, y + 16, 12, '#c9c9c9', 'left');
    rr(790, y + 28, 120, 38, 5, '#050607', '#2d2f33');
    g.fillStyle = col; g.font = '700 28px ui-monospace,Menlo,monospace'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(v, 850, y + 48);
    for (const kx of [930, 954]) { g.fillStyle = '#3d3f44'; g.beginPath(); g.arc(kx, y + 48, 9, 0, TAU); g.fill(); g.strokeStyle = '#8a8d92'; g.lineWidth = 2; g.stroke(); }
  });
  // switches
  const sw = ['MASTER', 'ALT', 'AVION', 'BEACON', 'NAV', 'LAND', 'PITOT', 'FUEL PMP'];
  sw.forEach((n, i) => {
    const x = 1010 + (i % 4) * 62, y = 36 + Math.floor(i / 4) * 92;
    rr(x - 14, y, 28, 52, 6, '#0b0b0d', '#5b5e63');
    rr(x - 9, y + (i % 3 === 0 ? 6 : 28), 18, 18, 4, '#b8bcc2');
    lbl(n, x, y + 66, 9);
  });
  // circuit breakers
  for (let r = 0; r < 2; r++) for (let i = 0; i < 12; i++) { g.fillStyle = '#dcdcd6'; g.beginPath(); g.arc(1008 + i * 20, 232 + r * 28, 7, 0, TAU); g.fill(); g.strokeStyle = '#111'; g.lineWidth = 1.5; g.stroke(); }
  lbl('CIRCUIT BREAKERS', 1128, 214, 10, '#9a9a9a');
  // ignition
  g.fillStyle = '#0b0b0d'; g.beginPath(); g.arc(1090, 332, 26, 0, TAU); g.fill(); g.strokeStyle = '#74777c'; g.lineWidth = 3; g.stroke();
  g.fillStyle = '#c9a23a'; g.fillRect(1086, 312, 8, 22);
  lbl('OFF', 1060, 308, 9); lbl('L', 1060, 332, 9); lbl('R', 1090, 296, 9); lbl('BOTH', 1124, 308, 9); lbl('START', 1124, 340, 9);
  // placard
  rr(1170, 304, 90, 56, 6, '#141518', '#4a4c51'); lbl('RIFT AIR', 1215, 322, 13, '#d6d6d6'); lbl('RH-1  LIGHT SINGLE', 1215, 342, 8, '#8f8f8f');
  panelTex = mkTex(c);
  return panelTex;
}

// ======================================================================================
// live gauges (drawn into small canvases, ~15 Hz, only while the pilot is looking at them)
// ======================================================================================
const AMB = '#ffc247', INK = '#e8eef6';
function dialBase(g, R) { g.fillStyle = '#0d0e10'; g.beginPath(); g.arc(0, 0, R, 0, TAU); g.fill(); }
function needle(g, a, len, w = 3, col = AMB, tail = 8) { g.save(); g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.moveTo(-Math.cos(a) * tail, -Math.sin(a) * tail); g.lineTo(Math.cos(a) * len, Math.sin(a) * len); g.stroke(); g.fillStyle = '#222'; g.beginPath(); g.arc(0, 0, 5, 0, TAU); g.fill(); g.restore(); }
function ticks(g, R, a0, sw, min, max, minor, major, o = {}) {
  g.save(); g.strokeStyle = 'rgba(255,255,255,.8)'; g.fillStyle = INK; g.lineWidth = 2; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `700 ${o.font || 11}px ui-monospace,monospace`;
  for (let x = min; x <= max + 1e-6; x += minor) {
    const a = a0 + ((x - min) / (max - min)) * sw, mj = Math.abs(((x - min) / major) - Math.round((x - min) / major)) < 1e-6, r0 = R - (mj ? 15 : 10);
    g.beginPath(); g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); g.lineTo(Math.cos(a) * (R - 5), Math.sin(a) * (R - 5)); g.stroke();
    if (mj && !o.nolabel) g.fillText(String(Math.round(x / (o.div || 1))), Math.cos(a) * (R - 27), Math.sin(a) * (R - 27));
  }
  g.restore();
}
function gAsi(g, R, kmh) {
  dialBase(g, R);
  const a0 = PI * 0.75, sw = PI * 1.5, ang = (v) => a0 + clamp(v / 360, 0, 1) * sw;
  g.lineWidth = 4;
  for (const [f, t, c] of [[100, 270, '#3fb56b'], [270, 331, '#d6b23a'], [331, 360, '#d63a3a']]) { g.strokeStyle = c; g.beginPath(); g.arc(0, 0, R - 5, ang(f), ang(t)); g.stroke(); }
  ticks(g, R, a0, sw, 0, 360, 20, 40, { font: 10 });
  g.fillStyle = 'rgba(255,255,255,.6)'; g.font = '700 9px system-ui'; g.textAlign = 'center'; g.fillText('KM/H', 0, R * 0.38);
  needle(g, ang(kmh), R - 14);
}
function gAtt(g, R, pitch, roll) {
  g.save(); g.beginPath(); g.arc(0, 0, R - 3, 0, TAU); g.clip();
  g.rotate(-roll);
  const k = R / 0.55, py = pitch * k;
  g.fillStyle = '#3f7fbf'; g.fillRect(-R * 2, -R * 3 + py, R * 4, R * 3);
  g.fillStyle = '#6b4a2b'; g.fillRect(-R * 2, py, R * 4, R * 3);
  g.strokeStyle = '#fff'; g.lineWidth = 2; g.beginPath(); g.moveTo(-R * 2, py); g.lineTo(R * 2, py); g.stroke();
  for (let d = -20; d <= 20; d += 10) { if (!d) continue; const y = py - d * (PI / 180) * k, w = d % 20 ? R * 0.22 : R * 0.4; g.beginPath(); g.moveTo(-w / 2, y); g.lineTo(w / 2, y); g.stroke(); }
  g.restore();
  g.save(); g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, R - 3, 0, TAU); g.stroke();
  g.rotate(-roll);
  for (const d of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) { const a = -PI / 2 + (d * PI) / 180, l = d % 30 === 0 ? 12 : 7; g.beginPath(); g.moveTo(Math.cos(a) * (R - 3), Math.sin(a) * (R - 3)); g.lineTo(Math.cos(a) * (R - 3 - l), Math.sin(a) * (R - 3 - l)); g.stroke(); }
  g.restore();
  g.strokeStyle = AMB; g.lineWidth = 4; g.lineCap = 'round'; g.beginPath(); g.moveTo(-R * 0.55, 0); g.lineTo(-R * 0.2, 0); g.lineTo(-R * 0.2, R * 0.08); g.moveTo(R * 0.55, 0); g.lineTo(R * 0.2, 0); g.lineTo(R * 0.2, R * 0.08); g.stroke();
  g.fillStyle = AMB; g.beginPath(); g.arc(0, 0, 3, 0, TAU); g.fill();
}
function gAlt(g, R, alt) {
  dialBase(g, R);
  ticks(g, R, -PI / 2, TAU, 0, 1000 - 1e-3, 20, 100, { div: 100, font: 12 });
  g.fillStyle = 'rgba(255,255,255,.6)'; g.font = '700 9px system-ui'; g.textAlign = 'center'; g.fillText('ALT M', 0, -R * 0.36);
  g.fillStyle = '#000'; g.fillRect(-24, R * 0.28, 48, 16); g.strokeStyle = '#555'; g.lineWidth = 1; g.strokeRect(-24, R * 0.28, 48, 16);
  g.fillStyle = AMB; g.font = '800 12px ui-monospace,monospace'; g.fillText(String(Math.round(alt)), 0, R * 0.28 + 9);
  needle(g, -PI / 2 + ((((alt % 1000) + 1000) % 1000) / 1000) * TAU, R - 16);
}
function gTurn(g, R, turn, slip) {
  dialBase(g, R);
  g.save(); g.strokeStyle = 'rgba(255,255,255,.8)'; g.lineWidth = 2;
  for (const s of [-1, 1]) for (const d of [0, 20]) { const a = (d * PI) / 180 * s; g.beginPath(); g.moveTo(Math.cos(a) * (R - 5) * (s), Math.sin(a) * (R - 5)); g.lineTo(Math.cos(a) * (R - 15) * s, Math.sin(a) * (R - 15)); g.stroke(); }
  g.fillStyle = INK; g.font = '700 11px system-ui'; g.textAlign = 'center'; g.fillText('L', -R + 14, -14); g.fillText('R', R - 14, -14); g.font = '700 8px system-ui'; g.fillText('2 MIN', 0, -R * 0.55); g.fillText('NO PITCH INFO', 0, R * 0.05 + 30);
  g.restore();
  g.save(); g.rotate(turn); g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = 4; g.lineCap = 'round';
  g.beginPath(); g.moveTo(-R * 0.62, 0); g.lineTo(R * 0.62, 0); g.moveTo(0, -R * 0.22); g.lineTo(0, 0); g.stroke(); g.beginPath(); g.arc(0, 0, 7, 0, TAU); g.fill(); g.restore();
  g.fillStyle = '#05080c'; g.beginPath(); g.roundRect(-R * 0.5, R * 0.44, R, 16, 8); g.fill(); g.strokeStyle = '#777'; g.lineWidth = 1.5; g.stroke();
  g.fillStyle = '#e6e6e6'; g.beginPath(); g.arc(clamp(slip, -1, 1) * R * 0.38, R * 0.44 + 8, 6, 0, TAU); g.fill();
}
function gDg(g, R, hdg) {
  dialBase(g, R);
  g.save(); g.rotate(-(hdg * PI) / 180);
  g.strokeStyle = 'rgba(255,255,255,.85)'; g.fillStyle = INK; g.lineWidth = 2; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '700 12px ui-monospace,monospace';
  const CARD = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
  for (let d = 0; d < 360; d += 5) {
    const a = (d * PI) / 180 - PI / 2, l = d % 30 === 0 ? 12 : d % 10 === 0 ? 8 : 4;
    g.beginPath(); g.moveTo(Math.cos(a) * (R - 4), Math.sin(a) * (R - 4)); g.lineTo(Math.cos(a) * (R - 4 - l), Math.sin(a) * (R - 4 - l)); g.stroke();
    if (d % 30 === 0) { g.save(); g.translate(Math.cos(a) * (R - 26), Math.sin(a) * (R - 26)); g.rotate((d * PI) / 180); g.fillText(CARD[d] || String(d / 10), 0, 0); g.restore(); }
  }
  g.restore();
  g.fillStyle = AMB; g.beginPath(); g.moveTo(0, -R + 3); g.lineTo(-6, -R + 15); g.lineTo(6, -R + 15); g.fill();
  g.strokeStyle = '#fff'; g.lineWidth = 3; g.lineCap = 'round'; g.beginPath(); g.moveTo(0, -16); g.lineTo(0, 14); g.moveTo(-14, 0); g.lineTo(14, 0); g.moveTo(-6, 13); g.lineTo(6, 13); g.stroke();
}
function gVsi(g, R, vsi) {
  dialBase(g, R);
  const a0 = PI, per = 0.85 * PI;
  g.save(); g.strokeStyle = 'rgba(255,255,255,.85)'; g.fillStyle = INK; g.lineWidth = 2; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '700 11px ui-monospace,monospace';
  for (let v = -10; v <= 10; v += 1) {
    const a = a0 + (v / 10) * per, mj = v % 2 === 0, r0 = R - (mj ? 15 : 10);
    g.beginPath(); g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); g.lineTo(Math.cos(a) * (R - 5), Math.sin(a) * (R - 5)); g.stroke();
    if (mj && v !== 0 && Math.abs(v) <= 10) g.fillText(String(Math.abs(v)), Math.cos(a) * (R - 27), Math.sin(a) * (R - 27));
  }
  g.font = '700 9px system-ui'; g.fillText('UP', -R * 0.38, -R * 0.4); g.fillText('DN', -R * 0.38, R * 0.4); g.fillText('VSI M/S', R * 0.1, R * 0.38);
  g.restore();
  needle(g, a0 + clamp(vsi / 10, -1, 1) * per, R - 14);
}
function gTach(g, R, rpm) {
  dialBase(g, R);
  const a0 = PI * 0.75, sw = PI * 1.5, ang = (v) => a0 + clamp(v / 3000, 0, 1) * sw;
  g.lineWidth = 4;
  for (const [f, t, c] of [[1900, 2600, '#3fb56b'], [2600, 3000, '#d63a3a']]) { g.strokeStyle = c; g.beginPath(); g.arc(0, 0, R - 5, ang(f), ang(t)); g.stroke(); }
  ticks(g, R, a0, sw, 0, 3000, 100, 500, { div: 100, font: 11 });
  g.fillStyle = 'rgba(255,255,255,.6)'; g.font = '700 9px system-ui'; g.textAlign = 'center'; g.fillText('RPM x100', 0, R * 0.36);
  g.fillStyle = AMB; g.font = '800 12px ui-monospace,monospace'; g.fillText(String(Math.round(rpm / 10) * 10), 0, R * 0.58);
  needle(g, ang(rpm), R - 14);
}
function hbar(g, x, y, w, label, f, low) {
  g.fillStyle = 'rgba(255,255,255,.75)'; g.font = '700 11px system-ui'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(label, x, y);
  g.fillStyle = '#1b1c1f'; g.fillRect(x, y + 10, w, 14); g.fillStyle = low ? '#d63a3a' : '#3fb56b'; g.fillRect(x + 1, y + 11, Math.max(0, (w - 2) * clamp(f, 0, 1)), 12);
  g.fillStyle = 'rgba(255,255,255,.55)'; g.font = '700 9px system-ui'; g.textAlign = 'left'; g.fillText('E', x, y + 34); g.textAlign = 'right'; g.fillText('F', x + w, y + 34);
}

// ======================================================================================
// the cockpit
// ======================================================================================
export function buildPlaneCockpit(T) {
  const G = new THREE.Group();
  G.name = 'cockpit';
  const [sx, sy, sz] = T.seat, [, yy, yz] = T.yoke, FLOOR = 0.9, PZ = 1.06; // PZ: instrument panel face
  const seatX = [sx, -0.29];
  const addTo = (p, o) => { p.add(o); return o; };

  // ---------- shell: floor, walls, headliner, bulkheads ----------
  box(G, 1.0, 0.03, 2.55, MAT.carpet, 0, FLOOR, -0.12);
  box(G, 0.02, 0.5, 2.5, MAT.trim, 0.575, 1.15, -0.15);          // left sill trim
  box(G, 0.02, 0.5, 2.5, MAT.trim, -0.575, 1.15, -0.15);         // right sill trim
  box(G, 0.03, 0.04, 2.5, MAT.trimDark, 0.565, 1.43, -0.15);     // window sill caps
  box(G, 0.03, 0.04, 2.5, MAT.trimDark, -0.565, 1.43, -0.15);
  box(G, 0.84, 0.02, 2.2, MAT.head, 0, 2.015, -0.2);             // headliner
  for (const s of [-1, 1]) { const m = box(G, 0.12, 0.02, 2.2, MAT.head, s * 0.44, 1.985, -0.2); m.rotation.z = s * 0.45; }
  box(G, 0.92, 0.9, 0.03, MAT.trim, 0, 1.45, -1.42);              // rear bulkhead
  box(G, 0.92, 0.04, 0.3, MAT.carpet, 0, 1.0, -1.28);             // baggage shelf
  box(G, 0.92, 0.06, 0.07, MAT.dash, 0, 1.99, 0.9);               // windshield header
  for (const s of [-1, 1]) box(G, 0.04, 0.53, 0.03, MAT.dash, s * 0.45, 1.85, 1.12).rotation.x = -0.97; // A-pillar covers
  for (const s of [-1, 1]) { const v = box(G, 0.26, 0.015, 0.13, MAT.trimDark, s * 0.28, 1.96, 0.8); v.rotation.x = 0.35; } // sun visors
  const comp = cyl(G, 0.035, 0.035, 0.03, MAT.black, 0, 1.94, 0.96, 'z'); comp.rotation.x = PI / 2 - 0.5;
  cyl(G, 0.026, 0.026, 0.005, MAT.white, 0, 1.935, 0.945, 'z').rotation.x = PI / 2 - 0.5;
  // seats (pilot left, co-pilot right) and rear bench
  const mkSeat = (x, z) => {
    const s = addTo(G, new THREE.Group()); s.position.set(x, 0, z);
    box(s, 0.34, sy - 0.1 - (FLOOR + 0.015), 0.34, MAT.steel, 0, (sy - 0.1 + FLOOR + 0.015) / 2, 0);
    box(s, 0.42, 0.1, 0.46, MAT.seat, 0, sy - 0.05, 0.03);
    box(s, 0.18, 0.012, 0.4, MAT.seatLite, 0, sy + 0.001, 0.03);
    const b = addTo(s, new THREE.Group()); b.position.set(0, sy, -0.24); b.rotation.x = -0.2;
    box(b, 0.42, 0.56, 0.09, MAT.seat, 0, 0.29, 0);
    box(b, 0.18, 0.5, 0.012, MAT.seatLite, 0, 0.29, 0.05);
    box(b, 0.2, 0.17, 0.06, MAT.seat, 0, 0.7, 0);
    for (const k of [-0.05, 0.05]) cyl(b, 0.008, 0.008, 0.1, MAT.chrome, k, 0.6, 0);
    for (const k of [-1, 1]) box(b, 0.03, 0.4, 0.1, MAT.seatLite, k * 0.2, 0.28, 0.02);
  };
  mkSeat(seatX[0], sz); mkSeat(seatX[1], sz);
  box(G, 0.94, 0.1, 0.46, MAT.seat, 0, sy - 0.05, -0.98);
  box(G, 0.94, 0.5, 0.09, MAT.seat, 0, 1.45, -1.27).rotation.x = -0.12;
  for (const k of [-0.24, 0.24]) box(G, 0.34, 0.4, 0.012, MAT.seatLite, k, 1.45, -1.22).rotation.x = -0.12;
  box(G, 0.94, 0.1, 0.34, MAT.steel, 0, 1.0, -0.98);

  // ---------- centre pedestal + lower dash ----------
  box(G, 0.15, 0.3, PZ - 0.1, MAT.dash, 0, 1.05, 0.55);
  box(G, 0.13, 0.015, PZ - 0.1, MAT.dashTop, 0, 1.208, 0.55);
  box(G, 1.14, 0.38, 0.03, MAT.dash, 0, 1.09, PZ + 0.03);                  // knee panel
  box(G, 1.14, 0.08, 0.04, MAT.dashTop, 0, 1.28, PZ + 0.0);                // lower lip under the instruments
  const face = mesh(G, new THREE.PlaneGeometry(1.12, 0.36), new THREE.MeshStandardMaterial({ map: panelTexture(), roughness: 0.85 }), 0, 1.46, PZ);
  face.rotation.y = PI;
  box(G, 1.14, 0.36, 0.3, MAT.dashTop, 0, 1.46, PZ + 0.18);               // dash body (behind the face)
  box(G, 1.14, 0.05, 0.3, MAT.dashTop, 0, 1.665, PZ + 0.18);               // glareshield (top <= 1.69, windshield sill is 1.70)
  box(G, 1.14, 0.02, 0.05, MAT.black, 0, 1.655, PZ - 0.02);                // glareshield lip
  // throttle / prop / mixture quadrant on the panel
  const knob = (x, y, mat, r = 0.019) => {
    const g = addTo(G, new THREE.Group()); g.position.set(x, y, PZ - 0.004);
    cyl(g, 0.006, 0.006, 0.12, MAT.chrome, 0, 0, -0.06, 'z');
    const k = addTo(g, new THREE.Group()); mesh(k, new THREE.SphereGeometry(r, 10, 8), mat, 0, 0, 0);
    return k;
  };
  const thrK = knob(0.045, 1.215, MAT.black), propK = knob(0, 1.215, MAT.blue), mixK = knob(-0.045, 1.215, MAT.red, 0.017);
  propK.position.z = mixK.position.z = -0.03;
  // gear lever (wheel-shaped knob), flap lever, trim wheel
  const gearL = addTo(G, new THREE.Group()); gearL.position.set(0.14, 1.225, PZ - 0.006);
  cyl(gearL, 0.008, 0.008, 0.075, MAT.chrome, 0, -0.036, 0); cyl(gearL, 0.022, 0.022, 0.012, MAT.black, 0, -0.08, 0, 'z');
  const flapL = addTo(G, new THREE.Group()); flapL.position.set(0.075, 1.21, 0.75);
  cyl(flapL, 0.009, 0.009, 0.12, MAT.chrome, 0, 0.06, 0); mesh(flapL, new THREE.SphereGeometry(0.02, 8, 6), MAT.red, 0, 0.125, 0);
  cyl(G, 0.05, 0.05, 0.02, MAT.black, 0, 1.2, 0.3, 'x');                  // trim wheel
  box(G, 0.04, 0.06, 0.1, MAT.chrome, 0.0, 1.14, 0.9);                     // fuel selector
  // ---------- lamps ----------
  const lampG = new THREE.MeshBasicMaterial({ color: 0x103018 }), lampS = new THREE.MeshBasicMaterial({ color: 0x3a0d0a });
  for (const v of [140, 185, 230]) { const l = mesh(G, new THREE.CircleGeometry(0.0085, 12), lampG, 0.56 - 539 / PX, 1.64 - v / PX, PZ - 0.003); l.rotation.y = PI; }
  { const l = mesh(G, new THREE.CircleGeometry(0.0085, 12), lampS, 0.56 - 539 / PX, 1.64 - 305 / PX, PZ - 0.003); l.rotation.y = PI; }

  // ---------- live gauges ----------
  const six = document.createElement('canvas'); six.width = 448; six.height = 333;
  const eng = document.createElement('canvas'); eng.width = 192; eng.height = 333;
  const sixT = mkTex(six), engT = mkTex(eng), sg = six.getContext('2d'), eg = eng.getContext('2d');
  for (const [t, w, x] of [[sixT, 448, 0.31], [engT, 192, 0.0]]) {
    const m = mesh(G, new THREE.PlaneGeometry(w / PX, 333 / PX), new THREE.MeshBasicMaterial({ map: t, transparent: true }), x, 1.4755, PZ - 0.002);
    m.rotation.y = PI; m.receiveShadow = false; m.renderOrder = 2;
  }
  let acc = 1, dirty = true;
  const drawGauges = (st) => {
    sg.clearRect(0, 0, 448, 333);
    const at = (cx, cy, fn) => { sg.save(); sg.translate(cx, cy); fn(); sg.restore(); };
    at(75, 75, () => gAsi(sg, 66, st.kmh)); at(224, 75, () => gAtt(sg, 66, st.pitch, st.roll)); at(373, 75, () => gAlt(sg, 66, st.alt));
    at(75, 258, () => gTurn(sg, 66, clamp(st.roll * 0.8, -0.55, 0.55), st.slip)); at(224, 258, () => gDg(sg, 66, st.hdg)); at(373, 258, () => gVsi(sg, 66, st.vsi));
    sixT.needsUpdate = true;
    eg.clearRect(0, 0, 192, 333);
    eg.save(); eg.translate(96, 75); gTach(eg, 66, st.rpm * 2400); eg.restore();
    hbar(eg, 20, 232, 152, 'FUEL', st.fuel, st.fuel < 0.15);
    hbar(eg, 20, 282, 152, 'THR', st.thr, false);
    engT.needsUpdate = true;
  };

  // ---------- yokes (both linked), pedals ----------
  const mkYoke = (x) => {
    const ctrl = addTo(G, new THREE.Group()); ctrl.position.set(x, yy, yz);
    const stick = addTo(ctrl, new THREE.Group());
    cyl(stick, 0.02, 0.02, 0.5, MAT.steel, 0, 0, 0.25, 'z');
    cyl(stick, 0.032, 0.032, 0.05, MAT.black, 0, 0, 0, 'z');
    cyl(stick, 0.013, 0.013, 0.3, MAT.black, 0, 0, 0, 'x');
    for (const k of [-1, 1]) {
      cyl(stick, 0.016, 0.016, 0.17, MAT.black, k * 0.15, 0.085, 0);
      cyl(stick, 0.021, 0.021, 0.1, MAT.black, k * 0.15, 0.09, 0);
      mesh(stick, new THREE.SphereGeometry(0.012, 8, 6), MAT.red, k * 0.15, 0.175, 0.012);
    }
    box(stick, 0.1, 0.045, 0.012, MAT.black, 0, 0.065, 0.005); // centre hub plate
    return { ctrl, stick };
  };
  const Y0 = mkYoke(sx), Y1 = mkYoke(seatX[1]);
  const mkPedals = (x) => [1, -1].map((side) => {          // side +1 = left pedal (+X)
    const p = addTo(G, new THREE.Group()); p.position.set(x + side * 0.1, FLOOR + 0.1, 0.95);
    const plate = box(p, 0.1, 0.12, 0.015, MAT.steel, 0, 0, 0); plate.rotation.x = -0.45;
    const toe = box(p, 0.1, 0.04, 0.018, MAT.black, 0, 0.055, -0.012); toe.rotation.x = -0.45;
    cyl(p, 0.008, 0.008, 0.1, MAT.chrome, 0, -0.06, 0.04, 'z');
    return p;
  });
  const PD0 = mkPedals(sx), PD1 = mkPedals(seatX[1]);

  // fill light (kept at 0 unless the player sits in it)
  const fill = new THREE.PointLight(0xfff1dc, 0, 4.5, 1.4);
  fill.position.set(0, 1.85, 0.3); G.add(fill);

  const grips = { l: { p: new V3(), q: new THREE.Quaternion() }, r: { p: new V3(), q: new THREE.Quaternion() } };
  const feet = { l: new V3(), r: new V3() };
  const zero = { pitch: 0, roll: 0, yaw: 0 };

  return {
    group: G, ctrl: Y0.ctrl, stick: Y0.stick, fill, grips, feet,
    /** st: { in:{pitch,roll,yaw}, thr, gear, flaps(0..3), stall, brake, kmh, pitch, roll, hdg, alt, vsi, rpm, fuel, slip, draw, dt, time } */
    update(st) {
      const iN = st.in || zero;
      for (const Y of [Y0, Y1]) { Y.stick.rotation.z = -iN.roll * 0.9; Y.stick.position.z = iN.pitch * -0.12; }
      Y0.stick.updateMatrix();
      for (const [i, k] of [[0, 1], [1, -1]]) {
        const gr = i ? grips.r : grips.l;
        gr.p.set(k * 0.15, 0.09, 0).applyMatrix4(Y0.stick.matrix).add(Y0.ctrl.position);
        gr.q.copy(Y0.stick.quaternion);
      }
      const yaw = iN.yaw, brk = st.brake ? 0.18 : 0;
      for (const pd of [PD0, PD1]) {
        pd[0].position.z = 0.95 - yaw * 0.04; pd[1].position.z = 0.95 + yaw * 0.04; // right yaw pushes the right (-X) pedal forward
        pd[0].rotation.x = brk; pd[1].rotation.x = brk;
      }
      feet.l.set(sx + 0.1, FLOOR + 0.14, PD0[0].position.z - 0.08);
      feet.r.set(sx - 0.1, FLOOR + 0.14, PD0[1].position.z - 0.08);
      thrK.position.z = -(0.03 + (1 - st.thr) * 0.075);
      gearL.rotation.x = (st.gear - 0.5) * -1.0;
      flapL.rotation.x = -0.2 + st.flaps * 0.3;
      lampG.color.setHex(st.gear > 0.95 ? 0x39ff6a : st.gear < 0.05 ? 0x103018 : 0xffb020);
      lampS.color.setHex(st.stall > 0.25 && Math.floor(st.time * 6) % 2 === 0 ? 0xff2a1a : 0x3a0d0a);
      if (st.draw) { acc += st.dt; if (acc >= 0.066 || dirty) { acc = 0; dirty = false; drawGauges(st); } } else dirty = true;
    },
    dispose() { sixT.dispose(); engT.dispose(); },
  };
}
