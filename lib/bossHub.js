/**
 * BOSS HUB — one gate in the lobby leads to a small hall that holds the three boss gates.
 *
 *   LOBBY    a single "BOSS HALL" gate on the north wall (lobby-local x = GATE_X, east of the dev portal slot).
 *   HALL     a closed room 140 m east of the lobby at the same height: the Riftwarden, Orrery and Dev gates side by side,
 *            an exit pad that returns you to the lobby, and a "???" plate over every gate that is still sealed
 *            (grey swirl, no name, no prompt with the name).
 *
 * The hall belongs to the lobby state (where === 'lobby'), so game.js only has to call update() / setVisible() / maskPrompt().
 *
 * The boss gates themselves are still built by createBossPortal / createOrreryPortal / createDevPortal. Those derive their
 * position from LOBBY (+ a fixed x offset on the north wall), so placePortal() nudges LOBBY for the duration of the call and
 * restores it. Pass the same dx the boss file uses (boss.js: 46, boss2.js PORTAL_DX: 36.5, boss3.js PORTAL_DX: 27).
 */
import * as THREE from 'three';
import { addCollider } from './collision.js';
import { LOBBY } from './lobby.js';

const PI = Math.PI;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rgb = (n) => `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
const HOLD = 1.15;

/** lobby-local x of the single lobby gate (lobby portals: -24 -8 8 24, dev portal: 40). Clear of the crates at x ~51. */
export const GATE_X = 47.5;
/** the hall. East of the lobby: the lobby's "north of the portals" portal check and the classified triggers never reach it. */
export const HUB = { x: LOBBY.x + 140, y: LOBBY.y, z: LOBBY.z, w: 44, d: 26, h: 14 };
/** hall-local x of each boss gate on the hall's north wall */
export const HUB_SLOT = { rw: -12, or: 0, dv: 12 };
const GATE_COL = { rw: 0xff3d6e, or: 0x6fe3ff, dv: 0xff4fd8 };
const LOCK_COL = 0x4a505c;

const gateAt = (id) => ({ x: HUB.x + HUB_SLOT[id], z: HUB.z - HUB.d / 2 + 1.9 });
const HUB_SPAWN = { x: HUB.x, y: HUB.y, z: HUB.z + 4, yaw: 0 };
const EXIT = { x: HUB.x, z: HUB.z + HUB.d / 2 - 3 };

/** Build a boss gate (make = () => createXPortal(...)) so that it stands in its hall slot instead of on the lobby wall. */
export function placePortal(id, dx, make) {
  if (!(id in HUB_SLOT)) return make();
  const g = gateAt(id), keep = { x: LOBBY.x, y: LOBBY.y, z: LOBBY.z };
  LOBBY.x = g.x - dx; LOBBY.y = HUB.y; LOBBY.z = g.z + LOBBY.d / 2 - 2.4; // => px = g.x, pz = g.z, y0 = HUB.y inside the factory
  try { return make(); } finally { LOBBY.x = keep.x; LOBBY.y = keep.y; LOBBY.z = keep.z; }
}

function cv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function tex(c) { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; }
function swirlTex(color) {
  const S = 256, [c, x] = cv(S, S), col = rgb(color);
  x.translate(S / 2, S / 2);
  const g = x.createRadialGradient(0, 0, 8, 0, 0, S / 2);
  g.addColorStop(0, `rgba(${col},0.08)`); g.addColorStop(0.55, `rgba(${col},0.4)`); g.addColorStop(1, `rgba(${col},0.85)`);
  x.fillStyle = g; x.beginPath(); x.arc(0, 0, S / 2, 0, PI * 2); x.fill(); x.lineCap = 'round';
  for (const [style, lw] of [[`rgba(${col},0.9)`, 11], ['rgba(255,255,255,0.45)', 4]]) {
    x.strokeStyle = style; x.lineWidth = lw;
    for (let k = 0; k < 6; k++) {
      x.beginPath();
      for (let i = 0; i <= 48; i++) {
        const t = i / 48, r = t * (S / 2 - 8), a = (k / 6) * PI * 2 + t * 3.8;
        if (i) x.lineTo(Math.cos(a) * r, Math.sin(a) * r); else x.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      x.stroke();
    }
  }
  x.strokeStyle = `rgba(${col},0.95)`; x.lineWidth = 6; x.beginPath(); x.arc(0, 0, S / 2 - 5, 0, PI * 2); x.stroke();
  return tex(c);
}
/** 512 x ~99 sign plate in the same style as the portal signs */
function plateTex(title, sub, color, w = 512, h = 99) {
  const [c, x] = cv(w, h), css = '#' + color.toString(16).padStart(6, '0');
  const gr = x.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(10,14,22,.97)'); gr.addColorStop(1, 'rgba(6,10,16,1)');
  x.fillStyle = gr; x.fillRect(0, 0, w, h); x.strokeStyle = css; x.lineWidth = 6; x.strokeRect(6, 6, w - 12, h - 12);
  x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#fff';
  x.font = `800 ${sub ? h * 0.4 : h * 0.5}px system-ui,sans-serif`; x.fillText(title, w / 2, sub ? h * 0.4 : h * 0.52);
  if (sub) { x.fillStyle = css; x.font = `600 ${h * 0.18}px system-ui,sans-serif`; x.fillText(sub, w / 2, h * 0.76); }
  return tex(c);
}

/**
 * @param scene   the game scene
 * @param opts.unlocked  { or: () => bool, dv: () => bool }  (rw is always open; a missing entry counts as open)
 */
export function createBossHub(scene, { unlocked = {} } = {}) {
  const H = HUB;
  const group = new THREE.Group(); scene.add(group);
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const basic = (o) => new THREE.MeshBasicMaterial({ toneMapped: false, ...o });
  const put = (geo, mat, x, y, z, parent = group) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
  const solid = (mat, cx, y0, cz, w, h, d, parent = group) => {
    if (mat) put(new THREE.BoxGeometry(w, h, d), mat, cx, y0 + h / 2, cz, parent);
    addCollider(cx, cz, w, y0 + h, d, { y0, noCover: true });
  };
  const wallM = std({ color: 0x1b2230, metalness: 0.6, roughness: 0.5, emissive: 0x070b12 });
  const darkM = std({ color: 0x241a2c, metalness: 0.75, roughness: 0.4, emissive: 0x12060e });
  const ACC = 0x2fb7ff;

  // ---------------------------------------------------------------- the hall
  const gridC = (() => {
    const [c, x] = cv(256, 256);
    x.fillStyle = '#0b1018'; x.fillRect(0, 0, 256, 256);
    x.strokeStyle = '#1d2a3c'; x.lineWidth = 3; x.strokeRect(0, 0, 256, 256);
    x.strokeStyle = '#142033'; x.lineWidth = 1.5;
    for (let i = 64; i < 256; i += 64) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 256); x.stroke(); x.beginPath(); x.moveTo(0, i); x.lineTo(256, i); x.stroke(); }
    const t = tex(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(H.w / 4, H.d / 4);
    return t;
  })();
  solid(darkM, H.x, H.y - 1.5, H.z, H.w + 4, 1.5, H.d + 4);                                   // floor slab (collider top = H.y)
  const floor = put(new THREE.PlaneGeometry(H.w, H.d), basic({ map: gridC }), H.x, H.y + 0.01, H.z); floor.rotation.x = -PI / 2;
  const T = 2;
  solid(wallM, H.x, H.y, H.z - H.d / 2 - T / 2, H.w + 2 * T, H.h, T);                          // north
  solid(wallM, H.x, H.y, H.z + H.d / 2 + T / 2, H.w + 2 * T, H.h, T);                          // south
  solid(wallM, H.x - H.w / 2 - T / 2, H.y, H.z, T, H.h, H.d);                                  // west
  solid(wallM, H.x + H.w / 2 + T / 2, H.y, H.z, T, H.h, H.d);                                  // east
  solid(wallM, H.x, H.y + H.h, H.z, H.w + 2 * T, 1.2, H.d + 2 * T);                            // ceiling
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {                                        // corner pillars
    solid(darkM, H.x + sx * (H.w / 2 - 0.6), H.y, H.z + sz * (H.d / 2 - 0.6), 1.2, H.h, 1.2);
    put(new THREE.BoxGeometry(1.3, 0.1, 1.3), basic({ color: ACC }), H.x + sx * (H.w / 2 - 0.6), H.y + 0.06, H.z + sz * (H.d / 2 - 0.6));
  }
  const strip = (cx, y, cz, w, h, d, c = ACC) => put(new THREE.BoxGeometry(w, h, d), basic({ color: c }), cx, y, cz);
  for (const y of [H.y + 0.2, H.y + H.h - 0.25]) {                                              // trim along floor and ceiling
    strip(H.x, y, H.z - H.d / 2 + 0.06, H.w - 2.4, 0.1, 0.06); strip(H.x, y, H.z + H.d / 2 - 0.06, H.w - 2.4, 0.1, 0.06);
    strip(H.x - H.w / 2 + 0.06, y, H.z, 0.06, 0.1, H.d - 2.4); strip(H.x + H.w / 2 - 0.06, y, H.z, 0.06, 0.1, H.d - 2.4);
  }
  for (const dz of [-6, 0, 6]) strip(H.x, H.y + H.h - 0.08, H.z + dz, 18, 0.08, 0.9, 0xe8f4ff);  // ceiling lights
  const title = put(new THREE.PlaneGeometry(10, 1.7), basic({ map: plateTex('BOSS HALL', 'choose your fight', ACC, 640, 108), transparent: true }), H.x, H.y + 10.2, H.z - H.d / 2 + 0.1);
  void title;

  // ---------------------------------------------------------------- per-gate floor pad + "locked" plate
  const gates = {};
  for (const id of Object.keys(HUB_SLOT)) {
    const g = gateAt(id), col = GATE_COL[id];
    const ringM = basic({ color: col, side: THREE.DoubleSide }), discM = basic({ color: col, transparent: true, opacity: 0.18, side: THREE.DoubleSide });
    const ring = put(new THREE.RingGeometry(1.0, 1.25, 40), ringM, g.x, H.y + 0.03, g.z + 3.6); ring.rotation.x = -PI / 2;
    const disc = put(new THREE.CircleGeometry(0.95, 32), discM, g.x, H.y + 0.025, g.z + 3.6); disc.rotation.x = -PI / 2;
    // same footprint as the gate's own sign (4.4 x 0.85 at +5.3 / +0.2), one step in front: hides the boss name while sealed
    const plate = put(new THREE.PlaneGeometry(4.4, 0.85), basic({ map: plateTex('???', 'LOCKED', LOCK_COL) }), g.x, H.y + 5.3, g.z + 0.27);
    gates[id] = { ringM, discM, plate, col, was: null };
  }
  const isOpen = (id) => { const f = unlocked[id]; return f ? !!f() : true; };
  const style = (id, open) => {
    const s = gates[id];
    s.ringM.color.setHex(open ? s.col : LOCK_COL); s.discM.opacity = open ? 0.18 : 0.08; s.plate.visible = !open;
  };

  // ---------------------------------------------------------------- exit pad
  const exRingM = basic({ color: 0x5dff9a, side: THREE.DoubleSide });
  const exRing = put(new THREE.RingGeometry(1.2, 1.5, 40), exRingM, EXIT.x, H.y + 0.03, EXIT.z); exRing.rotation.x = -PI / 2;
  const exDisc = put(new THREE.CircleGeometry(1.15, 32), basic({ color: 0x5dff9a, transparent: true, opacity: 0.2, side: THREE.DoubleSide }), EXIT.x, H.y + 0.025, EXIT.z); exDisc.rotation.x = -PI / 2;
  put(new THREE.CylinderGeometry(1.3, 1.3, 6, 24, 1, true), basic({ color: 0x5dff9a, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), EXIT.x, H.y + 3, EXIT.z);
  const exSign = put(new THREE.PlaneGeometry(4.4, 0.85), basic({ map: plateTex('LOBBY', 'step in · exit', 0x5dff9a) }), EXIT.x, H.y + 4, H.z + H.d / 2 - 0.1);
  exSign.rotation.y = PI;

  // ---------------------------------------------------------------- the lobby gate
  const gx = LOBBY.x + GATE_X, gz = LOBBY.z - LOBBY.d / 2 + 2.4, gy = LOBBY.y, GC = 0xff3d6e;
  const gg = new THREE.Group(); scene.add(gg);
  solid(darkM, gx, gy, gz, 5.2, 0.45, 1.8, gg);
  solid(darkM, gx - 2.3, gy + 0.45, gz, 0.35, 4.2, 0.45, gg); solid(darkM, gx + 2.3, gy + 0.45, gz, 0.35, 4.2, 0.45, gg); solid(darkM, gx, gy + 4.4, gz, 5.0, 0.35, 0.45, gg);
  const gems = [[-1.9, 0xff3d6e], [0, 0x6fe3ff], [1.9, 0xff4fd8]].map(([dx, c]) => {
    const m = put(new THREE.OctahedronGeometry(0.34, 0), basic({ color: c }), gx + dx, gy + 5.2 + (dx === 0 ? 0.35 : 0), gz, gg); m.scale.y = 1.9; return m;
  });
  const swirl = put(new THREE.CircleGeometry(1.65, 48), basic({ map: swirlTex(GC), transparent: true, side: THREE.DoubleSide }), gx, gy + 2.5, gz + 0.35, gg);
  const halo = put(new THREE.RingGeometry(1.7, 1.9, 48), basic({ color: GC, transparent: true, opacity: 0.75, side: THREE.DoubleSide }), gx, gy + 2.5, gz + 0.37, gg);
  put(new THREE.PlaneGeometry(3.4, 8), basic({ color: GC, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), gx, gy + 4, gz + 0.6, gg);
  put(new THREE.BoxGeometry(4.6, 0.06, 0.12), basic({ color: GC }), gx, gy + 0.5, gz + 0.2, gg);
  put(new THREE.PlaneGeometry(4.4, 0.85), basic({ map: plateTex('BOSS HALL', 'three boss fights · solo', GC), transparent: true, side: THREE.DoubleSide }), gx, gy + 5.3, gz + 0.2, gg);
  const N = 40, ep = new Float32Array(N * 3), ev = new Float32Array(N);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const reseed = (i, fresh) => { ep[i * 3] = gx + rnd(-1.8, 1.8); ep[i * 3 + 1] = gy + (fresh ? rnd(0.3, 4) : 0.4); ep[i * 3 + 2] = gz + rnd(0.2, 1.2); ev[i] = rnd(0.6, 1.8); };
  for (let i = 0; i < N; i++) reseed(i, true);
  const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.BufferAttribute(ep, 3));
  const embers = new THREE.Points(eg, new THREE.PointsMaterial({ color: GC, size: 0.18, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  embers.frustumCulled = false; gg.add(embers);

  // ---------------------------------------------------------------- behaviour
  /** same mechanism the lobby uses for its Rift Run respawns: write the player state directly */
  function teleport(p, s) {
    p.x = s.x; p.y = s.y + 0.05; p.z = s.z; p.yaw = s.yaw; p.pitch = 0;
    for (const k of ['vx', 'vy', 'vz', 'velY']) if (k in p) p[k] = 0;
    if (p.vel && typeof p.vel === 'object') { p.vel.x = 0; p.vel.y = 0; p.vel.z = 0; }
  }
  const outside = { x: gx, y: gy, z: gz + 4.5, yaw: PI }; // just in front of the lobby gate, facing the lobby
  let hold = 0, boost = 0, prompt = null, shown = true, t = 0;
  const api = {
    get prompt() { return prompt; },
    setVisible(on) { if (on !== shown) { shown = on; group.visible = on; gg.visible = on; } },
    /** a sealed gate must not reveal its boss: swap the gate's own prompt for a neutral one */
    maskPrompt(id, p) {
      if (!p || isOpen(id)) return p;
      return { text: '??? — LOCKED', sub: 'Defeat the previous boss to unlock', progress: 0 };
    },
    update(dt, p, canUse, interact) {
      t += dt; prompt = null;
      for (const id of Object.keys(gates)) { const o = isOpen(id); if (o !== gates[id].was) { gates[id].was = o; style(id, o); } }
      const ok = !!(canUse && p && p.alive);
      const nearGate = ok && Math.abs(p.x - gx) < 3.2 && p.z < gz + 2.1 && Math.abs(p.y - gy) < 2.5;
      const nearExit = ok && Math.hypot(p.x - EXIT.x, p.z - EXIT.z) < 1.9 && Math.abs(p.y - H.y) < 2.5;
      let tgt = 0;
      if (nearGate) {
        hold += dt; tgt = clamp(hold / HOLD, 0, 1);
        prompt = { text: 'E — Enter the Boss Hall', sub: 'three solo boss fights', progress: tgt };
        if (interact || hold >= HOLD) { hold = 0; teleport(p, HUB_SPAWN); }
      } else if (nearExit) {
        hold += dt;
        prompt = { text: 'E — Back to the lobby', sub: 'leave the Boss Hall', progress: clamp(hold / HOLD, 0, 1) };
        if (interact || hold >= HOLD) { hold = 0; teleport(p, outside); }
      } else hold = 0;
      boost += (tgt - boost) * (1 - Math.exp(-6 * dt));
      swirl.rotation.z -= dt * 0.7 * (1 + boost * 3);
      halo.scale.setScalar(1 + Math.sin(t * 4) * 0.02 + boost * 0.12);
      gems.forEach((m, i) => { m.rotation.y = t * 0.9 + i; });
      for (let i = 0; i < N; i++) { ep[i * 3 + 1] += ev[i] * dt * (1 + boost * 2); ep[i * 3] += Math.sin(t * 2 + i) * dt * 0.3; if (ep[i * 3 + 1] > gy + 7) reseed(i, false); }
      eg.attributes.position.needsUpdate = true;
      exRingM.color.setHex(0x5dff9a);
      exRing.scale.setScalar(1 + Math.sin(t * 3) * 0.04);
    },
  };
  return api;
}
