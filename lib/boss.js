/**
 * BOSS MODE — THE RIFTWARDEN
 * A circular arena floating above The Pit. One mega boss: 12 attacks (short / mid / long), 3 phases,
 * a vulnerable-core "vent" mechanic, pillar cover, supply orbs, intro + death cinematics.
 *
 * Integration (see game.js):  createBoss({...}) -> { start, stop, update(dt), targets, frozen, active }
 *  - `targets` are invisible hit proxies fed to the player's normal raycast (getEnemies), so shooting, abilities and
 *    hit markers all work with no changes to player.js / enemy.js.
 *  - Damage to the player goes through ctrl.applyDamage.
 * Tuning lives in BOSS and T below.
 */
import * as THREE from 'three';
import { addCollider, removeCollider, resolveCircle } from './collision.js';
import { heightAt } from './ground.js';
import { SPAWNS } from './scene.js';

const PI = Math.PI, TAU = PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);
const ease = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const outC = (t) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > PI) d -= TAU; if (d < -PI) d += TAU; return d; };
const faceYaw = (dx, dz) => Math.atan2(-dx, -dz); // characters face -Z at yaw 0

export const BOSS = {
  NAME: 'THE RIFTWARDEN', SUB: 'WARDEN OF THE SUNDERED SKY',
  HP: 9000, LIVES: 3, R: 44, SKY: 170,
  MUSIC: 'assets/boss/riftwarden.mp3',
};
const T = { ARMOR: 0.14, WALK: 4.2, TURN: 1.5 };
const HIP = 7.1;
const REST = {
  hipY: 0, torsoX: 0, torsoY: 0, torsoZ: 0, headX: 0, headY: 0, lShX: 0, lShZ: 0.14, lElbX: 0.3, rShX: 0, rShZ: 0.14, rElbX: 0.3,
  lLegX: 0, rLegX: 0, lKneeX: 0, rKneeX: 0, plates: 0, eyes: 1, halo: 1, coreS: 1,
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
    scorch: canvasTex(128, 128, radial([[0, 'rgba(0,0,0,.95)'], [0.55, 'rgba(10,6,8,.7)'], [0.8, 'rgba(255,120,30,.3)'], [1, 'rgba(0,0,0,0)']])),
    wall: canvasTex(8, 128, (g, w, h) => {
      const r = g.createLinearGradient(0, h, 0, 0);
      r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.15, 'rgba(255,255,255,.7)'); r.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = r; g.fillRect(0, 0, w, h);
    }),
    disc: canvasTex(256, 256, (g, w, h) => {
      g.translate(w / 2, h / 2);
      g.fillStyle = 'rgba(255,255,255,.10)'; g.beginPath(); g.arc(0, 0, 120, 0, TAU); g.fill();
      g.strokeStyle = '#fff'; g.lineWidth = 7; g.beginPath(); g.arc(0, 0, 122, 0, TAU); g.stroke();
      g.lineWidth = 3; g.beginPath(); g.arc(0, 0, 100, 0, TAU); g.stroke();
      g.fillStyle = '#fff';
      for (let i = 0; i < 24; i++) { g.save(); g.rotate((i * TAU) / 24); g.fillRect(-2, 100, 4, 18); g.restore(); }
    }),
    fill: canvasTex(128, 128, (g, w, h) => { g.fillStyle = '#fff'; g.beginPath(); g.arc(w / 2, h / 2, w / 2 - 2, 0, TAU); g.fill(); }),
  };
}

// ======================================================================
//  SFX (own tiny synth on the game's AudioContext; capped voices so mobile stays happy)
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
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260;
    const a = ctx.createOscillator(), b = ctx.createOscillator();
    a.type = 'sawtooth'; a.frequency.value = 41.2; b.type = 'sine'; b.frequency.value = 61.7;
    a.connect(f); b.connect(f); f.connect(g); g.connect(master); a.start(); b.start();
    g.gain.setTargetAtTime(0.16, ctx.currentTime, 1.2);
    dr = { a, b, g, f };
  }
  return {
    boom: (s = 1, v = 1) => play(v, 1.4 * s, (o, t) => {
      osc(o, t, { f: 85, f2: 22, dur: 0.9 * s, gain: 1.1 });
      nz(o, t, { f: 1400, f2: 60, dur: 1.0 * s, gain: 1.0 });
      nz(o, t, { type: 'highpass', f: 2500, dur: 0.12, gain: 0.5 });
      if (s > 1.2) osc(o, t + 0.05, { f: 48, f2: 20, dur: 1.4, gain: 0.9 });
    }, s > 1.4),
    roar: (v = 1) => play(v, 2.2, (o, t) => {
      osc(o, t, { type: 'sawtooth', f: 62, f2: 38, dur: 1.7, gain: 0.5, a: 0.15 });
      osc(o, t, { type: 'sawtooth', f: 93, f2: 55, dur: 1.6, gain: 0.35, a: 0.2 });
      nz(o, t, { type: 'bandpass', f: 260, f2: 900, q: 1.2, dur: 1.6, gain: 0.7, a: 0.2 });
      nz(o, t + 0.9, { type: 'bandpass', f: 900, f2: 200, q: 1, dur: 0.9, gain: 0.5 });
    }, true),
    charge: (d = 1.5, v = 1) => play(v, d + 0.4, (o, t) => {
      osc(o, t, { type: 'sawtooth', f: 70, f2: 520, dur: d * 0.1, gain: 0.32, a: d * 0.9 });
      nz(o, t, { type: 'highpass', f: 400, f2: 6000, dur: d * 0.1, gain: 0.4, a: d * 0.9 });
      osc(o, t + d, { f: 140, f2: 40, dur: 0.3, gain: 0.5 });
    }),
    zap: (v = 1) => play(v, 0.3, (o, t) => {
      nz(o, t, { type: 'highpass', f: 3500, dur: 0.12, gain: 0.5 });
      osc(o, t, { type: 'square', f: 1500, f2: 180, dur: 0.18, gain: 0.22 });
    }),
    whoosh: (v = 1) => play(v, 0.6, (o, t) => nz(o, t, { type: 'bandpass', f: 200, f2: 2400, q: 0.9, dur: 0.45, gain: 0.5, a: 0.1 })),
    shatter: (v = 1) => play(v, 0.6, (o, t) => {
      nz(o, t, { type: 'highpass', f: 1800, dur: 0.5, gain: 0.6 });
      osc(o, t, { type: 'triangle', f: 2800, f2: 1500, dur: 0.25, gain: 0.2 });
    }),
    thump: (v = 1) => play(v, 0.4, (o, t) => {
      osc(o, t, { f: 62, f2: 28, dur: 0.3, gain: 0.9 });
      nz(o, t, { f: 400, f2: 80, dur: 0.25, gain: 0.6 });
    }),
    swell: (v = 1) => play(v, 1.6, (o, t) => {
      osc(o, t, { type: 'sawtooth', f: 90, f2: 200, dur: 0.5, gain: 0.3, a: 0.9 });
      nz(o, t, { type: 'bandpass', f: 300, f2: 1500, q: 1, dur: 0.5, gain: 0.35, a: 0.9 });
    }),
    /** sustained beam hum; returns { set(v), stop() } */
    loop() {
      if (!ready()) return { set() {}, stop() {} };
      const g = ctx.createGain(); g.gain.value = 0.0001; g.connect(master);
      const a = ctx.createOscillator(), b = ctx.createOscillator(), n = ctx.createBufferSource(), nf = ctx.createBiquadFilter(), ng = ctx.createGain();
      a.type = 'sawtooth'; a.frequency.value = 57; b.type = 'square'; b.frequency.value = 114.5;
      n.buffer = nb; n.loop = true; nf.type = 'bandpass'; nf.frequency.value = 1400; nf.Q.value = 0.6; ng.gain.value = 0.35;
      a.connect(g); b.connect(g); n.connect(nf); nf.connect(ng); ng.connect(g);
      a.start(); b.start(); n.start();
      g.gain.linearRampToValueAtTime(0.55, ctx.currentTime + 0.15);
      return {
        set(v) { g.gain.setTargetAtTime(0.55 * v, ctx.currentTime, 0.05); },
        stop() { g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.12); setTimeout(() => { try { a.stop(); b.stop(); n.stop(); g.disconnect(); } catch (_) {} }, 700); },
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
    musicSet(i) { if (dr && ctx) dr.f.frequency.setTargetAtTime(220 + i * 520, ctx.currentTime, 0.5); if (el) el.volume = 0.35 + 0.2 * clamp(i, 0, 1); },
    musicStop() { if (el) { try { el.pause(); } catch (_) {} el = null; } drone(false); },
  };
}

// ======================================================================
//  FX: particles, shockwave walls, beams, telegraphs, decals, debris, lightning, lights
// ======================================================================
function createFx(scene, camera, renderer) {
  const tx = makeTex();
  const root = new THREE.Group();
  root.visible = false;
  scene.add(root);
  const v2 = new THREE.Vector2(), _q = new THREE.Quaternion(), _up = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3();
  let floorY = 0, time = 0;
  const planeG = new THREE.PlaneGeometry(2, 2).rotateX(-PI / 2);
  const rectG = new THREE.PlaneGeometry(1, 1).rotateX(-PI / 2).translate(0, 0.5 * 0, 0.5);
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

  // ----- particles (two Points systems: additive glow + normal-blended smoke/dust) -----
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
  const pa = points(1700, true), pn = points(900, false);
  root.add(pa.obj, pn.obj);
  const add = pa.emit, dust = pn.emit;
  function burst(x, y, z, n, spd, life, s0, s1, c0, c1, o = {}) {
    const E = o.dust ? dust : add, up = o.up || 0, grav = o.grav ?? 6, drag = o.drag ?? 0.8, a = o.a ?? 1, flat = o.flat || 0;
    for (let i = 0; i < n; i++) {
      const th = rnd(0, TAU), ph = Math.acos(rnd(-1, 1)), s = spd * rnd(0.3, 1);
      E(x, y, z, Math.sin(ph) * Math.cos(th) * s, (Math.cos(ph) * (1 - flat) + up) * s, Math.sin(ph) * Math.sin(th) * s, life * rnd(0.6, 1.2), s0, s1, c0, c1, a, grav, drag);
    }
  }

  // ----- glow sprites (projectile heads, orbs, black holes) -----
  const mkSprite = (additive) => pool(36, () => {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tx.glow, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, fog: false }));
    s.visible = false; root.add(s);
    const o = {
      set(x, y, z, size, col, a = 1) { s.visible = true; s.position.set(x, y, z); s.scale.setScalar(size); s.material.color.setHex(col); s.material.opacity = a; },
      hide() { s.visible = false; o.on = false; },
    };
    return o;
  });
  const sprAdd = mkSprite(true), sprNorm = mkSprite(false);
  const sprite = (additive = true) => (additive ? sprAdd : sprNorm).get();

  // ----- timed fireballs / flashes -----
  const balls = [];
  function ball(x, y, z, r, col, life) { const h = sprAdd.get(); h.set(x, y, z, 0.1, col, 1); balls.push({ h, x, y, z, r, life, t: 0, col }); }

  // ----- shockwave "walls" -----
  const waves = pool(14, () => {
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
  // curved blade for the cleave wave: a partial cylinder bulging forward (+Z local)
  const crescents = pool(4, () => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 24, 1, true, -0.62, 1.24).translate(0, 0.5, 0), addM({ map: tx.wall, side: THREE.DoubleSide }));
    m.visible = false; root.add(m);
    const o = {
      place(cx, y, cz, dx, dz, R, h, a, col) { m.visible = true; m.position.set(cx, y, cz); m.rotation.y = Math.atan2(dx, dz); m.scale.set(R, h, R); m.material.opacity = a; m.material.color.setHex(col); },
      hide() { m.visible = false; o.on = false; },
    };
    return o;
  });

  // ----- beams (3 nested additive cylinders) -----
  const LAY = [[0.35, 1.0], [0.75, 0.55], [1.25, 0.28]];
  const beams = pool(14, () => {
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

  // ----- crystal spikes -----
  const spikeM = new THREE.MeshStandardMaterial({ color: 0x2a1e44, emissive: 0x7a4bff, emissiveIntensity: 0.9, flatShading: true, roughness: 0.3, metalness: 0.4 });
  const spikes = pool(40, () => { const m = new THREE.Mesh(new THREE.ConeGeometry(1, 1, 6).translate(0, 0.5, 0), spikeM); m.visible = false; m.castShadow = true; root.add(m); return { m, hide() { m.visible = false; this.on = false; } }; });
  const spikeL = [];
  function spike(x, z, r, h, life) { const s = spikes.get(); s.m.visible = true; s.m.position.set(x, floorY - 0.2, z); s.m.rotation.y = rnd(0, TAU); s.m.rotation.z = rnd(-0.18, 0.18); s.m.scale.set(0.01, 0.01, 0.01); spikeL.push({ s, r, h, life, t: 0 }); }

  // ----- telegraphs -----
  const coneCache = {};
  const coneGeo = (ang) => coneCache[ang.toFixed(2)] || (coneCache[ang.toFixed(2)] = new THREE.CircleGeometry(1, 28, -PI / 2 - ang / 2, ang).rotateX(-PI / 2));
  const mkTele = (kind) => () => {
    const g = new THREE.Group(); g.visible = false; root.add(g);
    let base, prog;
    if (kind === 'disc') { base = new THREE.Mesh(planeG, basic({ map: tx.disc })); prog = new THREE.Mesh(planeG, basic({ map: tx.fill })); }
    else if (kind === 'rect') { base = new THREE.Mesh(rectG, basic({})); prog = new THREE.Mesh(rectG, basic({})); }
    else { base = new THREE.Mesh(planeG, basic({})); prog = new THREE.Mesh(planeG, basic({})); }
    base.renderOrder = 3; prog.renderOrder = 4; g.add(base, prog);
    const h = { g, base, prog, kind, o: null, t: 0, dur: 1, kill() { g.visible = false; h.on = false; } };
    return h;
  };
  const teleP = { disc: pool(12, mkTele('disc')), rect: pool(24, mkTele('rect')), cone: pool(4, mkTele('cone')) };
  const teleL = [];
  function tele(kind, o) {
    const h = teleP[kind].get();
    h.o = o; h.t = 0; h.dur = o.dur || 1; h.g.visible = true;
    const col = o.col ?? 0xff2a2a;
    h.base.material.color.setHex(col); h.prog.material.color.setHex(col);
    if (kind === 'cone') { const g = coneGeo(o.ang || 2.5); h.base.geometry = g; h.prog.geometry = g; }
    if (!teleL.includes(h)) teleL.push(h);
    return h;
  }

  // ----- decals -----
  const decS = pool(24, () => { const m = new THREE.Mesh(planeG, basic({ map: tx.scorch })); m.renderOrder = 2; m.visible = false; root.add(m); return { m, hide() { m.visible = false; this.on = false; } }; });
  const decG = pool(16, () => { const m = new THREE.Mesh(planeG, addM({ map: tx.glow })); m.renderOrder = 2; m.visible = false; root.add(m); return { m, hide() { m.visible = false; this.on = false; } }; });
  const decL = [];
  function decal(x, z, r, kind, col, life) {
    const d = (kind === 'glow' ? decG : decS).get();
    d.m.visible = true; d.m.position.set(x, floorY + 0.06 + Math.random() * 0.01, z); d.m.scale.set(r, 1, r); d.m.rotation.y = rnd(0, TAU); d.m.material.color.setHex(col); d.m.material.opacity = 1;
    decL.push({ d, life, t: 0 });
  }

  // ----- debris (instanced rocks + glowing crystals, simple bounce physics) -----
  function debrisSet(mesh, N) {
    const P = []; let head = 0;
    for (let i = 0; i < N; i++) P.push({ life: 0, max: 1, on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, wx: 0, wy: 0, wz: 0, s: 1 });
    mesh.frustumCulled = false;
    const zero = new THREE.Matrix4().makeScale(0, 0, 0), dm = new THREE.Object3D();
    for (let i = 0; i < N; i++) mesh.setMatrixAt(i, zero);
    root.add(mesh);
    return {
      spawn(x, y, z, vx, vy, vz, s, life) {
        const p = P[head]; head = (head + 1) % N;
        p.life = p.max = life; p.on = true; p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz; p.s = s;
        p.rx = rnd(0, TAU); p.ry = rnd(0, TAU); p.rz = rnd(0, TAU); p.wx = rnd(-6, 6); p.wy = rnd(-6, 6); p.wz = rnd(-6, 6);
      },
      update(dt) {
        let dirty = false;
        for (let i = 0; i < N; i++) {
          const p = P[i];
          if (p.life <= 0) { if (p.on) { p.on = false; mesh.setMatrixAt(i, zero); dirty = true; } continue; }
          p.life -= dt;
          p.vy -= 22 * dt; p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
          p.rx += p.wx * dt; p.ry += p.wy * dt; p.rz += p.wz * dt;
          const fl = floorY + p.s * 0.45;
          if (p.y < fl) { p.y = fl; if (p.vy < -1.5) p.vy *= -0.32; else p.vy = 0; p.vx *= 0.7; p.vz *= 0.7; p.wx *= 0.6; p.wy *= 0.6; p.wz *= 0.6; }
          dm.position.set(p.x, p.y, p.z); dm.rotation.set(p.rx, p.ry, p.rz); dm.scale.setScalar(p.s * Math.min(1, p.life / 0.6));
          dm.updateMatrix(); mesh.setMatrixAt(i, dm.matrix); dirty = true;
        }
        if (dirty) mesh.instanceMatrix.needsUpdate = true;
      },
      clear() { for (const p of P) p.life = 0; },
    };
  }
  const rocks = debrisSet(new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0x2b2733, roughness: 0.85, metalness: 0.2, flatShading: true }), 120), 120);
  const crys = debrisSet(new THREE.InstancedMesh(new THREE.OctahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ color: 0xb98cff }), 90), 90);
  function debris(x, y, z, n, spd, up, size, glow = 0.3) {
    for (let i = 0; i < n; i++) {
      const a = rnd(0, TAU), s = spd * rnd(0.2, 1), sz = size * rnd(0.4, 1.3);
      (Math.random() < glow ? crys : rocks).spawn(x + Math.cos(a) * rnd(0, 1.5), y, z + Math.sin(a) * rnd(0, 1.5), Math.cos(a) * s, up * rnd(0.5, 1.2), Math.sin(a) * s, sz, rnd(1.6, 3.2));
    }
  }

  // ----- lightning arcs -----
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

  // ----- one shared point light for flashes -----
  const light = new THREE.PointLight(0xffffff, 0, 170, 2);
  light.visible = false; root.add(light);
  const lt = { t: 0, dur: 1, peak: 0 };
  function flashLight(x, y, z, col, peak, dur) {
    if (lt.t > 0 && peak < light.intensity * 0.7) return;
    light.position.set(x, y, z); light.color.setHex(col); lt.t = dur; lt.dur = dur; lt.peak = peak;
  }

  function update(dt) {
    if (!root.visible) return;
    time += dt;
    pa.mat.uniforms.uK.value = pn.mat.uniforms.uK.value = renderer.getDrawingBufferSize(v2).y / (2 * Math.tan((camera.fov * PI) / 360));
    pa.update(dt); pn.update(dt); rocks.update(dt); crys.update(dt);
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
    for (let i = spikeL.length - 1; i >= 0; i--) {
      const s = spikeL[i]; s.t += dt;
      const p = s.t / s.life, up = clamp(s.t / 0.13, 0, 1), dn = p > 0.75 ? 1 - (p - 0.75) / 0.25 : 1;
      if (p >= 1) { s.s.hide(); spikeL.splice(i, 1); continue; }
      const k = outC(up) * dn; s.s.m.scale.set(s.r * (0.3 + 0.7 * k), s.h * k + 0.01, s.r * (0.3 + 0.7 * k));
    }
    for (let i = teleL.length - 1; i >= 0; i--) {
      const h = teleL[i];
      if (!h.on) { teleL.splice(i, 1); continue; }
      h.t += dt; const p = Math.min(1, h.t / h.dur), o = h.o;
      if (h.t > h.dur + 0.15) { h.kill(); teleL.splice(i, 1); continue; }
      const pulse = 0.5 + 0.5 * Math.sin(h.t * 16);
      h.g.position.set(o.x, floorY + 0.1, o.z);
      if (h.kind === 'disc') { h.base.scale.set(o.r, 1, o.r); h.prog.scale.set(o.r * p, 1, o.r * p); h.base.material.opacity = 0.35 + 0.35 * pulse * p; h.prog.material.opacity = 0.3; }
      else if (h.kind === 'rect') { h.g.rotation.y = Math.atan2(o.dx, o.dz); h.base.scale.set(o.w, 1, o.len); h.prog.scale.set(o.w, 1, Math.max(0.01, o.len * p)); h.base.material.opacity = 0.16 + 0.1 * pulse * p; h.prog.material.opacity = 0.32; }
      else { h.g.rotation.y = Math.atan2(o.dx, o.dz); h.base.scale.set(o.r, 1, o.r); h.prog.scale.set(o.r * p, 1, o.r * p); h.base.material.opacity = 0.16 + 0.1 * pulse * p; h.prog.material.opacity = 0.3; }
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
    pa.clear(); pn.clear(); rocks.clear(); crys.clear();
    for (const b of balls) b.h.hide(); balls.length = 0;
    for (const b of beamT) b.h.hide(); beamT.length = 0;
    for (const s of spikeL) s.s.hide(); spikeL.length = 0;
    for (const t of teleL) t.kill(); teleL.length = 0;
    for (const d of decL) d.d.hide(); decL.length = 0;
    for (const a of arcL) a.hide(); arcL.length = 0;
    for (const p of [waves, crescents, beams, sprAdd, sprNorm]) for (const o of p.a) if (o.on) o.hide();
    light.intensity = 0; lt.t = 0;
  }
  return {
    tx, root, add, dust, burst, sprite, ball, wave: () => waves.get(), crescent: () => crescents.get(), beam: () => beams.get(), beamT: beamTimed,
    spike, tele, decal, debris, arc, light: flashLight, update, clear,
    setFloor(y) { floorY = y; },
    setEnabled(on) { root.visible = on; light.visible = on; },
  };
}

