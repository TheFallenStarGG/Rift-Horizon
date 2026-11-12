/**
 * Special SECONDARIES. The aim button fires an ability instead of scoping.
 *   Cinder Flare Pistol - Firestorm      (burning zone where you aim)
 *   Lifeline Injector   - Mend           (heal 45 HP over 3s)
 *   Wisp Machine Pistol - Phase Dash     (9m dash with brief invulnerability)
 *   Snare Tack Pistol   - Proximity Mine (up to 2 mines)
 *   Beacon Pistol       - Recall Beacon  (plant, then teleport back)
 */
import * as THREE from 'three';
import { WEAPONS, ALL } from './arsenal.js';
import { MODELS, ABILITIES } from './registry.js';
import { boxMag, gun } from './reloadKit.js';
import { raycastWorld, resolveCircle, floorAt } from './collision.js';

const special = (o) => gun({ noAds: true, adsMove: 1, adsZoom: 1, cls: 'short', slot: 'side', ...o });
const slide = (o, pull = 0.04) => ({ hand: 'L', part: 'slide', o: [-0.045, -0.03, 0.05], pull: [0, 0, pull], ...o });

// ---------------------------------------------------------------- stats
const DEFS = [
  special({
    id: 'cinder', name: 'Cinder Flare Pistol', model: 'flare', auto: false, ability: 'firestorm',
    blurb: 'Heavy flare pistol. AIM = Firestorm: a 6s burning zone where you aim (22 dmg/s).',
    cd: 0.35, mag: 8, total: 48, draw: 0.4,
    dmg: { head: 55, body: 28, limb: 20 }, falloff: { start: 20, end: 50, min: 0.6 },
    spread: { hip: 0.012, ads: 0.012 }, recoil: 0.04,
    reload: boxMag(1.9, { seat: [-0.02, -0.17, 0.03], drop: 0.14, rack: slide() }),
  }),
  special({
    id: 'lifeline', name: 'Lifeline Injector', model: 'injector', auto: false, ability: 'mend',
    blurb: 'Light, accurate pistol. AIM = Mend: heal 45 HP over 3s (30s cooldown).',
    cd: 0.16, mag: 12, total: 72, move: 1.04, draw: 0.28,
    dmg: { head: 36, body: 18, limb: 12 }, falloff: { start: 20, end: 50, min: 0.55 },
    spread: { hip: 0.012, ads: 0.012 }, recoil: 0.02,
    reload: boxMag(1.6, { seat: [-0.02, -0.17, 0.03], drop: 0.13, rack: slide() }),
  }),
  special({
    id: 'wisp', name: 'Wisp Machine Pistol', model: 'wisp', auto: true, ability: 'dash',
    blurb: 'Fast, light spray. AIM = Phase Dash: 9m burst forward, brief invulnerability.',
    cd: 0.075, mag: 24, total: 120, move: 1.08, draw: 0.28,
    dmg: { head: 22, body: 11, limb: 8 }, falloff: { start: 12, end: 28, min: 0.5 },
    spread: { hip: 0.02, ads: 0.02 }, recoil: 0.01,
    reload: boxMag(1.7, { seat: [-0.02, -0.19, 0.03], drop: 0.17, release: 'slide' }),
  }),
  special({
    id: 'snare', name: 'Snare Tack Pistol', model: 'tack', auto: false, ability: 'mine',
    blurb: 'Punchy sidearm. AIM = Proximity Mine: drop a mine (up to 2). Big damage in 5m.',
    cd: 0.3, mag: 7, total: 42, draw: 0.35,
    dmg: { head: 60, body: 30, limb: 22 }, falloff: { start: 15, end: 40, min: 0.6 },
    spread: { hip: 0.013, ads: 0.013 }, recoil: 0.045,
    reload: boxMag(2.0, { seat: [-0.02, -0.17, 0.03], drop: 0.14, rack: slide({}, 0.05) }),
  }),
  special({
    id: 'beacon', name: 'Beacon Pistol', model: 'beaconp', auto: false, ability: 'recall',
    blurb: 'Reliable semi-auto. AIM = plant a beacon, AIM again = teleport back to it.',
    cd: 0.22, mag: 10, total: 60, draw: 0.3,
    dmg: { head: 44, body: 22, limb: 15 }, falloff: { start: 20, end: 45, min: 0.6 },
    spread: { hip: 0.012, ads: 0.012 }, recoil: 0.025,
    reload: boxMag(1.8, { seat: [-0.02, -0.17, 0.03], drop: 0.14, rack: slide() }),
  }),
];
for (const d of DEFS) { WEAPONS[d.id] = d; ALL[d.id] = d; }

