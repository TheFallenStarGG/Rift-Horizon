/**
 * RIFT HORIZON — the main lobby. A floating station above the map.
 *
 *   NORTH      portals (+ dev portal) · banners · preset lockers (north-west)
 *   WEST       ARMORY: 4 slot rows, 6 pedestals per page, page pads, live stat/compare hologram
 *   CENTRE     skylit atrium: dais + hologram core with your 4 equipped weapons orbiting, shootable lanterns
 *   EAST       RANGE: precision lanes · Reflex Gallery · DPS Lab
 *   SOUTH      lounge deck with panoramic window, trophy monoliths · RIFT RUN start (indoor climb)
 *   OUTSIDE    apron + glass rails; RIFT RUN continues through the east gate and wraps the NE exterior
 *   ???        8 secrets. 5 keys unlock the maintenance annex.
 *
 * Call AFTER createWorld() (which clears all colliders). Same scene as the world.
 * update(dt, player, interact) returns null | { type:'portal', mode } | { type:'equip', slot, id }
 * Optional hooks: onEquip(slot,id) · onRangeHit(bull) · onSecret(id) · teleport(x,y,z)
 */
import * as THREE from 'three';
import { addCollider, addRamp, setColliderActive } from './collision.js';
import { bySlot, reloadDuration } from './arsenal.js';
import { buildWeapon } from './weaponModels.js';
import { loadout, setSlot } from './loadout.js';
import { MODES } from './modes.js';

export const LOBBY = { x: -240, y: 400, z: 240, w: 112, d: 80, h: 15 };
export const LOBBY_SPAWN = { x: LOBBY.x, y: LOBBY.y, z: LOBBY.z + 24, yaw: 0 };

const PI = Math.PI;
const PORTALS = [['ffa', -24], ['duel', -8], ['team', 8], ['bots', 24]];
const PORTAL_COL = [0xff6b4a, 0x4aa8ff, 0x5dff9a, 0xffc247];
const SLOT_ORDER = ['main', 'side', 'melee', 'utility'];
const SLOT_COLOR = { main: 0xff8a2b, side: 0x4aa8ff, melee: 0xd05bff, utility: 0x3dff9a };
const SLOT_NAME = { main: 'PRIMARY', side: 'SECONDARY', melee: 'MELEE', utility: 'UTILITY' };
const ROW_Z = [-22, -10, 2, 14];
const PAGE = 6, COL_X0 = -44, COL_DX = 6.4, PAD_X = -7.2;
const HOLD = 1.15;
const THEMES = [
  { name: 'RIFT CYAN', a: 0x2fb7ff, b: 0x3dff9a },
  { name: 'CRIMSON', a: 0xff4a5e, b: 0xffa14a },
  { name: 'VIOLET', a: 0xb56bff, b: 0xff6bd6 },
  { name: 'SOLAR', a: 0xffc247, b: 0xfff0b0 },
];
// ---- Rift Run tuning: gap = horizontal gap multiplier, rise = max step-up multiplier ----
const RUN_TUNE = { gap: 1.0, rise: 1.0, seed: 20261111 };
// indoor climb [x, z, size, top] (local coords) — the last pad sits flush against the east gate
const RUN_INDOOR = [[25.5, 36, 3.2, 0.45], [30, 35, 2.6, 1.2], [34, 37, 2.4, 1.9], [38.2, 35, 2.2, 2.6],
  [42, 37, 1.8, 2.0], [45.5, 35, 1.7, 2.9], [48.9, 37.1, 1.6, 3.6], [53.7, 35, 3.4, 4.0]];
