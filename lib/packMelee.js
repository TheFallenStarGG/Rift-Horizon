/**
 * Special MELEE weapons. The aim button swings and fires an ability on the swing / hit.
 *   Shimmer Katana - Blink Slash   (dash 8m through enemies, 75 dmg)
 *   Gravity Maul   - Ground Slam   (5m shockwave + knockback)
 *   Grapple Blade  - Grapple Pull  (zip to a surface up to 32m away)
 *   Duelist Rapier - Riposte       (parry the next hit, then counter for 80)
 *   Riftblade      - Wave Slash    (piercing energy wave, 48 per enemy)
 */
import * as THREE from 'three';
import { MELEES, ALL } from './arsenal.js';
import { MODELS, ABILITIES } from './registry.js';
import { kf, rest, melee } from './reloadKit.js';
import { raycastWorld, resolveCircle } from './collision.js';

// ---------------------------------------------------------------- stats + swings
const slashA = (d, hit) => ({ dur: d, hit, keys: [rest(0),
  kf(d * 0.24, [0.3, -0.2, -0.3], [-0.1, -0.9, 0.4]),
  kf(hit, [0.0, -0.15, -0.55], [-0.1, 0.1, 0.0]),
  kf(d * 0.72, [-0.18, -0.2, -0.4], [-0.2, 0.9, -0.3]), rest(d)] });
const slashB = (d, hit) => ({ dur: d, hit, keys: [rest(0),
  kf(d * 0.24, [-0.1, -0.2, -0.3], [-0.1, 0.9, -0.4]),
  kf(hit, [0.1, -0.15, -0.55], [-0.1, -0.1, 0.0]),
  kf(d * 0.72, [0.32, -0.2, -0.4], [-0.2, -0.9, 0.3]), rest(d)] });
const SLEDGE_IDLE = kf(0, [0.16, -0.26, -0.38], [0.25, 0.0, 0.05], 'weapon');

const DEFS = [
  melee({
    id: 'katana', name: 'Shimmer Katana', model: 'katana', ability: 'blink',
    blurb: 'Fast blade. AIM = Blink Slash: dash 8m through enemies for 75 damage.',
    dmg: { front: 38, head: 55 }, range: 2.1, cd: 0.34, draw: 0.25, idle: rest(0),
    swings: [slashA(0.34, 0.16), slashB(0.34, 0.16)],
  }),
  melee({
    id: 'maul', name: 'Gravity Maul', model: 'maul', ability: 'slam',
    blurb: 'Heavy two-hander. AIM = Ground Slam: shockwave, 55 damage and knockback within 5m.',
    dmg: { front: 70, head: 90 }, range: 2.4, cd: 1.0, draw: 0.6, move: 0.94, knockback: 4, idle: SLEDGE_IDLE,
    swings: [{ dur: 1.0, hit: 0.5, keys: [
      kf(0, [0.12, -0.3, -0.42], [-0.15, 0.1, 0.1], 'weapon'),
      kf(0.36, [0.16, 0.0, -0.3], [1.45, 0.0, 0.0], 'weapon'),
      kf(0.5, [0.1, -0.3, -0.55], [-0.45, 0.0, 0.0], 'weapon'),
      kf(0.7, [0.1, -0.36, -0.5], [-0.5, 0.0, 0.0], 'weapon'),
      kf(1.0, [0.12, -0.3, -0.42], [-0.15, 0.1, 0.1], 'weapon')] }],
  }),
  melee({
    id: 'hookblade', name: 'Grapple Blade', model: 'hookblade', ability: 'grapple',
    blurb: 'Quick utility blade. AIM = Grapple Pull: zip yourself to a surface up to 32m away.',
    dmg: { front: 32, head: 48 }, range: 1.9, cd: 0.4, draw: 0.2, idle: rest(0),
    swings: [slashA(0.4, 0.19), slashB(0.4, 0.19)],
  }),
  melee({
    id: 'rapier', name: 'Duelist Rapier', model: 'rapier', ability: 'riposte',
    blurb: 'Long thrusting blade. AIM = Riposte: parry the next hit, then counter for 80.',
    dmg: { front: 34, head: 50 }, range: 2.5, cd: 0.4, draw: 0.25, idle: rest(0),
    swings: [{ dur: 0.4, hit: 0.17, keys: [rest(0),
      kf(0.09, [0.2, -0.18, -0.2], [0.0, 0.2, 0.0]),
      kf(0.17, [0.04, -0.12, -0.75], [0.0, 0.0, 0.0]),
      kf(0.3, [0.1, -0.15, -0.5], [0.0, 0.05, 0.0]), rest(0.4)] }],
  }),
  melee({
    id: 'riftblade', name: 'Riftblade', model: 'riftblade', ability: 'wave',
    blurb: 'Wide energy blade. AIM = Wave Slash: a piercing wave, 48 damage to every enemy it crosses.',
    dmg: { front: 48, head: 68 }, range: 2.2, cd: 0.62, draw: 0.35, idle: rest(0),
    swings: [{ dur: 0.62, hit: 0.28, keys: [rest(0),
      kf(0.2, [0.28, -0.05, -0.3], [1.2, -0.3, 0.2]),
      kf(0.28, [0.1, -0.28, -0.55], [-0.7, 0.1, 0.0]),
      kf(0.42, [0.0, -0.4, -0.45], [-1.0, 0.2, 0.0]), rest(0.62)] },
    { dur: 0.62, hit: 0.28, keys: [rest(0),
      kf(0.18, [-0.05, -0.4, -0.35], [-0.8, 0.9, 0.2]),
      kf(0.28, [0.15, -0.2, -0.55], [0.5, -0.1, 0.0]),
      kf(0.42, [0.3, -0.05, -0.4], [1.1, -0.8, 0.0]), rest(0.62)] }],
  }),
];
for (const d of DEFS) { MELEES[d.id] = d; ALL[d.id] = d; }

