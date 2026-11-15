/**
 * Global leaderboards in the lobby: four wall panels on the west wall, above the armory rows.
 * Each panel cycles through its boards every 10 s; shoot a panel to flip it. Data: GET /api/lb (lib/account.js).
 */
import * as THREE from 'three';
import { addCollider } from './collision.js';
import { LOBBY } from './lobby.js';
import { fetchBoards, getUser, onAccountChange } from './account.js';

const PI = Math.PI;
const num = (v) => Number(v).toLocaleString();
const BOARD = {
  run: { title: 'RIFT RUN', sub: 'fastest clear', color: 0x5dff9a, fmt: (v) => (v / 1000).toFixed(2) + 's' },
  reflex: { title: 'REFLEX GALLERY', sub: 'best 30s score', color: 0xff5a4a, fmt: (v) => num(v) + ' pts' },
  dps: { title: 'DPS LAB', sub: 'highest damage per second', color: 0xff8a2b, fmt: (v) => num(v) + ' dps' },
  kills: { title: 'MOST KILLS', sub: 'player kills, all time', color: 0xffc247, fmt: num },
  headshots: { title: 'HEADSHOTS', sub: 'all time', color: 0xff4a5e, fmt: num },
  streak: { title: 'BEST STREAK', sub: 'kills without dying', color: 0xb56bff, fmt: num },
  wins: { title: 'MATCH WINS', sub: 'online matches won', color: 0x4aa8ff, fmt: num },
  botKills: { title: 'BOT SLAYERS', sub: 'bot arena kills', color: 0x3dff9a, fmt: num },
  secrets: { title: 'SECRET HUNTERS', sub: 'lobby secrets found', color: 0x2fb7ff, fmt: (v) => v + ' / 8' },
  classified: { title: 'CLASSIFIED', sub: 'files recovered', color: 0xe84a4a, fmt: (v) => v + ' / 8' },
};
// z = local lobby z of the panel centre (the gaps between the west wall columns, same rows as the armory)
const PANELS = [
  { z: -22, title: 'TIME TRIALS', keys: ['run', 'reflex', 'dps'] },
  { z: -10, title: 'FRAG LEADERS', keys: ['kills', 'headshots', 'streak'] },
  { z: 2, title: 'MATCHES & ARENA', keys: ['wins', 'botKills'] },
  { z: 14, title: 'COLLECTORS', keys: ['secrets', 'classified'] },
];
const PANEL_Y = 6.7; // local height of the panel centre (windows start at 9)
const RANK = ['#ffd23f', '#d6dde6', '#e0925a'];

const hex = (n) => '#' + n.toString(16).padStart(6, '0');
function text(g, s, x, y, size, color, align = 'center', weight = 800, maxW) {
  g.textAlign = align; g.textBaseline = 'middle'; g.fillStyle = color;
  g.font = `${weight} ${size}px system-ui, sans-serif`;
  if (maxW) g.fillText(s, x, y, maxW); else g.fillText(s, x, y);
}

