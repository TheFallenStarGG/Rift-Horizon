import * as THREE from 'three';
import { heightAt } from './ground.js';
import { POIS } from './mapLayout.js';
import { nearby } from './collision.js';
import { ALL, reloadDuration } from './arsenal.js';
import { updateHumanoidAnim, triggerShootKick, triggerMelee, ensureWeapon, equipNow, LOD } from './anim.js';
import { VEHICLE_TYPES } from './vehicles.js';
import { settings } from './settings.js';

// ===================== config =====================
const TITLE = 'RIFT HORIZON';
const TAGLINE = 'COMING SOON';
const END = 84;
const SCRIPT_URL = './assets/trailer/script.json';
const VO_DIR = './assets/trailer/vo/';
const HITS = [6.5, 15, 23, 32.5, 38.5, 42, 51.5, 57.5, 67.5, 76]; // score hits + screen flashes
const CARDS = [
  { t0: 52.3, t1: 54.4, text: 'EVERY WEAPON.' },
  { t0: 58.0, t1: 60.2, text: 'EVERY VEHICLE.' },
  { t0: 64.9, t1: 67.2, text: 'EVERY SECOND.' },
  { t0: 77.3, t1: 83.4, text: TITLE, sub: TAGLINE, big: true },
];
// quality while the trailer plays (restored afterwards)
const BEST = {
  godRays: true, ao: true, bloom: true, grade: true, viewDist: 500, shadows: 3, detail: 3, propScale: 1,
  renderScale: 1, maxDpr: 1.5, cheapMats: false, muzzleLights: true, debris: true, autoPerf: false,
  charCull: 0, animLod: false, simpleVm: false,
};

// ===================== helpers =====================
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const sst = (x) => { x = clamp(x); return x * x * (3 - 2 * x); };
const gy = (x, z) => heightAt(x, z);
function rng(seed) {
  let a = seed >>> 0;
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function slope(x, z) { const e = 2; return Math.hypot(gy(x + e, z) - gy(x - e, z), gy(x, z + e) - gy(x, z - e)) / (2 * e); }
function findStage(R, cx, cz, rMin, rMax, clear) {
  for (let i = 0; i < 160; i++) {
    const a = R() * 6.283, r = rMin + R() * (rMax - rMin), x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    if (slope(x, z) < 0.09 && nearby(x, z, clear).length === 0) return { x, z };
  }
  return { x: cx + rMax, z: cz };
}
/** local frame on a stage: f = forward, r = right, h = height above ground */
function frame(S, hd) {
  const fx = Math.sin(hd), fz = Math.cos(hd);
  return {
    S, hd, fx, fz,
    pt: (f, r = 0, h = 0) => { const x = S.x + fx * f + fz * r, z = S.z + fz * f - fx * r; return V3(x, gy(x, z) + h, z); },
  };
}
const facing = (fr) => Math.atan2(-fr.fx, -fr.fz);
const orb = (c, ang, rad, h) => V3(c.x + Math.sin(ang) * rad, c.y + h, c.z + Math.cos(ang) * rad);
const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _n = new THREE.Vector3(), _t = new THREE.Vector3();

// ===================== particles / explosions =====================
function makeFx(scene, tex) {
  const pool = (n, blend) => Array.from({ length: n }, () => {
    const m = new THREE.SpriteMaterial({ map: tex.glow, transparent: true, depthWrite: false, blending: blend, opacity: 0 });
    const s = new THREE.Sprite(m); s.visible = false; scene.add(s);
    return { s, m, life: 0, max: 1, v: new THREE.Vector3(), s0: 1, s1: 2, o: 1, g: 0, drag: 1 };
  });
  const fire = pool(56, THREE.AdditiveBlending), smoke = pool(72, THREE.NormalBlending), spark = pool(90, THREE.AdditiveBlending);
  let fi = 0, si = 0, pi = 0, flash = 0, ringT = 0, ringS = 1;
  const light = new THREE.PointLight(0xffa050, 0, 90, 2); scene.add(light);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.85, 1, 56),
    new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2; ring.visible = false; scene.add(ring);
  const rnd = (a, b) => a + Math.random() * (b - a);
  const emit = (arr, i, x, y, z, vx, vy, vz, s0, s1, life, o, color, g, drag) => {
    const p = arr[i % arr.length];
    p.s.visible = true; p.s.position.set(x, y, z); p.v.set(vx, vy, vz);
    p.s0 = s0; p.s1 = s1; p.max = p.life = life; p.o = o; p.g = g; p.drag = drag; p.m.color.setHex(color);
  };
  return {
    blast(x, y, z, sc = 1) {
      flash = 1; light.position.set(x, y + 2, z);
      for (let i = 0; i < 24; i++) emit(fire, fi++, x + rnd(-1, 1) * sc, y + rnd(0.2, 1.4) * sc, z + rnd(-1, 1) * sc, rnd(-6, 6) * sc, rnd(1, 9) * sc, rnd(-6, 6) * sc, 1.6 * sc, 5.5 * sc, rnd(0.5, 1.2), 0.95, i % 3 ? 0xff7a1a : 0xffd070, -1.5, 1.6);
      for (let i = 0; i < 30; i++) emit(smoke, si++, x + rnd(-1.5, 1.5) * sc, y + rnd(0.5, 2) * sc, z + rnd(-1.5, 1.5) * sc, rnd(-3, 3) * sc, rnd(1, 6) * sc, rnd(-3, 3) * sc, 1.6 * sc, 6.5 * sc, rnd(1.8, 3.6), 0.7, 0x222222, -0.4, 0.8);
      for (let i = 0; i < 40; i++) emit(spark, pi++, x, y + 1, z, rnd(-14, 14) * sc, rnd(2, 18) * sc, rnd(-14, 14) * sc, 0.3, 0.02, rnd(0.6, 1.4), 1, 0xffd27a, 14, 0.4);
      ringT = 1; ringS = sc; ring.position.set(x, y + 0.3, z); ring.visible = true;
    },
    dust(x, y, z, sc = 1) { emit(smoke, si++, x, y, z, rnd(-0.6, 0.6), rnd(0.4, 1.2), rnd(-0.6, 0.6), 0.5 * sc, 2.4 * sc, rnd(0.7, 1.2), 0.35, 0xb59f7a, -0.2, 1.2); },
    update(dt) {
      for (const arr of [fire, smoke, spark]) {
        for (const p of arr) {
          if (p.life <= 0) continue;
          p.life -= dt;
          if (p.life <= 0) { p.s.visible = false; continue; }
          const k = 1 - p.life / p.max;
          p.v.y -= p.g * dt; p.v.multiplyScalar(Math.max(0, 1 - p.drag * dt));
          p.s.position.addScaledVector(p.v, dt);
          const z = lerp(p.s0, p.s1, k); p.s.scale.set(z, z, 1);
          p.m.opacity = p.o * Math.pow(1 - k, 1.4);
        }
      }
      flash = Math.max(0, flash - dt * 2.2); light.intensity = flash * 1400;
      if (ringT > 0) {
        ringT = Math.max(0, ringT - dt * 1.6);
        const s = 1 + (1 - ringT) * 18 * ringS; ring.scale.set(s, s, s); ring.material.opacity = ringT * 0.7;
        if (ringT === 0) ring.visible = false;
      }
    },
  };
}

