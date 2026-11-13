/**
 * The hot-drop transport model, shared by the trailer (lib/trailer.js).
 * This is a verbatim copy of buildPlane() from lib/dropship.js so the trailer shows the exact in-game plane, inside and out.
 * Cabin: z -4.6 .. 4.4, floor y = 0, nose = -Z, rear ramp hinged at z = 4.4 (rotation.x -PI/2 closed, RAMP_OPEN when lowered).
 */
import * as THREE from 'three';

const PI = Math.PI;
const rnd = (a, b) => a + Math.random() * (b - a);
export const RAMP_OPEN = 0.17, RAMP_Z = 4.4;

function canvasTex(w, h, draw, rx = 1, ry = 1) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  t.repeat.set(rx, ry);
  return t;
}
function disposeTree(o) {
  o.traverse((n) => {
    if (n.geometry) n.geometry.dispose();
    const m = n.material;
    if (m) for (const mm of Array.isArray(m) ? m : [m]) { if (mm.map) mm.map.dispose(); mm.dispose(); }
  });
}

export function buildPlane(accent) {
  const g = new THREE.Group();
  const texs = [];
  const mk = (t) => { texs.push(t); return t; };
  const plate = mk(canvasTex(128, 128, (c, w, h) => {
    c.fillStyle = '#464b51'; c.fillRect(0, 0, w, h); c.fillStyle = '#626970';
    for (let y = 0; y < h; y += 16) for (let x = 0; x < w; x += 16) {
      const o = (y / 16) % 2 ? 8 : 0;
      c.save(); c.translate(x + o + 4, y + 4); c.rotate(PI / 4); c.fillRect(-4, -1.2, 8, 2.4); c.restore();
      c.save(); c.translate(x + o + 12, y + 12); c.rotate(-PI / 4); c.fillRect(-4, -1.2, 8, 2.4); c.restore();
    }
  }, 3, 9));
  const ramp = mk(canvasTex(128, 128, (c, w, h) => { c.fillStyle = '#464b51'; c.fillRect(0, 0, w, h); c.fillStyle = '#626970'; for (let y = 0; y < h; y += 16) for (let x = 0; x < w; x += 16) c.fillRect(x + ((y / 16) % 2 ? 8 : 0), y + 6, 8, 3); }, 3, 3));
  const panel = (base, line) => (c, w, h) => {
    c.fillStyle = base; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 500; i++) { c.fillStyle = `rgba(${Math.random() < 0.5 ? '255,255,255' : '0,0,0'},${Math.random() * 0.05})`; c.fillRect(Math.random() * w, Math.random() * h, rnd(2, 14), rnd(1, 4)); }
    c.strokeStyle = line; c.lineWidth = 2; c.strokeRect(1, 1, w - 2, h - 2); c.beginPath(); c.moveTo(0, h / 2); c.lineTo(w, h / 2); c.stroke();
    c.fillStyle = 'rgba(0,0,0,.35)'; for (let x = 8; x < w; x += 24) { c.beginPath(); c.arc(x, 6, 1.6, 0, 7); c.arc(x, h - 6, 1.6, 0, 7); c.fill(); }
  };
  const hullT = mk(canvasTex(256, 256, panel('#5a6455', 'rgba(0,0,0,.4)'), 4, 3));
  const innerT = mk(canvasTex(256, 256, panel('#737c6c', 'rgba(0,0,0,.3)'), 3, 4));
  const glowTex = mk(canvasTex(64, 64, (c) => { const r = c.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = r; c.fillRect(0, 0, 64, 64); }));
  const S = (o) => new THREE.MeshStandardMaterial(o);
  const M = {
    plate: S({ map: plate, roughness: 0.65, metalness: 0.35 }), ramp: S({ map: ramp, roughness: 0.65, metalness: 0.35, side: THREE.DoubleSide }),
    hull: S({ map: hullT, roughness: 0.7, metalness: 0.25 }), hullD: S({ map: hullT, roughness: 0.7, metalness: 0.25, side: THREE.DoubleSide }),
    inner: S({ map: innerT, roughness: 0.85, metalness: 0.1 }), innerD: S({ map: innerT, roughness: 0.85, metalness: 0.1, side: THREE.DoubleSide }),
    dark: S({ color: 0x24282c, roughness: 0.8, metalness: 0.4 }), seat: S({ color: 0x39432f, roughness: 0.95 }),
    strap: S({ color: accent, roughness: 0.7 }), yellow: S({ color: 0xe9b520, roughness: 0.6 }), steel: S({ color: 0x9aa1a8, roughness: 0.35, metalness: 0.8 }),
    crate: S({ color: 0x5a4a30, roughness: 0.9 }),
    glass: new THREE.MeshStandardMaterial({ color: 0xaad4ff, transparent: true, opacity: 0.14, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false }),
    light: new THREE.MeshBasicMaterial({ color: 0xfff1d6 }), lampR: new THREE.MeshBasicMaterial({ color: 0x400a08 }), lampG: new THREE.MeshBasicMaterial({ color: 0x0a3010 }),
    blur: new THREE.MeshBasicMaterial({ color: 0xcfd3d6, transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }),
  };
  const add = (geo, mat, x, y, z, parent = g, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
    m.castShadow = m.receiveShadow = false;
    parent.add(m);
    return m;
  };
  const box = (w, h, d, mat, x, y, z, parent, rx, ry, rz) => add(new THREE.BoxGeometry(w, h, d), mat, x, y, z, parent, rx, ry, rz);

  const Z0 = -4.6, L = 9.0, ZC = Z0 + L / 2; // cabin: z -4.6 .. 4.4, floor y = 0, forward = -Z
  box(2.9, 0.14, L, M.plate, 0, -0.07, ZC);
  for (const s of [-1, 1]) {
    box(0.12, 1.0, L, M.inner, s * 1.4, 0.5, ZC);
    box(0.12, 0.32, L, M.inner, s * 1.4, 1.74, ZC);
    box(0.5, 0.08, L, M.dark, s * 1.15, 0.04, ZC); // floor rail
  }
  const arch = add(new THREE.CylinderGeometry(1.46, 1.46, L, 32, 1, true, PI / 2, PI), M.hullD, 0, 1.9, ZC, g, PI / 2);
  arch.scale.set(1, 1, 0.68);
  const belly = add(new THREE.CylinderGeometry(1.46, 1.46, L, 24, 1, true, -PI / 2, PI), M.hullD, 0, 0, ZC, g, PI / 2);
  belly.scale.set(1, 1, 0.42);
  const ribGeo = new THREE.TorusGeometry(1.4, 0.035, 6, 24, PI);
  for (let i = 0; i < 9; i++) {
    const z = Z0 + 0.1 + i * 1.1;
    const rib = add(ribGeo, M.dark, 0, 1.9, z); rib.scale.y = 0.68;
    for (const s of [-1, 1]) {
      box(0.1, 1.9, 0.14, M.dark, s * 1.31, 0.95, z);
      box(0.14, 0.64, 0.26, M.inner, s * 1.4, 1.3, z);
      if (i < 8) {
        const gl = add(new THREE.PlaneGeometry(0.8, 0.6), M.glass, s * 1.43, 1.3, z + 0.55, g, 0, PI / 2);
        void gl;
        box(0.1, 0.03, 0.9, M.light, s * 0.62, 2.72, z + 0.55);
      }
    }
  }
  for (const s of [-1, 1]) {
    add(new THREE.CylinderGeometry(0.04, 0.04, L, 8), M.steel, s * 0.9, 2.5, ZC, g, PI / 2);
    // fold-down web seats + straps
    box(0.42, 0.05, 6.0, M.seat, s * 1.12, 0.48, -1.4);
    box(0.05, 0.55, 6.0, M.seat, s * 1.3, 0.82, -1.4);
    for (let i = 0; i < 6; i++) box(0.03, 0.62, 0.12, M.strap, s * 1.27, 0.84, -4.2 + i * 1.0);
    for (let i = 0; i < 4; i++) box(0.05, 0.46, 0.05, M.dark, s * 0.95, 0.24, -4.0 + i * 1.7);
  }
  add(new THREE.CylinderGeometry(0.02, 0.02, L, 6), new THREE.MeshStandardMaterial({ color: 0xc0392b }), -0.45, 2.7, ZC, g, PI / 2); // static line
  // front bulkhead, cockpit door, cargo
  box(2.9, 2.9, 0.12, M.inner, 0, 1.45, Z0 - 0.06);
  box(0.9, 1.9, 0.06, M.dark, 0.7, 0.95, Z0 + 0.02);
  box(0.4, 0.4, 0.04, M.glass, 0.7, 1.45, Z0 + 0.06);
  box(0.9, 0.7, 0.9, M.crate, -0.3, 0.35, -3.95); box(0.9, 0.7, 0.9, M.crate, -0.3, 1.05, -3.95, g, 0, 0.15, 0);
  box(0.8, 0.6, 0.8, M.crate, 0.55, 0.3, -3.1); box(0.9, 0.05, 0.12, M.strap, -0.3, 1.42, -3.95);
  box(2.6, 0.012, 0.14, M.yellow, 0, 0.007, 3.5);
  // jump light
  box(0.8, 0.26, 0.1, M.dark, 0, 2.6, 4.1);
  const lampRed = add(new THREE.CylinderGeometry(0.09, 0.09, 0.04, 16), M.lampR, -0.2, 2.6, 4.03, g, PI / 2);
  const lampGreen = add(new THREE.CylinderGeometry(0.09, 0.09, 0.04, 16), M.lampG, 0.2, 2.6, 4.03, g, PI / 2);
  const glow = (c) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false })); s.scale.setScalar(0.7); g.add(s); return s; };
  const glowR = glow(0xff3020), glowG = glow(0x30ff60);
  glowR.position.set(-0.2, 2.6, 3.96); glowG.position.set(0.2, 2.6, 3.96);
  // rear ramp (hinged at the floor edge)
  const rampG = new THREE.Group();
  rampG.position.set(0, 0, RAMP_Z);
  g.add(rampG);
  box(2.6, 0.12, 2.9, M.ramp, 0, -0.06, 1.45, rampG);
  for (const s of [-1, 1]) box(0.1, 0.2, 2.9, M.dark, s * 1.3, 0.03, 1.45, rampG);
  box(2.4, 0.012, 0.2, M.yellow, 0, 0.007, 2.7, rampG);
  rampG.rotation.x = -PI / 2;
  // exterior: nose, tail, wings, engines
  add(new THREE.CylinderGeometry(0.4, 1.46, 3.4, 20), M.hull, 0, 1.2, Z0 - 1.7, g, -PI / 2).scale.set(1, 1, 0.9);
  add(new THREE.SphereGeometry(0.55, 14, 10, 0, PI * 2, 0, PI / 2), M.glass, 0, 1.75, Z0 - 2.9, g, -0.7);
  box(1.0, 1.2, 7.0, M.hull, 0, 3.55, 8.0); box(0.14, 3.2, 2.2, M.hull, 0, 5.3, 10.8, g, -0.15); box(5.0, 0.12, 1.5, M.hull, 0, 4.3, 11.0);
  const props = [];
  for (const s of [-1, 1]) {
    box(8.6, 0.22, 3.0, M.hull, s * 5.7, 0.5, 0.2, g, 0, 0, s * -0.04);
    add(new THREE.CylinderGeometry(0.44, 0.48, 2.6, 14), M.hull, s * 4.3, 0.85, -0.6, g, PI / 2);
    add(new THREE.ConeGeometry(0.2, 0.5, 12), M.steel, s * 4.3, 0.85, -2.15, g, -PI / 2);
    const p = new THREE.Group();
    p.position.set(s * 4.3, 0.85, -2.45);
    g.add(p);
    box(0.16, 1.9, 0.03, M.dark, 0, 0, 0, p); box(0.16, 1.9, 0.03, M.dark, 0, 0, 0, p, 0, 0, PI / 2); box(0.16, 1.9, 0.03, M.dark, 0, 0, 0, p, 0, 0, PI / 4);
    add(new THREE.CircleGeometry(0.98, 24), M.blur, 0, 0, 0, p);
    props.push(p);
  }
  return {
    group: g, ramp: rampG, lampRed, lampGreen, glowR, glowG, props, M,
    dispose() { disposeTree(g); for (const t of texs) t.dispose(); },
  };
}