// ---------------------------------------------------------------- models (blade along -Z, edge faces -Y)
const mm = (tex, K, build) => {
  const c = K.ctx(tex), a = build(c, K);
  return K.out(c, { cls: 'melee', sightY: 0, adsZ: 0.38, anchors: { grip: K.V(0, 0, 0), fore: a.fore || K.V(0, 0, 0), hold: a.hold }, muzzle: null, eject: null });
};
const glow = (K, color, em) => new K.THREE.MeshStandardMaterial({ color, emissive: em, emissiveIntensity: 1.3, roughness: 0.3 });

MODELS.katana = (tex, K) => mm(tex, K, ({ M, p }) => {
  p(K.RB(0.024, 0.028, 0.15, 0.008), M.rubber, 0, 0, 0.05);
  p(K.CY(0.03, 0.03, 0.008, 16), M.steel, 0, 0, -0.03, K.H);
  p(K.B(0.004, 0.034, 0.56), M.blade, 0, 0.004, -0.33);
  p(K.B(0.005, 0.006, 0.56), M.steel, 0, 0.022, -0.33);
  p(K.B(0.0045, 0.004, 0.5), glow(K, 0xbff3ff, 0x7fe3ff), 0, -0.013, -0.33);
  return { hold: K.V(0, 0, 0.05) };
});
MODELS.maul = (tex, K) => mm(tex, K, ({ M, p }) => {
  const g = glow(K, 0xff9a3c, 0xff5a1a);
  p(K.CY(0.02, 0.022, 0.95, 10), M.wood, 0, 0, -0.35, K.H);
  p(K.RB(0.12, 0.26, 0.12, 0.012), M.steel, 0, 0, -0.85);
  p(K.B(0.124, 0.02, 0.124), g, 0, 0.09, -0.85);
  p(K.B(0.124, 0.02, 0.124), g, 0, -0.09, -0.85);
  p(K.SP(0.03), g, 0, 0, -0.85);
  p(K.B(0.05, 0.05, 0.04), M.gunDark, 0, 0, -0.79);
  return { hold: K.V(0, 0, 0.03), fore: K.V(0, 0, -0.3) };
});
MODELS.hookblade = (tex, K) => mm(tex, K, ({ M, p }) => {
  // p(geo, mat, x,y,z, ...) — must pass Geometry, not Mesh (Mesh-as-geo freezes WebGL / blacks the scene)
  p(K.RB(0.026, 0.03, 0.11, 0.008), M.rubber, 0, 0, 0.03);
  p(K.B(0.008, 0.046, 0.012), M.steel, 0, 0, -0.03);
  p(K.B(0.005, 0.034, 0.24), M.blade, 0, 0.004, -0.15);
  p(new K.THREE.TorusGeometry(0.028, 0.006, 8, 16), M.steel, 0, 0, 0.105);
  const hook = p(new K.THREE.ConeGeometry(0.012, 0.06, 6), M.steel, 0, 0.03, -0.29, -K.H, 0, 0);
  hook.rotation.x = -K.H;
  p(K.B(0.004, 0.012, 0.22), glow(K, 0xd8d2c0, 0x8a8470), 0, -0.016, -0.14);
  return { hold: K.V(0, 0, 0.03) };
});
MODELS.rapier = (tex, K) => mm(tex, K, ({ M, p }) => {
  p(K.RB(0.022, 0.026, 0.13, 0.008), M.rubber, 0, 0, 0.05);
  const cup = p(K.SP(0.045), M.steel, 0, 0, -0.04);
  cup.scale.set(1, 1, 0.4);
  p(K.B(0.006, 0.014, 0.62), M.blade, 0, 0.004, -0.37);
  p(K.B(0.004, 0.006, 0.6), M.steel, 0, 0.014, -0.37);
  p(K.SP(0.014), M.steel, 0, 0, 0.12);
  return { hold: K.V(0, 0, 0.05) };
});
MODELS.riftblade = (tex, K) => mm(tex, K, ({ M, p }) => {
  const g = glow(K, 0x7fe8ff, 0x1fb8ff);
  p(K.RB(0.028, 0.034, 0.12, 0.008), M.rubber, 0, 0, 0.035);
  p(K.B(0.012, 0.06, 0.016), M.steel, 0, 0, -0.03);
  p(K.B(0.005, 0.07, 0.46), M.gunDark, 0, 0.0, -0.29);
  p(K.B(0.008, 0.01, 0.46), g, 0, -0.04, -0.29);
  p(K.B(0.008, 0.01, 0.46), g, 0, 0.04, -0.29);
  for (let i = 0; i < 3; i++) p(K.B(0.007, 0.03, 0.02), g, 0, 0, -0.18 - i * 0.12);
  return { hold: K.V(0, 0, 0.035) };
});

