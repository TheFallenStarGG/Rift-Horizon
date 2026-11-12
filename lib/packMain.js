/**
 * Special PRIMARIES. Each one trades scoping for an ability on the aim button.
 *   Hailstorm LMG  - Overdrive    (free, near-recoilless rapid fire)
 *   Aegis Carbine  - Barrier      (shield soaks 100 damage)
 *   Spectre Rifle  - Phase Rounds (shoot through walls)
 *   Sentinel BR    - Pulse Scan   (reveal + mark enemies, +20% damage)
 *   Gale Scattergun- Blast Jump   (launch yourself)
 */
import * as THREE from 'three';
import { WEAPONS, ALL } from './arsenal.js';
import { MODELS, ABILITIES } from './registry.js';
import { boxMag, shellReload, PUMP_CYCLE, gun } from './reloadKit.js';

const special = (o) => gun({ noAds: true, adsMove: 1, adsZoom: 1, ...o });
const rack = (o, pull) => ({ hand: 'L', part: 'charge', o, pull });

// ---------------------------------------------------------------- stats
const DEFS = [
  special({
    id: 'hailstorm', slot: 'main', name: 'Hailstorm LMG', model: 'lmg', cls: 'long', auto: true, ability: 'overdrive',
    blurb: 'Belt-fed bruiser. AIM = Overdrive: 4.5s of free, near-recoilless rapid fire.',
    cd: 0.085, mag: 75, total: 225, move: 0.9, draw: 0.65,
    dmg: { head: 30, body: 15, limb: 11 }, falloff: { start: 25, end: 60, min: 0.6 },
    spread: { hip: 0.026, ads: 0.026 }, recoil: 0.013,
    reload: boxMag(4.4, { seat: [-0.03, -0.08, 0.05], drop: 0.3, rack: rack([-0.03, -0.02, 0.04], [0, 0, 0.09]) }),
  }),
  special({
    id: 'aegis', slot: 'main', name: 'Aegis Carbine', model: 'carbine', cls: 'long', auto: true, ability: 'barrier',
    blurb: 'Tight, steady carbine. AIM = Barrier: a shield that soaks 100 damage for 6s.',
    cd: 0.105, mag: 28, total: 140, draw: 0.4,
    dmg: { head: 38, body: 19, limb: 13 }, falloff: { start: 30, end: 65, min: 0.65 },
    spread: { hip: 0.014, ads: 0.014 }, recoil: 0.012,
    reload: boxMag(2.6, { seat: [-0.025, -0.07, 0.045], drop: 0.22, rack: rack([-0.04, -0.01, 0.03], [0, 0, 0.08]) }),
  }),
  special({
    id: 'spectre', slot: 'main', name: 'Spectre Phase Rifle', model: 'phase', cls: 'long', auto: false, ability: 'phase',
    blurb: 'Hard-hitting semi-auto. AIM = Phase Rounds: 6s of shots that pass through walls (80% damage).',
    cd: 0.36, mag: 10, total: 50, move: 0.97, draw: 0.55, bulletSpeed: 320,
    dmg: { head: 90, body: 45, limb: 30 }, spread: { hip: 0.011, ads: 0.011 }, recoil: 0.035,
    reload: boxMag(3.1, { seat: [-0.025, -0.065, 0.045], drop: 0.18, rack: rack([-0.03, 0, 0.05], [0, 0, 0.1]) }),
  }),
  special({
    id: 'sentinel', slot: 'main', name: 'Sentinel Battle Rifle', model: 'battle', cls: 'long', auto: false, ability: 'scan',
    blurb: 'Punchy semi-auto. AIM = Pulse Scan: reveals and marks enemies through walls (+20% damage).',
    cd: 0.18, mag: 20, total: 100, draw: 0.5, bulletSpeed: 280,
    dmg: { head: 56, body: 28, limb: 19 }, falloff: { start: 35, end: 80, min: 0.7 },
    spread: { hip: 0.012, ads: 0.012 }, recoil: 0.028,
    reload: boxMag(2.9, { seat: [-0.025, -0.07, 0.05], drop: 0.2, rack: rack([-0.05, -0.02, 0.04], [0, 0, 0.09]) }),
  }),
  special({
    id: 'gale', slot: 'main', name: 'Gale Scattergun', model: 'scatter', cls: 'long', auto: false, ability: 'blast',
    blurb: 'Fast pump shotgun. AIM = Blast Jump: launch yourself where you look (aim down for height).',
    cd: 0.6, mag: 6, total: 36, pellets: 7, move: 0.98, draw: 0.5,
    dmg: { head: 17, body: 10, limb: 6 }, falloff: { start: 5, end: 17, min: 0.15 },
    spread: { hip: 0.05, ads: 0.05 }, recoil: 0.05, cycle: PUMP_CYCLE,
    reload: shellReload({ start: 0.45, per: 0.5, end: 0.5 }, 6),
  }),
];
for (const d of DEFS) { WEAPONS[d.id] = d; ALL[d.id] = d; }