// ---------------------------------------------------------------- models (shared pistol body + per-gun extras)
function pistolBody(tex, K, o) {
  const { V, RB, B, CY, H } = K, c = K.ctx(tex), { M, g, p, node } = c;
  const sl = node(0, 0.016, 0);
  p(RB(0.03, 0.04, o.len || 0.2, 0.006), o.slideMat ? o.slideMat(M) : M.gun, 0, 0, -0.02, 0, 0, 0, sl);
  p(B(0.004, 0.009, 0.006), M.black, 0, 0.0245, -0.11, 0, 0, 0, sl);
  p(B(0.018, 0.011, 0.008), M.black, 0, 0.0245, 0.065, 0, 0, 0, sl);
  p(RB(0.03, 0.026, 0.18, 0.006), M.poly, 0, -0.022, -0.01);
  p(RB(0.034, 0.11, 0.05, 0.008), M.poly, 0, -0.085, 0.055, -0.18);
  p(B(0.006, 0.006, 0.06), M.gunDark, 0, -0.046, -0.03);
  p(CY(0.007, 0.007, 0.02, 8), M.black, 0, 0.016, -0.125, H);
  if (o.extra) o.extra(c, sl, K);
  const mag = K.smallMag(M, o.mag || 0.1);
  mag.position.set(0, -0.045, 0.052);
  mag.rotation.x = -0.18;
  g.add(mag);
  const st = { v: 0, kick: 0 };
  const upd = () => { sl.position.z = Math.max(st.v * 0.045, st.kick * 0.03); };
  return K.out(c, {
    cls: 'short', sightY: 0.045, adsZ: 0.44,
    anchors: { grip: V(0, -0.135, 0.115), fore: V(-0.03, -0.12, 0.03), mag: V(0, -0.045, 0.052), port: V(0, 0.03, 0.02), handle: V(0, 0.04, 0.075) },
    mag, magHome: V(0, -0.045, 0.052), magTilt: -0.18,
    parts: { slide: { set: (v) => { st.v = v; upd(); } }, kick: { set: (k) => { st.kick = k; upd(); } } },
    muzzle: node(0, 0.016, o.muzzleZ || -0.135), eject: node(0.02, 0.026, 0),
  });
}
const glowMat = (K, color, em) => new K.THREE.MeshStandardMaterial({ color, emissive: em, emissiveIntensity: 1.3, roughness: 0.3 });

MODELS.flare = (tex, K) => pistolBody(tex, K, {
  muzzleZ: -0.24, len: 0.22, mag: 0.08,
  extra({ M, p }, sl) {
    const g = glowMat(K, 0xff9a3c, 0xff5a1a);
    p(K.CY(0.022, 0.022, 0.12, 12), M.gunDark, 0, 0.014, -0.17, K.H);
    p(K.CY(0.026, 0.026, 0.012, 12), g, 0, 0.014, -0.235, K.H);
    p(K.B(0.012, 0.01, 0.1), g, 0, -0.03, -0.1);
  },
});
MODELS.injector = (tex, K) => pistolBody(tex, K, {
  len: 0.19,
  slideMat: (M) => M.steel,
  extra({ M, p }) {
    const g = glowMat(K, 0x7dffb0, 0x23d870);
    p(K.CY(0.012, 0.012, 0.14, 10), g, 0, 0.05, -0.02, K.H);
    p(K.B(0.032, 0.012, 0.03), g, 0, 0.0, 0.0);
    p(K.B(0.006, 0.026, 0.006), g, 0.0165, 0.012, 0.03);
  },
});
MODELS.wisp = (tex, K) => pistolBody(tex, K, {
  len: 0.19, mag: 0.19, muzzleZ: -0.2,
  slideMat: (M) => M.gunDark,
  extra({ M, p }) {
    const g = glowMat(K, 0x6ad0ff, 0x1a9cff);
    p(K.CY(0.016, 0.016, 0.08, 12), M.black, 0, 0.016, -0.17, K.H);
    p(K.B(0.004, 0.012, 0.14), g, 0.017, 0.016, -0.04);
    p(K.B(0.004, 0.012, 0.14), g, -0.017, 0.016, -0.04);
    p(K.B(0.026, 0.018, 0.03), M.black, 0, 0.026, -0.1);
  },
});
MODELS.tack = (tex, K) => pistolBody(tex, K, {
  len: 0.18, mag: 0.09,
  extra({ M, p }) {
    p(K.CY(0.02, 0.02, 0.07, 12), M.steel, 0, -0.05, -0.08, K.H);          // mine canister
    p(K.SP(0.008), new K.THREE.MeshBasicMaterial({ color: 0xff3030 }), 0, -0.05, -0.12);
    p(K.B(0.03, 0.014, 0.05), M.black, 0, 0.03, -0.09);
  },
});
MODELS.beaconp = (tex, K) => pistolBody(tex, K, {
  len: 0.2,
  extra({ M, p }) {
    const g = glowMat(K, 0x7affd1, 0x1fe0a8);
    p(K.CY(0.003, 0.003, 0.1, 6), M.steel, 0, 0.075, 0.04);
    p(K.SP(0.012), g, 0, 0.128, 0.04);
    p(K.B(0.032, 0.006, 0.07), g, 0, 0.0, 0.02);
  },
});

