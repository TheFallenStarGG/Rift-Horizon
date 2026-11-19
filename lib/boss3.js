/**
* REDACTED
*/
import * as THREE from 'three';
import { addCollider, removeCollider, resolveCircle } from './collision.js';
import { heightAt } from './ground.js';
import { SPAWNS } from './scene.js';
import { LOBBY } from './lobby.js';

const PI = Math.PI, TAU = PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);
const ease = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const outC = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const outBack = (t) => { t = clamp(t, 0, 1); return 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2); };
const prog = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > PI) d -= TAU; if (d < -PI) d += TAU; return d; };
const segDist = (px, pz, ax, az, bx, bz) => {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1, t = clamp(((px - ax) * dx + (pz - az) * dz) / l2, 0, 1);
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
};
const pick = (a) => a[(Math.random() * a.length) | 0];
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [a[i], a[j]] = [a[j], a[i]]; } return a; };

export const DEV = {
  NAME: 'THE DEV', SUB: 'ROOT ACCESS · NO PATCH NOTES',
  HP: 28000, LIVES: 2, R: 50, SKY: 240, SCALE: 3.4,
  MUSIC: 'assets/boss/dev.mp3',
};
const COL = { cyan: 0x38f2ff, violet: 0xa66bff, pink: 0xff4fd8, green: 0x4dff9a, red: 0xff4a4a, amber: 0xffc247, white: 0xffffff, blue: 0x2f7bff };
const STAGE = { 1: 0x38f2ff, 2: 0xa66bff, 3: 0xff4fd8 };

// ======================================================================
//  TEXTURES
// ======================================================================
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function makeTex() {
  const radial = (stops) => (g, w, h) => {
    const r = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    for (const [o, c] of stops) r.addColorStop(o, c);
    g.fillStyle = r; g.fillRect(0, 0, w, h);
  };
  const hex = canvasTex(256, 256, (g, w, h) => {
    g.strokeStyle = '#fff'; g.lineWidth = 2;
    const s = 22, hh = s * Math.sqrt(3);
    for (let r = -1; r < h / hh + 1; r++) for (let c = -1; c < w / (s * 1.5) + 1; c++) {
      const x = c * s * 1.5, y = r * hh + (c % 2 ? hh / 2 : 0);
      g.beginPath(); for (let i = 0; i < 6; i++) { const a = (PI / 3) * i; g.lineTo(x + Math.cos(a) * s, y + Math.sin(a) * s); } g.closePath(); g.stroke();
    }
  });
  hex.wrapS = hex.wrapT = THREE.RepeatWrapping; hex.repeat.set(4, 2);
  return {
    glow: canvasTex(128, 128, radial([[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,255,255,.55)'], [0.65, 'rgba(255,255,255,.12)'], [1, 'rgba(255,255,255,0)']])),
    ring: canvasTex(256, 256, radial([[0, 'rgba(255,255,255,0)'], [0.5, 'rgba(255,255,255,0)'], [0.86, 'rgba(255,255,255,.35)'], [0.96, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']])),
    wall: canvasTex(8, 128, (g, w, h) => {
      const r = g.createLinearGradient(0, h, 0, 0);
      r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.15, 'rgba(255,255,255,.7)'); r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r; g.fillRect(0, 0, w, h);
    }),
    disc: canvasTex(256, 256, (g, w, h) => {
      g.translate(w / 2, h / 2);
      g.fillStyle = 'rgba(255,255,255,.10)'; g.beginPath(); g.arc(0, 0, 120, 0, TAU); g.fill();
      g.strokeStyle = '#fff'; g.lineWidth = 6; g.beginPath(); g.arc(0, 0, 122, 0, TAU); g.stroke();
      g.lineWidth = 2; g.beginPath(); g.arc(0, 0, 104, 0, TAU); g.stroke();
      g.fillStyle = '#fff';
      for (let i = 0; i < 12; i++) { g.save(); g.rotate((i * TAU) / 12); g.fillRect(-3, 96, 6, 24); g.restore(); }
    }),
    fill: canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#fff'; g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 2, 0, TAU); g.fill(); }),
    tile: canvasTex(128, 128, (g, w, h) => {
      g.fillStyle = '#000'; g.fillRect(0, 0, w, h); g.strokeStyle = '#fff'; g.lineWidth = 8; g.strokeRect(5, 5, w - 10, h - 10);
      g.lineWidth = 2; for (let i = -h; i < w; i += 16) { g.beginPath(); g.moveTo(i, h); g.lineTo(i + h, 0); g.stroke(); }
    }),
    hex,
    star: canvasTex(256, 256, (g, w, h) => {
      g.translate(w / 2, h / 2); g.fillStyle = '#fff'; g.beginPath();
      for (let i = 0; i < 10; i++) { const r = i % 2 ? 26 : 62, a = -PI / 2 + (i * PI) / 5; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
      g.closePath(); g.fill(); g.lineCap = 'round';
      for (let k = 0; k < 3; k++) { g.globalAlpha = 0.9 - k * 0.28; g.lineWidth = 12 - k * 3; g.beginPath(); g.moveTo(-40 - k * 6, -40 - k * 22); g.lineTo(-118, -118 + k * 8); g.stroke(); }
    }),
    keys: canvasTex(256, 160, (g, w, h) => {
      g.fillStyle = '#fff';
      for (let r = 0; r < 5; r++) for (let c = 0; c < 14; c++) { g.globalAlpha = 0.35 + ((r * 7 + c * 3) % 5) * 0.12; g.fillRect(8 + c * 17.3, 10 + r * 28, 13, 20); }
    }),
  };
}

// code that scrolls on the laptop + the holo windows (one shared canvas texture)
const CODE = [
  'void Update() {', '  if (player.alive) boss.Aim(player);', '  foreach (var t in arena.tiles)', '    t.Delete(Random.value);',
  '  Physics.gravity *= 0.2f;', '  player.weapon = null; // oops', '  bullets.RemoveAll(b => b.owner == player);', '}',
  '// TODO: balance this boss', 'while (true) { firewall.Patch(); }', 'git push --force origin main', 'sudo rm -rf /reality',
  'const hp = Infinity; // trust me', 'if (skill < boss) throw new Error("gg");', 'arena.Rebuild(seed);', 'player.Teleport(player.lastSafe);',
  '// nobody will find the terminals', 'fork(self, 4);', 'memory.leak(true);', 'import { pain } from "./dev";',
  'let cursor = new Mouse(player.pos);', 'function recurse(n) { return recurse(n + 1); }',
];
function createScreen() {
  const c = document.createElement('canvas'); c.width = 512; c.height = 320;
  const g = c.getContext('2d'), tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  let acc = 1, sc = 0;
  const st = { mode: 'code', col: '#38f2ff', cmd: '', t: 0 };
  function paint() {
    const W = 512, H = 320;
    if (st.mode === 'bsod') {
      g.fillStyle = '#1747d6'; g.fillRect(0, 0, W, H); g.fillStyle = '#fff';
      g.font = 'bold 78px monospace'; g.fillText(':(', 34, 100); g.font = 'bold 20px monospace'; g.fillText('KERNEL_PANIC', 34, 150);
      g.font = '14px monospace'; g.fillText('FIREWALL.SYS HAS STOPPED RESPONDING', 34, 180);
      g.fillText('collecting error info... ' + (Math.floor(st.t * 13) % 100) + '%', 34, 206); g.fillText('stop code: SKILL_ISSUE (0xDEAD)', 34, 232);
      return;
    }
    g.fillStyle = st.mode === 'warn' ? '#1a0508' : '#04101a'; g.fillRect(0, 0, W, H); g.font = '14px monospace';
    for (let i = 0; i < 17; i++) {
      const li = (Math.floor(sc / 19) + i) % CODE.length, y = 22 + i * 19 - (sc % 19), L = CODE[li];
      g.fillStyle = L.startsWith('//') ? '#4c6a7a' : li % 3 === 0 ? st.col : li % 3 === 1 ? '#9ff' : '#c9d4ff';
      g.globalAlpha = 0.55 + 0.45 * (i / 17); g.fillText(L, 10, y);
    }
    g.globalAlpha = 1; g.fillStyle = 'rgba(0,0,0,.68)'; g.fillRect(0, H - 34, W, 34); g.fillStyle = '#4dff9a';
    g.fillText('> ' + st.cmd.slice(0, 52) + (st.t % 1 < 0.5 ? '█' : ''), 10, H - 12);
    if (st.mode === 'warn') { g.fillStyle = 'rgba(255,60,60,.25)'; g.fillRect(0, 0, W, H); }
  }
  return { tex, st, update(dt) { st.t += dt; sc += dt * (st.mode === 'warn' ? 160 : 70); acc += dt; if (acc < 0.1) return; acc = 0; paint(); tex.needsUpdate = true; } };
}

// ======================================================================
//  SFX
// ======================================================================
function createSfx(audio) {
  let ctx = null, master = null, nb = null, live = 0, el = null, dr = null;
  const ready = () => {
    if (!ctx) {
      ctx = audio.getCtx && audio.getCtx(); master = audio.getMaster && audio.getMaster();
      if (!ctx || !master) { ctx = null; return false; }
      nb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return ctx.state === 'running';
  };
  const env = (g, t, pk, a, dur) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(pk, 0.0002), t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dur); };
  const osc = (out, t, o) => {
    const { type = 'sine', f = 100, f2 = null, dur = 0.3, gain = 0.5, a = 0.004 } = o;
    const s = ctx.createOscillator(), g = ctx.createGain();
    s.type = type; s.frequency.setValueAtTime(f, t);
    if (f2) s.frequency.exponentialRampToValueAtTime(Math.max(18, f2), t + a + dur);
    env(g, t, gain, a, dur); s.connect(g); g.connect(out); s.start(t); s.stop(t + a + dur + 0.05);
    s.onended = () => { try { s.disconnect(); g.disconnect(); } catch (_) {} };
  };
  const nz = (out, t, o) => {
    const { type = 'lowpass', f = 800, f2 = null, q = 0.8, dur = 0.3, gain = 0.5, a = 0.004 } = o;
    const s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = nb; s.loop = true; fl.type = type; fl.Q.value = q; fl.frequency.setValueAtTime(f, t);
    if (f2) fl.frequency.exponentialRampToValueAtTime(Math.max(30, f2), t + a + dur);
    env(g, t, gain, a, dur); s.connect(fl); fl.connect(g); g.connect(out); s.start(t, Math.random() * 0.5); s.stop(t + a + dur + 0.05);
    s.onended = () => { try { s.disconnect(); fl.disconnect(); g.disconnect(); } catch (_) {} };
  };
  function play(vol, dur, fn, big) {
    if (!ready() || (live >= 8 && !big)) return;
    const g = ctx.createGain(); g.gain.value = vol; g.connect(master); live++;
    fn(g, ctx.currentTime + 0.004);
    setTimeout(() => { live--; try { g.disconnect(); } catch (_) {} }, (dur + 0.3) * 1000);
  }
  function drone(on) {
    if (!on) {
      if (dr) { const d = dr; dr = null; try { d.g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.3); } catch (_) {} setTimeout(() => { try { d.a.stop(); d.b.stop(); d.g.disconnect(); } catch (_) {} }, 1600); }
      return;
    }
    if (dr || !ready()) return;
    const g = ctx.createGain(); g.gain.value = 0.0001;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300;
    const a = ctx.createOscillator(), b = ctx.createOscillator();
    a.type = 'sawtooth'; a.frequency.value = 49; b.type = 'square'; b.frequency.value = 73.4;
    a.connect(f); b.connect(f); f.connect(g); g.connect(master); a.start(); b.start(); g.gain.setTargetAtTime(0.1, ctx.currentTime, 1.2);
    dr = { a, b, g, f };
  }
  const NOTES = [0, 3, 5, 7, 10];
  return {
    boom: (s = 1, v = 1) => play(v, 1.4 * s, (o, t) => {
      osc(o, t, { f: 80, f2: 22, dur: 0.9 * s, gain: 1.1 }); nz(o, t, { f: 1600, f2: 60, dur: 1.0 * s, gain: 0.9 }); nz(o, t, { type: 'highpass', f: 3000, dur: 0.12, gain: 0.5 });
      if (s > 1.2) osc(o, t + 0.05, { f: 46, f2: 20, dur: 1.4, gain: 0.9 });
    }, s > 1.4),
    hum: (v = 1) => play(v, 2.0, (o, t) => { osc(o, t, { type: 'sawtooth', f: 110, f2: 70, dur: 1.5, gain: 0.35, a: 0.2 }); osc(o, t, { f: 220, f2: 140, dur: 1.5, gain: 0.3, a: 0.25 }); nz(o, t, { type: 'bandpass', f: 500, f2: 1600, q: 1.2, dur: 1.3, gain: 0.4, a: 0.25 }); }, true),
    charge: (d = 1.5, v = 1) => play(v, d + 0.4, (o, t) => {
      osc(o, t, { type: 'triangle', f: 90, f2: 900, dur: d * 0.1, gain: 0.3, a: d * 0.9 }); nz(o, t, { type: 'highpass', f: 600, f2: 7000, dur: d * 0.1, gain: 0.35, a: d * 0.9 }); osc(o, t + d, { f: 160, f2: 40, dur: 0.3, gain: 0.45 });
    }),
    zap: (v = 1) => play(v, 0.3, (o, t) => { nz(o, t, { type: 'highpass', f: 3500, dur: 0.12, gain: 0.5 }); osc(o, t, { type: 'square', f: 1800, f2: 220, dur: 0.18, gain: 0.2 }); }),
    whoosh: (v = 1) => play(v, 0.6, (o, t) => nz(o, t, { type: 'bandpass', f: 200, f2: 2600, q: 0.9, dur: 0.45, gain: 0.5, a: 0.1 })),
    shatter: (v = 1) => play(v, 0.6, (o, t) => { nz(o, t, { type: 'highpass', f: 1800, dur: 0.5, gain: 0.6 }); osc(o, t, { type: 'triangle', f: 3000, f2: 1600, dur: 0.25, gain: 0.2 }); }),
    thump: (v = 1) => play(v, 0.4, (o, t) => { osc(o, t, { f: 64, f2: 28, dur: 0.3, gain: 0.9 }); nz(o, t, { f: 400, f2: 80, dur: 0.25, gain: 0.55 }); }),
    swell: (v = 1) => play(v, 1.6, (o, t) => { osc(o, t, { type: 'triangle', f: 110, f2: 330, dur: 0.5, gain: 0.3, a: 0.9 }); nz(o, t, { type: 'bandpass', f: 400, f2: 2000, q: 1, dur: 0.5, gain: 0.3, a: 0.9 }); }),
    chime: (n = 0, v = 1) => play(v, 1.4, (o, t) => { const f = 261.6 * Math.pow(2, NOTES[n % 5] / 12 + Math.floor(n / 5) % 2); osc(o, t, { type: 'square', f, dur: 0.5, gain: 0.12, a: 0.003 }); osc(o, t, { f: f * 2.01, dur: 0.9, gain: 0.25, a: 0.003 }); }),
    ping: (v = 1) => play(v, 0.5, (o, t) => { osc(o, t, { f: 1300, f2: 2600, dur: 0.3, gain: 0.5 }); nz(o, t, { type: 'highpass', f: 4000, dur: 0.15, gain: 0.35 }); }),
    key: (v = 0.5) => play(v, 0.1, (o, t) => { osc(o, t, { type: 'square', f: 1800 + Math.random() * 500, f2: 900, dur: 0.03, gain: 0.14 }); nz(o, t, { type: 'highpass', f: 5000, dur: 0.03, gain: 0.2 }); }),
    err: (v = 1) => play(v, 0.7, (o, t) => { [900, 700, 450].forEach((f, i) => osc(o, t + i * 0.12, { type: 'square', f, dur: 0.1, gain: 0.28 })); }),
    glitch: (v = 1) => play(v, 0.6, (o, t) => { for (let i = 0; i < 4; i++) { nz(o, t + i * 0.07, { type: 'bandpass', f: rnd(300, 5000), q: 4, dur: 0.05, gain: 0.5 }); osc(o, t + i * 0.07, { type: 'sawtooth', f: rnd(100, 900), f2: rnd(1000, 3000), dur: 0.06, gain: 0.15 }); } }),
    boot: (v = 1) => play(v, 1.2, (o, t) => { [0, 4, 7, 12].forEach((s, i) => osc(o, t + i * 0.12, { type: 'triangle', f: 330 * Math.pow(2, s / 12), dur: 0.35, gain: 0.3 })); }),
    musicStart(url) {
      this.musicStop();
      try {
        el = new Audio(url); el.loop = true; el.volume = 0.45;
        el.addEventListener('error', () => { el = null; drone(true); });
        const p = el.play(); if (p && p.catch) p.catch(() => { el = null; drone(true); });
      } catch (_) { el = null; drone(true); }
    },
    musicSet(i) { if (dr && ctx) dr.f.frequency.setTargetAtTime(240 + i * 620, ctx.currentTime, 0.5); if (el) el.volume = 0.35 + 0.2 * clamp(i, 0, 1); },
    musicStop() { if (el) { try { el.pause(); } catch (_) {} el = null; } drone(false); },
  };
}

// ======================================================================
//  FX: particles, shock walls, beams, telegraphs, decals, lightning, one flash light
// ======================================================================
function createFx(scene, camera, renderer) {
  const tx = makeTex();
  const root = new THREE.Group(); root.visible = false; scene.add(root);
  const v2 = new THREE.Vector2(), _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3();
  let floorY = 0;
  const planeG = new THREE.PlaneGeometry(2, 2).rotateX(-PI / 2);
  const rectG = new THREE.PlaneGeometry(1, 1).rotateX(-PI / 2).translate(0, 0, 0.5);
  const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true);
  const basic = (o) => new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, fog: false, ...o });
  const addM = (o) => basic({ blending: THREE.AdditiveBlending, ...o });
  function pool(n, make) {
    const a = []; for (let i = 0; i < n; i++) { const o = make(); o.on = false; a.push(o); }
    let k = 0;
    return { a, get() { for (let i = 0; i < n; i++) { const o = a[(k + i) % n]; if (!o.on) { k = (k + i + 1) % n; o.on = true; return o; } } const o = a[k]; k = (k + 1) % n; o.on = true; return o; } };
  }
  function points(max, additive) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(max * 3), col = new Float32Array(max * 4), siz = new Float32Array(max);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 4)); geo.setAttribute('size', new THREE.BufferAttribute(siz, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uK: { value: 700 } }, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: 'attribute float size; attribute vec4 color; varying vec4 vC; uniform float uK; void main(){ vC=color; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=clamp(size*uK/max(0.1,-mv.z),0.0,300.0); gl_Position=projectionMatrix*mv; }',
      fragmentShader: 'varying vec4 vC; void main(){ float d=length(gl_PointCoord-0.5)*2.0; float a=clamp(1.0-d,0.0,1.0); a*=a; gl_FragColor=vec4(vC.rgb,vC.a*a); if(gl_FragColor.a<0.004) discard; }',
    });
    const obj = new THREE.Points(geo, mat); obj.frustumCulled = false; obj.renderOrder = additive ? 6 : 5;
    const L = new Float32Array(max), ML = new Float32Array(max), VX = new Float32Array(max), VY = new Float32Array(max), VZ = new Float32Array(max);
    const S0 = new Float32Array(max), S1 = new Float32Array(max), AL = new Float32Array(max), GR = new Float32Array(max), DR = new Float32Array(max);
    const C0 = new Float32Array(max * 3), C1 = new Float32Array(max * 3);
    let head = 0;
    function emit(x, y, z, vx, vy, vz, life, s0, s1, c0, c1, a = 1, grav = 0, drag = 0) {
      const i = head; head = (head + 1) % max;
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z; VX[i] = vx; VY[i] = vy; VZ[i] = vz; L[i] = ML[i] = life; S0[i] = s0; S1[i] = s1; AL[i] = a; GR[i] = grav; DR[i] = drag;
      C0[i * 3] = ((c0 >> 16) & 255) / 255; C0[i * 3 + 1] = ((c0 >> 8) & 255) / 255; C0[i * 3 + 2] = (c0 & 255) / 255;
      C1[i * 3] = ((c1 >> 16) & 255) / 255; C1[i * 3 + 1] = ((c1 >> 8) & 255) / 255; C1[i * 3 + 2] = (c1 & 255) / 255;
    }
    function update(dt) {
      let any = false;
      for (let i = 0; i < max; i++) {
        if (L[i] <= 0) { if (siz[i] !== 0) { siz[i] = 0; any = true; } continue; }
        any = true; L[i] -= dt;
        const t = 1 - Math.max(0, L[i]) / ML[i], k = Math.max(0, 1 - DR[i] * dt), j = i * 3, c = i * 4;
        VX[i] *= k; VY[i] = VY[i] * k - GR[i] * dt; VZ[i] *= k; pos[j] += VX[i] * dt; pos[j + 1] += VY[i] * dt; pos[j + 2] += VZ[i] * dt;
        col[c] = C0[j] + (C1[j] - C0[j]) * t; col[c + 1] = C0[j + 1] + (C1[j + 1] - C0[j + 1]) * t; col[c + 2] = C0[j + 2] + (C1[j + 2] - C0[j + 2]) * t;
        col[c + 3] = AL[i] * (t < 0.12 ? t / 0.12 : 1 - (t - 0.12) / 0.88); siz[i] = S0[i] + (S1[i] - S0[i]) * t;
      }
      if (any) { geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true; geo.attributes.size.needsUpdate = true; }
    }
    function clear() { L.fill(0); siz.fill(0); geo.attributes.size.needsUpdate = true; }
    return { obj, emit, update, clear, mat };
  }
  const pa = points(2200, true), pn = points(300, false);
  root.add(pa.obj, pn.obj);
  const add = pa.emit, dark = pn.emit;
  function burst(x, y, z, n, spd, life, s0, s1, c0, c1, o = {}) {
    const E = o.dark ? dark : add, up = o.up || 0, grav = o.grav ?? 6, drag = o.drag ?? 0.8, a = o.a ?? 1, flat = o.flat || 0;
    for (let i = 0; i < n; i++) {
      const th = rnd(0, TAU), ph = Math.acos(rnd(-1, 1)), s = spd * rnd(0.3, 1);
      E(x, y, z, Math.sin(ph) * Math.cos(th) * s, (Math.cos(ph) * (1 - flat) + up) * s, Math.sin(ph) * Math.sin(th) * s, life * rnd(0.6, 1.2), s0, s1, c0, c1, a, grav, drag);
    }
  }
  const sprites = pool(72, () => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx.glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    s.visible = false; root.add(s);
    const o = { set(x, y, z, size, col, a = 1) { s.visible = true; s.position.set(x, y, z); s.scale.setScalar(size); s.material.color.setHex(col); s.material.opacity = a; }, hide() { s.visible = false; o.on = false; } };
    return o;
  });
  const balls = [];
  function ball(x, y, z, r, col, life) { const h = sprites.get(); h.set(x, y, z, 0.1, col, 1); balls.push({ h, x, y, z, r, life, t: 0, col }); }
  const waves = pool(16, () => {
    const g = new THREE.Group();
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 48, 1, true).translate(0, 0.5, 0), addM({ map: tx.wall, side: THREE.DoubleSide }));
    const ring = new THREE.Mesh(planeG, addM({ map: tx.ring }));
    g.add(wall, ring); g.visible = false; root.add(g);
    const o = {
      place(x, y, z, r, w, h, a, col) { g.visible = true; g.position.set(x, y, z); wall.scale.set(r, h, r); ring.scale.set(r + w * 0.5, 1, r + w * 0.5); wall.material.opacity = a; ring.material.opacity = a * 0.9; wall.material.color.setHex(col); ring.material.color.setHex(col); },
      hide() { g.visible = false; o.on = false; },
    };
    return o;
  });
  const LAY = [[0.35, 1.0], [0.75, 0.55], [1.25, 0.28]];
  const beams = pool(28, () => {
    const g = new THREE.Group(); g.visible = false; root.add(g);
    const ms = LAY.map(() => { const m = new THREE.Mesh(unitCyl, addM({ color: 0xffffff })); m.renderOrder = 7; g.add(m); return m; });
    const o = {
      set(ax, ay, az, bx, by, bz, r, col, a = 1) {
        g.visible = true;
        const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz) || 1e-3;
        g.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2); g.quaternion.copy(_q.setFromUnitVectors(_up, _d.set(dx / L, dy / L, dz / L)));
        for (let i = 0; i < 3; i++) { ms[i].scale.set(r * LAY[i][0], L, r * LAY[i][0]); ms[i].material.color.setHex(i === 0 ? 0xffffff : col); ms[i].material.opacity = a * LAY[i][1]; }
      },
      hide() { g.visible = false; o.on = false; },
    };
    return o;
  });
  const beamT = [];
  function beamTimed(ax, ay, az, bx, by, bz, r, col, life) { const h = beams.get(); beamT.push({ h, ax, ay, az, bx, by, bz, r, col, life, t: 0 }); }
  const mkTele = (kind) => () => {
    const g = new THREE.Group(); g.visible = false; root.add(g);
    let base, pr;
    if (kind === 'disc') { base = new THREE.Mesh(planeG, basic({ map: tx.disc })); pr = new THREE.Mesh(planeG, basic({ map: tx.fill })); }
    else { base = new THREE.Mesh(rectG, basic({})); pr = new THREE.Mesh(rectG, basic({})); }
    base.renderOrder = 3; pr.renderOrder = 4; g.add(base, pr);
    const h = { g, base, prog: pr, kind, o: null, t: 0, dur: 1, kill() { g.visible = false; h.on = false; } };
    return h;
  };
  const teleP = { disc: pool(24, mkTele('disc')), rect: pool(40, mkTele('rect')) };
  const teleL = [];
  function tele(kind, o) {
    const h = teleP[kind].get(); h.o = o; h.t = 0; h.dur = o.dur || 1; h.g.visible = true;
    const col = o.col ?? 0xff2a2a; h.base.material.color.setHex(col); h.prog.material.color.setHex(col);
    if (!teleL.includes(h)) teleL.push(h);
    return h;
  }
  const decG = pool(20, () => { const m = new THREE.Mesh(planeG, addM({ map: tx.glow })); m.renderOrder = 2; m.visible = false; root.add(m); return { m, hide() { m.visible = false; this.on = false; } }; });
  const decL = [];
  function decal(x, z, r, col, life) { const d = decG.get(); d.m.visible = true; d.m.position.set(x, floorY + 0.06 + Math.random() * 0.01, z); d.m.scale.set(r, 1, r); d.m.material.color.setHex(col); d.m.material.opacity = 1; decL.push({ d, life, t: 0 }); }
  const arcs = pool(14, () => {
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(16 * 3), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    line.frustumCulled = false; line.visible = false; root.add(line);
    return { line, geo, a: new THREE.Vector3(), b: new THREE.Vector3(), life: 0, max: 1, amp: 1, hide() { line.visible = false; this.on = false; } };
  });
  const arcL = [];
  function arc(ax, ay, az, bx, by, bz, col, life, amp = 2) { const o = arcs.get(); o.a.set(ax, ay, az); o.b.set(bx, by, bz); o.life = o.max = life; o.amp = amp; o.line.visible = true; o.line.material.color.setHex(col); if (!arcL.includes(o)) arcL.push(o); }
  const light = new THREE.PointLight(0xffffff, 0, 190, 2); light.visible = false; root.add(light);
  const lt = { t: 0, dur: 1, peak: 0 };
  function flashLight(x, y, z, col, peak, dur) { if (lt.t > 0 && peak < light.intensity * 0.7) return; light.position.set(x, y, z); light.color.setHex(col); lt.t = dur; lt.dur = dur; lt.peak = peak; }
  function update(dt) {
    if (!root.visible) return;
    pa.mat.uniforms.uK.value = pn.mat.uniforms.uK.value = renderer.getDrawingBufferSize(v2).y / (2 * Math.tan((camera.fov * PI) / 360));
    pa.update(dt); pn.update(dt);
    for (let i = balls.length - 1; i >= 0; i--) { const b = balls[i]; b.t += dt; const p = b.t / b.life; if (p >= 1) { b.h.hide(); balls.splice(i, 1); continue; } b.h.set(b.x, b.y, b.z, b.r * (0.3 + 0.9 * outC(p)), b.col, Math.pow(1 - p, 1.5)); }
    for (let i = beamT.length - 1; i >= 0; i--) { const b = beamT[i]; b.t += dt; const p = b.t / b.life; if (p >= 1) { b.h.hide(); beamT.splice(i, 1); continue; } b.h.set(b.ax, b.ay, b.az, b.bx, b.by, b.bz, b.r * (p < 0.15 ? p / 0.15 : 1 - (p - 0.15) * 0.6), b.col, p < 0.1 ? 1 : 1 - p); }
    for (let i = teleL.length - 1; i >= 0; i--) {
      const h = teleL[i];
      if (!h.on) { teleL.splice(i, 1); continue; }
      h.t += dt; const p = Math.min(1, h.t / h.dur), o = h.o;
      if (h.t > h.dur + 0.15) { h.kill(); teleL.splice(i, 1); continue; }
      const pulse = 0.5 + 0.5 * Math.sin(h.t * 16); h.g.position.set(o.x, floorY + 0.1, o.z);
      if (h.kind === 'disc') { h.base.scale.set(o.r, 1, o.r); h.prog.scale.set(o.r * p, 1, o.r * p); h.base.material.opacity = 0.35 + 0.35 * pulse * p; h.prog.material.opacity = 0.3; }
      else { h.g.rotation.y = Math.atan2(o.dx, o.dz); h.base.scale.set(o.w, 1, o.len); h.prog.scale.set(o.w, 1, Math.max(0.01, o.len * p)); h.base.material.opacity = 0.16 + 0.1 * pulse * p; h.prog.material.opacity = 0.32; }
    }
    for (let i = decL.length - 1; i >= 0; i--) { const d = decL[i]; d.t += dt; const p = d.t / d.life; if (p >= 1) { d.d.hide(); decL.splice(i, 1); continue; } d.d.m.material.opacity = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3; }
    for (let i = arcL.length - 1; i >= 0; i--) {
      const o = arcL[i]; o.life -= dt;
      if (o.life <= 0) { o.hide(); arcL.splice(i, 1); continue; }
      const pos = o.geo.attributes.position;
      for (let k = 0; k < 16; k++) { const t = k / 15, e = k === 0 || k === 15 ? 0 : o.amp * Math.sin(PI * t); pos.setXYZ(k, o.a.x + (o.b.x - o.a.x) * t + rnd(-e, e), o.a.y + (o.b.y - o.a.y) * t + rnd(-e, e), o.a.z + (o.b.z - o.a.z) * t + rnd(-e, e)); }
      pos.needsUpdate = true; o.line.material.opacity = o.life / o.max;
    }
    if (lt.t > 0) { lt.t -= dt; const k = Math.max(0, lt.t / lt.dur); light.intensity = lt.peak * k * k; } else light.intensity = 0;
  }
  function clear() {
    pa.clear(); pn.clear();
    for (const b of balls) b.h.hide(); balls.length = 0; for (const b of beamT) b.h.hide(); beamT.length = 0;
    for (const t of teleL) t.kill(); teleL.length = 0; for (const d of decL) d.d.hide(); decL.length = 0; for (const a of arcL) a.hide(); arcL.length = 0;
    for (const p of [waves, beams, sprites]) for (const o of p.a) if (o.on) o.hide();
    light.intensity = 0; lt.t = 0;
  }
  return {
    tx, root, add, dark, burst, sprite: () => sprites.get(), ball, wave: () => waves.get(), beam: () => beams.get(), beamT: beamTimed,
    tele, decal, arc, light: flashLight, update, clear, setFloor(y) { floorY = y; }, setEnabled(on) { root.visible = on; light.visible = on; },
  };
}

