/**
 * BOSS MODE 2 — THE ORRERY  (lib/boss2.js)
 * Engine of the Fallen Stars. Unlocked by beating the Riftwarden (see game.js).
 *
 * Completely different from boss.js:
 *  - airborne armillary machine, no pillars, no vent/core-exposure mechanic
 *  - WEAKNESS: bullets are deflected (core 6%, rings 2.5%). Its own gold "Resonance Orbs" can be SHOT BACK
 *    into it for the real damage (combo + close-return bonus). Void orbs can only be popped.
 *  - bullet-hell moveset, clock-wedge floor, constellation lines, eclipse, interruptible supernova
 *
 * Integration (game.js):  createOrrery({...}) -> { start, stop, update(dt), targets, frozen, active }
 * Self-contained: own FX / SFX / UI (does not import anything from boss.js).
 * Optional music: assets/boss/orrery.mp3 (falls back to a synth drone if the file is missing).
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

export const ORRERY = {
  NAME: 'THE ORRERY', SUB: 'ENGINE OF THE FALLEN STARS',
  HP: 18000, LIVES: 2, R: 46, SKY: 215, REFLECT: 300,
  MUSIC: 'assets/boss/orrery.mp3',
};
const COL = { gold: 0xffc857, cyan: 0x6fe3ff, white: 0xffffff, red: 0xff5a3a, green: 0x55ff99, void: 0x9a5cff };
const STAGE = {
  1: { spB: 0, halo: 0, corona: 0, heat: 0, pal: 0x6fe3ff },
  2: { spB: 1, halo: 1, corona: 0, heat: 0.25, pal: 0x7a8cff },
  3: { spB: 1, halo: 1.5, corona: 1, heat: 0.6, pal: 0xffd36b },
};

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
  return {
    glow: canvasTex(128, 128, radial([[0, 'rgba(255,255,255,1)'], [0.3, 'rgba(255,255,255,.55)'], [0.65, 'rgba(255,255,255,.12)'], [1, 'rgba(255,255,255,0)']])),
    ring: canvasTex(256, 256, radial([[0, 'rgba(255,255,255,0)'], [0.5, 'rgba(255,255,255,0)'], [0.86, 'rgba(255,255,255,.35)'], [0.96, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']])),
    wall: canvasTex(8, 128, (g, w, h) => {
      const r = g.createLinearGradient(0, h, 0, 0);
      r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.15, 'rgba(255,255,255,.7)'); r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r; g.fillRect(0, 0, w, h);
    }),
    disc: canvasTex(256, 256, (g, w, h) => {   // clock-face telegraph
      g.translate(w / 2, h / 2);
      g.fillStyle = 'rgba(255,255,255,.10)'; g.beginPath(); g.arc(0, 0, 120, 0, TAU); g.fill();
      g.strokeStyle = '#fff'; g.lineWidth = 6; g.beginPath(); g.arc(0, 0, 122, 0, TAU); g.stroke();
      g.lineWidth = 2; g.beginPath(); g.arc(0, 0, 104, 0, TAU); g.stroke();
      g.fillStyle = '#fff';
      for (let i = 0; i < 12; i++) { g.save(); g.rotate((i * TAU) / 12); g.fillRect(-3, 96, 6, 24); g.restore(); }
    }),
    fill: canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#fff'; g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 2, 0, TAU); g.fill(); }),
  };
}

// ======================================================================
//  SFX (own tiny synth on the game's AudioContext; capped voices)
// ======================================================================
function createSfx(audio) {
  let ctx = null, master = null, nb = null, live = 0, el = null, dr = null;
  const ready = () => {
    if (!ctx) {
      ctx = audio.getCtx && audio.getCtx(); master = audio.getMaster && audio.getMaster();
      if (!ctx || !master) { ctx = null; return false; }
      nb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = nb.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return ctx.state === 'running';
  };
  const env = (g, t, pk, a, dur) => {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(pk, 0.0002), t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dur);
  };
  const osc = (out, t, o) => {
    const { type = 'sine', f = 100, f2 = null, dur = 0.3, gain = 0.5, a = 0.004 } = o;
    const s = ctx.createOscillator(), g = ctx.createGain();
    s.type = type; s.frequency.setValueAtTime(f, t);
    if (f2) s.frequency.exponentialRampToValueAtTime(Math.max(18, f2), t + a + dur);
    env(g, t, gain, a, dur); s.connect(g); g.connect(out);
    s.start(t); s.stop(t + a + dur + 0.05);
    s.onended = () => { try { s.disconnect(); g.disconnect(); } catch (_) {} };
  };
  const nz = (out, t, o) => {
    const { type = 'lowpass', f = 800, f2 = null, q = 0.8, dur = 0.3, gain = 0.5, a = 0.004 } = o;
    const s = ctx.createBufferSource(), fl = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = nb; s.loop = true; fl.type = type; fl.Q.value = q; fl.frequency.setValueAtTime(f, t);
    if (f2) fl.frequency.exponentialRampToValueAtTime(Math.max(30, f2), t + a + dur);
    env(g, t, gain, a, dur); s.connect(fl); fl.connect(g); g.connect(out);
    s.start(t, Math.random() * 0.5); s.stop(t + a + dur + 0.05);
    s.onended = () => { try { s.disconnect(); fl.disconnect(); g.disconnect(); } catch (_) {} };
  };
  function play(vol, dur, fn, big) {
    if (!ready() || (live >= 7 && !big)) return;
    const g = ctx.createGain(); g.gain.value = vol; g.connect(master); live++;
    fn(g, ctx.currentTime + 0.004);
    setTimeout(() => { live--; try { g.disconnect(); } catch (_) {} }, (dur + 0.3) * 1000);
  }
  function drone(on) {
    if (!on) {
      if (dr) {
        const d = dr; dr = null;
        try { d.g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.3); } catch (_) {}
        setTimeout(() => { try { d.a.stop(); d.b.stop(); d.g.disconnect(); } catch (_) {} }, 1600);
      }
      return;
    }
    if (dr || !ready()) return;
    const g = ctx.createGain(); g.gain.value = 0.0001;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300;
    const a = ctx.createOscillator(), b = ctx.createOscillator();
    a.type = 'triangle'; a.frequency.value = 55; b.type = 'sine'; b.frequency.value = 82.4;
    a.connect(f); b.connect(f); f.connect(g); g.connect(master); a.start(); b.start();
    g.gain.setTargetAtTime(0.16, ctx.currentTime, 1.2);
    dr = { a, b, g, f };
  }
  const NOTES = [0, 2, 4, 7, 9];
  return {
    boom: (s = 1, v = 1) => play(v, 1.4 * s, (o, t) => {
      osc(o, t, { f: 80, f2: 22, dur: 0.9 * s, gain: 1.1 });
      nz(o, t, { f: 1600, f2: 60, dur: 1.0 * s, gain: 0.9 });
      nz(o, t, { type: 'highpass', f: 3000, dur: 0.12, gain: 0.5 });
      if (s > 1.2) osc(o, t + 0.05, { f: 46, f2: 20, dur: 1.4, gain: 0.9 });
    }, s > 1.4),
    hum: (v = 1) => play(v, 2.0, (o, t) => {
      osc(o, t, { type: 'sawtooth', f: 110, f2: 70, dur: 1.5, gain: 0.35, a: 0.2 });
      osc(o, t, { type: 'sine', f: 220, f2: 140, dur: 1.5, gain: 0.3, a: 0.25 });
      nz(o, t, { type: 'bandpass', f: 500, f2: 1600, q: 1.2, dur: 1.3, gain: 0.4, a: 0.25 });
    }, true),
    charge: (d = 1.5, v = 1) => play(v, d + 0.4, (o, t) => {
      osc(o, t, { type: 'triangle', f: 90, f2: 900, dur: d * 0.1, gain: 0.3, a: d * 0.9 });
      nz(o, t, { type: 'highpass', f: 600, f2: 7000, dur: d * 0.1, gain: 0.35, a: d * 0.9 });
      osc(o, t + d, { f: 160, f2: 40, dur: 0.3, gain: 0.45 });
    }),
    zap: (v = 1) => play(v, 0.3, (o, t) => {
      nz(o, t, { type: 'highpass', f: 3500, dur: 0.12, gain: 0.5 });
      osc(o, t, { type: 'square', f: 1800, f2: 220, dur: 0.18, gain: 0.2 });
    }),
    whoosh: (v = 1) => play(v, 0.6, (o, t) => nz(o, t, { type: 'bandpass', f: 200, f2: 2600, q: 0.9, dur: 0.45, gain: 0.5, a: 0.1 })),
    shatter: (v = 1) => play(v, 0.6, (o, t) => {
      nz(o, t, { type: 'highpass', f: 1800, dur: 0.5, gain: 0.6 });
      osc(o, t, { type: 'triangle', f: 3000, f2: 1600, dur: 0.25, gain: 0.2 });
    }),
    thump: (v = 1) => play(v, 0.4, (o, t) => {
      osc(o, t, { f: 64, f2: 28, dur: 0.3, gain: 0.9 });
      nz(o, t, { f: 400, f2: 80, dur: 0.25, gain: 0.55 });
    }),
    swell: (v = 1) => play(v, 1.6, (o, t) => {
      osc(o, t, { type: 'triangle', f: 110, f2: 330, dur: 0.5, gain: 0.3, a: 0.9 });
      nz(o, t, { type: 'bandpass', f: 400, f2: 2000, q: 1, dur: 0.5, gain: 0.3, a: 0.9 });
    }),
    chime: (n = 0, v = 1) => play(v, 1.4, (o, t) => {
      const f = 261.6 * Math.pow(2, NOTES[n % 5] / 12 + Math.floor(n / 5));
      osc(o, t, { f, dur: 1.1, gain: 0.35, a: 0.003 });
      osc(o, t, { f: f * 2.76, dur: 0.6, gain: 0.12, a: 0.003 });
    }),
    ping: (v = 1) => play(v, 0.5, (o, t) => {
      osc(o, t, { type: 'sine', f: 1300, f2: 2600, dur: 0.3, gain: 0.5 });
      nz(o, t, { type: 'highpass', f: 4000, dur: 0.15, gain: 0.35 });
    }),
    loop() {
      if (!ready()) return { set() {}, stop() {} };
      const g = ctx.createGain(); g.gain.value = 0.0001; g.connect(master);
      const a = ctx.createOscillator(), b = ctx.createOscillator();
      a.type = 'sawtooth'; a.frequency.value = 73; b.type = 'sine'; b.frequency.value = 146;
      a.connect(g); b.connect(g); a.start(); b.start();
      g.gain.linearRampToValueAtTime(0.45, ctx.currentTime + 0.15);
      return {
        set(v) { g.gain.setTargetAtTime(0.45 * v, ctx.currentTime, 0.05); },
        stop() { g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.12); setTimeout(() => { try { a.stop(); b.stop(); g.disconnect(); } catch (_) {} }, 700); },
      };
    },
    musicStart(url) {
      this.musicStop();
      try {
        el = new Audio(url); el.loop = true; el.volume = 0.45;
        el.addEventListener('error', () => { el = null; drone(true); });
        const p = el.play();
        if (p && p.catch) p.catch(() => { el = null; drone(true); });
      } catch (_) { el = null; drone(true); }
    },
    musicSet(i) { if (dr && ctx) dr.f.frequency.setTargetAtTime(240 + i * 520, ctx.currentTime, 0.5); if (el) el.volume = 0.35 + 0.2 * clamp(i, 0, 1); },
    musicStop() { if (el) { try { el.pause(); } catch (_) {} el = null; } drone(false); },
  };
}

// ======================================================================
//  FX: particles, shock walls, beams, telegraphs, decals, lightning, one flash light
// ======================================================================
function createFx(scene, camera, renderer) {
  const tx = makeTex();
  const root = new THREE.Group();
  root.visible = false;
  scene.add(root);
  const v2 = new THREE.Vector2(), _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3();
  let floorY = 0;
  const planeG = new THREE.PlaneGeometry(2, 2).rotateX(-PI / 2);
  const rectG = new THREE.PlaneGeometry(1, 1).rotateX(-PI / 2).translate(0, 0, 0.5);
  const unitCyl = new THREE.CylinderGeometry(1, 1, 1, 14, 1, true);
  const basic = (o) => new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, fog: false, ...o });
  const addM = (o) => basic({ blending: THREE.AdditiveBlending, ...o });
  function pool(n, make) {
    const a = [];
    for (let i = 0; i < n; i++) { const o = make(); o.on = false; a.push(o); }
    let k = 0;
    return {
      a,
      get() {
        for (let i = 0; i < n; i++) { const o = a[(k + i) % n]; if (!o.on) { k = (k + i + 1) % n; o.on = true; return o; } }
        const o = a[k]; k = (k + 1) % n; o.on = true; return o;
      },
    };
  }

  function points(max, additive) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(max * 3), col = new Float32Array(max * 4), siz = new Float32Array(max);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
    geo.setAttribute('size', new THREE.BufferAttribute(siz, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uK: { value: 700 } }, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: 'attribute float size; attribute vec4 color; varying vec4 vC; uniform float uK; void main(){ vC=color; vec4 mv=modelViewMatrix*vec4(position,1.0); gl_PointSize=clamp(size*uK/max(0.1,-mv.z),0.0,300.0); gl_Position=projectionMatrix*mv; }',
      fragmentShader: 'varying vec4 vC; void main(){ float d=length(gl_PointCoord-0.5)*2.0; float a=clamp(1.0-d,0.0,1.0); a*=a; gl_FragColor=vec4(vC.rgb,vC.a*a); if(gl_FragColor.a<0.004) discard; }',
    });
    const obj = new THREE.Points(geo, mat);
    obj.frustumCulled = false; obj.renderOrder = additive ? 6 : 5;
    const L = new Float32Array(max), ML = new Float32Array(max), VX = new Float32Array(max), VY = new Float32Array(max), VZ = new Float32Array(max);
    const S0 = new Float32Array(max), S1 = new Float32Array(max), AL = new Float32Array(max), GR = new Float32Array(max), DR = new Float32Array(max);
    const C0 = new Float32Array(max * 3), C1 = new Float32Array(max * 3);
    let head = 0;
    function emit(x, y, z, vx, vy, vz, life, s0, s1, c0, c1, a = 1, grav = 0, drag = 0) {
      const i = head; head = (head + 1) % max;
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z;
      VX[i] = vx; VY[i] = vy; VZ[i] = vz; L[i] = ML[i] = life; S0[i] = s0; S1[i] = s1; AL[i] = a; GR[i] = grav; DR[i] = drag;
      C0[i * 3] = ((c0 >> 16) & 255) / 255; C0[i * 3 + 1] = ((c0 >> 8) & 255) / 255; C0[i * 3 + 2] = (c0 & 255) / 255;
      C1[i * 3] = ((c1 >> 16) & 255) / 255; C1[i * 3 + 1] = ((c1 >> 8) & 255) / 255; C1[i * 3 + 2] = (c1 & 255) / 255;
    }
    function update(dt) {
      let any = false;
      for (let i = 0; i < max; i++) {
        if (L[i] <= 0) { if (siz[i] !== 0) { siz[i] = 0; any = true; } continue; }
        any = true;
        L[i] -= dt;
        const t = 1 - Math.max(0, L[i]) / ML[i], k = Math.max(0, 1 - DR[i] * dt), j = i * 3, c = i * 4;
        VX[i] *= k; VY[i] = VY[i] * k - GR[i] * dt; VZ[i] *= k;
        pos[j] += VX[i] * dt; pos[j + 1] += VY[i] * dt; pos[j + 2] += VZ[i] * dt;
        col[c] = C0[j] + (C1[j] - C0[j]) * t; col[c + 1] = C0[j + 1] + (C1[j + 1] - C0[j + 1]) * t; col[c + 2] = C0[j + 2] + (C1[j + 2] - C0[j + 2]) * t;
        col[c + 3] = AL[i] * (t < 0.12 ? t / 0.12 : 1 - (t - 0.12) / 0.88);
        siz[i] = S0[i] + (S1[i] - S0[i]) * t;
      }
      if (any) { geo.attributes.position.needsUpdate = true; geo.attributes.color.needsUpdate = true; geo.attributes.size.needsUpdate = true; }
    }
    function clear() { L.fill(0); siz.fill(0); geo.attributes.size.needsUpdate = true; }
    return { obj, emit, update, clear, mat };
  }
  const pa = points(1800, true), pn = points(500, false);
  root.add(pa.obj, pn.obj);
  const add = pa.emit, dark = pn.emit;
  function burst(x, y, z, n, spd, life, s0, s1, c0, c1, o = {}) {
    const E = o.dark ? dark : add, up = o.up || 0, grav = o.grav ?? 6, drag = o.drag ?? 0.8, a = o.a ?? 1, flat = o.flat || 0;
    for (let i = 0; i < n; i++) {
      const th = rnd(0, TAU), ph = Math.acos(rnd(-1, 1)), s = spd * rnd(0.3, 1);
      E(x, y, z, Math.sin(ph) * Math.cos(th) * s, (Math.cos(ph) * (1 - flat) + up) * s, Math.sin(ph) * Math.sin(th) * s, life * rnd(0.6, 1.2), s0, s1, c0, c1, a, grav, drag);
    }
  }

  const sprites = pool(64, () => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx.glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    s.visible = false; root.add(s);
    const o = {
      set(x, y, z, size, col, a = 1) { s.visible = true; s.position.set(x, y, z); s.scale.setScalar(size); s.material.color.setHex(col); s.material.opacity = a; },
      hide() { s.visible = false; o.on = false; },
    };
    return o;
  });
  const sprNorm = pool(16, () => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx.glow, transparent: true, depthWrite: false, blending: THREE.NormalBlending, fog: false }));
    s.visible = false; root.add(s);
    const o = {
      set(x, y, z, size, col, a = 1) { s.visible = true; s.position.set(x, y, z); s.scale.setScalar(size); s.material.color.setHex(col); s.material.opacity = a; },
      hide() { s.visible = false; o.on = false; },
    };
    return o;
  });
  const sprite = (additive = true) => (additive ? sprites : sprNorm).get();

  const balls = [];
  function ball(x, y, z, r, col, life) { const h = sprites.get(); h.set(x, y, z, 0.1, col, 1); balls.push({ h, x, y, z, r, life, t: 0, col }); }

  const waves = pool(16, () => {
    const g = new THREE.Group();
    const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 48, 1, true).translate(0, 0.5, 0), addM({ map: tx.wall, side: THREE.DoubleSide }));
    const ring = new THREE.Mesh(planeG, addM({ map: tx.ring }));
    g.add(wall, ring); g.visible = false; root.add(g);
    const o = {
      place(x, y, z, r, w, h, a, col) {
        g.visible = true; g.position.set(x, y, z); wall.scale.set(r, h, r); ring.scale.set(r + w * 0.5, 1, r + w * 0.5);
        wall.material.opacity = a; ring.material.opacity = a * 0.9; wall.material.color.setHex(col); ring.material.color.setHex(col);
      },
      hide() { g.visible = false; o.on = false; },
    };
    return o;
  });

  const LAY = [[0.35, 1.0], [0.75, 0.55], [1.25, 0.28]];
  const beams = pool(20, () => {
    const g = new THREE.Group(); g.visible = false; root.add(g);
    const ms = LAY.map(() => { const m = new THREE.Mesh(unitCyl, addM({ color: 0xffffff })); m.renderOrder = 7; g.add(m); return m; });
    const o = {
      set(ax, ay, az, bx, by, bz, r, col, a = 1) {
        g.visible = true;
        const dx = bx - ax, dy = by - ay, dz = bz - az, L = Math.hypot(dx, dy, dz) || 1e-3;
        g.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
        g.quaternion.copy(_q.setFromUnitVectors(_up, _d.set(dx / L, dy / L, dz / L)));
        for (let i = 0; i < 3; i++) {
          ms[i].scale.set(r * LAY[i][0], L, r * LAY[i][0]);
          ms[i].material.color.setHex(i === 0 ? 0xffffff : col); ms[i].material.opacity = a * LAY[i][1];
        }
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
  const teleP = { disc: pool(20, mkTele('disc')), rect: pool(36, mkTele('rect')) };
  const teleL = [];
  function tele(kind, o) {
    const h = teleP[kind].get();
    h.o = o; h.t = 0; h.dur = o.dur || 1; h.g.visible = true;
    const col = o.col ?? 0xff2a2a;
    h.base.material.color.setHex(col); h.prog.material.color.setHex(col);
    if (!teleL.includes(h)) teleL.push(h);
    return h;
  }

  const decG = pool(20, () => { const m = new THREE.Mesh(planeG, addM({ map: tx.glow })); m.renderOrder = 2; m.visible = false; root.add(m); return { m, hide() { m.visible = false; this.on = false; } }; });
  const decL = [];
  function decal(x, z, r, col, life) {
    const d = decG.get();
    d.m.visible = true; d.m.position.set(x, floorY + 0.06 + Math.random() * 0.01, z); d.m.scale.set(r, 1, r); d.m.material.color.setHex(col); d.m.material.opacity = 1;
    decL.push({ d, life, t: 0 });
  }

  const arcs = pool(14, () => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(16 * 3), 3));
    const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    line.frustumCulled = false; line.visible = false; root.add(line);
    return { line, geo, a: new THREE.Vector3(), b: new THREE.Vector3(), life: 0, max: 1, amp: 1, hide() { line.visible = false; this.on = false; } };
  });
  const arcL = [];
  function arc(ax, ay, az, bx, by, bz, col, life, amp = 2) {
    const o = arcs.get(); o.a.set(ax, ay, az); o.b.set(bx, by, bz); o.life = o.max = life; o.amp = amp; o.line.visible = true; o.line.material.color.setHex(col);
    if (!arcL.includes(o)) arcL.push(o);
  }

  const light = new THREE.PointLight(0xffffff, 0, 190, 2);
  light.visible = false; root.add(light);
  const lt = { t: 0, dur: 1, peak: 0 };
  function flashLight(x, y, z, col, peak, dur) {
    if (lt.t > 0 && peak < light.intensity * 0.7) return;
    light.position.set(x, y, z); light.color.setHex(col); lt.t = dur; lt.dur = dur; lt.peak = peak;
  }

  function update(dt) {
    if (!root.visible) return;
    pa.mat.uniforms.uK.value = pn.mat.uniforms.uK.value = renderer.getDrawingBufferSize(v2).y / (2 * Math.tan((camera.fov * PI) / 360));
    pa.update(dt); pn.update(dt);
    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i]; b.t += dt; const p = b.t / b.life;
      if (p >= 1) { b.h.hide(); balls.splice(i, 1); continue; }
      b.h.set(b.x, b.y, b.z, b.r * (0.3 + 0.9 * outC(p)), b.col, Math.pow(1 - p, 1.5));
    }
    for (let i = beamT.length - 1; i >= 0; i--) {
      const b = beamT[i]; b.t += dt; const p = b.t / b.life;
      if (p >= 1) { b.h.hide(); beamT.splice(i, 1); continue; }
      b.h.set(b.ax, b.ay, b.az, b.bx, b.by, b.bz, b.r * (p < 0.15 ? p / 0.15 : 1 - (p - 0.15) * 0.6), b.col, p < 0.1 ? 1 : 1 - p);
    }
    for (let i = teleL.length - 1; i >= 0; i--) {
      const h = teleL[i];
      if (!h.on) { teleL.splice(i, 1); continue; }
      h.t += dt; const p = Math.min(1, h.t / h.dur), o = h.o;
      if (h.t > h.dur + 0.15) { h.kill(); teleL.splice(i, 1); continue; }
      const pulse = 0.5 + 0.5 * Math.sin(h.t * 16);
      h.g.position.set(o.x, floorY + 0.1, o.z);
      if (h.kind === 'disc') { h.base.scale.set(o.r, 1, o.r); h.prog.scale.set(o.r * p, 1, o.r * p); h.base.material.opacity = 0.35 + 0.35 * pulse * p; h.prog.material.opacity = 0.3; }
      else { h.g.rotation.y = Math.atan2(o.dx, o.dz); h.base.scale.set(o.w, 1, o.len); h.prog.scale.set(o.w, 1, Math.max(0.01, o.len * p)); h.base.material.opacity = 0.16 + 0.1 * pulse * p; h.prog.material.opacity = 0.32; }
    }
    for (let i = decL.length - 1; i >= 0; i--) {
      const d = decL[i]; d.t += dt; const p = d.t / d.life;
      if (p >= 1) { d.d.hide(); decL.splice(i, 1); continue; }
      d.d.m.material.opacity = p < 0.7 ? 1 : 1 - (p - 0.7) / 0.3;
    }
    for (let i = arcL.length - 1; i >= 0; i--) {
      const o = arcL[i]; o.life -= dt;
      if (o.life <= 0) { o.hide(); arcL.splice(i, 1); continue; }
      const pos = o.geo.attributes.position;
      for (let k = 0; k < 16; k++) {
        const t = k / 15, e = k === 0 || k === 15 ? 0 : o.amp * Math.sin(PI * t);
        pos.setXYZ(k, o.a.x + (o.b.x - o.a.x) * t + rnd(-e, e), o.a.y + (o.b.y - o.a.y) * t + rnd(-e, e), o.a.z + (o.b.z - o.a.z) * t + rnd(-e, e));
      }
      pos.needsUpdate = true; o.line.material.opacity = o.life / o.max;
    }
    if (lt.t > 0) { lt.t -= dt; const k = Math.max(0, lt.t / lt.dur); light.intensity = lt.peak * k * k; } else light.intensity = 0;
  }
  function clear() {
    pa.clear(); pn.clear();
    for (const b of balls) b.h.hide(); balls.length = 0;
    for (const b of beamT) b.h.hide(); beamT.length = 0;
    for (const t of teleL) t.kill(); teleL.length = 0;
    for (const d of decL) d.d.hide(); decL.length = 0;
    for (const a of arcL) a.hide(); arcL.length = 0;
    for (const p of [waves, beams, sprites, sprNorm]) for (const o of p.a) if (o.on) o.hide();
    light.intensity = 0; lt.t = 0;
  }
  return {
    tx, root, add, dark, burst, sprite, ball, wave: () => waves.get(), beam: () => beams.get(), beamT: beamTimed,
    tele, decal, arc, light: flashLight, update, clear,
    setFloor(y) { floorY = y; },
    setEnabled(on) { root.visible = on; light.visible = on; },
  };
}

// ======================================================================
//  RIG: the Orrery (procedural). Rings, spires, core, pupil, eclipse disc, corona rays.
// ======================================================================
function buildRig() {
  const M = {
    gold: new THREE.MeshStandardMaterial({ color: 0xb8903a, metalness: 0.95, roughness: 0.28, emissive: 0xffa21f, emissiveIntensity: 0 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x12141b, metalness: 0.85, roughness: 0.4 }),
    glow: new THREE.MeshBasicMaterial({ color: 0x6fe3ff, toneMapped: false }),
    core: new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
    black: new THREE.MeshBasicMaterial({ color: 0x000000 }),
    ray: new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }),
    hit: new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  };
  const root = new THREE.Group();
  const nc = (o) => { o.frustumCulled = false; return o; };
  const coreG = new THREE.Group(); root.add(coreG);
  const coreMesh = nc(new THREE.Mesh(new THREE.IcosahedronGeometry(3.4, 2), M.core)); coreG.add(coreMesh);
  const pupil = nc(new THREE.Mesh(new THREE.SphereGeometry(1.25, 16, 12), M.black)); pupil.scale.set(1, 1, 0.45); coreG.add(pupil);
  const eclipse = nc(new THREE.Mesh(new THREE.SphereGeometry(4.3, 24, 16), M.black)); eclipse.scale.setScalar(0.001); coreG.add(eclipse);
  const halo = nc(new THREE.Mesh(new THREE.TorusGeometry(5.6, 0.22, 8, 64), M.glow)); halo.rotation.x = PI / 2; coreG.add(halo);
  const corona = new THREE.Group(); coreG.add(corona);
  for (let i = 0; i < 18; i++) {
    const len = 20 + rnd(0, 14), ray = nc(new THREE.Mesh(new THREE.ConeGeometry(0.7, len, 5).translate(0, len / 2 + 4, 0), M.ray));
    ray.rotation.set(rnd(0, TAU), rnd(0, TAU), 0); corona.add(ray);
  }
  const hits = [];
  const hit = (parent, geo, kind) => {
    const m = new THREE.Mesh(geo, M.hit); m.visible = false; m.userData.hitZone = kind === 'core' ? 'head' : 'body'; m.userData.kind = kind;
    parent.add(m); hits.push(m); return m;
  };
  hit(coreG, new THREE.SphereGeometry(5.2, 12, 8), 'core');

  const rings = [];
  for (const [r, tube, tx, tz] of [[9.5, 0.55, 0.35, 0.0], [13.5, 0.6, -0.5, 0.8], [18, 0.7, 0.2, -0.6]]) {
    const g = new THREE.Group(); root.add(g);
    const spin = new THREE.Group(); g.add(spin);
    spin.add(nc(new THREE.Mesh(new THREE.TorusGeometry(r, tube, 8, 72), M.gold)));
    const ticks = nc(new THREE.InstancedMesh(new THREE.BoxGeometry(0.45, 1.5, 0.45), M.glow, 48)), dm = new THREE.Object3D();
    for (let k = 0; k < 48; k++) {
      const a = (k / 48) * TAU;
      dm.position.set(Math.cos(a) * r, Math.sin(a) * r, 0); dm.rotation.set(0, 0, a - PI / 2); dm.scale.set(1, k % 4 === 0 ? 1.7 : 1, 1); dm.updateMatrix();
      ticks.setMatrixAt(k, dm.matrix);
    }
    spin.add(ticks);
    hit(spin, new THREE.TorusGeometry(r, tube + 1.1, 6, 36), 'ring');
    rings.push({ g, spin, tx, tz });
  }

  const spA = new THREE.Group(), spB = new THREE.Group(); root.add(spA, spB);
  for (let k = 0; k < 4; k++) {
    for (const [grp, len, off] of [[spA, 34, 0], [spB, 22, PI / 4]]) {
      const g = new THREE.Group(); g.rotation.y = -(k * PI / 2 + off); grp.add(g);
      g.add(nc(new THREE.Mesh(new THREE.ConeGeometry(1.3, len, 4).rotateZ(-PI / 2).translate(11 + len / 2, 0, 0), M.gold)));
      g.add(nc(new THREE.Mesh(new THREE.BoxGeometry(len * 0.8, 0.18, 0.5).translate(13 + len * 0.4, 0, 0), M.glow)));
    }
  }
  for (const s of [-1, 1]) spA.add(nc(new THREE.Mesh(new THREE.ConeGeometry(0.9, 14, 4).translate(0, 7 + 8, 0), M.gold))).rotation && 0, spA.children[spA.children.length - 1].scale.y = s;

  const light = new THREE.PointLight(0xaaf0ff, 1000, 170, 2); coreG.add(light);
  return { root, M, coreG, coreMesh, pupil, eclipse, halo, corona, rings, spA, spB, hits, light };
}

// ======================================================================
//  ARENA: observatory deck (star-chart floor, 12 clock wedges, armillary frame, planet, drifting ruins)
// ======================================================================
function buildArena(AX, AY, AZ, R) {
  const g = new THREE.Group();
  g.position.set(AX, AY, AZ); g.visible = false;
  const brass = new THREE.MeshStandardMaterial({ color: 0x1a1c24, roughness: 0.55, metalness: 0.85, flatShading: true });
  const chart = canvasTex(1024, 1024, (c, w, h) => {
    c.fillStyle = '#03060c'; c.fillRect(0, 0, w, h); c.translate(w / 2, h / 2); c.strokeStyle = '#fff'; c.fillStyle = '#fff';
    for (const [r, lw] of [[498, 8], [472, 2], [420, 3], [340, 2], [260, 4], [180, 2], [96, 4]]) { c.lineWidth = lw; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.stroke(); }
    c.lineWidth = 2;
    for (let i = 0; i < 12; i++) { const a = ((i + 0.5) / 12) * TAU; c.beginPath(); c.moveTo(Math.cos(a) * 96, Math.sin(a) * 96); c.lineTo(Math.cos(a) * 498, Math.sin(a) * 498); c.stroke(); }
    for (let i = 0; i < 144; i++) { const a = (i / 144) * TAU, r1 = i % 6 === 0 ? 450 : 462; c.beginPath(); c.moveTo(Math.cos(a) * 472, Math.sin(a) * 472); c.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); c.stroke(); }
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU; c.save(); c.translate(Math.cos(a) * 380, Math.sin(a) * 380); c.rotate(a); c.beginPath();
      for (let k = 0; k < 10; k++) { const rr = k % 2 ? 9 : 22, aa = (k / 10) * TAU; c.lineTo(Math.cos(aa) * rr, Math.sin(aa) * rr); }
      c.closePath(); c.fill(); c.restore();
    }
    c.lineWidth = 1.5;
    for (let n = 0; n < 7; n++) { let x = rnd(-230, 230), y = rnd(-230, 230); c.beginPath(); c.moveTo(x, y); for (let k = 0; k < 4; k++) { x += rnd(-60, 60); y += rnd(-60, 60); c.lineTo(x, y); } c.stroke(); }
    c.setLineDash([6, 10]); c.lineWidth = 2; c.beginPath(); c.arc(0, 0, 300, 0, TAU); c.stroke(); c.setLineDash([]);
  });
  const floorMat = new THREE.MeshStandardMaterial({ map: chart, emissiveMap: chart, emissive: 0x6fe3ff, emissiveIntensity: 1.1, roughness: 0.45, metalness: 0.6 });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(R, 96).rotateX(-PI / 2), floorMat);
  floor.position.y = 0.02; floor.receiveShadow = true; g.add(floor);
  const under = new THREE.Mesh(new THREE.CylinderGeometry(R + 1.5, 9, 30, 32), brass); under.position.y = -15; g.add(under);
  const edgeMat = new THREE.MeshBasicMaterial({ color: 0x6fe3ff });
  const edge = new THREE.Mesh(new THREE.TorusGeometry(R, 0.45, 8, 120).rotateX(PI / 2), edgeMat); edge.position.y = 0.3; g.add(edge);
  for (let i = 0; i < 12; i++) {
    const a = ((i + 0.5) / 12) * TAU, x = Math.cos(a) * (R + 1), z = Math.sin(a) * (R + 1);
    const col = new THREE.Mesh(new THREE.BoxGeometry(1.8, 11, 1.8), brass); col.position.set(x, 5.5, z); col.castShadow = true; g.add(col);
    const cap = new THREE.Mesh(new THREE.OctahedronGeometry(0.9, 0), edgeMat); cap.scale.y = 1.8; cap.position.set(x, 12.6, z); g.add(cap);
  }
  const wedges = [];
  for (let i = 0; i < 12; i++) {
    const a = (i * PI) / 6, len = PI / 6 - 0.025;
    const geo = new THREE.CircleGeometry(R - 0.8, 14, -a - len / 2, len).rotateX(-PI / 2);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    m.position.y = 0.07; m.renderOrder = 2; g.add(m);
    wedges.push({ m, op: 0, hold: 0 });
  }
  const corrMat = new THREE.MeshBasicMaterial({ color: 0xff5a3a, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const corr = new THREE.Mesh(new THREE.RingGeometry(1, 1.5, 96).rotateX(-PI / 2), corrMat); corr.position.y = 0.08; corr.scale.setScalar(R); g.add(corr);

  // armillary frame (great circles) + planet + sky dome + drifting ruins
  const frame = new THREE.Group(); g.add(frame);
  const frameMats = [];
  for (const [r, rx, rz] of [[64, PI / 2, 0], [62, 0, 0], [66, PI / 4, PI / 3]]) {
    const m = new THREE.MeshBasicMaterial({ color: 0x6fe3ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    frameMats.push(m);
    const t = new THREE.Mesh(new THREE.TorusGeometry(r, 0.5, 6, 120), m); t.rotation.set(rx, rz, 0); frame.add(t);
  }
  const planetTex = canvasTex(512, 256, (c, w, h) => { for (let y = 0; y < h; y += 4) { c.fillStyle = `hsl(${rnd(28, 48)},${rnd(35, 60)}%,${rnd(22, 52)}%)`; c.fillRect(0, y, w, 4); } });
  const planet = new THREE.Mesh(new THREE.SphereGeometry(58, 32, 20), new THREE.MeshBasicMaterial({ map: planetTex, fog: false }));
  planet.position.set(-200, 90, -250); g.add(planet);
  const pring = new THREE.Mesh(new THREE.RingGeometry(80, 118, 64), new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0.45, side: THREE.DoubleSide, fog: false, depthWrite: false }));
  pring.position.copy(planet.position); pring.rotation.x = PI / 2 - 0.35; g.add(pring);
  const ruins = [];
  for (let i = 0; i < 14; i++) {
    const a = rnd(0, TAU), d = rnd(75, 150), s = rnd(4, 11), m = new THREE.Mesh(i % 2 ? new THREE.BoxGeometry(1, 1, 1) : new THREE.IcosahedronGeometry(1, 0), brass);
    m.scale.set(s, s * rnd(0.4, 0.9), s); m.position.set(Math.cos(a) * d, rnd(-40, 70), Math.sin(a) * d); m.rotation.set(rnd(0, 3), rnd(0, 3), rnd(0, 3));
    g.add(m); ruins.push({ m, y: m.position.y, ph: rnd(0, TAU), sp: rnd(0.1, 0.3) });
  }
  const domeTex = canvasTex(1024, 512, (c, w, h) => {
    const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#02040a'); gr.addColorStop(0.55, '#07162a'); gr.addColorStop(0.82, '#10303a'); gr.addColorStop(1, '#060c12');
    c.fillStyle = gr; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) { const x = rnd(0, w), y = rnd(h * 0.2, h * 0.85), r = rnd(60, 190), rg = c.createRadialGradient(x, y, 0, x, y, r), col = Math.random() < 0.5 ? '80,220,255' : '255,200,90'; rg.addColorStop(0, `rgba(${col},.13)`); rg.addColorStop(1, `rgba(${col},0)`); c.fillStyle = rg; c.fillRect(x - r, y - r, r * 2, r * 2); }
    c.fillStyle = '#fff'; for (let i = 0; i < 480; i++) { c.globalAlpha = rnd(0.2, 0.95); c.fillRect(rnd(0, w), rnd(0, h * 0.8), rnd(1, 2.2), rnd(1, 2.2)); }
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(330, 24, 16), new THREE.MeshBasicMaterial({ map: domeTex, side: THREE.BackSide, fog: false, depthWrite: false }));
  dome.renderOrder = -20; dome.frustumCulled = false;

  const col = new THREE.Color();
  function setPalette(hex) {
    col.setHex(hex);
    edgeMat.color.copy(col); floorMat.emissive.copy(col);
    for (const m of frameMats) m.color.copy(col);
  }
  function wedge(i, c, op, hold) { const w = wedges[((i % 12) + 12) % 12]; w.m.material.color.setHex(c); w.op = op; w.hold = hold; }
  function update(t, dt, cam) {
    frame.rotation.y += dt * 0.03; frame.rotation.x = Math.sin(t * 0.08) * 0.05;
    pring.rotation.z += dt * 0.01;
    for (const r of ruins) { r.m.position.y = r.y + Math.sin(t * r.sp + r.ph) * 3; r.m.rotation.y += dt * 0.05; }
    for (const w of wedges) {
      if (w.hold > 0) { w.hold -= dt; w.m.material.opacity = w.op * (0.72 + 0.28 * Math.sin(t * 14)); }
      else { w.op = Math.max(0, w.op - dt * 2.2); w.m.material.opacity = w.op; }
    }
    edge.position.y = 0.3 + Math.sin(t * 2) * 0.05;
    corrMat.opacity = 0.3 + 0.15 * Math.sin(t * 5);
    dome.position.copy(cam.position);
    dome.scale.setScalar(Math.max(0.3, (cam.far * 0.9) / 330));
  }
  return { group: g, dome, floorMat, corr, setPalette, wedge, update };
}

// ======================================================================
//  UI (boss bar, resonance combo, title cards, flashes, end screen) — plain DOM
// ======================================================================
const CSS = `
#orUI{position:fixed;inset:0;z-index:40;pointer-events:none;display:none;font-family:system-ui,sans-serif;color:#fff}
#orUI.on{display:block}
#orUI *{box-sizing:border-box}
.or-bar{position:absolute;top:calc(env(safe-area-inset-top,0px) + 68px);left:50%;transform:translateX(-50%);width:min(320px,42vw);text-shadow:0 1px 4px #000;transition:opacity .7s,transform .7s}
.or-bar.off{opacity:0;transform:translate(-50%,-16px)}
.or-nm{display:flex;justify-content:center;font-weight:800;letter-spacing:.24em;font-size:10px;color:#fff3cf}
.or-tr{position:relative;height:7px;margin-top:3px;background:rgba(4,10,18,.85);border:1px solid rgba(255,214,120,.8);box-shadow:0 0 10px rgba(255,200,90,.35)}
.or-fill,.or-trail{position:absolute;inset:0;transform-origin:left center}
.or-fill{background:linear-gradient(90deg,#5fe0ff,#ffd36b);transition:transform .12s}
.or-trail{background:rgba(255,255,255,.55);transition:transform .9s .25s}
.or-tick{position:absolute;top:-2px;bottom:-2px;width:1px;background:#fff;opacity:.7}
.or-st{display:flex;justify-content:space-between;font-size:9px;font-weight:700;letter-spacing:.14em;margin-top:3px;min-height:11px}
.or-stt{color:#ffd36b}.or-stt.hot{color:#ff6b6b}.or-lv{color:#ffd36b}
.or-combo{text-align:center;font-size:10px;font-weight:900;letter-spacing:.2em;margin-top:5px;color:#ffe08a;text-shadow:0 0 12px rgba(255,200,80,.9);opacity:0;transition:opacity .2s}
.or-combo.on{opacity:1}
.or-pop{position:absolute;left:0;right:0;top:42%;text-align:center;font-weight:900;letter-spacing:.2em;font-size:clamp(12px,2.4vw,20px);color:#fff3b0;text-shadow:0 0 14px rgba(255,190,60,.95),0 2px 6px #000;opacity:0}
.or-pop.show{animation:orPop .95s ease both}
@keyframes orPop{0%{opacity:0;transform:translateY(8px) scale(.8)}15%{opacity:1;transform:translateY(0) scale(1.1)}100%{opacity:0;transform:translateY(-26px) scale(1)}}
.or-card{position:absolute;left:0;right:0;top:30%;text-align:center;opacity:0;text-shadow:0 0 30px rgba(255,200,90,.9),0 4px 10px #000}
.or-card h1{margin:0;font-size:clamp(24px,6vw,60px);letter-spacing:.3em;font-weight:900;color:#fff6d8}
.or-card p{margin:8px 0 0;font-size:clamp(11px,2vw,18px);letter-spacing:.35em;opacity:.85;color:#9af0ff}
.or-card.show{animation:orCard var(--d,3s) ease both}
@keyframes orCard{0%{opacity:0;transform:scale(1.25)}10%{opacity:1;transform:scale(1)}80%{opacity:1}100%{opacity:0}}
.or-flash{position:absolute;inset:0;opacity:0;background:#fff}
.or-hint{position:absolute;left:0;right:0;top:calc(env(safe-area-inset-top,0px) + 112px);text-align:center;font-weight:800;letter-spacing:.2em;font-size:12px;text-shadow:0 2px 8px #000;opacity:0;transition:opacity .25s;color:#fff3cf}
.or-hint.on{opacity:1}
.or-skip{position:absolute;left:0;right:0;bottom:calc(env(safe-area-inset-bottom,0px) + 64px);text-align:center;font-size:11px;font-weight:700;letter-spacing:.3em;opacity:0;transition:opacity .4s;text-shadow:0 2px 6px #000}
.or-skip.on{opacity:.7}
.or-dead{position:absolute;inset:0;display:none;align-items:center;justify-content:center;flex-direction:column;background:radial-gradient(circle,rgba(0,20,40,.35),rgba(0,0,0,.78))}
.or-dead.on{display:flex}
.or-dead h2{margin:0;font-size:clamp(26px,6vw,46px);letter-spacing:.3em}.or-dead p{opacity:.8;letter-spacing:.2em}
.or-end{position:absolute;inset:0;display:none;overflow:auto;-webkit-overflow-scrolling:touch;background:rgba(2,6,12,.86);pointer-events:auto}
.or-end.on{display:block}
.or-box{width:min(92vw,520px);margin:max(3vh,10px) auto;padding:18px 20px;text-align:center;border:1px solid rgba(255,214,120,.55);background:rgba(6,12,22,.95);box-shadow:0 0 50px rgba(255,200,90,.3)}
.or-box h2{margin:0 0 6px;font-size:clamp(18px,5vw,30px);letter-spacing:.16em;line-height:1.2;color:#fff3cf}
.or-box p{margin:4px 0;letter-spacing:.08em;opacity:.85;font-size:13px}
.or-btns{display:flex;gap:10px;justify-content:center;margin-top:14px;flex-wrap:wrap}
.or-btns button{flex:1 1 150px;min-height:46px;padding:.6rem 1rem;font:800 13px system-ui,sans-serif;letter-spacing:.12em;color:#fff;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.35);border-radius:6px;cursor:pointer}
.or-btns button.go{background:#ffc857;border-color:#ffc857;color:#14100a}`;

function createUi({ onRetry, onLobby, onSkip }) {
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const el = document.createElement('div'); el.id = 'orUI';
  el.innerHTML =
    '<div class="or-bar off"><div class="or-nm"><b>' + ORRERY.NAME + '</b></div>' +
    '<div class="or-tr"><div class="or-trail"></div><div class="or-fill"></div><u class="or-tick" style="left:66%"></u><u class="or-tick" style="left:33%"></u></div>' +
    '<div class="or-st"><span class="or-ph"></span><span class="or-stt"></span><span class="or-lv"></span></div>' +
    '<div class="or-combo"></div></div>' +
    '<div class="or-pop"></div><div class="or-card"><h1></h1><p></p></div><div class="or-flash"></div><div class="or-hint"></div>' +
    '<div class="or-skip">TAP OR PRESS SPACE TO SKIP</div>' +
    '<div class="or-dead"><h2>YOU DIED</h2><p class="or-deadp"></p></div>' +
    '<div class="or-end"><div class="or-box"><h2 class="or-et"></h2><p class="or-ep"></p><p class="or-es"></p>' +
    '<div class="or-btns"><button class="go or-retry">FIGHT AGAIN (R)</button><button class="or-lobby">BACK TO LOBBY</button></div></div></div>';
  document.body.appendChild(el);
  const q = (s) => el.querySelector(s);
  const bar = q('.or-bar'), fill = q('.or-fill'), trail = q('.or-trail'), ph = q('.or-ph'), stt = q('.or-stt'), lv = q('.or-lv'), combo = q('.or-combo'), pop = q('.or-pop');
  const card = q('.or-card'), flash = q('.or-flash'), hint = q('.or-hint'), dead = q('.or-dead'), end = q('.or-end'), skip = q('.or-skip');
  q('.or-retry').addEventListener('click', () => onRetry());
  q('.or-lobby').addEventListener('click', () => onLobby());
  let lastHp = '', hintT = 0, skipOn = false;
  const doSkip = (e) => {
    if (!skipOn) return;
    if (e.type === 'keydown' && e.code !== 'Space' && e.code !== 'Enter') return;
    onSkip();
  };
  addEventListener('pointerdown', doSkip);
  addEventListener('keydown', doSkip);
  return {
    show() { el.classList.add('on'); },
    hide() { el.classList.remove('on'); end.classList.remove('on'); dead.classList.remove('on'); hint.classList.remove('on'); flash.style.opacity = 0; bar.classList.add('off'); skipOn = false; skip.classList.remove('on'); },
    bar(on) { bar.classList.toggle('off', !on); },
    skip(on) { skipOn = on; skip.classList.toggle('on', on); },
    setHp(f) { const v = f.toFixed(3); if (v !== lastHp) { lastHp = v; fill.style.transform = `scaleX(${v})`; trail.style.transform = `scaleX(${v})`; } },
    setPhase(p) { ph.textContent = 'PHASE ' + ['I', 'II', 'III'][p - 1]; },
    setStatus(t, hot) { if (stt.textContent !== t) stt.textContent = t; stt.classList.toggle('hot', !!hot); },
    setLives(n) { lv.textContent = '★'.repeat(Math.max(0, n)) + '☆'.repeat(Math.max(0, ORRERY.LIVES - n)); },
    combo(n) { combo.classList.toggle('on', n > 0); if (n > 0) combo.textContent = 'RESONANCE ×' + n + '  ·  DMG ×' + (1 + 0.1 * Math.min(n - 1, 5)).toFixed(1); },
    pop(t) { pop.textContent = t; pop.classList.remove('show'); void pop.offsetWidth; pop.classList.add('show'); },
    card(t, s, sec = 3) { card.querySelector('h1').textContent = t; card.querySelector('p').textContent = s || ''; card.style.setProperty('--d', sec + 's'); card.classList.remove('show'); void card.offsetWidth; card.classList.add('show'); },
    flash(color, a, sec) { flash.style.background = color; flash.style.transition = 'none'; flash.style.opacity = a; void flash.offsetWidth; flash.style.transition = `opacity ${sec}s ease-out`; flash.style.opacity = 0; },
    hint(t, sec = 3) { hint.textContent = t; hint.classList.add('on'); hintT = sec; },
    tick(dt) { if (hintT > 0) { hintT -= dt; if (hintT <= 0) hint.classList.remove('on'); } },
    dead(on, left) { dead.classList.toggle('on', !!on); if (on) q('.or-deadp').textContent = left > 0 ? `${left} ${left === 1 ? 'LIFE' : 'LIVES'} LEFT` : ''; },
    end(win, stats) {
      q('.or-et').textContent = win ? 'THE ORRERY IS SILENT' : 'THE STARS ARE UNMOVED';
      q('.or-ep').textContent = win ? 'The fallen stars find their places.' : 'The Orrery keeps turning.';
      const m = Math.floor(stats.time / 60), s = Math.floor(stats.time % 60);
      q('.or-es').textContent = `TIME ${m}:${String(s).padStart(2, '0')}  ·  DEATHS ${stats.deaths}  ·  DAMAGE TAKEN ${Math.round(stats.taken)}  ·  BEST STREAK ×${stats.best}`;
      end.classList.add('on');
    },
    hideEnd() { end.classList.remove('on'); },
  };
}

// ======================================================================
//  THE BOSS
// ======================================================================
export function createOrrery(deps) {
  const { scene, camera, renderer, world, audio, hud, player, ctrl, viewmodel, playerMesh, onExit, onWin } = deps;
  const AX = world.arena.x, AZ = world.arena.z, AY = Math.round(heightAt(AX, AZ)) + ORRERY.SKY, R0 = ORRERY.R;
  const targets = [];
  const _w = new THREE.Vector3(), _v = new THREE.Vector3(), _cp = new THREE.Vector3(), _cq = new THREE.Quaternion();
  const _m4 = new THREE.Matrix4(), _lq = new THREE.Quaternion(), _upV = new THREE.Vector3(0, 1, 0), _dm = new THREE.Object3D(), _c = new THREE.Color();
  let built = false, fx = null, sfx = null, ui = null, rig = null, arena = null, hemi = null, floorCol = null;
  let savedSpawns = null, saved = null;
  let bI = null, gI = null, orbRoot = null, bHead = 0;
  const S = {}, B = [], moons = [], orbT = [], BN = 420, ON = 14;
  const ctxFake = { player, enemies: [], audio: { play() {} }, bullets: null, net: null, build: null };
  const sunDirV = new THREE.Vector3();

  const vol = (x, z) => clamp(1.15 - Math.hypot(x - player.x, z - player.z) / 140, 0.3, 1);
  const shake = (a, x = S.x, z = S.z) => { S.trauma = Math.min(1, S.trauma + a * clamp(1.2 - Math.hypot(x - player.x, z - player.z) / 70, 0.15, 1)); };
  const later = (t, fn) => S.later.push({ t, fn });
  const cy = () => AY + S.h + S.bob;
  const airH = () => player.y - AY;
  const spinTo = (a, b, c) => { S.spinT = [a, b, c]; };

  function reset() {
    Object.assign(S, {
      on: false, frozen: false, state: 'off', phase: 1, hp: ORRERY.HP, maxHp: ORRERY.HP, alive: false, invuln: true,
      x: AX, z: AZ, h: 18, hT: 18, bob: 0, yaw: 0, t: 0, dt: 0.016, cd: 2, hist: [], runner: null, later: [], waves: [], lines: [], orbs: [], pick: [],
      spin: [0.6, -0.8, 1], spinT: [0.6, -0.8, 1], align: 0, alignT: 0, eclT: 0, eclSm: 0, orbA: rnd(0, TAU), trauma: 0, imp: { x: 0, z: 0 },
      arenaR: R0, arenaTarget: 0, deaths: 0, lastDeaths: 0, hitFlash: 0, jolt: 0, cine: null, cineT: 0, result: null,
      stats: { taken: 0, time: 0, dealt: 0 }, combo: 0, best: 0, atk: null, fightT: 0, dead: false, deflectT: 0, chipT: -99, hintedRes: false,
      resCd: 6, eclCd: 24, novaCd: 30, pickT: 14, pickN: 0, dark: 0, darkT: 0, stagger: 0, nova: null, novaPct: 0, coreBoost: 0, heat: 0, palette: 0x6fe3ff, pb: 0,
      skipReq: false, moonGone: [false, false, false, false, false, false], bursting: false,
    });
    S.vis = { core: 1, r: [1, 1, 1], spA: 1, spB: 0, moons: 1, corona: 0, halo: 0 };
  }
  reset();

  // ---------------- build (lazy, first entry only) ----------------
  function build() {
    if (built) return;
    built = true;
    fx = createFx(scene, camera, renderer);
    sfx = createSfx(audio);
    ui = createUi({ onRetry: () => retry(), onLobby: () => onExit('Back in the lobby'), onSkip: () => { S.skipReq = true; } });
    rig = buildRig(); rig.root.visible = false; scene.add(rig.root);
    arena = buildArena(AX, AY, AZ, R0); scene.add(arena.group, arena.dome); arena.dome.visible = false;
    hemi = new THREE.HemisphereLight(0x7fd8ff, 0x10141c, 0.8);
    orbRoot = new THREE.Group(); scene.add(orbRoot);
    rig.hits.forEach((m, i) => targets.push(makeTarget(m, 'orrery' + i, m.userData.kind, () => Math.max(1, S.hp), (d, t) => takeHit(d, t))));
    for (let i = 0; i < ON; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(1, 10, 8), rig.M.hit);
      m.visible = false; m.userData.hitZone = 'body'; m.userData.kind = 'orb'; orbRoot.add(m);
      const t = makeTarget(m, 'orrery-orb' + i, 'orb', () => 1e6, (d, tt) => { if (tt.orb) hitOrb(tt.orb); });
      orbT.push(t); targets.push(t);
    }
    // bullets: two instanced meshes (solid core + additive glow)
    bI = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.5, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false }), BN);
    gI = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.32, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }), BN);
    bI.frustumCulled = gI.frustumCulled = false;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let i = 0; i < BN; i++) { B.push({ on: false, i, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0, r: 0.5, dmg: 10, t: 0 }); bI.setMatrixAt(i, zero); gI.setMatrixAt(i, zero); bI.setColorAt(i, _c.setHex(0xffffff)); gI.setColorAt(i, _c); }
    fx.root.add(bI, gI);
    // moons
    [0x6fe3ff, 0xffc857, 0xff7a9a, 0x9dff8a, 0xb08cff, 0xffffff].forEach((c, i) => {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(new THREE.SphereGeometry(1.7, 16, 12), new THREE.MeshStandardMaterial({ color: 0x20242e, emissive: c, emissiveIntensity: 0.9, metalness: 0.5, roughness: 0.4 })));
      const rg = new THREE.Mesh(new THREE.TorusGeometry(2.6, 0.12, 6, 32), new THREE.MeshBasicMaterial({ color: c })); rg.rotation.x = PI / 2.4; g.add(rg);
      g.traverse((o) => { o.frustumCulled = false; });
      fx.root.add(g);
      moons.push({ g, i, col: c, x: AX, y: AY + 20, z: AZ, mode: 'orbit', glow: null });
    });
    addEventListener('keydown', (e) => { if (S.on && S.result && e.code === 'KeyR') retry(); });
    fx.setFloor(AY);
  }

  function makeTarget(mesh, id, kind, getHp, onHit) {
    const t = {
      id, name: ORRERY.NAME, mesh, kind, team: 0, isLeader: false, serverSide: false, ctx: ctxFake, alive: false,
      x: AX, y: AY, z: AZ, yaw: 0, vx: 0, vz: 0, suppression: 0, markUntil: 0, radius: 1.2, state: 'engage', stateT: 0, awareness: 0, engaged: false,
      engagedT: 0, focus: 0, flinch: 0, lastHurt: 0, combatT: 0, focusX: 0, focusZ: 0, reactTime: 0.4, wp: null, maxHp: ORRERY.HP, orb: null,
    };
    // damageEnemy() does `e.hp -= dmg`: the getter/setter pair turns that into our own damage model
    Object.defineProperty(t, 'hp', { get: () => getHp(), set: (v) => { const d = Math.max(0, getHp() - v); if (d > 0) onHit(d, t); } });
    return t;
  }

  // ---------------- damage model: bullets are deflected, returned orbs are the weakness ----------------
  function dmgBoss(d) {
    if (!S.alive || S.invuln || S.state === 'dead') return;
    S.hp = Math.max(0, S.hp - d); S.stats.dealt += d; S.hitFlash = Math.min(1, S.hitFlash + 0.2);
    if (S.hp <= 0) kill();
  }
  function takeHit(dmg, t) {
    if (!S.alive || S.state === 'dead') return;
    if (S.t - S.deflectT > 0.12) { S.deflectT = S.t; audio.play('clang'); }
    if (S.invuln) return;
    dmgBoss(dmg * (t.kind === 'core' ? 0.06 : 0.025));
    if (S.t - S.chipT > 20) { S.chipT = S.t; ui.hint('IT DEFLECTS BULLETS — SHOOT ITS GOLD ORBS BACK AT IT', 3.5); }
  }

  // ---------------- player helpers ----------------
  function hurt(dmg, sx, sz) {
    if (!player.alive || S.frozen || dmg <= 0) return false;
    const before = player.hp;
    ctrl.applyDamage(dmg, sx, sz, ORRERY.NAME);
    const lost = Math.max(0, before - player.hp);
    S.stats.taken += lost;
    if (lost > 0 && S.combo > 0) { S.combo = 0; ui.combo(0); }
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
    if (!b) return;
    b.on = true; b.x = x; b.y = y; b.z = z; b.vx = vx; b.vy = vy; b.vz = vz; b.life = o.life || 6; b.r = o.r || 0.55; b.dmg = o.dmg || 14; b.t = 0;
    const col = o.col ?? COL.gold;
    bI.setColorAt(b.i, _c.setHex(col)); gI.setColorAt(b.i, _c);
    bI.instanceColor.needsUpdate = gI.instanceColor.needsUpdate = true;
  }
  function updBullets(dt) {
    let any = false;
    const lim = S.arenaR + 8;
    for (let k = 0; k < BN; k++) {
      const b = B[k];
      if (!b.on) continue;
      any = true;
      b.t += dt; b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      let kill = b.t > b.life || b.y < AY - 1 || Math.hypot(b.x - AX, b.z - AZ) > lim;
      if (!kill && player.alive && Math.hypot(player.x - b.x, player.y + (player.crouching ? 0.7 : 1.0) - b.y, player.z - b.z) < b.r + 0.6) {
        hurt(b.dmg, b.x, b.z); knock(b.x, b.z, 3, 0);
        fx.burst(b.x, b.y, b.z, 6, 6, 0.4, 0.8, 0.1, 0xffffff, COL.gold, { grav: 0 });
        kill = true;
      }
      if (kill) { b.on = false; _dm.position.set(0, 0, 0); _dm.scale.setScalar(0); _dm.updateMatrix(); bI.setMatrixAt(k, _dm.matrix); gI.setMatrixAt(k, _dm.matrix); continue; }
      _dm.position.set(b.x, b.y, b.z); _dm.rotation.set(0, 0, 0);
      _dm.scale.setScalar(b.r * 2); _dm.updateMatrix(); bI.setMatrixAt(k, _dm.matrix);
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

  // ---------------- orbs (resonance orbs can be returned, void orbs can only be popped) ----------------
  function spawnOrb(k, x, y, z, dir, sp, size = 1, o = {}) {
    const slot = orbT.find((t) => !t.orb);
    if (!slot) return null;
    const orb = {
      k, x, y, z, dx: dir.x, dy: dir.y, dz: dir.z, sp, size, t: 0, state: 'fly', life: o.life || 9, home: o.home || 0, giant: !!o.giant,
      dmg: o.dmg || (k === 'void' ? 24 : 30), rad: 2.1 * size, t0: slot, h1: fx.sprite(), h2: k === 'void' ? fx.sprite(false) : fx.sprite(), mult: 1, dead: false,
    };
    slot.orb = orb; slot.alive = true; slot.mesh.scale.setScalar(orb.rad * 1.15); slot.mesh.position.set(x, y, z);
    S.orbs.push(orb);
    return orb;
  }
  function launch(kind, sp, spread = 0, o = {}) {
    const x = S.x, y = cy(), z = S.z;
    let dx = player.x + player.vx * 0.22 - x, dy = player.y + 1.1 - y, dz = player.z + player.vz * 0.22 - z;
    const l = Math.hypot(dx, dy, dz) || 1; dx /= l; dy /= l; dz /= l;
    const c = Math.cos(spread), s = Math.sin(spread);
    fx.burst(x, y, z, 14, 12, 0.5, 1.2, 0.1, 0xffffff, COL.gold, { grav: 0 });
    return spawnOrb(kind, x, y, z, { x: dx * c - dz * s, y: dy, z: dx * s + dz * c }, sp, o.size || 1, o);
  }
  function killOrb(o) {
    o.h1.hide(); o.h2.hide(); o.t0.orb = null; o.t0.alive = false; o.t0.mesh.position.set(0, -999, 0);
  }
  function hitOrb(o) {
    if (o.state !== 'fly' || o.dead) return;
    const x = o.x, y = o.y, z = o.z;
    if (o.k === 'void') {                                   // void orbs: pop only
      fx.burst(x, y, z, 22, 12, 0.7, 1.4, 0.1, 0xd8b8ff, COL.void, { grav: 0 }); fx.ball(x, y, z, 8, COL.void, 0.3);
      sfx.shatter(vol(x, z)); o.dead = true; o.t0.alive = false; return;
    }
    o.state = 'back'; o.sp = Math.max(30, o.sp); o.t0.alive = false;
    S.combo++; S.best = Math.max(S.best, S.combo);
    const close = Math.hypot(player.x - x, player.z - z) < 14;
    o.mult = (1 + 0.1 * Math.min(S.combo - 1, 5)) * (close ? 1.25 : 1);
    ui.combo(S.combo); ui.pop(close ? 'CLOSE RETURN' : 'RETURNED');
    sfx.ping(vol(x, z));
    fx.ball(x, y, z, 12, 0xffffff, 0.25); fx.burst(x, y, z, 26, 16, 0.6, 1.4, 0.1, 0xffffff, COL.gold, { grav: 0 });
    if (o.giant && S.nova) S.nova.hits++;
  }
  function returnHit(o) {
    const d = ORRERY.REFLECT * (o.giant ? 1.25 : 1) * o.mult;
    dmgBoss(d);
    S.jolt = 1;
    const x = S.x, y = cy(), z = S.z;
    fx.ball(x, y, z, 30, 0xffffff, 0.45); fx.ball(x, y, z, 52, COL.gold, 0.7);
    fx.beamT(x, y, z, x, y + 80, z, 3, COL.gold, 0.5);
    fx.burst(x, y, z, 50, 28, 0.9, 1.6, 0.2, 0xffffff, COL.gold, { grav: 2 });
    fx.light(x, y, z, COL.gold, 4000, 0.35);
    sfx.boom(1.2, vol(x, z)); shake(0.5);
    ui.pop('RETURNED  −' + Math.round(d));
    o.dead = true;
  }
  function explodeAt(x, y, z, o) {
    fx.ball(x, y, z, 10 * o.size, o.k === 'void' ? COL.void : COL.gold, 0.4); fx.burst(x, y, z, 30, 18, 0.8, 1.5, 0.2, 0xffffff, o.k === 'void' ? COL.void : COL.gold, { grav: 4 });
    fx.light(x, y, z, COL.gold, 1800, 0.25); sfx.boom(0.8 * o.size, vol(x, z)); shake(0.3 * o.size, x, z);
  }
  function updOrbs(dt) {
    for (let i = S.orbs.length - 1; i >= 0; i--) {
      const o = S.orbs[i]; o.t += dt;
      if (o.dead) { killOrb(o); S.orbs.splice(i, 1); continue; }
      if (o.state === 'fly') {
        if (o.home > 0 && player.alive) {
          const tx = player.x - o.x, ty = player.y + 1.1 - o.y, tz = player.z - o.z, l = Math.hypot(tx, ty, tz) || 1, k = Math.min(1, o.home * dt);
          o.dx = lerp(o.dx, tx / l, k); o.dy = lerp(o.dy, ty / l, k); o.dz = lerp(o.dz, tz / l, k);
          const n = Math.hypot(o.dx, o.dy, o.dz) || 1; o.dx /= n; o.dy /= n; o.dz /= n;
        }
        o.x += o.dx * o.sp * dt; o.y += o.dy * o.sp * dt; o.z += o.dz * o.sp * dt;
        let boom = false;
        if (player.alive && Math.hypot(player.x - o.x, player.y + 1 - o.y, player.z - o.z) < o.rad * 0.6 + 0.9) { hurt(o.dmg, o.x, o.z); knock(o.x, o.z, 12, 5); boom = true; }
        else if (o.y < AY + 0.4) { if (player.alive && Math.hypot(player.x - o.x, player.z - o.z) < 4.5 * o.size && airH() < 2) hurt(o.dmg * 0.6, o.x, o.z); boom = true; }
        if (boom) { explodeAt(o.x, Math.max(o.y, AY + 0.6), o.z, o); o.dead = true; }
        else if (o.t > o.life || Math.hypot(o.x - AX, o.z - AZ) > S.arenaR + 30) { fx.burst(o.x, o.y, o.z, 12, 8, 0.5, 1, 0.1, 0xffffff, COL.void, { grav: 0 }); o.dead = true; }
      } else {                                              // returning to the core
        const cx = S.x, cyy = cy(), cz = S.z;
        let dx = cx - o.x, dy = cyy - o.y, dz = cz - o.z; const d = Math.hypot(dx, dy, dz) || 1;
        o.sp = Math.min(85, o.sp + 100 * dt); const st = Math.min(d, o.sp * dt);
        o.x += (dx / d) * st; o.y += (dy / d) * st; o.z += (dz / d) * st;
        if (d < 5.5 + o.rad * 0.3) returnHit(o);
      }
      const gold = o.k === 'res';
      if (gold) { o.h1.set(o.x, o.y, o.z, o.size * 7 * (o.state === 'back' ? 1.3 : 1), COL.gold, 0.9); o.h2.set(o.x, o.y, o.z, o.size * 2.8, 0xffffff, 1); }
      else { o.h1.set(o.x, o.y, o.z, o.size * 6, COL.void, 0.8); o.h2.set(o.x, o.y, o.z, o.size * 3.4, 0x050008, 0.95); }
      fx.add(o.x + rnd(-0.4, 0.4), o.y + rnd(-0.4, 0.4), o.z + rnd(-0.4, 0.4), rnd(-1, 1), rnd(-1, 1), rnd(-1, 1), 0.45, 1.3 * o.size, 0.1, 0xffffff, gold ? COL.gold : COL.void, 0.9, 0, 1);
      o.t0.mesh.position.set(o.x, o.y, o.z);
    }
  }

  // ---------------- gameplay hazards ----------------
  function wave(x, z, o) {
    S.waves.push({ h: fx.wave(), x, z, y: AY, r: o.r0 ?? 1.5, v: o.v, maxR: o.maxR, w: o.w ?? 2.4, clear: o.clear ?? 0.8, wallH: o.wallH ?? 2.6, dmg: o.dmg, kb: o.kb ?? 14, up: o.up ?? 0, col: o.col ?? COL.gold, hit: false });
  }
  function updWaves(dt) {
    for (let i = S.waves.length - 1; i >= 0; i--) {
      const w = S.waves[i]; w.r += w.v * dt;
      const a = clamp(1 - w.r / w.maxR, 0, 1);
      w.h.place(w.x, w.y + 0.05, w.z, w.r, w.w, w.wallH * (0.6 + 0.4 * a), 0.25 + 0.75 * Math.pow(a, 0.7), w.col);
      if (Math.random() < dt * 40) { const an = rnd(0, TAU); fx.add(w.x + Math.cos(an) * w.r, w.y + 0.3, w.z + Math.sin(an) * w.r, Math.cos(an) * 4, rnd(2, 6), Math.sin(an) * 4, 0.5, 0.8, 0.1, w.col, 0xffffff, 0.9, 8, 1); }
      if (!w.hit && w.dmg > 0 && player.alive) {
        const d = Math.hypot(player.x - w.x, player.z - w.z);
        if (Math.abs(d - w.r) < w.w * 0.5 + 0.5 && airH() < w.clear) { w.hit = true; hurt(w.dmg, w.x, w.z); knock(w.x, w.z, w.kb, w.up); }
      }
      if (w.r >= w.maxR) { w.h.hide(); S.waves.splice(i, 1); }
    }
  }
  function explode(x, z, r, dmg, col = COL.gold) {
    sfx.boom(0.9, vol(x, z));
    fx.ball(x, AY + 1.2, z, r * 1.3, col, 0.4); fx.ball(x, AY + 0.6, z, r * 2, 0xffffff, 0.14);
    fx.burst(x, AY + 0.6, z, 22, 18, 0.8, 1.3, 0.2, 0xffffff, col, { up: 0.9, grav: 12, drag: 0.5 });
    fx.beamT(x, AY, z, x, AY + 26, z, r * 0.32, col, 0.45); fx.decal(x, z, r * 1.2, col, 1.4); fx.light(x, AY + 4, z, col, 2000, 0.3);
    shake(0.3, x, z);
    if (player.alive && Math.hypot(player.x - x, player.z - z) < r && airH() < 3) { hurt(dmg, x, z); knock(x, z, 12, 6); }
  }
  function updLines(dt) {
    for (let i = S.lines.length - 1; i >= 0; i--) {
      const L = S.lines[i]; L.t += dt; const p = L.t / L.dur;
      if (p >= 1) { L.h.hide(); S.lines.splice(i, 1); continue; }
      L.h.set(L.x1, AY + 0.9, L.z1, L.x2, AY + 0.9, L.z2, 1.1 * (1 - p * 0.4), COL.cyan, 1 - p * 0.7);
      if (Math.random() < dt * 60) { const t = Math.random(); fx.add(lerp(L.x1, L.x2, t), AY + 0.5, lerp(L.z1, L.z2, t), rnd(-2, 2), rnd(3, 9), rnd(-2, 2), 0.6, 1.4, 0.1, 0xffffff, COL.cyan, 1, 4, 1); }
      if (!L.hit && player.alive && segDist(player.x, player.z, L.x1, L.z1, L.x2, L.z2) < 1.5) { L.hit = true; hurt(34, (L.x1 + L.x2) / 2, (L.z1 + L.z2) / 2); knock((L.x1 + L.x2) / 2, (L.z1 + L.z2) / 2, 14, 4); }
    }
  }
  function pickup(kind) {
    const a = rnd(0, TAU), r = rnd(8, S.arenaR - 9);
    S.pick.push({ kind, x: AX + Math.cos(a) * r, z: AZ + Math.sin(a) * r, h: fx.sprite(), t: 0 });
  }
  function updPick(dt) {
    if (S.state === 'fight') { S.pickT -= dt; if (S.pickT <= 0 && S.pick.length < 2) { S.pickT = 26; pickup(S.pickN++ % 2 === 0 ? 'hp' : 'ammo'); } }
    for (let i = S.pick.length - 1; i >= 0; i--) {
      const o = S.pick[i]; o.t += dt;
      const col = o.kind === 'hp' ? 0x55ff99 : 0xffc247;
      o.h.set(o.x, AY + 1.5 + Math.sin(o.t * 3) * 0.3, o.z, 2.6 + Math.sin(o.t * 6) * 0.3, col, 0.95);
      if (Math.random() < dt * 20) fx.add(o.x + rnd(-0.5, 0.5), AY + 0.5, o.z + rnd(-0.5, 0.5), 0, rnd(2, 5), 0, 0.8, 0.6, 0.1, 0xffffff, col, 0.9, 0, 0.5);
      if (player.alive && Math.hypot(player.x - o.x, player.z - o.z) < 2.1 && Math.abs(player.y - AY) < 3) {
        if (o.kind === 'hp') { if (player.hp < player.maxHp) player.hp = Math.min(player.maxHp, player.hp + 30); } else ctrl.restock();
        audio.play('pouch');
        fx.burst(o.x, AY + 1.5, o.z, 20, 8, 0.6, 1, 0.1, 0xffffff, col, { grav: 0 });
        ui.hint(o.kind === 'hp' ? '+30 HEALTH' : 'AMMO RESTOCKED', 1.5);
        o.h.hide(); S.pick.splice(i, 1);
      }
    }
  }

  // ---------------- attack toolkit ----------------
  function* during(dur, fn) { let t = 0; while (t < dur) { t += S.dt; fn(clamp(t / dur, 0, 1), S.dt); yield 0; } }
  function* slide(x, z, dur) { const sx = S.x, sz = S.z; yield* during(dur, (p) => { S.x = lerp(sx, x, ease(p)); S.z = lerp(sz, z, ease(p)); }); }
  function suck(x, y, z, n, r0, col) {
    for (let i = 0; i < n; i++) {
      const a = rnd(0, TAU), b = rnd(0, PI), r = rnd(r0 * 0.5, r0);
      fx.add(x + Math.cos(a) * Math.sin(b) * r, y + Math.cos(b) * r, z + Math.sin(a) * Math.sin(b) * r, -Math.cos(a) * Math.sin(b) * r * 2, -Math.cos(b) * r * 2, -Math.sin(a) * Math.sin(b) * r * 2, 0.5, 0.9, 0.1, 0xffffff, col, 1, 0, 0);
    }
  }

  // ===== SIGNATURE: RESONANCE ORBS — shoot the gold ones back into the core =====
  function* resonance() {
    S.resCd = 17; S.hT = 15;
    spinTo(2.5, -3.2, 4);
    if (!S.hintedRes) { S.hintedRes = true; ui.hint('SHOOT THE GOLD ORBS BACK INTO ITS CORE', 4); }
    const volleys = S.phase >= 3 ? 2 : S.phase >= 2 ? 3 : 2, fan = S.phase >= 3 ? 3 : 1, sp = [20, 23, 26][S.phase - 1];
    for (let v = 0; v < volleys; v++) {
      const h1 = fx.sprite(), h2 = fx.sprite();
      sfx.charge(0.8, vol(S.x, S.z));
      try {
        yield* during(0.8, (p) => {
          const x = S.x, y = cy(), z = S.z;
          h1.set(x, y, z, 4 + p * 10, COL.gold, 0.75); h2.set(x, y, z, 1.5 + p * 3.5, 0xffffff, 1);
          suck(x, y, z, 3, 12, COL.gold); shake(0.01 + p * 0.02);
        });
      } finally { h1.hide(); h2.hide(); }
      for (let k = 0; k < fan; k++) launch('res', sp, fan === 1 ? 0 : (k - 1) * 0.3);
      if (S.phase >= 2) launch('void', 13, rnd(-0.6, 0.6), { home: 1.4, life: 8 });   // homing void orb mixed into every volley
      sfx.hum(vol(S.x, S.z)); shake(0.25);
      yield S.phase >= 3 ? 0.55 : 0.8;
    }
    yield 1.0;
  }

  // ===== STARSTREAM: moons dive to ground level and fire spirals =====
  function* starstream() {
    const k = S.phase >= 3 ? 6 : S.phase >= 2 ? 4 : 3, dur = S.phase >= 3 ? 6.5 : 5.5, a0 = rnd(0, TAU), rad = Math.min(28, S.arenaR - 9);
    const gap = S.phase >= 3 ? 0.17 : S.phase >= 2 ? 0.14 : 0.15, v = S.phase >= 3 ? 15 : 14;
    S.hT = 20; spinTo(1.5, -2, 2.5);
    ui.hint('THE MOONS FIRE STAR-SPIRALS — KEEP MOVING', 3);
    const st = moons.slice(0, k).map((m, i) => ({ m, sx: m.x, sy: m.y, sz: m.z, tx: AX + Math.cos(a0 + (i * TAU) / k) * rad, tz: AZ + Math.sin(a0 + (i * TAU) / k) * rad }));
    st.forEach((s) => { s.m.mode = 'free'; fx.tele('disc', { x: s.tx, z: s.tz, r: 3, dur: 1.1, col: COL.gold }); });
    sfx.whoosh(1);
    try {
      yield* during(1.1, (p) => st.forEach((s) => { const e = ease(p); s.m.x = lerp(s.sx, s.tx, e); s.m.z = lerp(s.sz, s.tz, e); s.m.y = lerp(s.sy, AY + 1.7, e) + Math.sin(p * PI) * 6; }));
      let ang = a0, acc = 0;
      sfx.thump(1);
      yield* during(dur, (p, dt) => {
        ang += (S.phase >= 3 ? 1.5 : 1.1) * dt; acc += dt;
        while (acc > gap) {
          acc -= gap;
          st.forEach((s, i) => {
            const th = ang * (i % 2 ? -1 : 1) + i;
            for (let a = 0; a < 2; a++) { const t2 = th + a * PI; bullet(s.m.x, AY + 1.1, s.m.z, Math.cos(t2) * v, 0, Math.sin(t2) * v, { dmg: 13, col: s.m.col, life: 5 }); }
          });
        }
        st.forEach((s) => { s.m.y = AY + 1.7 + Math.sin(S.t * 6 + s.tx) * 0.3; if (Math.random() < dt * 12) fx.arc(s.m.x, s.m.y, s.m.z, S.x, cy(), S.z, s.m.col, 0.12, 2); });
        shake(0.012);
      });
    } finally { st.forEach((s) => { s.m.mode = 'orbit'; }); }
    yield 0.8;
  }

  // ===== NOVA RINGS: expanding bullet rings with gaps. Jump them (low) or use the gaps =====
  function* novaRings() {
    const n = S.phase >= 3 ? 8 : S.phase >= 2 ? 6 : 5, gap = S.phase >= 3 ? 0.55 : 0.7, N = 44, v = S.phase >= 3 ? 15 : 13;
    S.hT = 14; spinTo(4, -5, 6);
    ui.hint('JUMP THE RINGS — OR USE THE GAPS', 3);
    sfx.charge(0.9, vol(S.x, S.z));
    yield* during(0.9, () => { suck(S.x, cy(), S.z, 4, 14, COL.cyan); shake(0.02); });
    for (let i = 0; i < n; i++) {
      const g1 = Math.atan2(player.z - S.z, player.x - S.x) + rnd(-0.5, 0.5), g2 = g1 + PI + rnd(-0.6, 0.6), x = S.x, z = S.z;
      for (let j = 0; j < N; j++) {
        const th = (j / N) * TAU;
        if (Math.abs(angDiff(th, g1)) < 0.2 || Math.abs(angDiff(th, g2)) < 0.2) continue;
        bullet(x, AY + 0.55, z, Math.cos(th) * v, 0, Math.sin(th) * v, { r: 0.6, dmg: 15, col: i % 2 ? COL.gold : COL.cyan, life: 5 });
      }
      wave(x, z, { v, maxR: 20, dmg: 0, col: i % 2 ? COL.gold : COL.cyan, wallH: 0.8 });
      sfx.thump(vol(x, z)); shake(0.12);
      yield gap;
    }
    yield 1.2;
  }

  // ===== SOLAR LANCES: fast aimed lasers =====
  function lance(tx, tz, delay) {
    const bx = S.x, bz = S.z, by = cy();
    let dx = tx - bx, dz = tz - bz; const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const LEN = 90, ex = bx + dx * LEN, ez = bz + dz * LEN;
    fx.tele('rect', { x: bx, z: bz, dx, dz, len: LEN, w: 3.4, dur: delay, col: COL.cyan });
    later(delay, () => {
      fx.beamT(bx, by, bz, ex, AY + 0.4, ez, 1.3, 0x9af0ff, 0.45);
      fx.ball(bx, by, bz, 14, 0xffffff, 0.2);
      for (let i = 0; i < 14; i++) { const t = Math.random(); fx.add(lerp(bx, ex, t), AY + 0.6, lerp(bz, ez, t), rnd(-2, 2), rnd(2, 8), rnd(-2, 2), 0.5, 1.3, 0.1, 0xffffff, COL.cyan, 1, 6, 1); }
      sfx.zap(vol(bx, bz)); shake(0.25);
      if (player.alive && segDist(player.x, player.z, bx, bz, ex, ez) < 1.9) { hurt(40, bx, bz); knock(player.x - dx * 3, player.z - dz * 3, 12, 4); }
    });
  }
  function* lances() {
    const n = S.phase >= 3 ? 5 : S.phase >= 2 ? 4 : 3, gap = S.phase >= 3 ? 0.42 : 0.55;
    S.hT = 17; spinTo(0, 0, 0); S.alignT = 1;
    sfx.charge(0.9, vol(S.x, S.z));
    try {
      yield* during(0.7, () => suck(S.x, cy(), S.z, 3, 12, COL.cyan));
      for (let i = 0; i < n; i++) {
        const tx = player.x + player.vx * 0.3, tz = player.z + player.vz * 0.3;
        if (S.phase >= 3 && i % 2 === 1) { lance(tx, tz, 0.9); lance(tx + 9, tz, 0.9); lance(tx - 9, tz, 0.9); } else lance(tx, tz, 0.9);
        yield gap;
      }
      yield 1.5;
    } finally { S.alignT = 0; }
  }

  // ===== CONSTELLATION: stars connect, the lines detonate =====
  function* constellation() {
    const n = S.phase >= 3 ? 7 : 5, step = S.phase >= 3 ? 3 : 2, rad = Math.min(30, S.arenaR - 8), a0 = rnd(0, TAU), T = 2.4;
    S.hT = 20; spinTo(0.5, -0.5, 0.5);
    ui.hint('THE STARS CONNECT — STAY OFF THE LINES', 3.5);
    const pts = [];
    for (let i = 0; i < n; i++) pts.push({ x: AX + Math.cos(a0 + (i * TAU) / n) * rad, z: AZ + Math.sin(a0 + (i * TAU) / n) * rad });
    const segs = [];
    for (let i = 0; i < n; i++) segs.push([pts[(i * step) % n], pts[((i + 1) * step) % n]]);
    const hs = pts.map(() => fx.sprite());
    pts.forEach((p) => fx.tele('disc', { x: p.x, z: p.z, r: 3.6, dur: T, col: 0x9af0ff }));
    segs.forEach(([a, b]) => { const dx = b.x - a.x, dz = b.z - a.z, l = Math.hypot(dx, dz) || 1; fx.tele('rect', { x: a.x, z: a.z, dx: dx / l, dz: dz / l, len: l, w: 2.8, dur: T, col: 0x9af0ff }); });
    sfx.charge(T, 1);
    try {
      yield* during(T, (p) => { pts.forEach((q, i) => { hs[i].set(q.x, AY + 4 + p * 4 + Math.sin(S.t * 5 + i) * 0.5, q.z, 3 + p * 4, 0xffffff, 0.9); if (Math.random() < 0.3) fx.add(q.x, AY + 1, q.z, 0, rnd(4, 10), 0, 0.7, 1, 0.1, 0xffffff, COL.cyan, 1, 0, 0.5); }); });
    } finally { hs.forEach((h) => h.hide()); }
    segs.forEach(([a, b], i) => later(i * 0.2, () => {
      S.lines.push({ x1: a.x, z1: a.z, x2: b.x, z2: b.z, t: 0, dur: 0.55, hit: false, h: fx.beam() });
      sfx.zap(1); sfx.chime(i, 0.7);
      if (player.alive && segDist(player.x, player.z, a.x, a.z, b.x, b.z) < 1.5) { hurt(34, a.x, a.z); knock((a.x + b.x) / 2, (a.z + b.z) / 2, 14, 4); }
    }));
    yield n * 0.2 + 0.8;
    pts.forEach((p) => explode(p.x, p.z, 5, 28, COL.cyan));
    yield 1.3;
  }

  // ===== TWELVE BELLS: the hour hand sweeps the floor wedges. Green wedges are safe =====
  function eruptWedge(idx) {
    const a = (idx * PI) / 6;
    arena.wedge(idx, COL.gold, 1, 0.12);
    sfx.chime(idx, 0.9); shake(0.12);
    for (const r of [8, 16, 24, 32, 40]) {
      const x = AX + Math.cos(a) * r, z = AZ + Math.sin(a) * r;
      fx.beamT(x, AY, z, x, AY + 26, z, 1.5, COL.gold, 0.5);
      fx.burst(x, AY + 0.6, z, 8, 12, 0.7, 1.1, 0.1, 0xffffff, COL.gold, { up: 1.4, grav: 10 });
    }
    const pa = Math.atan2(player.z - AZ, player.x - AX);
    if (player.alive && Math.abs(angDiff(pa, a)) < PI / 12 && Math.hypot(player.x - AX, player.z - AZ) > 2.5 && airH() < 3) { hurt(42, AX, AZ); knock(AX, AZ, 12, 9); }
  }
  function* bells() {
    S.hT = 25; spinTo(1, -1, 1.5);
    yield* slide(AX, AZ, 0.9);
    ui.hint('GREEN WEDGES ARE SAFE — FIND ONE', 3.5);
    const cycles = S.phase >= 3 ? 3 : S.phase >= 2 ? 2 : 1, nSafe = S.phase >= 3 ? 1 : S.phase >= 2 ? 2 : 3, TELE = 1.5, STEP = 0.17;
    for (let c = 0; c < cycles; c++) {
      const safe = [], order = [...Array(12).keys()].sort(() => Math.random() - 0.5);
      for (const i of order) { if (safe.length >= nSafe) break; if (safe.every((s) => { const d = Math.abs(s - i); return Math.min(d, 12 - d) >= 3; })) safe.push(i); }
      const start = (Math.random() * 12) | 0, dir = c % 2 ? -1 : 1;
      for (let k = 0; k < 12; k++) {
        const idx = (((start + dir * k) % 12) + 12) % 12, isSafe = safe.includes(idx);
        later(k * STEP, () => { arena.wedge(idx, isSafe ? COL.green : COL.red, 0.55, TELE); sfx.chime(k, 0.5); });
        if (!isSafe) later(k * STEP + TELE, () => eruptWedge(idx));
      }
      yield 12 * STEP + TELE + 1.0;
    }
  }

  // ===== CORONA: close-range punisher =====
  function* corona() {
    S.hT = 11; spinTo(5, -6, 7);
    const x = S.x, z = S.z, R = S.phase >= 3 ? 30 : S.phase >= 2 ? 26 : 22;
    fx.tele('disc', { x, z, r: R, dur: 1.4, col: COL.gold });
    sfx.charge(1.4, vol(x, z));
    yield* during(1.4, (p) => { S.x = x; S.z = z; suck(x, cy(), z, 4, 14, COL.gold); shake(0.015 + p * 0.04); });
    sfx.boom(1.6, vol(x, z)); ui.flash('#fff6d0', 0.5, 0.4); shake(0.8);
    fx.ball(x, cy(), z, 34, 0xffffff, 0.4); fx.beamT(x, AY, z, x, AY + 60, z, 3, COL.gold, 0.5); fx.light(x, AY + 6, z, COL.gold, 4000, 0.5);
    if (player.alive && Math.hypot(player.x - x, player.z - z) < R * 0.92) { hurt(46, x, z); knock(x, z, 18, 9); }
    wave(x, z, { v: 34, maxR: 48, dmg: 26, col: COL.gold, wallH: 3, clear: 1.0 });
    for (let j = 0; j < 28; j++) { const th = (j / 28) * TAU; bullet(x, AY + 0.55, z, Math.cos(th) * 12, 0, Math.sin(th) * 12, { dmg: 13, col: COL.gold }); }
    S.hT = 17;
    yield 1.0;
  }

  // ===== COMET DIVE: the machine itself rams across the arena =====
  function* dive() {
    S.hT = 10; spinTo(3, -3, 3);
    let ax = 0, az = 1;
    const aim = () => { const x = player.x - S.x, z = player.z - S.z, l = Math.hypot(x, z) || 1; ax = x / l; az = z / l; };
    const D = () => clamp(Math.hypot(player.x - S.x, player.z - S.z) + 22, 30, 80);
    aim();
    const tl = fx.tele('rect', { x: S.x, z: S.z, dx: ax, dz: az, len: D(), w: 16, dur: 1.3, col: COL.red });
    sfx.charge(1.3, vol(S.x, S.z));
    yield* during(0.8, () => { aim(); tl.o.x = S.x; tl.o.z = S.z; tl.o.dx = ax; tl.o.dz = az; tl.o.len = D(); suck(S.x, cy(), S.z, 3, 14, COL.red); });
    yield 0.5;
    const len = tl.o.len, sx = S.x, sz = S.z, dur = len / 52 + 0.15;
    let t = 0, hit = false, tr = 0;
    sfx.hum(vol(sx, sz)); shake(0.5);
    while (t < dur) {
      t += S.dt;
      const q = ease(t / dur);
      let nx = sx + ax * len * q, nz = sz + az * len * q;
      const d = Math.hypot(nx - AX, nz - AZ), lim = S.arenaR - 5;
      if (d > lim) { nx = AX + ((nx - AX) / d) * lim; nz = AZ + ((nz - AZ) / d) * lim; }
      S.x = nx; S.z = nz;
      tr += S.dt;
      if (tr > 0.09) { tr = 0; bullet(S.x, AY + 0.8, S.z, -az * 9, 0, ax * 9, { dmg: 12, col: COL.red, life: 3 }); bullet(S.x, AY + 0.8, S.z, az * 9, 0, -ax * 9, { dmg: 12, col: COL.red, life: 3 }); }
      if (Math.random() < 0.6) fx.add(S.x + rnd(-6, 6), cy() + rnd(-3, 3), S.z + rnd(-6, 6), rnd(-3, 3), rnd(-3, 3), rnd(-3, 3), 0.6, 2, 0.2, 0xffffff, COL.red, 1, 0, 1);
      if (!hit && player.alive && Math.hypot(player.x - S.x, player.z - S.z) < 8.5 && player.y < AY + S.h + 8) { hit = true; hurt(40, S.x, S.z); knock(S.x, S.z, 20, 7); }
      shake(0.03);
      yield 0;
    }
    explode(S.x, S.z, 12, 28, COL.gold);
    S.hT = 17;
    yield 1.0;
  }

  // ===== ECLIPSE (phase 2+): lights out, void orbs. Pop them, return the gold ones =====
  function* eclipse() {
    S.eclCd = 34; S.hT = 21; spinTo(0.3, -0.4, 0.5);
    S.darkT = 1; S.eclT = 1;
    sfx.swell(1); ui.card('ECLIPSE', 'THE LIGHT FAILS', 3);
    ui.hint('SHOOT THE VOID ORBS — RETURN THE GOLD ONES', 4.5);
    try {
      yield 1.5;
      const n = S.phase >= 3 ? 9 : 6;
      for (let i = 0; i < n; i++) {
        const a = rnd(0, TAU), r = S.arenaR - 3, x = AX + Math.cos(a) * r, y = AY + rnd(1.2, 3), z = AZ + Math.sin(a) * r;
        let dx = player.x - x, dy = player.y + 1.1 - y, dz = player.z - z; const l = Math.hypot(dx, dy, dz) || 1;
        spawnOrb('void', x, y, z, { x: dx / l, y: dy / l, z: dz / l }, 7.5, 1, { home: 1.8, life: 12 });
        fx.burst(x, y, z, 14, 8, 0.6, 1.2, 0.1, 0xd8b8ff, COL.void, { grav: 0 });
        if (i % 3 === 2) launch('res', 20, 0);
        yield rnd(0.9, 1.3);
      }
      let w = 0;
      while (w < 7 && S.orbs.some((o) => o.k === 'void' && !o.dead)) { w += S.dt; yield 0; }
    } finally { S.darkT = 0; S.eclT = 0; }
    sfx.swell(1);
    yield 0.8;
  }

  // ===== SUPERNOVA (phase 3 special): return the 3 giant stars or eat the blast =====
  function* supernova() {
    S.novaCd = 44; S.hT = 28; S.nova = { hits: 0 };
    spinTo(7, -9, 11);
    yield* slide(AX, AZ, 1.0);
    ui.card('SUPERNOVA', 'RETURN THE STARS', 3); sfx.swell(1);
    ui.hint('SHOOT THE GIANT STARS BACK INTO THE CORE', 5);
    const a0 = rnd(0, TAU), DUR = 12, h1 = fx.sprite(), h2 = fx.sprite();
    for (let i = 0; i < 3; i++) { const a = a0 + (i * TAU) / 3; spawnOrb('res', S.x, cy(), S.z, { x: Math.cos(a), y: -0.15, z: Math.sin(a) }, 9, 1.7, { giant: true, dmg: 48, home: 0.9, life: 14 }); }
    let t = 0;
    try {
      while (t < DUR && S.nova.hits < 3) {
        t += S.dt; const p = t / DUR; S.novaPct = p; S.coreBoost = p;
        h1.set(S.x, cy(), S.z, 8 + p * 26, 0xffe9a0, 0.5 + 0.4 * p); h2.set(S.x, cy(), S.z, 3 + p * 8, 0xffffff, 1);
        suck(S.x, cy(), S.z, 4, 16 + p * 14, COL.gold); shake(0.015 + p * 0.05);
        yield 0;
      }
    } finally { h1.hide(); h2.hide(); S.coreBoost = 0; S.novaPct = 0; }
    const hits = S.nova.hits; S.nova = null;
    for (const o of S.orbs) if (o.giant && o.state === 'fly') { explodeAt(o.x, o.y, o.z, o); o.dead = true; }
    if (hits >= 3) {
      ui.card('INTERRUPTED', 'THE STARS FALL BACK', 2.6); ui.flash('#fff6d0', 0.5, 0.6);
      S.stagger = 4; spinTo(0, 0, 0); S.hT = 12; sfx.boom(1.4, 1);
      yield 1.2;
    } else {
      const d = 100 * (1 - 0.3 * hits);
      sfx.boom(2.2, 1); ui.flash('#ffffff', 0.9, 1.0); shake(1);
      fx.ball(S.x, cy(), S.z, 90, 0xffffff, 0.8); fx.light(S.x, cy(), S.z, 0xffffff, 6000, 0.8);
      wave(AX, AZ, { v: 50, maxR: 64, dmg: d, col: COL.gold, wallH: 8, clear: 4.5, kb: 24, up: 9 });
      yield 1.8;
    }
    S.hT = 17;
  }

  // ===== HOUR HAND: a laser sweeps the floor like a clock hand. Jump it or outrun it =====
  function* hourHand() {
    S.hT = 13; spinTo(0, 0, 0); S.alignT = 1;
    yield* slide(AX, AZ, 0.8);
    const arms = S.phase >= 3 ? 3 : S.phase >= 2 ? 2 : 1;
    const LEN = S.arenaR - 1, TELE = 1.3, DUR = S.phase >= 3 ? 6.5 : 5.5;
    const speed = (S.phase >= 3 ? 1.35 : S.phase >= 2 ? 1.1 : 0.9) * (Math.random() < 0.5 ? 1 : -1);
    const a0 = Math.atan2(player.z - AZ, player.x - AX);
    const hs = [];
    for (let i = 0; i < arms; i++) hs.push(fx.beam());
    ui.hint('THE HOUR HAND SWEEPS — JUMP IT', 3);
    for (let i = 0; i < arms; i++) {
      const a = a0 + (i * TAU) / arms;
      fx.tele('rect', { x: AX, z: AZ, dx: Math.cos(a), dz: Math.sin(a), len: LEN, w: 3, dur: TELE, col: COL.red });
    }
    sfx.charge(TELE, 1);
    try {
      yield TELE;
      let ang = a0, cd = 0;
      sfx.hum(1);
      yield* during(DUR, (p, dt) => {
        ang += speed * dt; cd -= dt;
        for (let i = 0; i < arms; i++) {
          const a = ang + (i * TAU) / arms, ex = AX + Math.cos(a) * LEN, ez = AZ + Math.sin(a) * LEN;
          hs[i].set(AX, AY + 1.0, AZ, ex, AY + 1.0, ez, 0.9, COL.red, 0.95);
          if (Math.random() < dt * 30) { const t = Math.random(); fx.add(lerp(AX, ex, t), AY + 0.6, lerp(AZ, ez, t), rnd(-2, 2), rnd(3, 8), rnd(-2, 2), 0.5, 1.2, 0.1, 0xffffff, COL.red, 1, 6, 1); }
          if (cd <= 0 && player.alive && airH() < 1.2 && segDist(player.x, player.z, AX, AZ, ex, ez) < 1.7) {
            cd = 0.6; hurt(30, AX, AZ); knock(AX, AZ, 8, 6);
          }
        }
        shake(0.02);
      });
    } finally { hs.forEach((h) => h.hide()); S.alignT = 0; }
    S.hT = 17;
    yield 1.0;
  }

  // ===== STAR-FALL: meteors rain onto where you're running =====
  function* meteors() {
    S.hT = 24; spinTo(1, -1.5, 2);
    const n = S.phase >= 3 ? 16 : S.phase >= 2 ? 12 : 8, R = 5, T = 1.0;
    ui.hint('STAR-FALL — WATCH THE FLOOR', 3);
    sfx.swell(0.8);
    yield 0.6;
    for (let i = 0; i < n; i++) {
      let x = player.x + player.vx * 0.6 + rnd(-7, 7), z = player.z + player.vz * 0.6 + rnd(-7, 7);
      const d = Math.hypot(x - AX, z - AZ), lim = S.arenaR - 4;
      if (d > lim) { x = AX + ((x - AX) / d) * lim; z = AZ + ((z - AZ) / d) * lim; }
      fx.tele('disc', { x, z, r: R, dur: T, col: COL.red });
      later(T, () => explode(x, z, R, 30, COL.red));
      yield S.phase >= 3 ? 0.22 : 0.3;
    }
    S.hT = 17;
    yield 1.4;
  }

  // ===== GRAVITY WELL (phase 2+): the core drags you in while spraying rings, then detonates =====
  function* singularity() {
    S.hT = 15; spinTo(6, -7, 9);
    yield* slide(AX, AZ, 0.8);
    const DUR = S.phase >= 3 ? 5 : 4.2, pull = S.phase >= 3 ? 42 : 32;
    ui.hint('GRAVITY WELL — FIGHT THE PULL', 3);
    fx.tele('disc', { x: AX, z: AZ, r: 11, dur: DUR, col: COL.red });
    sfx.charge(DUR, 1);
    let ang = rnd(0, TAU), acc = 0;
    yield* during(DUR, (p, dt) => {
      suck(S.x, cy(), S.z, 5, 22, COL.void); shake(0.02 + p * 0.04);
      if (player.alive) {
        const dx = AX - player.x, dz = AZ - player.z, d = Math.hypot(dx, dz) || 1;
        S.imp.x += (dx / d) * pull * dt; S.imp.z += (dz / d) * pull * dt;
      }
      ang += 1.3 * dt; acc += dt;
      while (acc > 0.35) {
        acc -= 0.35;
        for (let j = 0; j < 8; j++) { const th = ang + (j / 8) * TAU; bullet(S.x, AY + 1.1, S.z, Math.cos(th) * 11, 0, Math.sin(th) * 11, { dmg: 12, col: COL.void, life: 4 }); }
      }
    });
    explode(AX, AZ, 11, 45, COL.void);
    wave(AX, AZ, { v: 30, maxR: 40, dmg: 22, col: COL.void, wallH: 2.6, clear: 0.8 });
    S.hT = 17;
    yield 1.2;
  }

  const ATK = [
    { id: 'resonance', f: resonance, min: 1, w: [2, 3, 4] },
    { id: 'starstream', f: starstream, min: 1, w: [1, 2.5, 2.5] },
    { id: 'rings', f: novaRings, min: 1, w: [2, 2.5, 1.5] },
    { id: 'constellation', f: constellation, min: 1, w: [0.5, 2, 2.5] },
    { id: 'bells', f: bells, min: 1, w: [1, 2.5, 2] },
    { id: 'corona', f: corona, min: 1, w: [4, 0.8, 0] },
    { id: 'lances', f: lances, min: 1, w: [0.5, 2, 3.5] },
    { id: 'dive', f: dive, min: 1, w: [1.5, 2, 1.5] },
    { id: 'hourhand', f: hourHand, min: 1, w: [2, 2.5, 2] },
    { id: 'meteors', f: meteors, min: 1, w: [1.5, 2, 2.5] },
    { id: 'well', f: singularity, min: 2, w: [2, 2, 1] },
    { id: 'eclipse', f: eclipse, min: 2, w: [0.6, 1.5, 1.5], cd: 'eclCd' },
    { id: 'supernova', f: supernova, min: 3, w: [0, 0, 0], cd: 'novaCd', special: true },
  ];
  function chooseAttack() {
    const d = Math.hypot(player.x - S.x, player.z - S.z), band = d < 18 ? 0 : d < 34 ? 1 : 2;
    const list = ATK.filter((a) => a.min <= S.phase && !S.hist.slice(-2).includes(a.id) && !(a.cd && S[a.cd] > 0));
    if (S.phase >= 3 && S.novaCd <= 0) return ATK.find((a) => a.special);
    if (S.resCd <= 0) return ATK[0];
    let tot = 0; const ws = list.map((a) => { const w = a.w[band]; tot += w; return w; });
    if (tot <= 0) return list[(Math.random() * list.length) | 0] || ATK[0];
    let r = Math.random() * tot;
    for (let i = 0; i < list.length; i++) { r -= ws[i]; if (r <= 0) return list[i]; }
    return list[0];
  }
  function startAttack() {
    const a = chooseAttack();
    S.atk = a; S.hist.push(a.id); if (S.hist.length > 6) S.hist.shift();
    S.runner = { gen: a.f(), wait: 0 };
  }
  function abort() {
    if (S.runner) { try { S.runner.gen.return(); } catch (_) {} S.runner = null; }
    S.later.length = 0; S.darkT = 0; S.eclT = 0; S.alignT = 0; S.nova = null; S.coreBoost = 0;
    for (const m of moons) m.mode = 'orbit';
  }
  function onAttackDone() {
    const a = S.atk; S.atk = null;
    spinTo(0.6 + S.phase * 0.2, -0.8 - S.phase * 0.2, 1 + S.phase * 0.3); S.hT = 17;
    const chain = S.phase >= 2 && Math.random() < (S.phase >= 3 ? 0.5 : 0.35);
    S.cd = chain ? rnd(0.1, 0.25) : S.phase === 1 ? rnd(0.7, 1.4) : S.phase === 2 ? rnd(0.4, 0.9) : rnd(0.2, 0.6);
    void a;
  }

  // ===== PHASES, INTRO, DEATH =====
  function stage(n) {
    const s = STAGE[n];
    S.vis.spB = s.spB; S.vis.halo = s.halo; S.vis.corona = s.corona; S.heat = s.heat;
    setPalette(s.pal);
  }
  function setPalette(hex) { S.palette = hex; arena.setPalette(hex); rig.M.glow.color.setHex(hex); }
  const frameAt = () => ({ P: (x, y, z) => _cp.set(S.x + x, AY + y, S.z + z), L: (x, y, z) => _v.set(S.x + x, AY + y, S.z + z) });

  function* cut2() {                                      // PHASE II: rings snap into one plane, eclipse, spires extend
    const T = 5.4, F = frameAt();
    S.cineT = 0;
    S.cine = (t) => {
      let p, l, fov;
      if (t < 1.8) { const k = t / 1.8; p = F.P(-14 + 4 * k, cy() - AY - 8, 30 - 6 * k); l = F.L(0, cy() - AY, 0); fov = 58 - 4 * k; }
      else if (t < 3.4) { const k = (t - 1.8) / 1.6; p = F.P(9 - 3 * k, cy() - AY + 2, 17 - 3 * k); l = F.L(0, cy() - AY, 0); fov = 50; }
      else { const k = (t - 3.4) / 2; p = F.P(-8 + 14 * k, cy() - AY + 4, 34 + 8 * k); l = F.L(0, cy() - AY - 1, 0); fov = 62; }
      return { p, l, w: t > T - 0.8 ? 1 - ease((t - (T - 0.8)) / 0.8) : 1, fov };
    };
    S.hT = 17; spinTo(0, 0, 0);
    sfx.hum(1); sfx.swell(1); shake(0.8); ui.flash('#ffffff', 0.6, 1.0); S.darkT = 0.6;
    later(0.3, () => { S.alignT = 1; sfx.zap(1); });
    later(1.8, () => {
      S.eclT = 1; setPalette(STAGE[2].pal); sfx.boom(1.6, 1); ui.flash('#9ab0ff', 0.7, 0.6); shake(0.9);
      wave(S.x, S.z, { v: 30, maxR: 46, dmg: 0, col: STAGE[2].pal, wallH: 3 });
      fx.ball(S.x, cy(), S.z, 50, STAGE[2].pal, 0.8);
    });
    later(3.2, () => { sfx.hum(1); ui.card('PHASE II', 'THE ECLIPSE', 3); shake(0.6); ui.flash('#ffffff', 0.5, 0.6); });
    later(3.9, () => { S.eclT = 0; S.alignT = 0; S.darkT = 0; spinTo(1, -1.2, 1.6); wave(S.x, S.z, { v: 34, maxR: 46, dmg: 0, col: 0xffffff, wallH: 4 }); });
    yield* during(T, () => {
      const t = S.cineT;
      S.vis.spB = outBack(prog(t, 2.0, 3.4)); S.vis.halo = outBack(prog(t, 1.8, 3.0)); S.heat = lerp(0, STAGE[2].heat, prog(t, 0, 3));
      if (Math.random() < 0.5) fx.arc(S.x + rnd(-20, 20), cy() + rnd(10, 30), S.z + rnd(-20, 20), S.x + rnd(-4, 4), cy() + rnd(-4, 4), S.z + rnd(-4, 4), 0xb0c0ff, 0.15, 2);
      shake(0.02);
    });
  }
  function* cut3() {                                      // PHASE III: the eclipse disc shatters, the core goes supernova
    const T = 6.2, F = frameAt();
    S.cineT = 0;
    S.cine = (t) => {
      let p, l, fov;
      if (t < 1.8) { const k = t / 1.8; p = F.P(-4 + 6 * k, 2, 40 - 6 * k); l = F.L(0, cy() - AY, 0); fov = 58; }
      else if (t < 3.4) { const k = (t - 1.8) / 1.6; p = F.P(8 - 4 * k, cy() - AY + 1, 18 - 3 * k); l = F.L(0, cy() - AY, 0); fov = 50 - 4 * k; }
      else { const k = (t - 3.4) / 2.8; p = F.P(-20 + 22 * k, cy() - AY + 6 - 2 * k, 40 + 6 * k); l = F.L(0, cy() - AY, 0); fov = 62; }
      return { p, l, w: t > T - 0.8 ? 1 - ease((t - (T - 0.8)) / 0.8) : 1, fov };
    };
    S.hT = 17; spinTo(0, 0, 0); S.eclT = 1; S.darkT = 0.7;
    sfx.swell(1); shake(0.7); ui.flash('#000000', 0.8, 0.8);
    fx.beamT(S.x, AY, S.z, S.x, AY + 240, S.z, 5, COL.gold, 2.4);
    later(1.8, () => { sfx.hum(1); shake(0.9); ui.flash('#ffd36b', 0.5, 0.7); spinTo(6, -8, 10); });
    later(3.4, () => {
      S.eclT = 0; S.darkT = 0; setPalette(STAGE[3].pal);
      ui.flash('#ffffff', 0.95, 0.9); sfx.boom(2.2, 1); sfx.hum(1); shake(1);
      fx.ball(S.x, cy(), S.z, 100, 0xffffff, 0.8); fx.ball(S.x, cy(), S.z, 150, COL.gold, 1.2); fx.light(S.x, cy(), S.z, 0xffffff, 6000, 0.9);
      fx.burst(S.x, cy(), S.z, 120, 40, 1.6, 2.6, 0.2, 0xffffff, COL.gold, { grav: 2 });
      for (let i = 0; i < 3; i++) later(i * 0.25, () => wave(S.x, S.z, { v: 28 + i * 8, maxR: 48, dmg: 0, col: i === 1 ? 0xffffff : COL.gold, wallH: 5 }));
    });
    later(5.0, () => { ui.card('PHASE III', 'SUPERNOVA', 3); spinTo(2, -2.6, 3.2); });
    yield* during(T, () => {
      const t = S.cineT;
      S.vis.corona = outBack(prog(t, 3.4, 4.8)); S.vis.halo = lerp(1, STAGE[3].halo, prog(t, 3.4, 4.6)); S.heat = lerp(STAGE[2].heat, STAGE[3].heat, prog(t, 3.4, 5));
      if (t < 3.4 && Math.random() < 0.6) fx.arc(S.x + rnd(-30, 30), AY + 120, S.z + rnd(-30, 30), S.x + rnd(-3, 3), cy(), S.z + rnd(-3, 3), 0xffe0a0, 0.25, 5);
      shake(0.02);
    });
  }
  function* transition(n) {
    S.state = 'transition'; S.invuln = true; S.frozen = true; ui.skip(true); ui.bar(false);
    try { yield* (n === 2 ? cut2() : cut3()); }
    finally {
      S.cine = null; S.later.length = 0;
      stage(n); S.phase = n; ui.setPhase(n);
      if (n === 3) S.arenaTarget = 38;
      for (let i = 0; i < 2; i++) pickup('hp');
      pickup('ammo');
      S.eclT = 0; S.alignT = 0; S.darkT = 0;
      spinTo(0.6 + n * 0.2, -0.8 - n * 0.2, 1 + n * 0.3); S.hT = 17;
      S.invuln = false; S.frozen = false; ui.skip(false); ui.bar(true);
      sfx.musicSet(n === 2 ? 0.5 : 1);
      S.cd = 1.2; S.state = 'fight';
    }
  }

  function* intro() {
    S.state = 'intro'; S.frozen = true; S.invuln = true; S.alive = false;
    S.x = AX; S.z = AZ; S.h = 20; S.hT = 20;
    S.vis = { core: 0, r: [0, 0, 0], spA: 0, spB: 0, moons: 0, corona: 0, halo: 0 };
    rig.root.visible = true;
    ui.skip(true); ui.bar(false); ui.flash('#000000', 1, 1.4);
    const fm = arena.floorMat;
    const P = (x, y, z) => _cp.set(AX + x, AY + y, AZ + z), Lk = (x, y, z) => _v.set(AX + x, AY + y, AZ + z);
    S.cineT = 0;
    S.cine = (t) => {
      if (t < 3.8) { const k = ease(t / 3.8); return { p: P(0, 3 - k, 38 - 8 * k), l: Lk(0, 14 + 8 * k, 0), w: 1, fov: 60 }; }                        // 1 low: wedges light, sky ring
      if (t < 8.0) { const k = (t - 3.8) / 4.2; return { p: P(-24 + 12 * k, 6 + 4 * k, 30 - 4 * k), l: Lk(0, 20, 0), w: 1, fov: 58 - 4 * k }; }       // 2 assembly
      if (t < 11.4) { const k = (t - 8.0) / 3.4; return { p: P(6 - 6 * k, 19 + k, 15 - 3 * k), l: Lk(0, 20, 0), w: 1, fov: 50 - 8 * k }; }            // 3 core close-up
      const k = clamp((t - 11.4) / 2.4, 0, 1);                                                                                                         // 4 pull back to the player
      return { p: P(10 - 10 * k, 9 - 2 * k, 26 + 12 * k), l: Lk(0, 18 - 3 * k, 0), w: 1 - ease(k), fov: 52 + 10 * k };
    };
    try {
      sfx.swell(1);
      for (let i = 0; i < 12; i++) later(0.25 + i * 0.28, () => {
        arena.wedge(i, COL.cyan, 0.8, 0.4); sfx.chime(i, 1); shake(0.05);
        const a = (i * PI) / 6, x = AX + Math.cos(a) * 30, z = AZ + Math.sin(a) * 30;
        fx.beamT(x, AY, z, x, AY + 40, z, 1.2, COL.cyan, 0.5); fx.burst(x, AY + 0.5, z, 10, 10, 0.7, 1, 0.1, 0xffffff, COL.cyan, { up: 1.3, grav: 8 });
      });
      yield* during(3.8, (p) => {
        fm.emissiveIntensity = 0.15 + 1.2 * p * p; shake(0.02 + 0.04 * p);
        for (let i = 0; i < 3; i++) fx.add(AX + rnd(-14, 14), AY + 0.3, AZ + rnd(-14, 14), 0, rnd(4, 12), 0, 1, 1.4, 0.1, 0xffffff, COL.cyan, 1, -1, 0);
      });
      ui.flash('#ffffff', 0.8, 0.6); sfx.boom(1.6, 1); sfx.swell(1);
      fx.beamT(AX, AY, AZ, AX, AY + 240, AZ, 4, COL.gold, 2.4);
      wave(AX, AZ, { v: 40, maxR: 46, dmg: 0, col: 0xffffff, wallH: 3 });
      yield* during(4.2, (p) => {
        const t = p * 4.2;
        S.vis.core = outBack(prog(t, 0, 1.2)); S.vis.r[0] = outBack(prog(t, 0.6, 1.8)); S.vis.r[1] = outBack(prog(t, 1.2, 2.4)); S.vis.r[2] = outBack(prog(t, 1.8, 3.0));
        S.vis.spA = outBack(prog(t, 2.4, 3.6)); S.vis.moons = prog(t, 2.8, 4.0);
        shake(0.04);
        if (Math.random() < 0.5) fx.arc(AX + rnd(-20, 20), AY + rnd(8, 30), AZ + rnd(-20, 20), AX + rnd(-4, 4), cy(), AZ + rnd(-4, 4), 0xcfeaff, 0.2, 3);
      });
      ui.flash('#ffffff', 0.7, 0.5); sfx.hum(1); shake(0.7);
      later(0.5, () => ui.card(ORRERY.NAME, ORRERY.SUB, 3.2));
      spinTo(2.2, -3, 4);
      yield* during(3.4, () => { suck(S.x, cy(), S.z, 4, 18, COL.gold); shake(0.04); });
      ui.flash('#9af0ff', 0.35, 0.5);
      spinTo(0.8, -1, 1.3);
      yield* during(2.4, () => {});
    } finally {
      S.cine = null; ui.skip(false); ui.bar(true);
      fm.emissiveIntensity = 1.1;
      S.later.length = 0;
      S.vis = { core: 1, r: [1, 1, 1], spA: 1, spB: 0, moons: 1, corona: 0, halo: 0 };
      stage(1);
      S.invuln = false; S.frozen = false; S.alive = true; S.state = 'fight'; S.cd = 1.6;
      spinTo(0.8, -1, 1.3); S.hT = 17;
      targets.forEach((t) => { if (t.kind !== 'orb') t.alive = true; });
      ui.hint('IT DEFLECTS BULLETS — SHOOT ITS GOLD ORBS BACK AT IT', 4);
    }
  }

  function kill() {
    S.alive = false; S.hp = 0;
    targets.forEach((t) => { t.alive = false; });
    abort(); clearHazards();
    S.invuln = true;
    S.runner = { gen: death(), wait: 0 };
  }
  function clearHazards() {
    for (const w of S.waves) w.h.hide(); S.waves.length = 0;
    for (const L of S.lines) L.h.hide(); S.lines.length = 0;
    for (const o of S.orbs) killOrb(o); S.orbs.length = 0;
    clearBullets();
  }
  function* death() {
    S.state = 'dead'; ui.setStatus(''); S.cineT = 0;
    S.cine = (t) => { const a = 0.5 + t * 0.14; return { p: _cp.set(S.x + Math.cos(a) * 42, AY + S.h * 0.5 + 6, S.z + Math.sin(a) * 42), l: _v.set(S.x, AY + S.h, S.z), w: ease(t / 0.8), fov: 60 }; };
    sfx.hum(1); ui.flash('#ffffff', 0.5, 1);
    spinTo(10, -12, 14); S.alignT = 0; S.hT = 20;
    const blast = (x, y, z, s) => { fx.ball(x, y, z, 10 * s, 0xffe0a0, 0.45); fx.burst(x, y, z, 22, 16, 0.9, 1.5, 0.2, 0xffffff, COL.gold, { grav: 6 }); fx.light(x, y, z, COL.gold, 2500, 0.25); sfx.boom(0.7 * s, vol(x, z)); shake(0.18 * s); };
    for (let i = 0; i < 24; i++) later(i * 0.2, () => blast(S.x + rnd(-14, 14), cy() + rnd(-10, 10), S.z + rnd(-14, 14), 1));
    moons.forEach((m, i) => later(0.8 + i * 0.4, () => { S.moonGone[i] = true; blast(m.x, m.y, m.z, 1.2); }));
    yield* during(5.6, (p) => {
      const t = p * 5.6;
      S.vis.r[2] = 1 - prog(t, 1.6, 2.1); S.vis.r[1] = 1 - prog(t, 2.6, 3.1); S.vis.r[0] = 1 - prog(t, 3.6, 4.1); S.vis.spA = 1 - prog(t, 4.2, 4.8); S.vis.spB = Math.min(S.vis.spB, 1 - prog(t, 4.2, 4.8));
      S.vis.corona = Math.min(S.vis.corona, 1 - prog(t, 4.2, 4.8)); S.vis.halo = Math.min(S.vis.halo, 1 - prog(t, 4.2, 4.8));
      S.coreBoost = prog(t, 4.2, 5.6) * 1.2; S.jolt = 0.5;
      shake(0.04 + p * 0.08);
      suck(S.x, cy(), S.z, 4, 22, 0xffffff);
    });
    ui.flash('#ffffff', 1, 2.2);
    const cx = S.x, cyv = cy(), cz = S.z;
    rig.root.visible = false;
    fx.ball(cx, cyv, cz, 120, 0xffffff, 1.0); fx.ball(cx, cyv, cz, 180, COL.gold, 1.4);
    fx.beamT(cx, AY, cz, cx, AY + 240, cz, 7, 0xffffff, 2.6);
    fx.burst(cx, cyv, cz, 160, 44, 1.8, 3, 0.2, 0xffffff, COL.gold, { grav: 3 });
    fx.light(cx, cyv, cz, 0xffffff, 7000, 1.2);
    wave(cx, cz, { v: 40, maxR: 60, dmg: 0, col: 0xffffff, wallH: 6 });
    sfx.boom(2.4, 1); shake(1);
    for (let i = 0; i < 40; i++) later(0.1 + i * 0.06, () => fx.add(AX + rnd(-40, 40), AY + rnd(20, 70), AZ + rnd(-40, 40), rnd(-2, 2), rnd(-22, -10), rnd(-2, 2), 2.2, 1.6, 0.2, 0xffffff, COL.gold, 1, 0, 0));
    yield 2.8;
    S.cine = null; S.result = 'win'; S.frozen = true;
    arena.setPalette(COL.gold);
    ui.end(true, { time: S.stats.time, deaths: S.deaths, taken: S.stats.taken, best: S.best });
    ui.setStatus(''); sfx.musicStop();
    if (onWin) { try { onWin(); } catch (_) {} }
    if (document.pointerLockElement) document.exitPointerLock();
  }
  function lose() {
    if (S.result) return;
    abort(); clearHazards();
    S.result = 'lose'; S.frozen = true; S.invuln = true;
    sfx.hum(1); ui.dead(false);
    ui.end(false, { time: S.stats.time, deaths: S.deaths, taken: S.stats.taken, best: S.best });
    sfx.musicStop();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  // ---------------- per-frame systems ----------------
  function tickRunner(dt) {
    const r = S.runner; if (!r) return;
    r.wait -= dt;
    let g = 0;
    while (r.wait <= 0 && g++ < 60) {
      const n = r.gen.next();
      if (n.done) { if (S.runner === r) { S.runner = null; if (S.state === 'fight') onAttackDone(); } return; }
      r.wait = Math.max(1e-4, +n.value || 0);
    }
  }
  function idleMove(dt) {
    const rad = S.phase >= 3 ? 16 : 12;
    S.orbA += dt * (S.phase >= 2 ? 0.28 : 0.2);
    const tx = AX + Math.cos(S.orbA) * rad, tz = AZ + Math.sin(S.orbA) * rad, k = Math.min(1, dt * 1.2);
    S.x += (tx - S.x) * k; S.z += (tz - S.z) * k;
  }
  function aiUpdate(dt) {
    if (S.state !== 'fight') return;
    S.fightT += dt; S.stats.time += dt;
    S.eclCd = Math.max(0, S.eclCd - dt); S.novaCd = Math.max(0, S.novaCd - dt); S.resCd = Math.max(0, S.resCd - dt); S.stagger = Math.max(0, S.stagger - dt);
    const f = S.hp / S.maxHp;
    if ((S.phase === 1 && f <= 0.66) || (S.phase === 2 && f <= 0.33)) { abort(); clearHazards(); S.runner = { gen: transition(S.phase + 1), wait: 0 }; return; }
    if (S.runner) return;
    idleMove(dt);
    S.cd -= dt;
    if (S.stagger <= 0 && S.cd <= 0 && player.alive) startAttack();
  }
  function updMoons(dt) {
    moons.forEach((m, i) => {
      const gone = S.moonGone[i] || S.vis.moons < 0.01;
      m.g.visible = !gone;
      if (m.mode === 'orbit') {
        const a = S.t * 0.5 * (1 + i * 0.06) + (i * TAU) / 6, k = Math.min(1, dt * 5);
        m.x += (S.x + Math.cos(a) * 24 - m.x) * k; m.y += (AY + S.h + Math.sin(a * 2 + i) * 5 - m.y) * k; m.z += (S.z + Math.sin(a) * 24 - m.z) * k;
      }
      m.g.position.set(m.x, m.y, m.z); m.g.rotation.y += dt * 1.2; m.g.scale.setScalar(Math.max(0.001, S.vis.moons));
      if (m.glow) { if (gone) m.glow.set(m.x, m.y, m.z, 0.01, m.col, 0); else m.glow.set(m.x, m.y, m.z, 6.5 * S.vis.moons, m.col, 0.55); }
    });
  }
  function constrain(dt) {
    if (!player.alive || S.frozen) { S.imp.x = S.imp.z = 0; return; }
    const ix = S.imp.x * dt, iz = S.imp.z * dt;
    if (Math.abs(ix) + Math.abs(iz) > 1e-4) { const r = resolveCircle(player.x + ix, player.z + iz, player.radius, player.y, 1.8); player.x = r.x; player.z = r.z; }
    const k = Math.exp(-5 * dt); S.imp.x *= k; S.imp.z *= k;
    const dx = player.x - AX, dz = player.z - AZ, d = Math.hypot(dx, dz), lim = S.arenaR - 0.7;
    if (d > lim) { player.x = AX + (dx / d) * lim; player.z = AZ + (dz / d) * lim; }
    if (player.y < AY - 8) { player.y = AY + 0.5; player.velY = 0; }
  }
  function trackPlayer() {
    if (player.deaths > S.lastDeaths) {
      S.lastDeaths = player.deaths; S.deaths++;
      S.combo = 0; ui.combo(0);
      const left = ORRERY.LIVES - S.deaths;
      ui.setLives(left);
      if (left <= 0) lose(); else { S.dead = true; ui.dead(true, left); }
    }
    if (S.dead && player.alive) { S.dead = false; ui.dead(false); }
  }

  // ---------------- rig animation ----------------
  function applyRig(dt) {
    const r = rig, t = S.t, V = S.vis, M = r.M;
    for (let i = 0; i < 3; i++) S.spin[i] += (S.spinT[i] - S.spin[i]) * Math.min(1, dt * 2.5);
    S.align += (S.alignT - S.align) * Math.min(1, dt * 3);
    S.eclSm += (S.eclT - S.eclSm) * Math.min(1, dt * 3.5);
    S.hitFlash = Math.max(0, S.hitFlash - dt * 6); S.jolt = Math.max(0, S.jolt - dt * 3);
    S.bob = Math.sin(t * 1.2) * 0.6;
    S.h += (S.hT - S.h) * Math.min(1, dt * 2);
    S.yaw += dt * (0.15 + 0.04 * S.phase);
    r.root.position.set(S.x + rnd(-1, 1) * S.jolt * 0.4, AY + S.h + S.bob, S.z);
    const cs = Math.max(0.001, V.core * (1 + S.heat * 0.25 + S.coreBoost * 0.7 + 0.03 * Math.sin(t * 5)));
    r.coreG.visible = V.core > 0.01; r.coreG.scale.setScalar(cs);
    r.eclipse.scale.setScalar(Math.max(0.001, S.eclSm));
    r.pupil.visible = S.eclSm < 0.5;
    r.pupil.position.set(player.x - S.x, player.y + 1 - cy(), player.z - S.z).normalize().multiplyScalar(3.1);
    r.pupil.lookAt(player.x, player.y + 1, player.z);
    M.core.color.setHex(S.phase >= 3 ? 0xfff0c0 : 0xffffff);
    r.halo.visible = V.halo > 0.01; r.halo.scale.setScalar(Math.max(0.001, V.halo)); r.halo.rotation.z += dt * 1.1; r.halo.rotation.x = PI / 2 + Math.sin(t * 0.8) * 0.25;
    r.corona.visible = V.corona > 0.01; r.corona.scale.setScalar(Math.max(0.001, V.corona * (1 + 0.08 * Math.sin(t * 9)))); r.corona.rotation.y += dt * 0.4; r.corona.rotation.z += dt * 0.25;
    r.rings.forEach((ring, i) => {
      const v = V.r[i]; ring.g.visible = v > 0.01; ring.g.scale.setScalar(Math.max(v, 0.001));
      ring.g.rotation.set(PI / 2 + lerp(ring.tx, 0, S.align) + Math.sin(t * 0.4 + i * 2) * 0.07 * (1 - S.align), 0, lerp(ring.tz, 0, S.align));
      ring.spin.rotation.z += S.spin[i] * dt;
    });
    r.spA.visible = V.spA > 0.01; r.spA.scale.setScalar(Math.max(V.spA, 0.001)); r.spA.rotation.y = S.yaw;
    r.spB.visible = V.spB > 0.01; r.spB.scale.setScalar(Math.max(V.spB, 0.001)); r.spB.rotation.y = -S.yaw * 0.7;
    M.gold.emissiveIntensity = S.heat + S.hitFlash * 0.7;
    r.light.intensity = lerp(1000, 120, S.dark) * (S.phase >= 3 ? 1.4 : 1); r.light.color.setHex(S.palette);
    r.root.updateMatrixWorld(true);
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
        camera.position.lerp(c.p, c.w);
        _cq.copy(camera.quaternion).slerp(_lq, c.w); camera.quaternion.copy(_cq);
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
    const sun = world.sun;
    sunDirV.copy(world.sunDir);
    const sx = Math.round(player.x / 2) * 2, sz = Math.round(player.z / 2) * 2;
    sun.target.position.set(sx, AY, sz);
    sun.position.set(sx, AY, sz).addScaledVector(sunDirV, 90);
    sun.target.updateMatrixWorld();
    S.dark += (S.darkT - S.dark) * Math.min(1, dt * 2.2);
    hemi.intensity = lerp(0.8, 0.1, S.dark); sun.intensity = lerp(1.6, 0.25, S.dark);
    if (scene.fog) { scene.fog.near = lerp(50, 14, S.dark); scene.fog.far = lerp(300, 120, S.dark); }
    if (S.state !== 'intro') arena.floorMat.emissiveIntensity = lerp(1.1, 0.45, S.dark);
    if (S.arenaTarget && S.arenaR > S.arenaTarget) { S.arenaR = Math.max(S.arenaTarget, S.arenaR - dt * 1.2); arena.corr.scale.setScalar(S.arenaR); }
    if (S.arenaR < R0 - 0.5 && Math.random() < dt * 40) { const a = rnd(0, TAU); fx.add(AX + Math.cos(a) * (S.arenaR + 1), AY + 0.3, AZ + Math.sin(a) * (S.arenaR + 1), 0, rnd(3, 8), 0, 0.9, 1.6, 0.2, 0xffd080, 0xff3a0a, 0.9, -1, 0.3); }
    if (Math.random() < dt * 0.35) { const a = rnd(0, TAU); fx.arc(AX + Math.cos(a) * 120, AY + 150, AZ + Math.sin(a) * 120, AX + rnd(-60, 60), AY + rnd(-20, 40), AZ + rnd(-60, 60), 0xbfeaff, 0.3, 6); }
  }

  // ---------------- lifecycle ----------------
  function enterEnv() {
    saved = {
      fogColor: scene.fog ? scene.fog.color.getHex() : 0, fogNear: scene.fog ? scene.fog.near : 0, fogFar: scene.fog ? scene.fog.far : 0,
      bg: scene.background, envI: scene.environmentIntensity, sunI: world.sun.intensity, sunC: world.sun.color.getHex(), exp: renderer.toneMappingExposure,
    };
    if (scene.fog) { scene.fog.color.setHex(0x050a14); scene.fog.near = 50; scene.fog.far = 300; }
    scene.background = new THREE.Color(0x03050b);
    scene.environmentIntensity = 0.35;
    world.sun.intensity = 1.6; world.sun.color.setHex(0xbfe8ff);
    renderer.toneMappingExposure = 0.85;
    scene.add(hemi);
    arena.group.visible = true; arena.dome.visible = true;
    fx.setEnabled(true);
  }
  function exitEnv() {
    if (!saved) return;
    if (scene.fog) { scene.fog.color.setHex(saved.fogColor); scene.fog.near = saved.fogNear; scene.fog.far = saved.fogFar; }
    scene.background = saved.bg; scene.environmentIntensity = saved.envI;
    world.sun.intensity = saved.sunI; world.sun.color.setHex(saved.sunC); renderer.toneMappingExposure = saved.exp;
    scene.remove(hemi);
    arena.group.visible = false; arena.dome.visible = false;
    fx.setEnabled(false);
    saved = null;
  }

  function start() {
    build();
    if (S.on) stop();
    reset();
    S.on = true;
    stage(1); arena.corr.scale.setScalar(R0);
    floorCol = addCollider(AX, AZ, R0 * 2 + 4, AY, R0 * 2 + 4, { y0: AY - 3, noCover: true });
    savedSpawns = SPAWNS.player.slice();
    SPAWNS.player.length = 0;
    SPAWNS.player.push({ x: AX, z: AZ + R0 - 8, y: AY, yaw: 0 });
    enterEnv();
    fx.clear(); fx.setFloor(AY); clearBullets();
    moons.forEach((m) => { m.mode = 'orbit'; m.x = AX; m.y = AY + 20; m.z = AZ; m.glow = fx.sprite(); });
    targets.forEach((t) => { t.alive = false; t.orb = null; });
    rig.root.visible = false;
    arena.floorMat.emissiveIntensity = 1.1;
    ui.show(); ui.hideEnd(); ui.dead(false); ui.setHp(1); ui.setPhase(1); ui.setLives(ORRERY.LIVES); ui.setStatus(''); ui.combo(0);
    ctrl.respawnAt({ x: AX, z: AZ + R0 - 8, y: AY, yaw: 0 });
    S.lastDeaths = player.deaths;
    sfx.musicStart(ORRERY.MUSIC); sfx.musicSet(0.2);
    S.runner = { gen: intro(), wait: 0 };
  }
  function stop() {
    if (!built) return;
    const was = S.on;
    abort();
    S.on = false; S.frozen = false;
    if (was) {
      if (floorCol) { removeCollider(floorCol); floorCol = null; }
      if (savedSpawns) { SPAWNS.player.length = 0; for (const s of savedSpawns) SPAWNS.player.push(s); savedSpawns = null; }
      clearHazards(); for (const o of S.pick) o.h.hide(); S.pick.length = 0;
      fx.clear(); exitEnv();
      rig.root.visible = false;
      ui.hide(); sfx.musicStop();
      viewmodel.visible = false;
      targets.forEach((t) => { t.alive = false; t.orb = null; });
    }
  }
  function retry() { stop(); start(); }

  function update(dt) {
    if (!S.on) return;
    if (S.skipReq) { S.skipReq = false; if ((S.state === 'intro' || S.state === 'transition') && S.runner) abort(); } // abort() runs the generator's finally block
    S.dt = dt; S.t += dt;
    trackPlayer();
    for (let i = S.later.length - 1; i >= 0; i--) { const l = S.later[i]; l.t -= dt; if (l.t <= 0) { S.later.splice(i, 1); l.fn(); } }
    tickRunner(dt);
    aiUpdate(dt);
    updMoons(dt);
    updWaves(dt); updLines(dt); updOrbs(dt); updBullets(dt); updPick(dt);
    constrain(dt);
    applyRig(dt); syncTargets();
    envUpdate(dt);
    arena.update(S.t, dt, camera);
    fx.update(dt);
    cameraFx(dt);
    ui.setHp(S.hp / S.maxHp); ui.tick(dt);
    ui.setStatus(S.nova ? 'SUPERNOVA ' + Math.round(S.novaPct * 100) + '%' : S.stagger > 0 ? 'STAGGERED' : S.invuln && S.state !== 'intro' ? 'SHIELDED' : '', !!S.nova);
    sfx.musicSet(S.phase === 1 ? 0.2 : S.phase === 2 ? 0.55 : 1);
  }

  return {
    start, stop, update, targets,
    get frozen() { return S.on && S.frozen; },
    get active() { return S.on; },
  };
}

// ======================================================================
//  LOBBY PORTAL: the Orrery gate (west of the Riftwarden gate on the north wall). Sealed until isUnlocked() is true.
//  If it overlaps something in your lobby, change PORTAL_DX.
// ======================================================================
const PORTAL_DX = 36.5;   // Riftwarden gate is at LOBBY.x + 46
function swirlTex(color) {
  const rgb = `${(color >> 16) & 255},${(color >> 8) & 255},${color & 255}`;
  return canvasTex(256, 256, (x, w) => {
    x.translate(w / 2, w / 2);
    const g = x.createRadialGradient(0, 0, 8, 0, 0, w / 2);
    g.addColorStop(0, `rgba(${rgb},0.08)`); g.addColorStop(0.55, `rgba(${rgb},0.4)`); g.addColorStop(1, `rgba(${rgb},0.85)`);
    x.fillStyle = g; x.beginPath(); x.arc(0, 0, w / 2, 0, TAU); x.fill(); x.lineCap = 'round';
    for (const [st, lw] of [[`rgba(${rgb},0.9)`, 8], ['rgba(255,255,255,0.45)', 3]]) {
      x.strokeStyle = st; x.lineWidth = lw;
      for (let k = 0; k < 12; k++) { const a = (k / 12) * TAU; x.beginPath(); x.moveTo(Math.cos(a) * 20, Math.sin(a) * 20); x.lineTo(Math.cos(a) * (w / 2 - 10), Math.sin(a) * (w / 2 - 10)); x.stroke(); }
      for (const r of [40, 70, 100]) { x.beginPath(); x.arc(0, 0, r, 0, TAU); x.stroke(); }
    }
    x.strokeStyle = `rgba(${rgb},0.95)`; x.lineWidth = 6; x.beginPath(); x.arc(0, 0, w / 2 - 5, 0, TAU); x.stroke();
  });
}

export function createOrreryPortal(scene, isUnlocked) {
  const L = LOBBY, px = L.x + PORTAL_DX, pz = L.z - L.d / 2 + 2.4, y0 = L.y, HOLD = 1.15;
  const g = new THREE.Group(); scene.add(g);
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c2029, metalness: 0.8, roughness: 0.35, emissive: 0x060a10 });
  const brass = new THREE.MeshStandardMaterial({ color: 0xb8903a, metalness: 0.95, roughness: 0.3 });
  const basic = (o) => new THREE.MeshBasicMaterial({ toneMapped: false, ...o });
  const put = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = !mat.isMeshBasicMaterial; g.add(m); return m; };
  const solid = (w, h, d, cx, yb, cz) => { put(new THREE.BoxGeometry(w, h, d), dark, cx, y0 + yb + h / 2, cz); addCollider(cx, cz, w, y0 + yb + h, d, { y0: y0 + yb, noCover: true }); };
  solid(5.2, 0.45, 1.8, px, 0, pz);
  solid(0.35, 4.2, 0.45, px - 2.3, 0.45, pz); solid(0.35, 4.2, 0.45, px + 2.3, 0.45, pz); solid(5.0, 0.35, 0.45, px, 4.4, pz);
  for (const dx of [-1.9, 0, 1.9]) put(new THREE.OctahedronGeometry(0.34, 0), brass, px + dx, y0 + 5.05 + (dx === 0 ? 0.4 : 0), pz).scale.y = 2.2;
  const TEX_ON = swirlTex(0x6fe3ff), TEX_OFF = swirlTex(0x4a505c);
  const swirl = put(new THREE.CircleGeometry(1.65, 48), basic({ map: TEX_OFF, transparent: true, side: THREE.DoubleSide }), px, y0 + 2.5, pz + 0.35);
  const halo = put(new THREE.RingGeometry(1.7, 1.9, 48), basic({ color: 0xff5a3a, transparent: true, opacity: 0.75, side: THREE.DoubleSide }), px, y0 + 2.5, pz + 0.37);
  const arm1 = put(new THREE.TorusGeometry(2.05, 0.05, 6, 48), basic({ color: 0xffc857 }), px, y0 + 2.5, pz + 0.5);
  const arm2 = put(new THREE.TorusGeometry(2.3, 0.04, 6, 48), basic({ color: 0x6fe3ff }), px, y0 + 2.5, pz + 0.55);
  put(new THREE.PlaneGeometry(3.4, 8), basic({ color: 0x6fe3ff, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), px, y0 + 4, pz + 0.6);
  const mkSign = (t2, c2) => canvasTex(512, 99, (x, w, h) => {
    const gr = x.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(10,14,22,.92)'); gr.addColorStop(1, 'rgba(6,10,16,.96)');
    x.fillStyle = gr; x.fillRect(0, 0, w, h); x.strokeStyle = c2; x.lineWidth = 6; x.strokeRect(6, 6, w - 12, h - 12);
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#fff'; x.font = '800 38px system-ui,sans-serif'; x.fillText('THE ORRERY', w / 2, h * 0.4);
    x.fillStyle = c2; x.font = '600 18px system-ui,sans-serif'; x.fillText(t2, w / 2, h * 0.76);
  });
  const SG_ON = mkSign('boss fight · solo · hard', '#6fe3ff'), SG_OFF = mkSign('SEALED — defeat the Riftwarden', '#ff5a3a');
  const sign = put(new THREE.PlaneGeometry(4.4, 0.85), basic({ map: SG_OFF, transparent: true, side: THREE.DoubleSide }), px, y0 + 5.3, pz + 0.2);
  const N = 40, ep = new Float32Array(N * 3), ev = new Float32Array(N);
  const reseed = (i, fresh) => { ep[i * 3] = px + rnd(-1.8, 1.8); ep[i * 3 + 1] = y0 + (fresh ? rnd(0.3, 4) : 0.4); ep[i * 3 + 2] = pz + rnd(0.2, 1.2); ev[i] = rnd(0.6, 1.8); };
  for (let i = 0; i < N; i++) reseed(i, true);
  const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.BufferAttribute(ep, 3));
  const embers = new THREE.Points(eg, new THREE.PointsMaterial({ color: 0x6fe3ff, size: 0.18, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false })); embers.frustumCulled = false; g.add(embers);
  let hold = 0, boost = 0, tgt = 0, shown = true, prompt = null, was = null;
  const apply = (u) => {
    swirl.material.map = u ? TEX_ON : TEX_OFF; swirl.material.needsUpdate = true;
    halo.material.color.setHex(u ? 0x6fe3ff : 0xff5a3a); halo.material.opacity = u ? 0.75 : 0.5;
    sign.material.map = u ? SG_ON : SG_OFF; sign.material.needsUpdate = true;
    embers.material.color.setHex(u ? 0x6fe3ff : 0x884433); embers.visible = true;
    arm1.visible = arm2.visible = u;
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
      if (near && !u) { hold = 0; prompt = { text: 'THE ORRERY — SEALED', sub: 'Defeat THE RIFTWARDEN to break the seal', progress: 0 }; }
      else if (near) {
        hold += dt; tgt = clamp(hold / HOLD, 0, 1);
        prompt = { text: 'E — Fight THE ORRERY', sub: 'solo boss · 2 lives · very hard', progress: tgt };
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