// ======================================================================
//  RIG: the Riftwarden (procedural). Forward = -Z. +X = his right.
// ======================================================================
function buildRig() {
  const M = {
    armor: new THREE.MeshStandardMaterial({ color: 0x17181f, metalness: 0.85, roughness: 0.36, emissive: 0xff5a2a, emissiveIntensity: 0 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x2b2339, metalness: 0.9, roughness: 0.3, emissive: 0xff5a2a, emissiveIntensity: 0 }),
    horn: new THREE.MeshStandardMaterial({ color: 0x8a8296, metalness: 0.3, roughness: 0.6 }),
    vein: new THREE.MeshBasicMaterial({ color: 0xa36bff }),
    core: new THREE.MeshBasicMaterial({ color: 0xffa347 }),
    eye: new THREE.MeshBasicMaterial({ color: 0xff3d6e }),
    shield: new THREE.MeshBasicMaterial({ color: 0x8f6bff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }),
    hit: new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  };
  const root = new THREE.Group();
  const grp = (p, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); p.add(g); return g; };
  const mesh = (geo, mat, p, x, y, z, sh = true) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = sh; p.add(m); return m; };
  const box = (w, h, d, mat, p, x, y, z) => mesh(new THREE.BoxGeometry(w, h, d), mat, p, x, y, z);
  const cyl = (rt, rb, h, seg, mat, p, x, y, z) => mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat, p, x, y, z);
  const sph = (r, mat, p, x, y, z, sx = 1, sy = 1, sz = 1) => { const m = mesh(new THREE.SphereGeometry(r, 16, 12), mat, p, x, y, z); m.scale.set(sx, sy, sz); return m; };
  const cone = (r, h, seg, mat, p, x, y, z) => mesh(new THREE.ConeGeometry(r, h, seg), mat, p, x, y, z);
  const hits = [];
  const hit = (p, kind, w, h, d, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M.hit);
    m.position.set(x, y, z); m.visible = false;
    m.userData.hitZone = kind === 'core' || kind === 'head' ? 'head' : 'body'; m.userData.kind = kind;
    p.add(m); hits.push(m); return m;
  };
  const J = {}, A = {};

  const hip = grp(root, 0, HIP, 0);
  box(3.8, 1.5, 2.6, M.armor, hip, 0, 0, 0);
  box(2.2, 1.1, 2.9, M.trim, hip, 0, -0.45, 0);
  hit(hip, 'armor', 2.6, 1.6, 2.2, 0, -0.1, 0);

  for (const [n, s] of [['l', -1], ['r', 1]]) {
    const th = grp(hip, s * 1.55, -0.3, 0);
    box(1.7, 3.4, 1.9, M.armor, th, 0, -1.6, 0);
    box(2.1, 0.7, 2.3, M.trim, th, 0, -0.1, 0);
    box(0.14, 2.6, 0.14, M.vein, th, s * 0.86, -1.7, -0.2);
    hit(th, 'leg', 1.9, 3.2, 1.9, 0, -1.7, 0);
    const kn = grp(th, 0, -3.3, 0);
    sph(1.0, M.trim, kn, 0, 0, -0.35);
    box(1.5, 3.1, 1.7, M.armor, kn, 0, -1.6, 0.15);
    cone(0.5, 1.4, 5, M.horn, kn, 0, 0.2, -1.1).rotation.x = -PI / 2;
    hit(kn, 'leg', 1.7, 3.0, 1.8, 0, -1.6, 0.1);
    const ft = grp(kn, 0, -3.2, 0);
    box(1.9, 0.7, 3.2, M.armor, ft, 0, 0, -0.7);
    box(1.4, 0.35, 1.2, M.trim, ft, 0, 0.45, -1.2);
    A[n + 'Sole'] = grp(ft, 0, -0.35, -0.6);
    J[n + 'Th'] = th; J[n + 'Kn'] = kn;
  }

  const torso = grp(hip, 0, 0.8, 0);
  box(3.4, 2.2, 2.6, M.trim, torso, 0, 0.4, 0);
  box(6.2, 4.2, 3.2, M.armor, torso, 0, 3.4, 0);
  box(4.6, 0.5, 3.4, M.trim, torso, 0, 5.4, 0);
  box(5.4, 0.4, 3.5, M.trim, torso, 0, 1.4, 0);
  box(0.16, 3.4, 0.12, M.vein, torso, -2.3, 3.4, -1.62);
  box(0.16, 3.4, 0.12, M.vein, torso, 2.3, 3.4, -1.62);
  const coreMesh = sph(1.0, M.core, torso, 0, 3.5, -1.3);
  const coreRing = mesh(new THREE.TorusGeometry(1.45, 0.16, 8, 32), M.vein, torso, 0, 3.5, -1.5, false);
  cyl(1.4, 1.8, 1.0, 10, M.trim, torso, 0, 3.6, 1.9).rotation.x = PI / 2;
  mesh(new THREE.TorusGeometry(1.1, 0.12, 8, 28), M.vein, torso, 0, 3.6, 2.45, false);
  for (const x of [-2.05, 0, 2.05]) for (const y of [2.5, 4.3]) { hit(torso, 'armor', 2.0, 1.8, 1.9, x, y, -0.65); hit(torso, 'armor', 2.0, 1.8, 1.4, x, y, 1.0); }
  hit(torso, 'armor', 3.0, 2.0, 2.4, 0, 0.5, 0);
  hit(torso, 'core', 2.1, 2.1, 1.6, 0, 3.5, -1.5);
  A.core = coreMesh;

  const plates = [];
  for (const s of [-1, 1]) {
    const p = grp(torso, s * 2.75, 3.5, -2.5);
    box(2.9, 3.6, 0.45, M.armor, p, -s * 1.45, 0, 0);
    box(2.5, 0.14, 0.5, M.vein, p, -s * 1.45, 0.4, -0.03);
    box(2.5, 0.14, 0.5, M.vein, p, -s * 1.45, -0.4, -0.03);
    cone(0.35, 1.0, 5, M.horn, p, -s * 2.5, 0, -0.1).rotation.x = -PI / 2;
    hit(p, 'plate', 2.8, 3.5, 0.5, -s * 1.45, 0, 0);
    plates.push(p);
  }

  const neck = grp(torso, 0, 5.7, 0.1);
  box(2.1, 2.2, 2.3, M.armor, neck, 0, 1.0, -0.2);
  box(1.6, 0.8, 2.0, M.trim, neck, 0, -0.1, -0.35);
  box(2.4, 0.5, 2.5, M.trim, neck, 0, 2.15, -0.2);
  for (const x of [-0.55, 0, 0.55]) box(0.42, 0.2, 0.1, M.eye, neck, x, 1.2, -1.38);
  for (const s of [-1, 1]) { const h = cone(0.45, 3.4, 6, M.horn, neck, s * 1.25, 2.9, 0.1); h.rotation.z = -s * 0.55; h.rotation.x = 0.25; }
  const halo = mesh(new THREE.TorusGeometry(2.6, 0.13, 8, 48), M.vein, neck, 0, 1.6, 1.5, false);
  hit(neck, 'head', 2.2, 2.3, 2.3, 0, 1.0, -0.2);
  A.head = neck;

  const arms = {};
  for (const [n, s] of [['l', -1], ['r', 1]]) {
    const sh = grp(torso, s * 4.0, 4.7, 0);
    sph(1.8, M.armor, sh, 0, 0.2, 0, 1.15, 0.9, 1.15);
    box(3.0, 0.4, 2.6, M.trim, sh, s * 0.2, 1.0, 0);
    for (let i = 0; i < 3; i++) { const sp = cone(0.36, 1.6 + i * 0.4, 5, M.horn, sh, s * (0.5 + i * 0.5), 1.4, (i - 1) * 0.7); sp.rotation.z = -s * (0.4 + i * 0.15); }
    box(1.55, 3.6, 1.7, M.armor, sh, 0, -1.9, 0);
    box(0.14, 2.8, 0.14, M.vein, sh, s * 0.82, -1.9, -0.3);
    hit(sh, 'armor', 1.7, 3.4, 1.8, 0, -1.9, 0);
    const el = grp(sh, 0, -3.7, 0);
    sph(0.95, M.trim, el, 0, 0, 0);
    box(1.75, 3.2, 1.9, M.armor, el, 0, -1.7, 0);
    hit(el, 'armor', 1.9, 3.0, 2.0, 0, -1.7, 0);
    arms[n] = { sh, el };
  }
  // left arm = rift cannon
  cyl(0.95, 0.75, 1.5, 12, M.trim, arms.l.el, 0, -3.6, 0);
  mesh(new THREE.TorusGeometry(0.85, 0.12, 8, 20), M.vein, arms.l.el, 0, -3.2, 0, false).rotation.x = PI / 2;
  mesh(new THREE.TorusGeometry(0.7, 0.1, 8, 20), M.vein, arms.l.el, 0, -4.0, 0, false).rotation.x = PI / 2;
  const muzGlow = sph(0.55, M.core, arms.l.el, 0, -4.35, 0);
  A.lMuz = grp(arms.l.el, 0, -4.5, 0);
  // right arm = crystal fist
  sph(1.5, M.trim, arms.r.el, 0, -3.8, 0, 1, 1.15, 1.1);
  for (const [x, z] of [[-0.7, -0.5], [0.7, -0.5], [-0.7, 0.5], [0.7, 0.5]]) { const c = cone(0.4, 2.0, 5, M.vein, arms.r.el, x, -5.0, z); c.rotation.x = PI; }
  hit(arms.r.el, 'armor', 2.4, 2.4, 2.4, 0, -3.9, 0);
  A.rFist = grp(arms.r.el, 0, -4.4, 0);

  const orbit = grp(torso, 0, 4.4, 2.4);
  const shards = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * TAU, g = grp(orbit, Math.cos(a) * 3.8, Math.sin(a) * 3.8, 0);
    const m = mesh(new THREE.OctahedronGeometry(0.6, 0), M.vein, g, 0, 0, 0, false);
    m.scale.set(0.55, 1.9, 0.55); g.rotation.z = a - PI / 2; shards.push(g);
  }
  const shield = sph(9.5, M.shield, torso, 0, 2.5, 0); shield.visible = false; shield.castShadow = false;
  root.traverse((o) => { if (o.isMesh && o.material !== M.hit) o.frustumCulled = false; });
  return { root, M, J, A, hip, torso, neck, plates, halo, coreMesh, coreRing, muzGlow, orbit, shards, arms, hits, shield };
}