// ======================================================================
//  RIG: THE DEV — procedural. Cross-legged, floating, typing on a floating laptop.
//  Based on the dev's favourite character: lavender hoodie w/ dark chevrons, dark sleeves, purple pants + tall boots,
//  tinted glasses, dark hair — plus headphones with wolf ears.
// ======================================================================
const unitCylG = new THREE.CylinderGeometry(1, 1, 1, 10, 1);
const _up = new THREE.Vector3(0, 1, 0), _pd = new THREE.Vector3(), _sh = new THREE.Vector3(), _el = new THREE.Vector3(), _hd = new THREE.Vector3(), _mid = new THREE.Vector3();
function place(m, a, b) { _pd.subVectors(b, a); const L = _pd.length() || 1e-3; m.position.copy(a).addScaledVector(_pd, 0.5); m.quaternion.setFromUnitVectors(_up, _pd.multiplyScalar(1 / L)); m.scale.set(m.userData.r, L, m.userData.r); }

function buildDev(tx, screenTex) {
  const std = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, metalness: 0.05, ...o });
  const bas = (c, o = {}) => new THREE.MeshBasicMaterial({ color: c, toneMapped: false, ...o });
  const M = {
    skin: std(0xe2ac90, { roughness: 0.6 }), hair: std(0x14121c, { roughness: 0.45 }), hood: std(0xa89dc4), hoodD: std(0x45396a), sleeve: std(0x383050),
    pants: std(0x463c62), boot: std(0x32284c), lace: bas(0x9a84e8), patch: std(0x6e6190), zip: std(0x241f36), phone: std(0x1c1a26, { metalness: 0.6, roughness: 0.35 }),
    fur: std(0xc9ccd8, { roughness: 0.95 }), furD: std(0x2b2834), glow: bas(0x38f2ff), inner: bas(0xff7ac8), lens: bas(0x7d86ff, { transparent: true, opacity: 0.6 }),
    frame: std(0x2b2c46), alu: std(0x2a2b36, { metalness: 0.8, roughness: 0.35 }), screen: bas(0xffffff, { map: screenTex }), eye: bas(0x0b0a10),
    keys: bas(0x38f2ff, { map: tx.keys, transparent: true, depthWrite: false }), logo: bas(0x38f2ff, { map: tx.star, transparent: true, depthWrite: false, side: THREE.DoubleSide }),
    mouth: std(0x8a4a4a), hit: new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
    ghost: new THREE.MeshBasicMaterial({ color: 0x38f2ff, wireframe: true, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, fog: false }),
  };
  const mk = (geo, mat, x, y, z, parent) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.frustumCulled = false; if (parent) parent.add(m); return m; };
  const limb = (parent, mat, r) => { const m = new THREE.Mesh(unitCylG, mat); m.frustumCulled = false; m.userData.r = r; parent.add(m); return m; };
  const root = new THREE.Group(); root.scale.setScalar(DEV.SCALE);
  const face = new THREE.Group(); root.add(face);
  const body = new THREE.Group(); face.add(body);
  const chest = new THREE.Group(); chest.position.set(0, 0.1, 0); body.add(chest);
  const head = new THREE.Group(); head.position.set(0, 0.98, 0.02); chest.add(head);
  const hits = [];
  const hit = (parent, geo, x, y, z, kind) => { const m = mk(geo, M.hit, x, y, z, parent); m.visible = false; m.userData.kind = kind; m.userData.hitZone = kind === 'head' ? 'head' : 'body'; hits.push(m); return m; };

  // ---- torso (hoodie) ----
  mk(new THREE.BoxGeometry(0.54, 0.62, 0.3), M.hood, 0, 0.36, 0, chest);
  mk(new THREE.BoxGeometry(0.546, 0.15, 0.306), M.hoodD, 0, 0.25, 0, chest);
  mk(new THREE.BoxGeometry(0.548, 0.025, 0.308), M.hoodD, 0, 0.39, 0, chest);
  mk(new THREE.BoxGeometry(0.548, 0.04, 0.308), M.hoodD, 0, 0.075, 0, chest);
  for (const s of [-1, 1]) mk(new THREE.BoxGeometry(0.3, 0.045, 0.01), M.hoodD, s * 0.15, 0.345, 0.153, chest).rotation.z = -s * 0.28;
  mk(new THREE.BoxGeometry(0.014, 0.6, 0.01), M.zip, -0.07, 0.36, 0.155, chest).rotation.z = 0.05;
  mk(new THREE.CylinderGeometry(0.14, 0.17, 0.07, 16), M.hood, 0, 0.7, 0, chest);
  mk(new THREE.SphereGeometry(0.22, 14, 10), M.hood, 0, 0.74, -0.16, chest).scale.set(1.05, 0.7, 0.8);
  for (const s of [-1, 1]) mk(new THREE.SphereGeometry(0.1, 12, 10), M.hood, s * 0.31, 0.6, 0, chest);
  mk(new THREE.CylinderGeometry(0.06, 0.065, 0.12, 10), M.skin, 0, 0.82, 0, chest);
  mk(new THREE.BoxGeometry(0.5, 0.26, 0.34), M.pants, 0, -0.02, 0, body);

  // ---- head: skin, hair, face, glasses ----
  mk(new THREE.SphereGeometry(0.17, 20, 16), M.skin, 0, 0, 0, head).scale.set(1, 1.1, 1.03);
  mk(new THREE.SphereGeometry(0.183, 22, 14, 0, TAU, 0, PI * 0.55), M.hair, 0, 0.018, -0.005, head).rotation.x = -0.15;
  mk(new THREE.SphereGeometry(0.17, 14, 10), M.hair, 0, 0, -0.075, head).scale.set(1, 0.95, 0.8);
  for (let i = 0; i < 6; i++) { const m = mk(new THREE.BoxGeometry(0.07, 0.05, 0.02), M.hair, (i - 2.5) * 0.06, 0.105 - Math.abs(i - 2.5) * 0.01, 0.155, head); m.rotation.z = (i - 2.5) * 0.12; }
  mk(new THREE.BoxGeometry(0.2, 0.06, 0.12), M.hair, 0.02, 0.17, 0.05, head).rotation.x = -0.3;
  const eyes = [];
  for (const s of [-1, 1]) {
    const e = mk(new THREE.SphereGeometry(0.02, 8, 6), M.eye, s * 0.065, 0.01, 0.158, head); e.scale.set(1, 1.4, 0.5); eyes.push(e);
    mk(new THREE.BoxGeometry(0.075, 0.012, 0.012), M.hair, s * 0.065, 0.072, 0.162, head).rotation.z = s * 0.12;
    mk(new THREE.BoxGeometry(0.115, 0.085, 0.012), M.lens, s * 0.068, 0.01, 0.174, head);
    mk(new THREE.BoxGeometry(0.13, 0.1, 0.01), M.frame, s * 0.068, 0.01, 0.168, head);
  }
  mk(new THREE.BoxGeometry(0.03, 0.012, 0.012), M.frame, 0, 0.02, 0.172, head);
  mk(new THREE.BoxGeometry(0.02, 0.04, 0.03), M.skin, 0, -0.025, 0.172, head);
  mk(new THREE.BoxGeometry(0.05, 0.008, 0.01), M.mouth, 0.005, -0.075, 0.166, head).rotation.z = 0.08;

  // ---- headphones with wolf ears ----
  const ph = new THREE.Group(); head.add(ph);
  mk(new THREE.TorusGeometry(0.23, 0.019, 8, 40, PI), M.phone, 0, -0.01, 0, ph);
  const leds = [], ears = [];
  for (const s of [-1, 1]) {
    mk(new THREE.CylinderGeometry(0.078, 0.078, 0.065, 20), M.phone, s * 0.205, -0.005, 0, ph).rotation.z = PI / 2;
    const led = mk(new THREE.TorusGeometry(0.062, 0.009, 8, 24), M.glow, s * 0.24, -0.005, 0, ph); led.rotation.y = PI / 2; leds.push(led);
    const ear = new THREE.Group(); ear.position.set(s * 0.135, 0.205, -0.01); ear.rotation.z = -s * 0.32; ph.add(ear); ears.push(ear); ear.userData.s = s;
    mk(new THREE.SphereGeometry(0.075, 10, 8), M.fur, 0, 0.01, 0, ear).scale.set(1, 0.6, 0.8);
    const o1 = mk(new THREE.ConeGeometry(0.085, 0.25, 4), M.fur, 0, 0.13, 0, ear); o1.scale.z = 0.5; o1.rotation.y = PI / 4;
    const o2 = mk(new THREE.ConeGeometry(0.052, 0.19, 4), M.inner, 0, 0.11, 0.022, ear); o2.scale.z = 0.4; o2.rotation.y = PI / 4;
    mk(new THREE.ConeGeometry(0.03, 0.07, 4), M.furD, 0, 0.27, 0, ear).scale.z = 0.5;
  }

  // ---- legs: cross-legged ----
  const hipL = new THREE.Vector3(0.17, 0, 0.04), kneeL = new THREE.Vector3(0.52, -0.05, 0.36), ankL = new THREE.Vector3(-0.16, -0.15, 0.34);
  const hipR = new THREE.Vector3(-0.17, 0, 0.04), kneeR = new THREE.Vector3(-0.52, -0.05, 0.36), ankR = new THREE.Vector3(0.18, -0.11, 0.2);
  for (const [hp, kn, an] of [[hipL, kneeL, ankL], [hipR, kneeR, ankR]]) {
    place(limb(body, M.pants, 0.11), hp, kn); mk(new THREE.SphereGeometry(0.11, 10, 8), M.pants, kn.x, kn.y, kn.z, body);
    place(limb(body, M.boot, 0.085), kn, an);
    for (let i = 1; i <= 4; i++) { const p = new THREE.Vector3().lerpVectors(kn, an, i * 0.2); mk(new THREE.BoxGeometry(0.1, 0.014, 0.014), M.lace, p.x, p.y + 0.075, p.z + 0.02, body); }
    mk(new THREE.BoxGeometry(0.12, 0.085, 0.27), M.boot, an.x, an.y - 0.03, an.z + 0.07, body).rotation.y = (kn.x > 0 ? -0.2 : 0.2);
  }
  mk(new THREE.BoxGeometry(0.11, 0.012, 0.09), M.patch, 0.32, 0.075, 0.2, body).rotation.z = -0.1;

  // ---- arms ----
  const mkArm = () => ({ u: limb(body, M.hood, 0.075), f: limb(body, M.sleeve, 0.062), h: mk(new THREE.SphereGeometry(0.055, 10, 8), M.skin, 0, 0, 0, body) });
  const armL = mkArm(), armR = mkArm();

  // ---- laptop (screen faces the Dev, lid back with the falling-star logo faces the player) ----
  mk(new THREE.BoxGeometry(0.66, 0.025, 0.44), M.alu, 0, 0.12, 0.66, body);
  const keysM = mk(new THREE.PlaneGeometry(0.6, 0.34), M.keys, 0, 0.1345, 0.64, body); keysM.rotation.x = -PI / 2;
  const lid = new THREE.Group(); lid.position.set(0, 0.135, 0.88); lid.rotation.x = 0.28; body.add(lid);
  mk(new THREE.BoxGeometry(0.66, 0.42, 0.02), M.alu, 0, 0.21, 0, lid);
  const scr = mk(new THREE.PlaneGeometry(0.6, 0.36), M.screen, 0, 0.21, -0.0115, lid); scr.rotation.y = PI;
  mk(new THREE.PlaneGeometry(0.34, 0.34), M.logo, 0, 0.21, 0.0115, lid);
  hit(head, new THREE.SphereGeometry(0.3, 10, 8), 0, 0, 0, 'head');
  hit(chest, new THREE.BoxGeometry(0.8, 1.0, 0.6), 0, 0.4, 0, 'body');
  hit(body, new THREE.BoxGeometry(0.78, 0.52, 0.62), 0, 0.3, 0.7, 'laptop');

  // ---- floating holo windows + sigil + firewall shell (not part of the yawing body) ----
  const panelRoot = new THREE.Group(); root.add(panelRoot);
  const panels = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU, g = new THREE.Group();
    const pm = new THREE.MeshBasicMaterial({ map: screenTex, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false });
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.1), pm); pl.frustumCulled = false; g.add(pl);
    const fr = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(3.4, 2.1)), new THREE.LineBasicMaterial({ color: 0x38f2ff, transparent: true, opacity: 0.9, fog: false })); fr.frustumCulled = false; g.add(fr);
    g.position.set(Math.cos(a) * 5.4, 1.3 + (i % 3) * 0.8 - 0.3, Math.sin(a) * 5.4); g.rotation.y = PI / 2 - a;
    panelRoot.add(g); panels.push({ g, pm, fr, a, i });
  }
  const sigil = new THREE.Group(); sigil.position.y = -0.55; root.add(sigil);
  for (const [r, t] of [[0.95, 0.012], [1.25, 0.008]]) { const m = mk(new THREE.TorusGeometry(r, t, 6, 64), M.glow, 0, 0, 0, sigil); m.rotation.x = PI / 2; }
  for (let i = 0; i < 18; i++) { const a = (i / 18) * TAU; mk(new THREE.BoxGeometry(0.05, 0.002, 0.11), M.glow, Math.cos(a) * 1.1, 0, Math.sin(a) * 1.1, sigil).rotation.y = -a; }
  const shellMat = new THREE.MeshBasicMaterial({ map: tx.hex, color: 0x38f2ff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false });
  const shell = mk(new THREE.SphereGeometry(1, 28, 18), shellMat, 0, 0.5, 0.4, root); shell.scale.setScalar(4.3); shell.renderOrder = 4;
  const light = new THREE.PointLight(0x38f2ff, 400, 70, 2); light.position.set(0, 1.2, 1.9); root.add(light);

  const rg = { root, face, body, chest, head, ears, eyes, leds, armL, armR, lid, panelRoot, panels, sigil, shell, shellMat, M, hits, light, keysM };
  poseArms(rg, 0, { slump: 0, cast: 0 });
  return rg;
}

// ---- attack poses: hand targets (body space), lean/tilt/twist, laptop lid, hand + torso wobble. Smoothed in applyRig. ----
const POSE = (o) => ({ L: [0.16, 0.19, 0.6], R: [-0.16, 0.19, 0.6], lw: 0, rw: 0, lean: 0, tilt: 0, twist: 0, lid: 0, a: 0, f: 1, tA: 0, tF: 1, ...o });
const POSES = {
  none: POSE({}),
  raise: POSE({ L: [0.5, 1.6, 0.15], R: [-0.5, 1.6, 0.15], lw: 1, rw: 1, lean: -0.3, tilt: -0.25, lid: 0.35, a: 0.1, f: 9 }),           // arms to the sky: orbital strikes, seekers, gravity, collapse
  spread: POSE({ L: [1.2, 0.9, 0.1], R: [-1.2, 0.9, 0.1], lw: 1, rw: 1, lean: -0.25, tilt: -0.2, lid: 0.5, a: 0.18, f: 4 }),               // arms wide: crosshair, fork, recurse
  slam: POSE({ L: [0.3, 0.3, 1.0], R: [-0.3, 0.3, 1.0], lw: 1, rw: 1, lean: 0.4, tilt: 0.3, lid: -0.15, a: 0.2, f: 7 }),                   // two fists forward-down: tiles, click, leak, dive
  point: POSE({ R: [-0.4, 1.0, 1.25], rw: 1, lean: -0.05, twist: -0.2, lid: 0.15, a: 0.05, f: 10 }),                                       // one arm aimed at you: spray, ray, marquee
  guard: POSE({ L: [-0.3, 0.7, 0.7], R: [0.3, 0.7, 0.7], lw: 1, rw: 1, lean: 0.1, tilt: 0.1, lid: 0.45 }),                                 // arms crossed: walls, cage, undo
  conduct: POSE({ L: [0.9, 1.0, 0.5], R: [-0.9, 1.0, 0.5], lw: 1, rw: 1, a: 0.45, f: 3.2, tA: 0.35, tF: 1.6, lean: -0.1, lid: 0.3 }),      // conducting the waveform
  hack: POSE({ L: [0.7, 1.3, 0.4], lw: 1, lean: 0.05, twist: 0.2, a: 0.1, f: 12, lid: 0.2 }),                                              // one hand up, one still typing: ammo, swap, popups
  spin: POSE({ L: [1.1, 0.9, 0.2], R: [-1.1, 0.9, 0.2], lw: 1, rw: 1, a: 0.1, f: 6, tA: 0.8, tF: 3, lean: -0.1, lid: 0.4 }),              // twisting arms: for-loop spiral, scan sweep
};
const PK = ['lw', 'rw', 'lean', 'tilt', 'twist', 'lid', 'a', 'tA'];

function poseArms(rg, t, P) {
  const ca = Math.cos(rg.chest.rotation.x), sa = Math.sin(rg.chest.rotation.x);
  for (const s of [1, -1]) {
    const A = s > 0 ? rg.armL : rg.armR, ph = s > 0 ? 0 : 1.7;
    _sh.set(0.31 * s, 0.1 + 0.6 * ca, 0.6 * sa);
    const ty = Math.max(0, Math.sin(t * (s > 0 ? 21 : 25) + ph)) * 0.022;
    const tx0 = s * 0.16, ty0 = 0.19 + ty, tz0 = 0.6 - ty * 0.6;
    const cx = s * 0.8, cyy = 0.95 + Math.sin(t * 3 + s) * 0.06, cz = 0.32;
    const sx = s * 0.4, sy = -0.14, sz = 0.3;
    const k1 = P.cast, k2 = P.slump;
    _hd.set(lerp(lerp(tx0, cx, k1), sx, k2), lerp(lerp(ty0, cyy, k1), sy, k2), lerp(lerp(tz0, cz, k1), sz, k2));
    if (P.pv) {
      const H = s > 0 ? P.pv.L : P.pv.R, w = s > 0 ? P.pv.lw : P.pv.rw;
      if (w > 0.001) { _hd.x = lerp(_hd.x, H[0], w); _hd.y = lerp(_hd.y, H[1] + P.so * s, w); _hd.z = lerp(_hd.z, H[2], w); }
    }
    _mid.addVectors(_sh, _hd).multiplyScalar(0.5); _el.set(_mid.x + s * 0.14, _mid.y - 0.12, _mid.z - 0.04);
    place(A.u, _sh, _el); place(A.f, _el, _hd); A.h.position.copy(_hd);
  }
}
function makeGhost(rg) {
  const g = new THREE.Group(), c = rg.face.clone(true);
  c.traverse((o) => { if (o.isMesh) o.material = rg.M.ghost; });
  g.add(c); g.scale.setScalar(DEV.SCALE); g.visible = false;
  return g;
}