// ---------------------------------------------------------------- models
// K = weaponModels.js toolkit. Gun space: -Z forward, +Y up. Anchors drive the hands during reloads.
MODELS.lmg = (tex, K) => {
  const { V, RB, B, CY, H } = K, c = K.ctx(tex), { M, g, p, node } = c;
  p(RB(0.062, 0.09, 0.32, 0.01), M.gun, 0, -0.01, 0.02);
  p(RB(0.05, 0.03, 0.2, 0.008), M.gunDark, 0, 0.06, -0.02);
  p(CY(0.0165, 0.0165, 0.52, 12), M.gunDark, 0, 0.02, -0.42, H);
  p(CY(0.028, 0.028, 0.28, 14), M.gun, 0, 0.02, -0.3, H);
  for (let i = 0; i < 5; i++) p(B(0.06, 0.006, 0.012), M.black, 0, 0.02, -0.2 - i * 0.045);
  p(CY(0.022, 0.022, 0.06, 12), M.black, 0, 0.02, -0.7, H);
  p(B(0.006, 0.03, 0.006), M.black, 0, 0.052, -0.72);
  p(RB(0.048, 0.1, 0.3, 0.012), M.poly, 0, -0.03, 0.3, 0.05);
  p(B(0.05, 0.1, 0.014), M.rubber, 0, -0.035, 0.455);
  p(RB(0.034, 0.1, 0.042, 0.01), M.poly, 0, -0.105, 0.11, -0.25);
  p(B(0.008, 0.006, 0.075), M.gunDark, 0, -0.075, 0);
  for (const s of [-1, 1]) p(B(0.008, 0.16, 0.008), M.steel, s * 0.034, -0.07, -0.5, 0.35, 0, s * 0.35); // folded bipod
  p(RB(0.02, 0.03, 0.2, 0.006), M.gunDark, 0, 0.09, -0.02);                                            // carry handle
  const mag = K.smallMag(M, 0.12);
  mag.scale.set(1.8, 1, 2.3);
  mag.position.set(0, -0.058, -0.04);
  g.add(mag);
  const ch = node(0.04, 0.05, 0.05);
  p(RB(0.016, 0.014, 0.034, 0.003), M.steel, 0, 0, 0, 0, 0, 0, ch);
  return K.out(c, {
    cls: 'long', sightY: 0.1, adsZ: 0.38,
    anchors: { grip: V(0.012, -0.15, 0.115), fore: V(0, -0.075, -0.26), mag: V(0, -0.058, -0.04), port: V(0.01, 0.03, -0.04), handle: V(0.04, 0.05, 0.05) },
    mag, magHome: V(0, -0.058, -0.04), magTilt: 0,
    parts: { charge: { set: (v) => { ch.position.z = 0.05 + v * 0.09; } } },
    muzzle: node(0, 0.02, -0.735), eject: node(0.035, 0.03, 0),
  });
};

