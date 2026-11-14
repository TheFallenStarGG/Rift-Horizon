/**
 * The hot-drop transport model, shared by the trailer (lib/trailer.js).
 * The CABIN (floor, walls, ribs, seats, cargo, jump light, ramp) is the same as the one in lib/dropship.js, which keeps its own copy because the body is never seen in play.
 * The EXTERIOR is rebuilt here: lofted fuselage + nose with a cockpit canopy, a hooded ramp bay, an upswept tail cone,
 * a swept fin whose root is buried inside the tail cone (so it is really attached), a tailplane, tapered wings and turboprop nacelles.
 * Cabin: z -4.6 .. 4.4, floor y = 0, nose = -Z, rear ramp hinged at z = 4.4 (rotation.x -PI/2 closed, RAMP_OPEN when lowered).
 * API is unchanged: buildPlane(accent) -> { group, ramp, lampRed, lampGreen, glowR, glowG, props, M, dispose }.
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

// ---------- exterior geometry helpers ----------
const NR = 32; // points round one fuselage ring
/**
 * A fuselage ring is the cabin's own outline: a top half-ellipse (rx, ryT) round y = yT, straight sides, a bottom half-ellipse (rx, ryB) round y = yB.
 * Lofting rings of different sizes gives the nose and the tail cone, and they meet the cabin shell without a seam.
 */