// ======================================================================
//  ARENA: server-farm deck (circuit floor, 16 server racks, void ring, code sky, far holo windows)
// ======================================================================
function buildArena(AX, AY, AZ, R, tx, screenTex) {
  const g = new THREE.Group(); g.position.set(AX, AY, AZ); g.visible = false;
  const dark = new THREE.MeshStandardMaterial({ color: 0x10121b, roughness: 0.5, metalness: 0.85, flatShading: true });
  const pcb = canvasTex(1024, 1024, (c, w, h) => {
    c.fillStyle = '#04060c'; c.fillRect(0, 0, w, h); c.translate(w / 2, h / 2); c.strokeStyle = '#fff'; c.fillStyle = '#fff';
    c.globalAlpha = 0.25; c.lineWidth = 1; for (let i = -512; i <= 512; i += 64) { c.beginPath(); c.moveTo(i, -512); c.lineTo(i, 512); c.stroke(); c.beginPath(); c.moveTo(-512, i); c.lineTo(512, i); c.stroke(); }
    c.globalAlpha = 0.85;
    for (const [r, lw] of [[498, 8], [470, 2], [330, 2], [190, 3], [90, 4]]) { c.lineWidth = lw; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.stroke(); }
    c.lineWidth = 3;
    for (let n = 0; n < 40; n++) {
      let x = rnd(-420, 420), y = rnd(-420, 420); c.beginPath(); c.moveTo(x, y);
      for (let k = 0; k < 4; k++) { if (Math.random() < 0.5) x += rnd(-120, 120); else y += rnd(-120, 120); c.lineTo(x, y); }
      c.stroke(); c.beginPath(); c.arc(x, y, 7, 0, TAU); c.fill();
    }
    for (let i = 0; i < 16; i++) { const a = (i / 16) * TAU; c.save(); c.translate(Math.cos(a) * 400, Math.sin(a) * 400); c.rotate(a); c.fillRect(-22, -5, 44, 10); c.restore(); }
  });
  const floorMat = new THREE.MeshStandardMaterial({ map: pcb, emissiveMap: pcb, emissive: 0x38f2ff, emissiveIntensity: 1.0, roughness: 0.45, metalness: 0.6 });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(R, 96).rotateX(-PI / 2), floorMat); floor.position.y = 0.02; floor.receiveShadow = true; g.add(floor);
  const under = new THREE.Mesh(new THREE.CylinderGeometry(R + 1.5, 8, 34, 32), dark); under.position.y = -17; g.add(under);
  const edgeMat = new THREE.MeshBasicMaterial({ color: 0x38f2ff });
  const edge = new THREE.Mesh(new THREE.TorusGeometry(R, 0.45, 8, 120).rotateX(PI / 2), edgeMat); edge.position.y = 0.3; g.add(edge);
  const racks = [];
  const scrM = new THREE.MeshBasicMaterial({ color: 0x38f2ff, toneMapped: false });
  for (let i = 0; i < 16; i++) {
    const a = ((i + 0.5) / 16) * TAU, rg = new THREE.Group(); rg.position.set(Math.cos(a) * (R + 3), 0, Math.sin(a) * (R + 3)); rg.rotation.y = PI / 2 - a;
    const b = new THREE.Mesh(new THREE.BoxGeometry(4, 13, 3), dark); b.position.y = 6.5; b.castShadow = true; rg.add(b);
    const sc = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 10), scrM); sc.position.set(0, 6.5, -1.52); sc.rotation.y = PI; rg.add(sc);
    const top = new THREE.Mesh(new THREE.OctahedronGeometry(0.8, 0), edgeMat); top.position.y = 14.2; top.scale.y = 1.8; rg.add(top);
    g.add(rg); racks.push(rg);
  }
  const voidMat = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.95, depthWrite: false, fog: false });
  const voidRing = new THREE.Mesh(new THREE.RingGeometry(1, 3, 96).rotateX(-PI / 2), voidMat); voidRing.position.y = 0.085; voidRing.visible = false; voidRing.renderOrder = 2; g.add(voidRing);
  const rimMat = new THREE.MeshBasicMaterial({ color: 0xff4fd8, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const rim = new THREE.Mesh(new THREE.RingGeometry(0.975, 1, 96).rotateX(-PI / 2), rimMat); rim.position.y = 0.09; rim.visible = false; g.add(rim);
  const farP = [];
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * TAU + rnd(-0.2, 0.2), d = rnd(150, 200), m = new THREE.Mesh(new THREE.PlaneGeometry(rnd(26, 40), rnd(16, 24)), new THREE.MeshBasicMaterial({ map: screenTex, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false, toneMapped: false }));
    m.position.set(Math.cos(a) * d, rnd(20, 110), Math.sin(a) * d); m.lookAt(0, 40, 0); g.add(m); farP.push({ m, y: m.position.y, ph: rnd(0, TAU) });
  }
  const domeTex = canvasTex(1024, 512, (c, w, h) => {
    const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#020208'); gr.addColorStop(0.6, '#0a0a24'); gr.addColorStop(0.85, '#1a0d33'); gr.addColorStop(1, '#07050f');
    c.fillStyle = gr; c.fillRect(0, 0, w, h); c.font = '12px monospace';
    for (let i = 0; i < 130; i++) {
      const x = rnd(0, w), y0 = rnd(0, h * 0.8), n = 4 + ((Math.random() * 12) | 0);
      for (let k = 0; k < n; k++) { c.fillStyle = k === n - 1 ? '#bff' : '#38f2ff'; c.globalAlpha = (k / n) * 0.5; c.fillText(Math.random() < 0.5 ? '0' : '1', x, y0 + k * 13); }
    }
    c.globalAlpha = 1; c.fillStyle = '#fff'; for (let i = 0; i < 260; i++) { c.globalAlpha = rnd(0.2, 0.8); c.fillRect(rnd(0, w), rnd(0, h * 0.7), 1.5, 1.5); }
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(330, 24, 16), new THREE.MeshBasicMaterial({ map: domeTex, side: THREE.BackSide, fog: false, depthWrite: false }));
  dome.renderOrder = -20; dome.frustumCulled = false;
  const col = new THREE.Color();
  return {
    group: g, dome, floorMat, racks, farP,
    setPalette(hex) { col.setHex(hex); edgeMat.color.copy(col); floorMat.emissive.copy(col); scrM.color.copy(col); rimMat.color.copy(col); },
    setCollapse(r) { const on = r < R - 0.01; voidRing.visible = rim.visible = on; if (on) { voidRing.scale.setScalar(r); rim.scale.setScalar(r); } },
    rise(p) { racks.forEach((rk, i) => { const k = outBack(prog(p, i / 28, i / 28 + 0.45)); rk.scale.set(1, Math.max(0.001, k), 1); }); },
    update(t, dt, cam) {
      edge.position.y = 0.3 + Math.sin(t * 2) * 0.05;
      for (const f of farP) f.m.position.y = f.y + Math.sin(t * 0.3 + f.ph) * 4;
      scrM.opacity = 1; rimMat.opacity = 0.6 + 0.4 * Math.sin(t * 9);
      dome.position.copy(cam.position); dome.scale.setScalar(Math.max(0.3, (cam.far * 0.9) / 330));
    },
  };
}

// ======================================================================
//  UI (boss bar, firewall/panic status, terminal tracker, live console, boot screen, cards, end screen)
// ======================================================================
const CSS = `
#dvUI{position:fixed;inset:0;z-index:40;pointer-events:none;display:none;font-family:system-ui,sans-serif;color:#fff}
#dvUI.on{display:block}
#dvUI *{box-sizing:border-box}
.dv-bar{position:absolute;top:calc(env(safe-area-inset-top,0px) + 68px);left:50%;transform:translateX(-50%);width:min(340px,44vw);text-shadow:0 1px 4px #000;transition:opacity .7s,transform .7s}
.dv-bar.off{opacity:0;transform:translate(-50%,-16px)}
.dv-nm{display:flex;justify-content:center;font:800 10px monospace;letter-spacing:.3em;color:#bff}
.dv-tr{position:relative;height:7px;margin-top:3px;background:rgba(2,8,16,.88);border:1px solid rgba(80,255,255,.8);box-shadow:0 0 10px rgba(56,242,255,.4)}
.dv-fill,.dv-trail{position:absolute;inset:0;transform-origin:left center}
.dv-fill{background:linear-gradient(90deg,#38f2ff,#ff4fd8);transition:transform .12s}
.dv-trail{background:rgba(255,255,255,.55);transition:transform .9s .25s}
.dv-tick{position:absolute;top:-2px;bottom:-2px;width:1px;background:#fff;opacity:.7}
.dv-st{display:flex;justify-content:space-between;font:700 9px monospace;letter-spacing:.14em;margin-top:3px;min-height:11px}
.dv-fw{color:#4dff9a}.dv-fw.hot{color:#ff5a5a;animation:dvBl .5s steps(2) infinite}.dv-lv{color:#ff9af0}
@keyframes dvBl{50%{opacity:.35}}
.dv-tm{text-align:center;font:800 10px monospace;letter-spacing:.2em;margin-top:5px;color:#4dff9a;text-shadow:0 0 10px rgba(77,255,154,.8);opacity:0;transition:opacity .2s}
.dv-tm.on{opacity:1}
.dv-con{position:absolute;left:calc(env(safe-area-inset-left,0px) + 10px);bottom:calc(env(safe-area-inset-bottom,0px) + 128px);width:min(360px,48vw);font:600 10px monospace;color:#4dff9a;text-shadow:0 0 6px rgba(77,255,154,.7);opacity:.85}
.dv-ln{overflow:hidden;white-space:nowrap;width:0;animation:dvType .55s steps(44) forwards}
@keyframes dvType{to{width:var(--n)}}
.dv-pop{position:absolute;left:0;right:0;top:42%;text-align:center;font:900 clamp(12px,2.4vw,20px) monospace;letter-spacing:.2em;color:#d8fff4;text-shadow:0 0 14px rgba(77,255,200,.95),0 2px 6px #000;opacity:0}
.dv-pop.show{animation:dvPop .95s ease both}
@keyframes dvPop{0%{opacity:0;transform:translateY(8px) scale(.8)}15%{opacity:1;transform:translateY(0) scale(1.1)}100%{opacity:0;transform:translateY(-26px) scale(1)}}
.dv-card{position:absolute;left:0;right:0;top:30%;text-align:center;opacity:0;text-shadow:0 0 30px rgba(56,242,255,.9),0 4px 10px #000}
.dv-card h1{margin:0;font:900 clamp(24px,6vw,60px) monospace;letter-spacing:.28em;color:#fff}
.dv-card p{margin:8px 0 0;font:700 clamp(11px,2vw,18px) monospace;letter-spacing:.32em;opacity:.9;color:#ff9af0}
.dv-card.show{animation:dvCard var(--d,3s) ease both}
@keyframes dvCard{0%{opacity:0;transform:scale(1.25)}10%{opacity:1;transform:scale(1)}80%{opacity:1}100%{opacity:0}}
.dv-flash{position:absolute;inset:0;opacity:0;background:#fff}
.dv-hint{position:absolute;left:0;right:0;top:calc(env(safe-area-inset-top,0px) + 118px);text-align:center;font:800 12px monospace;letter-spacing:.18em;text-shadow:0 2px 8px #000;opacity:0;transition:opacity .25s;color:#bff}
.dv-hint.on{opacity:1}
.dv-gl{position:absolute;inset:0;display:none;background:repeating-linear-gradient(0deg,rgba(255,255,255,.08) 0 2px,transparent 2px 5px);mix-blend-mode:screen;animation:dvGl .1s steps(2) infinite}
.dv-gl.on{display:block}
@keyframes dvGl{0%{transform:translate(0,0);filter:hue-rotate(0)}50%{transform:translate(6px,-3px);filter:hue-rotate(90deg)}100%{transform:translate(-5px,2px);filter:hue-rotate(200deg)}}
.dv-boot{position:absolute;inset:0;display:none;background:#000;padding:max(8vh,40px) 7vw;font:700 clamp(11px,1.9vw,17px) monospace;color:#4dff9a;line-height:1.7;text-shadow:0 0 8px rgba(77,255,154,.8)}
.dv-boot.on{display:block}
.dv-dead{position:absolute;inset:0;display:none;align-items:center;justify-content:center;flex-direction:column;background:radial-gradient(circle,rgba(0,10,30,.35),rgba(0,0,0,.8))}
.dv-dead.on{display:flex}
.dv-dead h2{margin:0;font:900 clamp(26px,6vw,46px) monospace;letter-spacing:.3em}.dv-dead p{opacity:.8;letter-spacing:.2em;font-family:monospace}
.dv-end{position:absolute;inset:0;display:none;overflow:auto;-webkit-overflow-scrolling:touch;background:rgba(2,4,12,.88);pointer-events:auto}
.dv-end.on{display:block}
.dv-box{width:min(92vw,520px);margin:max(3vh,10px) auto;padding:18px 20px;text-align:center;border:1px solid rgba(80,255,255,.55);background:rgba(4,8,18,.95);box-shadow:0 0 50px rgba(56,242,255,.3);font-family:monospace}
.dv-box h2{margin:0 0 6px;font-size:clamp(18px,5vw,30px);letter-spacing:.14em;line-height:1.2;color:#dffffa}
.dv-box p{margin:4px 0;letter-spacing:.08em;opacity:.85;font-size:13px}
.dv-btns{display:flex;gap:10px;justify-content:center;margin-top:14px;flex-wrap:wrap}
.dv-btns button{flex:1 1 150px;min-height:46px;padding:.6rem 1rem;font:800 13px monospace;letter-spacing:.12em;color:#fff;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.35);border-radius:6px;cursor:pointer}
.dv-btns button.go{background:#38f2ff;border-color:#38f2ff;color:#02141a}`;

function createUi({ onRetry, onLobby }) {
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const el = document.createElement('div'); el.id = 'dvUI';
  el.innerHTML =
    '<div class="dv-gl"></div>' +
    '<div class="dv-bar off"><div class="dv-nm"><b>' + DEV.NAME + '</b></div>' +
    '<div class="dv-tr"><div class="dv-trail"></div><div class="dv-fill"></div><u class="dv-tick" style="left:66%"></u><u class="dv-tick" style="left:33%"></u></div>' +
    '<div class="dv-st"><span class="dv-ph"></span><span class="dv-fw"></span><span class="dv-lv"></span></div><div class="dv-tm"></div></div>' +
    '<div class="dv-con"></div><div class="dv-pop"></div><div class="dv-card"><h1></h1><p></p></div><div class="dv-flash"></div><div class="dv-hint"></div>' +
    '<div class="dv-boot"></div>' +
    '<div class="dv-dead"><h2>YOU DIED</h2><p class="dv-deadp"></p></div>' +
    '<div class="dv-end"><div class="dv-box"><h2 class="dv-et"></h2><p class="dv-ep"></p><p class="dv-es"></p>' +
    '<div class="dv-btns"><button class="go dv-retry">FIGHT AGAIN (R)</button><button class="dv-lobby">BACK TO LOBBY</button></div></div></div>';
  document.body.appendChild(el);
  const q = (s) => el.querySelector(s);
  const bar = q('.dv-bar'), fill = q('.dv-fill'), trail = q('.dv-trail'), ph = q('.dv-ph'), fw = q('.dv-fw'), lv = q('.dv-lv'), tm = q('.dv-tm'), con = q('.dv-con'), pop = q('.dv-pop');
  const card = q('.dv-card'), flash = q('.dv-flash'), hint = q('.dv-hint'), dead = q('.dv-dead'), end = q('.dv-end'), gl = q('.dv-gl'), boot = q('.dv-boot');
  q('.dv-retry').addEventListener('click', () => onRetry());
  q('.dv-lobby').addEventListener('click', () => onLobby());
  let lastHp = '', hintT = 0, glT = 0, bootTimers = [];
  return {
    show() { el.classList.add('on'); },
    hide() { el.classList.remove('on'); end.classList.remove('on'); dead.classList.remove('on'); hint.classList.remove('on'); flash.style.opacity = 0; bar.classList.add('off'); gl.classList.remove('on'); boot.classList.remove('on'); tm.classList.remove('on'); con.textContent = ''; bootTimers.forEach(clearTimeout); bootTimers = []; },
    bar(on) { bar.classList.toggle('off', !on); },
    setHp(f) { const v = f.toFixed(3); if (v !== lastHp) { lastHp = v; fill.style.transform = `scaleX(${v})`; trail.style.transform = `scaleX(${v})`; } },
    setPhase(p) { ph.textContent = 'PHASE ' + ['I', 'II', 'III'][p - 1]; },
    setFw(t, hot) { if (fw.textContent !== t) fw.textContent = t; fw.classList.toggle('hot', !!hot); },
    setLives(n) { lv.textContent = '★'.repeat(Math.max(0, n)) + '☆'.repeat(Math.max(0, DEV.LIVES - n)); },
    terms(t) { tm.textContent = t; tm.classList.toggle('on', !!t); },
    cmd(t) { const d = document.createElement('div'); d.className = 'dv-ln'; d.textContent = '$ ' + t; d.style.setProperty('--n', (t.length + 2) + 'ch'); con.appendChild(d); while (con.children.length > 5) con.firstChild.remove(); },
    pop(t) { pop.textContent = t; pop.classList.remove('show'); void pop.offsetWidth; pop.classList.add('show'); },
    card(t, s, sec = 3) { card.querySelector('h1').textContent = t; card.querySelector('p').textContent = s || ''; card.style.setProperty('--d', sec + 's'); card.classList.remove('show'); void card.offsetWidth; card.classList.add('show'); },
    flash(color, a, sec) { flash.style.background = color; flash.style.transition = 'none'; flash.style.opacity = a; void flash.offsetWidth; flash.style.transition = `opacity ${sec}s ease-out`; flash.style.opacity = 0; },
    hint(t, sec = 3) { hint.textContent = t; hint.classList.add('on'); hintT = sec; },
    glitch(sec) { gl.classList.add('on'); glT = Math.max(glT, sec); },
    boot(lines, step) { boot.textContent = ''; boot.classList.add('on'); lines.forEach((l, i) => bootTimers.push(setTimeout(() => { const d = document.createElement('div'); d.textContent = l; boot.appendChild(d); }, i * step * 1000))); },
    bootOff() { boot.classList.remove('on'); bootTimers.forEach(clearTimeout); bootTimers = []; },
    tick(dt) { if (hintT > 0) { hintT -= dt; if (hintT <= 0) hint.classList.remove('on'); } if (glT > 0) { glT -= dt; if (glT <= 0) gl.classList.remove('on'); } },
    dead(on, left) { dead.classList.toggle('on', !!on); if (on) q('.dv-deadp').textContent = left > 0 ? `${left} ${left === 1 ? 'LIFE' : 'LIVES'} LEFT` : ''; },
    end(win, stats) {
      q('.dv-et').textContent = win ? 'THE DEV HAS LOGGED OFF' : 'ACCESS DENIED';
      q('.dv-ep').textContent = win ? 'GG. No patch notes. See you in the next update.' : 'The Dev pushed straight to main.';
      const m = Math.floor(stats.time / 60), s = Math.floor(stats.time % 60);
      q('.dv-es').textContent = `TIME ${m}:${String(s).padStart(2, '0')}  ·  DEATHS ${stats.deaths}  ·  DAMAGE TAKEN ${Math.round(stats.taken)}  ·  KERNEL PANICS ${stats.panics}`;
      end.classList.add('on');
    },
    hideEnd() { end.classList.remove('on'); },
  };
}

// ======================================================================
//  THE BOSS
// ======================================================================
export function createDev(deps) {
  const { scene, camera, renderer, world, audio, player, ctrl, viewmodel, playerMesh, onExit, onWin, weapons: W } = deps;
  const AX = world.arena.x, AZ = world.arena.z, AY = Math.round(heightAt(AX, AZ)) + DEV.SKY, R0 = DEV.R;
  const targets = [];
  const _v = new THREE.Vector3(), _cp = new THREE.Vector3(), _cq = new THREE.Quaternion(), _m4 = new THREE.Matrix4(), _lq = new THREE.Quaternion(), _upV = new THREE.Vector3(0, 1, 0), _dm = new THREE.Object3D(), _c = new THREE.Color();
  let built = false, fx = null, sfx = null, ui = null, rig = null, arena = null, hemi = null, screen = null, tx = null, cursor = null, popRoot = null;
  let savedSpawns = null, saved = null, floorCol = null, bI = null, gI = null, bHead = 0, tileK = 0;
  const S = {}, B = [], BN = 560, popPool = [], ghosts = [], tilePool = [], zonePool = [], wallPool = [], termPool = [];
  const ctxFake = { player, enemies: [], audio: { play() {} }, bullets: null, net: null, build: null };
  const sunDirV = new THREE.Vector3();
  const CDK = ['ammoCd', 'swapCd', 'undoCd', 'gravCd', 'colCd'];

  const vol = (x, z) => clamp(1.15 - Math.hypot(x - player.x, z - player.z) / 140, 0.3, 1);
  const shake = (a, x = S.x, z = S.z) => { S.trauma = Math.min(1, S.trauma + a * clamp(1.2 - Math.hypot(x - player.x, z - player.z) / 70, 0.15, 1)); };
  const later = (t, fn) => S.later.push({ t, fn });
  const cy = () => AY + S.h + S.bob + 1.2;                // the core (where attacks come from)
  const airH = () => player.y - AY;
  const cmd = (t) => { ui.cmd(t); screen.st.cmd = t; sfx.key(); };
  const pose = (n) => { S.poseName = n; };

  function reset() {
    Object.assign(S, {
      on: false, frozen: false, state: 'off', phase: 1, hp: DEV.HP, maxHp: DEV.HP, alive: false, invuln: true,
      x: AX, z: AZ, h: 18, hT: 18, bob: 0, yaw: 0, yawFix: false, t: 0, dt: 0.016, cd: 2, hist: [], runner: null, later: [],
      waves: [], zones: [], tiles: [], walls: [], pops: [], terms: [], pick: [], trauma: 0, imp: { x: 0, z: 0 }, arenaR: R0, colR: R0,
      deaths: 0, lastDeaths: 0, hitFlash: 0, fwHit: 0, jolt: 0, cine: null, cineT: 0, result: null, stats: { taken: 0, time: 0, dealt: 0, panics: 0 },
      atk: null, fightT: 0, dead: false, deflectT: 0, chipT: -99, panic: 0, panicMax: 1, termCd: 9, termT: 0, termTot: 0,
      cast: 0, castSm: 0, slump: 0, slumpSm: 0, fwSm: 1, ammoLock: 0, saved: null, wLock: 0, wSnap: null, grav: 0,
      daemon: 2, pickT: 16, pickN: 0, dark: 0, darkT: 0, palette: STAGE[1], bursting: false, eyeO: 1, led: 0, earF: 0, keySlam: 0, ghostA: 0,
      ammoCd: 0, swapCd: 6, undoCd: 4, gravCd: 8, colCd: 40, cur: { on: false, x: 0, y: 0, z: 0, s: 1 }, sweepHit: 0,
      poseName: '', pv: { L: [0.16, 0.19, 0.6], R: [-0.16, 0.19, 0.6], lw: 0, rw: 0, lean: 0, tilt: 0, twist: 0, lid: 0, a: 0, f: 1, tA: 0, tF: 1 },
    });
    S.vis = { dev: 1, panels: 1, sigil: 1 };
  }
  reset();

  // ---------------- build (lazy, first entry only) ----------------
  function build() {
    if (built) return;
    built = true;
    fx = createFx(scene, camera, renderer); tx = fx.tx; sfx = createSfx(audio); screen = createScreen();
    ui = createUi({ onRetry: () => retry(), onLobby: () => onExit('Back in the lobby') });
    rig = buildDev(tx, screen.tex); rig.root.visible = false; scene.add(rig.root);
    arena = buildArena(AX, AY, AZ, R0, tx, screen.tex); scene.add(arena.group, arena.dome); arena.dome.visible = false;
    hemi = new THREE.HemisphereLight(0x8fb0ff, 0x120a1c, 0.9);
    rig.hits.forEach((m, i) => targets.push(makeTarget(m, 'dev' + i, m.userData.kind, () => Math.max(1, S.hp), (d, t) => takeHit(d, t))));
    for (let i = 0; i < 6; i++) { const g = makeGhost(rig); scene.add(g); ghosts.push(g); }
    // bullets
    bI = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.5, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false }), BN);
    gI = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }), BN);
    bI.frustumCulled = gI.frustumCulled = false;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < BN; i++) { B.push({ on: false, i, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, r: 0.5, dmg: 10, t: 0, sw: null, spl: 0, splT: 0, home: 0, col: 0xffffff }); bI.setMatrixAt(i, zero); gI.setMatrixAt(i, zero); bI.setColorAt(i, _c.setHex(0xffffff)); gI.setColorAt(i, _c); }
    fx.root.add(bI, gI);
    // mouse cursor (billboarded, huge)
    const sh = new THREE.Shape();
    [[0, 0], [0, -16], [4, -12.5], [7, -19.5], [10, -18.5], [7, -11.5], [12, -11.5]].forEach(([x, y], i) => (i ? sh.lineTo(x * 0.5, y * 0.5) : sh.moveTo(x * 0.5, y * 0.5)));
    sh.closePath();
    const cg = new THREE.ExtrudeGeometry(sh, { depth: 0.8, bevelEnabled: false });
    cursor = new THREE.Group();
    const cw = new THREE.Mesh(cg, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false })), cb = new THREE.Mesh(cg, new THREE.MeshBasicMaterial({ color: 0x000000, fog: false }));
    cb.scale.set(1.25, 1.18, 0.8); cb.position.set(-0.7, 0.8, -0.4); cursor.add(cb, cw); cursor.visible = false; cursor.traverse((o) => { o.frustumCulled = false; }); scene.add(cursor);
    // popups
    popRoot = new THREE.Group(); scene.add(popRoot);
    const popTex = [['ERROR 0x80070005', 'ACCESS DENIED'], ['WARNING', 'YOUR SKILL IS OUTDATED'], ['404', 'PLAYER NOT FOUND']].map(([a, b]) => canvasTex(256, 170, (g, w, h) => {
      g.fillStyle = '#10131c'; g.fillRect(0, 0, w, h); g.fillStyle = '#c4262e'; g.fillRect(0, 0, w, 28); g.fillStyle = '#fff'; g.font = 'bold 15px monospace'; g.fillText(a, 8, 19);
      g.fillStyle = '#ff3b3b'; g.fillRect(w - 30, 3, 24, 22); g.fillStyle = '#fff'; g.fillText('X', w - 24, 20);
      g.fillStyle = '#ffd24a'; g.font = 'bold 34px monospace'; g.fillText('!', 20, 86); g.fillStyle = '#e8eeff'; g.font = 'bold 14px monospace'; g.fillText(b, 52, 76);
      g.fillStyle = '#2b3350'; g.fillRect(w / 2 - 34, h - 46, 68, 30); g.fillStyle = '#fff'; g.fillText('OK', w / 2 - 10, h - 26); g.strokeStyle = '#ff4a4a'; g.lineWidth = 4; g.strokeRect(2, 2, w - 4, h - 4);
    }));
    for (let i = 0; i < 8; i++) {
      const g = new THREE.Group(), pl = new THREE.Mesh(new THREE.PlaneGeometry(6, 4), new THREE.MeshBasicMaterial({ map: popTex[i % 3], side: THREE.DoubleSide, toneMapped: false, fog: false }));
      const hm = new THREE.Mesh(new THREE.BoxGeometry(6, 4, 0.8), rig.M.hit); hm.visible = false; hm.userData.hitZone = 'body'; hm.userData.kind = 'popup';
      pl.frustumCulled = hm.frustumCulled = false; g.add(pl, hm); g.visible = false; popRoot.add(g);
      const P = { g, hit: hm, on: false }; P.target = makeTarget(hm, 'dev-pop' + i, 'popup', () => 1e6, (d, t) => { if (t.pop) closePop(t.pop); }); popPool.push(P); targets.push(P.target);
    }
    // void tiles
    const sq = new THREE.PlaneGeometry(1, 1).rotateX(-PI / 2);
    for (let i = 0; i < 60; i++) {
      const g = new THREE.Group(), base = new THREE.Mesh(sq, new THREE.MeshBasicMaterial({ map: tx.tile, transparent: true, depthWrite: false, fog: false })), glow = new THREE.Mesh(sq, new THREE.MeshBasicMaterial({ color: 0xff2a2a, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      base.renderOrder = 3; glow.renderOrder = 4; glow.position.y = 0.02; g.add(base, glow); g.visible = false; fx.root.add(g); tilePool.push({ g, base, glow, use: false, rec: null });
    }
    // hazard zones (memory leaks)
    for (let i = 0; i < 12; i++) {
      const g = new THREE.Group(), pg = new THREE.PlaneGeometry(2, 2).rotateX(-PI / 2);
      const f = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ map: tx.fill, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      const r = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ map: tx.ring, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      f.renderOrder = r.renderOrder = 3; g.add(f, r); g.visible = false; fx.root.add(g); zonePool.push({ g, f, r, use: false });
    }
    // firewall walls
    for (let i = 0; i < 10; i++) {
      const g = new THREE.Group(), b = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xff4fd8, transparent: true, opacity: 0.28, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0xffffff, fog: false }));
      b.position.y = 0.5; e.position.y = 0.5; b.frustumCulled = e.frustumCulled = false; g.add(b, e); g.visible = false; fx.root.add(g); wallPool.push({ g, b, e, use: false });
    }
    // terminals
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group(), pg = new THREE.PlaneGeometry(2, 2).rotateX(-PI / 2);
      const ring = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ map: tx.ring, color: 0x38f2ff, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })); ring.scale.setScalar(4.6); ring.position.y = 0.12;
      const fill = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ map: tx.fill, color: 0x4dff9a, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })); fill.position.y = 0.14;
      const pyl = new THREE.Mesh(new THREE.BoxGeometry(1.4, 4.6, 1.4), new THREE.MeshStandardMaterial({ color: 0x12141e, metalness: 0.8, roughness: 0.4 })); pyl.position.y = 2.3;
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 2.4), new THREE.MeshBasicMaterial({ color: 0x38f2ff, toneMapped: false, side: THREE.DoubleSide })); scr.position.set(0, 2.6, 0.72);
      const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 100, 10, 1, true), new THREE.MeshBasicMaterial({ color: 0x38f2ff, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide })); beam.position.y = 52;
      g.add(ring, fill, pyl, scr, beam); g.visible = false; g.traverse((o) => { o.frustumCulled = false; }); fx.root.add(g); termPool.push({ g, ring, fill, scr, beam, use: false });
    }
    addEventListener('keydown', (e) => { if (S.on && S.result && e.code === 'KeyR') retry(); });
    fx.setFloor(AY);
  }
  function makeTarget(mesh, id, kind, getHp, onHit) {
    const t = {
      id, name: DEV.NAME, mesh, kind, team: 0, isLeader: false, serverSide: false, ctx: ctxFake, alive: false, x: AX, y: AY, z: AZ, yaw: 0, vx: 0, vz: 0, suppression: 0, markUntil: 0, radius: 1.2,
      state: 'engage', stateT: 0, awareness: 0, engaged: false, engagedT: 0, focus: 0, flinch: 0, lastHurt: 0, combatT: 0, focusX: 0, focusZ: 0, reactTime: 0.4, wp: null, maxHp: DEV.HP, pop: null,
    };
    Object.defineProperty(t, 'hp', { get: () => getHp(), set: (v) => { const d = Math.max(0, getHp() - v); if (d > 0) onHit(d, t); } });
    return t;
  }

  // ---------------- palette ----------------
  function setPalette(hex) {
    S.palette = hex; arena.setPalette(hex);
    const M = rig.M; M.glow.color.setHex(hex); M.keys.color.setHex(hex); M.logo.color.setHex(hex); M.ghost.color.setHex(hex); rig.shellMat.color.setHex(hex); rig.light.color.setHex(hex);
    screen.st.col = '#' + hex.toString(16).padStart(6, '0');
    rig.panels.forEach((p) => p.fr.material.color.setHex(hex));
  }

  // ---------------- damage model: the firewall absorbs bullets; a KERNEL PANIC is the weakness ----------------
  const gateHp = () => S.maxHp * (S.phase === 1 ? 0.66 : S.phase === 2 ? 0.33 : 0);
  function dmgBoss(d) {
    if (!S.alive || S.state === 'dead') return;
    S.hp = Math.max(0, S.hp - d); S.stats.dealt += d; S.hitFlash = Math.min(1, S.hitFlash + 0.2);
    if (S.hp <= 0) { kill(); return; }
    const g = gateHp();
    if (g > 0 && S.hp <= g && S.state === 'fight') { S.hp = g; S.invuln = true; }   // stop AT the gate; bullets deflect until the cutscene takes over
  }
  function takeHit(dmg, t) {
    if (!S.alive || S.state === 'dead') return;
    const hx = t.x, hy = t.y + 1.3, hz = t.z;
    if (S.invuln) { if (S.t - S.deflectT > 0.12) { S.deflectT = S.t; audio.play('clang'); } return; }
    const pn = S.panic > 0;
    const k = pn ? (t.kind === 'laptop' ? 2.5 : t.kind === 'head' ? 1.4 : 1) : (t.kind === 'laptop' ? 0.05 : t.kind === 'head' ? 0.035 : 0.02);
    if (!pn) {
      S.fwHit = 1;
      if (S.t - S.deflectT > 0.1) { S.deflectT = S.t; audio.play('clang'); fx.burst(hx, hy, hz, 5, 9, 0.4, 0.9, 0.1, 0xffffff, S.palette, { grav: 0 }); }
      if (S.t - S.chipT > 25) { S.chipT = S.t; ui.hint('FIREWALL ONLINE — HACK THE TERMINALS TO CRASH HIS LAPTOP', 4.5); }
    } else {
      S.earF = 1;
      if (S.t - S.deflectT > 0.12) { S.deflectT = S.t; fx.burst(hx, hy, hz, t.kind === 'laptop' ? 9 : 5, 10, 0.5, 1.0, 0.1, 0xffffff, t.kind === 'laptop' ? COL.amber : COL.cyan, { grav: 2 }); if (t.kind === 'laptop' && Math.random() < 0.3) ui.pop('SEGFAULT'); }
    }
    dmgBoss(dmg * k);
  }

  // ---------------- player helpers ----------------
  function hurt(dmg, sx, sz) {
    if (!player.alive || S.frozen || dmg <= 0) return false;
    const before = player.hp;
    ctrl.applyDamage(dmg, sx, sz, DEV.NAME);
    S.stats.taken += Math.max(0, before - player.hp);
    return true;
  }
  function knock(x, z, spd, up = 0) {
    const dx = player.x - x, dz = player.z - z, l = Math.hypot(dx, dz) || 1;
    S.imp.x += (dx / l) * spd; S.imp.z += (dz / l) * spd;
    if (up) { player.velY = Math.max(player.velY, up); player.onGround = false; }
  }

  // ---------------- bullets ----------------
  function bullet(x, y, z, vx, vy, vz, o = {}) {
    let b = null;
    for (let k = 0; k < BN; k++) { const j = (bHead + k) % BN; if (!B[j].on) { b = B[j]; bHead = (j + 1) % BN; break; } }
    if (!b) return null;
    b.on = true; b.x = x; b.y = y; b.z = z; b.vx = vx; b.vy = vy; b.vz = vz; b.life = o.life || 6; b.r = o.r || 0.55; b.dmg = o.dmg || 14; b.t = 0;
    b.home = o.home || 0; b.sw = o.sw || null; b.spl = o.spl || 0; b.splT = o.splT || 0; b.col = o.col ?? S.palette;
    bI.setColorAt(b.i, _c.setHex(b.col)); gI.setColorAt(b.i, _c); bI.instanceColor.needsUpdate = gI.instanceColor.needsUpdate = true;
    return b;
  }
  function splitBullet(b) {
    const sp = Math.hypot(b.vx, b.vz) * 1.12, a0 = Math.atan2(b.vz, b.vx), n = b.spl - 1;
    for (let k = -1; k <= 1; k++) { const a = a0 + k * 0.5; bullet(b.x, b.y, b.z, Math.cos(a) * sp, 0, Math.sin(a) * sp, { r: Math.max(0.5, b.r * 0.82), dmg: Math.max(11, b.dmg - 2), col: b.col, life: 5, spl: n, splT: 0.7 }); }
    fx.burst(b.x, b.y, b.z, 8, 7, 0.4, 0.9, 0.1, 0xffffff, b.col, { grav: 0 });
  }
  function updBullets(dt) {
    let any = false;
    const lim = S.arenaR + 10;
    for (let k = 0; k < BN; k++) {
      const b = B[k];
      if (!b.on) continue;
      any = true; b.t += dt;
      if (b.home > 0 && player.alive) {
        const sp = Math.hypot(b.vx, b.vz) || 1, cur = Math.atan2(b.vz, b.vx), na = cur + clamp(angDiff(Math.atan2(player.z - b.z, player.x - b.x), cur), -b.home * dt, b.home * dt);
        b.vx = Math.cos(na) * sp; b.vz = Math.sin(na) * sp; b.vy += (clamp((player.y + 1.0 - b.y) * 1.4, -14, 14) - b.vy) * Math.min(1, dt * 3);
        if (Math.random() < dt * 45) fx.add(b.x, b.y, b.z, rnd(-1, 1), rnd(-1, 1), rnd(-1, 1), 0.45, 0.8, 0.1, 0xffffff, b.col, 0.8, 0, 0.5);
      }
      let vx = b.vx, vz = b.vz;
      if (b.sw) { const l = Math.cos(b.t * b.sw.f + b.sw.ph) * b.sw.a; vx += b.sw.px * l; vz += b.sw.pz * l; }
      b.x += vx * dt; b.y += b.vy * dt; b.z += vz * dt;
      let kill = b.t > b.life || b.y < AY - 1 || Math.hypot(b.x - AX, b.z - AZ) > lim;
      if (!kill && b.spl > 0 && b.t >= b.splT) { splitBullet(b); kill = true; }
      else if (!kill && player.alive && Math.hypot(player.x - b.x, player.y + (player.crouching ? 0.7 : 1.0) - b.y, player.z - b.z) < b.r + 0.6) {
        hurt(b.dmg, b.x, b.z); knock(b.x, b.z, 3, 0); fx.burst(b.x, b.y, b.z, 6, 6, 0.4, 0.8, 0.1, 0xffffff, b.col, { grav: 0 }); kill = true;
      }
      if (kill) { b.on = false; _dm.position.set(0, 0, 0); _dm.scale.setScalar(0); _dm.updateMatrix(); bI.setMatrixAt(k, _dm.matrix); gI.setMatrixAt(k, _dm.matrix); continue; }
      _dm.position.set(b.x, b.y, b.z); _dm.rotation.set(0, 0, 0); _dm.scale.setScalar(b.r * 2); _dm.updateMatrix(); bI.setMatrixAt(k, _dm.matrix);
      _dm.scale.setScalar(b.r * 2.3); _dm.updateMatrix(); gI.setMatrixAt(k, _dm.matrix);
    }
    if (any || S.bursting) { bI.instanceMatrix.needsUpdate = gI.instanceMatrix.needsUpdate = true; }
    S.bursting = any;
  }
  function clearBullets() {
    const z = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let k = 0; k < BN; k++) { B[k].on = false; if (bI) { bI.setMatrixAt(k, z); gI.setMatrixAt(k, z); } }
    if (bI) { bI.instanceMatrix.needsUpdate = gI.instanceMatrix.needsUpdate = true; }
  }

  // ---------------- hazards ----------------
  function wave(x, z, o) {
    S.waves.push({ h: fx.wave(), x, z, y: AY + (o.y || 0), r: o.r0 ?? 1.5, v: o.v, maxR: o.maxR, w: o.w ?? 2.4, clear: o.clear ?? 0.8, wallH: o.wallH ?? 2.6, dmg: o.dmg || 0, kb: o.kb ?? 14, up: o.up ?? 0, col: o.col ?? S.palette, hit: false });
  }
  function updWaves(dt) {
    for (let i = S.waves.length - 1; i >= 0; i--) {
      const w = S.waves[i]; w.r += w.v * dt;
      const a = clamp(1 - w.r / w.maxR, 0, 1);
      w.h.place(w.x, w.y + 0.05, w.z, w.r, w.w, w.wallH * (0.6 + 0.4 * a), 0.25 + 0.75 * Math.pow(a, 0.7), w.col);
      if (!w.hit && w.dmg > 0 && player.alive) {
        const d = Math.hypot(player.x - w.x, player.z - w.z);
        if (Math.abs(d - w.r) < w.w * 0.5 + 0.5 && airH() < w.clear) { w.hit = true; hurt(w.dmg, w.x, w.z); knock(w.x, w.z, w.kb, w.up); }
      }
      if (w.r >= w.maxR) { w.h.hide(); S.waves.splice(i, 1); }
    }
  }
  function explode(x, z, r, dmg, col = S.palette) {
    sfx.boom(0.9, vol(x, z));
    fx.ball(x, AY + 1.2, z, r * 1.3, col, 0.4); fx.ball(x, AY + 0.6, z, r * 2, 0xffffff, 0.14);
    fx.burst(x, AY + 0.6, z, 22, 18, 0.8, 1.3, 0.2, 0xffffff, col, { up: 0.9, grav: 12, drag: 0.5 });
    fx.beamT(x, AY, z, x, AY + 26, z, r * 0.32, col, 0.45); fx.decal(x, z, r * 1.2, col, 1.4); fx.light(x, AY + 4, z, col, 2000, 0.3); shake(0.3, x, z);
    if (player.alive && Math.hypot(player.x - x, player.z - z) < r && airH() < 3) { hurt(dmg, x, z); knock(x, z, 12, 6); }
  }
  // void tiles (deleted floor)
  function tile(cx, cz, size, warn, life) {
    let T = tilePool.find((t) => !t.use);
    if (!T) { T = tilePool[tileK]; tileK = (tileK + 1) % tilePool.length; const i = S.tiles.indexOf(T.rec); if (i >= 0) S.tiles.splice(i, 1); }
    T.use = true; T.g.visible = true; T.g.position.set(cx, AY + 0.1, cz); T.g.scale.set(size, 1, size); T.base.material.opacity = 0; T.glow.material.opacity = 0;
    T.rec = { T, cx, cz, size, t: 0, warn, life, tick: 0, on: false }; S.tiles.push(T.rec);
  }
  function updTiles(dt) {
    for (let i = S.tiles.length - 1; i >= 0; i--) {
      const o = S.tiles[i], T = o.T; o.t += dt;
      if (o.t < o.warn) { const p = o.t / o.warn; T.base.material.color.setHex(0xff4a4a); T.base.material.opacity = 0.5 * p; T.glow.material.opacity = (0.15 + 0.4 * Math.abs(Math.sin(o.t * 14))) * p; }
      else if (o.t < o.warn + o.life) {
        if (!o.on) { o.on = true; sfx.glitch(vol(o.cx, o.cz) * 0.5); fx.burst(o.cx, AY + 0.5, o.cz, 8, 8, 0.6, 1, 0.1, 0xffffff, S.palette, { up: 1.2, grav: 6 }); }
        T.base.material.color.setHex(S.palette); T.base.material.opacity = 0.97; T.glow.material.opacity = 0;
        if (player.alive && Math.abs(player.x - o.cx) < o.size / 2 && Math.abs(player.z - o.cz) < o.size / 2 && airH() < 1.6) {
          o.tick -= dt; if (o.tick <= 0) { o.tick = 0.35; hurt(9, o.cx, o.cz); player.velY = Math.max(player.velY, 6); player.onGround = false; }
        }
      } else if (o.t < o.warn + o.life + 0.35) T.base.material.opacity = 0.97 * (1 - (o.t - o.warn - o.life) / 0.35);
      else { T.g.visible = false; T.use = false; S.tiles.splice(i, 1); }
    }
  }
  // memory leak zones
  function zone(x, z, r1, grow, life, dmg, col) {
    const Z = zonePool.find((q) => !q.use); if (!Z) return;
    Z.use = true; Z.g.visible = true; Z.f.material.color.setHex(col); Z.r.material.color.setHex(col);
    S.zones.push({ Z, x, z, r: 1.5, r1, grow, life, t: 0, dmg, tick: 0, col });
  }
  function updZones(dt) {
    for (let i = S.zones.length - 1; i >= 0; i--) {
      const o = S.zones[i], Z = o.Z; o.t += dt; o.r = lerp(1.5, o.r1, Math.min(1, o.t / o.grow));
      const fade = o.t > o.life - 0.8 ? Math.max(0, (o.life - o.t) / 0.8) : 1;
      Z.g.position.set(o.x, AY + 0.12, o.z); Z.g.scale.set(o.r, 1, o.r); Z.f.material.opacity = 0.3 * fade; Z.r.material.opacity = 0.95 * fade;
      if (Math.random() < dt * 14) fx.add(o.x + rnd(-o.r, o.r) * 0.8, AY + 0.4, o.z + rnd(-o.r, o.r) * 0.8, 0, rnd(3, 7), 0, 0.8, 1.2, 0.1, 0xffffff, o.col, 0.9, 0, 0.5);
      if (player.alive && Math.hypot(player.x - o.x, player.z - o.z) < o.r && airH() < 1.6 && fade > 0.5) { o.tick -= dt; if (o.tick <= 0) { o.tick = 0.3; hurt(o.dmg, o.x, o.z); } }
      if (o.t >= o.life) { Z.g.visible = false; Z.use = false; S.zones.splice(i, 1); }
    }
  }
  // firewall walls (real colliders)
  function wall(x, z, w, d, h, life, warn) {
    const W2 = wallPool.find((q) => !q.use); if (!W2) return;
    W2.use = true;
    fx.tele('rect', { x, z: z - d / 2, dx: 0, dz: 1, len: d, w, dur: warn, col: COL.amber });
    S.walls.push({ W: W2, x, z, w, d, h, life, t: 0, warn, col: null, up: 0 });
  }
  function updWalls(dt) {
    for (let i = S.walls.length - 1; i >= 0; i--) {
      const o = S.walls[i], W2 = o.W; o.t += dt;
      if (o.t >= o.warn && !o.col && !o.gone) {
        if (player.alive && Math.abs(player.x - o.x) < o.w / 2 + 1.3 && Math.abs(player.z - o.z) < o.d / 2 + 1.3 && airH() < o.h) {   // eject the player instead of burying them
          const ox = o.w / 2 + 1.6 - Math.abs(player.x - o.x), oz = o.d / 2 + 1.6 - Math.abs(player.z - o.z);
          if (ox < oz) player.x += Math.sign(player.x - o.x || 1) * ox; else player.z += Math.sign(player.z - o.z || 1) * oz;
          hurt(22, o.x, o.z);
        }
        o.col = addCollider(o.x, o.z, o.w, AY + o.h, o.d, { y0: AY, noCover: false });
        W2.g.visible = true; W2.g.position.set(o.x, AY, o.z); sfx.thump(vol(o.x, o.z)); shake(0.1, o.x, o.z);
        fx.burst(o.x, AY + 1, o.z, 16, 10, 0.7, 1.2, 0.1, 0xffffff, COL.pink, { up: 1.2, grav: 8 });
      }
      if (o.col || o.gone) {
        const rise = outBack((o.t - o.warn) / 0.4), sink = o.t > o.warn + o.life ? 1 - clamp((o.t - o.warn - o.life) / 0.5, 0, 1) : 1;
        const hh = Math.max(0.001, o.h * Math.min(rise, 1.05) * sink);
        W2.g.scale.set(o.w, hh, o.d); W2.b.material.opacity = 0.18 + 0.12 * Math.sin(S.t * 8 + i);
        if (o.t > o.warn + o.life && o.col) { removeCollider(o.col); o.col = null; o.gone = true; }
        if (o.t > o.warn + o.life + 0.5) { W2.g.visible = false; W2.use = false; S.walls.splice(i, 1); }
      }
    }
  }
  function updCursor(dt) {
    const c = S.cur; cursor.visible = c.on;
    if (!c.on) return;
    cursor.position.set(c.x, c.y, c.z); cursor.quaternion.copy(camera.quaternion); cursor.scale.setScalar(c.s * 2.2);
  }
  function suck(x, y, z, n, r0, col) {
    for (let i = 0; i < n; i++) {
      const a = rnd(0, TAU), b = rnd(0, PI), r = rnd(r0 * 0.5, r0);
      fx.add(x + Math.cos(a) * Math.sin(b) * r, y + Math.cos(b) * r, z + Math.sin(a) * Math.sin(b) * r, -Math.cos(a) * Math.sin(b) * r * 2, -Math.cos(b) * r * 2, -Math.sin(a) * Math.sin(b) * r * 2, 0.5, 0.9, 0.1, 0xffffff, col, 1, 0, 0);
    }
  }
  function updPick(dt) {
    if (S.state === 'fight') { S.pickT -= dt; if (S.pickT <= 0 && S.pick.length < 2) { S.pickT = 17; pickup(S.pickN++ % 2 === 0 ? 'hp' : 'ammo'); } }
    for (let i = S.pick.length - 1; i >= 0; i--) {
      const o = S.pick[i]; o.t += dt; const col = o.kind === 'hp' ? 0x55ff99 : 0xffc247;
      o.h.set(o.x, AY + 1.5 + Math.sin(o.t * 3) * 0.3, o.z, 2.6 + Math.sin(o.t * 6) * 0.3, col, 0.95);
      if (Math.random() < dt * 20) fx.add(o.x + rnd(-0.5, 0.5), AY + 0.5, o.z + rnd(-0.5, 0.5), 0, rnd(2, 5), 0, 0.8, 0.6, 0.1, 0xffffff, col, 0.9, 0, 0.5);
      if (player.alive && Math.hypot(player.x - o.x, player.z - o.z) < 2.1 && Math.abs(player.y - AY) < 3) {
        if (o.kind === 'hp') { if (player.hp < player.maxHp) player.hp = Math.min(player.maxHp, player.hp + 45); } else if (S.ammoLock <= 0) ctrl.restock();
        audio.play('pouch'); fx.burst(o.x, AY + 1.5, o.z, 20, 8, 0.6, 1, 0.1, 0xffffff, col, { grav: 0 });
        ui.hint(o.kind === 'hp' ? '+45 HEALTH' : 'AMMO RESTOCKED', 1.5); o.h.hide(); S.pick.splice(i, 1);
      }
    }
  }
  function pickup(kind, at) {
    const a = rnd(0, TAU), r = rnd(8, S.arenaR - 9);
    S.pick.push({ kind, x: at ? at.x : AX + Math.cos(a) * r, z: at ? at.z : AZ + Math.sin(a) * r, h: fx.sprite(), t: 0 });
  }

  // ---------------- popups (ERROR windows: shoot them closed, or they fire at you and explode) ----------------
  function popup(x, y, z, life) {
    const P = popPool.find((p) => !p.on); if (!P) return;
    P.on = true; P.g.visible = true; P.g.position.set(x, y, z); P.g.scale.setScalar(0.01);
    const pop = { P, x, y, z, t: 0, life, next: rnd(0.7, 1.5), dead: false }; P.target.pop = pop; P.target.alive = true; S.pops.push(pop);
    fx.burst(x, y, z, 10, 8, 0.5, 1, 0.1, 0xffffff, COL.red, { grav: 0 }); sfx.err(0.5);
  }
  function closePop(pop) {
    if (pop.dead) return;
    pop.dead = true; pop.closed = true; const P = pop.P;
    fx.burst(pop.x, pop.y, pop.z, 24, 12, 0.7, 1.4, 0.1, 0xffffff, COL.green, { grav: 3 }); fx.ball(pop.x, pop.y, pop.z, 8, COL.green, 0.25);
    sfx.shatter(vol(pop.x, pop.z)); ui.pop('WINDOW CLOSED'); P.target.alive = false;
    if (Math.random() < 0.28) pickup(Math.random() < 0.5 ? 'hp' : 'ammo', { x: pop.x, z: pop.z });
  }
  function updPops(dt) {
    for (let i = S.pops.length - 1; i >= 0; i--) {
      const o = S.pops[i], P = o.P; o.t += dt;
      if (!o.dead) {
        P.g.position.set(o.x, o.y + Math.sin(o.t * 2 + i) * 0.4, o.z); P.g.lookAt(player.x, P.g.position.y, player.z); P.g.scale.setScalar(Math.max(0.01, outBack(o.t / 0.35)));
        o.next -= dt;
        if (o.next <= 0) {
          o.next = S.phase >= 3 ? 0.75 : 1.0;
          const dx = player.x - o.x, dy = player.y + 1.1 - o.y, dz = player.z - o.z, l = Math.hypot(dx, dy, dz) || 1;
          bullet(o.x, o.y, o.z, (dx / l) * 26, (dy / l) * 26, (dz / l) * 26, { dmg: 11, col: COL.red, life: 4 }); sfx.zap(vol(o.x, o.z) * 0.4);
        }
        if (o.t >= o.life) { o.dead = true; explode(o.x, o.z, 6.5, 30, COL.red); fx.burst(o.x, o.y, o.z, 20, 12, 0.6, 1.2, 0.1, 0xffffff, COL.red, { grav: 4 }); P.target.alive = false; }
      }
      if (o.dead) { P.g.visible = false; P.on = false; P.target.pop = null; P.target.alive = false; S.pops.splice(i, 1); }
    }
  }

  // ---------------- terminals: the real way to hurt him ----------------
  function startTerms() {
    const n = [3, 3, 4][S.phase - 1], pts = [];
    for (let tries = 0; tries < 60 && pts.length < n; tries++) {
      const a = rnd(0, TAU), r = rnd(14, S.arenaR - 9), x = AX + Math.cos(a) * r, z = AZ + Math.sin(a) * r;
      if (pts.every((p) => Math.hypot(p.x - x, p.z - z) > 20) && Math.hypot(player.x - x, player.z - z) > 10) pts.push({ x, z });
    }
    while (pts.length < n) pts.push({ x: AX + (pts.length - 1) * 16, z: AZ + 14 });
    S.terms = pts.map((p, i) => { const T = termPool[i]; T.use = true; T.g.visible = true; T.g.position.set(p.x, AY, p.z); return { x: p.x, z: p.z, prog: 0, done: false, T }; });
    S.termT = S.termTot = [34, 30, 26][S.phase - 1];
    sfx.boot(1); sfx.chime(2, 1); ui.hint('HACK THE TERMINALS — STAND IN THE RINGS', 4.5);
    for (const t of S.terms) { fx.ball(t.x, AY + 2, t.z, 14, COL.cyan, 0.5); fx.beamT(t.x, AY, t.z, t.x, AY + 70, t.z, 2, COL.cyan, 0.8); }
  }
  function clearTerms() { for (const t of S.terms) { t.T.use = false; t.T.g.visible = false; } S.terms.length = 0; ui.terms(''); }
  function updTerms(dt) {
    if (!S.terms.length) return;
    const hackT = [3.0, 3.5, 4.0][S.phase - 1];
    let done = 0;
    S.terms.forEach((t, i) => {
      const T = t.T, inside = player.alive && Math.hypot(player.x - t.x, player.z - t.z) < 4.6 && airH() < 3;
      if (!t.done) {
        t.prog = clamp(t.prog + (inside ? dt / hackT : -dt * 0.5), 0, 1);
        if (inside && Math.random() < dt * 30) fx.add(t.x + rnd(-3, 3), AY + 0.3, t.z + rnd(-3, 3), 0, rnd(5, 12), 0, 0.7, 1, 0.1, 0xffffff, COL.green, 1, 0, 0.5);
        if (t.prog >= 1) { t.done = true; sfx.chime(i * 2 + 1, 1); ui.pop('TERMINAL ' + (S.terms.filter((q) => q.done).length) + '/' + S.terms.length + ' HACKED'); fx.ball(t.x, AY + 2, t.z, 16, COL.green, 0.5); fx.burst(t.x, AY + 2, t.z, 30, 14, 0.8, 1.4, 0.1, 0xffffff, COL.green, { grav: 2 }); }
      }
      if (t.done) done++;
      const c = t.done ? COL.green : S.palette;
      T.ring.material.color.setHex(c); T.ring.material.opacity = 0.6 + 0.3 * Math.sin(S.t * 6 + i); T.fill.scale.setScalar(Math.max(0.001, 4.4 * (t.done ? 1 : t.prog))); T.fill.material.opacity = t.done ? 0.45 : 0.35;
      T.scr.material.color.setHex(c); T.beam.material.color.setHex(c); T.beam.material.opacity = t.done ? 0.35 : 0.2 + 0.1 * Math.sin(S.t * 5 + i);
    });
    ui.terms(`TERMINALS ${done}/${S.terms.length}  ·  ${Math.ceil(S.termT)}s`);
    if (done === S.terms.length) startPanic();
  }
  function failTerms() {
    clearTerms(); S.termCd = rnd(7, 10);
    S.hp = Math.min(S.maxHp, S.hp + S.maxHp * 0.03);
    sfx.err(1); ui.card('HOTFIX DEPLOYED', 'THE DEV PATCHED THE EXPLOIT  +3% HP', 2.6); ui.glitch(0.6);
    wave(S.x, S.z, { v: 40, maxR: 52, dmg: 18, col: COL.red, wallH: 2.4, clear: 1.0, kb: 12 });
  }
  function startPanic() {
    abort(); clearHazards(); clearTerms(); S.runner = null;
    S.panic = S.panicMax = [9, 8, 7][S.phase - 1]; S.stats.panics++; S.cast = 0; S.hT = 8; S.daemon = 1;
    screen.st.mode = 'bsod'; screen.st.cmd = 'kernel_panic()';
    sfx.err(1); sfx.boom(1.6, 1); ui.flash('#2f6bff', 0.7, 0.8); ui.card('KERNEL PANIC', 'FIREWALL DOWN — HIT HIS LAPTOP', 3); ui.glitch(0.8);
    shake(0.9); wave(S.x, S.z, { v: 36, maxR: 50, dmg: 0, col: COL.blue, wallH: 4 });
    fx.burst(S.x, cy(), S.z, 70, 30, 1.2, 2, 0.2, 0xffffff, COL.blue, { grav: 2 });
    for (let i = 0; i < 14; i++) later(i * 0.06, () => fx.arc(S.x + rnd(-8, 8), cy() + rnd(-6, 8), S.z + rnd(-8, 8), S.x + rnd(-14, 14), cy() + rnd(-10, 10), S.z + rnd(-14, 14), COL.blue, 0.3, 3));
    dmgBoss(S.maxHp * 0.03);
  }
  function endPanic() {
    S.panic = 0; screen.st.mode = 'code'; S.hT = 17; S.termCd = rnd(6, 9); S.cd = 1.4; S.fwHit = 1;
    sfx.boot(1); sfx.boom(1.4, 1); ui.flash('#ffffff', 0.5, 0.6); ui.card('REBOOT', 'FIREWALL RESTORED', 2.2); shake(0.6);
    wave(S.x, S.z, { v: 38, maxR: 50, dmg: 22, col: S.palette, wallH: 3, clear: 1.2, kb: 14 });
    pickup('hp'); pickup('ammo');
  }

  // ---------------- attack toolkit ----------------
  function* during(dur, fn) { let t = 0; while (t < dur) { t += S.dt; fn(clamp(t / dur, 0, 1), S.dt); yield 0; } }
  function* slide(x, z, dur) { const sx = S.x, sz = S.z; yield* during(dur, (p) => { S.x = lerp(sx, x, ease(p)); S.z = lerp(sz, z, ease(p)); }); }
  const aimAt = (ox, oz, lead = 0.2) => Math.atan2(player.z + player.vz * lead - oz, player.x + player.vx * lead - ox);
  // aim at the player's CHEST in 3D (the old fan() flew flat at core height and could never reach the floor)
  const pitch = (ox, oy, oz, v) => ((player.y + 1.0 - oy) * v) / (Math.hypot(player.x - ox, player.z - oz) || 1);
  const fan = (n, spread, v, dmg, col, ox = S.x, oy = cy(), oz = S.z) => {
    const base = aimAt(ox, oz), vy = pitch(ox, oy, oz, v);
    for (let k = 0; k < n; k++) { const a = base + (k - (n - 1) / 2) * spread; bullet(ox, oy, oz, Math.cos(a) * v, vy, Math.sin(a) * v, { dmg, col, life: 5, r: 0.6 }); }
  };
  function ring(x, y, z, n, v, o, gapAt = null, gapW = 0.3) {
    const off = rnd(0, TAU / n);
    for (let j = 0; j < n; j++) { const th = off + (j / n) * TAU; if (gapAt !== null && Math.abs(angDiff(th, gapAt)) < gapW) continue; bullet(x, y, z, Math.cos(th) * v, 0, Math.sin(th) * v, o); }
  }
  const flash = (col, big = 1) => { fx.ball(S.x, cy(), S.z, 10 * big, col, 0.22); fx.burst(S.x, cy(), S.z, 14, 16 * big, 0.5, 1, 0.1, 0xffffff, col, { grav: 0 }); fx.light(S.x, cy(), S.z, col, 900 * big, 0.2); sfx.zap(vol(S.x, S.z)); };
  const muzzle = (col) => { fx.beamT(S.x, cy(), S.z, S.x, AY + 1, S.z, 1.2, col, 0.6); fx.decal(S.x, S.z, 9, col, 1.4); };
  // wind-up: glowing core grows, sparks spiral in, lightning crawls out
  function* charge(col, dur, rad = 16, each = null) {
    const o = fx.sprite(); S.cast = 1; sfx.charge(dur, vol(S.x, S.z));
    try {
      yield* during(dur, (p, dt) => {
        o.set(S.x, cy(), S.z, 2 + 10 * p * p, col, 0.4 + 0.6 * p); suck(S.x, cy(), S.z, 3 + ((p * 5) | 0), rad, col); S.jolt = Math.max(S.jolt, 0.2 * p); shake(0.008 + 0.02 * p);
        if (Math.random() < dt * (6 + 24 * p)) { const a = rnd(0, TAU); fx.arc(S.x, cy(), S.z, S.x + Math.cos(a) * rad * 0.8, cy() + rnd(-6, 6), S.z + Math.sin(a) * rad * 0.8, col, 0.14, 2); }
        if (each) each(p, dt);
      });
    } finally { o.hide(); }
    fx.ball(S.x, cy(), S.z, 16, 0xffffff, 0.2);
  }
  // lance: core -> floor muzzle -> beam skimming the floor (so the beam you see is the beam that hurts)
  function lanceFrom(bx, by, bz, tx2, tz2, delay, w = 3.4, dmg = 40) {
    let dx = tx2 - bx, dz = tz2 - bz; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const LEN = 100, ex = bx + dx * LEN, ez = bz + dz * LEN;
    fx.tele('rect', { x: bx, z: bz, dx, dz, len: LEN, w, dur: delay, col: COL.pink });
    later(delay, () => {
      fx.beamT(bx, by, bz, bx + dx * 4, AY + 1.2, bz + dz * 4, 1.0, 0xffa0f0, 0.4); fx.beamT(bx + dx * 4, AY + 1.2, bz + dz * 4, ex, AY + 1.2, ez, 1.3, 0xffa0f0, 0.45); fx.ball(bx, by, bz, 14, 0xffffff, 0.2);
      for (let i = 0; i < 12; i++) { const t = Math.random(); fx.add(lerp(bx, ex, t), AY + 0.6, lerp(bz, ez, t), rnd(-2, 2), rnd(2, 8), rnd(-2, 2), 0.5, 1.3, 0.1, 0xffffff, COL.pink, 1, 6, 1); }
      sfx.zap(vol(bx, bz)); shake(0.2);
      if (player.alive && segDist(player.x, player.z, bx, bz, ex, ez) < w * 0.55) { hurt(dmg, bx, bz); knock(player.x - dx * 3, player.z - dz * 3, 12, 4); }
    });
  }
  function lanceComb(n, gap, delay, dmg) {   // parallel lances, perpendicular offsets; the gaps between them are the safe spots
    const a = aimAt(S.x, S.z), px = -Math.sin(a), pz = Math.cos(a), tx0 = player.x + player.vx * 0.3, tz0 = player.z + player.vz * 0.3;
    for (let k = -n; k <= n; k++) lanceFrom(S.x + px * k * gap, cy(), S.z + pz * k * gap, tx0 + px * k * gap, tz0 + pz * k * gap, delay, 3.0, dmg);
  }

  // ===== 1. FOR LOOP: rotating bullet spiral + jump-over pulse rings =====
  function* forLoop() {
    cmd('for (let i = 0; ; i++) spawn(angle += GOLDEN * i);'); pose('spin'); S.hT = 11; muzzle(S.palette);
    yield* charge(S.palette, 0.9, 18);
    const arms = [3, 4, 5][S.phase - 1], v = [15, 17, 19][S.phase - 1], DUR = [5, 5.5, 6][S.phase - 1], x = S.x, z = S.z;
    let ang = rnd(0, TAU), dir = 1, acc = 0, pulse = 0.5;
    yield* during(DUR, (p, dt) => {
      if (S.phase >= 2 && p > 0.5 && dir === 1) { dir = -1; flash(COL.pink, 1.3); ui.glitch(0.25); }
      ang += dir * dt * (1.7 + 0.9 * p); acc += dt;
      while (acc > 0.075) { acc -= 0.075; for (let k = 0; k < arms; k++) { const th = ang + (k * TAU) / arms; bullet(x, AY + 1.0, z, Math.cos(th) * v, 0, Math.sin(th) * v, { r: 0.6, dmg: 14, col: k % 2 ? COL.pink : S.palette, life: 4.5 }); } }
      pulse -= dt; if (pulse <= 0) { pulse = 1.3; wave(x, z, { v: 20, maxR: 30, dmg: 18, col: COL.white, wallH: 1.2, clear: 1.1, kb: 10 }); sfx.thump(vol(x, z)); }
      shake(0.02);
    });
    S.cast = 0; yield 1.0;
  }

  // ===== 2. SINE WAVES: braided swaying lanes + aimed shots =====
  function* sine() {
    cmd('while (true) y = A * Math.sin(f * t + phase);'); pose('conduct'); S.hT = 12; muzzle(COL.violet);
    yield* charge(COL.violet, 0.8, 16);
    const lanes = [4, 5, 6][S.phase - 1], DUR = 6, v = [17, 19, 21][S.phase - 1]; let acc = 0, base = aimAt(S.x, S.z), shot = 1.0;
    yield* during(DUR, (p, dt) => {
      acc += dt; shot -= dt; base = lerp(base, aimAt(S.x, S.z), dt * 1.4);
      while (acc > 0.085) {
        acc -= 0.085;
        for (let k = 0; k < lanes; k++) {
          const th = base + (k - (lanes - 1) / 2) * 0.28, c = Math.cos(th), s = Math.sin(th);
          bullet(S.x, AY + 1.0, S.z, c * v, 0, s * v, { dmg: 12, col: k % 2 ? COL.pink : COL.cyan, life: 4.5, sw: { a: 9, f: 4.8, ph: k * 1.1 + (p > 0.5 ? PI : 0), px: -s, pz: c } });
        }
      }
      if (shot <= 0) { shot = S.phase >= 3 ? 0.8 : 1.1; fan(3, 0.2, 26, 13, COL.red, S.x, AY + 1.0, S.z); sfx.zap(vol(S.x, S.z)); }
      shake(0.015);
    });
    S.cast = 0; yield 1.0;
  }

  // ===== 3. ORBITAL STRIKES: line / ring / rain patterns centred on you =====
  function* rng() {
    cmd('orbital.strike(random_pattern());'); pose('raise'); S.hT = 21; yield* charge(COL.red, 0.7, 14);
    const count = [3, 4, 5][S.phase - 1], R = S.arenaR - 4;
    for (let w = 0; w < count; w++) {
      const mode = pick(['line', 'ring', 'rain']), cx = player.x + player.vx * 0.4, cz = player.z + player.vz * 0.4, hit = [];
      if (mode === 'line') { const a = rnd(0, TAU); for (let i = -6; i <= 6; i++) hit.push([cx + Math.cos(a) * i * 6.5, cz + Math.sin(a) * i * 6.5, Math.abs(i) * 0.06]); }
      else if (mode === 'ring') { for (let i = 0; i < 8; i++) { const a = (i / 8) * TAU; hit.push([cx + Math.cos(a) * 17, cz + Math.sin(a) * 17, 0]); } hit.push([cx, cz, 0.6]); }
      else for (let i = 0; i < 10; i++) hit.push([cx + rnd(-18, 18), cz + rnd(-18, 18), i * 0.1]);
      ui.hint(mode === 'line' ? 'ORBITAL LINE' : mode === 'ring' ? 'ORBITAL RING' : 'ORBITAL RAIN', 1.4);
      for (const [hx, hz, dl] of hit) {
        let x = hx, z = hz; const d = Math.hypot(x - AX, z - AZ); if (d > R) { x = AX + ((x - AX) / d) * R; z = AZ + ((z - AZ) / d) * R; }
        later(dl, () => { fx.tele('disc', { x, z, r: 6, dur: 0.85, col: COL.red }); fx.beamT(x, AY + 90, z, x, AY + 40, z, 0.3, COL.red, 0.5); });
        later(dl + 0.85, () => { explode(x, z, 6, 36, COL.pink); fx.beamT(x, AY + 90, z, x, AY, z, 1.6, 0xffa0f0, 0.3); });
      }
      yield S.phase >= 3 ? 1.5 : 1.9;
    }
    S.cast = 0; yield 1.2;
  }

  // ===== 4. RM -RF TILES: deletion ripples across the floor =====
  function* tilesAtk() {
    cmd('rm -rf ./arena/tiles/*'); pose('slam'); S.hT = 20; yield* charge(COL.red, 0.7, 14);
    const sz = 12, cells = [];
    for (let gx = -5; gx <= 4; gx++) for (let gz = -5; gz <= 4; gz++) { const cx = AX + gx * sz + sz / 2, cz = AZ + gz * sz + sz / 2; if (Math.hypot(cx - AX, cz - AZ) < S.arenaR - 2) cells.push({ cx, cz, gx, gz }); }
    const rounds = [3, 4, 4][S.phase - 1];
    for (let r = 0; r < rounds; r++) {
      const mode = S.phase === 3 && r === rounds - 1 ? 'safe' : pick(['rand', 'check', 'row', 'ripple']);
      const org = r % 2 ? { x: player.x, z: player.z } : { x: S.x, z: S.z }; let list;
      if (mode === 'safe') {
        const near = cells.slice().sort((a, b) => Math.hypot(a.cx - player.x, a.cz - player.z) - Math.hypot(b.cx - player.x, b.cz - player.z)), safe = new Set([near[0], ...shuffle(near.slice(1, 8)).slice(0, 2)]);
        list = cells.filter((c) => !safe.has(c)); ui.hint('FIND THE SAFE TILES', 2.4);
      } else if (mode === 'check') list = cells.filter((c) => ((c.gx + c.gz + r) & 1) === 0);
      else if (mode === 'row') list = cells.filter((c) => (r % 2 ? c.gx : c.gz) % 2 === 0);
      else if (mode === 'ripple') list = cells.filter((c) => (Math.floor(Math.hypot(c.cx - org.x, c.cz - org.z) / 12) + r) % 2 === 0);
      else list = cells.filter(() => Math.random() < 0.45);
      wave(org.x, org.z, { v: 55, maxR: 70, dmg: 0, col: COL.red, wallH: 0.6 });   // scan wave; tiles die as it reaches them
      list.slice(0, 58).forEach((c) => tile(c.cx, c.cz, sz - 0.4, 0.9 + Math.hypot(c.cx - org.x, c.cz - org.z) / 55, 3.2)); sfx.err(0.6);
      yield 2.1;
    }
    S.cast = 0; yield 1.0;
  }

  // ===== 5. FIREWALL: walls rise, then comb lasers cut straight through them =====
  function* wallsAtk() {
    cmd('Instantiate(Firewall, random_positions);'); pose('guard'); S.hT = 16; yield* charge(COL.amber, 0.7, 14);
    const n = [6, 8, 10][S.phase - 1];
    for (let i = 0; i < n; i++) {
      const a = rnd(0, TAU), r = rnd(8, S.arenaR - 12), x = AX + Math.cos(a) * r, z = AZ + Math.sin(a) * r;
      if (Math.hypot(player.x - x, player.z - z) < 9) continue; const h = i % 2; wall(x, z, h ? 16 : 3.2, h ? 3.2 : 16, 10, 11, 1.0);
    }
    ui.hint('FIREWALLS RISING — LASERS CUT THROUGH THEM', 2.6); yield 1.6; pose('point');
    for (let v = 0; v < S.phase + 2; v++) { S.cast = 1; lanceComb(v % 2 ? 1 : 2, 8, 0.8, 40); flash(COL.pink, 0.8); sfx.charge(0.8, vol(S.x, S.z)); yield 0.75; }
    S.cast = 0; yield 1.2;
  }

  // ===== 6. AMMO = NULL: your bullets get deleted while he sprays 3D-aimed fans =====
  function lockAmmo(d) { if (S.ammoLock <= 0) S.saved = { ammo: player.ammo, reserve: player.reserve, wid: player.weaponId }; S.ammoLock = d; }
  function restoreAmmo() {
    if (!S.saved) return;
    if (player.weaponId === S.saved.wid) { player.ammo = S.saved.ammo; player.reserve = S.saved.reserve; } else if (ctrl.restock) ctrl.restock();
    S.saved = null; S.ammoLock = 0; ui.pop('AMMO RESTORED'); sfx.boot(0.7);
  }
  function* ammoDel() {
    cmd('player.ammo = null; // bullets.delete()'); pose('hack'); S.hT = 14; S.cast = 1; sfx.err(1); ui.glitch(1.2); ui.card('NULL REFERENCE', 'YOUR AMMO WAS DELETED', 2.6);
    lockAmmo(S.phase >= 3 ? 8 : 7); ui.flash('#ff2a2a', 0.35, 0.5);
    for (let i = 0; i < 6; i++) fx.arc(player.x, player.y + 2, player.z, player.x + rnd(-6, 6), player.y + rnd(0, 6), player.z + rnd(-6, 6), COL.red, 0.25, 2);
    yield 0.5; let t = 0, n = 0;
    while (S.ammoLock > 0 && t < 9) {
      fan(7, 0.17, 24, 12, COL.red); flash(COL.red, 0.6); t += 0.7; n++;
      if (S.phase >= 2 && n % 2 === 0) ring(S.x, AY + 0.6, S.z, 26, 14, { dmg: 13, col: COL.pink, life: 4 }, rnd(0, TAU), 0.3);
      yield 0.7;
    }
    S.cast = 0; yield 0.8;
  }

  // ===== 7. GIT CHECKOUT: your weapons are swapped =====
  function* swapAtk() {
    if (!W) return;
    cmd('git checkout origin/nerf -- player.loadout'); pose('hack'); S.hT = 14; yield* charge(COL.violet, 0.5, 14);
    sfx.err(1); ui.glitch(1.0); ui.flash('#a66bff', 0.5, 0.6);
    if (S.wLock <= 0) S.wSnap = W.snapshot();
    const n = W.scramble(); S.wLock = 14; ui.card('FORCED PATCH', n ? 'NOW USING: ' + String(n).toUpperCase() : 'LOADOUT REPLACED', 2.8);
    yield 0.6;
    for (let i = 0; i < 5; i++) { fan(S.phase >= 3 ? 9 : 7, 0.15, 24, 12, COL.violet); flash(COL.violet, 0.7); yield 0.7; }
    S.cast = 0; yield 0.8;
  }

  // ===== 8. SELECT ALL -> DELETE: cursor drags a marquee (alternating wide / tall = crosses) =====
  function* marquee() {
    cmd('selection = select_all(); selection.delete();'); pose('point'); S.hT = 20; yield* charge(COL.blue, 0.6, 14); const n = [2, 3, 4][S.phase - 1];
    for (let k = 0; k < n; k++) {
      const horiz = k % 2 === 0, w = horiz ? rnd(38, 54) : rnd(15, 22), d = horiz ? rnd(15, 22) : rnd(38, 54);
      let cx = player.x + player.vx * 0.5 + rnd(-5, 5), cz = player.z + player.vz * 0.5 + rnd(-5, 5);
      cx = clamp(cx, AX - 30, AX + 30); cz = clamp(cz, AZ - 30, AZ + 30);
      const T = 1.1; fx.tele('rect', { x: cx, z: cz - d / 2, dx: 0, dz: 1, len: d, w, dur: T, col: COL.blue });
      S.cur.on = true; S.cur.s = 2.4;
      const x0 = cx - w / 2, z0 = cz - d / 2, x1 = cx + w / 2, z1 = cz + d / 2;
      yield* during(T, (p) => { S.cur.x = lerp(x0, x1, ease(p)); S.cur.z = lerp(z0, z1, ease(p)); S.cur.y = AY + 8; if (Math.random() < 0.5) fx.add(lerp(x0, x1, p), AY + 0.5, lerp(z0, z1, p), 0, 6, 0, 0.5, 1, 0.1, 0xffffff, COL.blue, 1, 0, 0.5); });
      sfx.key(1); S.cur.s = 1.9; yield 0.1; S.cur.s = 2.4;
      fx.tele('rect', { x: cx, z: cz - d / 2, dx: 0, dz: 1, len: d, w, dur: 0.5, col: COL.red }); ui.pop('DELETE'); sfx.err(0.7);
      later(0.5, () => {
        sfx.boom(1.4, 1); shake(0.7); ui.flash('#ff4a4a', 0.35, 0.4);
        for (let i = 0; i < 18; i++) { const x = cx + rnd(-w / 2, w / 2), z = cz + rnd(-d / 2, d / 2); fx.beamT(x, AY, z, x, AY + 22, z, 1.1, COL.red, 0.5); fx.burst(x, AY + 0.6, z, 6, 12, 0.7, 1, 0.1, 0xffffff, COL.red, { up: 1.3, grav: 10 }); }
        if (player.alive && Math.abs(player.x - cx) < w / 2 && Math.abs(player.z - cz) < d / 2 && airH() < 4) { hurt(50, cx, cz); knock(cx, cz, 14, 9); }
      });
      yield 0.8;
    }
    S.cur.on = false; S.cast = 0; yield 1.0;
  }

  // ===== 9. MOUSE.CLICK(): fast-tracking cursor smashes =====
  function* clickSmash() {
    cmd('mouse.moveTo(player.position); mouse.click(2);'); pose('slam'); S.hT = 19; yield* charge(COL.pink, 0.5, 12); const clicks = [3, 4, 5][S.phase - 1];
    S.cur.on = true; S.cur.s = 2.4; S.cur.x = S.x; S.cur.y = AY + 30; S.cur.z = S.z;
    for (let k = 0; k < clicks; k++) {
      const r = 7 + (k % 2) * 3; let tx2 = player.x, tz2 = player.z;
      yield* during(0.4, () => { tx2 = lerp(tx2, player.x + player.vx * 0.4, 0.25); tz2 = lerp(tz2, player.z + player.vz * 0.4, 0.25); S.cur.x = lerp(S.cur.x, tx2, 0.25); S.cur.z = lerp(S.cur.z, tz2, 0.25); S.cur.y = lerp(S.cur.y, AY + 12, 0.16); });
      fx.tele('disc', { x: tx2, z: tz2, r, dur: 0.6, col: COL.red }); const x = tx2, z = tz2;
      yield 0.6;
      yield* during(0.1, (p) => { S.cur.x = x; S.cur.z = z; S.cur.y = lerp(AY + 12, AY + 1.5, p * p); });
      sfx.thump(1); explode(x, z, r, 44, COL.pink); wave(x, z, { v: 26, maxR: 20 + r, dmg: 20, col: COL.pink, wallH: 1.6, clear: 1.0 }); S.cur.s = 1.9;
      if (S.phase >= 2) ring(x, AY + 0.6, z, 14, 13, { dmg: 12, col: COL.pink, life: 3 });
      yield 0.12; S.cur.s = 2.4; yield 0.2;
    }
    S.cur.on = false; S.cast = 0; yield 1.0;
  }

  // ===== 10. ALERT(): ERROR windows. Shoot them closed or they shoot you =====
  function* popups() {
    cmd('for (const ad of ads) window.alert(ad);'); pose('hack'); S.hT = 17; S.cast = 1; sfx.err(1); ui.glitch(0.6);
    const n = [5, 6, 8][S.phase - 1];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rnd(-0.3, 0.3), r = rnd(10, 17); let x = player.x + Math.cos(a) * r, z = player.z + Math.sin(a) * r;
      const d = Math.hypot(x - AX, z - AZ); if (d > S.arenaR - 6) { x = AX + ((x - AX) / d) * (S.arenaR - 6); z = AZ + ((z - AZ) / d) * (S.arenaR - 6); }
      popup(x, AY + rnd(3, 7), z, 9); yield 0.15;
    }
    ui.hint('SHOOT THE ERROR WINDOWS CLOSED', 3.5); let w = 0;
    while (S.pops.length && w < 12) { w += S.dt; yield 0; }
    S.cast = 0; yield 0.8;
  }

  // ===== 11. SYSTEM.GC(): rotating scan arms (jump them) + pulse rings =====
  function* sweep() {
    cmd('System.gc(); // collecting unreachable players'); pose('spin'); S.hT = 22; S.cast = 1; yield* slide(AX, AZ, 0.8);
    const n = [3, 4, 5][S.phase - 1], om = [0.8, 1.0, 1.15][S.phase - 1], DUR = 7.5, a0 = rnd(0, TAU); let dir = Math.random() < 0.5 ? 1 : -1;
    const hs = []; for (let k = 0; k < n; k++) hs.push(fx.beam());
    for (let k = 0; k < n; k++) { const a = a0 + (k * TAU) / n; fx.tele('rect', { x: AX, z: AZ, dx: Math.cos(a), dz: Math.sin(a), len: S.arenaR, w: 2.2, dur: 1.1, col: COL.pink }); }
    ui.hint('JUMP THE SCAN ARMS', 2.6); sfx.charge(1.1, 1); yield 1.1;
    let ang = a0, flipped = false, pulse = 1.0; const wr = fx.sprite(); sfx.hum(1);
    try {
      yield* during(DUR, (p, dt) => {
        if (S.phase >= 2 && !flipped && p > 0.5) { flipped = true; dir = -dir; ui.flash('#ff4fd8', 0.4, 0.3); sfx.glitch(1); }
        ang += dir * om * dt * (1 + 0.5 * p); wr.set(AX, AY + 1, AZ, 10, COL.pink, 0.8);
        pulse -= dt; if (pulse <= 0 && S.phase >= 2) { pulse = 1.2; ring(AX, AY + 0.8, AZ, 22, 14, { dmg: 13, col: COL.cyan, life: 4 }, rnd(0, TAU), 0.35); }
        for (let k = 0; k < n; k++) {
          const a = ang + (k * TAU) / n, ex = AX + Math.cos(a) * S.arenaR, ez = AZ + Math.sin(a) * S.arenaR;
          hs[k].set(AX, AY + 0.8, AZ, ex, AY + 0.8, ez, 1.0, COL.pink, 0.95);
          if (Math.random() < dt * 40) { const t = Math.random(); fx.add(lerp(AX, ex, t), AY + 0.6, lerp(AZ, ez, t), rnd(-2, 2), rnd(3, 8), rnd(-2, 2), 0.6, 1.4, 0.1, 0xffffff, COL.pink, 1, 5, 1); }
          if (S.sweepHit <= 0 && player.alive && airH() < 1.6 && segDist(player.x, player.z, AX, AZ, ex, ez) < 1.7) { S.sweepHit = 0.8; hurt(38, AX, AZ); knock(AX, AZ, 12, 6); }
        }
        S.sweepHit -= dt; shake(0.02);
      });
    } finally { hs.forEach((h) => h.hide()); wr.hide(); S.sweepHit = 0; }
    S.cast = 0; yield 1.0;
  }

  // ===== 12. FORK(): wireframe clones fire lances AND fans =====
  function* fork() {
    const n = [3, 4, 5][S.phase - 1]; cmd('const clones = fork(self, ' + n + ');'); pose('spread'); S.cast = 1; S.hT = 20; sfx.glitch(1); ui.glitch(0.5);
    const a0 = rnd(0, TAU), cl = [];
    for (let i = 0; i < n; i++) { const a = a0 + (i * TAU) / n, g = ghosts[i + 1]; cl.push({ g, x: AX + Math.cos(a) * 28, z: AZ + Math.sin(a) * 28, y: AY + 13 }); g.visible = true; g.position.set(cl[i].x, cl[i].y, cl[i].z); g.rotation.y = 0; fx.burst(cl[i].x, cl[i].y, cl[i].z, 20, 12, 0.7, 1.4, 0.1, 0xffffff, S.palette, { grav: 0 }); }
    try {
      yield* during(0.8, (p) => cl.forEach((c) => { c.g.scale.setScalar(DEV.SCALE * 0.55 * outBack(p) * (0.9 + Math.random() * 0.2)); c.g.rotation.y = Math.atan2(player.x - c.x, player.z - c.z); }));
      for (let v = 0; v < [3, 3, 4][S.phase - 1]; v++) {
        cl.forEach((c) => { c.g.rotation.y = Math.atan2(player.x - c.x, player.z - c.z); lanceFrom(c.x, c.y, c.z, player.x + player.vx * 0.3, player.z + player.vz * 0.3, 0.8, 3, 36); fan(3, 0.22, 24, 12, S.palette, c.x, c.y, c.z); });
        sfx.charge(0.8, 1); yield 1.3;
      }
      cl.forEach((c, i) => later(i * 0.12, () => { explode(c.x, c.z, 8, 30, S.palette); fx.burst(c.x, c.y, c.z, 30, 18, 0.8, 1.4, 0.1, 0xffffff, S.palette, { grav: 3 }); c.g.visible = false; }));
      yield 1.0;
    } finally { cl.forEach((c) => { c.g.visible = false; }); S.cast = 0; }
    yield 0.6;
  }

  // ===== 13. CTRL+Z: you are rewound to a marked spot, and it detonates (he shoots while you wait) =====
  function* undo() {
    cmd('git reset --hard HEAD~1  // ctrl+z'); pose('guard'); S.cast = 1; S.hT = 18; const gx = player.x, gz = player.z, T = 2.6;
    fx.tele('disc', { x: gx, z: gz, r: 7, dur: T, col: COL.violet }); ui.hint('CTRL+Z — YOU WILL BE PULLED BACK TO THE MARK', 3.0); sfx.charge(T, 1);
    const h = fx.beam(); let fire = 0.4;
    try {
      yield* during(T, (p, dt) => {
        h.set(gx, AY, gz, gx, AY + 40, gz, 0.5 + p * 0.7, COL.violet, 0.8); fire -= dt; if (fire <= 0) { fire = 0.55; fan(5, 0.18, 24, 12, COL.violet); }
        if (Math.random() < 0.6) fx.add(gx + rnd(-5, 5), AY + 0.4, gz + rnd(-5, 5), 0, rnd(5, 11), 0, 0.7, 1.1, 0.1, 0xffffff, COL.violet, 1, 0, 0.5);
      });
      ui.flash('#a66bff', 0.8, 0.5); sfx.glitch(1); ui.glitch(0.5); sfx.err(1);
      if (player.alive) { player.x = gx; player.z = gz; player.y = AY + 0.05; player.velY = 0; S.imp.x = S.imp.z = 0; }
      fx.tele('disc', { x: gx, z: gz, r: 7, dur: 0.9, col: COL.red }); ui.pop('UNDO — RUN!');
      later(0.9, () => explode(gx, gz, 7, 46, COL.violet)); yield 0.9;
    } finally { h.hide(); S.cast = 0; }
    yield 1.2;
  }

  // ===== 14. PHYSICS.GRAVITY *= 0.2: low gravity + two-height bullet rings =====
  function* lowGrav() {
    cmd('Physics.gravity *= 0.2;'); pose('raise'); S.hT = 19; S.cast = 1; S.grav = 9.5; ui.card('GRAVITY = 0.2', 'JUMP OVER THE LOW RINGS', 2.4); sfx.swell(1); yield 1.0;
    for (let v = 0; v < 8; v++) {
      const mode = pick(['low', 'high', 'low', 'high', 'both']), N = 40, x = S.x, z = S.z, gap = rnd(0, TAU);
      for (let j = 0; j < N; j++) {
        const th = (j / N) * TAU; if (mode === 'both' && Math.abs(angDiff(th, gap)) < 0.35) continue;
        if (mode !== 'high') bullet(x, AY + 0.6, z, Math.cos(th) * 15, 0, Math.sin(th) * 15, { dmg: 15, col: COL.cyan, life: 5 });
        if (mode !== 'low') bullet(x, AY + 3.2, z, Math.cos(th) * 15, 0, Math.sin(th) * 15, { dmg: 15, col: COL.pink, life: 5 });
      }
      if (mode !== 'high') wave(x, z, { v: 15, maxR: 22, col: COL.cyan, wallH: 0.8 });
      if (mode !== 'low') wave(x, z, { v: 15, maxR: 22, col: COL.pink, wallH: 0.8, y: 3.2 });
      sfx.thump(vol(x, z)); shake(0.1); yield 1.0;
    }
    S.cast = 0; yield 1.4;
  }

  // ===== 15. RECURSE(): orbs that split into orbs that split into orbs =====
  function* recurse() {
    cmd('function split(b, n) { if (n) b.split(3).forEach(c => split(c, n-1)); }'); pose('spread'); S.hT = 17; yield* charge(COL.violet, 0.8, 14);
    const k = [3, 4, 5][S.phase - 1], depth = [2, 3, 3][S.phase - 1];
    for (let v = 0; v < 3; v++) {
      const base = aimAt(S.x, S.z);
      for (let i = 0; i < k; i++) { const a = base + (i - (k - 1) / 2) * 0.5; bullet(S.x, AY + 1.2, S.z, Math.cos(a) * 12, 0, Math.sin(a) * 12, { r: 1.3, dmg: 20, col: COL.violet, life: 6, spl: depth, splT: 1.0 }); }
      flash(COL.violet, 1); sfx.hum(vol(S.x, S.z)); shake(0.2); yield 1.9;
    }
    S.cast = 0; yield 1.6;
  }

  // ===== 16. MEMORY LEAK: growing zones that are never freed =====
  function* leak() {
    cmd('new MemoryLeak(arena).grow(); // never freed'); pose('slam'); S.cast = 1; S.hT = 18; sfx.swell(1);
    const n = [4, 5, 7][S.phase - 1];
    for (let i = 0; i < n; i++) {
      let x, z; if (i === 0) { x = player.x; z = player.z; } else { const a = rnd(0, TAU), r = rnd(6, S.arenaR - 12); x = AX + Math.cos(a) * r; z = AZ + Math.sin(a) * r; }
      zone(x, z, rnd(9, 12), 3.2, 15, 9, i % 2 ? COL.green : COL.pink); fx.burst(x, AY + 0.5, z, 14, 10, 0.7, 1, 0.1, 0xffffff, COL.green, { up: 1.2, grav: 6 }); sfx.glitch(vol(x, z) * 0.6); yield 0.45;
    }
    pose('point');
    for (let v = 0; v < 4; v++) { fan(5, 0.2, 22, 12, COL.green); flash(COL.green, 0.6); yield 0.7; }
    S.cast = 0; yield 1.2;
  }

  // ===== 17. SUDO RM -RF / (phase III special): the arena edge is erased inward =====
  function* collapse() {
    S.colCd = 55; cmd('sudo rm -rf --no-preserve-root /'); pose('raise'); S.cast = 1; S.hT = 22; yield* slide(AX, AZ, 0.9);
    ui.card('SUDO', 'rm -rf /', 3); ui.hint('THE FLOOR IS BEING DELETED — STAY CENTRAL', 4); sfx.swell(1); sfx.err(1); ui.glitch(1); yield 1.2;
    const DUR = 7, MIN = 17; let acc = 0, tk = 0; const x = S.x, z = S.z;
    try {
      yield* during(DUR, (p, dt) => {
        S.colR = lerp(S.arenaR, MIN, ease(p)); arena.setCollapse(S.colR); shake(0.03);
        acc += dt; while (acc > 0.5) { acc -= 0.5; ring(x, AY + 0.6, z, 14, 13, { dmg: 13, col: COL.pink, life: 4 }, rnd(0, TAU), 0.25); fan(3, 0.25, 20, 12, COL.pink); }
        if (Math.random() < dt * 40) { const a = rnd(0, TAU); fx.add(AX + Math.cos(a) * S.colR, AY + 0.4, AZ + Math.sin(a) * S.colR, 0, rnd(4, 9), 0, 0.8, 1.6, 0.2, 0xffffff, COL.pink, 0.9, -1, 0.3); }
        tk -= dt; if (tk <= 0) { tk = 0.5; sfx.thump(1); }
      });
      yield 2.0;
      sfx.boom(1.6, 1); ui.flash('#ff4fd8', 0.7, 0.6); ui.card('GIT REVERT', 'FLOOR RESTORED', 2);
      yield* during(1.2, (p) => { S.colR = lerp(MIN, S.arenaR, ease(p)); arena.setCollapse(S.colR); });
    } finally { S.colR = S.arenaR; arena.setCollapse(S.arenaR); }
    wave(AX, AZ, { v: 40, maxR: 50, dmg: 20, col: COL.pink, wallH: 3, clear: 1.0 });
    S.cast = 0; yield 1.4;
  }

  // ================= NEW ATTACKS =================

  // ===== 18. NULL POINTER SPRAY: fast 3D-aimed shotgun fans, strafe them =====
  function* spray() {
    cmd('while (target.alive) shotgun.fire(target, SPREAD);'); pose('point'); S.hT = 13; yield* charge(COL.amber, 0.6, 12);
    const bursts = [6, 8, 10][S.phase - 1], n = [7, 9, 11][S.phase - 1];
    for (let i = 0; i < bursts; i++) {
      const c = i % 2 ? COL.amber : COL.red;
      fan(n, 0.12, 28, 12, c); if (S.phase >= 2) fan(n - 2, 0.12, 19, 12, COL.pink);   // slower second layer arrives later
      flash(c, 0.7); shake(0.12); yield S.phase >= 3 ? 0.5 : 0.6;
    }
    S.cast = 0; yield 1.0;
  }

  // ===== 19. CROSSHAIR: rim lasers draw an X (or an asterisk) on where you're standing =====
  function* crosshair() {
    cmd('draw.crosshair(player.position).fire();'); pose('spread'); S.hT = 20; yield* charge(COL.pink, 0.5, 12);
    const n = [3, 4, 5][S.phase - 1];
    for (let k = 0; k < n; k++) {
      const cx = clamp(player.x + player.vx * 0.5, AX - 36, AX + 36), cz = clamp(player.z + player.vz * 0.5, AZ - 36, AZ + 36), a0 = rnd(0, PI), arms = S.phase >= 3 && k % 2 ? 4 : 2;
      fx.tele('disc', { x: cx, z: cz, r: 4, dur: 0.85, col: COL.pink });
      for (let m = 0; m < arms; m++) { const a = a0 + (m * PI) / arms, dx = Math.cos(a), dz = Math.sin(a); lanceFrom(cx - dx * 55, AY + 1.5, cz - dz * 55, cx, cz, 0.85, 3.2, 38); }
      sfx.charge(0.85, 1); flash(COL.pink, 0.6); yield S.phase === 1 ? 0.85 : 0.65;
    }
    S.cast = 0; yield 1.2;
  }

  // ===== 20. CAGE: a ring of bullets collapses on you; run through the gap or jump it =====
  function* cage() {
    cmd('player.AddComponent<Cage>().Contract();'); pose('guard'); S.hT = 15; yield* charge(COL.violet, 0.5, 12);
    const rings = [2, 3, 3][S.phase - 1];
    for (let k = 0; k < rings; k++) {
      const cx = player.x + player.vx * 0.25, cz = player.z + player.vz * 0.25, R = 17, v = 9 + k * 1.5, gap = rnd(0, TAU), N = 44;
      fx.tele('disc', { x: cx, z: cz, r: R, dur: 0.9, col: COL.violet }); if (k === 0) ui.hint('RUN THROUGH THE GAP OR JUMP', 2.2); sfx.swell(0.8);
      later(0.9, () => {
        sfx.boom(0.8, 1);
        for (let j = 0; j < N; j++) { const th = (j / N) * TAU; if (Math.abs(angDiff(th, gap)) < 0.42) continue; const c = Math.cos(th), s = Math.sin(th); bullet(cx + c * R, AY + 1.0, cz + s * R, -c * v, 0, -s * v, { r: 0.65, dmg: 15, col: k % 2 ? COL.pink : COL.violet, life: R / v + 0.5 }); }
      });
      yield 1.6;
    }
    S.cast = 0; yield 1.0;
  }

  // ===== 21. SEEKERS: homing missiles launched in a ring =====
  function* seekers() {
    cmd('missiles.Launch(n).ForEach(m => m.Track(player));'); pose('raise'); S.hT = 16; yield* charge(COL.pink, 0.7, 14);
    const count = [2, 2, 3][S.phase - 1], per = [4, 6, 8][S.phase - 1], turn = [1.0, 1.2, 1.4][S.phase - 1], v = [12, 14, 16][S.phase - 1];
    for (let w = 0; w < count; w++) {
      for (let i = 0; i < per; i++) {
        const a = (i / per) * TAU + w * 0.5 + rnd(-0.1, 0.1);
        bullet(S.x, cy(), S.z, Math.cos(a) * v, rnd(6, 11), Math.sin(a) * v, { r: 0.9, dmg: 16, col: COL.pink, life: 6, home: turn });
        sfx.zap(vol(S.x, S.z) * 0.6); yield 0.09;
      }
      flash(COL.pink, 0.9); yield 1.6;
    }
    S.cast = 0; yield 1.0;
  }

  // ===== 22. TRACKING LASER: charges, locks on, burns along the floor while turning toward you =====
  function* ray() {
    cmd('laser.lockOn(player); laser.fire(); // hold to burn'); pose('point'); S.hT = 12; muzzle(COL.red);
    const reps = S.phase >= 3 ? 2 : 1, DUR = [2.6, 3.0, 3.2][S.phase - 1], turn = [0.55, 0.7, 0.85][S.phase - 1], LEN = 110;
    for (let rep = 0; rep < reps; rep++) {
      let ang = aimAt(S.x, S.z, 0), tick = 0; const T1 = rep ? 0.7 : 1.2, tl = { x: S.x, z: S.z, dx: Math.cos(ang), dz: Math.sin(ang), len: LEN, w: 2.2, dur: T1, col: COL.red };
      fx.tele('rect', tl);
      yield* charge(COL.red, T1, 18, (p, dt) => { ang += angDiff(aimAt(S.x, S.z, 0.3), ang) * Math.min(1, dt * 3); tl.x = S.x; tl.z = S.z; tl.dx = Math.cos(ang); tl.dz = Math.sin(ang); });
      const h1 = fx.beam(), h2 = fx.beam();
      flash(COL.red, 1.6); sfx.boom(1.0, vol(S.x, S.z)); shake(0.5);
      try {
        yield* during(DUR, (p, dt) => {
          ang += clamp(angDiff(aimAt(S.x, S.z, 0.1), ang), -turn * dt, turn * dt);
          const c = Math.cos(ang), s = Math.sin(ang), mx = S.x + c * 5, mz = S.z + s * 5, ex = S.x + c * LEN, ez = S.z + s * LEN;
          const th = 1.6 * (1 + 0.12 * Math.sin(S.t * 45)) * (p > 0.88 ? (1 - p) / 0.12 : 1);
          h1.set(S.x, cy(), S.z, mx, AY + 1.2, mz, th, COL.red, 1); h2.set(mx, AY + 1.2, mz, ex, AY + 1.2, ez, th, COL.red, 1);
          for (let i = 0; i < 3; i++) { const t = Math.random(); fx.add(S.x + c * LEN * 0.6 * t, AY + 0.5, S.z + s * LEN * 0.6 * t, rnd(-2, 2), rnd(3, 9), rnd(-2, 2), 0.5, 1.3, 0.1, 0xffffff, COL.amber, 1, 6, 1); }
          tick -= dt; if (tick <= 0 && player.alive && airH() < 1.8 && segDist(player.x, player.z, S.x, S.z, ex, ez) < 1.9) { tick = 0.22; hurt(12, S.x, S.z); }
          shake(0.025);
        });
      } finally { h1.hide(); h2.hide(); }
      yield 0.3;
    }
    S.cast = 0; yield 1.1;
  }

  // ===== 23. SUDO !!: he rises, marks you, and dive-bombs the spot =====
  function* dive() {
    cmd('sudo !!   // re-run last command as root, from orbit'); pose('raise'); S.cast = 1; const n = [1, 2, 3][S.phase - 1]; sfx.swell(1);
    for (let k = 0; k < n; k++) {
      const h0 = S.h, sx = S.x, sz = S.z, lim = S.arenaR - 8;
      let tx2 = player.x + player.vx * 0.5, tz2 = player.z + player.vz * 0.5; const d0 = Math.hypot(tx2 - AX, tz2 - AZ); if (d0 > lim) { tx2 = AX + ((tx2 - AX) / d0) * lim; tz2 = AZ + ((tz2 - AZ) / d0) * lim; }
      yield* during(0.55, (p) => { S.h = S.hT = lerp(h0, 36, ease(p)); S.x = lerp(sx, tx2, ease(p)); S.z = lerp(sz, tz2, ease(p)); suck(S.x, cy(), S.z, 3, 14, COL.pink); });
      fx.tele('disc', { x: tx2, z: tz2, r: 11, dur: 0.75, col: COL.red }); sfx.charge(0.75, 1);
      yield* during(0.75, () => { S.h = S.hT = 36 + Math.sin(S.t * 30) * 0.4; shake(0.03); });
      pose('slam'); sfx.whoosh(1); fx.beamT(S.x, cy(), S.z, S.x, AY, S.z, 2.2, COL.pink, 0.35);
      yield* during(0.16, (p) => { S.h = S.hT = lerp(36, 3, p * p); for (let i = 0; i < 6; i++) fx.add(S.x + rnd(-2, 2), cy() + rnd(0, 14), S.z + rnd(-2, 2), 0, rnd(-30, -10), 0, 0.4, 1.4, 0.1, 0xffffff, COL.pink, 1, 0, 0); });
      S.x = tx2; S.z = tz2; S.jolt = 1; sfx.boom(1.6, 1); shake(1); ui.flash('#ff4fd8', 0.35, 0.4);
      explode(tx2, tz2, 11, 56, COL.pink); wave(tx2, tz2, { v: 30, maxR: 42, dmg: 22, col: COL.pink, wallH: 3, clear: 1.2, kb: 16 });
      ring(tx2, AY + 0.8, tz2, 20, 15, { dmg: 13, col: COL.cyan, life: 3.2 }, rnd(0, TAU), 0.35);
      yield 0.7; pose('raise');
    }
    S.cast = 0; yield 0.5;
  }

  const ATK = [
    { id: 'for', f: forLoop, min: 1, w: [3, 2, 1.5] }, { id: 'sine', f: sine, min: 1, w: [2.5, 2, 2] }, { id: 'rng', f: rng, min: 1, w: [2.5, 2, 2] },
    { id: 'tiles', f: tilesAtk, min: 1, w: [2, 2.5, 2.5] }, { id: 'walls', f: wallsAtk, min: 1, w: [1.5, 2, 2] }, { id: 'marquee', f: marquee, min: 1, w: [2, 2.5, 3] },
    { id: 'click', f: clickSmash, min: 1, w: [2, 2, 2.5] }, { id: 'popups', f: popups, min: 1, w: [1.2, 2, 2.5] },
    { id: 'spray', f: spray, min: 1, w: [2.5, 2, 2] }, { id: 'cross', f: crosshair, min: 1, w: [2, 2.2, 2.5] }, { id: 'cage', f: cage, min: 1, w: [1.6, 2, 2.2] },
    { id: 'ammo', f: ammoDel, min: 2, w: [0, 1.5, 1.5], cd: 'ammoCd', cdT: 26 }, { id: 'swap', f: swapAtk, min: 2, w: [0, 1.2, 1.5], cd: 'swapCd', cdT: 32, need: 'W' },
    { id: 'sweep', f: sweep, min: 2, w: [0, 2.2, 2.5] }, { id: 'fork', f: fork, min: 2, w: [0, 2, 2.5] }, { id: 'undo', f: undo, min: 2, w: [0, 1.4, 1.8], cd: 'undoCd', cdT: 22 },
    { id: 'recurse', f: recurse, min: 2, w: [0, 2, 2.5] }, { id: 'leak', f: leak, min: 2, w: [0, 1.6, 2] },
    { id: 'seek', f: seekers, min: 2, w: [0, 2.2, 2.5] }, { id: 'ray', f: ray, min: 2, w: [0, 2.4, 2.8] }, { id: 'dive', f: dive, min: 2, w: [0, 2, 2.5] },
    { id: 'grav', f: lowGrav, min: 3, w: [0, 0, 2.5], cd: 'gravCd', cdT: 24 }, { id: 'collapse', f: collapse, min: 3, w: [0, 0, 0], cd: 'colCd', cdT: 55, special: true },
  ];
  function chooseAttack() {
    const list = ATK.filter((a) => a.min <= S.phase && !S.hist.slice(-2).includes(a.id) && !(a.cd && S[a.cd] > 0) && !(a.need && !W) && !a.special);
    if (S.phase >= 3 && S.colCd <= 0) return ATK.find((a) => a.special);
    let tot = 0; const ws = list.map((a) => { const w = a.w[S.phase - 1]; tot += w; return w; });
    if (tot <= 0) return list[0] || ATK[0];
    let r = Math.random() * tot;
    for (let i = 0; i < list.length; i++) { r -= ws[i]; if (r <= 0) return list[i]; }
    return list[0];
  }
  function startAttack() {
    const a = chooseAttack(); S.atk = a; S.hist.push(a.id); if (S.hist.length > 6) S.hist.shift();
    if (a.cd) S[a.cd] = a.cdT; S.runner = { gen: a.f(), wait: 0 };
  }
  function abort() {
    if (S.runner) { try { S.runner.gen.return(); } catch (_) {} S.runner = null; }
    S.later.length = 0; S.cast = 0; S.cur.on = false; S.poseName = '';
    for (const g of ghosts) g.visible = false;
    S.colR = S.arenaR; if (arena) arena.setCollapse(S.arenaR);
  }
  function onAttackDone() {
    S.atk = null; S.hT = 17; S.poseName = '';
    const chain = S.phase >= 2 && Math.random() < (S.phase >= 3 ? 0.6 : 0.4);
    S.cd = chain ? rnd(0.05, 0.2) : S.phase === 1 ? rnd(0.7, 1.3) : S.phase === 2 ? rnd(0.5, 1.0) : rnd(0.2, 0.6);
  }

  // ===== PHASES / CUTSCENES =====
  function stage(n) { setPalette(STAGE[n]); }
  function* cutscene(n) {
    const T = n === 2 ? 5.4 : 6.4, F = (x, y, z) => _cp.set(S.x + x, AY + S.h + y, S.z + z), L = (x, y, z) => _v.set(S.x + x, AY + S.h + y, S.z + z);
    S.state = 'transition'; S.invuln = true; S.frozen = true; ui.bar(false); S.yawFix = true; S.cineT = 0; S.hT = 15;
    const col = STAGE[n];
    S.cine = (t) => {
      let p, l, fov;
      if (t < 2.0) { const k = t / 2; p = F(-2 + 4 * k, 3.9, 9 - 3 * k); l = L(0, 3.7, 0.6); fov = 40 - 6 * k; }
      else if (t < 3.8) { const k = (t - 2) / 1.8; p = F(6 - 8 * k, 1, 14); l = L(0, 1.4, 3); fov = 50; }
      else { const k = (t - 3.8) / (T - 3.8); p = F(-8 + 14 * k, 6, 36 + 8 * k); l = L(0, 0, 0); fov = 62; }
      return { p, l, w: t > T - 0.8 ? 1 - ease((t - (T - 0.8)) / 0.8) : 1, fov };
    };
    sfx.swell(1); sfx.glitch(1); shake(0.8); ui.flash('#ffffff', 0.6, 0.9); ui.glitch(1.2); S.cast = 1; S.poseName = 'raise'; screen.st.mode = 'warn';
    cmd(n === 2 ? 'git merge phase-2 --no-verify' : 'sudo make boss --hardest --force');
    later(1.6, () => { sfx.boom(1.6, 1); ui.flash('#ffffff', 0.7, 0.7); setPalette(col); wave(S.x, S.z, { v: 32, maxR: 50, dmg: 0, col, wallH: 4 }); S.led = 1; S.earF = 1; fx.ball(S.x, cy(), S.z, 60, col, 0.8); fx.burst(S.x, cy(), S.z, 90, 34, 1.4, 2.2, 0.2, 0xffffff, col, { grav: 2 }); });
    later(3.0, () => { ui.card(n === 2 ? 'PHASE II' : 'PHASE III', n === 2 ? 'MERGE CONFLICT' : 'SUDO', 3); sfx.hum(1); shake(0.7); });
    later(3.9, () => { for (let i = 0; i < 3; i++) later(i * 0.22, () => wave(S.x, S.z, { v: 28 + i * 8, maxR: 48, dmg: 0, col: i === 1 ? 0xffffff : col, wallH: 5 })); });
    yield* during(T, () => {
      if (Math.random() < 0.6) fx.arc(S.x + rnd(-24, 24), cy() + rnd(8, 26), S.z + rnd(-24, 24), S.x + rnd(-4, 4), cy() + rnd(-4, 4), S.z + rnd(-4, 4), col, 0.15, 2);
      suck(S.x, cy(), S.z, 4, 20, col); shake(0.025);
    });
    S.cine = null; S.later.length = 0; stage(n); S.phase = n; ui.setPhase(n); screen.st.mode = 'code'; S.cast = 0; S.poseName = ''; S.yawFix = false;
    pickup('hp'); pickup('hp'); pickup('ammo'); S.invuln = false; S.frozen = false; ui.bar(true); sfx.musicSet(n === 2 ? 0.5 : 1); S.cd = 1.2; S.termCd = 5; S.state = 'fight';
  }
  function* transition(n) { yield* cutscene(n); }

  // ===== INTRO (24 s, NOT skippable) =====
  function* intro() {
    S.state = 'intro'; S.frozen = true; S.invuln = true; S.alive = false; S.x = AX; S.z = AZ; S.h = 10; S.hT = 10; S.yawFix = true; S.yaw = 0; S.eyeO = 0;
    S.vis = { dev: 0, panels: 0, sigil: 0 }; rig.root.visible = true; rig.face.visible = false; ui.bar(false); screen.st.cmd = ''; screen.st.mode = 'code';
    const TOT = 24.2, P = (x, y, z) => _cp.set(AX + x, AY + y, AZ + z), Lk = (x, y, z) => _v.set(AX + x, AY + y, AZ + z), gh = ghosts[0];
    arena.floorMat.emissiveIntensity = 0.1; arena.rise(0);
    S.cineT = 0;
    S.cine = (t) => {
      if (t < 3.6) return { p: P(0, 6, 52), l: Lk(0, 30, 0), w: 1, fov: 60 };
      if (t < 8.4) { const k = (t - 3.6) / 4.8, a = 1.45 - k * 1.1; return { p: P(Math.cos(a) * 34, 4 + 3 * k, Math.sin(a) * 34), l: Lk(0, 10 + 4 * k, 0), w: 1, fov: 62 - 6 * k }; }
      if (t < 13) { const k = ease((t - 8.4) / 4.6); return { p: P(2 - 2 * k, 7 + 6 * k, 34 - 18 * k), l: Lk(0, 12, 0), w: 1, fov: 54 - 8 * k }; }
      if (t < 17.2) { const k = (t - 13) / 4.2; return { p: P(-1.4 + 2.8 * k, S.h + 3.9, 6.4 - 1.4 * k), l: Lk(0, S.h + 3.7, 0.6), w: 1, fov: 36 - 8 * k }; }
      if (t < 20.6) { const k = (t - 17.2) / 3.4; return { p: P(8 - 5 * k, S.h + 0.4 + 0.6 * k, 14 - 2 * k), l: Lk(0, S.h + 1.3, 3), w: 1, fov: 50 - 6 * k }; }
      const k = clamp((t - 20.6) / 3.6, 0, 1), e = ease(k);
      return { p: P(lerp(3, 0, e), lerp(S.h + 1, 1.8, e), lerp(12, R0 - 8, e)), l: Lk(0, lerp(S.h + 2, S.h + 1, e), 0), w: 1 - ease(prog(k, 0.65, 1)), fov: lerp(52, 70, e) };
    };
    // discrete beats
    ui.boot(['> ssh root@rift-horizon-dev', '> password: ********', '> ACCESS GRANTED', '> loading arena.dll .............. OK', '> loading TheFallenStarGG.avatar ... OK', '> disabling anti-cheat ........... OK', '> sudo make boss --hardest', '> WARNING: no patch notes were found', '> compiling THE DEV ...'], 0.36);
    for (let i = 0; i < 9; i++) later(i * 0.36, () => sfx.key());
    later(0.2, () => sfx.boot(1));
    later(3.5, () => { ui.bootOff(); ui.flash('#ffffff', 1, 1.2); sfx.boom(1.6, 1); sfx.swell(1); setPalette(STAGE[1]); });
    for (let i = 0; i < 12; i++) later(3.8 + i * 0.35, () => { wave(AX, AZ, { v: 30, maxR: R0, col: i % 2 ? COL.pink : COL.cyan, wallH: 1.2 }); sfx.chime(i, 0.7); shake(0.05); });
    later(8.4, () => { sfx.swell(1); sfx.hum(1); gh.visible = true; });
    later(12.8, () => { gh.visible = false; rig.face.visible = true; S.vis.dev = 1; S.hT = 12; ui.flash('#ffffff', 0.95, 0.9); sfx.boom(2, 1); sfx.glitch(1); shake(0.9); wave(AX, AZ, { v: 36, maxR: 50, col: COL.white, wallH: 3 }); fx.burst(AX, AY + S.h + 4, AZ, 80, 30, 1.4, 2, 0.2, 0xffffff, COL.cyan, { grav: 2 }); });
    later(14.4, () => { S.led = 1; S.earF = 1; sfx.hum(1); shake(0.3); });
    later(17.4, () => { S.keySlam = 1; });
    later(19.0, () => { S.keySlam = 2; sfx.boom(1.8, 1); sfx.key(1); ui.flash('#ffffff', 0.9, 0.8); ui.card(DEV.NAME, DEV.SUB, 3.6); shake(1); for (let i = 0; i < 3; i++) later(i * 0.2, () => wave(AX, AZ, { v: 34 + i * 8, maxR: 50, col: i === 1 ? COL.white : COL.pink, wallH: 4 })); });
    later(20.6, () => { S.hT = 19; sfx.hum(1); S.led = 1; });
    try {
      yield* during(TOT, (p) => {
        const t = p * TOT;
        arena.floorMat.emissiveIntensity = 0.1 + 0.95 * prog(t, 3.5, 8);
        arena.rise(prog(t, 3.8, 8.2));
        S.vis.sigil = outC(prog(t, 8.4, 10)); S.vis.panels = outBack(prog(t, 10.5, 12.6)); S.eyeO = prog(t, 13.4, 14.2);
        if (t > 8.4 && t < 12.8) {
          const k = prog(t, 8.4, 12.8);
          gh.position.set(AX, AY + S.h, AZ); gh.scale.setScalar(DEV.SCALE * (0.7 + 0.3 * k)); gh.visible = Math.random() < 0.85;
          for (let i = 0; i < 6; i++) { const a = rnd(0, TAU), r = rnd(6, 34); fx.add(AX + Math.cos(a) * r, AY + rnd(26, 60), AZ + Math.sin(a) * r, -Math.cos(a) * r * 0.3, -rnd(14, 30), -Math.sin(a) * r * 0.3, 1.4, 1.3, 0.1, 0xffffff, i % 2 ? COL.cyan : COL.green, 1, 0, 0); }
          shake(0.02 + 0.05 * k);
        }
        if (t < 3.5) shake(0.01);
      });
    } finally {
      S.cine = null; S.later.length = 0; gh.visible = false; rig.face.visible = true; ui.bootOff(); ui.bar(true);
      arena.floorMat.emissiveIntensity = 1.0; arena.rise(1);
      S.vis = { dev: 1, panels: 1, sigil: 1 }; S.eyeO = 1; S.keySlam = 0; S.yawFix = false; stage(1); screen.st.mode = 'code';
      S.invuln = false; S.frozen = false; S.alive = true; S.state = 'fight'; S.cd = 1.8; S.termCd = 9; S.hT = 19; S.cast = 0;
      targets.forEach((t) => { if (t.kind === 'head' || t.kind === 'body' || t.kind === 'laptop') t.alive = true; });
      ui.hint('HIS FIREWALL ABSORBS BULLETS — HACK THE TERMINALS', 5);
    }
  }

  // ---------------- end states ----------------
  function rollback() {
    if (S.wSnap && W) { try { W.restore(S.wSnap); } catch (_) {} if (ui) ui.pop('ROLLBACK COMPLETE'); }
    S.wSnap = null; S.wLock = 0;
  }
  function clearHazards() {
    for (const w of S.waves) w.h.hide(); S.waves.length = 0;
    for (const o of S.zones) { o.Z.g.visible = false; o.Z.use = false; } S.zones.length = 0;
    for (const o of S.tiles) { o.T.g.visible = false; o.T.use = false; } S.tiles.length = 0;
    for (const o of S.walls) { if (o.col) removeCollider(o.col); o.W.g.visible = false; o.W.use = false; } S.walls.length = 0;
    for (const o of S.pops) { o.P.g.visible = false; o.P.on = false; o.P.target.pop = null; o.P.target.alive = false; } S.pops.length = 0;
    S.cur.on = false; if (cursor) cursor.visible = false;
    clearBullets();
  }
  function kill() {
    S.alive = false; S.hp = 0; S.panic = 0;
    targets.forEach((t) => { t.alive = false; });
    abort(); clearHazards(); clearTerms(); restoreAmmo(); rollback();
    S.invuln = true; S.runner = { gen: death(), wait: 0 };
  }
  function* death() {
    S.state = 'dead'; ui.setFw('', false); ui.terms(''); S.cineT = 0; S.cast = 0; S.hT = 14; S.yawFix = true;
    screen.st.mode = 'bsod'; screen.st.cmd = 'process.exit(0);';
    S.cine = (t) => { const a = 0.5 + t * 0.14; return { p: _cp.set(S.x + Math.cos(a) * 40, AY + S.h * 0.5 + 8, S.z + Math.sin(a) * 40), l: _v.set(S.x, AY + S.h + 2, S.z), w: ease(t / 0.8), fov: 58 }; };
    sfx.hum(1); sfx.err(1); ui.flash('#ffffff', 0.5, 1); ui.glitch(2);
    const blast = (x, y, z, s) => { fx.ball(x, y, z, 10 * s, 0xffe0ff, 0.45); fx.burst(x, y, z, 22, 16, 0.9, 1.5, 0.2, 0xffffff, S.palette, { grav: 6 }); fx.light(x, y, z, S.palette, 2500, 0.25); sfx.boom(0.7 * s, vol(x, z)); shake(0.18 * s); };
    for (let i = 0; i < 22; i++) later(i * 0.2, () => blast(S.x + rnd(-12, 12), cy() + rnd(-8, 8), S.z + rnd(-12, 12), 1));
    yield* during(5.4, (p) => {
      const t = p * 5.4;
      S.vis.panels = 1 - prog(t, 1.5, 2.5); S.vis.sigil = 1 - prog(t, 2.5, 3.5);
      rig.face.visible = Math.random() > prog(t, 3.2, 5.2) * 0.9;
      S.jolt = 0.6; shake(0.04 + p * 0.08); suck(S.x, cy(), S.z, 4, 22, 0xffffff);
      if (Math.random() < 0.4) sfx.glitch(0.5);
    });
    ui.flash('#ffffff', 1, 2.2);
    const cx = S.x, cyv = cy(), cz = S.z;
    rig.root.visible = false;
    fx.ball(cx, cyv, cz, 120, 0xffffff, 1.0); fx.ball(cx, cyv, cz, 180, S.palette, 1.4); fx.beamT(cx, AY, cz, cx, AY + 240, cz, 7, 0xffffff, 2.6);
    fx.burst(cx, cyv, cz, 160, 44, 1.8, 3, 0.2, 0xffffff, S.palette, { grav: 3 }); fx.light(cx, cyv, cz, 0xffffff, 7000, 1.2);
    wave(cx, cz, { v: 40, maxR: 60, col: 0xffffff, wallH: 6 }); sfx.boom(2.4, 1); shake(1);
    for (let i = 0; i < 40; i++) later(0.1 + i * 0.06, () => fx.add(AX + rnd(-40, 40), AY + rnd(20, 70), AZ + rnd(-40, 40), rnd(-2, 2), rnd(-22, -10), rnd(-2, 2), 2.2, 1.6, 0.2, 0xffffff, i % 2 ? COL.cyan : COL.pink, 1, 0, 0));
    yield 2.8;
    S.cine = null; S.result = 'win'; S.frozen = true; arena.setPalette(COL.green);
    ui.end(true, { time: S.stats.time, deaths: S.deaths, taken: S.stats.taken, panics: S.stats.panics });
    sfx.musicStop();
    if (onWin) { try { onWin(); } catch (_) {} }
    if (document.pointerLockElement) document.exitPointerLock();
  }
  function lose() {
    if (S.result) return;
    abort(); clearHazards(); clearTerms(); restoreAmmo(); rollback();
    S.result = 'lose'; S.frozen = true; S.invuln = true; sfx.hum(1); ui.dead(false);
    ui.end(false, { time: S.stats.time, deaths: S.deaths, taken: S.stats.taken, panics: S.stats.panics });
    sfx.musicStop();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  // ---------------- per-frame systems ----------------
  function tickRunner(dt) {
    const r = S.runner; if (!r) return;
    r.wait -= dt; let g = 0;
    while (r.wait <= 0 && g++ < 60) {
      const n = r.gen.next();
      if (n.done) { if (S.runner === r) { S.runner = null; if (S.state === 'fight') onAttackDone(); } return; }
      r.wait = Math.max(1e-4, +n.value || 0);
    }
  }
  function idleMove(dt) {
    const rad = S.phase >= 3 ? 16 : 12;
    S.orbA = (S.orbA || 0) + dt * (S.phase >= 2 ? 0.28 : 0.2);
    const tx2 = AX + Math.cos(S.orbA) * rad, tz2 = AZ + Math.sin(S.orbA) * rad, k = Math.min(1, dt * 1.2);
    S.x += (tx2 - S.x) * k; S.z += (tz2 - S.z) * k;
  }
  function aiUpdate(dt) {
    if (S.state !== 'fight') return;
    S.fightT += dt; S.stats.time += dt;
    for (const k of CDK) S[k] = Math.max(0, S[k] - dt);
    const g = gateHp();
    if (g > 0 && S.hp <= g) {                            // PHASE GATE: checked first, so it also interrupts a KERNEL PANIC instantly
      S.panic = 0; S.invuln = true; abort(); clearHazards(); clearTerms();
      S.runner = { gen: transition(S.phase + 1), wait: 0 }; return;
    }
    if (S.panic > 0) {                                   // KERNEL PANIC: he sinks to the centre, no attacks (phase III: weak panic shots)
      S.panic -= dt; S.x += (AX - S.x) * Math.min(1, dt * 1.5); S.z += (AZ - S.z) * Math.min(1, dt * 1.5);
      if (S.phase >= 3) { S.daemon -= dt; if (S.daemon <= 0) { S.daemon = 1.1; fan(3, 0.3, 14, 10, COL.red); } }
      if (S.panic <= 0) endPanic();
      return;
    }
    if (S.terms.length) { S.termT -= dt; if (S.termT <= 0) failTerms(); }
    else { S.termCd -= dt; if (S.termCd <= 0) startTerms(); }
    if (S.phase >= 2) {                                  // background "daemon" process keeps firing during other attacks (now aimed in 3D)
      S.daemon -= dt;
      if (S.daemon <= 0) { S.daemon = S.phase >= 3 ? 1.2 : 2.0; fan(S.phase >= 3 ? 3 : 1, 0.2, 22, 10, COL.red); }
    }
    if (S.runner) return;
    idleMove(dt); S.cd -= dt;
    if (S.cd <= 0 && player.alive) startAttack();
  }
  function updLocks(dt) {
    if (S.ammoLock > 0) { S.ammoLock -= dt; player.ammo = 0; player.reserve = 0; if (S.ammoLock <= 0) restoreAmmo(); }
    if (S.wLock > 0) { S.wLock -= dt; if (S.wLock <= 0) rollback(); }
  }
  function constrain(dt) {
    if (!player.alive || S.frozen) { S.imp.x = S.imp.z = 0; return; }
    const ix = S.imp.x * dt, iz = S.imp.z * dt;
    if (Math.abs(ix) + Math.abs(iz) > 1e-4) { const r = resolveCircle(player.x + ix, player.z + iz, player.radius, player.y, 1.8); player.x = r.x; player.z = r.z; }
    const k = Math.exp(-5 * dt); S.imp.x *= k; S.imp.z *= k;
    const dx = player.x - AX, dz = player.z - AZ, d = Math.hypot(dx, dz), lim = S.arenaR - 0.7;
    if (d > lim) { player.x = AX + (dx / d) * lim; player.z = AZ + (dz / d) * lim; }
    if (player.y < AY - 8) { player.y = AY + 0.5; player.velY = 0; }
    if (S.grav > 0) { S.grav -= dt; if (!player.onGround && player.velY < 11) player.velY += 13 * dt; if (player.y - AY > 16) player.velY = Math.min(player.velY, -4); }
    if (S.colR < S.arenaR - 0.5 && d > S.colR && airH() < 1.5) { S.colTick = (S.colTick || 0) - dt; if (S.colTick <= 0) { S.colTick = 0.4; hurt(14, AX, AZ); player.velY = Math.max(player.velY, 5); player.onGround = false; } }
  }
  function trackPlayer() {
    if (player.deaths > S.lastDeaths) {
      S.lastDeaths = player.deaths; S.deaths++;
      const left = DEV.LIVES - S.deaths; ui.setLives(left);
      if (left <= 0) lose(); else { S.dead = true; ui.dead(true, left); }
    }
    if (S.dead && player.alive) { S.dead = false; ui.dead(false); }
  }

  // ---------------- rig animation ----------------
  function applyRig(dt) {
    const r = rig, t = S.t, V = S.vis, M = r.M, pn = S.panic > 0 || S.state === 'dead';
    S.hitFlash = Math.max(0, S.hitFlash - dt * 6); S.jolt = Math.max(0, S.jolt - dt * 3); S.fwHit = Math.max(0, S.fwHit - dt * 5); S.earF = Math.max(0, S.earF - dt * 2.5); S.led = Math.max(0, S.led - dt * 0.8);
    S.castSm += (((S.cast || S.keySlam === 1) ? 1 : 0) - S.castSm) * Math.min(1, dt * 5);
    S.slumpSm += ((pn ? 1 : 0) - S.slumpSm) * Math.min(1, dt * 4);
    S.fwSm += ((pn ? 0 : 1) - S.fwSm) * Math.min(1, dt * 6);
    if (S.keySlam === 2) { S.slamT = (S.slamT || 0) + dt; if (S.slamT > 0.5) { S.keySlam = 0; S.slamT = 0; } }
    S.bob = Math.sin(t * 1.2) * 0.5; S.h += (S.hT - S.h) * Math.min(1, dt * 2);
    const yt = S.yawFix ? 0 : Math.atan2(player.x - S.x, player.z - S.z); S.yaw += angDiff(yt, S.yaw) * Math.min(1, dt * 3);
    // attack pose (smoothed): arms / lean / twist / laptop lid per attack
    const pv = S.pv, PT = POSES[S.poseName] || POSES.none, kp = Math.min(1, dt * 7);
    for (let i = 0; i < 3; i++) { pv.L[i] += (PT.L[i] - pv.L[i]) * kp; pv.R[i] += (PT.R[i] - pv.R[i]) * kp; }
    for (const k of PK) pv[k] += (PT[k] - pv[k]) * kp;
    pv.f = PT.f; pv.tF = PT.tF;
    const so = Math.sin(t * pv.f) * pv.a, tw = Math.sin(t * pv.tF) * pv.tA;
    r.root.position.set(S.x + rnd(-1, 1) * S.jolt * 0.4, AY + S.h + S.bob, S.z); r.face.rotation.y = S.yaw;
    r.body.position.y = Math.sin(t * 1.3) * 0.03 - S.slumpSm * 0.05;
    r.chest.rotation.x = lerp(0.05 + Math.sin(t * 1.1) * 0.01, 0.55, S.slumpSm) - S.castSm * 0.15 + pv.lean;
    r.chest.rotation.y = pv.twist + tw;
    r.lid.rotation.x = 0.28 + pv.lid;
    r.head.rotation.x = Math.sin(t * 0.9) * 0.03 + Math.max(0, Math.sin(t * 7)) * 0.02 + S.slumpSm * 0.45 - S.castSm * 0.2 + pv.tilt;
    r.head.rotation.z = Math.sin(t * 0.7) * 0.02 + S.slumpSm * 0.15;
    r.ears.forEach((e) => { const s = e.userData.s; e.rotation.z = -s * (0.32 + 0.9 * S.slumpSm + 0.12 * Math.sin(t * 30) * S.earF + 0.1 * S.castSm); });
    const blink = t % 3.6 < 0.12 ? 0 : 1;
    r.eyes.forEach((e) => { e.scale.y = Math.max(0.05, 1.4 * S.eyeO * blink * (1 - 0.8 * S.slumpSm)); });
    r.leds.forEach((l) => l.scale.setScalar(1 + S.led * 0.7 + 0.08 * Math.sin(t * 6)));
    M.keys.opacity = 0.6 + 0.4 * Math.sin(t * 9);
    poseArms(r, t * (1 + S.castSm * 0.5), { slump: S.slumpSm, cast: S.castSm, pv, so });
    r.panelRoot.visible = V.panels > 0.01; r.panelRoot.scale.setScalar(Math.max(0.001, V.panels)); r.panelRoot.rotation.y += dt * (0.25 + 0.08 * S.phase);
    r.panels.forEach((p) => { p.g.visible = p.i < [3, 5, 6][S.phase - 1]; p.pm.opacity = pn ? 0.15 : 0.7; p.fr.material.opacity = pn ? 0.2 : 0.9; });
    r.sigil.visible = V.sigil > 0.01; r.sigil.scale.setScalar(Math.max(0.001, V.sigil)); r.sigil.rotation.y += dt * 0.5;
    const sh = V.dev * S.fwSm * (0.1 + 0.55 * S.fwHit + 0.04 * Math.sin(t * 3));
    r.shellMat.opacity = sh; r.shell.visible = sh > 0.01 && r.face.visible; r.shell.rotation.y += dt * 0.3;
    r.light.intensity = (300 + 250 * S.castSm + 400 * S.hitFlash) * (pn ? 0.4 : 1);
    r.root.updateMatrixWorld(true);
    if (S.castSm > 0.5 && Math.random() < dt * 40 && r.face.visible) {
      for (const A of [r.armL, r.armR]) { A.h.getWorldPosition(_v); fx.add(_v.x, _v.y, _v.z, rnd(-3, 3), rnd(2, 6), rnd(-3, 3), 0.5, 0.8, 0.1, 0xffffff, S.palette, 1, 0, 1); }
    }
  }
  function syncTargets() {
    for (let i = 0; i < targets.length; i++) { const t = targets[i]; t.mesh.getWorldPosition(_v); t.x = _v.x; t.y = _v.y - 1.3; t.z = _v.z; t.yaw = S.yaw; }
  }

  // ---------------- camera / environment ----------------
  function cameraFx(dt) {
    if (S.cine) {
      S.cineT += dt;
      const c = S.cine(S.cineT);
      if (c.w > 0.001) {
        _m4.lookAt(c.p, c.l, _upV); _lq.setFromRotationMatrix(_m4);
        camera.position.lerp(c.p, c.w); _cq.copy(camera.quaternion).slerp(_lq, c.w); camera.quaternion.copy(_cq);
        camera.fov = lerp(camera.fov, c.fov, c.w); camera.updateProjectionMatrix();
        if (c.w > 0.5) { viewmodel.visible = false; playerMesh.visible = false; }
      }
    }
    const a = S.trauma * S.trauma;
    if (a > 0.0004) {
      camera.position.x += rnd(-1, 1) * a * 0.35; camera.position.y += rnd(-1, 1) * a * 0.25; camera.position.z += rnd(-1, 1) * a * 0.35;
      camera.rotateX(rnd(-1, 1) * a * 0.03); camera.rotateY(rnd(-1, 1) * a * 0.03); camera.rotateZ(rnd(-1, 1) * a * 0.05);
    }
    S.trauma = Math.max(0, S.trauma - dt * 1.4);
    camera.updateMatrixWorld();
  }
  function envUpdate(dt) {
    const sun = world.sun; sunDirV.copy(world.sunDir);
    const sx = Math.round(player.x / 2) * 2, sz = Math.round(player.z / 2) * 2;
    sun.target.position.set(sx, AY, sz); sun.position.set(sx, AY, sz).addScaledVector(sunDirV, 90); sun.target.updateMatrixWorld();
    hemi.intensity = 0.9; sun.intensity = 1.3;
    if (Math.random() < dt * 16) { const a = rnd(0, TAU), r = Math.sqrt(Math.random()) * R0 * 0.95; fx.add(AX + Math.cos(a) * r, AY + 0.2, AZ + Math.sin(a) * r, 0, rnd(3, 8), 0, 2, 0.8, 0.1, 0xffffff, S.palette, 0.5, 0, 0); }
    if (Math.random() < dt * 0.5) { const a = rnd(0, TAU); fx.arc(AX + Math.cos(a) * 120, AY + 150, AZ + Math.sin(a) * 120, AX + rnd(-60, 60), AY + rnd(-20, 40), AZ + rnd(-60, 60), 0xbfeaff, 0.3, 6); }
  }

  // ---------------- lifecycle ----------------
  function enterEnv() {
    saved = {
      fogColor: scene.fog ? scene.fog.color.getHex() : 0, fogNear: scene.fog ? scene.fog.near : 0, fogFar: scene.fog ? scene.fog.far : 0,
      bg: scene.background, envI: scene.environmentIntensity, sunI: world.sun.intensity, sunC: world.sun.color.getHex(), exp: renderer.toneMappingExposure,
    };
    if (scene.fog) { scene.fog.color.setHex(0x07050f); scene.fog.near = 70; scene.fog.far = 320; }
    scene.background = new THREE.Color(0x03030a); scene.environmentIntensity = 0.35;
    world.sun.intensity = 1.3; world.sun.color.setHex(0xcfd8ff); renderer.toneMappingExposure = 0.9;
    scene.add(hemi); arena.group.visible = true; arena.dome.visible = true; fx.setEnabled(true);
  }
  function exitEnv() {
    if (!saved) return;
    if (scene.fog) { scene.fog.color.setHex(saved.fogColor); scene.fog.near = saved.fogNear; scene.fog.far = saved.fogFar; }
    scene.background = saved.bg; scene.environmentIntensity = saved.envI; world.sun.intensity = saved.sunI; world.sun.color.setHex(saved.sunC); renderer.toneMappingExposure = saved.exp;
    scene.remove(hemi); arena.group.visible = false; arena.dome.visible = false; fx.setEnabled(false); saved = null;
  }
  function start() {
    build();
    if (S.on) stop();
    reset(); S.on = true; stage(1); arena.setCollapse(R0);
    floorCol = addCollider(AX, AZ, R0 * 2 + 4, AY, R0 * 2 + 4, { y0: AY - 3, noCover: true });
    savedSpawns = SPAWNS.player.slice(); SPAWNS.player.length = 0; SPAWNS.player.push({ x: AX, z: AZ + R0 - 8, y: AY, yaw: 0 });
    enterEnv(); fx.clear(); fx.setFloor(AY); clearBullets();
    targets.forEach((t) => { t.alive = false; t.pop = null; });
    rig.root.visible = false; rig.face.visible = true; for (const g of ghosts) g.visible = false; cursor.visible = false;
    arena.floorMat.emissiveIntensity = 1.0; arena.rise(1); screen.st.mode = 'code';
    ui.show(); ui.hideEnd(); ui.dead(false); ui.setHp(1); ui.setPhase(1); ui.setLives(DEV.LIVES); ui.setFw('', false); ui.terms('');
    ctrl.respawnAt({ x: AX, z: AZ + R0 - 8, y: AY, yaw: 0 });
    S.lastDeaths = player.deaths;
    sfx.musicStart(DEV.MUSIC); sfx.musicSet(0.2);
    S.runner = { gen: intro(), wait: 0 };
  }
  function stop() {
    if (!built) return;
    const was = S.on;
    abort(); S.on = false; S.frozen = false;
    if (was) {
      restoreAmmo(); rollback();
      if (floorCol) { removeCollider(floorCol); floorCol = null; }
      if (savedSpawns) { SPAWNS.player.length = 0; for (const s of savedSpawns) SPAWNS.player.push(s); savedSpawns = null; }
      clearHazards(); clearTerms(); for (const o of S.pick) o.h.hide(); S.pick.length = 0;
      fx.clear(); exitEnv(); rig.root.visible = false; arena.setCollapse(R0);
      ui.hide(); sfx.musicStop(); viewmodel.visible = false;
      targets.forEach((t) => { t.alive = false; t.pop = null; });
    }
  }
  function retry() { stop(); start(); }

  function update(dt) {
    if (!S.on) return;
    S.dt = dt; S.t += dt;
    trackPlayer();
    for (let i = S.later.length - 1; i >= 0; i--) { const l = S.later[i]; l.t -= dt; if (l.t <= 0) { S.later.splice(i, 1); l.fn(); } }
    tickRunner(dt); aiUpdate(dt); updLocks(dt);
    updWaves(dt); updTiles(dt); updZones(dt); updWalls(dt); updPops(dt); if (S.state === 'fight' && S.panic <= 0) updTerms(dt);
    updBullets(dt); updPick(dt); updCursor(dt);
    constrain(dt); screen.update(dt); applyRig(dt); syncTargets(); envUpdate(dt);
    arena.update(S.t, dt, camera); fx.update(dt); cameraFx(dt);
    ui.setHp(S.hp / S.maxHp); ui.tick(dt);
    ui.setFw(S.panic > 0 ? 'KERNEL PANIC ' + S.panic.toFixed(1) + 's' : S.state === 'fight' ? 'FIREWALL ONLINE' : S.state === 'transition' ? 'COMPILING…' : '', S.panic > 0);
    sfx.musicSet(S.phase === 1 ? 0.2 : S.phase === 2 ? 0.55 : 1);
  }

  return {
    start, stop, update, targets,
    get frozen() { return S.on && S.frozen; },
    get active() { return S.on; },
  };
}