// ===================== score + voice-over (WebAudio, routed through the game's master bus) =====================
function buildAudio(c, out, lines) {
  const bus = c.createGain(); bus.connect(out);
  const mg = c.createGain(); mg.gain.value = 0.85; mg.connect(bus);
  const conv = c.createConvolver();
  { const n = Math.floor(c.sampleRate * 2.6), ir = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.8); }
    conv.buffer = ir; }
  const rv = c.createGain(); rv.gain.value = 0.55; rv.connect(conv); conv.connect(mg);
  const nb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
  { const d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const t0 = c.currentTime + 0.35, at = (t) => t0 + t;
  const route = (node, wet) => { node.connect(mg); if (wet > 0) { const w = c.createGain(); w.gain.value = wet; node.connect(w); w.connect(rv); } };

  function tone({ type = 'sawtooth', f, f2, t, a = 0.01, d = 0.3, g = 0.2, lp = 0, det = 0, wet = 0.2 }) {
    const osc = c.createOscillator(); osc.type = type; osc.detune.value = det;
    osc.frequency.setValueAtTime(f, at(t));
    if (f2) osc.frequency.exponentialRampToValueAtTime(f2, at(t) + a + d);
    const e = c.createGain();
    e.gain.setValueAtTime(0.0001, at(t)); e.gain.linearRampToValueAtTime(g, at(t) + a); e.gain.exponentialRampToValueAtTime(0.0001, at(t) + a + d);
    let n = osc;
    if (lp) { const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = lp; osc.connect(fl); n = fl; }
    n.connect(e); route(e, wet); osc.start(at(t)); osc.stop(at(t) + a + d + 0.1);
  }
  function noise({ t, d = 0.3, g = 0.3, type = 'lowpass', f = 800, f2 = 0, q = 0.7, wet = 0.2, a = 0.002 }) {
    const s = c.createBufferSource(); s.buffer = nb; s.loop = true;
    const fl = c.createBiquadFilter(); fl.type = type; fl.Q.value = q; fl.frequency.setValueAtTime(f, at(t));
    if (f2) fl.frequency.exponentialRampToValueAtTime(Math.max(20, f2), at(t) + a + d);
    const e = c.createGain();
    e.gain.setValueAtTime(0.0001, at(t)); e.gain.exponentialRampToValueAtTime(Math.max(g, 0.0002), at(t) + a); e.gain.exponentialRampToValueAtTime(0.0001, at(t) + a + d);
    s.connect(fl); fl.connect(e); route(e, wet); s.start(at(t), Math.random() * 1.5); s.stop(at(t) + a + d + 0.1);
  }
  const boom = (t, p = 1) => {
    tone({ type: 'sine', f: 95, f2: 28, t, a: 0.004, d: 1.7, g: 0.95 * p, wet: 0.45 });
    noise({ t, d: 1.8, g: 0.8 * p, f: 1400, f2: 60, wet: 0.55 });
    tone({ type: 'triangle', f: 55, t, a: 0.01, d: 2.4, g: 0.45 * p, wet: 0.4 });
  };
  const kick = (t, g = 0.55) => tone({ type: 'sine', f: 150, f2: 44, t, a: 0.002, d: 0.22, g, wet: 0.05 });
  const snare = (t, g = 0.35) => { noise({ t, d: 0.2, g, type: 'bandpass', f: 1900, q: 0.8, wet: 0.35 }); tone({ type: 'triangle', f: 210, f2: 140, t, a: 0.002, d: 0.1, g: g * 0.6, wet: 0.2 }); };
  const hat = (t, g = 0.07) => noise({ t, d: 0.05, g, type: 'highpass', f: 7000, wet: 0.02 });
  const riser = (t, dur, g = 0.3) => {
    noise({ t, d: dur * 0.1, a: dur * 0.9, g, type: 'bandpass', f: 300, f2: 9000, q: 1.2, wet: 0.3 });
    tone({ type: 'sawtooth', f: 90, f2: 1400, t, a: dur * 0.9, d: dur * 0.1, g: g * 0.35, lp: 3000, wet: 0.3 });
  };
  const stab = (t, notes, d, g) => notes.forEach((f) => {
    for (const det of [-9, 0, 9]) tone({ type: 'sawtooth', f, t, a: 0.03, d, g, lp: 1500, det, wet: 0.5 });
    tone({ type: 'sawtooth', f: f * 2, t, a: 0.05, d, g: g * 0.5, lp: 2600, wet: 0.5 });
  });
  const beat = (t) => { tone({ type: 'sine', f: 58, f2: 40, t, d: 0.18, g: 0.8, wet: 0.1 }); tone({ type: 'sine', f: 58, f2: 40, t: t + 0.18, d: 0.18, g: 0.55, wet: 0.1 }); };

  const CH = { Dm: [146.8, 174.6, 220], Bb: [116.5, 146.8, 174.6], Gm: [98, 116.5, 146.8], A: [110, 138.6, 164.8] };
  const prog = [[6.5, 'Dm', 73.4], [15, 'Bb', 58.3], [23, 'Gm', 49], [32.5, 'A', 55], [38.5, 'Dm', 73.4], [42, 'Bb', 58.3], [51.5, 'Gm', 49], [57.5, 'A', 55]];
  const rootAt = (t) => { let r = prog[0]; for (const p of prog) if (t >= p[0]) r = p; return r; };

  // intro: drone + riser into the first hit
  tone({ f: 36.7, t: 0, a: 5, d: 1.4, g: 0.3, lp: 140, wet: 0.3 });
  tone({ f: 55, t: 0, a: 5, d: 1.4, g: 0.18, lp: 200, wet: 0.3 });
  riser(1.8, 4.6, 0.32);
  // hits
  for (const h of HITS) {
    boom(h, h === 76 ? 1.4 : 1);
    const p = prog.find((x) => x[0] === h);
    if (p) stab(h, CH[p[1]], 2.6, 0.05);
    if (h > 10 && h < 60) riser(h - 2.2, 2.2, 0.26);
  }
  // pulse (8ths, then 16ths from the wide firefight)
  const PAT = [0, 0, 7, 0, 3, 0, 7, 12];
  for (let t = 6.5, k = 0; t < 64.4; t += t < 32.5 ? 0.25 : 0.125, k++) {
    const r = rootAt(t), k01 = (t - 6.5) / 58;
    tone({ f: r[2] * Math.pow(2, PAT[k % 8] / 12), t, a: 0.005, d: t < 32.5 ? 0.22 : 0.1, g: 0.05 + 0.1 * k01, lp: 350 + 2200 * k01, wet: 0.12 });
  }
  for (let t = 15; t < 64.4; t += 0.5) kick(t);
  for (let t = 23.5; t < 64.4; t += 1) snare(t);
  for (let t = 32.5; t < 64.4; t += 0.25) hat(t);
  // silence beat: heartbeat
  [64.8, 65.85, 66.9].forEach(beat);
  // finale
  stab(67.5, [...CH.Dm, 293.7], 3.2, 0.06);
  for (let t = 67.5, k = 0; t < 75.7; t += 0.125, k++) tone({ f: 73.4 * Math.pow(2, PAT[k % 8] / 12), t, a: 0.004, d: 0.1, g: 0.17, lp: 3000, wet: 0.12 });
  for (let t = 67.5; t < 75.7; t += 0.5) kick(t, 0.65);
  for (let t = 68; t < 75.7; t += 1) snare(t, 0.4);
  riser(73.4, 2.6, 0.38);
  tone({ f: 36.7, t: 76, a: 0.5, d: 7, g: 0.35, lp: 160, wet: 0.4 });
  stab(76.6, [293.7, 349.2, 440], 6, 0.035);

  // voice-over (+ music ducking)
  const voSrc = [];
  for (const l of [...lines].sort((a, b) => a.at - b.at)) {
    if (!l.buf) continue;
    const s = c.createBufferSource(); s.buffer = l.buf;
    const g = c.createGain(); g.gain.value = l.gain != null ? l.gain : 1;
    let n = s;
    if (l.voice === 'radio') {
      const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 480;
      const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3400;
      s.connect(hp); hp.connect(lp); n = lp;
    }
    n.connect(g); g.connect(bus); s.start(at(l.at)); voSrc.push(s);
    mg.gain.setTargetAtTime(0.42, at(l.at) - 0.12, 0.06);
    mg.gain.setTargetAtTime(0.85, at(l.at) + l.buf.duration + 0.1, 0.3);
  }
  return {
    stop() {
      try { bus.gain.setTargetAtTime(0, c.currentTime, 0.05); } catch (_) {}
      voSrc.forEach((s) => { try { s.stop(); } catch (_) {} });
      setTimeout(() => { try { bus.disconnect(); } catch (_) {} }, 400);
    },
  };
}