function drawPanel(g, W, H, p, data, state, me) {
  const B = BOARD[p.keys[p.idx % p.keys.length]], c = hex(B.color);
  g.clearRect(0, 0, W, H);
  const grd = g.createLinearGradient(0, 0, 0, H);
  grd.addColorStop(0, 'rgba(10,14,22,0.94)'); grd.addColorStop(1, 'rgba(6,10,16,0.97)');
  g.fillStyle = grd; g.fillRect(0, 0, W, H);
  g.strokeStyle = c; g.lineWidth = 6; g.strokeRect(6, 6, W - 12, H - 12);
  g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 2; g.strokeRect(16, 16, W - 32, H - 32);
  text(g, B.title, 44, 58, 46, '#fff', 'left', 900);
  text(g, B.sub.toUpperCase(), W - 44, 58, 22, c, 'right', 700);
  g.fillStyle = c; g.fillRect(44, 90, W - 88, 3);

  const rows = (data && data[p.keys[p.idx % p.keys.length]]) || [];
  if (!rows.length) {
    const msg = state === 'offline' ? 'LEADERBOARD OFFLINE' : state === 'loading' ? 'LOADING…' : 'NO RECORDS YET — BE THE FIRST';
    text(g, msg, W / 2, 250, 38, '#9fb3c8', 'center', 700);
  } else {
    const colW = (W - 88 - 36) / 2, y0 = 112, rowH = 60;
    rows.slice(0, 10).forEach((r, i) => {
      const x = 44 + Math.floor(i / 5) * (colW + 36), y = y0 + (i % 5) * rowH, cy = y + rowH / 2;
      const mine = !!me && String(r.n).toLowerCase() === me;
      g.fillStyle = mine ? hex(B.color) + '33' : 'rgba(255,255,255,0.04)';
      g.fillRect(x, y + 3, colW, rowH - 6);
      if (mine) { g.fillStyle = c; g.fillRect(x, y + 3, 5, rowH - 6); }
      text(g, '#' + (i + 1), x + 38, cy, 30, RANK[i] || '#7f93a8', 'center', 900);
      text(g, String(r.n), x + 76, cy, 32, '#fff', 'left', 800, colW - 76 - 170);
      text(g, B.fmt(r.v), x + colW - 18, cy, 32, c, 'right', 900);
    });
  }
  text(g, `HALL OF RECORDS · ${p.title}`, 44, 460, 20, '#7f93a8', 'left', 700);
  const n = p.keys.length;
  p.keys.forEach((k, i) => {
    g.fillStyle = i === p.idx % n ? c : 'rgba(255,255,255,0.22)';
    g.beginPath(); g.arc(W - 44 - (n - 1 - i) * 24 - 7, 460, 7, 0, PI * 2); g.fill();
  });
  text(g, 'SHOOT TO FLIP', W - 44 - n * 24 - 10, 460, 20, '#7f93a8', 'right', 700);
}

export function createLeaderboards({ scene }) {
  const L = LOBBY, X = (v) => L.x + v, Y = (v) => L.y + v, Z = (v) => L.z + v;
  const group = new THREE.Group();
  scene.add(group);
  const W = 1280, H = 493, PW = 9.6, PH = (PW * H) / W;
  let data = null, state = 'loading', refreshT = 0, redrawT = 0, loading = false;

  const flip = (p) => { p.idx = (p.idx + 1) % p.keys.length; p.t = 0; p.dirty = true; };
  const panels = PANELS.map((def, i) => {
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(PW, PH),
      new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, side: THREE.DoubleSide }),
    );
    mesh.position.set(X(-55.3), Y(PANEL_Y), Z(def.z));
    mesh.rotation.y = PI / 2; // faces east, into the hall
    group.add(mesh);
    const p = { ...def, idx: 0, t: -i * 1.5, dirty: true, ctx: canvas.getContext('2d'), tex };
    const col = addCollider(X(-55.3), Z(def.z), 0.3, Y(PANEL_Y + PH / 2), PW, { y0: Y(PANEL_Y - PH / 2), noCover: true });
    col.onShot = () => flip(p);
    return p;
  });

  async function load() {
    if (loading) return;
    loading = true;
    try { const j = await fetchBoards(true); data = j.boards || {}; state = 'ok'; }
    catch (_) { if (!data) state = 'offline'; }
    loading = false;
    panels.forEach((p) => { p.dirty = true; });
  }
  onAccountChange(() => { refreshT = 0; panels.forEach((p) => { p.dirty = true; }); });

  return {
    group,
    update(dt, inLobby) {
      group.visible = !!inLobby;
      if (!inLobby) return;
      refreshT -= dt;
      if (refreshT <= 0) { refreshT = 60; load(); }
      for (const p of panels) {
        p.t += dt;
        if (p.t >= 10) flip(p);
      }
      redrawT -= dt;
      if (redrawT <= 0) {
        redrawT = 0.15;
        const me = (getUser() || '').toLowerCase();
        for (const p of panels) {
          if (!p.dirty) continue;
          drawPanel(p.ctx, W, H, p, data, state, me);
          p.tex.needsUpdate = true;
          p.dirty = false;
        }
      }
    },
  };
}