const KEY_CLUES = [
  'Hanging from the ceiling, above the sidearms.',
  "Under the lounge, where the sofas can't see.",
  'Behind the crates in the north-east corner.',
  'On top of the preset lockers.',
  "Outside. Past the run's exit gate.",
];
const TERMINAL_LINES = [
  '> LOG 0001: hall constructed. map pending.',
  '> note to self: the targets are not afraid of you.',
  '> portal 5 was a mistake. do not ask.',
  '> if you are reading this you looked in the corner. respect.',
];

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rgb = (n) => `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const store = {
  get(k, d) { try { const v = localStorage.getItem('lobby.' + k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem('lobby.' + k, JSON.stringify(v)); } catch (_) { /* private mode etc. */ } },
};
const dmgNum = (d) => (typeof d === 'number' ? d : Number(d && (d.dmg ?? d.damage ?? d.amount)) || 0);
const heightColor = (top) => new THREE.Color().setHSL(Math.round((0.5 + clamp((top - 2.5) / 10, 0, 1) * 0.4) * 12) / 12, 0.9, 0.55).getHex();
function mulberry(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function cv(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d')];
}
function canvasTex(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function boxGeo(w, h, d, tile) {
  const g = new THREE.BoxGeometry(w, h, d), uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const k = f * 4 + i;
    uv.setXY(k, (uv.getX(k) * dims[f][0]) / tile, (uv.getY(k) * dims[f][1]) / tile);
  }
  return g;
}
/** Wedge rising toward local +x. len = run, wid = width, rise = height. */
function wedgeGeo(len, wid, rise) {
  const a = [-len / 2, 0, -wid / 2], b = [len / 2, 0, -wid / 2], c = [len / 2, 0, wid / 2], d = [-len / 2, 0, wid / 2];
  const e = [len / 2, rise, -wid / 2], f = [len / 2, rise, wid / 2];
  const tris = [a, d, c, a, c, b, b, c, f, b, f, e, a, e, f, a, f, d, a, b, e, d, f, c];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
  g.computeVertexNormals();
  return g;
}

function floorTextures(w, d) {
  const S = 512, [c, x] = cv(S, S), [e, y] = cv(S, S);
  x.fillStyle = '#0e1218'; x.fillRect(0, 0, S, S);
  for (let i = 0; i < 2400; i++) {
    x.fillStyle = `rgba(255,255,255,${Math.random() * 0.035})`;
    x.fillRect(Math.random() * S, Math.random() * S, 1 + Math.random() * 2, 1);
  }
  x.strokeStyle = '#1c2633'; x.lineWidth = 3;
  for (let i = 0; i <= S; i += S / 8) {
    x.beginPath(); x.moveTo(i, 0); x.lineTo(i, S); x.stroke();
    x.beginPath(); x.moveTo(0, i); x.lineTo(S, i); x.stroke();
  }
  x.strokeStyle = '#2a3a4d'; x.lineWidth = 1.5;
  for (let i = S / 16; i < S; i += S / 8) {
    x.beginPath(); x.moveTo(i, 0); x.lineTo(i, S); x.stroke();
    x.beginPath(); x.moveTo(0, i); x.lineTo(S, i); x.stroke();
  }
  y.fillStyle = '#000'; y.fillRect(0, 0, S, S); // greyscale emissive so the theme can tint it
  y.strokeStyle = '#8a8a8a'; y.lineWidth = 4;
  for (let i = 0; i <= S; i += S / 8) {
    y.beginPath(); y.moveTo(i, 0); y.lineTo(i, S); y.stroke();
    y.beginPath(); y.moveTo(0, i); y.lineTo(S, i); y.stroke();
  }
  y.strokeStyle = '#ffffff'; y.lineWidth = 1.5;
  y.strokeRect(S * 0.08, S * 0.08, S * 0.84, S * 0.84);
  const m = canvasTex(c), g = canvasTex(e);
  for (const t of [m, g]) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(w / 5, d / 5); }
  return { map: m, glow: g };
}

function swirlTexture(color) {
  const S = 256, [c, x] = cv(S, S), col = rgb(color);
  x.translate(S / 2, S / 2);
  const g = x.createRadialGradient(0, 0, 8, 0, 0, S / 2);
  g.addColorStop(0, `rgba(${col},0.08)`);
  g.addColorStop(0.55, `rgba(${col},0.4)`);
  g.addColorStop(1, `rgba(${col},0.85)`);
  x.fillStyle = g; x.beginPath(); x.arc(0, 0, S / 2, 0, PI * 2); x.fill();
  x.lineCap = 'round';
  for (const [style, lw] of [[`rgba(${col},0.9)`, 11], ['rgba(255,255,255,0.45)', 4]]) {
    x.strokeStyle = style; x.lineWidth = lw;
    for (let k = 0; k < 6; k++) {
      x.beginPath();
      for (let i = 0; i <= 48; i++) {
        const t = i / 48, r = t * (S / 2 - 8), a = (k / 6) * PI * 2 + t * 3.8;
        if (i === 0) x.moveTo(Math.cos(a) * r, Math.sin(a) * r);
        else x.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      x.stroke();
    }
  }
  x.strokeStyle = `rgba(${col},0.95)`; x.lineWidth = 6;
  x.beginPath(); x.arc(0, 0, S / 2 - 5, 0, PI * 2); x.stroke();
  const t = canvasTex(c);
  t.center.set(0.5, 0.5);
  return t;
}

function targetTexture(ring = '#c2382b', friend = false) {
  const [c, x] = cv(256, 384);
  x.fillStyle = '#e9e4d6'; x.fillRect(0, 0, 256, 384);
  x.strokeStyle = '#222'; x.lineWidth = 8; x.strokeRect(4, 4, 248, 376);
  [110, 82, 54, 28].forEach((r, i) => {
    x.fillStyle = i % 2 ? '#e9e4d6' : ring;
    x.beginPath(); x.arc(128, 190, r, 0, PI * 2); x.fill();
    x.strokeStyle = '#222'; x.lineWidth = 3; x.stroke();
  });
  x.fillStyle = '#111'; x.beginPath(); x.arc(128, 190, 8, 0, PI * 2); x.fill();
  if (friend) {
    x.fillStyle = 'rgba(255,255,255,0.93)'; x.fillRect(106, 56, 44, 268); x.fillRect(36, 168, 184, 44);
    x.fillStyle = ring; x.fillRect(115, 66, 26, 248); x.fillRect(46, 177, 164, 26);
  }
  return canvasTex(c);
}
function bannerTex(color) {
  const [c, x] = cv(128, 512), col = rgb(color);
  const g = x.createLinearGradient(0, 0, 0, 512);
  g.addColorStop(0, `rgba(${col},0)`); g.addColorStop(0.15, `rgba(${col},0.55)`); g.addColorStop(1, `rgba(${col},0.95)`);
  x.fillStyle = g; x.fillRect(0, 0, 128, 512);
  x.strokeStyle = 'rgba(255,255,255,0.55)'; x.lineWidth = 6;
  for (let i = 0; i < 5; i++) { x.beginPath(); x.moveTo(24, 140 + i * 60); x.lineTo(64, 176 + i * 60); x.lineTo(104, 140 + i * 60); x.stroke(); }
  x.fillStyle = 'rgba(0,0,0,0.35)'; x.fillRect(0, 490, 128, 22);
  return canvasTex(c);
}
function hazardTex(rep) {
  const [c, x] = cv(64, 64);
  x.fillStyle = '#e8b400'; x.fillRect(0, 0, 64, 64); x.fillStyle = '#15181c';
  for (let i = -64; i < 128; i += 32) { x.beginPath(); x.moveTo(i, 64); x.lineTo(i + 16, 64); x.lineTo(i + 80, 0); x.lineTo(i + 64, 0); x.fill(); }
  const t = canvasTex(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, rep);
  return t;
}

function frame(x, px, py, color) {
  const grd = x.createLinearGradient(0, 0, 0, py);
  grd.addColorStop(0, 'rgba(10,14,22,0.92)');
  grd.addColorStop(1, 'rgba(6,10,16,0.96)');
  x.fillStyle = grd; x.fillRect(0, 0, px, py);
  x.strokeStyle = hex(color); x.lineWidth = 6; x.strokeRect(6, 6, px - 12, py - 12);
  x.strokeStyle = `rgba(${rgb(color)},0.35)`; x.lineWidth = 2; x.strokeRect(14, 14, px - 28, py - 28);
  x.strokeStyle = hex(color); x.lineWidth = 3;
  for (const [ax, ay] of [[20, 20], [px - 20, 20], [20, py - 20], [px - 20, py - 20]]) {
    x.beginPath();
    x.moveTo(ax + (ax < px / 2 ? 18 : -18), ay);
    x.lineTo(ax, ay);
    x.lineTo(ax, ay + (ay < py / 2 ? 18 : -18));
    x.stroke();
  }
}
function txt(x, s, px, py, size, color = '#fff', align = 'center', weight = 800) {
  x.textAlign = align; x.textBaseline = 'middle'; x.fillStyle = color;
  x.font = `${weight} ${size}px system-ui, sans-serif`;
  x.fillText(s, px, py);
}
function wrap(x, text, mx, y, lh, maxW, maxLines = 3) {
  const words = String(text).split(' ');
  let line = '', n = 0;
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (x.measureText(test).width > maxW && line) {
      x.fillText(line, mx, y + n * lh); n++; line = w;
      if (n >= maxLines) return;
    } else line = test;
  }
  if (line) x.fillText(line, mx, y + n * lh);
}

function sign(title, sub, w, h, color = 0x2fb7ff) {
  const px = 512, py = Math.round((512 * h) / w), [c, x] = cv(px, py);
  frame(x, px, py, color);
  txt(x, title, px / 2, sub ? py * 0.38 : py * 0.52, sub ? py * 0.38 : py * 0.48, '#fff');
  if (sub) txt(x, sub, px / 2, py * 0.72, py * 0.18, hex(color), 'center', 600);
  return new THREE.Mesh(
    new THREE.PlaneGeometry(w, h),
    new THREE.MeshBasicMaterial({ map: canvasTex(c), toneMapped: false, side: THREE.DoubleSide, transparent: true })
  );
}

function statLine(d) {
  if (d.kind === 'melee' || d.kind === 'utility' || !d.dmg) return d.blurb || '';
  const per = d.pellets > 1 ? `${d.pellets}×` : '', k = (v) => (v >= 100 ? 'KILL' : `${per}${v}`);
  return `Head ${k(d.dmg.head)} · Body ${k(d.dmg.body)} · ${d.mag}/${d.total} ammo · reload ${reloadDuration(d, d.mag).toFixed(1)}s`;
}

export function createLobby(scene, tex, hooks = {}) {
  const L = LOBBY, X = (v) => L.x + v, Y = (v) => L.y + v, Z = (v) => L.z + v;
  const std = (o) => new THREE.MeshStandardMaterial(o);
  const basic = (o) => new THREE.MeshBasicMaterial({ toneMapped: false, ...o });
  const bmCache = new Map();
  const bm = (c) => { let m = bmCache.get(c); if (!m) { m = basic({ color: c }); bmCache.set(c, m); } return m; };
  const wallM = std({ color: 0x66758a, map: tex.concrete, roughness: 0.88, metalness: 0.08, emissive: 0x0b1320 });
  const darkM = std({ color: 0x1f2630, map: tex.metal, roughness: 0.4, metalness: 0.75, emissive: 0x06090e });
  const baseM = std({ color: 0x323c48, map: tex.metal, roughness: 0.35, metalness: 0.8, emissive: 0x070b10 });
  const ceilM = std({ color: 0x1a2028, roughness: 0.92, emissive: 0x05080c });
  const glassM = std({ color: 0x88c8ff, transparent: true, opacity: 0.12, roughness: 0.05, metalness: 0.9, side: THREE.DoubleSide });
  const goldM = std({ color: 0xffc247, metalness: 1, roughness: 0.25, emissive: 0x4a3300 });
  const rampM = std({ color: 0x232b36, roughness: 0.45, metalness: 0.7, side: THREE.DoubleSide });
  const crateM = std({ color: 0x3b4a3c, map: tex.metal, roughness: 0.6, metalness: 0.5, emissive: 0x050a06 });
  const accA = basic({ color: THEMES[0].a }), accB = basic({ color: THEMES[0].b }); // theme-able accents
  const lightM = bm(0xe8f4ff);
  const root = new THREE.Group();
  scene.add(root);
  const unit = new THREE.BoxGeometry(1, 1, 1);

  const mesh = (geo, mtl, x, y, z, shadow) => {
    const m = new THREE.Mesh(geo, mtl); m.position.set(x, y, z);
    const sh = shadow ?? !mtl.isMeshBasicMaterial;
    m.castShadow = sh; m.receiveShadow = sh;
    root.add(m); return m;
  };
  const box = (mtl, cx, cy, cz, w, h, d, shadow) => { const m = mesh(unit, mtl, cx, cy, cz, shadow); m.scale.set(w, h, d); return m; };
  const glow = (c, cx, cy, cz, w, h, d) => box(typeof c === 'number' ? bm(c) : c, cx, cy, cz, w, h, d);
  const solid = (mtl, cx, y0, cz, w, h, d, tile = 3) => {
    mesh(boxGeo(w, h, d, tile), mtl, cx, y0 + h / 2, cz, !mtl.transparent && w * h * d < 400);
    return addCollider(cx, cz, w, y0 + h, d, { y0, noCover: true });
  };
  const put = (m, x, y, z, ry = 0) => { m.position.set(x, y, z); m.rotation.y = ry; root.add(m); return m; };

  // ---------- persistent + session state ----------
  const saved = {
    secrets: new Set(store.get('secrets', [])),
    theme: clamp(store.get('theme', 0) | 0, 0, THEMES.length - 1),
    reflex: store.get('reflexBest', 0),
    run: store.get('runBest', 0),
    dps: store.get('dpsBest', 0),
    orbs: store.get('orbs', 0),
    presets: (() => { const p = store.get('presets', []); return [0, 1, 2].map((i) => (p && p[i]) || null); })(),
  };
  const SECRET_TOTAL = 8;
  let t = 0, hold = 0, active = true, prompt = null, toastT = 0, toast = null, screenT = 0;
  const api = { rangeHits: 0 };
  const note = (text, sub = '') => { toast = { text, sub }; toastT = 2.6; };
  const pre = { score: 0, bulls: 0, last: null };
  const gal = { on: false, left: 0, elapsed: 0, score: 0, combo: 0, hits: 0, spawn: 0, done: 0, isBest: false };
  const dps = { state: 'idle', total: 0, hits: 0, heads: 0, t0: 0, last: 0, lastDmg: 0, lastHead: false, dist: 0, final: 0, dur: 0 };
  const run = { state: 'idle', t: 0, prog: 0, cp: null, falls: 0, grace: 0, lastFail: -99, doneT: 0 };
  const inspect = { s: null, want: false, a: 0 };

  // ---------- particles ----------
  const sparkGeo = new THREE.OctahedronGeometry(0.07, 0);
  const sparks = Array.from({ length: 160 }, () => {
    const m = new THREE.Mesh(sparkGeo, bm(0xffffff)); m.visible = false; root.add(m);
    return { m, vx: 0, vy: 0, vz: 0, g: 0, life: 0, max: 1, size: 1 };
  });
  let sparkI = 0;
  function spark(x, y, z, vx, vy, vz, color, life = 0.8, g = 9, size = 1) {
    const s = sparks[sparkI++ % sparks.length];
    s.m.material = bm(color); s.m.position.set(x, y, z); s.m.visible = true; s.m.scale.setScalar(size);
    Object.assign(s, { vx, vy, vz, g, life, max: life, size });
  }
  function burst(x, y, z, color, n = 14, speed = 4, lift = 2) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * PI * 2, e = Math.random() * 2 - 1, r = Math.sqrt(1 - e * e);
      const sp = speed * (0.4 + Math.random() * 0.6);
      spark(x, y, z, Math.cos(a) * r * sp, e * sp + lift, Math.sin(a) * r * sp, color, 0.5 + Math.random() * 0.5);
    }
  }
  const hitAt = (pt, fx, fy, fz) => [pt && pt.x != null ? pt.x : fx, pt && pt.y != null ? pt.y : fy, pt && pt.z != null ? pt.z : fz];

  // ---------- canvas screens (redraw only when their signature changes) ----------
  const screens = [];
  function screen(w, h, px, draw, sig) {
    const py = Math.round((px * h) / w), [c, g] = cv(px, py), map = canvasTex(c);
    const mat = new THREE.MeshBasicMaterial({ map, toneMapped: false, transparent: true, side: THREE.DoubleSide });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    root.add(m);
    const s = {
      mesh: m, mat, sig, last: null, dirty: true,
      mark() { s.dirty = true; },
      redraw() { g.clearRect(0, 0, px, py); draw(g, px, py); map.needsUpdate = true; s.dirty = false; },
    };
    s.redraw();
    if (sig) s.last = sig();
    screens.push(s);
    return s;
  }
  const statScreen = (w, h, color, fn) => screen(w, h, 512, (g, pw, ph) => {
    const d = fn();
    frame(g, pw, ph, color);
    txt(g, d.title, pw / 2, ph * 0.2, ph * 0.12, hex(color), 'center', 700);
    txt(g, d.big, pw / 2, ph * 0.52, ph * 0.34, '#fff');
    txt(g, d.sub, pw / 2, ph * 0.82, ph * 0.1, '#9fb3c8', 'center', 600);
  }, () => { const d = fn(); return d.title + d.big + d.sub; });
  /** Text lying on the floor. rotY: 0 = reads facing north, PI/2 = facing west, -PI/2 = facing east */
  function flatLabel(str, x, z, color, rotY = 0, w = 2.2, h = 0.6) {
    const s = screen(w, h, 256, (g, pw, ph) => txt(g, str, pw / 2, ph / 2, ph * 0.55, hex(color), 'center', 800));
    s.mesh.rotation.set(-PI / 2, rotY, 0, 'YXZ'); s.mesh.position.set(x, Y(0.05), z);
    return s;
  }
  /** Sign hung from the ceiling. ry: 0 faces south(+z), PI faces north, PI/2 faces east, -PI/2 faces west. y is WORLD height. */
  function hanging(title, sub, color, x, y, z, ry, w = 5.6, h = 1.1) {
    put(sign(title, sub, w, h, color), x, y, z, ry);
    const top = Y(L.h), len = top - (y + h / 2);
    for (const dx of [-w * 0.4, w * 0.4]) box(darkM, x + Math.cos(ry) * dx, y + h / 2 + len / 2, z - Math.sin(ry) * dx, 0.05, len, 0.05, false);
  }

  // ---------- interactables ----------
  const acts = [];
  const act = (o) => { acts.push({ y: 0, r: 1.8, ...o }); return o; };

  // =====================================================================================
  //  SHELL: floor, walls with windows, skylight ceiling, trim
  // =====================================================================================
  const ft = floorTextures(L.w, L.d);
  const floorM = std({ color: 0xffffff, map: ft.map, emissive: THEMES[0].a, emissiveMap: ft.glow, emissiveIntensity: 0.6, roughness: 0.28, metalness: 0.65 });
  const floor = mesh(new THREE.PlaneGeometry(L.w, L.d), floorM, X(0), Y(0.01), Z(0));
  floor.rotation.x = -PI / 2;
  addCollider(X(0), Z(0), L.w + 4, Y(0), L.d + 4, { y0: Y(-1.5), noCover: true });

  /** axis 'x': wall runs along x at z=fixed; axis 'z': along z at x=fixed. parts: [lo, hi, 'plain'|'glass'|'gap', y0, y1] */
  function buildWall(axis, fixed, parts) {
    const T = 2.2, top = L.h + 1;
    const piece = (lo, hi, y0, y1, mtl) => {
      if (hi - lo < 0.02 || y1 - y0 < 0.02) return;
      const c = (lo + hi) / 2, len = hi - lo, h = y1 - y0;
      if (axis === 'x') solid(mtl, X(c), Y(y0), Z(fixed), len, h, T, 4);
      else solid(mtl, X(fixed), Y(y0), Z(c), T, h, len, 4);
    };
    for (const [lo, hi, type, a, b] of parts) {
      if (type === 'plain') piece(lo, hi, -1, top, wallM);
      else if (type === 'glass') {
        piece(lo, hi, -1, a, wallM); piece(lo, hi, a, b, glassM); piece(lo, hi, b, top, wallM);
        for (let m = lo + 4; m < hi - 2; m += 8) {
          if (axis === 'x') box(darkM, X(m), Y((a + b) / 2), Z(fixed), 0.5, b - a, 2.4, false);
          else box(darkM, X(fixed), Y((a + b) / 2), Z(m), 2.4, b - a, 0.5, false);
        }
      } else { piece(lo, hi, -1, a, wallM); piece(lo, hi, b, top, wallM); }
    }
  }
  buildWall('x', -(L.d / 2 + 0.6), [[-60, 60, 'glass', 8.6, 13.3]]);                                   // north: ribbon
  buildWall('x', L.d / 2 + 0.6, [[-60, -36, 'plain'], [-36, 6, 'glass', 4.4, 13.4], [6, 60, 'plain']]); // south: lounge panorama
  buildWall('z', L.w / 2 + 0.6, [[-42, 33, 'glass', 9.2, 13.4], [33, 37, 'gap', 4.0, 7.6], [37, 42, 'plain']]); // east: ribbon + run gate
  buildWall('z', -(L.w / 2 + 0.6), [[-42, 42, 'glass', 9.0, 13.4]]);                                    // west: ribbon

  // ceiling with a skylight over the plaza
  const SKY = { x0: -14, x1: 14, z0: -26, z1: 12 };
  solid(ceilM, X(-37), Y(L.h), Z(0), 46, 1.2, L.d + 4, 4);
  solid(ceilM, X(37), Y(L.h), Z(0), 46, 1.2, L.d + 4, 4);
  solid(ceilM, X(0), Y(L.h), Z((-L.d / 2 - 2 + SKY.z0) / 2), 28, 1.2, SKY.z0 + L.d / 2 + 2, 4);
  solid(ceilM, X(0), Y(L.h), Z((L.d / 2 + 2 + SKY.z1) / 2), 28, 1.2, L.d / 2 + 2 - SKY.z1, 4);
  const skyGlass = mesh(new THREE.PlaneGeometry(28, 38), glassM, X(0), Y(L.h + 0.6), Z(-7), false);
  skyGlass.rotation.x = -PI / 2;
  const shaft = mesh(new THREE.CylinderGeometry(11, 15, L.h, 24, 1, true), basic({ color: 0xcfe8ff, transparent: true, opacity: 0.05, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), X(0), Y(L.h / 2), Z(-7), false);

  for (let ix = -48; ix <= 48; ix += 12) for (const iz of [-30, -14, 2, 18, 32]) {
    if (Math.abs(ix) < 15 && iz > -27 && iz < 13) continue;
    box(lightM, X(ix), Y(L.h - 0.08), Z(iz), 6.5, 0.1, 1.1);
  }
  for (let ix = -54; ix <= 54; ix += 18) box(darkM, X(ix), Y(L.h - 0.7), Z(0), 0.9, 0.7, L.d, false);
  for (const pz of [-38.4, -36.9, 38.2]) {
    const pipe = mesh(new THREE.CylinderGeometry(0.16, 0.16, L.w - 2, 10), darkM, X(0), Y(L.h - 1.9), Z(pz), false);
    pipe.rotation.z = PI / 2;
  }
  for (const [cx, cz, w, d] of [
    [0, -L.d / 2 + 0.15, L.w - 1, 0.08], [0, L.d / 2 - 0.15, L.w - 1, 0.08],
    [-L.w / 2 + 0.15, 0, 0.08, L.d - 1], [L.w / 2 - 0.15, 0, 0.08, L.d - 1],
  ]) glow(accA, X(cx), Y(0.18), Z(cz), w, 0.1, d);
  glow(accB, X(0), Y(8.35), Z(-L.d / 2 + 0.2), L.w - 1, 0.08, 0.06); // wall bands just under the windows
  glow(accB, X(L.w / 2 - 0.2), Y(8.95), Z(0), 0.06, 0.08, L.d - 1);
  glow(accB, X(-L.w / 2 + 0.2), Y(8.75), Z(0), 0.06, 0.08, L.d - 1);
  for (const fz of [-38, -34, -19, -16, -13, -9, 8, 14, 29]) box(darkM, X(L.w / 2 - 0.4), Y(4), Z(fz), 0.7, 8, 0.35, false); // east wall fins
  const column = (x, z) => {
    solid(darkM, X(x), Y(0), Z(z), 1.1, L.h - 0.5, 1.1, 1);
    glow(accA, X(x), Y(0.05), Z(z), 1.4, 0.08, 1.4);
    glow(accA, X(x), Y(L.h - 0.4), Z(z), 1.4, 0.08, 1.4);
  };
  for (const z of [-28, -16, -4, 8, 20]) column(-54.6, z);
  const hazard = mesh(new THREE.PlaneGeometry(0.7, 68), basic({ map: hazardTex(97) }), X(18), Y(0.045), Z(-2), false);
  hazard.rotation.x = -PI / 2;

  // =====================================================================================
  //  EXTERIOR: apron, rails, pylons, orbital rings, hull
  // =====================================================================================
  const APX = 82, APZ = 62;
  solid(baseM, X(0), Y(-1.2), Z(-51.5), APX * 2, 1.2, 21, 6);
  solid(baseM, X(0), Y(-1.2), Z(51.5), APX * 2, 1.2, 21, 6);
  solid(baseM, X(69.5), Y(-1.2), Z(0), 25, 1.2, 82, 6);
  solid(baseM, X(-69.5), Y(-1.2), Z(0), 25, 1.2, 82, 6);
  for (const [cx, cz, w, d] of [[0, -APZ, APX * 2, 0.25], [0, APZ, APX * 2, 0.25], [APX, 0, 0.25, APZ * 2], [-APX, 0, 0.25, APZ * 2]]) {
    solid(glassM, X(cx), Y(0), Z(cz), w, 4.5, d, 4);
    glow(accA, X(cx), Y(4.5), Z(cz), w + 0.1, 0.1, d + 0.1);
  }
  for (const [cx, cz, w, d] of [[0, -42.1, 124, 0.2], [0, 42.1, 124, 0.2], [58, 0, 0.2, 84], [-58, 0, 0.2, 84]]) glow(accA, X(cx), Y(0.04), Z(cz), w, 0.04, d);
  const beacons = [];
  for (const [px, pz] of [[-78, -58], [78, -58], [78, 58], [-78, 58]]) {
    solid(darkM, X(px), Y(0), Z(pz), 3, 30, 3, 2);
    glow(accA, X(px), Y(14), Z(pz), 3.2, 0.25, 3.2);
    beacons.push(mesh(new THREE.SphereGeometry(0.9, 12, 12), basic({ color: 0xff4a5e, transparent: true, opacity: 0.9 }), X(px), Y(31), Z(pz), false));
  }
  const ringA = mesh(new THREE.TorusGeometry(125, 0.9, 8, 120), accA, X(0), Y(24), Z(0), false); ringA.rotation.x = PI / 2 + 0.12;
  const ringB = mesh(new THREE.TorusGeometry(108, 0.5, 8, 120), accB, X(0), Y(30), Z(0), false); ringB.rotation.set(PI / 2 - 0.2, 0, 0.3);
  const hullGeo = new THREE.ConeGeometry(70, 46, 4, 1); hullGeo.rotateY(PI / 4);
  const hull = mesh(hullGeo, std({ color: 0x1b222b, roughness: 0.9, metalness: 0.3, flatShading: true }), X(0), Y(-24.2), Z(0), false);
  hull.scale.set(1.65, 1, 1.25); hull.rotation.x = PI;

  // =====================================================================================
  //  PORTALS + banners
  // =====================================================================================
  const portals = [];
  function buildPortal(id, mode, ox, col, dir) {
    const px = X(ox), pz = Z(-L.d / 2 + 2.4);
    solid(darkM, px, Y(0), pz, 5.2, 0.45, 1.8, 1);
    solid(darkM, px - 2.3, Y(0.45), pz, 0.35, 4.2, 0.45, 1);
    solid(darkM, px + 2.3, Y(0.45), pz, 0.35, 4.2, 0.45, 1);
    solid(darkM, px, Y(4.4), pz, 5.0, 0.35, 0.45, 1);
    const swirl = mesh(new THREE.CircleGeometry(1.65, 48), basic({ map: swirlTexture(col), transparent: true, side: THREE.DoubleSide }), px, Y(2.5), pz + 0.35);
    const halo = mesh(new THREE.RingGeometry(1.7, 1.9, 48), basic({ color: col, transparent: true, opacity: 0.7, side: THREE.DoubleSide }), px, Y(2.5), pz + 0.37);
    mesh(new THREE.PlaneGeometry(3.4, 8), basic({ color: col, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), px, Y(4), pz + 0.6, false);
    glow(col, px, Y(0.5), pz + 0.2, 4.6, 0.06, 0.12);
    put(sign(mode.name || id.toUpperCase(), mode.short || 'enter to play', 4.4, 0.85, col), px, Y(5.3), pz + 0.2);
    const q = { id, mode, x: px, z: pz, swirl, halo, dir, color: col, boost: 0, tgt: 0 };
    portals.push(q);
    return q;
  }
  PORTALS.forEach(([id, ox], i) => buildPortal(id, MODES[id] || { name: id.toUpperCase(), short: id }, ox, PORTAL_COL[i % 4], i % 2 ? 1 : -1));
  function enableDevPortal() {
    if (portals.some((q) => q.id === 'dev')) return;
    buildPortal('dev', { name: 'DEVELOPER', short: 'sandbox · fly · spawn' }, 40, 0xb56bff, 1);
  }
  [[-16, 0]].concat([[0, 1], [16, 2], [32, 3]]).forEach(([bx, i]) => {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 8), basic({ map: bannerTex(PORTAL_COL[i % 4]), transparent: true, side: THREE.DoubleSide }));
    put(b, X(bx), Y(10.8), Z(-L.d / 2 + 1.2));
  });

  // ---------- weapon model helpers ----------
  const showScale = (def) => (def.model === 'sledge' ? 0.55
    : def.model === 'machete' || def.model === 'tomahawk' ? 0.7
      : def.cls === 'long' ? 0.9 : def.kind === 'utility' ? 1.25 : def.kind === 'melee' ? 0.95 : 1.1);
  function displayModel(def, mul = 1, mat = null) {
    const wrapG = new THREE.Group();
    try {
      const g = buildWeapon(def.model, tex).group;
      g.scale.setScalar(showScale(def) * mul);
      g.rotation.x = def.kind === 'utility' ? 0.15 : (def.kind === 'melee' ? 0.35 : -0.2);
      g.rotation.z = def.kind === 'melee' ? 0 : 0.08;
      if (mat) g.traverse((o) => { if (o.isMesh) o.material = mat; });
      wrapG.add(g);
    } catch (_) {
      const f = new THREE.Mesh(unit, std({ color: 0x888888 })); f.scale.set(0.4, 0.15, 0.9); wrapG.add(f);
    }
    return wrapG;
  }
  const modelCache = new Map();
  function getModel(def, mul = 1, tag = '', mat = null) {
    const key = tag + def.id;
    let g = modelCache.get(key);
    if (!g) { g = displayModel(def, mul, mat); modelCache.set(key, g); }
    return g;
  }

  // =====================================================================================
  //  ARMORY: paged pedestals
  // =====================================================================================
  const stands = [], bayOf = {};
  const eff = (d, k) => (d.dmg ? d.dmg[k] * (d.pellets || 1) : 0);
  const isGun = (d) => d.kind !== 'melee' && d.kind !== 'utility' && !!d.dmg;
  const defOf = (slot, id) => (bayOf[slot] ? bayOf[slot].list.find((d) => d.id === id) || null : null);

  const bays = SLOT_ORDER.map((slot, row) => {
    const list = bySlot(slot) || [], guns = list.filter(isGun);
    const bay = {
      slot, row, list, z: Z(ROW_Z[row]), page: 0, pages: Math.max(1, Math.ceil(list.length / PAGE)), stands: [],
      maxHead: Math.max(1, ...guns.map((d) => eff(d, 'head'))), maxBody: Math.max(1, ...guns.map((d) => eff(d, 'body'))),
      maxMag: Math.max(1, ...guns.map((d) => d.mag)), maxRl: Math.max(0.5, ...guns.map((d) => reloadDuration(d, d.mag))),
    };
    bayOf[slot] = bay;
    return bay;
  });

  function drawInspector(g, w, h, s) {
    if (!s || !s.def) return;
    const d = s.def, c = SLOT_COLOR[s.slot], bay = bayOf[s.slot], eq = loadout[s.slot] === d.id, cur = defOf(s.slot, loadout[s.slot]);
    frame(g, w, h, c);
    txt(g, d.name, 40, 62, 48, '#fff', 'left');
    txt(g, SLOT_NAME[s.slot] + (eq ? '  ·  EQUIPPED' : ''), 40, 106, 22, eq ? '#5dff9a' : hex(c), 'left', 700);
    if (!isGun(d)) {
      g.fillStyle = '#cfd8e3'; g.font = '600 28px system-ui, sans-serif'; g.textAlign = 'left'; g.textBaseline = 'middle';
      wrap(g, d.blurb || 'No data.', 40, 178, 38, w - 80, 4);
      return;
    }
    const per = d.pellets > 1 ? `${d.pellets}×` : '';
    const rows = [
      ['HEAD', eff(d, 'head') / bay.maxHead, d.dmg.head >= 100 ? 'KILL' : `${per}${d.dmg.head}`, cur && isGun(cur) ? eff(d, 'head') - eff(cur, 'head') : 0, 1],
      ['BODY', eff(d, 'body') / bay.maxBody, d.dmg.body >= 100 ? 'KILL' : `${per}${d.dmg.body}`, cur && isGun(cur) ? eff(d, 'body') - eff(cur, 'body') : 0, 1],
      ['MAG', d.mag / bay.maxMag, String(d.mag), cur && isGun(cur) ? d.mag - cur.mag : 0, 1],
      ['RELOAD', 1 - (reloadDuration(d, d.mag) / bay.maxRl) * 0.85, reloadDuration(d, d.mag).toFixed(1) + 's',
        cur && isGun(cur) ? reloadDuration(d, d.mag) - reloadDuration(cur, cur.mag) : 0, -1],
    ];
    rows.forEach(([label, fill, val, delta, sgn], i) => {
      const y = 168 + i * 58;
      txt(g, label, 40, y, 22, '#9fb3c8', 'left', 700);
      g.fillStyle = 'rgba(255,255,255,0.1)'; g.fillRect(170, y - 11, w - 420, 22);
      g.fillStyle = hex(c); g.fillRect(170, y - 11, (w - 420) * clamp(fill, 0.03, 1), 22);
      txt(g, val, w - 235, y, 26, '#fff', 'left', 800);
      if (Math.abs(delta) > 0.001 && !eq) {
        const good = delta * sgn > 0;
        txt(g, (delta > 0 ? '+' : '') + (Math.abs(delta) < 10 ? delta.toFixed(1) : Math.round(delta)), w - 40, y, 22, good ? '#5dff9a' : '#ff6b6b', 'right', 800);
      }
    });
    txt(g, `${d.total} total ammo${eq ? '' : '  ·  green/red = vs your equipped'}`, 40, h - 36, 20, '#7f93a8', 'left', 600);
  }
  const inspScreen = screen(4.6, 2.5, 640, (g, w, h) => drawInspector(g, w, h, inspect.s),
    () => (inspect.s && inspect.s.def ? inspect.s.def.id + '|' + loadout[inspect.s.slot] : ''));
  inspScreen.mesh.visible = false; inspScreen.mat.opacity = 0;

  function refreshRings() {
    for (const s of stands) {
      const eq = !!s.def && loadout[s.slot] === s.def.id;
      s.ring.material.color.setHex(eq ? 0x5dff9a : SLOT_COLOR[s.slot]);
      s.ring.scale.setScalar(eq ? 1.16 : 1);
      s.disc.material.opacity = eq ? 0.35 : 0.15;
    }
  }
  function setPage(bay, page) {
    bay.page = (page + bay.pages) % bay.pages;
    bay.stands.forEach((s, c) => {
      const def = bay.list[bay.page * PAGE + c] || null;
      s.def = def;
      if (s.model) { s.holder.remove(s.model); s.model = null; }
      if (def) { s.model = getModel(def); s.holder.add(s.model); }
      s.holder.visible = s.ring.visible = s.disc.visible = s.plate.mesh.visible = !!def;
      s.pop = 0; s.holder.scale.setScalar(0.001);
      s.plate.mark();
      if (def) burst(s.x, Y(1.4), s.z, SLOT_COLOR[s.slot], 6, 2, 1.5);
    });
    bay.label.mark();
    refreshRings();
  }
  function equip(s) {
    if (!s.def || loadout[s.slot] === s.def.id) return null;
    setSlot(s.slot, s.def.id);
    refresh();
    burst(s.x, Y(1.8), s.z, 0x5dff9a, 24, 4.5, 3);
    if (hooks.onEquip) hooks.onEquip(s.slot, s.def.id);
    return { type: 'equip', slot: s.slot, id: s.def.id };
  }

  bays.forEach((bay) => {
    const { slot } = bay, c = SLOT_COLOR[slot], z = bay.z;
    put(sign(SLOT_NAME[slot], `${bay.list.length} weapons${bay.pages > 1 ? ` · ${bay.pages} pages` : ''}`, 5.6, 1.4, c), X(-55.3), Y(3.4), z, PI / 2);
    glow(c, X(-28.5), Y(0.03), z, 38, 0.04, 0.18);
    bay.label = screen(2.2, 0.9, 256, (g, pw, ph) => txt(g, `PAGE ${bay.page + 1}/${bay.pages}`, pw / 2, ph / 2, ph * 0.38, hex(c)));
    bay.label.mesh.rotation.set(-PI / 2, PI / 2, 0, 'YXZ'); bay.label.mesh.position.set(X(PAD_X), Y(0.05), z);
    bay.label.mesh.visible = bay.pages > 1;
    if (bay.pages > 1) {
      [[-1, '◀ PREV'], [1, 'NEXT ▶']].forEach(([dir, label]) => {
        const pz = z + dir * 2.5;
        const ring = mesh(new THREE.RingGeometry(0.75, 0.95, 32), bm(c), X(PAD_X), Y(0.04), pz, false);
        ring.rotation.x = -PI / 2;
        flatLabel(label, X(PAD_X), pz, c, PI / 2, 1.6, 0.5);
        act({
          x: X(PAD_X), z: pz, r: 1.25,
          prompt: () => ({ text: `E — ${dir < 0 ? 'Previous' : 'Next'} page`, sub: `${SLOT_NAME[slot]} · page ${bay.page + 1}/${bay.pages}`, progress: 0 }),
          run: () => { setPage(bay, bay.page + dir); return null; },
        });
      });
    }
    for (let col = 0; col < Math.min(PAGE, bay.list.length); col++) {
      const x = X(COL_X0 + col * COL_DX);
      addCollider(x, z, 2.2, Y(0.95), 2.2, { y0: Y(0), noCover: true });
      box(baseM, x, Y(0.11), z, 2.2, 0.22, 2.2);
      box(darkM, x, Y(0.5), z, 1.7, 0.55, 1.7);
      box(baseM, x, Y(0.86), z, 1.35, 0.18, 1.35);
      for (const [ox, oz] of [[-0.55, -0.55], [0.55, -0.55], [-0.55, 0.55], [0.55, 0.55]]) box(darkM, x + ox, Y(1.6), z + oz, 0.06, 1.55, 0.06);
      mesh(new THREE.BoxGeometry(1.1, 1.45, 1.1), glassM, x, Y(1.6), z, false);
      mesh(new THREE.BoxGeometry(1.2, 0.03, 1.2), glassM, x, Y(2.35), z, false);
      const ring = mesh(new THREE.RingGeometry(0.55, 0.72, 40), basic({ color: c, side: THREE.DoubleSide }), x, Y(1.02), z);
      ring.rotation.x = -PI / 2;
      const disc = mesh(new THREE.CircleGeometry(0.48, 32), basic({ color: c, transparent: true, opacity: 0.18 }), x, Y(1.015), z);
      disc.rotation.x = -PI / 2;
      const holder = new THREE.Group(); holder.position.set(x, Y(1.65), z); root.add(holder);
      const s = { slot, col, x, z, def: null, model: null, holder, ring, disc, plate: null, pop: 1, phase: Math.random() * PI * 2 };
      s.plate = screen(2.4, 0.55, 512, (g, pw, ph) => {
        if (!s.def) return;
        frame(g, pw, ph, c);
        txt(g, s.def.name, pw / 2, ph * 0.38, ph * 0.38, '#fff', 'center', 800);
        txt(g, SLOT_NAME[slot], pw / 2, ph * 0.72, ph * 0.18, hex(c), 'center', 600);
      });
      put(s.plate.mesh, x, Y(0.55), z + 1.15);
      stands.push(s); bay.stands.push(s);
      act({
        x, z, r: 1.9, stand: s, off: () => !s.def,
        prompt: () => {
          const eq = loadout[slot] === s.def.id;
          return { text: eq ? `${s.def.name} — equipped` : `E — Equip ${s.def.name}`, sub: `${SLOT_NAME[slot]} · ${statLine(s.def)}`, progress: 0 };
        },
        run: () => equip(s),
      });
    }
  });

  // ---------- preset lockers (north-west) ----------
  const presetNames = (i) => {
    const p = saved.presets[i];
    return p ? SLOT_ORDER.map((sl) => { const d = defOf(sl, p[sl]); return d ? d.name : '—'; }).join(' · ') : 'empty';
  };
  [0, 1, 2].forEach((i) => {
    const x = X(-48 + i * 6.2), z = Z(-39), letter = 'ABC'[i], col = 0xffc247;
    solid(baseM, x, Y(0), z, 4.6, 5.4, 1.6, 2);
    glow(accA, x, Y(5.5), z + 0.8, 4.6, 0.08, 0.06);
    const scr = screen(3.8, 4.4, 384, (g, pw, ph) => {
      frame(g, pw, ph, col);
      txt(g, `PRESET ${letter}`, pw / 2, ph * 0.11, ph * 0.075, hex(col));
      const p = saved.presets[i];
      if (!p) { txt(g, 'EMPTY', pw / 2, ph * 0.42, ph * 0.09, '#6f8197'); txt(g, 'step on SAVE', pw / 2, ph * 0.56, ph * 0.045, '#6f8197', 'center', 600); return; }
      SLOT_ORDER.forEach((sl, k) => {
        const d = defOf(sl, p[sl]), y = ph * (0.27 + k * 0.17);
        txt(g, SLOT_NAME[sl], pw / 2, y - ph * 0.04, ph * 0.04, hex(SLOT_COLOR[sl]), 'center', 700);
        txt(g, d ? d.name : '—', pw / 2, y + ph * 0.035, ph * 0.06, '#fff', 'center', 800);
      });
    }, () => JSON.stringify(saved.presets[i]));
    put(scr.mesh, x, Y(2.9), z + 0.82);
    for (const [dz, label, c2] of [[3.4, 'LOAD', 0x5dff9a], [6.3, 'SAVE', 0xffc247]]) {
      const ring = mesh(new THREE.RingGeometry(0.75, 0.95, 32), bm(c2), x, Y(0.04), z + dz, false);
      ring.rotation.x = -PI / 2;
      flatLabel(label, x, z + dz, c2, 0, 1.6, 0.5);
    }
    act({
      x, z: z + 3.4, r: 1.2,
      prompt: () => (saved.presets[i]
        ? { text: `E — Load preset ${letter}`, sub: presetNames(i), progress: 0 }
        : { text: `Preset ${letter} is empty`, sub: 'Step on the SAVE pad to store your current loadout here', progress: 0 }),
      run: () => {
        const p = saved.presets[i]; if (!p) return null;
        let last = null;
        for (const sl of SLOT_ORDER) {
          if (p[sl] && loadout[sl] !== p[sl] && defOf(sl, p[sl])) {
            setSlot(sl, p[sl]);
            if (hooks.onEquip) hooks.onEquip(sl, p[sl]);
            last = { type: 'equip', slot: sl, id: p[sl] };
          }
        }
        refresh(); burst(x, Y(2.5), z + 2.5, 0x5dff9a, 24, 4, 3);
        note(`Preset ${letter} loaded`, presetNames(i));
        return last;
      },
    });
    act({
      x, z: z + 6.3, r: 1.2,
      prompt: () => ({ text: `E — Save current loadout to preset ${letter}`, sub: SLOT_ORDER.map((sl) => { const d = defOf(sl, loadout[sl]); return d ? d.name : '—'; }).join(' · '), progress: 0 }),
      run: () => {
        saved.presets[i] = Object.fromEntries(SLOT_ORDER.map((sl) => [sl, loadout[sl]]));
        store.set('presets', saved.presets);
        burst(x, Y(2.5), z + 5.5, 0xffc247, 24, 4, 3);
        note(`Saved to preset ${letter}`, presetNames(i));
        return null;
      },
    });
  });
  hanging('LOCKERS', 'save · load loadout presets', 0xffc247, X(-41.8), Y(7.4), Z(-34), 0, 5.6, 1.1);

  // =====================================================================================
  //  ATRIUM: dais + hologram core with orbiting loadout
  // =====================================================================================
  const CX = 4, CZ = -6, H0 = 3.6;
  const ringFrame = (cx, cz, size, top, col) => {
    for (const s of [-1, 1]) { glow(col, X(cx), Y(top + 0.02), Z(cz + s * size / 2), size, 0.04, 0.12); glow(col, X(cx + s * size / 2), Y(top + 0.02), Z(cz), 0.12, 0.04, size); }
  };
  [[14, 0.2], [11, 0.4], [8, 0.6]].forEach(([size, top], i) => {
    solid(baseM, X(CX), Y(0), Z(CZ), size, top, size, 2);
    ringFrame(CX, CZ, size, top, i % 2 ? accB : accA);
  });
  solid(baseM, X(CX), Y(0.6), Z(CZ), 3.2, 0.35, 3.2, 1.5);
  solid(darkM, X(CX), Y(0.95), Z(CZ), 2.4, 0.55, 2.4, 1);
  const orbitA = mesh(new THREE.TorusGeometry(1.9, 0.04, 12, 64), accA, X(CX), Y(H0), Z(CZ));
  const orbitB = mesh(new THREE.TorusGeometry(1.45, 0.035, 12, 64), accB, X(CX), Y(H0), Z(CZ));
  orbitB.rotation.x = PI / 2.6;
  const holoM = basic({ color: THEMES[0].a, wireframe: true });
  const holo = mesh(new THREE.IcosahedronGeometry(1.15, 1), holoM, X(CX), Y(H0), Z(CZ));
  const core = mesh(new THREE.IcosahedronGeometry(0.42, 0), bm(0xdff1ff), X(CX), Y(H0), Z(CZ));
  const orbitG = new THREE.Group(); orbitG.position.set(X(CX), Y(H0), Z(CZ)); root.add(orbitG);
  const orbitSlots = SLOT_ORDER.map(() => { const g = new THREE.Group(); orbitG.add(g); return g; });
  put(sign('RIFT HORIZON', 'your loadout orbits the core', 9.5, 1.7, 0x2fb7ff), X(CX), Y(9), Z(CZ));
  function rebuildOrbit() {
    SLOT_ORDER.forEach((slot, i) => {
      const g = orbitSlots[i]; g.clear();
      const d = defOf(slot, loadout[slot]);
      if (d) g.add(getModel(d, 0.55, 'o:'));
    });
  }
  hanging('ARMORY', 'compare stats · swap pages · no limits', 0x5dff9a, X(-9), Y(9.4), Z(-6), PI / 2, 8.2, 1.2);
  hanging('WELCOME, OPERATOR', 'E · interact   1-4 · slots   Q · build   V · camera', 0x5dff9a, X(0), Y(8), Z(16), 0, 9, 1.4);
  const spawnPad = mesh(new THREE.RingGeometry(1.5, 2.0, 48), basic({ color: 0x5dff9a, side: THREE.DoubleSide }), X(0), Y(0.04), Z(24), false);
  spawnPad.rotation.x = -PI / 2;
  glow(0x5dff9a, X(0), Y(0.03), Z(24), 4.2, 0.04, 4.2);
  const woodM = std({ color: 0x2b2118, roughness: 0.9 }), leafM = basic({ color: 0x3dff9a, transparent: true, opacity: 0.75 });
  for (const [px, pz] of [[-2, -16], [10, -16], [-2, 4], [10, 4]]) { // planters
    box(darkM, X(px), Y(0.35), Z(pz), 1.6, 0.7, 1.6); box(woodM, X(px), Y(1.4), Z(pz), 0.18, 1.4, 0.18);
    mesh(new THREE.IcosahedronGeometry(0.9, 1), leafM, X(px), Y(2.4), Z(pz), false);
    addCollider(X(px), Z(pz), 1.6, Y(0.7), 1.6, { y0: Y(0), noCover: true });
  }

  // =====================================================================================
  //  RANGE
  // =====================================================================================
  const firingX = 18;
  for (const dz of [-13, 13]) box(darkM, X(21), Y(0.65), Z(dz), 6, 1.3, 0.12);
  hanging('RANGE', 'precision · reflex · dps lab', 0xffd23f, X(16.5), Y(10), Z(-2), -PI / 2, 7, 1.3);

  const foeTex = targetTexture('#c2382b'), friendTex = targetTexture('#2b7fc2', true), goldTex = targetTexture('#e0a21a');
  const foeM = basic({ map: foeTex });
  const flips = [];
  [[34, -31], [34, -21], [44, -28], [44, -18], [53, -31], [53, -21]].forEach(([tx, tz]) => {
    const x = X(tx), z = Z(tz), dist = tx - firingX;
    box(darkM, x + 0.2, Y(0.5), z, 0.1, 1.0, 0.1); box(baseM, x + 0.1, Y(0.03), z, 0.8, 0.06, 1.2);
    const hinge = new THREE.Group(); hinge.position.set(x, Y(0.95), z); root.add(hinge);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.65), foeM);
    board.position.y = 0.85; board.rotation.y = -PI / 2; hinge.add(board);
    const col = addCollider(x, z, 0.3, Y(2.65), 1.3, { y0: Y(0.95), noCover: true });
    const g = { hinge, col, down: false, timer: 0, amt: 0 };
    col.onShot = (dmg, pt) => {
      if (g.down) return;
      g.down = true; g.timer = 2.4; setColliderActive(col, false); api.rangeHits++;
      const bull = !!pt && Math.hypot(pt.y - Y(1.8), pt.z - z) < 0.3;
      const pts = (1 + Math.floor(dist / 10)) * (bull ? 2 : 1);
      pre.score += pts; if (bull) pre.bulls++; pre.last = { dist, bull, pts };
      burst(...hitAt(pt, x, Y(1.8), z), bull ? 0xffd23f : 0xffffff, bull ? 18 : 8, 3, 1.5);
      if (hooks.onRangeHit) hooks.onRangeHit(bull);
    };
    flips.push(g);
    if (tz === -31) flatLabel(`${dist} m`, x - 1.5, Z(-35.5), 0xffd23f, -PI / 2, 1.6, 0.5);
  });
  const preScreen = screen(8, 3.4, 640, (g, w, h) => {
    frame(g, w, h, 0xffd23f);
    txt(g, 'PRECISION RANGE', w / 2, h * 0.14, h * 0.1, '#fff');
    txt(g, String(pre.score), w * 0.3, h * 0.5, h * 0.32, '#ffd23f');
    txt(g, 'SCORE', w * 0.3, h * 0.78, h * 0.08, '#9fb3c8', 'center', 600);
    txt(g, String(pre.bulls), w * 0.7, h * 0.5, h * 0.32, '#fff');
    txt(g, 'BULLSEYES', w * 0.7, h * 0.78, h * 0.08, '#9fb3c8', 'center', 600);
    txt(g, pre.last ? `last: ${pre.last.dist} m${pre.last.bull ? ' · BULLSEYE' : ''} · +${pre.last.pts}` : 'farther = more points · bullseye = x2', w / 2, h * 0.92, h * 0.065, '#7f93a8', 'center', 600);
  }, () => `${pre.score}|${pre.bulls}|${pre.last ? pre.last.pts : ''}`);
  put(preScreen.mesh, X(55.3), Y(6.2), Z(-26), -PI / 2);
  hanging('PRECISION', 'distance scores more', 0xffd23f, X(19), Y(6.4), Z(-26), -PI / 2, 4.6, 0.9);

  // --- Reflex Gallery ---
  const galSlots = [-10, -6, -2, 2, 6, 10].map((dz) => {
    const x = X(45), z = Z(dz);
    solid(darkM, X(43.6), Y(0), z, 0.25, 1.0, 3.0, 1);
    glow(accA, X(43.45), Y(1.02), z, 0.05, 0.04, 3.0);
    const hinge = new THREE.Group(); hinge.position.set(x, Y(0.35), z); root.add(hinge);
    const mat = basic({ map: foeTex });
    const board = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.65), mat);
    board.position.y = 0.85; board.rotation.y = -PI / 2; hinge.add(board);
    const col = addCollider(x, z, 0.3, Y(2.05), 1.3, { y0: Y(1.0), noCover: true });
    setColliderActive(col, false);
    const s = { hinge, mat, col, up: false, kind: 'foe', ttl: 0, amt: 1 };
    col.onShot = (dmg, pt) => {
      if (!s.up) return;
      const bull = !!pt && Math.hypot(pt.y - Y(1.2), pt.z - z) < 0.28;
      if (s.kind === 'friend') {
        gal.score = Math.max(0, gal.score - 20); gal.combo = 0;
        burst(...hitAt(pt, x, Y(1.5), z), 0x4aa8ff, 14, 3, 1.5);
      } else {
        gal.combo++; gal.hits++; gal.score += 10 + Math.min(gal.combo, 10) + (bull ? 5 : 0);
        burst(...hitAt(pt, x, Y(1.5), z), bull ? 0xffd23f : 0xff5a4a, bull ? 18 : 10, 3.2, 1.5);
      }
      s.up = false; setColliderActive(col, false); api.rangeHits++;
      if (hooks.onRangeHit) hooks.onRangeHit(bull && s.kind === 'foe');
    };
    return s;
  });
  const galScreen = screen(10, 4.2, 800, (g, w, h) => {
    frame(g, w, h, 0xff5a4a);
    txt(g, 'REFLEX GALLERY', w / 2, h * 0.12, h * 0.1, '#fff');
    if (gal.on) {
      txt(g, gal.left.toFixed(1) + 's', w * 0.2, h * 0.5, h * 0.3, '#ffd23f');
      txt(g, String(gal.score), w * 0.6, h * 0.5, h * 0.3, '#fff');
      txt(g, gal.combo > 1 ? `COMBO x${gal.combo}` : 'shoot RED · spare BLUE', w * 0.5, h * 0.84, h * 0.09, gal.combo > 1 ? '#ff8a2b' : '#9fb3c8', 'center', 700);
    } else if (gal.done > 0) {
      txt(g, gal.isBest ? 'NEW BEST!' : 'TIME', w / 2, h * 0.34, h * 0.14, gal.isBest ? '#5dff9a' : '#ffd23f');
      txt(g, `${gal.score} pts · ${gal.hits} hits`, w / 2, h * 0.62, h * 0.18, '#fff');
      txt(g, `best ${saved.reflex}`, w / 2, h * 0.86, h * 0.09, '#9fb3c8', 'center', 600);
    } else {
      txt(g, 'shoot RED  ·  spare BLUE  ·  30 seconds', w / 2, h * 0.42, h * 0.1, '#cfd8e3', 'center', 700);
      txt(g, `BEST ${saved.reflex}`, w / 2, h * 0.7, h * 0.16, '#ffd23f');
      txt(g, 'press E at the console to start', w / 2, h * 0.9, h * 0.07, '#7f93a8', 'center', 600);
    }
  }, () => `${gal.on}|${gal.left.toFixed(1)}|${gal.score}|${gal.combo}|${gal.done > 0}|${gal.isBest}|${saved.reflex}`);
  put(galScreen.mesh, X(55.3), Y(6.2), Z(0), -PI / 2);
  box(darkM, X(19.6), Y(0.55), Z(0), 0.9, 1.1, 1.4); glow(0xff5a4a, X(19.6), Y(1.12), Z(0), 0.7, 0.04, 1.2);
  hanging('REFLEX GALLERY', 'shoot red · spare blue', 0xff5a4a, X(19), Y(6.4), Z(0), -PI / 2, 4.6, 0.9);
  const startGallery = () => { Object.assign(gal, { on: true, left: 30, elapsed: 0, score: 0, combo: 0, hits: 0, spawn: 0.6, done: 0, isBest: false }); };
  function endGallery() {
    gal.on = false; gal.done = 7; gal.isBest = gal.score > saved.reflex;
    if (gal.isBest) { saved.reflex = gal.score; store.set('reflexBest', saved.reflex); }
    for (const s of galSlots) { s.up = false; setColliderActive(s.col, false); }
    note(`Reflex Gallery: ${gal.score} pts`, gal.isBest ? 'NEW BEST!' : `best ${saved.reflex}`);
  }
  act({
    x: X(19.6), z: Z(0), r: 2.2,
    prompt: () => (gal.on ? { text: `Reflex Gallery — ${gal.left.toFixed(1)}s`, sub: `Score ${gal.score}${gal.combo > 1 ? ` · combo x${gal.combo}` : ''}`, progress: 0 }
      : { text: 'E — Start Reflex Gallery', sub: `30s · red +10 · blue −20 · best ${saved.reflex}`, progress: 0 }),
    run: () => { if (!gal.on) startGallery(); return null; },
  });

  // --- DPS Lab ---
  const dummies = [[28, 17], [38, 23], [48, 29]].map(([dx, dz]) => {
    const x = X(dx), z = Z(dz), dist = dx - firingX;
    const bodyM = std({ color: 0xd9822b, roughness: 0.6 }), headM = std({ color: 0xe8e4d8, roughness: 0.5 });
    box(baseM, x, Y(0.06), z, 1.1, 0.12, 1.1);
    for (const sx of [-0.18, 0.18]) box(darkM, x + sx, Y(0.45), z, 0.16, 0.7, 0.16);
    box(bodyM, x, Y(1.1), z, 0.62, 0.85, 0.32); box(darkM, x, Y(1.3), z, 1.0, 0.13, 0.16);
    mesh(new THREE.SphereGeometry(0.2, 16, 12), headM, x, Y(1.75), z);
    const dm = { x, z, dist, bodyM, headM, flash: 0 };
    const bodyC = addCollider(x, z, 0.75, Y(1.55), 0.5, { y0: Y(0.1), noCover: true });
    const headC = addCollider(x, z, 0.45, Y(1.98), 0.45, { y0: Y(1.55), noCover: true });
    bodyC.onShot = (d, pt) => hitDummy(dm, d, false, pt);
    headC.onShot = (d, pt) => hitDummy(dm, d, true, pt);
    flatLabel(`${dist} m`, x - 1.8, z, 0xff8a2b, -PI / 2, 1.6, 0.5);
    return dm;
  });
  function hitDummy(dm, dmg, head, pt) {
    const d = dmgNum(dmg);
    if (dps.state !== 'live') Object.assign(dps, { state: 'live', total: 0, hits: 0, heads: 0, t0: t, final: 0 });
    dps.total += d; dps.hits++; if (head) dps.heads++;
    dps.last = t; dps.lastDmg = d; dps.lastHead = head; dps.dist = dm.dist; dm.flash = 1; dm.head = head;
    burst(...hitAt(pt, dm.x, Y(1.4), dm.z), head ? 0xffd23f : 0xff7a3a, head ? 14 : 8, 3, 1.5);
    api.rangeHits++;
    if (hooks.onRangeHit) hooks.onRangeHit(head);
  }
  const dpsNow = () => (dps.state === 'live' ? dps.total / Math.max(1, t - dps.t0) : dps.final);
  const dpsScreen = screen(9, 4.2, 800, (g, w, h) => {
    frame(g, w, h, 0xff8a2b);
    txt(g, 'DPS LAB', w / 2, h * 0.12, h * 0.1, '#fff');
    if (dps.state === 'idle') {
      txt(g, 'shoot a dummy', w / 2, h * 0.45, h * 0.14, '#cfd8e3', 'center', 700);
      txt(g, saved.dps ? `RECORD ${saved.dps} DPS` : 'test any weapon · heads count', w / 2, h * 0.75, h * 0.1, '#ffd23f');
    } else {
      txt(g, String(Math.round(dpsNow())), w * 0.3, h * 0.48, h * 0.34, dps.state === 'live' ? '#ffd23f' : '#5dff9a');
      txt(g, dps.state === 'live' ? 'DPS (live)' : 'DPS (final)', w * 0.3, h * 0.76, h * 0.08, '#9fb3c8', 'center', 600);
      txt(g, String(Math.round(dps.total)), w * 0.7, h * 0.4, h * 0.2, '#fff');
      txt(g, `total · ${dps.hits} hits · ${dps.hits ? Math.round((dps.heads / dps.hits) * 100) : 0}% head`, w * 0.7, h * 0.62, h * 0.07, '#9fb3c8', 'center', 600);
      txt(g, `last +${Math.round(dps.lastDmg)}${dps.lastHead ? ' HEAD' : ''} @ ${dps.dist} m`, w * 0.7, h * 0.8, h * 0.08, dps.lastHead ? '#ffd23f' : '#cfd8e3', 'center', 700);
    }
  }, () => `${dps.state}|${Math.round(dpsNow())}|${Math.round(dps.total)}|${dps.hits}|${saved.dps}`);
  put(dpsScreen.mesh, X(55.3), Y(6.2), Z(22), -PI / 2);
  hanging('DPS LAB', 'live damage meter', 0xff8a2b, X(19), Y(6.4), Z(22), -PI / 2, 4.2, 0.9);

  // =====================================================================================
  //  RIFT RUN: indoor climb → east gate → procedural exterior loop → finish
  // =====================================================================================
  mesh(new THREE.BoxGeometry(33, 0.02, 9.4), basic({ color: 0xff2d2d, transparent: true, opacity: 0.12 }), X(39.5), Y(0.05), Z(36), false);
  const runPads = [];
  function addRunPad(x, z, sx, sz, top, kind, floating) {
    const col = kind === 'finish' ? 0xffd23f : (kind === 'cp' || kind === 'start') ? 0x5dff9a : kind === 'beam' ? 0xff8a2b : heightColor(top);
    if (floating) {
      solid(baseM, X(x), Y(top - 0.7), Z(z), sx, 0.7, sz, 1.5);
      glow(col, X(x), Y(top - 0.72), Z(z), sx - 0.6, 0.04, sz - 0.6);
    } else solid(baseM, X(x), Y(0), Z(z), sx, top, sz, 1.5);
    glow(col, X(x), Y(top + 0.02), Z(z), sx - 0.3, 0.04, sz - 0.3);
    const pd = { i: runPads.length, x, z, sx, sz, top, kind, cp: kind === 'cp' || kind === 'start' || kind === 'finish' };
    if (pd.cp && kind !== 'start') glow(col, X(x), Y(top + 1.6), Z(z), 0.12, 3, 0.12);
    runPads.push(pd);
    return pd;
  }
  RUN_INDOOR.forEach(([x, z, s, top], i) => addRunPad(x, z, s, s, top, i === 0 ? 'start' : 'pad', false));
  addRunPad(60.2, 35, 4, 4, 4.0, 'cp', true); // landing just outside the gate
  (function generate() {
    const rnd = mulberry(RUN_TUNE.seed);
    let n = 0, top = 4.0;
    const seg = (ax, dir, line, cur0, to) => {
      let cur = cur0;
      while ((to - cur) * dir > 0) {
        n++;
        const late = clamp(n / 45, 0, 1);
        let kind = 'pad', across = 1.5 + rnd() * 1.0 - late * 0.3, along = across;
        let gap = (1.4 + rnd() * (0.9 + late * 0.5)) * RUN_TUNE.gap, lat = (rnd() * 2 - 1) * (1.2 + late * 0.8);
        if (n % 12 === 0) { kind = 'cp'; across = along = 3.4; gap = 1.6 * RUN_TUNE.gap; lat = 0; }
        else if (n % 9 === 0) { kind = 'beam'; across = 1.1; along = 4.6 + rnd(); lat *= 0.4; }
        else if (n % 7 === 0) { across = along = 1.2; }
        let dh = clamp((rnd() - 0.42) * 2.2, -1.8, 0.9 * RUN_TUNE.rise);
        if (kind === 'cp') dh = 0;
        top = clamp(top + dh, 2.8, 12.5);
        const c = cur + dir * (gap + along / 2);
        const [x, z, sx, sz] = ax === 'z' ? [line + lat, c, across, along] : [c, line + lat, along, across];
        addRunPad(x, z, sx, sz, top, kind, true);
        cur = c + (dir * along) / 2;
      }
      return cur;
    };
    let cur = seg('z', -1, 63, 33, -44);                     // north along the east face
    const cz = cur - 1.8 - 2;
    addRunPad(63, cz, 4, 4, top, 'cp', true);                // corner checkpoint
    cur = seg('x', -1, cz, 61, -38);                         // west along the north face
    addRunPad(cur - 1.8 - 2.5, cz, 5, 5, top, 'finish', true);
  })();
  const finPad = runPads[runPads.length - 1];
  const finRing = mesh(new THREE.TorusGeometry(1.8, 0.06, 8, 40), bm(0xffd23f), X(finPad.x), Y(finPad.top + 2.4), Z(finPad.z), false);
  finRing.rotation.x = PI / 2;
  mesh(new THREE.CylinderGeometry(1.6, 1.6, 14, 16, 1, true), basic({ color: 0xffd23f, transparent: true, opacity: 0.08, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), X(finPad.x), Y(finPad.top + 7), Z(finPad.z), false);
  put(sign('FINISH', 'nice run, operator', 4.4, 0.9, 0xffd23f), X(finPad.x), Y(finPad.top + 4.4), Z(finPad.z), PI / 2);
  // exit gate dressing
  glow(accB, X(55.42), Y(7.65), Z(35), 0.1, 0.12, 4.2); glow(accB, X(55.42), Y(5.8), Z(33), 0.1, 3.6, 0.12); glow(accB, X(55.42), Y(5.8), Z(37), 0.1, 3.6, 0.12);
  put(sign('RIFT RUN', 'exit · keep climbing', 3.6, 0.8, 0x5dff9a), X(55.35), Y(8.4), Z(35), -PI / 2);
  const runScreen = screen(5.4, 1.5, 640, (g, w, h) => {
    frame(g, w, h, 0x5dff9a);
    txt(g, 'RIFT RUN', w * 0.3, h * 0.36, h * 0.3, '#fff');
    txt(g, saved.run ? `BEST ${saved.run.toFixed(2)}s` : 'NO TIME YET', w * 0.72, h * 0.36, h * 0.22, '#5dff9a');
    txt(g, `${runPads.length} pads · climb · exit east · wrap the outside`, w / 2, h * 0.78, h * 0.12, '#9fb3c8', 'center', 600);
  }, () => String(saved.run));
  put(runScreen.mesh, X(30), Y(7.5), Z(39.35), PI);
  const onPad = (pd, p) => Math.abs(p.x - X(pd.x)) < pd.sx / 2 + 0.15 && Math.abs(p.z - Z(pd.z)) < pd.sz / 2 + 0.15 && Math.abs(p.y - Y(pd.top)) < 0.8;
  function teleport(p, x, y, z) {
    if (hooks.teleport) { hooks.teleport(x, y, z); return true; }
    try {
      p.x = x; p.y = y; p.z = z;
      for (const k of ['vx', 'vy', 'vz']) if (k in p) p[k] = 0;
      if (p.vel && typeof p.vel === 'object') { p.vel.x = 0; p.vel.y = 0; p.vel.z = 0; }
      return true;
    } catch (_) { return false; }
  }
  function updateRun(dt, p) {
    if (run.grace > 0) run.grace -= dt;
    if (run.state === 'running') {
      run.t += dt;
      for (const pd of runPads) {
        if (!onPad(pd, p)) continue;
        run.prog = Math.max(run.prog, pd.i);
        if (pd.cp && pd.i > run.cp.i) { run.cp = pd; if (pd.kind !== 'finish') note('Checkpoint', `pad ${pd.i}/${runPads.length - 1}`); }
        if (pd.kind === 'finish') {
          const isBest = !saved.run || run.t < saved.run;
          if (isBest) { saved.run = +run.t.toFixed(2); store.set('runBest', saved.run); }
          run.state = 'done'; run.doneT = 2.5;
          burst(X(pd.x), Y(pd.top + 1.2), Z(pd.z), 0xffd23f, 50, 6, 4);
          note(`Rift Run: ${run.t.toFixed(2)}s · ${run.falls} falls`, isBest ? 'NEW BEST!' : `best ${saved.run.toFixed(2)}s`);
        }
        break;
      }
      if (run.state === 'running' && onPad(runPads[0], p) && run.prog <= 2) run.state = 'idle';
      else if (run.state === 'running' && run.grace <= 0 && p.y < Y(0.55)) {
        if (t - run.lastFail < 2.5) { run.state = 'idle'; note('Run ended', 'walk back to the start pad'); return; }
        run.lastFail = t; run.falls++;
        const cp = run.cp;
        if (teleport(p, X(cp.x), Y(cp.top) + 0.15, Z(cp.z))) { run.grace = 1; note('Fell!', 'back to your checkpoint'); }
        else { run.state = 'idle'; note('You fell', 'walk back to the start pad'); }
      }
    } else if (run.state === 'done') {
      if ((run.doneT -= dt) <= 0) {
        run.state = 'idle';
        const s0 = runPads[0];
        teleport(p, X(s0.x), Y(s0.top) + 0.15, Z(s0.z));
      }
    } else if (onPad(runPads[1], p)) {
      Object.assign(run, { state: 'running', t: 0, prog: 1, cp: runPads[0], falls: 0, grace: 0, lastFail: -99 });
    }
  }

  // =====================================================================================
  //  LOUNGE deck, ramp, trophy monoliths
  // =====================================================================================
  const DECK_TOP = 4.4;
  solid(baseM, X(-15), Y(4.0), Z(34.75), 42, 0.4, 10.5, 4);
  for (const sx of [-33, -21, -9, 3]) solid(darkM, X(sx), Y(0), Z(30.2), 0.8, 4.0, 0.8, 1);
  solid(glassM, X(-15), Y(DECK_TOP), Z(29.7), 42, 1.1, 0.12, 4);
  solid(glassM, X(-36), Y(DECK_TOP), Z(34.75), 0.12, 1.1, 10.5, 4);
  glow(accA, X(-15), Y(4.2), Z(29.55), 42, 0.06, 0.06);
  addRamp(X(14), Z(36.2), 16, 4.6, Y(0), Y(DECK_TOP), 2);
  const rampMesh = mesh(wedgeGeo(16, 4.6, DECK_TOP), rampM, X(14), Y(0), Z(36.2)); rampMesh.rotation.y = PI;
  glow(accB, X(6.05), Y(DECK_TOP + 0.03), Z(36.2), 0.1, 0.05, 4.6);
  const sofaM = std({ color: 0x1f2a38, roughness: 0.8 });
  for (const sx of [-30, -20, -10]) { // sofas face the south window
    box(sofaM, X(sx), Y(DECK_TOP + 0.3), Z(36.6), 3.2, 0.6, 1.2); box(sofaM, X(sx), Y(DECK_TOP + 0.85), Z(35.9), 3.2, 0.9, 0.25);
    glow(accA, X(sx), Y(DECK_TOP + 0.02), Z(36.6), 3.0, 0.03, 0.9);
  }
  for (const sx of [-25, -15]) { box(darkM, X(sx), Y(DECK_TOP + 0.3), Z(38.4), 1.4, 0.15, 1.0); glow(accB, X(sx), Y(DECK_TOP + 0.4), Z(38.4), 1.2, 0.03, 0.8); }
  hanging('LOUNGE', 'records · rewards · rest', 0x2fb7ff, X(-15), Y(9.6), Z(29.4), PI, 5.6, 1.1);
  [
    [-28, 0xffd23f, () => ({ title: 'REFLEX BEST', big: String(saved.reflex), sub: '30s gallery run' })],
    [-20, 0x5dff9a, () => ({ title: 'RIFT RUN BEST', big: saved.run ? saved.run.toFixed(2) + 's' : '—', sub: 'parkour time' })],
    [-12, 0xff8a2b, () => ({ title: 'DPS RECORD', big: String(saved.dps), sub: 'DPS lab' })],
    [-4, 0xb56bff, () => ({ title: 'SECRETS', big: `${saved.secrets.size}/${SECRET_TOTAL}`, sub: saved.secrets.size >= 5 ? 'the annex is open' : 'look closer' })],
  ].forEach(([mx, col, fn]) => {
    solid(darkM, X(mx), Y(DECK_TOP), Z(31.2), 3.4, 0.5, 0.7, 1);
    put(statScreen(3.4, 2.3, col, fn).mesh, X(mx), Y(DECK_TOP + 1.9), Z(31.2), PI);
  });
  const duck = new THREE.Group(); duck.position.set(X(-34.4), Y(DECK_TOP + 0.2), Z(31.2)); root.add(duck);
  const duckM = std({ color: 0xffd23f, roughness: 0.5 });
  const dBody = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), duckM); dBody.scale.set(1.2, 0.9, 1); duck.add(dBody);
  const dHead = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), duckM); dHead.position.set(0.2, 0.2, 0); duck.add(dHead);
  const dBeak = new THREE.Mesh(unit, std({ color: 0xff8a2b })); dBeak.scale.set(0.12, 0.04, 0.08); dBeak.position.set(0.33, 0.18, 0); duck.add(dBeak);

  // =====================================================================================
  //  SECRETS
  // =====================================================================================
  function found(id, label, sub) {
    if (saved.secrets.has(id)) return false;
    saved.secrets.add(id); store.set('secrets', [...saved.secrets]);
    note(label, sub || `secrets ${saved.secrets.size}/${SECRET_TOTAL}`);
    if (hooks.onSecret) hooks.onSecret(id);
    return true;
  }
  // props that hide things
  const crate = (x, z, s, y0 = 0, h = s) => { solid(crateM, X(x), Y(y0), Z(z), s, h, s, 1); glow(accB, X(x), Y(y0 + h * 0.5), Z(z), s + 0.02, 0.05, s + 0.02); };
  crate(51.5, -38.4, 2.2); crate(51.5, -35.9, 1.6, 0, 1.6); crate(51.5, -38.4, 1.5, 2.2); crate(-52.5, -35.2, 1.4);
  solid(darkM, X(70), Y(0), Z(30), 1.2, 8, 1.2, 1); glow(accA, X(70), Y(8.05), Z(30), 1.4, 0.1, 1.4); // pillar outside the gate

  const shards = [];
  const shardCount = () => shards.filter((s) => s.found).length;
  [['s1', -36, 13.45, -10], ['s2', -15, 3.4, 30.3], ['s3', 54.2, 0.9, -38.4], ['s4', -41.8, 5.95, -38.4], ['s5', 70, 8.7, 30]].forEach(([id, sx, sy, sz], i) => {
    const m = mesh(new THREE.OctahedronGeometry(0.28, 0), basic({ color: 0x9fe8ff, transparent: true, opacity: 0.7 }), X(sx), Y(sy), Z(sz), false);
    m.add(new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 10), basic({ color: 0x9fe8ff, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false })));
    const col = addCollider(X(sx), Z(sz), 0.7, Y(sy + 0.4), 0.7, { y0: Y(sy - 0.4), noCover: true });
    const s = { id, m, col, clue: KEY_CLUES[i], found: saved.secrets.has(id), phase: Math.random() * PI * 2, spk: Math.random() };
    if (s.found) { m.visible = false; setColliderActive(col, false); }
    col.onShot = () => {
      if (s.found) return;
      s.found = true; m.visible = false; setColliderActive(col, false);
      burst(m.position.x, m.position.y, m.position.z, 0x9fe8ff, 30, 5, 2);
      found(id, 'RIFT KEY FOUND', `${shardCount()}/5 keys`);
      if (shardCount() >= 5) { door.tgt = 1; note('A door hums open somewhere…', 'the maintenance annex'); }
    };
    shards.push(s);
  });
  const gold = mesh(new THREE.CircleGeometry(0.34, 24), basic({ map: goldTex }), X(55.35), Y(7.5), Z(11.5), false);
  gold.rotation.y = -PI / 2;
  const goldCol = addCollider(X(55.2), Z(11.5), 0.3, Y(7.9), 0.7, { y0: Y(7.1), noCover: true });
  if (saved.secrets.has('gold')) { gold.visible = false; setColliderActive(goldCol, false); }
  goldCol.onShot = () => {
    if (saved.secrets.has('gold')) return;
    gold.visible = false; setColliderActive(goldCol, false);
    burst(X(55.2), Y(7.5), Z(11.5), 0xffd23f, 30, 5, 2);
    found('gold', 'GOLDEN TARGET', `secrets ${saved.secrets.size + 1}/${SECRET_TOTAL}`);
  };
  solid(darkM, X(-54.4), Y(0), Z(-38.6), 1.2, 1.1, 0.9, 1); glow(0x3dff9a, X(-54.4), Y(0.8), Z(-38.13), 0.9, 0.5, 0.03);
  let termI = 0;
  act({
    x: X(-54.2), z: Z(-37.0), r: 1.7,
    prompt: () => ({ text: 'E — dusty terminal', sub: '', progress: 0 }),
    run: () => { note(TERMINAL_LINES[termI++ % TERMINAL_LINES.length], ''); found('terminal', 'TERMINAL ACCESSED', `secrets ${saved.secrets.size + 1}/${SECRET_TOTAL}`); return null; },
  });
  act({
    x: X(-34.4), z: Z(31.2), r: 1.6, y: DECK_TOP,
    prompt: () => ({ text: 'E — squeak', sub: '', progress: 0 }),
    run: () => { burst(X(-34.4), Y(DECK_TOP + 0.5), Z(31.2), 0xffd23f, 12, 2.5, 2.5); if (!found('duck', 'SQUEAK.', `secrets ${saved.secrets.size + 1}/${SECRET_TOTAL}`)) note('squeak.', ''); return null; },
  });

  // ---------- maintenance annex (vault) ----------
  const VX = -46;
  solid(darkM, X(-52.55), Y(0), Z(25.6), 8.9, 6.5, 0.8, 2);
  solid(darkM, X(-40.65), Y(0), Z(25.6), 6.5, 6.5, 0.8, 2);
  solid(darkM, X(VX), Y(4.6), Z(25.6), 4.2, 1.9, 0.8, 2);
  solid(darkM, X(-37.4), Y(0), Z(32.8), 0.8, 6.5, 15.2, 2);
  solid(ceilM, X(-47), Y(6.5), Z(32.8), 20, 0.5, 15.2, 4);
  const vaultFloor = mesh(new THREE.PlaneGeometry(18.8, 14.4), std({ color: 0x2a2210, metalness: 0.9, roughness: 0.3, emissive: 0x2a1c00 }), X(-46.6), Y(0.03), Z(32.8));
  vaultFloor.rotation.x = -PI / 2;
  glow(0xffc247, X(-46.6), Y(0.06), Z(39.3), 18, 0.05, 0.1); glow(0xffc247, X(-55.2), Y(0.06), Z(32.8), 0.1, 0.05, 14);
  put(sign('MAINTENANCE', 'AUTHORISED ACCESS ONLY', 4.6, 0.8, 0xff6b4a), X(VX), Y(5.6), Z(25.18), PI); // faces the hall (north)
  const doorM = mesh(boxGeo(4.2, 4.6, 0.5, 2), darkM, X(VX), Y(2.3), Z(25.6));
  const door = { m: doorM, col: addCollider(X(VX), Z(25.6), 4.2, Y(4.6), 0.5, { y0: Y(0), noCover: true }), amt: 0, tgt: 0 };
  const nextClue = () => { const un = shards.filter((s) => !s.found); return un.length ? un[Math.floor(t / 4) % un.length].clue : ''; };
  const doorScreen = screen(3.8, 2.4, 512, (g, w, h) => {
    const open = shardCount() >= 5;
    frame(g, w, h, open ? 0xffc247 : 0xff4a4a);
    txt(g, open ? 'ACCESS GRANTED' : 'ACCESS DENIED', w / 2, h * 0.2, h * 0.12, open ? '#ffc247' : '#ff6b6b');
    txt(g, `KEYS ${shardCount()}/5`, w / 2, h * 0.46, h * 0.24, '#fff');
    g.fillStyle = '#9fb3c8'; g.font = `600 ${h * 0.075}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    wrap(g, open ? 'welcome back, operator' : nextClue(), w / 2, h * 0.74, h * 0.1, w - 80, 2);
  }, () => `${shardCount()}|${Math.floor(t / 4)}`);
  doorScreen.mesh.position.set(0, 0.2, -0.27); doorScreen.mesh.rotation.y = PI; doorM.add(doorScreen.mesh); // north face
  if (shardCount() >= 5) { door.amt = door.tgt = 1; doorM.position.y = Y(2.3) + 4.4; setColliderActive(door.col, false); }
  act({
    x: X(VX), z: Z(22), r: 3.5,
    prompt: () => (shardCount() >= 5 ? { text: 'Maintenance annex — open', sub: '', progress: 0 } : { text: `Maintenance annex — keys ${shardCount()}/5`, sub: nextClue(), progress: 0 }),
  });
  solid(baseM, X(VX), Y(0), Z(32.8), 3.0, 0.6, 3.0, 1.5);
  const goldHolder = new THREE.Group(); goldHolder.position.set(X(VX), Y(2.2), Z(32.8)); root.add(goldHolder);
  const relicRing = mesh(new THREE.TorusGeometry(1.6, 0.04, 10, 56), bm(0xffc247), X(VX), Y(2.2), Z(32.8));
  const relic = mesh(new THREE.OctahedronGeometry(0.4, 0), goldM, X(VX), Y(4.2), Z(32.8));
  put(sign('YOUR PRIMARY — IN GOLD', 'for those who looked up', 5.6, 0.9, 0xffc247), X(VX), Y(5.4), Z(32.8), PI);
  [['LOG 001', 'The hall was built first. The map came after.', 28.5], ['LOG 002', 'Every portal remembers who walked through it.', 32.8], ['LOG 003', 'Five keys. Most operators never look up.', 37]].forEach(([title, body, lz]) => {
    const s = screen(3.6, 2.2, 384, (g, w, h) => {
      frame(g, w, h, 0xffc247); txt(g, title, w / 2, h * 0.2, h * 0.11, '#ffc247');
      g.fillStyle = '#cfd8e3'; g.font = `600 ${h * 0.085}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      wrap(g, body, w / 2, h * 0.45, h * 0.12, w - 70, 4);
    });
    put(s.mesh, X(-55.2), Y(3.2), Z(lz), PI / 2);
  });
  box(darkM, X(-53.5), Y(0.6), Z(37.9), 1.8, 1.2, 0.9); glow(accA, X(-53.5), Y(1.25), Z(37.9), 1.5, 0.04, 0.7);
  act({
    x: X(-53.5), z: Z(37.0), r: 2.2,
    prompt: () => ({ text: `E — Lobby theme: ${THEMES[(saved.theme + 1) % THEMES.length].name}`, sub: `current: ${THEMES[saved.theme].name}`, progress: 0 }),
    run: () => { saved.theme = (saved.theme + 1) % THEMES.length; store.set('theme', saved.theme); applyTheme(); note(`Theme: ${THEMES[saved.theme].name}`, 'the whole lobby follows'); return null; },
  });
  function applyTheme() {
    const th = THEMES[saved.theme];
    accA.color.setHex(th.a); accB.color.setHex(th.b); floorM.emissive.setHex(th.a); holoM.color.setHex(th.a);
  }
  function rebuildGold() {
    goldHolder.clear();
    const d = defOf('main', loadout.main);
    if (d) goldHolder.add(getModel(d, 1.3, 'g:', goldM));
  }

  // ---------- lanterns (shootable ambience) ----------
  const orbs = Array.from({ length: 14 }, (_, i) => {
    let ox, oz;
    do { ox = -48 + Math.random() * 96; oz = -32 + Math.random() * 62; } while ((ox < -36 && oz > 24) || (Math.abs(ox) < 15 && oz > -27 && oz < 13 && false));
    const oy = 7 + Math.random() * 4.5, color = i % 2 ? THEMES[0].a : THEMES[0].b;
    const m = mesh(new THREE.SphereGeometry(0.17 + Math.random() * 0.1, 12, 12), basic({ color, transparent: true, opacity: 0.6 }), X(ox), Y(oy), Z(oz), false);
    const col = addCollider(X(ox), Z(oz), 0.7, Y(oy + 0.5), 0.7, { y0: Y(oy - 0.5), noCover: true });
    const o = { m, col, baseY: Y(oy), phase: Math.random() * PI * 2, speed: 0.4 + Math.random() * 0.6, color, respawn: 0 };
    col.onShot = () => {
      if (o.respawn > 0) return;
      o.respawn = 9; m.visible = false; setColliderActive(col, false);
      burst(m.position.x, m.position.y, m.position.z, color, 16, 3.5, 1);
      saved.orbs++; store.set('orbs', saved.orbs);
    };
    return o;
  });

  // ---------- state refresh ----------
  function refresh() {
    refreshRings(); rebuildOrbit(); rebuildGold();
    inspScreen.mark();
  }
  bays.forEach((b) => setPage(b, 0));
  applyTheme(); refresh();

  const portalAt = (p) => portals.find((q) => Math.abs(p.x - q.x) < 3.2 && p.z < Z(-L.d / 2 + 4.5) && Math.abs(p.y - Y(0)) < 2.5);

  function handle(dt, p, interact) {
    const pt = portalAt(p);
    if (pt) {
      hold += dt; pt.tgt = clamp(hold / HOLD, 0, 1);
      prompt = { text: `E — Play ${pt.mode.name}`, sub: pt.mode.short, progress: pt.tgt };
      if (interact || hold >= HOLD) { hold = 0; burst(pt.x, Y(2.5), pt.z + 1, pt.color, 30, 5, 3); return { type: 'portal', mode: pt.id }; }
      return null;
    }
    hold = 0;
    updateRun(dt, p);
    let best = null, bd = Infinity;
    for (const a of acts) {
      if (a.off && a.off()) continue;
      if (Math.abs(p.y - Y(a.y)) > 2.4) continue;
      const dx = a.x - p.x, dz = a.z - p.z, d2 = dx * dx + dz * dz;
      if (d2 > a.r * a.r || d2 >= bd) continue;
      bd = d2; best = a;
    }
    let result = null;
    if (best) {
      prompt = best.prompt();
      if (best.stand) { inspect.want = true; inspect.s = best.stand; }
      if (interact && best.run) result = best.run();
    }
    if (run.state === 'running') prompt = { text: `RIFT RUN  ${run.t.toFixed(1)}s  ·  pad ${run.prog}/${runPads.length - 1}`, sub: `falls ${run.falls}${saved.run ? ` · best ${saved.run.toFixed(2)}s` : ''}`, progress: 0 };
    else if (!prompt && p.x > X(16) && p.z < Z(31) && Math.abs(p.x - X(0)) < 56) prompt = { text: 'Shooting Range', sub: `Hits ${api.rangeHits} · Lanterns popped ${saved.orbs}`, progress: 0 };
    return result;
  }

  function update(dt, p, interact) {
    t += dt;
    for (const q of portals) q.tgt = 0;
    inspect.want = false;
    prompt = null;
    let result = null;
    if (active && p && p.alive) result = handle(dt, p, interact);
    else { hold = 0; if (run.state === 'running') run.state = 'idle'; }
    if (toastT > 0) { toastT -= dt; if (toastT > 0 && toast) prompt = { text: toast.text, sub: toast.sub, progress: 0 }; }

    // --- ambience ---
    for (const q of portals) {
      q.boost += (q.tgt - q.boost) * (1 - Math.exp(-6 * dt));
      q.swirl.rotation.z += dt * 0.55 * q.dir * (1 + q.boost * 3);
      q.halo.scale.setScalar(1 + Math.sin(t * 2 + q.x) * 0.02 + q.boost * 0.12);
    }
    if (Math.random() < dt * 4) {
      const q = portals[(Math.random() * portals.length) | 0];
      spark(q.x + (Math.random() - 0.5) * 3, Y(0.6), q.z + 0.7, 0, 1.2 + Math.random(), 0, q.color, 1.6, 0, 0.9);
    }
    holo.rotation.y = t * 0.55; holo.rotation.x = Math.sin(t * 0.35) * 0.2; core.rotation.y = -t * 1.1;
    orbitA.rotation.x = t * 0.35; orbitA.rotation.y = t * 0.22; orbitB.rotation.z = -t * 0.4;
    orbitG.rotation.y = t * 0.45;
    orbitSlots.forEach((g, i) => {
      const a = (i / 4) * PI * 2;
      g.position.set(Math.cos(a) * 2.7, Math.sin(t * 0.9 + i * 1.7) * 0.18, Math.sin(a) * 2.7);
      g.rotation.y = t * 0.8 + i;
    });
    relicRing.rotation.x = t * 0.5; relicRing.rotation.z = t * 0.3; relic.rotation.y = t * 0.9; goldHolder.rotation.y = t * 0.6;
    finRing.rotation.z = t * 1.2;
    shaft.material.opacity = 0.045 + Math.sin(t * 0.6) * 0.012;
    ringA.rotation.z = t * 0.02; ringB.rotation.z = 0.3 - t * 0.03;
    beacons.forEach((b, i) => { b.material.opacity = 0.35 + 0.65 * Math.max(0, Math.sin(t * 2 + i * 1.6)); });
    for (const s of stands) {
      if (!s.def) continue;
      if (s.pop < 1) { s.pop = Math.min(1, s.pop + dt * 3); const k = 1 + 2.7 * (s.pop - 1) ** 3 + 1.7 * (s.pop - 1) ** 2; s.holder.scale.setScalar(Math.max(0.001, k)); }
      s.holder.rotation.y = t * 0.7 + s.phase;
      s.holder.position.y = Y(1.65) + Math.sin(t * 1.5 + s.phase) * 0.06;
    }
    for (const o of orbs) {
      if (o.respawn > 0) { o.respawn -= dt; if (o.respawn <= 0) { o.m.visible = true; setColliderActive(o.col, true); burst(o.m.position.x, o.m.position.y, o.m.position.z, o.color, 6, 1.5, 0.5); } continue; }
      o.m.position.y = o.baseY + Math.sin(t * o.speed + o.phase) * 0.12;
    }
    for (const s of shards) {
      if (s.found) continue;
      s.m.rotation.y = t * 0.8 + s.phase; s.m.material.opacity = 0.5 + 0.3 * Math.sin(t * 2 + s.phase);
      if ((s.spk -= dt) <= 0) { s.spk = 0.6 + Math.random() * 0.8; spark(s.m.position.x + (Math.random() - 0.5) * 0.4, s.m.position.y + (Math.random() - 0.5) * 0.4, s.m.position.z + (Math.random() - 0.5) * 0.4, 0, 0.5, 0, 0xdff6ff, 1.1, 0, 1.6); }
    }
    for (const g of flips) {
      if (g.down && (g.timer -= dt) <= 0) { g.down = false; setColliderActive(g.col, true); }
      g.amt += ((g.down ? 1 : 0) - g.amt) * (1 - Math.exp(-12 * dt));
      g.hinge.rotation.z = -g.amt * (PI / 2);
    }
    if (gal.done > 0) gal.done -= dt;
    if (gal.on) {
      gal.elapsed += dt; gal.left -= dt; gal.spawn -= dt;
      if (gal.spawn <= 0) {
        const free = galSlots.filter((s) => !s.up);
        if (free.length && galSlots.length - free.length < 3) {
          const s = free[(Math.random() * free.length) | 0];
          s.up = true; s.kind = Math.random() < 0.22 ? 'friend' : 'foe';
          s.mat.map = s.kind === 'foe' ? foeTex : friendTex; s.mat.needsUpdate = true;
          s.ttl = Math.max(0.9, 1.9 - gal.elapsed * 0.03); setColliderActive(s.col, true);
        }
        gal.spawn = Math.max(0.35, 0.95 - gal.elapsed * 0.015);
      }
      for (const s of galSlots) if (s.up && (s.ttl -= dt) <= 0) { s.up = false; setColliderActive(s.col, false); if (s.kind === 'foe') gal.combo = 0; }
      if (gal.left <= 0) endGallery();
    }
    for (const s of galSlots) {
      s.amt += ((s.up ? 0 : 1) - s.amt) * (1 - Math.exp(-14 * dt));
      s.hinge.rotation.z = -s.amt * (PI / 2);
    }
    if (dps.state === 'live' && t - dps.last > 3) {
      dps.state = 'final'; dps.dur = Math.max(1, dps.last - dps.t0); dps.final = dps.total / dps.dur;
      if (dps.hits > 2 && dps.final > saved.dps) { saved.dps = Math.round(dps.final); store.set('dpsBest', saved.dps); note('New DPS record', `${saved.dps} DPS`); }
    }
    for (const dm of dummies) {
      dm.flash = Math.max(0, dm.flash - dt * 5);
      const f = dm.flash;
      dm.bodyM.emissive.setRGB(f * 0.9, f * (dm.head ? 0.6 : 0.2), 0); dm.headM.emissive.setRGB(f * 0.9, f * 0.6, 0);
    }
    if (door.amt !== door.tgt) {
      door.amt += Math.sign(door.tgt - door.amt) * Math.min(Math.abs(door.tgt - door.amt), dt * 0.5);
      door.m.position.y = Y(2.3) + 4.4 * door.amt;
      if (door.amt > 0.55) setColliderActive(door.col, false);
    }
    for (const s of sparks) {
      if (!s.m.visible) continue;
      s.life -= dt;
      if (s.life <= 0) { s.m.visible = false; continue; }
      s.vy -= s.g * dt;
      s.m.position.x += s.vx * dt; s.m.position.y += s.vy * dt; s.m.position.z += s.vz * dt;
      s.m.scale.setScalar(Math.max(0.01, s.size * (s.life / s.max)));
    }
    inspect.a += ((inspect.want ? 1 : 0) - inspect.a) * (1 - Math.exp(-10 * dt));
    const im = inspScreen.mesh;
    im.visible = inspect.a > 0.02 && !!inspect.s;
    if (im.visible) {
      im.position.set(inspect.s.x, Y(4.15) + Math.sin(t * 1.3) * 0.05, inspect.s.z);
      if (p) im.rotation.y = Math.atan2(p.x - inspect.s.x, p.z - inspect.s.z);
      inspScreen.mat.opacity = inspect.a;
    }
    screenT += dt;
    if (screenT > 0.08) {
      screenT = 0;
      for (const s of screens) {
        if (s.sig) { const v = s.sig(); if (v !== s.last) { s.last = v; s.dirty = true; } }
        if (s.dirty) s.redraw();
      }
    }
    return result;
  }

  Object.assign(api, {
    group: root,
    spawn: LOBBY_SPAWN,
    update,
    refresh,
    setActive(on) { active = !!on; root.visible = !!on; hold = 0; },
    enableDevPortal,
    get prompt() { return prompt; },
  });
  return api;
}