function ringPt(s, i, top) {
  const h = NR / 2;
  if (top) { const a = (i / h) * PI; return [s.rx * Math.cos(a), s.yT + s.ryT * Math.sin(a)]; }
  const a = PI + ((i - h) / h) * PI;
  return [s.rx * Math.cos(a), s.yB + s.ryB * Math.sin(a)];
}
/** a skin through a list of rings. open = top half only (the hood over the ramp bay) */
function loftGeo(secs, open) {
  const h = NR / 2, per = open ? h + 1 : NR, cols = open ? per : per + 1, pos = [], uv = [], idx = [];
  for (const s of secs) {
    for (let c = 0; c < cols; c++) {
      const i = c % per, p = ringPt(s, i, open || i < h);
      pos.push(p[0], p[1], s.z); uv.push(c / (cols - 1), s.z * 0.12);
    }
  }
  for (let k = 0; k < secs.length - 1; k++) {
    for (let c = 0; c < cols - 1; c++) {
      const a = k * cols + c, b = a + 1, d = a + cols, e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  if (!open) { // the ring seam is two columns of vertices: give both the same normal so the shading has no line
    const n = g.attributes.normal, v = new THREE.Vector3();
    for (let k = 0; k < secs.length; k++) {
      const a = k * cols, b = a + per;
      v.set(n.getX(a) + n.getX(b), n.getY(a) + n.getY(b), n.getZ(a) + n.getZ(b)).normalize();
      n.setXYZ(a, v.x, v.y, v.z); n.setXYZ(b, v.x, v.y, v.z);
    }
  }
  return g;
}
/** the flat side wall of the ramp bay: from the hood's lower edge down to the bay floor */
function wallGeo(secs, side, yFloor) {
  const pos = [], uv = [], idx = [];
  for (const s of secs) { pos.push(side * s.rx, s.yT, s.z, side * s.rx, yFloor, s.z); uv.push(s.z * 0.12, 0, s.z * 0.12, 0.6); }
  for (let k = 0; k < secs.length - 1; k++) { const a = k * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
/** a flat cap that fills one ring (the bulkhead above the ramp gate) */
function capGeo(s) {
  const pos = [0, (s.yT + s.yB) / 2, s.z], uv = [0.5, 0.5], idx = [];
  for (let i = 0; i < NR; i++) { const p = ringPt(s, i, i < NR / 2); pos.push(p[0], p[1], s.z); uv.push(0.5 + p[0] * 0.3, 0.5 + p[1] * 0.3); }
  for (let i = 0; i < NR; i++) idx.push(0, 1 + i, 1 + ((i + 1) % NR));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}
/** a flat polygon (list of [x, y]) extruded to a thin plate, centred on its mid-plane */
function polyGeo(pts, depth, bev) {
  const sh = new THREE.Shape(pts.map((p) => new THREE.Vector2(p[0], p[1])));
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: bev > 0, bevelThickness: bev, bevelSize: bev, bevelSegments: 1, steps: 1 });
  g.translate(0, 0, -depth / 2);
  return g;
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
  const wingT = mk(canvasTex(256, 256, panel('#5a6455', 'rgba(0,0,0,.4)'), 0.35, 0.35)); // wings + fin: UVs are in metres, so a low repeat gives ~3 m panels
  const innerT = mk(canvasTex(256, 256, panel('#737c6c', 'rgba(0,0,0,.3)'), 3, 4));
  const glowTex = mk(canvasTex(64, 64, (c) => { const r = c.createRadialGradient(32, 32, 0, 32, 32, 32); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = r; c.fillRect(0, 0, 64, 64); }));
  const S = (o) => new THREE.MeshStandardMaterial(o);
  const M = {
    plate: S({ map: plate, roughness: 0.65, metalness: 0.35 }), ramp: S({ map: ramp, roughness: 0.65, metalness: 0.35, side: THREE.DoubleSide }),
    hull: S({ map: hullT, roughness: 0.7, metalness: 0.25 }), hullD: S({ map: hullT, roughness: 0.7, metalness: 0.25, side: THREE.DoubleSide }),
    wing: S({ map: wingT, roughness: 0.7, metalness: 0.25, side: THREE.DoubleSide }),
    inner: S({ map: innerT, roughness: 0.85, metalness: 0.1 }), innerD: S({ map: innerT, roughness: 0.85, metalness: 0.1, side: THREE.DoubleSide }),
    dark: S({ color: 0x24282c, roughness: 0.8, metalness: 0.4 }), seat: S({ color: 0x39432f, roughness: 0.95 }),
    strap: S({ color: accent, roughness: 0.7 }), accent: S({ color: accent, roughness: 0.6, side: THREE.DoubleSide }),
    yellow: S({ color: 0xe9b520, roughness: 0.6 }), steel: S({ color: 0x9aa1a8, roughness: 0.35, metalness: 0.8 }),
    crate: S({ color: 0x5a4a30, roughness: 0.9 }),
    canopy: S({ color: 0x15232e, roughness: 0.08, metalness: 0.6 }),
    glass: new THREE.MeshStandardMaterial({ color: 0xaad4ff, transparent: true, opacity: 0.14, roughness: 0.05, side: THREE.DoubleSide, depthWrite: false }),
    light: new THREE.MeshBasicMaterial({ color: 0xfff1d6 }), lampR: new THREE.MeshBasicMaterial({ color: 0x400a08 }), lampG: new THREE.MeshBasicMaterial({ color: 0x0a3010 }),
    beacon: new THREE.MeshBasicMaterial({ color: 0xff3a2a }), navR: new THREE.MeshBasicMaterial({ color: 0xff2a1a }), navG: new THREE.MeshBasicMaterial({ color: 0x30ff60 }), navW: new THREE.MeshBasicMaterial({ color: 0xffffff }),
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

  // ===================== CABIN (unchanged) =====================
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
  // front bulkhead (now cut to the arch's outline so its corners no longer poke out of the hull), cockpit door, cargo
  const bk = new THREE.Shape();
  bk.moveTo(-1.45, 0); bk.lineTo(1.45, 0); bk.lineTo(1.45, 1.9); bk.absellipse(0, 1.9, 1.45, 0.98, 0, PI, false); bk.lineTo(-1.45, 0);
  const bkG = new THREE.ExtrudeGeometry(bk, { depth: 0.12, bevelEnabled: false });
  const bkUV = bkG.attributes.uv; // keep the panel texture the same size it had on the old box
  for (let i = 0; i < bkUV.count; i++) bkUV.setXY(i, (bkUV.getX(i) + 1.45) / 2.9, bkUV.getY(i) / 2.9);
  add(bkG, M.inner, 0, 0, Z0 - 0.12);
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

  // ===================== EXTERIOR (rebuilt) =====================
  const sec = (z, rx, yT, ryT, yB, ryB) => ({ z, rx, yT, ryT, yB, ryB });
  // nose: from the cabin's own outline at the front bulkhead down to a rounded tip
  const NOSE = [sec(-4.6, 1.46, 1.9, 0.99, 0, 0.61), sec(-5.3, 1.4, 1.95, 0.95, 0.05, 0.58), sec(-6.0, 1.15, 1.7, 0.78, 0.25, 0.5), sec(-6.7, 0.78, 1.35, 0.55, 0.5, 0.4), sec(-7.2, 0.4, 1.1, 0.3, 0.7, 0.28), sec(-7.45, 0.12, 0.95, 0.12, 0.85, 0.12)];
  // hood over the ramp bay (top half only, the bay stays open underneath) and the closed tail cone that carries on from it, rising towards the tail
  const HOOD = [sec(4.4, 1.46, 1.9, 0.99, 0, 0), sec(5.5, 1.44, 2.1, 0.92, 0, 0), sec(6.6, 1.4, 2.32, 0.86, 0, 0), sec(7.6, 1.36, 2.55, 0.82, 0, 0)];
  const TAIL = [sec(7.6, 1.36, 2.55, 0.82, 2.45, 0.8), sec(8.6, 1.1, 2.95, 0.72, 2.85, 0.7), sec(9.8, 0.8, 3.45, 0.6, 3.35, 0.55), sec(11.0, 0.52, 3.85, 0.45, 3.8, 0.4), sec(11.9, 0.3, 4.0, 0.26, 3.95, 0.24), sec(12.35, 0.06, 4.05, 0.06, 4.0, 0.06)];
  add(loftGeo(NOSE, false), M.hullD, 0, 0, 0);
  add(loftGeo(HOOD, true), M.hullD, 0, 0, 0);
  add(loftGeo(TAIL, false), M.hullD, 0, 0, 0);
  for (const s of [-1, 1]) add(wallGeo(HOOD, s, -0.72), M.hullD, 0, 0, 0); // bay side walls
  add(capGeo(TAIL[0]), M.innerD, 0, 0, 0);                                  // bulkhead above the ramp gate, so the tail is not a hollow tube
  box(2.9, 0.06, 3.35, M.dark, 0, -0.75, 6.05);                             // bay floor (lies below the lowered ramp)

  // outer skin on the cabin walls (the window band stays open), window trim and a livery stripe
  for (const s of [-1, 1]) {
    box(0.03, 1.0, L, M.hull, s * 1.475, 0.5, ZC); box(0.03, 0.32, L, M.hull, s * 1.475, 1.74, ZC);
    box(0.05, 0.035, L, M.dark, s * 1.48, 1.0, ZC); box(0.05, 0.035, L, M.dark, s * 1.48, 1.58, ZC);
    box(0.02, 0.08, L - 0.3, M.accent, s * 1.5, 0.92, ZC);
    // belly sponson: a half-ellipsoid hugging the lower wall (open side against the cabin, so nothing intrudes into the interior), blends the wing root into the hull
    const sp = add(new THREE.SphereGeometry(1, 18, 12, PI / 2, PI), M.hullD, s * 1.43, 0.3, 0.4);
    sp.scale.set(s * 0.5, 0.52, 2.5);
  }
  // cockpit canopy on the sloping nose, nose sensor, belly turret, pitot tube
  const canopy = add(new THREE.SphereGeometry(1, 20, 12, 0, PI * 2, 0, PI / 2), M.canopy, 0, 2.2, -5.6);
  canopy.scale.set(0.78, 0.8, 1.0);
  add(new THREE.SphereGeometry(0.16, 10, 8), M.dark, 0, 0.9, -7.45);
  add(new THREE.CylinderGeometry(0.015, 0.015, 0.9, 6), M.steel, 0, 0.9, -7.7, g, PI / 2);
  add(new THREE.SphereGeometry(0.22, 12, 8), M.dark, 0, -0.5, -5.5);
  // dorsal beacon + antenna
  add(new THREE.SphereGeometry(0.08, 8, 6), M.beacon, 0, 2.93, -2.4);
  box(0.04, 0.4, 0.55, M.dark, 0, 3.05, 1.2);

  // wings: swept, tapered, a little dihedral, accent tips, nav lights
  const wingG = polyGeo([[1.2, -1.5], [10.0, 0.25], [10.0, 1.55], [1.2, 2.2]], 0.24, 0.04); wingG.rotateX(PI / 2);
  const tipG = polyGeo([[8.4, -0.068], [10.0, 0.25], [10.0, 1.55], [8.4, 1.668]], 0.26, 0.05); tipG.rotateX(PI / 2);
  for (const s of [-1, 1]) {
    const wg = new THREE.Group();
    wg.position.set(0, 0.55, 0); wg.rotation.z = s * 0.035; g.add(wg);
    const w = new THREE.Mesh(wingG, M.wing); w.scale.x = s; wg.add(w);
    const t = new THREE.Mesh(tipG, M.accent); t.scale.x = s; wg.add(t);
    box(2.4, 0.01, 0.045, M.dark, s * 3.5, 0.165, 1.55, wg); box(1.8, 0.01, 0.045, M.dark, s * 7.1, 0.165, 1.28, wg); // flap lines
    add(new THREE.SphereGeometry(0.07, 8, 6), s < 0 ? M.navR : M.navG, s * 10.05, 0, 0.9, wg);
    const nl = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: s < 0 ? 0xff3020 : 0x30ff60, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
    nl.scale.setScalar(0.8); nl.position.set(s * 10.05, 0, 0.9); wg.add(nl);
  }

  // tail: swept fin (root buried in the tail cone), accent cap, tailplane, nav + beacon lights
  const finG = polyGeo([[9.0, 3.5], [11.4, 7.4], [12.3, 7.4], [12.05, 3.95]], 0.16, 0.03); finG.rotateY(-PI / 2);
  add(finG, M.wing, 0, 0, 0);
  const finCap = polyGeo([[11.154, 7.0], [11.4, 7.4], [12.3, 7.4], [12.3, 7.0]], 0.18, 0.035); finCap.rotateY(-PI / 2);
  add(finCap, M.accent, 0, 0, 0);
  add(new THREE.SphereGeometry(0.07, 8, 6), M.beacon, 0, 7.45, 11.9);
  add(new THREE.SphereGeometry(0.07, 8, 6), M.navW, 0, 4.05, 12.4);
  const stabG = polyGeo([[0.2, 9.9], [3.5, 11.55], [3.5, 12.2], [0.2, 12.2]], 0.1, 0.02); stabG.rotateX(PI / 2);
  for (const s of [-1, 1]) { const m = new THREE.Mesh(stabG, M.wing); m.position.set(0, 3.9, 0); m.scale.x = s; g.add(m); }

  // turboprop nacelles + four-blade propellers (the prop groups spin about their own z axis, trailer.js drives that)
  const props = [];
  const bladeG = polyGeo([[-0.09, 0.14], [0.09, 0.14], [0.05, 0.97], [-0.05, 0.97]], 0.03, 0);
  for (const s of [-1, 1]) {
    const ex = s * 4.4, ey = 0.78;
    add(new THREE.CylinderGeometry(0.46, 0.5, 3.4, 20), M.hull, ex, ey, -0.2, g, PI / 2);                          // nacelle
    add(new THREE.TorusGeometry(0.5, 0.045, 8, 22), M.steel, ex, ey, -1.9);                                         // intake lip
    add(new THREE.ConeGeometry(0.26, 0.62, 14), M.steel, ex, ey, -2.2, g, -PI / 2);                                 // spinner
    box(0.5, 0.2, 0.9, M.hull, ex, ey + 0.52, -1.1);                                                                // intake scoop
    add(new THREE.CylinderGeometry(0.3, 0.38, 0.3, 14, 1, true), M.dark, ex, ey, 1.55, g, PI / 2);                  // exhaust
    add(new THREE.CylinderGeometry(0.505, 0.505, 0.2, 20, 1, true), M.accent, ex, ey, -1.15, g, PI / 2);            // accent band
    const p = new THREE.Group();
    p.position.set(ex, ey, -2.3);
    g.add(p);
    for (let b = 0; b < 4; b++) {
      const bp = new THREE.Group(); bp.rotation.z = (b * PI) / 2; p.add(bp);
      const bl = new THREE.Mesh(bladeG, M.dark); bl.rotation.y = 0.35; bp.add(bl); // pitched blade
    }
    add(new THREE.CircleGeometry(0.98, 24), M.blur, 0, 0, 0, p);
    props.push(p);
  }
  return {
    group: g, ramp: rampG, lampRed, lampGreen, glowR, glowG, props, M,
    dispose() { disposeTree(g); for (const t of texs) t.dispose(); },
  };
}