MODELS.carbine = (tex, K) => {
  const { V, RB, B, CY, H, THREE } = K, c = K.ctx(tex), { M, g, p, node } = c;
  const glow = new THREE.MeshStandardMaterial({ color: 0x59d8ff, emissive: 0x23b8ff, emissiveIntensity: 1.4, roughness: 0.3 });
  p(RB(0.05, 0.085, 0.36, 0.01), M.poly, 0, -0.01, 0.06);
  p(RB(0.044, 0.04, 0.3, 0.008), M.gun, 0, 0.04, -0.02);
  p(CY(0.014, 0.014, 0.3, 12), M.gunDark, 0, 0.02, -0.34, H);
  p(CY(0.032, 0.032, 0.03, 16), glow, 0, 0.02, -0.4, H);   // shield emitter
  p(CY(0.04, 0.04, 0.012, 16), M.black, 0, 0.02, -0.425, H);
  p(B(0.052, 0.006, 0.12), glow, 0, 0.066, 0.02);          // status strip
  p(B(0.01, 0.03, 0.2), M.black, 0, 0.082, -0.04);
  p(B(0.052, 0.1, 0.014), M.rubber, 0, -0.03, 0.245);
  p(RB(0.034, 0.1, 0.042, 0.01), M.poly, 0, -0.1, 0.1, -0.3);
  p(B(0.008, 0.006, 0.07), M.gunDark, 0, -0.065, 0.01);
  const mag = K.smallMag(M, 0.1);
  mag.position.set(0, -0.05, -0.02);
  g.add(mag);
  const ch = node(0.03, 0.045, 0.04);
  p(RB(0.014, 0.012, 0.03, 0.003), M.steel, 0, 0, 0, 0, 0, 0, ch);
  return K.out(c, {
    cls: 'long', sightY: 0.09, adsZ: 0.36,
    anchors: { grip: V(0.012, -0.145, 0.12), fore: V(0, -0.07, -0.22), mag: V(0, -0.05, -0.02), port: V(0.01, 0.03, 0), handle: V(0.03, 0.045, 0.04) },
    mag, magHome: V(0, -0.05, -0.02), magTilt: 0,
    parts: { charge: { set: (v) => { ch.position.z = 0.04 + v * 0.08; } } },
    muzzle: node(0, 0.02, -0.44), eject: node(0.03, 0.03, 0.02),
  });
};

MODELS.phase = (tex, K) => {
  const { V, RB, B, CY, H, THREE } = K, c = K.ctx(tex), { M, g, p, node } = c;
  const glow = new THREE.MeshStandardMaterial({ color: 0xa78bff, emissive: 0x7a4dff, emissiveIntensity: 1.5, roughness: 0.3 });
  p(RB(0.048, 0.07, 0.3, 0.01), M.gun, 0, -0.01, 0.04);
  p(RB(0.04, 0.05, 0.4, 0.01), M.gunDark, 0, 0.012, -0.3);
  p(B(0.01, 0.012, 0.42), glow, 0.026, 0.014, -0.3);
  p(B(0.01, 0.012, 0.42), glow, -0.026, 0.014, -0.3);
  p(CY(0.012, 0.012, 0.2, 12), M.black, 0, 0.012, -0.62, H);
  p(CY(0.022, 0.022, 0.03, 12), glow, 0, 0.012, -0.73, H);
  p(RB(0.044, 0.09, 0.26, 0.012), M.poly, 0, -0.03, 0.28, 0.05);
  p(B(0.046, 0.09, 0.012), M.rubber, 0, -0.035, 0.41);
  p(RB(0.034, 0.1, 0.042, 0.01), M.poly, 0, -0.1, 0.1, -0.28);
  p(B(0.008, 0.006, 0.07), M.gunDark, 0, -0.065, 0);
  p(CY(0.016, 0.016, 0.12, 12), M.black, 0, 0.065, -0.1, H);
  const mag = K.smallMag(M, 0.09);
  mag.position.set(0, -0.055, -0.02);
  g.add(mag);
  const ch = node(0.03, 0.02, 0.02);
  p(RB(0.014, 0.012, 0.03, 0.003), M.steel, 0, 0, 0, 0, 0, 0, ch);
  return K.out(c, {
    cls: 'long', sightY: 0.08, adsZ: 0.36,
    anchors: { grip: V(0.012, -0.15, 0.115), fore: V(0, -0.075, -0.25), mag: V(0, -0.055, -0.02), port: V(0.01, 0.02, 0), handle: V(0.03, 0.02, 0.02) },
    mag, magHome: V(0, -0.055, -0.02), magTilt: 0,
    parts: { charge: { set: (v) => { ch.position.z = 0.02 + v * 0.1; } } },
    muzzle: node(0, 0.012, -0.75), eject: node(0.03, 0.02, 0.02),
  });
};