// ======================================================================
//  ARENA: floating rune disc, edge fangs, pillars, sky dome, rift portal, drifting islands
// ======================================================================
function buildArena(AX, AY, AZ, R, tx) {
  const g = new THREE.Group();
  g.position.set(AX, AY, AZ); g.visible = false;
  const rockM = new THREE.MeshStandardMaterial({ color: 0x1a1720, roughness: 0.9, metalness: 0.2, flatShading: true });
  const rune = canvasTex(1024, 1024, (c, w, h) => {
    c.fillStyle = '#05040a'; c.fillRect(0, 0, w, h); c.translate(w / 2, h / 2); c.strokeStyle = '#fff'; c.fillStyle = '#fff';
    for (const [r, lw] of [[498, 8], [470, 3], [400, 2], [330, 5], [250, 3], [160, 4], [70, 3]]) { c.lineWidth = lw; c.beginPath(); c.arc(0, 0, r, 0, TAU); c.stroke(); }
    for (let i = 0; i < 64; i++) { c.save(); c.rotate((i / 64) * TAU); c.fillRect(-2, 400, 4, i % 4 === 0 ? 70 : 30); c.restore(); }
    for (let i = 0; i < 8; i++) { c.save(); c.rotate((i / 8) * TAU); c.lineWidth = 3; c.beginPath(); c.moveTo(0, 70); c.lineTo(0, 330); c.stroke(); c.beginPath(); c.moveTo(-40, 250); c.lineTo(0, 330); c.lineTo(40, 250); c.stroke(); c.restore(); }
    for (let i = 0; i < 24; i++) { c.save(); c.rotate((i / 24) * TAU + 0.07); for (let k = 0; k < 4; k++) c.fillRect(-10 + rnd(-4, 4), 335 + k * 16, rnd(6, 18), 5); c.restore(); }
  });
  const floorMat = new THREE.MeshStandardMaterial({ map: rune, emissiveMap: rune, emissive: 0x9966ff, emissiveIntensity: 1.1, roughness: 0.5, metalness: 0.5 });
  const floor = new THREE.Mesh(new THREE.CircleGeometry(R, 72).rotateX(-PI / 2), floorMat);
  floor.position.y = 0.02; floor.receiveShadow = true; g.add(floor);
  const under = new THREE.Mesh(new THREE.CylinderGeometry(R + 1.5, 6, 46, 28), rockM); under.position.y = -23; g.add(under);
  const edgeMat = new THREE.MeshBasicMaterial({ color: 0xa36bff });
  const edge = new THREE.Mesh(new THREE.TorusGeometry(R, 0.45, 8, 96).rotateX(PI / 2), edgeMat); edge.position.y = 0.3; g.add(edge);
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * TAU, m = new THREE.Mesh(new THREE.ConeGeometry(1.1, rnd(5, 9), 5), rockM);
    m.position.set(Math.cos(a) * (R + 1.5), 2.2, Math.sin(a) * (R + 1.5)); m.rotation.set(Math.sin(a) * 0.35, 0, -Math.cos(a) * 0.35); m.castShadow = true; g.add(m);
    const tip = new THREE.Mesh(new THREE.OctahedronGeometry(0.5, 0), edgeMat); tip.position.set(Math.cos(a) * (R + 2.1), 5.8, Math.sin(a) * (R + 2.1)); g.add(tip);
  }
  // shrinking corruption ring (scaled uniformly by arenaR)
  const corrMat = new THREE.MeshBasicMaterial({ color: 0xff3a1a, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const corr = new THREE.Mesh(new THREE.RingGeometry(1, 1.5, 72).rotateX(-PI / 2), corrMat); corr.position.y = 0.08; corr.scale.setScalar(R); g.add(corr);

  // pillars (cover)
  const pillars = [];
  for (let i = 0; i < 4; i++) {
    const a = PI / 4 + (i * PI) / 2, px = Math.cos(a) * 27, pz = Math.sin(a) * 27;
    const pg = new THREE.Group(); pg.position.set(px, 0, pz); g.add(pg);
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.9, 17, 8), rockM); body.position.y = 8.5; body.castShadow = true; pg.add(body);
    for (let k = 0; k < 4; k++) { const v = new THREE.Mesh(new THREE.BoxGeometry(0.14, 15, 0.14), edgeMat); const aa = (k / 4) * TAU + 0.4; v.position.set(Math.cos(aa) * 1.55, 8.3, Math.sin(aa) * 1.55); pg.add(v); }
    const top = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), edgeMat); top.scale.set(1.2, 2.4, 1.2); top.position.y = 19.2; pg.add(top);
    pillars.push({ x: AX + px, z: AZ + pz, hp: 1500, max: 1500, alive: true, g: pg, top, col: null, grow: 1 });
  }

  // sky dome (follows the camera), giant rift portal, rings, drifting islands
  const domeTex = canvasTex(1024, 512, (c, w, h) => {
    const gr = c.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#05030c'); gr.addColorStop(0.5, '#1a0b2c'); gr.addColorStop(0.78, '#3a1236'); gr.addColorStop(1, '#120712');
    c.fillStyle = gr; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) { const x = rnd(0, w), y = rnd(h * 0.2, h * 0.8), r = rnd(60, 190), rg = c.createRadialGradient(x, y, 0, x, y, r); const col = Math.random() < 0.5 ? '140,80,255' : '255,70,120'; rg.addColorStop(0, `rgba(${col},.16)`); rg.addColorStop(1, `rgba(${col},0)`); c.fillStyle = rg; c.fillRect(x - r, y - r, r * 2, r * 2); }
    c.fillStyle = '#fff'; for (let i = 0; i < 380; i++) { c.globalAlpha = rnd(0.2, 0.9); c.fillRect(rnd(0, w), rnd(0, h * 0.7), rnd(1, 2.2), rnd(1, 2.2)); }
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(330, 24, 16), new THREE.MeshBasicMaterial({ map: domeTex, side: THREE.BackSide, fog: false, depthWrite: false }));
  dome.renderOrder = -20; dome.frustumCulled = false;
  const swirl = canvasTex(512, 512, (c, w, h) => {
    c.translate(w / 2, h / 2);
    for (let arm = 0; arm < 5; arm++) for (let i = 0; i < 160; i++) { const t = i / 160, a = arm * (TAU / 5) + t * 6.5, r = 14 + t * 236; c.fillStyle = `rgba(190,130,255,${(1 - t) * 0.5})`; c.beginPath(); c.arc(Math.cos(a) * r, Math.sin(a) * r, 3 + (1 - t) * 11, 0, TAU); c.fill(); }
    const rg = c.createRadialGradient(0, 0, 0, 0, 0, 90); rg.addColorStop(0, 'rgba(255,255,255,.95)'); rg.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = rg; c.fillRect(-256, -256, 512, 512);
  });
  const portalMat = new THREE.MeshBasicMaterial({ map: swirl, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
  const portal = new THREE.Mesh(new THREE.PlaneGeometry(560, 560).rotateX(PI / 2), portalMat); portal.position.y = 150; g.add(portal);
  const rings = [];
  for (const [r, tilt] of [[62, 0.05], [98, -0.04], [136, 0.03]]) { const m = new THREE.Mesh(new THREE.TorusGeometry(r, 1.6, 6, 72).rotateX(PI / 2), new THREE.MeshBasicMaterial({ color: 0xa36bff, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); m.position.y = 150; m.rotation.x = tilt; g.add(m); rings.push(m); }
  const islands = [];
  for (let i = 0; i < 12; i++) {
    const a = rnd(0, TAU), d = rnd(80, 150), s = rnd(6, 15), m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), rockM);
    m.scale.set(s, s * rnd(0.5, 0.9), s); m.position.set(Math.cos(a) * d, rnd(-40, 60), Math.sin(a) * d); m.rotation.set(rnd(0, 3), rnd(0, 3), rnd(0, 3));
    const cr = new THREE.Mesh(new THREE.OctahedronGeometry(1, 0), edgeMat); cr.scale.set(0.12, 0.5, 0.12); cr.position.set(0, 1.1, 0); m.add(cr);
    g.add(m); islands.push({ m, y: m.position.y, ph: rnd(0, TAU), sp: rnd(0.1, 0.3) });
  }
  const mats = [edgeMat, portalMat, ...rings.map((r) => r.material)];
  const col = new THREE.Color();
  function setPalette(hex) {
    col.setHex(hex);
    for (const m of mats) m.color.copy(col);
    floorMat.emissive.copy(col);
  }
  function update(t, dt, cam) {
    portal.rotation.y += dt * 0.07;
    rings.forEach((r, i) => { r.rotation.y += dt * (0.1 + i * 0.05) * (i % 2 ? -1 : 1); });
    for (const i of islands) { i.m.position.y = i.y + Math.sin(t * i.sp + i.ph) * 3; i.m.rotation.y += dt * 0.05; }
    for (const p of pillars) { p.top.rotation.y += dt * 0.8; if (p.grow < 1) { p.grow = Math.min(1, p.grow + dt / 1.4); p.g.scale.y = Math.max(0.01, ease(p.grow)); } }
    edge.position.y = 0.3 + Math.sin(t * 2) * 0.05;
    corrMat.opacity = 0.3 + 0.15 * Math.sin(t * 5);
    dome.position.copy(cam.position);
    dome.scale.setScalar(Math.max(0.3, (cam.far * 0.9) / 330));
  }
  return { group: g, dome, pillars, corr, setPalette, update, portalMat };
}

// ======================================================================
//  UI (boss bar, title cards, flashes, end screen) — plain DOM, no HUD changes needed
// ======================================================================
const CSS = `
#bossUI{position:fixed;inset:0;z-index:12;pointer-events:none;display:none;font-family:system-ui,sans-serif;color:#fff}
#bossUI.on{display:block}
#bBar{position:absolute;top:14px;left:50%;transform:translateX(-50%);width:min(640px,86vw);text-shadow:0 2px 6px #000}
#bBar .bn{display:flex;justify-content:space-between;align-items:baseline;font-weight:800;letter-spacing:.18em;font-size:15px}
#bBar .bn i{font-style:normal;font-weight:600;font-size:10px;opacity:.65;letter-spacing:.22em}
#bBar .bt{position:relative;height:14px;margin-top:5px;background:rgba(10,6,18,.78);border:1px solid rgba(190,150,255,.55);box-shadow:0 0 18px rgba(150,90,255,.35)}
#bFill,#bTrail{position:absolute;inset:0;transform-origin:left;transition:transform .12s}
#bFill{background:linear-gradient(90deg,#8f5bff,#ff5b8a)}
#bTrail{background:rgba(255,255,255,.55);transition:transform .9s .25s}
#bBar u{position:absolute;top:-3px;bottom:-3px;width:2px;background:#fff;opacity:.7}
#bBar .bs{display:flex;justify-content:space-between;font-size:11px;font-weight:700;letter-spacing:.14em;margin-top:5px;min-height:15px}
#bSt{color:#ffd36b} #bSt.hot{color:#ff6b6b} #bLv{color:#ff7a95}
#bCard{position:absolute;left:0;right:0;top:30%;text-align:center;opacity:0;text-shadow:0 0 30px rgba(160,100,255,.9),0 4px 10px #000}
#bCard h1{margin:0;font-size:clamp(28px,6vw,64px);letter-spacing:.3em;font-weight:900}
#bCard p{margin:8px 0 0;font-size:clamp(12px,2vw,18px);letter-spacing:.35em;opacity:.8}
#bCard.show{animation:bCard var(--d,3s) ease both}
@keyframes bCard{0%{opacity:0;transform:scale(1.25)}10%{opacity:1;transform:scale(1)}80%{opacity:1}100%{opacity:0}}
#bFlash{position:absolute;inset:0;opacity:0;background:#fff}
#bHint{position:absolute;left:0;right:0;top:92px;text-align:center;font-weight:800;letter-spacing:.2em;font-size:13px;text-shadow:0 2px 8px #000;opacity:0;transition:opacity .25s}
#bHint.on{opacity:1}
#bDead{position:absolute;inset:0;display:none;align-items:center;justify-content:center;flex-direction:column;background:radial-gradient(circle,rgba(60,0,10,.35),rgba(0,0,0,.75))}
#bDead.on{display:flex}
#bDead h2{margin:0;font-size:46px;letter-spacing:.3em} #bDead p{opacity:.8;letter-spacing:.2em}
#bEnd{position:absolute;inset:0;display:none;align-items:center;justify-content:center;background:rgba(5,2,12,.78);pointer-events:auto}
#bEnd.on{display:flex}
#bEnd .bc{text-align:center;padding:26px 34px;border:1px solid rgba(190,150,255,.5);background:rgba(15,8,28,.92);box-shadow:0 0 50px rgba(150,90,255,.4)}
#bEnd h2{margin:0 0 6px;font-size:34px;letter-spacing:.3em} #bEnd p{margin:4px 0;letter-spacing:.12em;opacity:.85;font-size:14px}
#bEnd .row{display:flex;gap:10px;justify-content:center;margin-top:18px;flex-wrap:wrap}
#bEnd button{padding:.7rem 1.1rem;font-weight:800;letter-spacing:.14em;border:1px solid rgba(255,255,255,.35);background:rgba(255,255,255,.1);color:#fff;border-radius:6px}
#bEnd button.go{background:#a36bff;border-color:#a36bff;color:#14081f}
@media (max-width:700px){#bBar .bn{font-size:12px}#bDead h2{font-size:30px}}`;

function createUi({ onRetry, onLobby }) {
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  const el = document.createElement('div'); el.id = 'bossUI';
  el.innerHTML = '<div id="bBar"><div class="bn"><b id="bName"></b><i id="bSub"></i></div><div class="bt"><div id="bTrail"></div><div id="bFill"></div><u style="left:66%"></u><u style="left:33%"></u></div><div class="bs"><span id="bPh"></span><span id="bSt"></span><span id="bLv"></span></div></div>' +
    '<div id="bCard"><h1></h1><p></p></div><div id="bFlash"></div><div id="bHint"></div>' +
    '<div id="bDead"><h2>YOU DIED</h2><p id="bDeadP"></p></div>' +
    '<div id="bEnd"><div class="bc"><h2 id="bEndT"></h2><p id="bEndP"></p><p id="bEndS"></p><div class="row"><button class="go" id="bRetry">FIGHT AGAIN (R)</button><button id="bLobby">BACK TO LOBBY</button></div></div></div>';
  document.body.appendChild(el);
  const $ = (s) => el.querySelector(s);
  const q = { fill: $('#bFill'), trail: $('#bTrail'), ph: $('#bPh'), st: $('#bSt'), lv: $('#bLv'), card: $('#bCard'), flash: $('#bFlash'), hint: $('#bHint'), dead: $('#bDead'), end: $('#bEnd') };
  $('#bName').textContent = BOSS.NAME; $('#bSub').textContent = BOSS.SUB;
  $('#bRetry').addEventListener('click', () => onRetry());
  $('#bLobby').addEventListener('click', () => onLobby());
  let lastHp = -1, flashT = 0, hintT = 0;
  return {
    show() { el.classList.add('on'); },
    hide() { el.classList.remove('on'); q.end.classList.remove('on'); q.dead.classList.remove('on'); q.hint.classList.remove('on'); q.flash.style.opacity = 0; },
    setHp(f) { const v = f.toFixed(3); if (v !== lastHp) { lastHp = v; q.fill.style.transform = `scaleX(${v})`; q.trail.style.transform = `scaleX(${v})`; } },
    setPhase(p) { q.ph.textContent = 'PHASE ' + ['I', 'II', 'III'][p - 1]; },
    setStatus(t, hot) { if (q.st.textContent !== t) q.st.textContent = t; q.st.classList.toggle('hot', !!hot); },
    setLives(n) { q.lv.textContent = '♥'.repeat(Math.max(0, n)) + '♡'.repeat(Math.max(0, BOSS.LIVES - n)); },
    card(t, s, sec = 3) { q.card.querySelector('h1').textContent = t; q.card.querySelector('p').textContent = s || ''; q.card.style.setProperty('--d', sec + 's'); q.card.classList.remove('show'); void q.card.offsetWidth; q.card.classList.add('show'); },
    flash(color, a, sec) { q.flash.style.background = color; q.flash.style.transition = 'none'; q.flash.style.opacity = a; void q.flash.offsetWidth; q.flash.style.transition = `opacity ${sec}s ease-out`; q.flash.style.opacity = 0; },
    hint(t, sec = 3) { q.hint.textContent = t; q.hint.classList.add('on'); hintT = sec; },
    tick(dt) { if (hintT > 0) { hintT -= dt; if (hintT <= 0) q.hint.classList.remove('on'); } },
    dead(on, left) { q.dead.classList.toggle('on', !!on); if (on) $('#bDeadP').textContent = left > 0 ? `${left} ${left === 1 ? 'LIFE' : 'LIVES'} LEFT` : ''; },
    end(win, stats) {
      $('#bEndT').textContent = win ? 'RIFTWARDEN DEFEATED' : 'YOU HAVE FALLEN';
      $('#bEndP').textContent = win ? 'The rift seals. The sky is quiet.' : 'The Riftwarden endures.';
      const m = Math.floor(stats.time / 60), s = Math.floor(stats.time % 60);
      $('#bEndS').textContent = `TIME ${m}:${String(s).padStart(2, '0')}  ·  DEATHS ${stats.deaths}  ·  DAMAGE TAKEN ${Math.round(stats.taken)}`;
      q.end.classList.add('on');
    },
    hideEnd() { q.end.classList.remove('on'); },
  };
}

// ======================================================================
//  THE BOSS
// ======================================================================
export function createBoss(deps) {
  const { scene, camera, renderer, world, audio, hud, player, ctrl, viewmodel, playerMesh, onExit } = deps;
  const AX = world.arena.x, AZ = world.arena.z, AY = Math.round(heightAt(AX, AZ)) + BOSS.SKY, R0 = BOSS.R;
  const targets = [];
  const _w = new THREE.Vector3(), _v = new THREE.Vector3(), _cp = new THREE.Vector3(), _cq = new THREE.Quaternion(), _look = new THREE.Object3D();
  let built = false, fx = null, sfx = null, ui = null, rig = null, arena = null, hemi = null, floorCol = null;
  let savedSpawns = null, saved = null, loopBeam = null;
  const S = {};
  const ctxFake = { player, enemies: [], audio: { play() {} }, bullets: null, net: null, build: null };
  const sunDirV = new THREE.Vector3();

  const vol = (x, z) => clamp(1.15 - Math.hypot(x - player.x, z - player.z) / 140, 0.3, 1);
  const shake = (a, x = S.x, z = S.z) => { S.trauma = Math.min(1, S.trauma + a * clamp(1.2 - Math.hypot(x - player.x, z - player.z) / 70, 0.15, 1)); };
  const fwd = (yaw = S.yaw) => ({ x: -Math.sin(yaw), z: -Math.cos(yaw) });
  const anchor = (n) => rig.A[n].getWorldPosition(_w);
  const later = (t, fn) => S.later.push({ t, fn });
  const COL = { fire: 0xff7a30, void: 0xa36bff, blue: 0x7fd0ff };

  function reset() {
    Object.assign(S, {
      on: false, frozen: false, state: 'off', phase: 1, hp: BOSS.HP, maxHp: BOSS.HP, alive: false, invuln: true, exposed: false,
      x: AX, z: AZ, y: AY, yaw: 0, t: 0, dt: 0.016, cd: 2, hist: [], runner: null, later: [], waves: [], zones: [], proj: [], orbs: [],
      ch: { ...REST }, tg: { ...REST }, kk: {}, walk: 0, walkAmt: 0, speedNow: 0, lockLegs: false, grounded: true, rootOff: 0, plant: 0,
      trauma: 0, imp: { x: 0, z: 0 }, arenaR: R0, deaths: 0, lastDeaths: 0, hitFlash: 0, cine: null, ventCd: 14, specialCd: 25, orbT: 14, orbN: 0,
      result: null, stats: { taken: 0, time: 0, dealt: 0 }, orbitSpin: 1, stepSign: 1, beamCd: 0, hurtCd: 0, atk: null, fightT: 0, dead: false, deflectT: 0, hole: null,
    });
    S.ch = { ...REST }; S.tg = { ...REST };
  }
  reset();

  // ---------------- build (lazy, first entry only) ----------------
  function build() {
    if (built) return;
    built = true;
    fx = createFx(scene, camera, renderer);
    sfx = createSfx(audio);
    ui = createUi({ onRetry: () => retry(), onLobby: () => onExit('Back in the lobby') });
    rig = buildRig();
    rig.root.visible = false;
    scene.add(rig.root);
    arena = buildArena(AX, AY, AZ, R0, fx.tx);
    scene.add(arena.group, arena.dome);
    arena.dome.visible = false;
    hemi = new THREE.HemisphereLight(0x8a6cff, 0x1a0c10, 0.7);
    rig.hits.forEach((m, i) => targets.push(makeTarget(m, i)));
    addEventListener('keydown', (e) => { if (S.on && S.result && e.code === 'KeyR') retry(); });
    fx.setFloor(AY);
  }

  function makeTarget(mesh, i) {
    const t = {
      id: 'riftwarden' + i, name: BOSS.NAME, mesh, kind: mesh.userData.kind, team: 0, isLeader: false, serverSide: false, ctx: ctxFake, alive: false,
      x: AX, y: AY, z: AZ, yaw: 0, vx: 0, vz: 0, suppression: 0, markUntil: 0, radius: 1.2, state: 'engage', stateT: 0, awareness: 0, engaged: false,
      engagedT: 0, focus: 0, flinch: 0, lastHurt: 0, combatT: 0, focusX: 0, focusZ: 0, reactTime: 0.4, wp: null, maxHp: BOSS.HP,
    };
    // damageEnemy() does `e.hp -= dmg`: the getter/setter pair turns that into our own damage model
    Object.defineProperty(t, 'hp', {
      get: () => Math.max(1, S.hp),
      set: (v) => { const d = Math.max(0, Math.max(1, S.hp) - v); if (d > 0) takeHit(d, t.kind); },
    });
    return t;
  }

  function takeHit(dmg, kind) {
    if (!S.alive || S.state === 'dead') return;
    if (S.invuln) {
      if (S.t - S.deflectT > 0.12) { S.deflectT = S.t; audio.play('clang'); }
      return;
    }
    let m = T.ARMOR;
    if (kind === 'core') m = S.exposed ? 1.0 : 0.05;
    else if (kind === 'head') m = 0.3;
    else if (kind === 'plate') m = S.exposed ? 0.3 : 0.08;
    else if (kind === 'leg') m = 0.12;
    if (S.exposed && kind !== 'core' && kind !== 'plate') m *= 2.2;
    S.hp = Math.max(0, S.hp - dmg * m);
    S.stats.dealt += dmg * m;
    S.hitFlash = Math.min(1, S.hitFlash + 0.25 * Math.min(1, m * 1.5));
    if (S.hp <= 0) kill();
  }

  // ---------------- player helpers ----------------
  function hurt(dmg, sx, sz) {
    if (!player.alive || S.frozen || dmg <= 0) return false;
    const before = player.hp;
    ctrl.applyDamage(dmg, sx, sz, BOSS.NAME);
    S.stats.taken += Math.max(0, before - player.hp);
    return true;
  }
  function knock(x, z, spd, up = 0) {
    const dx = player.x - x, dz = player.z - z, l = Math.hypot(dx, dz) || 1;
    S.imp.x += (dx / l) * spd; S.imp.z += (dz / l) * spd;
    if (up) { player.velY = Math.max(player.velY, up); player.onGround = false; }
  }
  const airH = () => player.y - AY;

  // ---------------- gameplay entities ----------------
  function wave(x, z, o) {
    S.waves.push({ h: fx.wave(), x, z, y: o.y ?? AY, r: o.r0 ?? 1.5, v: o.v, maxR: o.maxR, w: o.w ?? 2.4, clear: o.clear ?? 0.7, wallH: o.wallH ?? 2.6, dmg: o.dmg, kb: o.kb ?? 14, up: o.up ?? 0, col: o.col ?? COL.fire, hit: false });
  }
  function zone(x, z, r, o) {
    S.zones.push({ x, z, r, dmg: o.dmg || 0, delay: o.delay || 0, dur: o.dur ?? 0.2, tick: o.tick || 0, t: 0, hit: false, up: o.up || 0, kb: o.kb || 0, acc: 0, fire: !!o.fire, col: o.col ?? 0xff7a30 });
  }
  function pillarHit(p, dmg) {
    if (!p.alive) return;
    p.hp -= dmg;
    if (p.hp > 0) return;
    p.alive = false; p.g.visible = false;
    if (p.col) { removeCollider(p.col); p.col = null; }
    fx.debris(p.x, AY + 4, p.z, 20, 12, 14, 1.2, 0.4);
    fx.burst(p.x, AY + 6, p.z, 40, 18, 1.2, 1.6, 0.2, 0xffffff, 0xa36bff, { grav: 8 });
    sfx.shatter(vol(p.x, p.z)); sfx.boom(1.2, vol(p.x, p.z)); shake(0.4, p.x, p.z);
  }
  function blast(x, z, r, dmg) { for (const p of arena.pillars) if (p.alive && Math.hypot(p.x - x, p.z - z) < r + 1.7) pillarHit(p, dmg); }
  function regrowPillars() {
    for (const p of arena.pillars) {
      if (p.alive) continue;
      p.alive = true; p.hp = p.max; p.g.visible = true; p.g.scale.y = 0.01; p.grow = 0;
      p.col = addCollider(p.x, p.z, 3.4, AY + 17, 3.4, { y0: AY - 2 });
      fx.burst(p.x, AY + 1, p.z, 24, 10, 0.8, 1.4, 0.2, 0xffffff, 0xa36bff, { up: 1.2 });
    }
  }
  function impact(x, z, s = 1, col = COL.fire) {
    const y = AY, v = vol(x, z);
    sfx.boom(s, v);
    fx.ball(x, y + 1.2, z, 8 * s, col, 0.5); fx.ball(x, y + 0.6, z, 14 * s, 0xffffff, 0.16);
    fx.burst(x, y + 0.6, z, Math.round(26 * s), 20 * s, 0.9, 1.3, 0.2, 0xffffff, col, { up: 0.9, grav: 14, drag: 0.5 });
    for (let i = 0; i < 22 * s; i++) { const a = rnd(0, TAU), sp = rnd(8, 26) * s; fx.dust(x + Math.cos(a) * 1.5, y + 0.4, z + Math.sin(a) * 1.5, Math.cos(a) * sp, rnd(1, 5), Math.sin(a) * sp, rnd(1.1, 2.0), 1.6 * s, 6 * s, 0x6b5a55, 0x20202a, 0.55, -1, 1.4); }
    fx.debris(x, y + 0.5, z, Math.round(10 * s), 14 * s, 14 * s, 0.7 * s + 0.3, 0.3);
    fx.decal(x, z, 5.5 * s, 'scorch', 0x000000, 14);
    fx.light(x, y + 4, z, col, 3200 * s, 0.4);
    shake(0.45 * s, x, z); blast(x, z, 5 * s, 120 * s);
  }
  function geyser(x, z, big) {
    const r = big ? 1.9 : 1.4;
    zone(x, z, r + 0.5, { dmg: 30, dur: 0.45, up: 11 });
    fx.beamT(x, AY, z, x, AY + 17, z, r, 0xff8a2a, 0.55);
    fx.burst(x, AY + 0.5, z, 14, 16, 0.8, 1.2, 0.15, 0xffffff, 0xff5a1a, { up: 1.6, grav: 12 });
    for (let i = 0; i < 4; i++) fx.dust(x + rnd(-1, 1), AY + 0.5, z + rnd(-1, 1), rnd(-4, 4), rnd(4, 9), rnd(-4, 4), 1.2, 1.2, 4, 0x5a4a45, 0x20202a, 0.5, 2, 1);
    fx.debris(x, AY + 0.5, z, 2, 6, 12, 0.5, 0.3);
    fx.decal(x, z, 2.6, 'glow', 0xff6a1a, 1.4);
    if (Math.random() < 0.35) { fx.light(x, AY + 3, z, 0xff7a2a, 1600, 0.25); shake(0.06, x, z); }
  }
  function crescent(x, z, yaw, dmg) {
    const f = fwd(yaw);
    S.proj.push({ k: 'cres', h: fx.crescent(), x, z, f, R: 9, v: 34, life: 1.5, t: 0, dmg, hit: false, col: 0xff6a3a });
    sfx.whoosh(vol(x, z));
  }
  function fireShard() {
    const sh = rig.shards[(Math.random() * 8) | 0]; sh.getWorldPosition(_w);
    const x = _w.x, y = _w.y, z = _w.z;
    const px = player.x + player.vx * 0.25 + rnd(-2, 2), py = player.y + 1.0, pz = player.z + player.vz * 0.25 + rnd(-2, 2);
    const dx = px - x, dy = py - y, dz = pz - z, l = Math.hypot(dx, dy, dz) || 1, sp = 30;
    S.proj.push({ k: 'shard', x, y, z, vx: (dx / l) * sp, vy: (dy / l) * sp, vz: (dz / l) * sp, h: fx.sprite(), t: 0, life: 4.5 });
    sfx.zap(vol(x, z) * 0.7);
    fx.burst(x, y, z, 6, 6, 0.4, 0.8, 0.1, 0xffffff, COL.void, { grav: 0 });
  }
  function meteor(tx, tz) {
    const fall = 1.5, sx = tx + rnd(-30, 30), sz = tz + rnd(-30, 30), sy = AY + 95;
    fx.tele('disc', { x: tx, z: tz, r: 6, dur: fall, col: 0xff6a2a });
    S.proj.push({ k: 'met', x: sx, y: sy, z: sz, vx: (tx - sx) / fall, vy: (AY - sy) / fall, vz: (tz - sz) / fall, tx, tz, h: fx.sprite(), h2: fx.sprite(), t: 0, fall });
  }
  function meteorHit(tx, tz) {
    impact(tx, tz, 1.15);
    wave(tx, tz, { v: 18, maxR: 13, dmg: 20, col: COL.fire });
    zone(tx, tz, 6.2, { dmg: 40, dur: 0.12, up: 8 });
    zone(tx, tz, 4.6, { tick: 15, dur: 4.5, delay: 0.1, fire: true });
    fx.decal(tx, tz, 5, 'glow', 0xff5a1a, 4.5);
  }
  function strike(x, z, delay) {
    fx.tele('disc', { x, z, r: 5.2, dur: delay, col: COL.blue });
    later(delay, () => {
      fx.beamT(x, AY, z, x, AY + 150, z, 4.2, COL.blue, 0.6);
      fx.ball(x, AY + 2, z, 12, 0xffffff, 0.3);
      fx.burst(x, AY + 1, z, 30, 22, 0.9, 1.3, 0.2, 0xffffff, COL.blue, { up: 1.4, grav: 10 });
      for (let i = 0; i < 3; i++) fx.arc(x + rnd(-12, 12), AY + 90, z + rnd(-12, 12), x + rnd(-2, 2), AY + 1, z + rnd(-2, 2), 0xcfeaff, 0.25, 4);
      impact(x, z, 1.0, COL.blue);
      wave(x, z, { v: 22, maxR: 15, dmg: 20, col: COL.blue });
      zone(x, z, 5.2, { dmg: 46, dur: 0.14, up: 8 });
      sfx.zap(vol(x, z));
    });
  }
  function orb(kind) {
    const a = rnd(0, TAU), r = rnd(8, S.arenaR - 9);
    S.orbs.push({ kind, x: AX + Math.cos(a) * r, z: AZ + Math.sin(a) * r, h: fx.sprite(), t: 0 });
  }

  // ---------------- attack toolkit ----------------
  function pose(o, k = 6) { for (const key in o) { S.tg[key] = o[key]; S.kk[key] = k; } }
  function rest(k = 5) { pose(REST, k); S.lockLegs = false; }
  function turnTo(target, rate) { S.yaw += clamp(angDiff(target, S.yaw), -rate * S.dt, rate * S.dt); }
  function face(rate = 2.2) { turnTo(faceYaw(player.x - S.x, player.z - S.z), rate); }
  function* during(dur, fn) { let t = 0; while (t < dur) { t += S.dt; fn(clamp(t / dur, 0, 1), S.dt); yield 0; } }
  function* slide(x, z, dur) { const sx = S.x, sz = S.z; yield* during(dur, (p) => { S.x = lerp(sx, x, ease(p)); S.z = lerp(sz, z, ease(p)); }); }
  function handSparks(name, n = 2) {
    const h = anchor(name), x = h.x, y = h.y, z = h.z;
    for (let i = 0; i < n; i++) fx.add(x + rnd(-0.8, 0.8), y + rnd(-0.5, 0.5), z + rnd(-0.8, 0.8), rnd(-2, 2), rnd(3, 9), rnd(-2, 2), 0.7, 1.1, 0.1, 0xffe0a0, 0xff6a1a, 1, -2, 0.4);
  }
  function kickBoss(d) { const f = fwd(); S.x = clamp(S.x - f.x * d, AX - 30, AX + 30); S.z = clamp(S.z - f.z * d, AZ - 30, AZ + 30); }

  // ===== SHORT RANGE =====
  function* fissure() {
    S.lockLegs = true;
    const n = S.phase >= 2 ? 12 : 8, a0 = rnd(0, TAU), dur = 1.35;
    pose({ rShX: 3.0, lShX: 3.0, rElbX: 0.15, lElbX: 0.15, rShZ: 0.25, lShZ: 0.25, torsoX: -0.4, hipY: -0.5, lLegX: 0.2, rLegX: -0.2, lKneeX: 0.5, rKneeX: 0.5 }, 4);
    sfx.charge(dur, vol(S.x, S.z));
    for (let i = 0; i < n; i++) { const a = a0 + (i * TAU) / n; fx.tele('rect', { x: S.x, z: S.z, dx: Math.cos(a), dz: Math.sin(a), len: 38, w: 3, dur, col: 0xff5a2a }); }
    fx.tele('disc', { x: S.x, z: S.z, r: 9, dur, col: 0xff5a2a });
    yield* during(dur, (p) => { face(); handSparks('rFist'); handSparks('lMuz'); shake(0.01 + p * 0.02); });
    pose({ rShX: 0.05, lShX: 0.05, torsoX: 0.5, hipY: -0.1 }, 28);
    yield 0.11;
    const f = fwd(), bx = S.x, bz = S.z, ix = bx + f.x * 5, iz = bz + f.z * 5;
    impact(ix, iz, 1.5);
    wave(bx, bz, { v: 26, maxR: 38, dmg: 32, col: COL.fire, wallH: 3.2 });
    zone(ix, iz, 7, { dmg: 40, dur: 0.15, up: 8 });
    for (let i = 0; i < n; i++) {
      const a = a0 + (i * TAU) / n, cx = Math.cos(a), cz = Math.sin(a);
      for (let k = 1; k <= 9; k++) { const d = 3 + k * 3.9; later(0.12 + k * 0.075, () => geyser(bx + cx * d, bz + cz * d, k % 3 === 0)); }
    }
    yield 1.1;
  }

  function* cleave() {
    S.lockLegs = true;
    const hits = S.phase >= 3 ? 3 : S.phase >= 2 ? 2 : 1;
    for (let h = 0; h < hits; h++) {
      const dir = h % 2 === 0 ? 1 : -1, dur = h === 0 ? 0.95 : 0.6;
      pose({ torsoY: 1.25 * dir, rShX: 1.5, rShZ: 1.4, rElbX: 0.05, lShX: 0.6, lShZ: 0.5, hipY: -0.4, headY: 0.5 * dir }, 6);
      const f0 = fwd(), tl = fx.tele('cone', { x: S.x, z: S.z, dx: f0.x, dz: f0.z, ang: 2.5, r: 15.5, dur, col: 0xff3a3a });
      yield* during(dur * 0.7, () => { face(3); const f = fwd(); tl.o.x = S.x; tl.o.z = S.z; tl.o.dx = f.x; tl.o.dz = f.z; handSparks('rFist', 1); });
      yield dur * 0.3;
      pose({ torsoY: -1.5 * dir, rShZ: 1.4, headY: -0.3 * dir }, 30);
      sfx.whoosh(vol(S.x, S.z));
      yield 0.07;
      const f = fwd(), dx = player.x - S.x, dz = player.z - S.z;
      if (Math.hypot(dx, dz) < 15.5 && Math.abs(angDiff(faceYaw(dx, dz), S.yaw)) < 1.25) { hurt(46, S.x, S.z); knock(S.x, S.z, 16, 5); }
      for (let i = 0; i < 46; i++) {
        const a = S.yaw + dir * rnd(-1.25, 1.25), r = rnd(3, 15);
        fx.add(S.x - Math.sin(a) * r, AY + rnd(0.3, 3.5), S.z - Math.cos(a) * r, -Math.sin(a) * 6, rnd(0, 3), -Math.cos(a) * 6, 0.45, 1.6, 0.2, 0xffffff, 0xff5a2a, 1, 0, 2);
      }
      fx.light(S.x + f.x * 6, AY + 4, S.z + f.z * 6, 0xff7a3a, 1800, 0.25);
      crescent(S.x + f.x * 2, S.z + f.z * 2, S.yaw, 36);
      shake(0.4);
      yield h === hits - 1 ? 0.5 : 0.28;
    }
  }

  function* grasp() {
    S.lockLegs = true;
    pose({ lShX: 1.45, lShZ: 0.3, lElbX: 0.1, torsoY: -0.3, rShX: 0.6, rShZ: 0.5, hipY: -0.3 }, 6);
    const f = fwd(), ox = S.x + f.x * 8, oz = S.z + f.z * 8, oy = AY + 4.2, core = fx.sprite(false), glow = fx.sprite();
    fx.tele('disc', { x: ox, z: oz, r: 19, dur: 1.1, col: 0xaa55ff });
    sfx.charge(1.1, vol(ox, oz));
    try {
      yield* during(1.1, (p) => {
        face(1.2);
        core.set(ox, oy, oz, 0.5 + p * 6, 0x08000f, 0.95); glow.set(ox, oy, oz, 1 + p * 11, 0xb070ff, 0.45);
        for (let i = 0; i < 4; i++) { const a = rnd(0, TAU), r = rnd(6, 13), y = oy + rnd(-4, 4); fx.add(ox + Math.cos(a) * r, y, oz + Math.sin(a) * r, -Math.cos(a) * r * 1.6, (oy - y) * 1.6, -Math.sin(a) * r * 1.6, 0.6, 0.9, 0.1, 0xd8b0ff, 0x6020b0, 1, 0, 0); }
      });
      sfx.swell(vol(ox, oz));
      yield* during(2.0, (p, dt) => {
        face(0.8);
        const s = 6 + p * 2;
        core.set(ox, oy, oz, s, 0x08000f, 1); glow.set(ox, oy, oz, 12 + Math.sin(S.t * 20) * 1.2, 0xb070ff, 0.4 + 0.3 * p);
        if (player.alive) {
          const dx = ox - player.x, dz = oz - player.z, d = Math.hypot(dx, dz);
          if (d < 20 && d > 0.5) { const a = 32 * (1 - d / 24); S.imp.x += (dx / d) * a * dt; S.imp.z += (dz / d) * a * dt; }
        }
        for (let i = 0; i < 5; i++) { const a = rnd(0, TAU) + S.t * 3, r = rnd(7, 18), y = oy + rnd(-5, 5); fx.add(ox + Math.cos(a) * r, y, oz + Math.sin(a) * r, -Math.sin(a) * 9 - Math.cos(a) * r * 0.9, (oy - y) * 1.2, Math.cos(a) * 9 - Math.sin(a) * r * 0.9, 0.7, 1.0, 0.1, 0xd8b0ff, 0x4018a0, 1, 0, 0); }
        if (Math.random() < dt * 14) { const a = rnd(0, TAU), r = rnd(12, 20); fx.debris(ox + Math.cos(a) * r, AY + 1, oz + Math.sin(a) * r, 1, 0, 6, 0.8, 0.5); }
        if (Math.random() < dt * 8) fx.arc(ox, oy, oz, ox + rnd(-14, 14), AY + 0.5, oz + rnd(-14, 14), 0xc8a0ff, 0.2, 2.5);
        shake(0.015 + p * 0.03, ox, oz);
      });
    } finally { core.hide(); glow.hide(); }
    yield 0.1;
    fx.ball(ox, oy, oz, 16, 0xffffff, 0.3); fx.ball(ox, oy, oz, 26, COL.void, 0.55);
    fx.burst(ox, oy, oz, 60, 30, 1.0, 1.6, 0.2, 0xffffff, COL.void, { grav: 4 });
    sfx.boom(1.5, vol(ox, oz));
    wave(ox, oz, { v: 30, maxR: 24, dmg: 0, col: COL.void, wallH: 3.5 });
    fx.light(ox, oy, oz, COL.void, 3500, 0.5);
    shake(0.7, ox, oz);
    const d = Math.hypot(player.x - ox, player.z - oz);
    if (d < 10) { hurt(48 * (1 - d / 14), ox, oz); knock(ox, oz, 18, 6); }
    blast(ox, oz, 10, 400);
    yield 1.0;
  }

  function* stomp() {
    const n = S.phase >= 3 ? 5 : S.phase >= 2 ? 4 : 3;
    for (let i = 0; i < n; i++) {
      S.lockLegs = true;
      const L = i % 2 === 0;
      pose(L ? { lLegX: 1.3, lKneeX: 1.7, rLegX: -0.1, hipY: -0.3, torsoX: 0.2 } : { rLegX: 1.3, rKneeX: 1.7, lLegX: -0.1, hipY: -0.3, torsoX: 0.2 }, 9);
      let tx = player.x, tz = player.z;
      const clampT = () => { const dx = tx - S.x, dz = tz - S.z, d = Math.hypot(dx, dz) || 1, r = Math.min(d, 13); return [S.x + (dx / d) * r, S.z + (dz / d) * r]; };
      let [px, pz] = clampT();
      const tl = fx.tele('disc', { x: px, z: pz, r: 6.5, dur: 0.75, col: 0xff7a2a });
      yield* during(0.5, () => { face(3); tx = player.x; tz = player.z; [px, pz] = clampT(); tl.o.x = px; tl.o.z = pz; });
      yield 0.25;
      const d = Math.hypot(px - S.x, pz - S.z), f = fwd(), land = d > 4.5 ? [px - f.x * 3.2, pz - f.z * 3.2] : [S.x, S.z];
      pose(L ? { lLegX: 0.1, lKneeX: 0.2 } : { rLegX: 0.1, rKneeX: 0.2 }, 30);
      yield* slide(land[0], land[1], 0.16);
      impact(px, pz, 1.0);
      wave(px, pz, { v: 20, maxR: 17, dmg: 24, col: COL.fire });
      zone(px, pz, 6.2, { dmg: 34, dur: 0.12, up: 9 });
      for (let k = 0; k < 10; k++) { const a = (k / 10) * TAU + rnd(-0.1, 0.1); fx.spike(px + Math.cos(a) * 5, pz + Math.sin(a) * 5, 0.9, rnd(4, 6.5), 1.0); }
      sfx.shatter(vol(px, pz));
      yield 0.3;
    }
    yield 0.4;
  }

  // ===== MID RANGE =====
  function* spikeWave() {
    S.lockLegs = true;
    pose({ rShX: 3.0, rElbX: 0.1, torsoX: -0.4, lShX: 0.4, hipY: -0.4 }, 5);
    const dur = 1.05;
    let dx = 0, dz = 1;
    const aim = () => { const x = player.x - S.x, z = player.z - S.z, l = Math.hypot(x, z) || 1; dx = x / l; dz = z / l; };
    aim();
    const tl = fx.tele('rect', { x: S.x, z: S.z, dx, dz, len: 44, w: 7, dur, col: 0xaa66ff });
    sfx.charge(dur, vol(S.x, S.z));
    yield* during(0.8, () => { face(3); aim(); tl.o.dx = dx; tl.o.dz = dz; tl.o.x = S.x; tl.o.z = S.z; handSparks('rFist', 3); });
    yield 0.25;
    pose({ rShX: 0.2, torsoX: 0.55 }, 30);
    yield 0.1;
    const bx = S.x, bz = S.z, f = fwd();
    impact(bx + f.x * 4, bz + f.z * 4, 1.0, COL.void);
    for (let k = 0; k < 16; k++) {
      const d = 4 + k * 2.7;
      later(k * 0.045, () => {
        const x = bx + dx * d, z = bz + dz * d;
        fx.spike(x, z, 1.7, rnd(6, 9), 1.2);
        zone(x, z, 3.4, { dmg: 30, dur: 0.22, up: 10 });
        fx.burst(x, AY + 0.4, z, 8, 12, 0.7, 1.0, 0.1, 0xffffff, COL.void, { up: 1.5, grav: 12 });
        fx.debris(x, AY + 0.5, z, 2, 6, 10, 0.5, 0.6);
        fx.decal(x, z, 2.4, 'glow', COL.void, 1.2);
        if (k % 3 === 0) { sfx.shatter(vol(x, z) * 0.6); shake(0.05, x, z); }
      });
    }
    yield 1.5;
  }

  function* shards() {
    S.lockLegs = true;
    pose({ rShX: 2.2, lShX: 2.2, rShZ: 1.0, lShZ: 1.0, torsoX: -0.2, headX: -0.3 }, 5);
    S.orbitSpin = 5;
    sfx.charge(0.9, vol(S.x, S.z));
    yield* during(0.9, () => { face(2); for (const sh of rig.shards) { sh.getWorldPosition(_w); fx.add(_w.x, _w.y, _w.z, rnd(-1, 1), rnd(-1, 1), rnd(-1, 1), 0.4, 0.8, 0.1, 0xffffff, COL.void, 1, 0, 1); } });
    const volleys = S.phase >= 3 ? 5 : S.phase >= 2 ? 4 : 3;
    for (let v = 0; v < volleys; v++) {
      pose({ torsoX: 0.25 }, 20); kickBoss(-0.2);
      for (let i = 0; i < 5; i++) later(i * 0.08, fireShard);
      yield 0.18; pose({ torsoX: -0.2 }, 6);
      yield* during(0.75, () => face(2.5));
    }
    S.orbitSpin = 1;
    yield 0.5;
  }

  function* meteors() {
    S.lockLegs = true;
    pose({ rShX: 3.05, lShX: 3.05, rShZ: 0.6, lShZ: 0.6, torsoX: -0.55, headX: -0.7, hipY: -0.2 }, 4);
    sfx.roar(vol(S.x, S.z));
    S.portalBoost = 1;
    fx.beamT(S.x, AY + 12, S.z, S.x, AY + 160, S.z, 2.2, COL.void, 1.3);
    fx.light(S.x, AY + 14, S.z, COL.void, 2500, 0.6);
    yield 1.2;
    const n = S.phase >= 3 ? 16 : S.phase >= 2 ? 12 : 9;
    for (let i = 0; i < n; i++) {
      let tx, tz;
      if (Math.random() < 0.5) { tx = player.x + player.vx * 0.6 + rnd(-4, 4); tz = player.z + player.vz * 0.6 + rnd(-4, 4); }
      else { const a = rnd(0, TAU), r = Math.sqrt(Math.random()) * S.arenaR * 0.9; tx = AX + Math.cos(a) * r; tz = AZ + Math.sin(a) * r; }
      const dd = Math.hypot(tx - AX, tz - AZ), lim = S.arenaR - 5;
      if (dd > lim) { tx = AX + ((tx - AX) / dd) * lim; tz = AZ + ((tz - AZ) / dd) * lim; }
      meteor(tx, tz);
      yield rnd(0.22, 0.42);
    }
    yield 1.8;
  }

  function* cataclysm() {
    S.lockLegs = true;
    const b1 = fx.beam(), b2 = fx.beam();
    const total = S.phase >= 3 ? 8 : 6.5, w = S.phase >= 3 ? 1.15 : 0.85, sign = Math.random() < 0.5 ? 1 : -1;
    pose({ rShZ: 1.5, lShZ: 1.5, rElbX: 0, lElbX: 0, rShX: 0.1, lShX: 0.1, torsoX: -0.1, hipY: -0.3 }, 5);
    let th = faceYaw(player.x - S.x, player.z - S.z) * 0 + rnd(0, TAU), prev = th, t = 0, lp = null;
    const TELE = 1.6;
    sfx.roar(vol(S.x, S.z));
    try {
      while (t < total) {
        t += S.dt;
        const live = t > TELE, spin = live ? w * Math.min(1, (t - TELE) / 0.8) * sign : w * 0.15 * sign;
        prev = th; th += spin * S.dt;
        if (live && !lp) { lp = sfx.loop(); sfx.boom(1.2, vol(S.x, S.z)); shake(0.5); }
        const a = live ? 1 : 0.22 + 0.15 * Math.sin(t * 20), len = 56;
        const c1 = Math.cos(th), s1 = Math.sin(th), c2 = -c1, s2 = -s1;
        b1.set(S.x, AY + 0.45, S.z, S.x + c1 * len, AY + 0.45, S.z + s1 * len, live ? 0.7 : 0.15, 0xff5a3a, a);
        b2.set(S.x, AY + 2.2, S.z, S.x + c2 * len, AY + 2.2, S.z + s2 * len, live ? 0.8 : 0.15, 0x7fd0ff, a);
        if (live) {
          if (lp) lp.set(0.8);
          for (let i = 0; i < 3; i++) { const d = rnd(4, len), c = Math.random() < 0.5; fx.add(S.x + (c ? c1 : c2) * d, AY + 0.3, S.z + (c ? s1 : s2) * d, rnd(-3, 3), rnd(2, 8), rnd(-3, 3), 0.5, 1.2, 0.1, 0xffffff, c ? 0xff5a2a : 0x7fd0ff, 1, 10, 1); }
          shake(0.012);
          if (player.alive && S.beamCd <= 0) {
            const dx = player.x - S.x, dz = player.z - S.z, d = Math.hypot(dx, dz), pa = Math.atan2(dz, dx);
            if (d > 2.6 && d < 58) {
              const near = (ang) => { const d1 = angDiff(pa, ang - spin * S.dt), d2 = angDiff(pa, ang); return Math.abs(d2) < 0.95 / d || (Math.sign(d1) !== Math.sign(d2) && Math.abs(d1) < 0.6 && Math.abs(d2) < 0.6); };
              const lowHit = near(th) && airH() < 0.75;
              const highHit = near(th + PI) && player.y + (player.crouching ? 1.35 : 1.8) > AY + 1.5;
              if (lowHit || highHit) { hurt(44, S.x, S.z); knock(S.x, S.z, 12, 4); S.beamCd = 0.5; fx.burst(player.x, player.y + 1, player.z, 14, 10, 0.5, 1, 0.1, 0xffffff, lowHit ? 0xff5a3a : 0x7fd0ff, {}); }
            }
          }
        }
        yield 0;
      }
    } finally { b1.hide(); b2.hide(); if (lp) lp.stop(); }
    yield 0.2;
  }

  // ===== LONG RANGE =====
  function* cannon() {
    const beam = fx.beam(), core = fx.sprite(), glow = fx.sprite();
    let lp = null;
    try {
      S.lockLegs = true;
      pose({ lShX: 1.5, lShZ: 0.1, lElbX: 0, torsoY: -0.25, rShX: 0.5, rShZ: 0.6, torsoX: 0.15, hipY: -0.5 }, 6);
      const charge = S.phase >= 3 ? 1.7 : 2.2;
      sfx.charge(charge, vol(S.x, S.z));
      let m = anchor('lMuz'), tgx = player.x, tgz = player.z;
      const tl = fx.tele('rect', { x: m.x, z: m.z, dx: 0, dz: 1, len: 100, w: 6, dur: charge, col: 0xff2a2a });
      yield* during(charge, (p) => {
        face(p < 0.72 ? 2.5 : 0.2);
        const mm = anchor('lMuz'), mx = mm.x, my = mm.y, mz = mm.z;
        if (p < 0.72) { tgx = player.x; tgz = player.z; }
        const dx = tgx - mx, dz = tgz - mz, l = Math.hypot(dx, dz) || 1;
        tl.o.x = mx; tl.o.z = mz; tl.o.dx = dx / l; tl.o.dz = dz / l;
        core.set(mx, my, mz, 0.5 + p * 5, 0xffffff, 1); glow.set(mx, my, mz, 1.5 + p * 11, 0xff5a2a, 0.55);
        for (let i = 0; i < 4; i++) { const a = rnd(0, TAU), b = rnd(0, PI), r = rnd(6, 11); fx.add(mx + Math.cos(a) * Math.sin(b) * r, my + Math.cos(b) * r, mz + Math.sin(a) * Math.sin(b) * r, -Math.cos(a) * Math.sin(b) * r * 2, -Math.cos(b) * r * 2, -Math.sin(a) * Math.sin(b) * r * 2, 0.5, 0.9, 0.1, 0xffe0a0, 0xff3a1a, 1, 0, 0); }
        if (Math.random() < 0.3) fx.arc(mx, my, mz, mx + rnd(-5, 5), my + rnd(-5, 5), mz + rnd(-5, 5), 0xffd0a0, 0.15, 1.2);
        shake(0.012 + p * 0.03);
      });
      core.hide(); glow.hide();
      // FIRE
      let fireT = 0, fx0 = 0, trailT = 0;
      const dur = 1.7, track = S.phase >= 3 ? 13 : 9;
      sfx.boom(1.6, vol(S.x, S.z)); lp = sfx.loop();
      kickBoss(2.2); shake(1.0);
      ui.flash('#ffd7a0', 0.35, 0.3);
      yield* during(dur, (p, dt) => {
        fireT += dt;
        face(0.45);
        const mm = anchor('lMuz'), mx = mm.x, my = mm.y, mz = mm.z;
        const dx = player.x - tgx, dz = player.z - tgz, d = Math.hypot(dx, dz);
        if (d > 0.1) { const s = Math.min(d, track * dt); tgx += (dx / d) * s; tgz += (dz / d) * s; }
        // direction muzzle -> ground target, extended to the floor
        let vx = tgx - mx, vy = AY + 0.5 - my, vz = tgz - mz;
        const L0 = Math.hypot(vx, vy, vz) || 1; vx /= L0; vy /= L0; vz /= L0;
        const ex = mx + vx * 120, ey = my + vy * 120, ez = mz + vz * 120;
        const tF = vy < -0.001 ? clamp((AY - my) / vy, 0, 120) : 120, hx = mx + vx * tF, hy = my + vy * tF, hz = mz + vz * tF;
        const r = (p < 0.12 ? p / 0.12 : p > 0.86 ? (1 - p) / 0.14 : 1) * 2.1;
        beam.set(mx, my, mz, hx, hy, hz, r, 0xff5a2a, 1);
        if (lp) lp.set(0.9);
        fx.ball(hx, hy + 0.5, hz, 7 * (p < 0.5 ? 1 : 0.8), 0xffc080, 0.12);
        fx.burst(hx, AY + 0.5, hz, 5, 16, 0.6, 1.4, 0.1, 0xffffff, 0xff5a1a, { up: 1.2, grav: 12 });
        for (let i = 0; i < 2; i++) fx.dust(hx + rnd(-2, 2), AY + 0.5, hz + rnd(-2, 2), rnd(-10, 10), rnd(1, 5), rnd(-10, 10), 1.1, 1.5, 6, 0x6b5a55, 0x20202a, 0.5, 0, 1.5);
        for (let i = 0; i < 3; i++) { const t = rnd(0, 1), px = mx + (hx - mx) * t, py = my + (hy - my) * t, pz = mz + (hz - mz) * t; fx.add(px + rnd(-2, 2), py + rnd(-2, 2), pz + rnd(-2, 2), rnd(-3, 3), rnd(-3, 3), rnd(-3, 3), 0.4, 1.2, 0.1, 0xffffff, 0xff5a2a, 1, 0, 1); }
        trailT += dt;
        if (trailT > 0.12) { trailT = 0; zone(hx, hz, 3.2, { tick: 12, dur: 5, fire: true }); fx.decal(hx, hz, 3.4, 'scorch', 0x000000, 12); fx.decal(hx, hz, 3.2, 'glow', 0xff5a1a, 4); blast(hx, hz, 3, 70); }
        if ((fireT - fx0) > 0.28) { fx0 = fireT; wave(hx, hz, { v: 18, maxR: 12, dmg: 14, col: COL.fire }); shake(0.2, hx, hz); }
        fx.light(hx, AY + 4, hz, 0xff7a2a, 1800, 0.12);
        shake(0.03);
        if (player.alive && S.beamCd <= 0) {
          const px = player.x, py = player.y + 0.9, pz = player.z, ax = hx - mx, ay2 = hy - my, az = hz - mz, L2 = ax * ax + ay2 * ay2 + az * az;
          const t = clamp(((px - mx) * ax + (py - my) * ay2 + (pz - mz) * az) / L2, 0, 1);
          if (Math.hypot(px - (mx + ax * t), py - (my + ay2 * t), pz - (mz + az * t)) < r + 0.9) { hurt(26, mx, mz); knock(hx, hz, 7, 3); S.beamCd = 0.25; }
        }
      });
    } finally { beam.hide(); core.hide(); glow.hide(); if (lp) lp.stop(); }
    yield 0.3;
  }

  function* orbitalStrike() {
    S.lockLegs = true;
    pose({ rShX: 3.0, rShZ: 0.3, lShX: 0.5, torsoX: -0.35, headX: -0.7 }, 5);
    sfx.charge(1.0, vol(S.x, S.z));
    yield* during(1.0, () => handSparks('rFist', 3));
    const n = S.phase >= 3 ? 9 : 7;
    for (let i = 0; i < n; i++) {
      strike(player.x + player.vx * 0.45, player.z + player.vz * 0.45, 1.15);
      shake(0.08); yield 0.42;
    }
    const px = player.x, pz = player.z;
    for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU + PI / 4; strike(px + Math.cos(a) * 8, pz + Math.sin(a) * 8, 1.0); }
    strike(px, pz, 1.5);
    yield 2.0;
  }

  function* leapStrike() {
    S.lockLegs = true;
    pose({ hipY: -2.6, lLegX: 1.0, rLegX: 1.0, lKneeX: 1.8, rKneeX: 1.8, torsoX: 0.6, lShX: -0.6, rShX: -0.6, headX: 0.3 }, 5);
    sfx.charge(0.75, vol(S.x, S.z));
    yield* during(0.75, () => face(3));
    let tx = player.x + player.vx * 0.3, tz = player.z + player.vz * 0.3;
    const dd = Math.hypot(tx - AX, tz - AZ), lim = S.arenaR - 6;
    if (dd > lim) { tx = AX + ((tx - AX) / dd) * lim; tz = AZ + ((tz - AZ) / dd) * lim; }
    const sx = S.x, sz = S.z, dist = Math.hypot(tx - sx, tz - sz), Tm = 1.25 + dist / 60;
    fx.tele('disc', { x: tx, z: tz, r: 11, dur: Tm + 0.25, col: 0xff2a2a });
    turnTo(faceYaw(tx - sx, tz - sz), 20);
    pose({ hipY: 0.6, lLegX: -0.3, rLegX: -0.3, lKneeX: 0.8, rKneeX: 0.8, torsoX: -0.3, rShX: 3.0, lShX: 3.0 }, 22);
    S.grounded = false;
    impact(sx, sz, 1.3);
    wave(sx, sz, { v: 22, maxR: 20, dmg: 18, col: COL.fire });
    sfx.roar(vol(sx, sz));
    yield* during(Tm, (p) => {
      S.x = lerp(sx, tx, p); S.z = lerp(sz, tz, p); S.rootOff = 120 * p * (1 - p);
      S.yaw += clamp(angDiff(faceYaw(tx - S.x, tz - S.z), S.yaw), -6 * S.dt, 6 * S.dt);
      for (const n of ['lSole', 'rSole']) { const a = anchor(n); fx.add(a.x, a.y, a.z, rnd(-2, 2), rnd(-14, -6), rnd(-2, 2), 0.6, 2.2, 0.2, 0xffffff, 0xff5a1a, 1, 0, 0.5); fx.dust(a.x, a.y, a.z, rnd(-3, 3), rnd(-3, 0), rnd(-3, 3), 1.0, 2, 5, 0x6a4a40, 0x20202a, 0.4, 0, 1); }
      if (S.rootOff > 4) shake(0.01);
    });
    S.rootOff = 0; S.grounded = true; S.plant = 0;
    pose({ hipY: -1.5, lLegX: 0.6, rLegX: 0.6, lKneeX: 1.2, rKneeX: 1.2, rShX: 0.2, lShX: 0.2, torsoX: 0.5 }, 30);
    impact(tx, tz, 2.3);
    ui.flash('#ffe0b0', 0.4, 0.5);
    wave(tx, tz, { v: 22, maxR: 40, dmg: 30, col: COL.fire, wallH: 4 });
    later(0.35, () => wave(tx, tz, { v: 32, maxR: 44, dmg: 30, col: 0xffd0a0, wallH: 4 }));
    zone(tx, tz, 10.5, { dmg: 70, dur: 0.15, up: 11, kb: 20 });
    fx.decal(tx, tz, 11, 'glow', 0xff5a1a, 6);
    fx.debris(tx, AY + 1, tz, 24, 22, 22, 1.4, 0.3);
    blast(tx, tz, 12, 500);
    yield 1.6;
  }

  function* horizon() {
    const hole = { core: fx.sprite(false), glow: fx.sprite(), glow2: fx.sprite() };
    const cover = (px, pz) => {
      for (const p of arena.pillars) {
        if (!p.alive) continue;
        const ax = px - S.x, az = pz - S.z, L2 = ax * ax + az * az || 1, t = clamp(((p.x - S.x) * ax + (p.z - S.z) * az) / L2, 0, 1);
        if (t > 0.05 && t < 0.98 && Math.hypot(p.x - (S.x + ax * t), p.z - (S.z + az * t)) < 2.6) return true;
      }
      return false;
    };
    try {
      S.lockLegs = true;
      pose({ hipY: 0.5, rShZ: 1.2, lShZ: 1.2, rShX: 0.9, lShX: 0.9, torsoX: -0.3, headX: -0.5, plates: 0.4 }, 3);
      sfx.roar(vol(S.x, S.z));
      ui.card('EVENT HORIZON', 'HIDE BEHIND A PILLAR', 3);
      ui.hint('TAKE COVER BEHIND A PILLAR', 7);
      const bx = S.x, bz = S.z;
      yield* during(1.4, (p) => { S.rootOff = 6 * ease(p); shake(0.03); });
      sfx.swell(vol(bx, bz));
      const hy = () => AY + S.rootOff + 20;
      yield* during(1.6, (p) => { hole.core.set(bx, hy(), bz, 1 + p * 9, 0x05000a, 1); hole.glow.set(bx, hy(), bz, 2 + p * 20, 0xb070ff, 0.5); hole.glow2.set(bx, hy(), bz, 1 + p * 8, 0xffffff, 0.35); shake(0.03 + p * 0.03); });
      yield* during(4.2, (p, dt) => {
        hole.core.set(bx, hy(), bz, 10 + Math.sin(S.t * 12) * 0.4, 0x05000a, 1); hole.glow.set(bx, hy(), bz, 22 + Math.sin(S.t * 8), 0xb070ff, 0.55); hole.glow2.set(bx, hy(), bz, 9, 0xffffff, 0.3 + 0.3 * p);
        if (player.alive) { const dx = bx - player.x, dz = bz - player.z, d = Math.hypot(dx, dz); if (d > 4) { const a = 30 + 14 * p; S.imp.x += (dx / d) * a * dt; S.imp.z += (dz / d) * a * dt; } }
        for (let i = 0; i < 7; i++) { const a = rnd(0, TAU) + S.t * 2, r = rnd(10, 40), y = AY + rnd(1, 24); fx.add(bx + Math.cos(a) * r, y, bz + Math.sin(a) * r, -Math.sin(a) * 14 - Math.cos(a) * r * 0.8, (hy() - y) * 0.9, Math.cos(a) * 14 - Math.sin(a) * r * 0.8, 0.9, 1.4, 0.1, 0xe0c0ff, 0x5020c0, 1, 0, 0); }
        if (Math.random() < dt * 10) { const a = rnd(0, TAU), r = rnd(18, 38); fx.debris(bx + Math.cos(a) * r, AY + 1, bz + Math.sin(a) * r, 1, 0, 8, 1.0, 0.5); }
        if (Math.random() < dt * 9) fx.arc(bx, hy(), bz, bx + rnd(-30, 30), AY + 0.5, bz + rnd(-30, 30), 0xc8a0ff, 0.2, 3);
        shake(0.05 + 0.08 * p);
      });
      // collapse -> NOVA
      yield* during(0.45, (p) => { hole.core.set(bx, hy(), bz, 10 * (1 - p) + 0.5, 0x05000a, 1); hole.glow2.set(bx, hy(), bz, 9 + p * 20, 0xffffff, 0.6 + 0.4 * p); });
      hole.core.hide(); hole.glow.hide(); hole.glow2.hide();
      ui.flash('#ffffff', 0.9, 1.2);
      sfx.boom(2.2, 1); sfx.roar(1);
      fx.ball(bx, hy(), bz, 60, 0xffffff, 0.8); fx.ball(bx, hy(), bz, 90, COL.void, 1.1);
      fx.light(bx, hy(), bz, 0xffffff, 6000, 0.8);
      shake(1);
      const NV = 62; let r = 0, hitDone = false;
      const h = fx.wave(), h2 = fx.wave();
      try {
        yield* during(1.35, (p, dt) => {
          r += NV * dt;
          h.place(bx, AY + 0.1, bz, r, 4, 9, 1 - p * 0.6, 0xffffff); h2.place(bx, AY + 0.1, bz, r * 0.82, 6, 5, 0.7 - p * 0.5, COL.void);
          for (let i = 0; i < 8; i++) { const a = rnd(0, TAU); fx.add(bx + Math.cos(a) * r, AY + rnd(0.3, 6), bz + Math.sin(a) * r, Math.cos(a) * 6, rnd(2, 8), Math.sin(a) * 6, 0.5, 2, 0.2, 0xffffff, COL.void, 1, 6, 1); }
          if (!hitDone && player.alive && Math.hypot(player.x - bx, player.z - bz) <= r) {
            hitDone = true;
            if (cover(player.x, player.z)) ui.hint('SHIELDED BY THE PILLAR', 2);
            else { hurt(110, bx, bz); knock(bx, bz, 20, 7); }
          }
        });
      } finally { h.hide(); h2.hide(); }
      for (const p of arena.pillars) if (p.alive && Math.hypot(p.x - bx, p.z - bz) < 40) pillarHit(p, 900);
      // crash down
      yield* during(0.5, (p) => { S.rootOff = 6 * (1 - ease(p)); });
      S.rootOff = 0;
      impact(bx, bz, 2.0); ui.flash('#ffe0b0', 0.3, 0.5);
      wave(bx, bz, { v: 24, maxR: 30, dmg: 20, col: COL.void });
    } finally { hole.core.hide(); hole.glow.hide(); hole.glow2.hide(); S.rootOff = 0; }
    yield 0.4;
  }

  const ATK = [
    { id: 'fissure', f: fissure, min: 1, w: [3, 1, 0] },
    { id: 'cleave', f: cleave, min: 1, w: [3, 1, 0] },
    { id: 'grasp', f: grasp, min: 1, w: [2, 2, 0.3] },
    { id: 'stomp', f: stomp, min: 1, w: [2.5, 1, 0] },
    { id: 'spikes', f: spikeWave, min: 1, w: [0.5, 3, 1.5] },
    { id: 'shards', f: shards, min: 1, w: [0.5, 2.5, 3] },
    { id: 'meteor', f: meteors, min: 2, w: [1, 2.5, 2.5] },
    { id: 'sweep', f: cataclysm, min: 2, w: [1.5, 2, 1.5], vent: 6 },
    { id: 'cannon', f: cannon, min: 1, w: [0, 1.5, 4], vent: 6 },
    { id: 'orbital', f: orbitalStrike, min: 2, w: [0.5, 1.5, 3] },
    { id: 'leap', f: leapStrike, min: 1, w: [0, 1.2, 3.5] },
    { id: 'horizon', f: horizon, min: 3, w: [2, 2, 2], vent: 8, special: true },
  ];

  function chooseAttack() {
    const d = Math.hypot(player.x - S.x, player.z - S.z), band = d < 16 ? 0 : d < 32 ? 1 : 2;
    const list = ATK.filter((a) => a.min <= S.phase && !S.hist.slice(-2).includes(a.id) && !(a.vent && S.ventCd > 0) && !(a.special && S.specialCd > 0));
    if (S.phase >= 3 && S.specialCd <= 0) return ATK.find((a) => a.special);
    if (S.ventCd <= 0 && S.fightT > 20) { const v = list.filter((a) => a.vent && !a.special); if (v.length && Math.random() < 0.6) return v[(Math.random() * v.length) | 0]; }
    let tot = 0; const ws = list.map((a) => { const w = a.w[band] * (a.special ? 0 : 1); tot += w; return w; });
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
  function abort() { if (S.runner) { try { S.runner.gen.return(); } catch (_) {} S.runner = null; } S.later.length = 0; S.lockLegs = false; S.rootOff = 0; S.grounded = true; S.orbitSpin = 1; }
  function onAttackDone() {
    const a = S.atk; S.atk = null;
    rest(5);
    S.cd = S.phase === 1 ? rnd(1.4, 2.2) : S.phase === 2 ? rnd(1.0, 1.7) : rnd(0.6, 1.2);
    if (a && a.vent) { S.ventCd = 20; if (a.special) S.specialCd = 38; S.runner = { gen: vent(a.vent), wait: 0 }; }
  }
  function* vent(dur) {
    S.exposed = true; S.lockLegs = true;
    pose({ hipY: -2.3, lLegX: 0.9, rLegX: 0.9, lKneeX: 1.8, rKneeX: 1.8, torsoX: 0.5, headX: 0.4, plates: 1, lShX: 0.2, rShX: 0.2, eyes: 0.3, halo: 0.2 }, 4);
    sfx.thump(vol(S.x, S.z)); shake(0.3);
    ui.hint('CORE EXPOSED — SHOOT THE GLOWING CORE!', dur - 0.5);
    ui.flash('#ff9a40', 0.18, 0.5);
    const t0 = S.t;
    yield* during(dur, () => {
      const c = anchor('core'), x = c.x, y = c.y, z = c.z;
      for (let i = 0; i < 2; i++) fx.dust(x + rnd(-2, 2), y - 1, z + rnd(-2, 1), rnd(-2, 2), rnd(2, 6), rnd(-2, 2), 1.2, 1, 4, 0xddddee, 0x303040, 0.35, -1, 0.8);
      if (Math.random() < 0.25) fx.add(x, y, z - 1.5, rnd(-5, 5), rnd(0, 6), rnd(-6, 0), 0.5, 1, 0.1, 0xffffff, 0xff9a40, 1, 6, 1);
      if (Math.random() < 0.08) fx.arc(x, y, z, x + rnd(-4, 4), y + rnd(-3, 3), z + rnd(-4, 0), 0xffd0a0, 0.15, 0.8);
    });
    S.exposed = false;
    pose({ plates: 0, eyes: 1, halo: 1 }, 6);
    sfx.thump(vol(S.x, S.z));
    rest(4);
    yield 0.9;
    S.cd = 0.8;
  }

  // ===== PHASES, INTRO, DEATH =====
  function* transition(n) {
    S.state = 'transition'; S.invuln = true; S.exposed = false;
    S.rootOff = 0;
    pose({ torsoX: -0.55, headX: -0.8, rShZ: 1.3, lShZ: 1.3, rShX: 0.5, lShX: 0.5, plates: 0.6, hipY: -0.2 }, 5);
    rig.shield.visible = true;
    sfx.roar(1); shake(1);
    ui.flash('#ffffff', 0.6, 1.2);
    ui.card(n === 2 ? 'PHASE II' : 'PHASE III', n === 2 ? 'THE RIFT WIDENS' : 'THE SKY BURNS', 3.2);
    fx.ball(S.x, AY + 8, S.z, 40, COL.void, 0.8);
    for (let i = 0; i < 3; i++) later(i * 0.25, () => wave(S.x, S.z, { v: 24 + i * 6, maxR: 46, dmg: 12, col: i === 1 ? 0xffffff : COL.void, wallH: 4, clear: 0.7 }));
    fx.light(S.x, AY + 8, S.z, COL.void, 5000, 0.8);
    S.portalBoost = 1;
    arena.setPalette(n === 2 ? 0xff4fd8 : 0xff4a2a);
    rig.M.vein.color.setHex(n === 2 ? 0xff4fd8 : 0xff4a2a);
    yield 1.8;
    regrowPillars();
    for (let i = 0; i < 2; i++) orb('hp');
    orb('ammo');
    yield 1.4;
    S.phase = n; ui.setPhase(n);
    if (n === 3) S.arenaTarget = 36;
    rig.shield.visible = false; S.invuln = false;
    rest(5); pose({ plates: 0 }, 5);
    sfx.musicSet(n === 2 ? 0.5 : 1);
    S.cd = 1.0; S.state = 'fight';
  }

  function* intro() {
    S.state = 'intro'; S.frozen = true; S.invuln = true; S.alive = false;
    rig.root.visible = true; S.y = AY; S.rootOff = -16; S.grounded = false;
    pose({ hipY: -0.2, torsoX: -0.2, headX: 0.4 }, 4);
    ui.flash('#000000', 1, 1.6);
    const len = 8.2;
    S.cine = (t) => {
      if (t < 3.3) { const a = 0.5 + t * 0.11; return { p: _cp.set(AX + Math.cos(a) * 34, AY + 8 - t * 0.6, AZ + Math.sin(a) * 34), l: _v.set(AX, AY + 5 + t, AZ), w: 1, fov: 60 }; }
      if (t < 5.9) { const a = 2.2 + (t - 3.3) * 0.08; return { p: _cp.set(AX + Math.cos(a) * 22, AY + 3, AZ + Math.sin(a) * 22), l: _v.set(AX, AY + 6 + S.rootOff * 0.5 + 8, AZ), w: 1, fov: 70 }; }
      return { p: _cp.set(AX, AY + 18, AZ + 40), l: _v.set(AX, AY + 8, AZ), w: 1 - ease((t - 5.9) / (len - 5.9)), fov: 64 };
    };
    S.cineT = 0;
    sfx.swell(1);
    for (let i = 0; i < 14; i++) { const a = (i / 14) * TAU + rnd(-0.1, 0.1); fx.tele('rect', { x: AX, z: AZ, dx: Math.cos(a), dz: Math.sin(a), len: rnd(18, 36), w: 1.2, dur: 3.0, col: 0xa36bff }); }
    yield* during(2.6, (p) => { shake(0.03 + p * 0.05); fx.debris(AX + rnd(-6, 6), AY + 0.5, AZ + rnd(-6, 6), 1, 0, rnd(5, 12), 0.8, 0.5); for (let i = 0; i < 3; i++) fx.add(AX + rnd(-10, 10), AY + 0.3, AZ + rnd(-10, 10), 0, rnd(4, 12), 0, 1, 1.5, 0.1, 0xe0c0ff, 0x5020c0, 1, -1, 0); });
    fx.beamT(AX, AY, AZ, AX, AY + 220, AZ, 5, COL.void, 3.2);
    fx.light(AX, AY + 5, AZ, COL.void, 5000, 1.0); sfx.boom(1.6, 1);
    S.portalBoost = 1;
    yield 0.7;
    yield* during(2.2, (p) => {
      S.rootOff = -16 * (1 - outC(p));
      shake(0.05);
      for (let i = 0; i < 6; i++) { const a = rnd(0, TAU); fx.dust(AX + Math.cos(a) * 3, AY + 0.4, AZ + Math.sin(a) * 3, Math.cos(a) * rnd(4, 14), rnd(1, 6), Math.sin(a) * rnd(4, 14), 1.4, 2, 6, 0x6b5a55, 0x20202a, 0.5, -1, 1); }
    });
    S.rootOff = 0; S.grounded = true;
    impact(AX, AZ, 2.2, COL.void);
    wave(AX, AZ, { v: 28, maxR: 46, dmg: 0, col: COL.void, wallH: 4 });
    pose({ rShZ: 1.4, lShZ: 1.4, torsoX: -0.5, headX: -0.7, plates: 0.3 }, 6);
    sfx.roar(1);
    ui.card(BOSS.NAME, BOSS.SUB, 3.4);
    yield 1.6;
    rest(4);
    yield 1.0;
    S.cine = null; S.frozen = false; S.invuln = false; S.alive = true; S.state = 'fight'; S.cd = 1.2;
    targets.forEach((t) => { t.alive = true; });
    ui.hint('FIGHT.', 2);
  }

  function kill() {
    S.alive = false; S.hp = 0;
    targets.forEach((t) => { t.alive = false; });
    abort();
    clearHazards();
    S.exposed = false; S.invuln = true;
    S.runner = { gen: death(), wait: 0 };
  }
  function clearHazards() {
    for (const w of S.waves) w.h.hide(); S.waves.length = 0; S.zones.length = 0;
    for (const p of S.proj) { if (p.h) p.h.hide(); if (p.h2) p.h2.hide(); } S.proj.length = 0;
  }
  function* death() {
    S.state = 'dead';
    ui.setStatus('');
    S.cineT = 0;
    S.cine = (t) => { const a = 0.4 + t * 0.12; return { p: _cp.set(S.x + Math.cos(a) * 34, AY + 10 - Math.min(t, 4) * 0.8, S.z + Math.sin(a) * 34), l: _v.set(S.x, AY + 7, S.z), w: ease(t / 0.8), fov: 62 }; };
    pose({ torsoX: 0.45, headX: 0.5, hipY: -2.3, lLegX: 0.9, rLegX: 0.9, lKneeX: 1.8, rKneeX: 1.8, plates: 1, eyes: 0.1, halo: 0, rShX: 0.1, lShX: 0.1 }, 2);
    sfx.roar(1); ui.flash('#ffffff', 0.5, 1);
    arena.setPalette(0x7fd0ff);
    for (let i = 0; i < 24; i++) {
      later(i * 0.17, () => {
        const j = rig.hits[(Math.random() * rig.hits.length) | 0]; j.getWorldPosition(_w);
        const x = _w.x, y = _w.y, z = _w.z;
        fx.ball(x, y, z, rnd(5, 9), 0xffb060, 0.45); fx.burst(x, y, z, 24, 16, 0.9, 1.5, 0.2, 0xffffff, 0xff5a1a, { grav: 6 });
        fx.light(x, y, z, 0xff9a40, 2500, 0.25); sfx.boom(0.7, vol(x, z)); shake(0.18);
        fx.debris(x, y, z, 3, 10, 8, 0.9, 0.3);
      });
    }
    yield* during(4.4, (p) => { shake(0.04 + p * 0.06); const c = anchor('core'); fx.add(c.x, c.y, c.z - 1, rnd(-8, 8), rnd(2, 12), rnd(-8, 4), 0.8, 2, 0.1, 0xffffff, 0xff9a40, 1, 4, 1); });
    ui.flash('#ffffff', 1, 2.2);
    const c = anchor('core'), cx = c.x, cy = c.y, cz = c.z;
    rig.root.visible = false;
    fx.ball(cx, cy, cz, 70, 0xffffff, 1.0); fx.ball(cx, cy, cz, 110, 0xff9a40, 1.4);
    fx.beamT(S.x, AY, S.z, S.x, AY + 240, S.z, 7, 0xffffff, 2.6);
    fx.burst(cx, cy, cz, 140, 40, 1.8, 3, 0.2, 0xffffff, 0xff5a1a, { grav: 3 });
    fx.debris(S.x, AY + 8, S.z, 60, 26, 26, 2.2, 0.4);
    fx.light(cx, cy, cz, 0xffffff, 7000, 1.2);
    wave(S.x, S.z, { v: 40, maxR: 60, dmg: 0, col: 0xffffff, wallH: 6 });
    sfx.boom(2.4, 1); shake(1);
    S.portalBoost = -1;
    yield 2.6;
    arena.setPalette(0x7fd0ff);
    S.cine = null;
    S.result = 'win'; S.frozen = true;
    S.stats.deaths = S.deaths;
    ui.end(true, { time: S.stats.time, deaths: S.deaths, taken: S.stats.taken });
    ui.setStatus('');
    sfx.musicStop();
    if (document.pointerLockElement) document.exitPointerLock();
  }
  function lose() {
    if (S.result) return;
    abort(); clearHazards();
    S.result = 'lose'; S.frozen = true; S.invuln = true;
    pose({ rShZ: 1.3, lShZ: 1.3, torsoX: -0.4, headX: -0.6 }, 3);
    sfx.roar(1);
    ui.dead(false);
    ui.end(false, { time: S.stats.time, deaths: S.deaths, taken: S.stats.taken });
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
      if (n.done) { if (S.runner === r) { S.runner = null; if (S.state === 'fight') onAttackDone(); else if (S.state === 'intro') {} } return; }
      r.wait = Math.max(1e-4, +n.value || 0);
    }
  }
  function aiUpdate(dt) {
    if (S.state !== 'fight') return;
    S.fightT += dt; S.stats.time += dt;
    S.ventCd = Math.max(0, S.ventCd - dt); S.specialCd = Math.max(0, S.specialCd - dt); S.beamCd = Math.max(0, S.beamCd - dt);
    const f = S.hp / S.maxHp;
    if ((S.phase === 1 && f <= 0.66) || (S.phase === 2 && f <= 0.33)) { abort(); clearHazards(); S.runner = { gen: transition(S.phase + 1), wait: 0 }; return; }
    if (S.runner) { S.speedNow = 0; S.walkAmt += (0 - S.walkAmt) * Math.min(1, dt * 6); return; }
    const dx = player.x - S.x, dz = player.z - S.z, d = Math.hypot(dx, dz);
    if (player.alive) turnTo(faceYaw(dx, dz), T.TURN * (S.phase >= 3 ? 1.3 : 1));
    let sp = 0;
    if (d > 23) sp = T.WALK * (S.phase >= 3 ? 1.35 : 1); else if (d < 9) sp = -T.WALK * 0.55;
    if (!player.alive) sp = 0;
    S.speedNow = Math.abs(sp);
    if (sp) { const fw = fwd(); S.x = clamp(S.x + fw.x * sp * dt, AX - 30, AX + 30); S.z = clamp(S.z + fw.z * sp * dt, AZ - 30, AZ + 30); }
    S.walkAmt += ((sp ? 1 : 0) - S.walkAmt) * Math.min(1, dt * 5);
    S.cd -= dt;
    if (S.cd <= 0 && player.alive) startAttack();
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
  function updZones(dt) {
    for (let i = S.zones.length - 1; i >= 0; i--) {
      const z = S.zones[i]; z.t += dt;
      if (z.t > z.delay + z.dur) { S.zones.splice(i, 1); continue; }
      if (z.t < z.delay) continue;
      if (z.fire && Math.random() < dt * 25) { const a = rnd(0, TAU), r = Math.sqrt(Math.random()) * z.r; fx.add(z.x + Math.cos(a) * r, AY + 0.2, z.z + Math.sin(a) * r, rnd(-0.5, 0.5), rnd(3, 7), rnd(-0.5, 0.5), 0.8, 1.6, 0.2, 0xffd080, 0xff3a0a, 0.9, -2, 0.5); }
      if (!player.alive || Math.hypot(player.x - z.x, player.z - z.z) > z.r + 0.4) continue;
      if (z.tick) { z.acc += dt; if (z.acc > 0.3) { z.acc = 0; hurt(z.tick * 0.3, z.x, z.z); } }
      else if (!z.hit) { z.hit = true; hurt(z.dmg, z.x, z.z); if (z.kb) knock(z.x, z.z, z.kb, z.up); else if (z.up) { player.velY = Math.max(player.velY, z.up); player.onGround = false; } }
    }
  }
  function updProj(dt) {
    for (let i = S.proj.length - 1; i >= 0; i--) {
      const p = S.proj[i]; p.t += dt;
      let dead = false;
      if (p.k === 'cres') {
        const d = p.v * dt; p.x += p.f.x * d; p.z += p.f.z * d;
        const cx = p.x - p.f.x * p.R, cz = p.z - p.f.z * p.R, a = clamp(1 - p.t / p.life, 0, 1);
        p.h.place(cx, AY + 0.05, cz, p.f.x, p.f.z, p.R, 1.4, 0.4 + 0.6 * a, p.col);
        for (let k = 0; k < 2; k++) { const an = rnd(-0.6, 0.6), ba = Math.atan2(p.f.x, p.f.z) + an; fx.add(cx + Math.sin(ba) * p.R, AY + rnd(0.2, 1.4), cz + Math.cos(ba) * p.R, rnd(-1, 1), rnd(1, 4), rnd(-1, 1), 0.5, 1.3, 0.1, 0xffffff, 0xff5a2a, 1, 4, 1); }
        if (!p.hit && player.alive) {
          const rx = player.x - cx, rz = player.z - cz, dd = Math.hypot(rx, rz);
          if (Math.abs(dd - p.R) < 1.6 && Math.abs(angDiff(Math.atan2(rx, rz), Math.atan2(p.f.x, p.f.z))) < 0.62 && airH() < 0.75) { p.hit = true; hurt(p.dmg, cx, cz); knock(cx, cz, 12, 4); }
        }
        if (p.t > p.life) { p.h.hide(); dead = true; }
      } else if (p.k === 'shard') {
        if (p.t < 0.7 && player.alive) {
          const tx = player.x - p.x, ty = player.y + 1 - p.y, tz = player.z - p.z, l = Math.hypot(tx, ty, tz) || 1, sp = Math.hypot(p.vx, p.vy, p.vz) || 1, k = Math.min(1, 2.2 * dt);
          p.vx = lerp(p.vx, (tx / l) * sp, k); p.vy = lerp(p.vy, (ty / l) * sp, k); p.vz = lerp(p.vz, (tz / l) * sp, k);
        }
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        p.h.set(p.x, p.y, p.z, 2.4, COL.void, 1);
        fx.add(p.x, p.y, p.z, rnd(-1, 1), rnd(-1, 1), rnd(-1, 1), 0.45, 1.2, 0.1, 0xffffff, COL.void, 0.9, 0, 1);
        fx.add(p.x - p.vx * 0.03, p.y - p.vy * 0.03, p.z - p.vz * 0.03, 0, 0, 0, 0.3, 0.9, 0.1, 0xd8b0ff, 0x4018a0, 0.8, 0, 0);
        let boom = false;
        if (player.alive && Math.hypot(player.x - p.x, player.y + 0.9 - p.y, player.z - p.z) < 1.15) { hurt(16, p.x, p.z); knock(p.x, p.z, 5, 2); boom = true; }
        else if (p.y < AY + 0.25) boom = true;
        else for (const pl of arena.pillars) if (pl.alive && Math.hypot(pl.x - p.x, pl.z - p.z) < 2.3 && p.y < AY + 17) { pillarHit(pl, 160); boom = true; break; }
        if (boom || p.t > p.life) {
          fx.burst(p.x, Math.max(p.y, AY + 0.3), p.z, 18, 14, 0.6, 1.2, 0.1, 0xffffff, COL.void, { grav: 10 });
          fx.ball(p.x, Math.max(p.y, AY + 0.5), p.z, 3, COL.void, 0.25); fx.decal(p.x, p.z, 1.6, 'scorch', 0, 5);
          if (Math.random() < 0.5) sfx.shatter(vol(p.x, p.z) * 0.5);
          p.h.hide(); dead = true;
        }
      } else if (p.k === 'met') {
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        p.h.set(p.x, p.y, p.z, 7, 0xff6a1a, 0.9); p.h2.set(p.x, p.y, p.z, 3, 0xffffff, 1);
        for (let k = 0; k < 3; k++) { fx.add(p.x + rnd(-1, 1), p.y + rnd(-1, 1), p.z + rnd(-1, 1), -p.vx * 0.05 + rnd(-3, 3), -p.vy * 0.05 + rnd(-3, 3), -p.vz * 0.05 + rnd(-3, 3), 0.7, 3, 0.3, 0xffe0a0, 0xff3a0a, 0.9, 0, 1); }
        if (Math.random() < dt * 12) fx.dust(p.x, p.y, p.z, rnd(-2, 2), rnd(-2, 2), rnd(-2, 2), 1.5, 3, 8, 0x3a2a28, 0x101010, 0.5, 0, 1);
        if (p.t >= p.fall || p.y <= AY + 0.4) { p.h.hide(); p.h2.hide(); meteorHit(p.tx, p.tz); dead = true; }
      }
      if (dead) S.proj.splice(i, 1);
    }
  }
  function updOrbs(dt) {
    if (S.state === 'fight') { S.orbT -= dt; if (S.orbT <= 0 && S.orbs.length < 2) { S.orbT = 17; orb(S.orbN++ % 2 === 0 ? 'hp' : 'ammo'); } }
    for (let i = S.orbs.length - 1; i >= 0; i--) {
      const o = S.orbs[i]; o.t += dt;
      const col = o.kind === 'hp' ? 0x55ff99 : 0xffc247;
      o.h.set(o.x, AY + 1.5 + Math.sin(o.t * 3) * 0.3, o.z, 2.6 + Math.sin(o.t * 6) * 0.3, col, 0.95);
      if (Math.random() < dt * 20) fx.add(o.x + rnd(-0.5, 0.5), AY + 0.5, o.z + rnd(-0.5, 0.5), 0, rnd(2, 5), 0, 0.8, 0.6, 0.1, 0xffffff, col, 0.9, 0, 0.5);
      if (player.alive && Math.hypot(player.x - o.x, player.z - o.z) < 2.1 && Math.abs(player.y - AY) < 3) {
        if (o.kind === 'hp') { if (player.hp < player.maxHp) player.hp = Math.min(player.maxHp, player.hp + 45); } else ctrl.restock();
        audio.play('pouch');
        fx.burst(o.x, AY + 1.5, o.z, 20, 8, 0.6, 1, 0.1, 0xffffff, col, { grav: 0 });
        ui.hint(o.kind === 'hp' ? '+45 HEALTH' : 'AMMO RESTOCKED', 1.5);
        o.h.hide(); S.orbs.splice(i, 1);
      }
    }
  }
  function constrain(dt) {
    if (!player.alive || S.frozen) { S.imp.x = S.imp.z = 0; return; }
    const ix = S.imp.x * dt, iz = S.imp.z * dt;
    if (Math.abs(ix) + Math.abs(iz) > 1e-4) { const r = resolveCircle(player.x + ix, player.z + iz, player.radius, player.y, 1.8); player.x = r.x; player.z = r.z; }
    const k = Math.exp(-5 * dt); S.imp.x *= k; S.imp.z *= k;
    if (S.grounded && S.rootOff < 1) {
      const bx = player.x - S.x, bz = player.z - S.z, bd = Math.hypot(bx, bz), rad = 3.7;
      if (bd < rad && airH() < 9) { const s = bd > 1e-3 ? rad / bd : 1; player.x = S.x + (bd > 1e-3 ? bx * s : rad); player.z = S.z + (bd > 1e-3 ? bz * s : 0); }
    }
    const dx = player.x - AX, dz = player.z - AZ, d = Math.hypot(dx, dz), lim = S.arenaR - 0.7;
    if (d > lim) { player.x = AX + (dx / d) * lim; player.z = AZ + (dz / d) * lim; }
    if (player.y < AY - 8) { player.y = AY + 0.5; player.velY = 0; }
  }
  function trackPlayer() {
    if (player.deaths > S.lastDeaths) {
      S.lastDeaths = player.deaths; S.deaths++;
      const left = BOSS.LIVES - S.deaths;
      ui.setLives(left);
      if (left <= 0) lose(); else { S.dead = true; ui.dead(true, left); }
    }
    if (S.dead && player.alive) { S.dead = false; ui.dead(false); }
  }

  // ---------------- rig animation ----------------
  function applyPose(dt) {
    for (const key in REST) S.ch[key] += (S.tg[key] - S.ch[key]) * (1 - Math.exp(-(S.kk[key] || 6) * dt));
  }
  function applyRig(dt) {
    const c = S.ch, r = rig, t = S.t, M = r.M;
    const br = S.state === 'dead' ? 0 : Math.sin(t * 1.5);
    S.walk += dt * S.speedNow * 0.55;
    const sg = Math.sin(S.walk), wa = S.lockLegs ? 0 : S.walkAmt;
    r.hip.position.y = HIP + c.hipY - Math.abs(sg) * 0.25 * wa + br * 0.04;
    r.torso.rotation.set(-c.torsoX + br * 0.015, c.torsoY + sg * 0.08 * wa, c.torsoZ);
    r.neck.rotation.set(c.headX, c.headY, 0);
    r.arms.l.sh.rotation.set(c.lShX + sg * 0.25 * wa, 0, -c.lShZ - br * 0.01); r.arms.r.sh.rotation.set(c.rShX - sg * 0.25 * wa, 0, c.rShZ + br * 0.01);
    r.arms.l.el.rotation.x = c.lElbX; r.arms.r.el.rotation.x = c.rElbX;
    r.J.lTh.rotation.x = c.lLegX + sg * 0.6 * wa; r.J.rTh.rotation.x = c.rLegX - sg * 0.6 * wa;
    r.J.lKn.rotation.x = -(c.lKneeX + Math.max(0, Math.sin(S.walk + 1.2)) * 0.9 * wa); r.J.rKn.rotation.x = -(c.rKneeX + Math.max(0, Math.sin(S.walk + PI + 1.2)) * 0.9 * wa);
    r.plates[0].rotation.y = c.plates * 1.9; r.plates[1].rotation.y = -c.plates * 1.9;
    r.coreMesh.scale.setScalar(c.coreS * (1 + Math.sin(t * 6) * 0.05 * (S.exposed ? 3 : 1)));
    M.core.color.setHex(S.exposed ? (Math.sin(t * 18) > 0 ? 0xfff2d0 : 0xffc070) : 0xffa347);
    M.eye.color.setRGB(c.eyes, 0.24 * c.eyes, 0.43 * c.eyes);
    r.halo.rotation.z += dt * c.halo * 1.2; r.coreRing.rotation.z -= dt * 1.5;
    r.orbit.rotation.z += dt * S.orbitSpin * 0.6;
    r.muzGlow.scale.setScalar(1 + (S.runner && S.atk && S.atk.id === 'cannon' ? 0.5 + Math.sin(t * 30) * 0.2 : 0));
    M.shield.opacity = r.shield.visible ? 0.16 + 0.1 * Math.sin(t * 9) : 0;
    r.shield.rotation.y += dt * 0.5;
    S.hitFlash = Math.max(0, S.hitFlash - dt * 6);
    M.armor.emissiveIntensity = M.trim.emissiveIntensity = S.hitFlash * 0.7;
    r.root.position.set(S.x, S.y + S.rootOff, S.z); r.root.rotation.y = S.yaw;
    r.root.updateMatrixWorld(true);
    if (S.grounded) {
      r.A.lSole.getWorldPosition(_w); const a = _w.y; r.A.rSole.getWorldPosition(_w);
      const corr = S.y + S.rootOff - Math.min(a, _w.y);
      S.plant += (corr - S.plant) * Math.min(1, dt * 14);
      r.root.position.y = S.y + S.rootOff + S.plant; r.root.updateMatrixWorld(true);
    }
    // foot-fall: dust, thump and a shake on each step
    const sign = sg >= 0 ? 1 : -1;
    if (sign !== S.stepSign) {
      S.stepSign = sign;
      if (S.walkAmt > 0.5 && S.grounded) {
        const a = anchor(sign > 0 ? 'rSole' : 'lSole');
        fx.dust(a.x, a.y + 0.2, a.z, 0, 0, 0, 0.1, 0.1, 0.1, 0, 0, 0); // keeps ring buffer warm; cheap
        for (let i = 0; i < 8; i++) { const an = rnd(0, TAU); fx.dust(a.x, a.y + 0.3, a.z, Math.cos(an) * rnd(3, 8), rnd(0.5, 2), Math.sin(an) * rnd(3, 8), 1, 1.5, 4, 0x6b5a55, 0x20202a, 0.5, 0, 1.5); }
        sfx.thump(vol(a.x, a.z) * 0.7); shake(0.08, a.x, a.z);
      }
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
        _look.position.copy(c.p); _look.lookAt(c.l); _look.updateMatrixWorld();
        camera.position.lerp(c.p, c.w);
        _cq.copy(camera.quaternion).slerp(_look.quaternion, c.w); camera.quaternion.copy(_cq);
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
    // portal glow pulses with boss events
    if (S.portalBoost) { S.pb = clamp((S.pb || 0.55) + S.portalBoost * dt * 0.8, 0, 1.6); if ((S.portalBoost > 0 && S.pb >= 1.5) || (S.portalBoost < 0 && S.pb <= 0.1)) { if (S.portalBoost > 0) S.portalBoost = -0.4; else S.portalBoost = 0; } arena.portalMat.opacity = S.pb; }
    // arena shrink (phase 3)
    if (S.arenaTarget && S.arenaR > S.arenaTarget) { S.arenaR = Math.max(S.arenaTarget, S.arenaR - dt * 1.2); arena.corr.scale.setScalar(S.arenaR); }
    if (S.arenaR < R0 - 0.5 && Math.random() < dt * 40) { const a = rnd(0, TAU); fx.add(AX + Math.cos(a) * (S.arenaR + 1), AY + 0.3, AZ + Math.sin(a) * (S.arenaR + 1), 0, rnd(3, 8), 0, 0.9, 1.6, 0.2, 0xffd080, 0xff3a0a, 0.9, -1, 0.3); }
    if (Math.random() < dt * 0.35) { const a = rnd(0, TAU); fx.arc(AX + Math.cos(a) * 120, AY + 150, AZ + Math.sin(a) * 120, AX + rnd(-60, 60), AY + rnd(-20, 40), AZ + rnd(-60, 60), 0xc8a0ff, 0.3, 6); }
    // core light
    const c = anchor('core'); fx.light(c.x, c.y, c.z - 2, S.exposed ? 0xffc070 : S.phase >= 3 ? 0xff4a2a : 0xa36bff, S.exposed ? 900 : 380, 0.1);
  }

  // ---------------- lifecycle ----------------
  function enterEnv() {
    saved = {
      fogColor: scene.fog ? scene.fog.color.getHex() : 0, fogNear: scene.fog ? scene.fog.near : 0, fogFar: scene.fog ? scene.fog.far : 0,
      bg: scene.background, envI: scene.environmentIntensity, sunI: world.sun.intensity, sunC: world.sun.color.getHex(), exp: renderer.toneMappingExposure,
    };
    if (scene.fog) { scene.fog.color.setHex(0x150b22); scene.fog.near = 40; scene.fog.far = 260; }
    scene.background = new THREE.Color(0x07040c);
    scene.environmentIntensity = 0.3;
    world.sun.intensity = 1.7; world.sun.color.setHex(0xc8b8ff);
    renderer.toneMappingExposure = 0.8;
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
    arena.setPalette(0xa36bff);
    rig.M.vein.color.setHex(0xa36bff);
    for (const p of arena.pillars) { p.alive = true; p.hp = p.max; p.g.visible = true; p.g.scale.y = 1; p.grow = 1; }
    arena.corr.scale.setScalar(R0);
    arena.portalMat.opacity = 0.55; S.pb = 0.55; S.portalBoost = 0;
    floorCol = addCollider(AX, AZ, R0 * 2 + 4, AY, R0 * 2 + 4, { y0: AY - 3, noCover: true });
    for (const p of arena.pillars) p.col = addCollider(p.x, p.z, 3.4, AY + 17, 3.4, { y0: AY - 2 });
    savedSpawns = SPAWNS.player.slice();
    SPAWNS.player.length = 0;
    SPAWNS.player.push({ x: AX, z: AZ + R0 - 8, y: AY, yaw: 0 });
    enterEnv();
    fx.clear(); fx.setFloor(AY);
    targets.forEach((t) => { t.alive = false; });
    S.x = AX; S.z = AZ; S.y = AY; S.yaw = 0;
    rig.root.visible = false; rig.shield.visible = false;
    ui.show(); ui.hideEnd(); ui.dead(false); ui.setHp(1); ui.setPhase(1); ui.setLives(BOSS.LIVES); ui.setStatus('');
    ctrl.respawnAt({ x: AX, z: AZ + R0 - 8, y: AY, yaw: 0 });
    S.lastDeaths = player.deaths;
    sfx.musicStart(BOSS.MUSIC); sfx.musicSet(0.2);
    S.runner = { gen: intro(), wait: 0 };
  }
  function stop() {
    if (!built) return;
    const was = S.on;
    abort();
    S.on = false; S.frozen = false;
    if (loopBeam) { loopBeam.stop(); loopBeam = null; }
    if (was) {
      if (floorCol) { removeCollider(floorCol); floorCol = null; }
      for (const p of arena.pillars) if (p.col) { removeCollider(p.col); p.col = null; }
      if (savedSpawns) { SPAWNS.player.length = 0; for (const s of savedSpawns) SPAWNS.player.push(s); savedSpawns = null; }
      clearHazards(); for (const o of S.orbs) o.h.hide(); S.orbs.length = 0;
      fx.clear(); exitEnv();
      rig.root.visible = false;
      ui.hide(); sfx.musicStop();
      viewmodel.visible = false;
      targets.forEach((t) => { t.alive = false; });
    }
  }
  function retry() { const r = onExit; stop(); start(); void r; }

  function update(dt) {
    if (!S.on) return;
    S.dt = dt; S.t += dt;
    trackPlayer();
    for (let i = S.later.length - 1; i >= 0; i--) { const l = S.later[i]; l.t -= dt; if (l.t <= 0) { S.later.splice(i, 1); l.fn(); } }
    tickRunner(dt);
    aiUpdate(dt);
    applyPose(dt);
    updWaves(dt); updZones(dt); updProj(dt); updOrbs(dt);
    constrain(dt);
    applyRig(dt); syncTargets();
    envUpdate(dt);
    arena.update(S.t, dt, camera);
    fx.update(dt);
    cameraFx(dt);
    ui.setHp(S.hp / S.maxHp); ui.tick(dt);
    ui.setStatus(S.invuln && S.state !== 'intro' ? 'SHIELDED' : S.exposed ? 'CORE EXPOSED' : '', S.exposed);
    sfx.musicSet(S.phase === 1 ? 0.2 : S.phase === 2 ? 0.55 : 1);
  }

  return {
    start, stop, update, targets,
    get frozen() { return S.on && S.frozen; },
    get active() { return S.on; },
  };
}