// ---------------------------------------------------------------- abilities
const _l = new THREE.Vector3(), _o = new THREE.Vector3(), _d = new THREE.Vector3();

ABILITIES.blink = (A) => ({
  name: 'BLINK SLASH', cd: 9, on: 'swing',
  use() {
    const p = A.player, sx = p.x, sz = p.z;
    A.look(_l);
    const h = Math.hypot(_l.x, _l.z) || 1, dx = _l.x / h, dz = _l.z / h;
    A.bullets.muzzleFlash(_l.set(p.x, p.y + 1, p.z));
    for (let i = 0; i < 8; i++) {
      const r = resolveCircle(p.x + dx, p.z + dz, p.radius, p.y, 1.8);
      if (Math.hypot(r.x - p.x, r.z - p.z) < 0.4) break;
      p.x = r.x; p.z = r.z;
    }
    p.protectT = Math.max(p.protectT, 0.35);
    const ex = p.x, ez = p.z, L2 = (ex - sx) ** 2 + (ez - sz) ** 2 || 1;
    for (const c of A.targets()) {
      if (!c.alive) continue;
      const u = Math.max(0, Math.min(1, ((c.x - sx) * (ex - sx) + (c.z - sz) * (ez - sz)) / L2));
      if (Math.hypot(c.x - (sx + (ex - sx) * u), c.z - (sz + (ez - sz) * u)) < 1.4 && Math.abs((c.y || 0) - p.y) < 2.2) A.hurt(c, 75, 'body');
    }
    A.bullets.muzzleFlash(_l.set(p.x, p.y + 1, p.z));
    A.audio.play('jump2');
    return true;
  },
});

ABILITIES.slam = (A) => {
  const mat = new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, side: THREE.DoubleSide, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1, 48), mat);
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  A.scene.add(ring);
  let rt = 0;
  return {
    name: 'GROUND SLAM', cd: 12, on: 'hit', replaceHit: true,
    use() {
      const p = A.player;
      for (const c of A.targets()) {
        const dx = c.x - p.x, dz = c.z - p.z, d = Math.hypot(dx, dz);
        if (!c.alive || d > 5 || Math.abs((c.y || 0) - p.y) > 2.5) continue;
        A.hurt(c, 55 * (1 - 0.5 * d / 5), 'body');
        if (!c.remote) { c.vx = (c.vx || 0) + (dx / (d || 1)) * 9; c.vz = (c.vz || 0) + (dz / (d || 1)) * 9; }
      }
      ring.position.set(p.x, p.y + 0.1, p.z);
      rt = 0.5;
      A.bullets.muzzleFlash(_l.set(p.x, p.y + 0.3, p.z));
      p.shake = Math.max(p.shake || 0, 0.07);
      A.audio.play('thud');
      return true;
    },
    update(dt) {
      if (rt <= 0) return;
      rt -= dt;
      const u = 1 - Math.max(0, rt) / 0.5;
      ring.visible = rt > 0;
      ring.scale.setScalar(0.5 + u * 5);
      mat.opacity = 0.8 * (1 - u);
    },
    reset() { rt = 0; ring.visible = false; },
  };
};