MODELS.battle = (tex, K) => {
  const { V, RB, B, CY, SP, H, THREE } = K, c = K.ctx(tex), { M, g, p, node } = c;
  const sensor = new THREE.MeshStandardMaterial({ color: 0xff8a5a, emissive: 0xff5a2a, emissiveIntensity: 1.1, roughness: 0.35 });
  p(RB(0.052, 0.08, 0.3, 0.01), M.gun, 0, -0.01, 0.03);
  p(RB(0.048, 0.05, 0.34, 0.008), M.gunDark, 0, 0.02, -0.28);
  p(CY(0.014, 0.014, 0.3, 12), M.black, 0, 0.014, -0.58, H);
  p(CY(0.019, 0.019, 0.05, 12), M.black, 0, 0.014, -0.74, H);
  p(B(0.03, 0.02, 0.22), M.gun, 0, 0.072, -0.02);
  const dish = node(0, 0.1, -0.1);                                  // sensor dish
  p(CY(0.034, 0.014, 0.014, 16), sensor, 0, 0.012, 0, 0, 0, 0, dish);
  p(CY(0.004, 0.004, 0.04, 6), M.steel, 0, -0.01, 0, 0, 0, 0, dish);
  p(SP(0.007), sensor, 0, 0.03, 0, 0, 0, 0, dish);
  p(RB(0.046, 0.095, 0.28, 0.012), M.poly, 0, -0.03, 0.27, 0.04);
  p(B(0.048, 0.1, 0.014), M.rubber, 0, -0.035, 0.41);
  p(RB(0.034, 0.1, 0.042, 0.01), M.poly, 0, -0.1, 0.1, -0.28);
  p(B(0.008, 0.006, 0.07), M.gunDark, 0, -0.07, 0);
  const mag = K.smallMag(M, 0.11);
  mag.position.set(0, -0.055, -0.03);
  g.add(mag);
  const ch = node(0.035, 0.03, 0.03);
  p(RB(0.014, 0.012, 0.03, 0.003), M.steel, 0, 0, 0, 0, 0, 0, ch);
  return K.out(c, {
    cls: 'long', sightY: 0.085, adsZ: 0.36,
    anchors: { grip: V(0.012, -0.15, 0.115), fore: V(0, -0.075, -0.3), mag: V(0, -0.055, -0.03), port: V(0.01, 0.03, 0), handle: V(0.035, 0.03, 0.03) },
    mag, magHome: V(0, -0.055, -0.03), magTilt: 0,
    parts: { charge: { set: (v) => { ch.position.z = 0.03 + v * 0.09; } } },
    muzzle: node(0, 0.014, -0.775), eject: node(0.03, 0.03, 0.02),
  });
};

