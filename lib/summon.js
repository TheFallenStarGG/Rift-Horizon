/**
 * Hellgate Summon — utility.
 * Fire it: pick a vehicle (1-4 / tap), then a demonic ritual plays and the vehicle rises from a pit.
 * One charge per life. The vehicle is a normal driveable vehicle (vehicles.spawnAt), local to your client.
 */
import * as THREE from 'three';
import { VEHICLE_TYPES } from './vehicles.js';
import { heightAt } from './ground.js';
import { resolveCircle, raycastWorld } from './collision.js';
import { settings } from './settings.js';

export const SUMMON_TYPES = ['sedan', 'truck', 'van', 'motorcycle'];
const DUR = 7.4; // total ritual length (the hand animation in arsenal.js is 7.0s)
const TAU = Math.PI * 2;
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const ramp = (t, a, b) => clamp((t - a) / (b - a));
const eOut3 = (x) => 1 - Math.pow(1 - x, 3);
const eOut2 = (x) => 1 - (1 - x) * (1 - x);
const eIn2 = (x) => x * x;
const pulse = (t, at, len) => (t < at || t > at + len ? 0 : Math.sin(((t - at) / len) * Math.PI));
const rnd = (a, b) => a + Math.random() * (b - a);

// headlight "eyes" per vehicle (model space, forward = -Z)
const EYES = {
  sedan: [[-0.62, 0.74, -2.3], [0.62, 0.74, -2.3]],
  truck: [[-0.78, 0.98, -2.78], [0.78, 0.98, -2.78]],
  van: [[-0.72, 0.88, -2.74], [0.72, 0.88, -2.74]],
  motorcycle: [[0, 0.95, -0.8]],
};