ABILITIES.grapple = (A) => {
  const rope = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
    new THREE.LineBasicMaterial({ color: 0xd8d2c0 }));
  rope.frustumCulled = false;
  rope.visible = false;
  A.scene.add(rope);
  let t = 0, tx = 0, ty = 0, tz = 0;
  return {
    name: 'GRAPPLE PULL', cd: 8, on: 'swing',
    use() {
      A.eye(_o); A.look(_d);
      const w = raycastWorld(_o.x, _o.y, _o.z, _d.x, _d.y, _d.z, 32);
      if (!w) { A.msg('No anchor in range', 800); return false; }
      tx = _o.x + _d.x * (w.t - 0.3); ty = _o.y + _d.y * (w.t - 0.3); tz = _o.z + _d.z * (w.t - 0.3);
      t = 0.6;
      A.audio.play('crossLatch');
      return true;
    },
    status: () => (t > 0 ? 'PULLING' : ''),
    update(dt) {
      if (t <= 0) { rope.visible = false; return; }
      t -= dt;
      const p = A.player, dx = tx - p.x, dy = ty - (p.y + 1), dz = tz - p.z, dist = Math.hypot(dx, dy, dz);
      if (dist < 1.6) { t = 0; rope.visible = false; return; }
      const k = 22 / dist;
      p.vx = dx * k; p.vz = dz * k; p.velY = dy * k + 4; p.onGround = false;
      const pos = rope.geometry.attributes.position;
      pos.setXYZ(0, p.x, p.y + 1.2, p.z);
      pos.setXYZ(1, tx, ty, tz);
      pos.needsUpdate = true;
      rope.visible = true;
    },
    reset() { t = 0; rope.visible = false; },
  };
};

ABILITIES.riposte = (A) => {
  let t = 0;
  function counter() {
    const p = A.player;
    let best = null, bd = 4.5;
    for (const c of A.targets()) {
      const d = Math.hypot(c.x - p.x, c.z - p.z);
      if (c.alive && d < bd) { bd = d; best = c; }
    }
    A.bullets.muzzleFlash(_l.set(p.x, p.y + 1.2, p.z));
    if (best) A.hurt(best, 80, 'body');
  }
  return {
    name: 'RIPOSTE', cd: 12, on: 'swing', solo: true,
    use() { t = 1.0; A.msg('PARRY READY', 700); return true; },
    status: () => (t > 0 ? `PARRY ${t.toFixed(1)}s` : ''),
    update(dt) { if (t > 0) t -= dt; },
    absorb(d) {
      if (t <= 0) return d;
      t = 0;
      A.audio.play('clang');
      A.msg('RIPOSTE!', 800);
      A.player.protectT = Math.max(A.player.protectT, 0.3);
      counter();
      return 0;
    },
    reset() { t = 0; },
  };
};

ABILITIES.wave = (A) => {
  const waves = [], Z = new THREE.Vector3(0, 0, 1);
  const geo = new THREE.TorusGeometry(0.9, 0.07, 6, 24, Math.PI);
  const mat = new THREE.MeshBasicMaterial({ color: 0x5ad8ff, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const drop = (w) => { A.scene.remove(w.m); waves.splice(waves.indexOf(w), 1); };
  return {
    name: 'WAVE SLASH', cd: 9, on: 'hit', replaceHit: true,
    use() {
      A.eye(_o); A.look(_d);
      const m = new THREE.Mesh(geo, mat);
      m.quaternion.setFromUnitVectors(Z, _d);
      m.frustumCulled = false;
      A.scene.add(m);
      waves.push({ m, p: _o.clone().addScaledVector(_d, 1), d: _d.clone(), t: 0, hit: new Set() });
      A.audio.play('swing');
      return true;
    },
    update(dt) {
      for (const w of [...waves]) {
        const step = 38 * dt, hit = raycastWorld(w.p.x, w.p.y, w.p.z, w.d.x, w.d.y, w.d.z, step);
        w.p.addScaledVector(w.d, hit ? hit.t : step);
        w.t += step;
        w.m.position.copy(w.p);
        for (const c of A.targets()) {
          if (!c.alive || w.hit.has(c.id)) continue;
          if (Math.hypot(c.x - w.p.x, c.z - w.p.z) < 1.4 && Math.abs((c.y || 0) + 1 - w.p.y) < 1.8) { w.hit.add(c.id); A.hurt(c, 48, 'body'); }
        }
        if (hit || w.t > 30) drop(w);
      }
    },
    reset() { while (waves.length) drop(waves[0]); },
  };
};