// ======================================================================
//  LOBBY PORTAL: the Dev's gate (west of the Orrery gate on the north wall). Sealed until isUnlocked() is true.
//  If it overlaps something in your lobby, change PORTAL_DX.
// ======================================================================
const PORTAL_DX = 27;   // Riftwarden gate: LOBBY.x + 46, Orrery gate: LOBBY.x + 36.5
function swirlTex(color) {
  const rgb = `${(color >> 16) & 255},${(color >> 8) & 255},${color & 255}`;
  return canvasTex(256, 256, (x, w) => {
    x.translate(w / 2, w / 2);
    const g = x.createRadialGradient(0, 0, 8, 0, 0, w / 2);
    g.addColorStop(0, `rgba(${rgb},0.08)`); g.addColorStop(0.55, `rgba(${rgb},0.4)`); g.addColorStop(1, `rgba(${rgb},0.85)`);
    x.fillStyle = g; x.beginPath(); x.arc(0, 0, w / 2, 0, TAU); x.fill();
    x.font = '16px monospace'; x.fillStyle = `rgba(${rgb},0.95)`;
    for (let k = 0; k < 90; k++) { const a = rnd(0, TAU), r = rnd(14, w / 2 - 14); x.save(); x.translate(Math.cos(a) * r, Math.sin(a) * r); x.rotate(a + PI / 2); x.fillText(Math.random() < 0.5 ? '0' : '1', 0, 0); x.restore(); }
    x.strokeStyle = 'rgba(255,255,255,0.45)'; x.lineWidth = 3;
    for (const r of [40, 70, 100]) { x.beginPath(); x.arc(0, 0, r, 0, TAU); x.stroke(); }
    x.strokeStyle = `rgba(${rgb},0.95)`; x.lineWidth = 6; x.beginPath(); x.arc(0, 0, w / 2 - 5, 0, TAU); x.stroke();
  });
}