// ---------- textures (built once) ----------
const TX = {};
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function tex(c) { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
function glowTex() {
  if (TX.glow) return TX.glow;
  const c = canvas(128, 128), g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return (TX.glow = tex(c));
}
function sigilTex() {
  if (TX.sigil) return TX.sigil;
  const S = 512, c = canvas(S, S), g = c.getContext('2d');
  g.translate(S / 2, S / 2);
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.strokeStyle = '#ff3418'; g.shadowColor = '#ff7a2a'; g.shadowBlur = 10;
  const ring = (r, w) => { g.lineWidth = w; g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke(); };
  ring(246, 5); ring(232, 2); ring(196, 3); ring(76, 3);
  let seed = 7;
  const r01 = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  g.lineWidth = 3;
  for (let i = 0; i < 40; i++) { // glyph strokes between the outer rings
    g.save(); g.rotate((i / 40) * TAU); g.beginPath(); g.moveTo(204, 0);
    const k = 2 + ((r01() * 3) | 0);
    for (let j = 1; j <= k; j++) g.lineTo(204 + (22 * j) / k, (r01() - 0.5) * 12);
    g.stroke(); g.restore();
  }
  g.lineWidth = 4; g.beginPath(); // inverted pentagram
  for (let i = 0; i <= 5; i++) {
    const a = Math.PI / 2 + i * 2 * (TAU / 5), x = Math.cos(a) * 190, y = Math.sin(a) * 190;
    if (i) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.stroke();
  for (let i = 0; i < 5; i++) { const a = Math.PI / 2 + i * (TAU / 5); g.beginPath(); g.arc(Math.cos(a) * 190, Math.sin(a) * 190, 14, 0, TAU); g.stroke(); }
  g.beginPath(); g.ellipse(0, 0, 60, 26, 0, 0, TAU); g.stroke(); // the eye
  g.fillStyle = '#ff2a10'; g.beginPath(); g.arc(0, 0, 14, 0, TAU); g.fill();
  g.strokeStyle = '#ff9a3a'; g.lineWidth = 2.5; // cracks
  for (let i = 0; i < 16; i++) {
    g.save(); g.rotate((i / 16) * TAU + r01() * 0.2); g.beginPath(); g.moveTo(80, 0);
    for (let r = 100; r < 254; r += 16 + r01() * 14) g.lineTo(r, (r01() - 0.5) * 20);
    g.stroke(); g.restore();
  }
  return (TX.sigil = tex(c));
}
function voidTex() {
  if (TX.void) return TX.void;
  const c = canvas(256, 256), g = c.getContext('2d');
  const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  gr.addColorStop(0, '#2a0300'); gr.addColorStop(0.5, '#080000'); gr.addColorStop(1, '#000');
  g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(120,10,0,.5)'; g.lineWidth = 6; g.lineCap = 'round';
  for (let k = 0; k < 3; k++) {
    g.beginPath();
    for (let a = 0; a < 9; a += 0.2) { const r = 8 + a * 12, th = a + (k * TAU) / 3; const x = 128 + Math.cos(th) * r, y = 128 + Math.sin(th) * r; if (a) g.lineTo(x, y); else g.moveTo(x, y); }
    g.stroke();
  }
  const t = tex(c); t.center.set(0.5, 0.5);
  return (TX.void = t);
}
function rimTex() {
  if (TX.rim) return TX.rim;
  const c = canvas(64, 64), g = c.getContext('2d');
  for (let y = 0; y < 64; y++) {
    const j = 0.65 + 0.35 * Math.random(), gr = g.createLinearGradient(0, 0, 64, 0);
    gr.addColorStop(0, `rgba(255,230,140,${j})`); gr.addColorStop(0.25, `rgba(255,110,30,${j})`);
    gr.addColorStop(0.7, `rgba(170,20,0,${j * 0.6})`); gr.addColorStop(1, 'rgba(60,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, y, 64, 1);
  }
  return (TX.rim = tex(c));
}
function glyphTex(n) {
  const key = 'g' + n;
  if (TX[key]) return TX[key];
  const c = canvas(128, 128), g = c.getContext('2d');
  g.translate(64, 64); g.strokeStyle = '#ff4a22'; g.shadowColor = '#ff8a3a'; g.shadowBlur = 10; g.lineWidth = 5; g.lineCap = 'round';
  g.beginPath();
  if (n === 0) { g.arc(0, 0, 38, 0, TAU); g.moveTo(-38, 0); g.lineTo(38, 0); g.moveTo(0, -38); g.lineTo(0, 38); }
  else if (n === 1) { g.moveTo(0, -42); g.lineTo(40, 30); g.lineTo(-40, 30); g.closePath(); g.moveTo(10, 4); g.arc(0, 4, 10, 0, TAU); }
  else if (n === 2) { g.moveTo(-30, -38); g.lineTo(-10, 38); g.moveTo(0, -38); g.lineTo(20, 38); g.moveTo(30, -38); g.lineTo(-40, 8); }
  else { g.arc(0, 0, 38, 0.6, TAU - 0.6); g.moveTo(24, -28); g.arc(10, 0, 30, -0.9, 0.9); }
  g.stroke();
  return (TX[key] = tex(c));
}

// ---------- terrain-conforming disc / ring ----------
function makeDisc(rings, segs, polar) {
  const n = (rings + 1) * (segs + 1), pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), idx = [];
  for (let i = 0; i <= rings; i++) {
    for (let j = 0; j <= segs; j++) {
      const k = i * (segs + 1) + j, th = (j / segs) * TAU, q = i / rings;
      if (polar) { uv[k * 2] = 0.5 + 0.5 * q * Math.cos(th); uv[k * 2 + 1] = 0.5 + 0.5 * q * Math.sin(th); }
      else { uv[k * 2] = q; uv[k * 2 + 1] = j / segs; }
      if (i < rings && j < segs) { const a = k, b = k + 1, c = k + segs + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.userData = { rings, segs };
  return geo;
}
function fillDisc(geo, cx, cz, r0, r1, lift) {
  const { rings, segs } = geo.userData, p = geo.attributes.position.array;
  for (let i = 0; i <= rings; i++) {
    const rho = r0 + ((r1 - r0) * i) / rings;
    for (let j = 0; j <= segs; j++) {
      const th = (j / segs) * TAU, x = cx + Math.cos(th) * rho, z = cz + Math.sin(th) * rho, k = (i * (segs + 1) + j) * 3;
      p[k] = x; p[k + 1] = heightAt(x, z) + lift; p[k + 2] = z;
    }
  }
  geo.attributes.position.needsUpdate = true;
  geo.computeBoundingSphere();
}

const ADD = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false };

export function createSummon({ scene, hud, audio, camera, vehicles, playAnim }) {
  let charges = 1, phase = 'idle'; // idle | picking | ritual
  let t = 0, P = null, R = null, lastMsg = 0, capUntil = 0, flashV = 0, nextBeat = 0;
  const flags = {}, after = [];

  // ---------- DOM ----------
  const st = document.createElement('style');
  st.textContent = `
#summonPick{display:none;position:fixed;left:50%;top:15%;transform:translateX(-50%);z-index:46;max-width:94vw;padding:10px 12px 8px;border-radius:12px;background:rgba(14,2,2,.9);border:1px solid rgba(255,70,30,.65);box-shadow:0 0 28px rgba(255,40,10,.35);color:#ffb9a3;font:700 12px system-ui,sans-serif;text-align:center;pointer-events:auto;user-select:none;-webkit-user-select:none;touch-action:none}
#summonPick .h{letter-spacing:.14em;color:#ff6a3a;margin-bottom:8px;display:flex;justify-content:space-between;gap:14px}
#summonPick .x{cursor:pointer;padding:0 6px}
#summonPick .row{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}
#summonPick .c{width:104px;padding:8px 6px;border-radius:9px;border:1px solid rgba(255,90,50,.5);background:rgba(60,8,4,.55);cursor:pointer}
#summonPick .c:active{background:rgba(255,70,30,.45)}
#summonPick .c i{display:block;font:800 11px ui-monospace,Menlo,monospace;color:#ffd0a0;font-style:normal}
#summonPick .c b{display:block;margin:2px 0 5px;font-size:13px;color:#fff}
#summonPick .m{display:flex;align-items:center;gap:4px;font-size:8px;opacity:.85;margin:2px 0}#summonPick .m span{width:24px;text-align:left}
#summonPick .m u{flex:1;height:5px;background:rgba(255,255,255,.12);border-radius:3px;overflow:hidden;text-decoration:none}#summonPick .m s{display:block;height:100%;background:linear-gradient(90deg,#b01800,#ff9a3a)}
#summonPick .f{margin-top:7px;font-size:9px;opacity:.55;font-weight:600}
body.mobile #summonPick .f{display:none}`;
  document.head.appendChild(st);
  const layer = (id, css) => { const d = document.createElement('div'); d.id = id; d.style.cssText = 'position:fixed;pointer-events:none;' + css; document.body.appendChild(d); return d; };
  const tint = layer('summonTint', 'inset:0;z-index:42;opacity:0;background:rgba(40,0,0,.9);mix-blend-mode:multiply;');
  const vig = layer('summonVig', 'inset:0;z-index:43;opacity:0;background:radial-gradient(ellipse at 50% 50%,rgba(0,0,0,0) 30%,rgba(70,0,0,.55) 72%,rgba(10,0,0,.9) 100%);');
  const flash = layer('summonFlash', 'inset:0;z-index:44;opacity:0;mix-blend-mode:screen;background:radial-gradient(circle,rgba(255,200,170,1) 0%,rgba(255,60,20,.8) 45%,rgba(120,0,0,.5) 100%);');
  const cap = layer('summonCap', 'left:50%;bottom:168px;transform:translateX(-50%);z-index:44;opacity:0;transition:opacity .5s;color:#ff5a30;font:italic 800 18px/1.1 Georgia,serif;letter-spacing:.3em;text-shadow:0 0 14px rgba(255,40,0,.9);white-space:nowrap;');

  const pick = document.createElement('div');
  pick.id = 'summonPick';
  const bar = (n, v) => `<div class="m"><span>${n}</span><u><s style="width:${Math.round(clamp(v) * 100)}%"></s></u></div>`;
  pick.innerHTML = '<div class="h"><span>☠ SUMMON · CHOOSE YOUR VESSEL</span><span class="x" data-x="1">✕</span></div><div class="row">'
    + SUMMON_TYPES.map((id, i) => {
      const ty = VEHICLE_TYPES[id];
      return `<div class="c" data-id="${id}"><i>${i + 1}</i><b>${ty.name}</b>${bar('SPD', ty.speedoRef / 36)}${bar('HP', ty.hp / 280)}${bar('OFF', ty.offroad)}</div>`;
    }).join('') + '</div><div class="f">Press 1–4 or tap · switch weapon to cancel</div>';
  document.body.appendChild(pick);
  pick.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    const el = e.target.closest('[data-id],[data-x]');
    if (!el) return;
    if (el.dataset.x) closePicker(); else choose(el.dataset.id);
  });

  const say = (msg, ms = 1500) => {
    const n = performance.now() / 1000;
    if (n - lastMsg < 1.2) return;
    lastMsg = n; hud.setMsg(msg, ms);
  };
  const caption = (text, ms = 1500) => { cap.textContent = text; cap.style.opacity = '1'; capUntil = performance.now() + ms; };
  function closePicker() { pick.style.display = 'none'; if (phase === 'picking') phase = 'idle'; }

  // ---------- audio (own WebAudio, like vehicles.js) ----------
  let actx = null, master = null, noise = null, bed = null;
  function ac() {
    if (actx) return actx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      actx = new AC(); master = actx.createGain(); master.connect(actx.destination);
      noise = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
      const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch (_) { actx = null; }
    if (actx && actx.state === 'suspended') actx.resume().catch(() => {});
    return actx;
  }
  const vol = () => clamp(settings.volume == null ? 1 : settings.volume, 0, 1);
  function boom(power = 1) {
    const c = ac(); if (!c) return;
    try {
      const n = c.currentTime, s = c.createBufferSource(); s.buffer = noise;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(1500 * power, n); f.frequency.exponentialRampToValueAtTime(70, n + 1.4);
      const g = c.createGain(); g.gain.setValueAtTime(0.85 * power * vol(), n); g.gain.exponentialRampToValueAtTime(0.001, n + 1.6);
      s.connect(f); f.connect(g); g.connect(c.destination); s.start(n); s.stop(n + 1.7);
    } catch (_) {}
  }
  function thump() {
    const c = ac(); if (!c) return;
    try {
      const n = c.currentTime, o = c.createOscillator(), g = c.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(64, n); o.frequency.exponentialRampToValueAtTime(30, n + 0.25);
      g.gain.setValueAtTime(0.4 * vol(), n); g.gain.exponentialRampToValueAtTime(0.001, n + 0.3);
      o.connect(g); g.connect(c.destination); o.start(n); o.stop(n + 0.32);
    } catch (_) {}
  }
  function startBed() {
    const c = ac(); if (!c) return;
    try {
      master.gain.value = 0.5 * vol();
      const n = c.currentTime, nodes = [];
      const g = c.createGain(); g.gain.value = 0; g.connect(master);
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 190; f.connect(g);
      [[41, 'sawtooth'], [41.9, 'sawtooth'], [82.4, 'triangle']].forEach(([fr, ty]) => {
        const o = c.createOscillator(); o.type = ty; o.frequency.setValueAtTime(fr, n); o.frequency.linearRampToValueAtTime(fr * 1.35, n + 6); o.connect(f); o.start(n); nodes.push(o);
      });
      g.gain.linearRampToValueAtTime(0.28, n + 1.5); g.gain.setValueAtTime(0.28, n + 6.2); g.gain.linearRampToValueAtTime(0, n + DUR + 0.5);
      const cg = c.createGain(); cg.gain.value = 0; cg.connect(master);
      [[220, 'triangle'], [233.1, 'triangle'], [329.6, 'sine'], [349.2, 'sine']].forEach(([fr, ty]) => {
        const o = c.createOscillator(); o.type = ty; o.frequency.value = fr;
        const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = 5 + Math.random(); lg.gain.value = 3; l.connect(lg); lg.connect(o.frequency);
        o.connect(cg); o.start(n); l.start(n); nodes.push(o, l);
      });
      cg.gain.setValueAtTime(0, n + 1.4); cg.gain.linearRampToValueAtTime(0.05, n + 3.4); cg.gain.linearRampToValueAtTime(0.09, n + 6); cg.gain.linearRampToValueAtTime(0, n + DUR + 0.4);
      bed = { nodes, g, cg };
      setTimeout(() => stopBed(), (DUR + 1.2) * 1000);
    } catch (_) {}
  }
  function stopBed() {
    if (!bed) return;
    const b = bed; bed = null;
    try { const n = actx.currentTime; b.g.gain.cancelScheduledValues(n); b.g.gain.setTargetAtTime(0, n, 0.08); b.cg.gain.cancelScheduledValues(n); b.cg.gain.setTargetAtTime(0, n, 0.08); } catch (_) {}
    setTimeout(() => b.nodes.forEach((o) => { try { o.stop(); } catch (_) {} }), 600);
  }

  // ---------- particle pools ----------
  function makePool(n, size, opacity, bright) {
    const pos = new Float32Array(n * 3), vel = new Float32Array(n * 3), col = new Float32Array(n * 3), life = new Float32Array(n), max = new Float32Array(n);
    for (let i = 0; i < n; i++) pos[i * 3 + 1] = -9999;
    const geo = new THREE.BufferGeometry(), pa = new THREE.BufferAttribute(pos, 3), ca = new THREE.BufferAttribute(col, 3);
    geo.setAttribute('position', pa); geo.setAttribute('color', ca);
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ map: glowTex(), size, sizeAttenuation: true, vertexColors: true, opacity, ...ADD }));
    pts.frustumCulled = false; scene.add(pts);
    let idx = 0;
    return {
      pts,
      spawn(x, y, z, vx, vy, vz, l) { const i = idx, j = i * 3; idx = (idx + 1) % n; pos[j] = x; pos[j + 1] = y; pos[j + 2] = z; vel[j] = vx; vel[j + 1] = vy; vel[j + 2] = vz; max[i] = life[i] = l; },
      step(dt, grav) {
        for (let i = 0; i < n; i++) {
          if (life[i] <= 0) continue;
          const j = i * 3; life[i] -= dt;
          if (life[i] <= 0) { pos[j + 1] = -9999; col[j] = col[j + 1] = col[j + 2] = 0; continue; }
          vel[j + 1] += grav * dt; pos[j] += vel[j] * dt; pos[j + 1] += vel[j + 1] * dt; pos[j + 2] += vel[j + 2] * dt;
          const k = life[i] / max[i];
          col[j] = clamp(k * 1.8) * bright; col[j + 1] = k * k * 0.75 * bright; col[j + 2] = k * k * k * 0.25 * bright;
        }
        pa.needsUpdate = true; ca.needsUpdate = true;
      },
      dispose() { scene.remove(pts); geo.dispose(); pts.material.dispose(); },
    };
  }

  // ---------- placement ----------
  function findSpot(id, pl) {
    const ty = VEHICLE_TYPES[id], L = ty.size.L, W = ty.size.W;
    const tries = [[9, 0], [11, 0], [8, 0.5], [8, -0.5], [10, 0.9], [10, -0.9], [7, 0], [13, 0], [7.5, 1.4], [7.5, -1.4]];
    const fx = -Math.sin(pl.yaw), fz = -Math.cos(pl.yaw), chk = Math.max(W * 0.9, L * 0.4);
    for (const [d, a] of tries) {
      const ca = Math.cos(a), sa = Math.sin(a), dx = fx * ca - fz * sa, dz = fx * sa + fz * ca;
      const x = pl.x + dx * d, z = pl.z + dz * d, gy = heightAt(x, z);
      if (Math.abs(gy - pl.y) > 3.5) continue;
      const r = resolveCircle(x, z, chk, gy, ty.size.H + 0.3);
      if (Math.hypot(r.x - x, r.z - z) > 0.02) continue;
      const yaw = pl.yaw + Math.PI, ux = -Math.sin(yaw), uz = -Math.cos(yaw), sx = Math.cos(yaw), sz = -Math.sin(yaw);
      let lo = gy, hi = gy;
      for (const [f, s] of [[0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]]) {
        const h = heightAt(x + ux * L * f + sx * W * s, z + uz * L * f + sz * W * s);
        lo = Math.min(lo, h); hi = Math.max(hi, h);
      }
      if (hi - lo > 1.1) continue;
      if (raycastWorld(x, gy + 0.8, z, 0, 1, 0, 10)) continue; // needs open sky
      return { x, z, y: gy, yaw };
    }
    return null;
  }

  // ---------- flow ----------
  function use(player) {
    P = player;
    if (phase !== 'idle') return false;
    if (charges <= 0) { say('Summon spent — next life', 1600); return false; }
    if (!player.onGround) { say('Stand on solid ground', 1200); return false; }
    phase = 'picking';
    pick.style.display = 'block';
    return false; // the hand animation starts once a vessel is chosen
  }
  function choose(id) {
    if (phase !== 'picking' || !P || !VEHICLE_TYPES[id]) return;
    closePicker();
    if (!P.alive) return;
    const spot = findSpot(id, P);
    if (!spot) { say('No room here — find open, level ground', 2000); return; }
    const v = vehicles.spawnAt({ type: id, x: spot.x, y: spot.y, z: spot.z, yaw: spot.yaw });
    if (!v) { say('The pit refuses — try elsewhere', 1800); return; }
    charges = 0; phase = 'ritual'; t = 0; nextBeat = 0;
    for (const k in flags) delete flags[k];
    buildWorld(v, id);
    startBed();
    caption('THE SEAL IS CUT…', 1800);
    try { audio.play('draw'); } catch (_) {}
    if (playAnim) playAnim();
  }
  function digit(i) {
    if (phase !== 'picking') return false;
    if (i >= 0 && i < SUMMON_TYPES.length) choose(SUMMON_TYPES[i]);
    return true;
  }

  function buildWorld(v, id) {
    const ty = VEHICLE_TYPES[id], cx = v.x, cz = v.z, gy = v.y;
    const RP = Math.hypot(ty.size.L / 2, ty.size.W / 2) + 0.55, RS = RP * 2.7;
    const W = { v, id, cx, cz, gy, RP, RS, bx: v.x, by: v.y, bz: v.z, D: ty.size.H + 0.5, lastOpen: -1, sigDone: false, objs: [] };
    const mk = (geo, mat, order) => { const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.renderOrder = order; m.visible = false; scene.add(m); W.objs.push(m); return m; };
    const po = (f) => ({ polygonOffset: true, polygonOffsetFactor: f, polygonOffsetUnits: f });
    W.sigGeo = makeDisc(12, 64, true);
    W.sig = mk(W.sigGeo, new THREE.MeshBasicMaterial({ map: sigilTex(), opacity: 0, side: THREE.DoubleSide, ...ADD, ...po(-1) }), 2);
    W.sig.material.map.center.set(0.5, 0.5);
    W.voidGeo = makeDisc(6, 48, true);
    W.void = mk(W.voidGeo, new THREE.MeshBasicMaterial({ map: voidTex(), side: THREE.DoubleSide, toneMapped: false, ...po(-2) }), 3);
    W.rimGeo = makeDisc(2, 48, false);
    W.rim = mk(W.rimGeo, new THREE.MeshBasicMaterial({ map: rimTex(), opacity: 0, side: THREE.DoubleSide, ...ADD, ...po(-3) }), 4);
    // bone thorns around the rim
    const sg = new THREE.ConeGeometry(0.16, 1.9, 5); sg.translate(0, 0.95, 0);
    const sm = new THREE.MeshStandardMaterial({ color: 0x140808, roughness: 0.8, metalness: 0.2, emissive: 0x3a0600, emissiveIntensity: 0.5 });
    W.spikeGeo = sg; W.spikeMat = sm; W.spikes = [];
    for (let i = 0; i < 14; i++) {
      const g = new THREE.Group(), c = new THREE.Mesh(sg, sm);
      c.rotation.z = -(0.25 + Math.random() * 0.35); c.scale.set(1, 0.7 + Math.random() * 0.8, 1); c.castShadow = true;
      g.add(c); g.visible = false; scene.add(g);
      W.spikes.push({ g, a: (i / 14) * TAU + rnd(-0.12, 0.12), delay: rnd(0, 0.9) });
    }
    // orbiting glyphs
    W.glyphs = [];
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glyphTex(i % 4), opacity: 0, color: 0xff6a3a, ...ADD }));
      s.scale.set(1.3, 1.3, 1); s.visible = false; scene.add(s);
      W.glyphs.push({ s, a: (i / 6) * TAU, i });
    }
    W.embers = makePool(220, 0.17, 1, 1);
    W.flames = makePool(54, 1.3, 0.55, 0.7);
    W.light = new THREE.PointLight(0xff3a12, 0, 60, 2); W.light.position.set(cx, gy + 2, cz); scene.add(W.light);
    // hellfire "eyes" (headlights) attached to the vehicle
    W.eyes = (EYES[id] || EYES.sedan).map((p) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color: 0xff2210, opacity: 0, ...ADD }));
      s.position.set(p[0], p[1], p[2]); s.scale.set(1.7, 1.7, 1); v.mesh.add(s); return s;
    });
    fillDisc(W.sigGeo, cx, cz, 0, 0.01, 0.05);
    R = W;
  }

  function disposeWorld(W) {
    for (const o of W.objs) { scene.remove(o); o.geometry.dispose(); o.material.dispose(); }
    for (const s of W.spikes) scene.remove(s.g);
    W.spikeGeo.dispose(); W.spikeMat.dispose();
    for (const g of W.glyphs) { scene.remove(g.s); g.s.material.dispose(); }
    W.embers.dispose(); W.flames.dispose(); scene.remove(W.light);
  }

  function finish(abort) {
    const W = R; if (!W) return;
    const v = W.v;
    if (v) {
      v.x = W.bx; v.y = W.by; v.z = W.bz; v.awake = false; v.sleepT = 0;
      if (v.alive) { v.hp = v.type.hp; v.gas = v.type.tank; }
    }
    if (!abort && v && v.mesh) after.push({ eyes: W.eyes, mesh: v.mesh, t: 0 });
    else for (const e of W.eyes) { if (e.parent) e.parent.remove(e); e.material.dispose(); }
    disposeWorld(W);
    R = null; phase = 'idle';
    tint.style.opacity = vig.style.opacity = flash.style.opacity = '0';
    if (abort) { stopBed(); cap.style.opacity = '0'; }
    else { caption('RISE.', 1800); hud.setMsg('Your vessel has risen — walk up and press E', 2800); }
  }

  function updateRitual(dt) {
    const W = R, v = W.v, k = (a, b) => ramp(t, a, b);
    t += dt;
    // vehicle: hidden underground, then rises out of the pit
    if (v && v.alive) {
      const e = eOut3(k(3.5, 6.0)), j = e > 0 ? (1 - e) * 0.05 : 0;
      v.hp = v.type.hp; v.awake = false; v.sleepT = 0;
      v.x = W.bx + (Math.random() - 0.5) * 2 * j; v.z = W.bz + (Math.random() - 0.5) * 2 * j;
      v.y = W.by - W.D * (1 - e);
    }
    const fadeOut = 1 - k(6.6, DUR);
    // sigil
    W.sig.visible = true;
    if (!W.sigDone) {
      fillDisc(W.sigGeo, W.cx, W.cz, 0, Math.max(0.05, W.RS * eOut3(k(0.05, 1.7))), 0.05);
      if (t >= 1.9) W.sigDone = true;
    }
    W.sig.material.opacity = 0.95 * k(0.05, 0.8) * fadeOut * (0.85 + 0.15 * Math.sin(t * 9));
    W.sig.material.map.rotation = t * 0.35;
    // pit
    const open = eOut2(k(1.4, 3.3)) * (1 - eIn2(k(6.5, DUR)));
    if (Math.abs(open - W.lastOpen) > 1e-4) {
      W.lastOpen = open;
      const r = W.RP * open;
      W.void.visible = W.rim.visible = r > 0.06;
      if (r > 0.06) { fillDisc(W.voidGeo, W.cx, W.cz, 0, r, 0.07); fillDisc(W.rimGeo, W.cx, W.cz, r, r + 0.7, 0.09); }
    }
    W.void.material.map.rotation = -t * 0.9;
    W.rim.material.opacity = 0.95 * (0.8 + 0.2 * Math.sin(t * 12)) * (open > 0 ? 1 : 0);
    const rP = W.RP * open;
    // thorns
    const close = 1 - k(6.4, 7.2);
    for (const s of W.spikes) {
      const sc = eOut3(ramp(t, 1.7 + s.delay, 2.9 + s.delay)) * close;
      s.g.visible = sc > 0.01;
      if (!s.g.visible) continue;
      const rad = rP + 0.8, x = W.cx + Math.cos(s.a) * rad, z = W.cz + Math.sin(s.a) * rad;
      s.g.position.set(x, heightAt(x, z) - 0.15, z);
      s.g.rotation.y = -s.a; s.g.scale.y = sc;
    }
    // glyphs
    for (const g of W.glyphs) {
      const a = g.a + t * 0.9, rad = W.RP + 2.2 + 0.4 * Math.sin(t * 1.3 + g.i);
      g.s.position.set(W.cx + Math.cos(a) * rad, W.gy + 1.3 + Math.min(t * 0.3, 1.6) + 0.4 * Math.sin(t * 2 + g.i), W.cz + Math.sin(a) * rad);
      g.s.material.opacity = 0.85 * ramp(t, 1.6 + 0.12 * g.i, 2.6 + 0.12 * g.i) * (1 - k(6.3, DUR));
      g.s.visible = g.s.material.opacity > 0.01;
    }
    // embers + flames
    const inten = k(1.3, 2.2) * (1 - k(6.5, DUR)) + (t > 3.5 && t < 5.8 ? 0.5 : 0);
    const spawn = (pool, rate, vy0, vy1, big) => {
      W['acc' + big] = (W['acc' + big] || 0) + rate * inten * dt;
      while (W['acc' + big] >= 1 && rP > 0.4) {
        W['acc' + big]--;
        const a = rnd(0, TAU), rad = Math.sqrt(Math.random()) * rP * 0.95, x = W.cx + Math.cos(a) * rad, z = W.cz + Math.sin(a) * rad;
        pool.spawn(x, W.gy + 0.1, z, -Math.sin(a) * 1.4, rnd(vy0, vy1), Math.cos(a) * 1.4, rnd(0.8, 1.8));
      }
    };
    spawn(W.embers, 110, 2.5, 8, 0); spawn(W.flames, 26, 2.5, 5, 1);
    W.embers.step(dt, -1.5); W.flames.step(dt, 0.5);
    // light + overlays
    flashV = Math.max(0, flashV - dt * 2.2);
    W.light.intensity = (650 * k(0.3, 2.0) * fadeOut * (0.85 + 0.15 * Math.sin(t * 17))) + 900 * flashV;
    const dark = k(0, 1.4) * (1 - k(6.4, DUR + 0.3));
    vig.style.opacity = (0.95 * dark).toFixed(3); tint.style.opacity = (0.35 * dark).toFixed(3); flash.style.opacity = (0.6 * flashV).toFixed(3);
    // eyes
    for (const e of W.eyes) e.material.opacity = k(4.6, 6.2) * (0.85 + 0.15 * Math.sin(t * 8));
    // camera shake
    if (P) P.shake = Math.max(P.shake || 0, 0.015 * k(0.2, 1.2) + 0.06 * pulse(t, 1.4, 0.5) + 0.05 * k(3.5, 3.8) * (1 - k(5.8, 6.2)) + 0.08 * pulse(t, 6.0, 0.4));
    // heartbeat
    if (t >= nextBeat) { thump(); nextBeat = t + 0.95 - 0.45 * k(0, 6); }
    // events
    if (t >= 1.45 && !flags.e1) { flags.e1 = 1; boom(1); flashV = 1; caption('OPEN', 1300); try { audio.play('thud', W.cx, W.cz); } catch (_) {} }
    if (t >= 3.5 && !flags.e2) {
      flags.e2 = 1; boom(1.3); flashV = 0.8; caption('SOMETHING ANSWERS', 1800);
      for (let i = 0; i < 60; i++) { const a = rnd(0, TAU), r = Math.sqrt(Math.random()) * rP; W.embers.spawn(W.cx + Math.cos(a) * r, W.gy + 0.1, W.cz + Math.sin(a) * r, rnd(-2, 2), rnd(5, 12), rnd(-2, 2), rnd(1, 2)); }
      try { if (navigator.vibrate) navigator.vibrate([40, 50, 40]); } catch (_) {}
    }
    if (t >= 6.0 && !flags.e3) { flags.e3 = 1; boom(0.8); flashV = 1; }
    if (t >= DUR) finish(false);
  }

  function update(dt, player) {
    P = player;
    const now = performance.now();
    if (cap.style.opacity === '1' && now > capUntil) cap.style.opacity = '0';
    for (let i = after.length - 1; i >= 0; i--) {
      const a = after[i]; a.t += dt;
      const o = Math.max(0, 1 - a.t / 4);
      for (const e of a.eyes) e.material.opacity = o * (0.8 + 0.2 * Math.sin(a.t * 6));
      if (o <= 0) { for (const e of a.eyes) { if (e.parent) e.parent.remove(e); e.material.dispose(); } after.splice(i, 1); }
    }
    if (phase === 'picking' && (!player.alive || player.weaponId !== 'summon')) closePicker();
    if (phase === 'ritual') {
      if (!player.alive) { finish(true); return; }
      updateRitual(dt);
    }
  }

  function onRespawn() {
    if (R) finish(true);
    closePicker();
    charges = 1; phase = 'idle'; flashV = 0;
    tint.style.opacity = vig.style.opacity = flash.style.opacity = '0';
    cap.style.opacity = '0';
  }

  return {
    use, update, onRespawn, digit,
    busy: () => phase === 'ritual',
    isPicking: () => phase === 'picking',
    wantsCrouch: () => phase === 'ritual' && t > 1.6 && t < 6.0,
    get charges() { return charges; },
    get phase() { return phase; },
  };
}