MODELS.scatter = (tex, K) => {
  const { V, RB, B, CY, H, THREE } = K, c = K.ctx(tex), { M, p, node } = c;
  const glow = new THREE.MeshStandardMaterial({ color: 0xbff3ff, emissive: 0x7fe3ff, emissiveIntensity: 1.2, roughness: 0.3 });
  p(RB(0.056, 0.085, 0.22, 0.01), M.gun, 0, -0.01, 0.03);
  p(CY(0.02, 0.02, 0.36, 12), M.gunDark, 0, 0.022, -0.26, H);
  p(CY(0.03, 0.022, 0.07, 12), M.black, 0, 0.022, -0.47, H);
  p(CY(0.034, 0.034, 0.008, 16), glow, 0, 0.022, -0.435, H);  // blast ring
  p(CY(0.016, 0.016, 0.3, 12), M.gunDark, 0, -0.022, -0.22, H);
  p(B(0.012, 0.006, 0.34), M.steel, 0, 0.046, -0.26);
  const pump = node(0, -0.034, -0.22);
  p(RB(0.055, 0.05, 0.13, 0.012), M.poly, 0, 0, 0, 0, 0, 0, pump);
  for (let i = 0; i < 4; i++) p(B(0.058, 0.006, 0.01), M.black, 0, -0.01, -0.045 + i * 0.03, 0, 0, 0, pump);
  p(RB(0.046, 0.09, 0.24, 0.014), M.poly, 0, -0.035, 0.26, 0.06);
  p(B(0.048, 0.1, 0.014), M.rubber, 0, -0.04, 0.39);
  p(RB(0.034, 0.1, 0.042, 0.01), M.poly, 0, -0.1, 0.1, -0.28);
  p(B(0.008, 0.006, 0.07), M.gunDark, 0, -0.07, -0.02);
  return K.out(c, {
    cls: 'long', sightY: 0.06, adsZ: 0.36,
    anchors: { grip: V(0.012, -0.15, 0.155), fore: V(0, -0.088, -0.22), port: V(0, -0.055, -0.02), handle: V(0, -0.088, -0.22) },
    parts: { pump: { set: (v) => { pump.position.z = -0.22 + v * 0.13; } } },
    muzzle: node(0, 0.022, -0.51), eject: node(0.028, 0.03, 0.04),
  }, ['shell']);
};

// ---------------------------------------------------------------- abilities
ABILITIES.overdrive = (A) => {
  let t = 0;
  return {
    name: 'OVERDRIVE', cd: 22,
    use() { t = 4.5; A.audio.play('crossLatch'); A.msg('OVERDRIVE', 900); return true; },
    status: () => (t > 0 ? `${t.toFixed(1)}s` : ''),
    update(dt, m) {
      if (t <= 0) return;
      t -= dt;
      m.fireCd *= 0.6; m.recoil *= 0.3; m.spread *= 0.6; m.speed *= 0.85; m.noAmmo = true;
      if (t <= 0) A.msg('Overdrive ended', 700);
    },
    reset() { t = 0; },
  };
};

ABILITIES.barrier = (A) => {
  const dome = new THREE.Mesh(new THREE.SphereGeometry(1.15, 20, 14), new THREE.MeshBasicMaterial({
    color: 0x4cc9ff, transparent: true, opacity: 0.14, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
  }));
  dome.visible = false;
  A.scene.add(dome);
  let hp = 0, t = 0, pulse = 0;
  const end = () => { t = 0; hp = 0; dome.visible = false; };
  return {
    name: 'BARRIER', cd: 20, solo: true,
    use() { hp = 100; t = 6; A.audio.play('crossLatch'); A.msg('BARRIER UP', 900); return true; },
    status: () => (t > 0 ? `${Math.ceil(hp)} HP` : ''),
    update(dt, m) {
      pulse = Math.max(0, pulse - dt * 4);
      if (t <= 0) return;
      t -= dt;
      const p = A.player;
      dome.position.set(p.x, p.y + 1, p.z);
      dome.visible = p.thirdPerson && p.alive;
      dome.material.opacity = 0.12 + pulse * 0.3 + 0.03 * Math.sin(performance.now() / 120);
      m.speed *= 0.94;
      if (t <= 0) { end(); A.msg('Barrier down', 700); }
    },
    absorb(d) {
      if (t <= 0 || hp <= 0) return d;
      const a = Math.min(hp, d);
      hp -= a; pulse = 1;
      A.audio.play('clang');
      if (hp <= 0) { end(); A.msg('BARRIER BROKEN', 900); }
      return d - a;
    },
    reset: end,
  };
};