// ---------------------------------------------------------------- abilities
ABILITIES.firestorm = (A) => {
  const R = 4, DUR = 6, zones = [], _o = new THREE.Vector3(), _d = new THREE.Vector3();
  const kill = (z) => { A.scene.remove(z.m); z.m.geometry.dispose(); z.m.material.dispose(); zones.splice(zones.indexOf(z), 1); };
  return {
    name: 'FIRESTORM', cd: 25,
    use() {
      A.eye(_o); A.look(_d);
      const w = raycastWorld(_o.x, _o.y, _o.z, _d.x, _d.y, _d.z, 35), t = w ? w.t : 35;
      const x = _o.x + _d.x * t, z = _o.z + _d.z * t, y0 = _o.y + _d.y * t;
      const g = raycastWorld(x, y0 + 0.3, z, 0, -1, 0, 60), y = g ? y0 + 0.3 - g.t : A.player.y;
      const m = new THREE.Mesh(new THREE.CircleGeometry(R, 32), new THREE.MeshBasicMaterial({
        color: 0xff6a1a, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
      }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, y + 0.05, z);
      A.scene.add(m);
      zones.push({ m, x, y, z, t: DUR, tick: 0 });
      if (zones.length > 2) kill(zones[0]);
      A.bullets.muzzleFlash(_o.set(x, y + 0.4, z));
      A.audio.play('shot', undefined, undefined, { snd: 'cutter' });
      return true;
    },
    update(dt) {
      for (const z of [...zones]) {
        z.t -= dt;
        z.m.material.opacity = 0.28 + 0.12 * Math.sin(performance.now() / 90);
        z.tick -= dt;
        if (z.tick <= 0) {
          z.tick = 0.5;
          A.bullets.muzzleFlash(_o.set(z.x + (Math.random() - 0.5) * R, z.y + 0.3, z.z + (Math.random() - 0.5) * R));
          for (const c of A.targets()) {
            if (c.alive && Math.hypot(c.x - z.x, c.z - z.z) < R && Math.abs((c.y || 0) - z.y) < 3) A.hurt(c, 11, 'body');
          }
        }
        if (z.t <= 0) kill(z);
      }
    },
    reset() { while (zones.length) kill(zones[0]); },
  };
};

ABILITIES.mend = (A) => {
  let t = 0;
  return {
    name: 'MEND', cd: 30, solo: true,
    use() {
      if (A.player.hp >= A.player.maxHp - 1) { A.msg('Already at full health', 800); return false; }
      t = 3; A.audio.play('pouch'); A.msg('MENDING +45 HP', 900);
      return true;
    },
    status: () => (t > 0 ? `${t.toFixed(1)}s` : ''),
    update(dt) {
      if (t <= 0 || !A.player.alive) return;
      const s = Math.min(dt, t);
      t -= s;
      A.player.hp = Math.min(A.player.maxHp, A.player.hp + s * 15);
    },
    reset() { t = 0; },
  };
};

ABILITIES.dash = (A) => {
  const _l = new THREE.Vector3();
  let t = 0, dx = 0, dz = 0;
  return {
    name: 'PHASE DASH', cd: 7,
    use() {
      const p = A.player;
      A.look(_l);
      const h = Math.hypot(_l.x, _l.z) || 1;
      dx = _l.x / h; dz = _l.z / h; t = 0.18;
      p.protectT = Math.max(p.protectT, 0.45);
      A.bullets.muzzleFlash(_l.set(p.x, p.y + 1, p.z));
      A.audio.play('jump2');
      return true;
    },
    update(dt) {
      if (t <= 0) return;
      const s = Math.min(dt, t), p = A.player;
      t -= s;
      const r = resolveCircle(p.x + dx * 50 * s, p.z + dz * 50 * s, p.radius, p.y, 1.8);
      p.x = r.x; p.z = r.z;
      if (t <= 0) { p.vx = dx * 8; p.vz = dz * 8; }
    },
    reset() { t = 0; },
  };
};

ABILITIES.mine = (A) => {
  const mines = [], _l = new THREE.Vector3();
  const body = new THREE.CylinderGeometry(0.22, 0.26, 0.09, 14), ledG = new THREE.SphereGeometry(0.04, 8, 6);
  const bodyM = new THREE.MeshStandardMaterial({ color: 0x2b2f36, metalness: 0.8, roughness: 0.4 });
  const ledM = new THREE.MeshBasicMaterial({ color: 0xff3030 });
  const remove = (m) => { A.scene.remove(m.g); mines.splice(mines.indexOf(m), 1); };
  function boom(m) {
    const p = A.player;
    for (const c of A.targets()) {
      const d = Math.hypot(c.x - m.x, c.z - m.z);
      if (c.alive && d < 5 && Math.abs((c.y || 0) - m.y) < 3) A.hurt(c, 90 - 50 * (d / 5), 'body');
    }
    A.bullets.muzzleFlash(_l.set(m.x, m.y + 0.3, m.z));
    A.bullets.muzzleFlash(_l.set(m.x + 0.8, m.y + 0.8, m.z - 0.6));
    if (Math.hypot(p.x - m.x, p.z - m.z) < 12) p.shake = Math.max(p.shake || 0, 0.06);
    A.audio.play('shot', undefined, undefined, { snd: 'breacher' });
    remove(m);
  }
  return {
    name: 'PROXIMITY MINE', cd: 12,
    use() {
      const p = A.player;
      A.look(_l);
      const h = Math.hypot(_l.x, _l.z) || 1, x = p.x + (_l.x / h) * 1.2, z = p.z + (_l.z / h) * 1.2, y = floorAt(x, z, p.y, 0.3);
      const g = new THREE.Group();
      g.position.set(x, y, z);
      const b = new THREE.Mesh(body, bodyM); b.position.y = 0.045;
      const l = new THREE.Mesh(ledG, ledM); l.position.y = 0.11;
      g.add(b, l);
      A.scene.add(g);
      mines.push({ g, led: l, x, y, z, age: 0 });
      if (mines.length > 2) remove(mines[0]);
      A.audio.play('pouch');
      A.msg(`MINE ARMING (${mines.length}/2)`, 900);
      return true;
    },
    status: () => (mines.length ? `${mines.length} ACTIVE` : ''),
    update(dt) {
      if (!mines.length) return;
      const targets = A.targets();
      for (const m of [...mines]) {
        m.age += dt;
        m.led.scale.setScalar(m.age < 0.8 ? 0.5 : 0.8 + 0.4 * Math.sin(m.age * 10));
        if (m.age > 60) { remove(m); continue; }
        if (m.age < 0.8) continue;
        for (const c of targets) {
          if (c.alive && Math.hypot(c.x - m.x, c.z - m.z) < 2.6 && Math.abs((c.y || 0) - m.y) < 2.5) { boom(m); break; }
        }
      }
    },
    reset() { while (mines.length) remove(mines[0]); },
  };
};

ABILITIES.recall = (A) => {
  const _l = new THREE.Vector3();
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 3, 16, 1, true), new THREE.MeshBasicMaterial({
    color: 0x7affd1, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false,
  }));
  pillar.visible = false;
  A.scene.add(pillar);
  let pos = null, t = 0;
  const clear = () => { pos = null; t = 0; pillar.visible = false; };
  return {
    name: 'RECALL BEACON', cd: 14,
    use() {
      const p = A.player;
      if (!pos) { // first press: plant (no cooldown yet)
        pos = { x: p.x, y: p.y, z: p.z }; t = 25;
        pillar.position.set(p.x, p.y + 1.5, p.z); pillar.visible = true;
        A.msg('BEACON PLANTED: AIM again to recall', 1400);
        A.audio.play('crossLatch');
        return false;
      }
      A.bullets.muzzleFlash(_l.set(p.x, p.y + 1, p.z));
      p.x = pos.x; p.y = pos.y; p.z = pos.z; p.vx = p.vz = p.velY = 0;
      p.protectT = Math.max(p.protectT, 0.4);
      A.bullets.muzzleFlash(_l.set(pos.x, pos.y + 1, pos.z));
      clear();
      A.audio.play('respawn');
      return true;
    },
    status: () => (pos ? `BEACON ${Math.ceil(t)}s` : ''),
    update(dt) {
      if (!pos) return;
      t -= dt;
      pillar.rotation.y += dt * 2;
      pillar.material.opacity = 0.28 + 0.08 * Math.sin(performance.now() / 150);
      if (t <= 0) { clear(); A.msg('Beacon expired', 800); }
    },
    reset: clear,
  };
};