export function createDevPortal(scene, isUnlocked) {
  const L = LOBBY, px = L.x + PORTAL_DX, pz = L.z - L.d / 2 + 2.4, y0 = L.y, HOLD = 1.15;
  const g = new THREE.Group(); scene.add(g);
  const dark = new THREE.MeshStandardMaterial({ color: 0x14101e, metalness: 0.8, roughness: 0.35, emissive: 0x08040e });
  const trim = new THREE.MeshStandardMaterial({ color: 0x6e5aa8, metalness: 0.9, roughness: 0.3 });
  const basic = (o) => new THREE.MeshBasicMaterial({ toneMapped: false, ...o });
  const put = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = !mat.isMeshBasicMaterial; g.add(m); return m; };
  const solid = (w, h, d, cx, yb, cz) => { put(new THREE.BoxGeometry(w, h, d), dark, cx, y0 + yb + h / 2, cz); addCollider(cx, cz, w, y0 + yb + h, d, { y0: y0 + yb, noCover: true }); };
  solid(5.2, 0.45, 1.8, px, 0, pz);
  solid(0.35, 4.2, 0.45, px - 2.3, 0.45, pz); solid(0.35, 4.2, 0.45, px + 2.3, 0.45, pz); solid(5.0, 0.35, 0.45, px, 4.4, pz);
  for (const dx of [-1.9, 0, 1.9]) put(new THREE.BoxGeometry(0.5, 0.18, 0.12), trim, px + dx, y0 + 5.05 + (dx === 0 ? 0.35 : 0), pz);
  const TEX_ON = swirlTex(0xff4fd8), TEX_OFF = swirlTex(0x4a505c);
  const swirl = put(new THREE.CircleGeometry(1.65, 48), basic({ map: TEX_OFF, transparent: true, side: THREE.DoubleSide }), px, y0 + 2.5, pz + 0.35);
  const halo = put(new THREE.RingGeometry(1.7, 1.9, 48), basic({ color: 0xff5a3a, transparent: true, opacity: 0.75, side: THREE.DoubleSide }), px, y0 + 2.5, pz + 0.37);
  const arm1 = put(new THREE.TorusGeometry(2.05, 0.05, 6, 48), basic({ color: 0x4dff9a }), px, y0 + 2.5, pz + 0.5);
  const arm2 = put(new THREE.TorusGeometry(2.3, 0.04, 6, 48), basic({ color: 0x38f2ff }), px, y0 + 2.5, pz + 0.55);
  put(new THREE.PlaneGeometry(3.4, 8), basic({ color: 0xff4fd8, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), px, y0 + 4, pz + 0.6);
  const mkSign = (t2, c2) => canvasTex(512, 99, (x, w, h) => {
    const gr = x.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(10,8,22,.92)'); gr.addColorStop(1, 'rgba(6,6,16,.96)');
    x.fillStyle = gr; x.fillRect(0, 0, w, h); x.strokeStyle = c2; x.lineWidth = 6; x.strokeRect(6, 6, w - 12, h - 12);
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#fff'; x.font = '800 38px monospace'; x.fillText('THE DEV', w / 2, h * 0.4);
    x.fillStyle = c2; x.font = '600 18px monospace'; x.fillText(t2, w / 2, h * 0.76);
  });
  const SG_ON = mkSign('boss fight · solo · extreme', '#ff4fd8'), SG_OFF = mkSign('SEALED — defeat THE ORRERY', '#ff5a3a');
  const sign = put(new THREE.PlaneGeometry(4.4, 0.85), basic({ map: SG_OFF, transparent: true, side: THREE.DoubleSide }), px, y0 + 5.3, pz + 0.2);
  const N = 40, ep = new Float32Array(N * 3), ev = new Float32Array(N);
  const reseed = (i, fresh) => { ep[i * 3] = px + rnd(-1.8, 1.8); ep[i * 3 + 1] = y0 + (fresh ? rnd(0.3, 4) : 0.4); ep[i * 3 + 2] = pz + rnd(0.2, 1.2); ev[i] = rnd(0.6, 1.8); };
  for (let i = 0; i < N; i++) reseed(i, true);
  const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.BufferAttribute(ep, 3));
  const embers = new THREE.Points(eg, new THREE.PointsMaterial({ color: 0x4dff9a, size: 0.18, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })); embers.frustumCulled = false; g.add(embers);
  let hold = 0, boost = 0, tgt = 0, shown = true, prompt = null, was = null;
  const apply = (u) => {
    swirl.material.map = u ? TEX_ON : TEX_OFF; swirl.material.needsUpdate = true;
    halo.material.color.setHex(u ? 0xff4fd8 : 0xff5a3a); halo.material.opacity = u ? 0.75 : 0.5;
    sign.material.map = u ? SG_ON : SG_OFF; sign.material.needsUpdate = true;
    embers.material.color.setHex(u ? 0x4dff9a : 0x884433); arm1.visible = arm2.visible = u;
  };
  return {
    get prompt() { return prompt; },
    setVisible(on) { if (on !== shown) { shown = on; g.visible = on; } },
    /** returns true when the player enters the (unlocked) gate */
    update(dt, p, canUse, interact) {
      const u = !!isUnlocked();
      if (u !== was) { was = u; apply(u); }
      prompt = null; tgt = 0;
      const near = canUse && p && p.alive && Math.abs(p.x - px) < 3.2 && p.z < pz + 2.1 && Math.abs(p.y - y0) < 2.5;
      let enter = false;
      if (near && !u) { hold = 0; prompt = { text: 'THE DEV — SEALED', sub: 'Defeat THE ORRERY to break the seal', progress: 0 }; }
      else if (near) {
        hold += dt; tgt = clamp(hold / HOLD, 0, 1);
        prompt = { text: 'E — Fight THE DEV', sub: 'solo boss · 2 lives · extreme', progress: tgt };
        if (interact || hold >= HOLD) { hold = 0; enter = true; }
      } else hold = 0;
      boost += (tgt - boost) * (1 - Math.exp(-6 * dt));
      const spd = u ? 1 + boost * 3 : 0.15;
      swirl.rotation.z -= dt * 0.7 * spd; arm1.rotation.z += dt * 0.9; arm2.rotation.x += dt * 0.6; arm2.rotation.y += dt * 0.4;
      halo.scale.setScalar(1 + Math.sin(performance.now() * 0.004) * 0.02 + boost * 0.12);
      for (let i = 0; i < N; i++) { ep[i * 3 + 1] += ev[i] * dt * (u ? 1 + boost * 2 : 0.4); ep[i * 3] += Math.sin(performance.now() * 0.002 + i) * dt * 0.3; if (ep[i * 3 + 1] > y0 + 7) reseed(i, false); }
      eg.attributes.position.needsUpdate = true;
      return enter;
    },
  };
}