function overlayAt(t) { // [colour, alpha] of the full-screen fade
  if (t < 0) return ['#000', 1];
  if (t < 1.8) return ['#000', 1 - sst(t / 1.8)];
  if (t >= 64.2 && t < 64.5) return ['#000', sst((t - 64.2) / 0.3)];
  if (t >= 64.5 && t < 67.45) return ['#000', 1];
  if (t >= 74.9 && t < 76) return ['#fff', sst((t - 74.9) / 1.1)];
  if (t >= 76) return ['#000', 1];
  return ['#000', 0];
}

// ===================== director =====================
export function createTrailer(o) {
  const { scene, camera, tex, audio, bullets, vehicles, world, gfx, makeHumanoid, playerMesh, viewmodel } = o;
  const R = rng(20261112);
  const fx = makeFx(scene, tex);
  const actors = [], A = [], B = [], cars = {}, later = [];
  let active = false, ready = false, T = 0, gs = 0, shotIdx = -1, shake = 0, hitIdx = 0;
  let stages = null, shots = [], saved = null, ui = null, music = null, vo = [];
  const cam = { p: new THREE.Vector3(), l: new THREE.Vector3(), fov: 40, roll: 0 };
  const fakePlayer = { x: 0, y: 0, z: 0, alive: false, hp: 100, inVehicle: false };
  const W = (id) => (ALL[id] ? id : 'vanguard');
  const sfx = (n, v = 1, x = {}) => { try { audio.play(n, null, null, Object.assign({ vol: v }, x)); } catch (_) {} };
  const delay = (sec, fn) => later.push({ t: gs + sec, fn });

  // ---------- actors ----------
  function makeActor(kind, hostile) {
    const mesh = makeHumanoid(tex, kind); mesh.visible = false; scene.add(mesh);
    const a = { mesh, ud: mesh.userData, x: 0, z: 0, yaw: 0, px: 0, pz: 0, speed: 0, hostile, weapon: 'vanguard', flashes: {} };
    resetActor(a); actors.push(a); return a;
  }
  function resetActor(a) {
    a.dead = false; a.rl = false; a.rlT = 0; a.ads = false; a.crouch = false; a.init = false; a.speed = 0;
    a.fy = null; a.bal = null; a.pitch = 0; a.nf = 0; a.cut = -1; a.mesh.rotation.set(0, a.yaw, 0);
  }
  const place = (a, p, yaw) => { if (a.dead) return; a.x = p.x; a.z = p.z; a.yaw = yaw; };
  const chest = (a) => V3(a.x, (a.fy == null ? gy(a.x, a.z) : a.fy) + 1.25, a.z);
  function show(list) { for (const a of actors) { const on = list.includes(a); a.mesh.visible = on; if (on) resetActor(a); } }
  function kit(list, ids) { show(list); list.forEach((a, i) => { a.weapon = W(ids[i % ids.length]); equipNow(a.ud, a.weapon); a.nf = R() * 0.3; }); }
  function actorEvent(a, n, info) {
    if (n === 'toss' && info) bullets.dropMag(info.pos, _n.set(-1.5, 1, 0.3));
    else if (n === 'eject' && info) bullets.ejectShell(info.pos, _n.set(1.2, 1.2, 0));
    else if (n === 'swing' || n === 'meleeHit') return;
    else sfx(n, 0.7);
  }
  function tickActor(a, dt) {
    if (!a.mesh.visible) return;
    if (a.bal) {
      const b = a.bal; a.x += b.vx * dt; a.z += b.vz * dt;
      a.fy = (a.fy == null ? gy(a.x, a.z) : a.fy) + b.vy * dt; b.vy -= 18 * dt; a.mesh.rotation.x -= b.spin * dt;
      if (a.fy <= gy(a.x, a.z)) { a.fy = null; a.bal = null; a.mesh.rotation.x = 0; }
    }
    a.mesh.position.set(a.x, a.fy == null ? gy(a.x, a.z) : a.fy, a.z); a.mesh.rotation.y = a.yaw;
    const sp = a.init ? Math.hypot(a.x - a.px, a.z - a.pz) / Math.max(dt, 1e-3) : 0;
    a.init = true; a.px = a.x; a.pz = a.z; a.speed += (Math.min(sp, 12) - a.speed) * Math.min(1, dt * 10);
    const def = ALL[a.weapon];
    if (a.rl) a.rlT += dt; else a.rlT = 0;
    updateHumanoidAnim(a.ud, {
      dt, moving: a.speed > 0.4, speed: a.speed, grounded: true, ads: a.ads, sprint: a.speed > 5.2, crouch: a.crouch, pitch: a.pitch,
      reloading: a.rl && def.kind === 'gun', reloadT: a.rlT, missing: def.mag || 1, ammo: 1, weapon: a.weapon, dead: a.dead,
      onEvent: (n, i) => actorEvent(a, n, i), onStep: () => {},
    });
  }
  function fire(a, tx, ty, tz, spread = 0.012) {
    const w = ensureWeapon(a.ud, a.weapon), m = w && w.muzzle; if (!m) return;
    m.getWorldPosition(_o);
    _d.set(tx - _o.x, ty - _o.y, tz - _o.z).normalize();
    _d.x += (R() - 0.5) * spread * 2; _d.y += (R() - 0.5) * spread * 2; _d.z += (R() - 0.5) * spread * 2; _d.normalize();
    bullets.spawn(_o, _d, 260, a.hostile);
    (a.flashes[a.weapon] || (a.flashes[a.weapon] = bullets.attachFlash(m, 0.55))).fire();
    triggerShootKick(a.ud);
    bullets.ejectShell(_o, _n.set(1.2, 1.2, 0));
    sfx('shot', 0.85, { snd: a.weapon, enemy: a.hostile });
  }
  function volley(shooters, targets, s, rate, spread) {
    for (const a of shooters) {
      if (a.dead || !a.mesh.visible || s < a.nf) continue;
      const alive = targets.filter((t) => !t.dead && t.mesh.visible); if (!alive.length) continue;
      const t = alive[Math.floor(R() * alive.length)], p = chest(t);
      fire(a, p.x, p.y, p.z, spread || 0.02);
      const dist = Math.hypot(p.x - a.x, p.z - a.z);
      delay(dist / 260, () => { if (!t.dead) bullets.impact(p, _n.set(0, 0.2, 1).normalize(), 'body'); });
      a.nf = s + rate * (0.7 + R() * 0.6);
    }
  }
  function kill(a, head) {
    if (a.dead) return; a.dead = true;
    bullets.impact(chest(a), _n.set(0, 0.3, 1).normalize(), 'body'); sfx(head ? 'headshot' : 'hit', 0.9); delay(0.08, () => sfx('death', 0.8));
  }
  function launch(a, vx, vy, vz) { if (a.dead && a.bal) return; a.dead = true; a.bal = { vx, vy, vz, spin: 4 + R() * 3 }; }

  // ---------- vehicles (scripted: physics is off until we blow one up) ----------
  const _cm = new THREE.Vector3(), _eu = new THREE.Euler();
  function spawnCar(type, S, off) {
    const v = vehicles.spawnAt({ type, x: S.x + off, z: S.z + off, yaw: 0 }); if (!v) return null;
    v.awake = false; v.inst.driver.visible = true;
    return { v, ty: VEHICLE_TYPES[type], free: false };
  }
  function poseCar(c, x, z, yaw, speed, dt, op) {
    if (!c || c.free) return; op = op || {};
    const v = c.v, ty = c.ty, fx_ = -Math.sin(yaw), fz_ = -Math.cos(yaw);
    v.x = x; v.z = z; v.yaw = yaw; v.y = gy(x, z);
    const pitch = Math.atan2(gy(x + fx_ * 1.6, z + fz_ * 1.6) - gy(x - fx_ * 1.6, z - fz_ * 1.6), 3.2);
    v.q.setFromEuler(_eu.set(pitch, yaw, op.roll || 0, 'YXZ'));
    _cm.set(0, ty.phys.comY, ty.phys.comZ).applyQuaternion(v.q); v.p.set(x, v.y, z).add(_cm);
    v.vel.set(fx_ * speed, 0, fz_ * speed); v.w.set(0, 0, 0); v.steer = op.steer || 0;
    for (const w of v.wh) { w.ang += (speed * dt) / ty.wr; w.om = speed / ty.wr; if (w.front) w.steerAng = op.steer || 0; w.off = 0; }
    v.awake = false; v.sleepT = 0;
  }
  function parkCars(all) { for (const k in cars) { const c = cars[k]; if (c && (all || !c.free) && !c.free) { c.v.x = c.v.z = 40000; c.v.y = 0; } } }
  const dust = (x, z, sc) => fx.dust(x, gy(x, z) + 0.2, z, sc);

  // ---------- camera ----------
  function look(p, l, fov, roll) { cam.p.copy(p); cam.p.y = Math.max(cam.p.y, gy(p.x, p.z) + 0.35); cam.l.copy(l); cam.fov = fov; cam.roll = roll || 0; }

  // ---------- shots ----------
  function buildShots() {
    const S = [], st = stages;
    const add = (name, t0, t1, d) => S.push(Object.assign({ name, t0, t1, s: 0 }, d));
    const guns = Object.values(ALL).filter((d) => d.kind === 'gun').map((d) => d.id);
    const droneId = (Object.values(ALL).find((d) => d.perk === 'drone') || {}).id;
    const lotId = (Object.values(ALL).find((d) => d.perk === 'lottery') || {}).id;

    { // 1. vista
      const fr = frame(st.vista, 0.7);
      add('vista', 0, 6.5, {
        enter() { kit([A[0]], ['vanguard']); },
        update(s, dt, e, u) {
          place(A[0], fr.pt(0, 0), facing(fr));
          look(fr.pt(lerp(-85, -34, 1 - Math.pow(1 - u, 3)), lerp(10, -4, u), lerp(1.2, 15, sst(u))), fr.pt(0, 0, 1.6 + u * 2), lerp(40, 30, u), 0);
        },
      });
    }
    { // 2. squad advance (slow-mo)
      const fr = frame(st.run, 2.1);
      add('advance', 6.5, 10, {
        ts: () => 0.6,
        enter() { kit(A.slice(0, 5), ['vanguard', 'stinger']); },
        update(s) {
          for (let i = 0; i < 5; i++) place(A[i], fr.pt(-26 + 9.2 * s - Math.abs(i - 2) * 2.4, (i - 2) * 2.8), facing(fr));
          look(fr.pt(12 + 0.6 * s, 1.4, 0.55), fr.pt(-28 + 9.2 * s, 0, 1.3), lerp(28, 23, sst(s / 2.1)), 0);
        },
      });
    }
    { // 3. side sprint
      const fr = frame(st.run, 3.3);
      add('sprint', 10, 12.5, {
        enter() { kit(A.slice(0, 3), ['vanguard', 'stinger']); },
        update(s, dt, e, u) {
          const f = -14 + 8.6 * s;
          place(A[0], fr.pt(f, 0), facing(fr)); place(A[1], fr.pt(f - 6, -2.6), facing(fr)); place(A[2], fr.pt(f - 9, 2.4), facing(fr));
          look(fr.pt(f + 0.8, 3.4 - u * 0.6, 1.15), fr.pt(f, 0, 1.2), lerp(42, 34, u), 0.04 * (0.5 - u));
        },
      });
    }
    { // 4. ADS, muzzle flash at the lens
      const fr = frame(st.run, 2.9);
      add('ads', 12.5, 15, {
        enter() { kit([A[0]], ['vanguard']); A[0].ads = true; A[0]._f = 0; },
        update(s, dt, e, u) {
          const h = A[0]; place(h, fr.pt(0, 0), facing(fr) + Math.PI);
          const tgt = fr.pt(40, 0, 1.5);
          while (h._f < 3 && s > 1.5 + h._f * 0.16) { fire(h, tgt.x, tgt.y, tgt.z, 0.004); h._f++; shake = Math.max(shake, 0.5); }
          look(fr.pt(lerp(3.2, 2.3, u), 0.15, 1.55), V3(h.x, gy(h.x, h.z) + 1.6, h.z), 30, 0);
        },
      });
    }
    { // 5. contact
      const fr = frame(st.fight, 1.0), dies = [1.0, 1.7, 2.3, 3.0];
      add('contact', 15, 19, {
        enter() { kit(A.slice(0, 4), ['vanguard', 'stinger']); kit([...A.slice(0, 4), ...B.slice(0, 4)], ['vanguard', 'stinger', 'p9']); A.slice(0, 4).forEach((a, i) => { a.ads = true; a.crouch = i % 2 === 1; }); },
        update(s) {
          for (let i = 0; i < 4; i++) {
            place(A[i], fr.pt(0, (i - 1.5) * 2.6), facing(fr));
            place(B[i], fr.pt(34 - 5.5 * s, (i - 1.5) * 3 + Math.sin(s * 3 + i) * 1.2), facing(fr) + Math.PI);
            if (!B[i].dead && s > dies[i]) kill(B[i], i === 2);
          }
          volley(A.slice(0, 4), B.slice(0, 4), s, 0.14, 0.02);
          look(fr.pt(-3.2 + s * 0.25, 1.0, 1.75), fr.pt(18, 0, 1.3), 34, 0);
        },
      });
    }
    { // 6. reload macro (slow-mo, orbiting the weapon)
      const fr = frame(st.ops, 0.2);
      add('reload', 19, 23, {
        ts: () => 0.8,
        enter() { kit([A[0]], ['longbow']); A[0].crouch = true; },
        update(s, dt, e, u) {
          const h = A[0], def = ALL[h.weapon], dur = reloadDuration(def, def.mag || 1);
          place(h, fr.pt(0, 0), facing(fr)); h.rl = s % (dur + 0.4) < dur;
          ensureWeapon(h.ud, h.weapon).group.getWorldPosition(_t);
          const c = V3(h.x, gy(h.x, h.z) + 0.95, h.z);
          look(orb(c, lerp(fr.hd + 1.9, fr.hd - 0.25, sst(u)), lerp(1.5, 1.05, u), lerp(0.2, 0.7, u)), _t.clone(), 32, 0);
        },
      });
    }
    { // 7. car + bike chase
      const fr = frame(st.chase, 0.4);
      const path = (f, lat, extraYaw) => {
        const r = lat + 16 * Math.sin(f * 0.045), dr = 0.72 * Math.cos(f * 0.045);
        const dx = fr.fx + fr.fz * dr, dz = fr.fz - fr.fx * dr;
        return { p: fr.pt(f, r), yaw: Math.atan2(-dx, -dz) + extraYaw, dr };
      };
      let dt_ = 0;
      add('chase', 23, 29, {
        enter() { kit([], []); dt_ = 0; },
        update(s, dt, e, u) {
          const f = -70 + 26 * s, c1 = path(f, 0, 0.5 * Math.sin(f * 0.045)), c2 = path(f - 14, 2.5, 0), c3 = path(f - 34, -3, 0.3 * Math.sin(f * 0.045));
          poseCar(cars.sedan, c1.p.x, c1.p.z, c1.yaw, 26, dt, { roll: -0.07 * Math.sin(f * 0.045), steer: 0.2 * Math.sin(f * 0.045) });
          poseCar(cars.moto, c2.p.x, c2.p.z, c2.yaw, 27, dt, { roll: 0.5 * Math.cos(f * 0.045) });
          poseCar(cars.van, c3.p.x, c3.p.z, c3.yaw, 25, dt, { roll: -0.05 });
          dt_ += dt; if (dt_ > 0.045) { dt_ = 0; dust(c1.p.x, c1.p.z, 1.3); dust(c2.p.x, c2.p.z, 1); dust(c3.p.x, c3.p.z, 1.4); }
          const low = fr.pt(-10, 8, 0.7), hi = c1.p.clone().add(V3(-Math.sin(c1.yaw) * -14, 7, -Math.cos(c1.yaw) * -14));
          look(low.lerp(hi, sst((u - 0.5) / 0.3)), c1.p.clone().add(V3(0, 0.8, 0)), lerp(30, 46, u), 0);
          shake = Math.max(shake, 0.15);
        },
      });
    }
    { // 8. truck head-on
      const fr = frame(st.chase, 2.2);
      add('truck', 29, 32.5, {
        ts: (e) => (e < 1.6 ? 1 : 0.4),
        enter() { kit([], []); },
        update(s, dt, e, u) {
          const f = -70 + 31 * s, p = fr.pt(f, -2.0);
          poseCar(cars.truck, p.x, p.z, facing(fr) , 31, dt, {});
          dust(p.x, p.z, 1.8);
          look(fr.pt(0, 0.4, 0.65), p.clone().add(V3(0, 1.2, 0)), lerp(24, 40, u), 0);
          shake = Math.max(shake, clamp(1 - Math.abs(f) / 40) * 0.8);
        },
      });
    }
    { // 9. wide firefight with slow-mo headshot
      const fr = frame(st.fight, 3.9), c0 = fr.pt(0, 0, 1.2);
      add('firefight', 32.5, 37, {
        ts: (e) => (e > 2.3 && e < 3.4 ? 0.25 : 1),
        enter() { kit([...A.slice(0, 4), ...B.slice(0, 4)], ['vanguard', 'stinger', 'p9', 'marshal']); A.slice(0, 4).forEach((a, i) => { a.crouch = i % 2 === 0; a.ads = true; }); B.slice(0, 4).forEach((a, i) => { a.crouch = i % 2 === 1; a.ads = true; }); },
        update(s, dt, e, u) {
          for (let i = 0; i < 4; i++) { place(A[i], fr.pt(-14, (i - 1.5) * 3.2), facing(fr)); place(B[i], fr.pt(14, (i - 1.5) * 3.2), facing(fr) + Math.PI); }
          if (s > 1.4 && !B[2].dead) kill(B[2], false);
          if (s > 2.35 && !B[0].dead) { kill(B[0], true); shake = 1; }
          if (s > 3.0 && !A[3].dead) kill(A[3], false);
          volley(A.slice(0, 4), B.slice(0, 4), s, 0.13, 0.02); volley(B.slice(0, 4), A.slice(0, 4), s, 0.16, 0.03);
          const a = lerp(0, 1.2, sst(u));
          look(fr.pt(Math.sin(a) * 26, Math.cos(a) * 26, lerp(3, 9, u)), c0, 34, 0);
        },
      });
    }
    { // 10. the truck goes up
      const fr = frame(st.blast, 5.1);
      let boomed = false;
      add('blast', 37, 42, {
        ts: (e) => (e < 1.5 ? 1 : e < 2.7 ? 0.18 : lerp(0.18, 0.8, sst((e - 2.7) / 1))),
        enter() {
          boomed = false; cars.truck.free = false;
          kit([A[0], A[1], A[2], B[0], B[1]], ['vanguard', 'stinger']); A.slice(0, 3).forEach((a) => { a.ads = true; });
        },
        update(s, dt, e, u) {
          const tp = fr.pt(14, 0);
          if (!boomed) poseCar(cars.truck, tp.x, tp.z, facing(fr) + Math.PI, 0, dt, {});
          for (let i = 0; i < 3; i++) place(A[i], fr.pt(-6 - i * 0.6, (i - 1) * 2.4), facing(fr));
          place(B[0], fr.pt(18, 3 + s * 0.2), facing(fr) + Math.PI); place(B[1], fr.pt(19, -3), facing(fr) + Math.PI);
          const tc = V3(tp.x, tp.y + 1.2, tp.z);
          if (!boomed && s < 1.45) volley([A[0], A[1]], [], s, 0.1); // (no actor targets) tracers below
          if (!boomed && s > 0.6 && s < 1.45 && Math.floor(s * 9) !== A[0]._k) { A[0]._k = Math.floor(s * 9); fire(A[0], tc.x, tc.y, tc.z, 0.004); }
          if (!boomed && s >= 1.5) {
            boomed = true; fx.blast(tp.x, tp.y, tp.z, 1.7); vehicles.hurtAt(tp.x, tp.z, 10, 3000); shake = 1.2;
            launch(B[0], 6, 9, 5); launch(B[1], -5, 8, 6); launch(A[2], -4, 5, -3);
            if (cars.truck) cars.truck.free = true;
          }
          const p0 = fr.pt(-9, 3.2, 1.0), p1 = fr.pt(-22, -6, 4.5);
          look(p0.lerp(p1, sst((e - 1.4) / 2.5)), tc, lerp(30, 45, sst((e - 1.4) / 2.5)), 0);
        },
      });
    }
    { // 11. Scout Drone
      const fr = frame(st.ops, 1.0);
      add('drone', 42, 46.5, {
        enter() { kit([A[0]], [droneId || 'vanguard']); A[0]._d = false; },
        update(s, dt, e, u) {
          const h = A[0]; place(h, fr.pt(0, 0), facing(fr));
          if (droneId && !h._d && s > 0.3) { h._d = true; triggerMelee(h.ud, 'deploy'); }
          look(orb(chest(h), lerp(fr.hd + 2.9, fr.hd + 0.4, sst(u)), lerp(2.8, 2.1, u), 0.25), chest(h).add(V3(0, -0.12, 0)), 34, 0);
        },
      });
    }
    { // 12. Ridgeback Lottery ritual
      const fr = frame(st.ops, 2.4);
      add('lottery', 46.5, 51.5, {
        ts: () => 0.75,
        enter() { kit([A[0]], [lotId || 'vanguard']); A[0]._d = false; },
        update(s, dt, e, u) {
          const h = A[0]; place(h, fr.pt(0, 0), facing(fr));
          if (lotId && !h._d && s > 0.2) { h._d = true; triggerMelee(h.ud, 'deploy'); }
          look(orb(chest(h), lerp(fr.hd + 0.2, fr.hd + 1.3, sst(u)), lerp(3.4, 2.4, u), lerp(-0.6, 0.5, u)), chest(h), 28, 0);
        },
      });
    }
    { // 13. weapon montage: 8 hard cuts
      const fr = frame(st.run, 4.4);
      const cuts = [
        () => [fr.pt(2.4, 0.4, 0.55), 28, 0, 0], () => [fr.pt(0.3, 1.5, 1.35), 30, 0, 0], () => [fr.pt(-1.8, 0.6, 1.8), 36, 0, 1],
        () => [fr.pt(3.2, -0.8, 1.3), 34, 0.18, 0], () => [fr.pt(1.6, 0.9, 0.15), 24, 0, 0], () => [fr.pt(1.2, 1.4, 3.6), 40, 0, 0],
        () => [fr.pt(1.1, 0.2, 1.55), 26, 0, 0], () => [fr.pt(7, 3, 2.4), 32, 0, 0],
      ];
      const order = guns.slice().sort(() => R() - 0.5);
      add('armory', 51.5, 57.5, {
        enter() { kit([A[0]], ['vanguard']); },
        update(s, dt, e) {
          const h = A[0], ci = Math.min(7, Math.floor(e / 0.75)), ce = e - ci * 0.75;
          if (ci !== h.cut) { h.cut = ci; h.weapon = W(order[ci % order.length]); equipNow(h.ud, h.weapon); h.ads = ci % 2 === 1; h._f = 0; shake = Math.max(shake, 0.4); }
          place(h, fr.pt(0, 0), facing(fr));
          const tgt = fr.pt(40, 0, 1.5);
          while (h._f < 3 && ce > 0.22 + h._f * 0.13) { fire(h, tgt.x, tgt.y, tgt.z, 0.004); h._f++; }
          const c = cuts[ci](); ensureWeapon(h.ud, h.weapon).group.getWorldPosition(_t);
          look(c[0], c[3] ? fr.pt(12, 0, 1.4) : _t.clone(), c[1], c[2]);
        },
      });
    }
    { // 14. convoy crane
      const fr = frame(st.chase, 5.6);
      const lane = [['sedan', -2.5, 0, 24], ['truck2', 1.5, -10, 21], ['van', -6, -22, 22], ['moto', 4, -6, 27]];
      let d_ = 0;
      add('convoy', 57.5, 64.5, {
        enter() { kit([], []); d_ = 0; },
        update(s, dt, e, u) {
          d_ += dt; const puff = d_ > 0.05; if (puff) d_ = 0;
          for (const [k, r, off, sp] of lane) {
            const f = -60 + sp * s + off, p = fr.pt(f, r);
            poseCar(cars[k], p.x, p.z, facing(fr), sp, dt, { roll: k === 'moto' ? 0.05 : 0 }); if (puff) dust(p.x, p.z, 1.4);
          }
          const mid = fr.pt(-55 + 22 * s, 0, 1.0);
          look(fr.pt(0, 6, lerp(0.8, 22, sst(u))), mid, lerp(30, 38, u), 0);
          shake = Math.max(shake, 0.12);
        },
      });
    }
    add('silence', 64.5, 67.5, { enter() { kit([], []); }, update() {} });
    { // 16. final charge
      const fr = frame(st.fight, 0.3), blasts = [1.4, 2.5, 3.3];
      let bi = 0;
      add('charge', 67.5, 76, {
        ts: () => 0.45,
        enter() {
          kit([...A, ...B], ['vanguard', 'stinger', 'marshal', 'p9', 'spitfire', 'breacher']); bi = 0;
          A.forEach((a) => { a.ads = false; }); B.forEach((a) => { a.ads = false; });
        },
        update(s, dt, e, u) {
          for (let i = 0; i < 6; i++) {
            const lat = (i - 2.5) * 3.2;
            place(A[i], fr.pt(-30 + 8 * s - (i % 2) * 2, lat), facing(fr)); place(B[i], fr.pt(30 - 8 * s + (i % 2) * 2, lat + 1.2), facing(fr) + Math.PI);
          }
          volley(A, B, s, 0.15, 0.03); volley(B, A, s, 0.17, 0.03);
          while (bi < blasts.length && s >= blasts[bi]) {
            const p = fr.pt(-4 + bi * 5, (bi - 1) * 5); fx.blast(p.x, p.y, p.z, 1.4); shake = 1;
            launch(B[bi * 2], 5, 8, 4); launch(A[bi * 2 + 1], -5, 8, -4); bi++;
          }
          const a = lerp(0.9, 2.5, sst(u)), rad = lerp(30, 20, u);
          look(fr.pt(Math.sin(a) * rad, Math.cos(a) * rad, lerp(1.6, 11, sst(u))), fr.pt(0, 0, 1.5), lerp(34, 46, u), 0);
        },
      });
    }
    add('title', 76, 84, { enter() { kit([], []); }, update() {} });
    return S;
  }

  // ---------- UI ----------
  function buildUI() {
    if (ui) { ui.root.style.display = 'block'; return; }
    const st = document.createElement('style');
    st.textContent = `
body.trailer-mode *{visibility:hidden!important}
body.trailer-mode #c,body.trailer-mode #trailerUI,body.trailer-mode #trailerUI *{visibility:visible!important}
#trailerUI{position:fixed;inset:0;z-index:99990;pointer-events:none;font-family:'Arial Black',Impact,system-ui,sans-serif;color:#fff}
#trailerUI .bar{position:absolute;left:0;right:0;background:#000;z-index:4}
#trailerUI .fade{position:absolute;inset:0;z-index:2;opacity:1}
#trailerUI .flash{position:absolute;inset:0;z-index:3;background:#fff;opacity:0}
#trailerUI .card{position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;z-index:5;opacity:0;transition:opacity .25s;letter-spacing:.22em;text-shadow:0 0 28px rgba(255,160,60,.55),0 4px 18px #000;font-weight:900;font-size:min(7vw,76px)}
#trailerUI .card.big{font-size:min(10.5vw,130px);letter-spacing:.3em}
#trailerUI .card.on{opacity:1}
#trailerUI .card small{display:block;margin-top:.45em;font-size:.2em;letter-spacing:.7em;color:#ffc247}
#trailerUI .sub{position:absolute;left:8%;right:8%;bottom:12%;text-align:center;z-index:5;font:600 min(2.6vw,22px) system-ui;text-shadow:0 2px 8px #000;opacity:0}
#trailerUI .hint{position:absolute;right:14px;top:10px;font:600 12px system-ui;opacity:.7;z-index:6;transition:opacity 1s}`;
    document.head.appendChild(st);
    const root = document.createElement('div'); root.id = 'trailerUI';
    root.innerHTML = '<div class="fade"></div><div class="flash"></div><div class="bar" id="trBarT" style="top:0"></div><div class="bar" id="trBarB" style="bottom:0"></div><div class="card"></div><div class="sub"></div><div class="hint">ESC or double-tap to exit</div>';
    document.body.appendChild(root);
    ui = { root, fade: root.querySelector('.fade'), flash: root.querySelector('.flash'), card: root.querySelector('.card'), sub: root.querySelector('.sub'), hint: root.querySelector('.hint'), bt: root.querySelector('#trBarT'), bb: root.querySelector('#trBarB'), cardKey: '' };
    addEventListener('resize', bars);
    addEventListener('keydown', (e) => { if (active && e.code === 'Escape') stop(); });
    addEventListener('dblclick', () => { if (active) stop(); });
  }
  function bars() {
    if (!ui) return;
    const h = Math.max(0, (innerHeight - innerWidth / 2.39) / 2);
    ui.bt.style.height = ui.bb.style.height = h + 'px';
  }
  function overlays(t) {
    const [col, a] = overlayAt(t);
    ui.fade.style.background = col; ui.fade.style.opacity = a;
    while (hitIdx < HITS.length && t >= HITS[hitIdx]) { shake = Math.max(shake, 0.7); hitIdx++; }
    let f = 0; for (const h of HITS) if (t >= h) f = Math.max(f, 1 - (t - h) / 0.28);
    ui.flash.style.opacity = clamp(f) * 0.5;
    const cd = CARDS.find((c) => t >= c.t0 && t < c.t1);
    const key = cd ? cd.text + (cd.sub && t > cd.t0 + 2 ? '+' : '') : '';
    if (key !== ui.cardKey) {
      ui.cardKey = key;
      if (cd) { ui.card.className = 'card on' + (cd.big ? ' big' : ''); ui.card.innerHTML = cd.text + (cd.sub && t > cd.t0 + 2 ? `<small>${cd.sub}</small>` : ''); } else ui.card.className = 'card';
    }
    const showAll = /[?&]subs\b/.test(location.search);
    const line = vo.find((l) => (showAll || !l.buf) && t >= l.at && t < l.at + (l.buf ? l.buf.duration : 1.6 + l.text.length * 0.05));
    ui.sub.textContent = line ? line.text : ''; ui.sub.style.opacity = line ? 1 : 0;
    if (t > 4) ui.hint.style.opacity = 0;
  }

  // ---------- lifecycle ----------
  function pickStages() {
    const P = (i) => POIS[i % POIS.length] || { x: 0, z: 0 };
    const mk = (i, a, b, c) => findStage(R, P(i).x, P(i).z, a, b, c);
    return { vista: mk(0, 40, 120, 20), run: mk(1, 30, 110, 22), fight: mk(2, 30, 110, 26), chase: mk(3, 40, 150, 30), blast: mk(4, 30, 110, 24), ops: mk(5, 30, 110, 16) };
  }
  async function loadVO(c, script) {
    return Promise.all((script.lines || []).map(async (l) => {
      let buf = null;
      try { if (c) { const r = await fetch(VO_DIR + l.id + '.mp3'); if (r.ok) buf = await c.decodeAudioData(await r.arrayBuffer()); } } catch (_) {}
      return Object.assign({}, l, { buf });
    }));
  }
  async function start() {
    if (active) return;
    active = true; ready = false; shotIdx = -1; hitIdx = 0; gs = 0; shake = 0;
    document.body.classList.add('trailer-mode');
    try { if (document.pointerLockElement) document.exitPointerLock(); } catch (_) {}
    buildUI(); bars(); ui.fade.style.background = '#000'; ui.fade.style.opacity = 1; ui.hint.style.opacity = 0.7; ui.cardKey = '';
    saved = {}; for (const k in BEST) { saved[k] = settings[k]; settings[k] = BEST[k]; }
    try { gfx.apply(); } catch (_) {}
    LOD.on = false; playerMesh.visible = false; viewmodel.visible = false;
    const c = audio.getCtx ? audio.getCtx() : null;
    let script = { lines: [] };
    try { script = await (await fetch(SCRIPT_URL, { cache: 'no-cache' })).json(); } catch (_) {}
    vo = await loadVO(c, script);
    if (!active) return;
    if (!actors.length) { for (let i = 0; i < 6; i++) A.push(makeActor('remote', false)); for (let i = 0; i < 6; i++) B.push(makeActor('enemy', true)); }
    stages = pickStages();
    if (!cars.sedan) {
      const S = stages.chase;
      cars.sedan = spawnCar('sedan', S, 0); cars.moto = spawnCar('motorcycle', S, 6); cars.van = spawnCar('van', S, 12);
      cars.truck = spawnCar('truck', S, 18); cars.truck2 = spawnCar('truck', S, 24);
    }
    shots = buildShots(); parkCars(false);
    if (c && audio.getMaster) { if (c.state === 'suspended') { try { await c.resume(); } catch (_) {} } music = buildAudio(c, audio.getMaster(), vo); }
    else console.warn('[trailer] audio.getCtx/getMaster missing — add the two lines to lib/audio.js to get the score + voices');
    T = -0.35; ready = true;
  }
  function stop() {
    if (!active) return;
    active = false; ready = false;
    if (music) { music.stop(); music = null; }
    if (saved) { for (const k in saved) settings[k] = saved[k]; saved = null; try { gfx.apply(); } catch (_) {} }
    for (const a of actors) a.mesh.visible = false;
    parkCars(false);
    document.body.classList.remove('trailer-mode'); if (ui) ui.root.style.display = 'none';
    camera.up.set(0, 1, 0); camera.fov = settings.fov; camera.updateProjectionMatrix();
    if (o.onStop) o.onStop();
  }
  function update(rawFull) {
    if (!active || !ready) { if (active && ui) { ui.fade.style.opacity = 1; } return; }
    const raw = Math.min(rawFull, 0.25), dtc = Math.min(raw, 0.05);
    T += raw;
    if (T >= END) { stop(); return; }
    const Tc = Math.max(0, T);
    let idx = shots.findIndex((s) => Tc >= s.t0 && Tc < s.t1); if (idx < 0) idx = shots.length - 1;
    if (idx !== shotIdx) {
      shotIdx = idx; const sh = shots[idx]; sh.s = 0;
      for (const a of actors) a.mesh.visible = false; parkCars(false);
      try { if (sh.enter) sh.enter(); } catch (e) { console.error('[trailer] enter', sh.name, e); }
    }
    const sh = shots[shotIdx], e = Tc - sh.t0, u = clamp(e / (sh.t1 - sh.t0));
    const ts = sh.ts ? sh.ts(e, u) : 1, dt = Math.max(0.0005, dtc * ts);
    sh.s += dt; gs += dt;
    try { sh.update(sh.s, dt, e, u); } catch (err) { if (!sh._err) { sh._err = 1; console.error('[trailer] shot', sh.name, err); } }
    for (const a of actors) tickActor(a, dt);
    for (let i = later.length - 1; i >= 0; i--) if (gs >= later[i].t) { const f = later[i].fn; later.splice(i, 1); try { f(); } catch (_) {} }
    fakePlayer.x = cam.p.x; fakePlayer.z = cam.p.z; fakePlayer.y = cam.p.y;
    vehicles.update(dt, fakePlayer, {}, null);
    fx.update(dt); bullets.update(dt); world.update(cam.p.x, cam.p.z, dtc);
    // camera
    camera.position.copy(cam.p); camera.up.set(0, 1, 0); camera.lookAt(cam.l); if (cam.roll) camera.rotateZ(cam.roll);
    const k = shake + 0.05;
    camera.position.x += Math.sin(T * 43) * k * 0.05; camera.position.y += Math.sin(T * 51 + 1) * k * 0.05; camera.rotateZ(Math.sin(T * 37) * k * 0.01);
    shake *= Math.exp(-3.5 * dtc);
    if (Math.abs(camera.fov - cam.fov) > 1e-3) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();
    try { _d.set(0, 0, -1).applyQuaternion(camera.quaternion); audio.setListener(camera.position.x, camera.position.z, Math.atan2(-_d.x, -_d.z)); } catch (_) {}
    overlays(Tc);
  }

  return { start, stop, update, get active() { return active; } };
}