ABILITIES.phase = (A) => {
  let t = 0;
  return {
    name: 'PHASE ROUNDS', cd: 26,
    use() { t = 6; A.audio.play('crossLatch'); A.msg('PHASE ROUNDS: shots pass through walls', 1200); return true; },
    status: () => (t > 0 ? `${t.toFixed(1)}s` : ''),
    update(dt, m) {
      if (t <= 0) return;
      t -= dt; m.pierce = true;
      if (t <= 0) A.msg('Phase rounds ended', 700);
    },
    reset() { t = 0; },
  };
};

ABILITIES.scan = (A) => {
  const RANGE = 70, DUR = 6;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const x = cv.getContext('2d');
  x.strokeStyle = '#ff5a3c'; x.lineWidth = 7; x.lineJoin = 'round';
  x.beginPath(); x.moveTo(32, 6); x.lineTo(58, 32); x.lineTo(32, 58); x.lineTo(6, 32); x.closePath(); x.stroke();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xff7a4a, transparent: true, side: THREE.DoubleSide, depthWrite: false, fog: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.97, 1, 64), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  A.scene.add(ring);
  const marks = new Map();
  let t = 0, ringT = 0;
  const drop = (id) => { const m = marks.get(id); if (m) { A.scene.remove(m.s); m.s.material.dispose(); marks.delete(id); } };
  return {
    name: 'PULSE SCAN', cd: 28,
    use() { t = DUR; ringT = 0.8; A.audio.play('crossCock'); A.msg('PULSE SCAN', 900); return true; },
    status: () => (t > 0 ? `MARKING ${Math.ceil(t)}s` : ''),
    update(dt) {
      const p = A.player, now = performance.now() / 1000;
      if (ringT > 0) {
        ringT -= dt;
        const u = 1 - Math.max(0, ringT) / 0.8;
        ring.visible = ringT > 0;
        ring.position.set(p.x, p.y + 0.1, p.z);
        ring.scale.setScalar(2 + u * RANGE);
        ringMat.opacity = 0.75 * (1 - u);
      }
      const seen = new Set();
      if (t > 0) {
        t -= dt;
        for (const c of A.targets()) {
          const d = Math.hypot(c.x - p.x, c.z - p.z);
          if (!c.alive || d > RANGE) continue;
          seen.add(c.id);
          let m = marks.get(c.id);
          if (!m) {
            const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true, fog: false }));
            s.renderOrder = 999;
            A.scene.add(s);
            m = { s };
            marks.set(c.id, m);
          }
          m.s.position.set(c.x, (c.y || 0) + 2.3, c.z);
          m.s.scale.setScalar(0.45 + d * 0.012);
          c.markUntil = now + 0.3; // player.js: +20% damage while marked
        }
      }
      for (const id of [...marks.keys()]) if (!seen.has(id)) drop(id);
    },
    reset() { t = 0; ringT = 0; ring.visible = false; for (const id of [...marks.keys()]) drop(id); },
  };
};

const _l = new THREE.Vector3();
ABILITIES.blast = (A) => ({
  name: 'BLAST JUMP', cd: 10,
  use() {
    const p = A.player;
    A.look(_l);
    const hz = Math.hypot(_l.x, _l.z) || 1, down = Math.max(0, -_l.y);
    const hv = 16 * Math.min(1, hz) * (1 - down * 0.6);
    p.vx += (_l.x / hz) * hv;
    p.vz += (_l.z / hz) * hv;
    p.velY = 9.5 + down * 5;
    p.onGround = false; p.jumps = 1;
    A.bullets.muzzleFlash(_l.set(p.x, p.y + 0.15, p.z));
    p.shake = Math.max(p.shake || 0, 0.05);
    A.audio.play('shot', undefined, undefined, { snd: 'breacher' });
    return true;
  },
});
