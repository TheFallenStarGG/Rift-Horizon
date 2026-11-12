/**
 * CLASSIFIED reward: unlocked by finding all eight Classified Secrets in the lobby (lib/classified.js).
 *   Event Horizon - Singularity (a black hole drags enemies in, shreds them for 3.5s, then detonates for 140)
 * Same structure as packMain.js: stats + model + ability, registered by importing this file from weaponsPlus.js.
 */
import * as THREE from 'three';
import { WEAPONS, ALL } from './arsenal.js';
import { MODELS, ABILITIES } from './registry.js';
import { boxMag, gun } from './reloadKit.js';
import { raycastWorld } from './collision.js';

const special = (o) => gun({ noAds: true, adsMove: 1, adsZoom: 1, ...o });
const rack = (o, pull) => ({ hand: 'L', part: 'charge', o, pull });

const DEF = special({
  id: 'horizon', slot: 'main', name: 'Event Horizon', model: 'horizon', cls: 'long', auto: true, ability: 'singularity', classified: true,
  blurb: 'CLASSIFIED. AIM = Singularity: a black hole that drags enemies in, shreds them for 3.5s, then detonates (140).',
  cd: 0.08, mag: 40, total: 400, move: 1, draw: 0.5, bulletSpeed: 300,
  dmg: { head: 60, body: 30, limb: 21 }, falloff: { start: 40, end: 95, min: 0.75 },
  spread: { hip: 0.014, ads: 0.014 }, recoil: 0.014,
  reload: boxMag(2.2, { seat: [-0.025, -0.07, 0.05], drop: 0.2, rack: rack([-0.03, 0, 0.05], [0, 0, 0.1]) }),
});
WEAPONS[DEF.id] = DEF; ALL[DEF.id] = DEF;

// ---------------------------------------------------------------- model
MODELS.horizon = (tex, K) => {
  const { V, RB, B, CY, SP, H, THREE: T3 } = K, c = K.ctx(tex), { M, g, p, node } = c;
  const amber = new T3.MeshStandardMaterial({ color: 0xffb25a, emissive: 0xff7a1a, emissiveIntensity: 1.6, roughness: 0.3 });
  const violet = new T3.MeshStandardMaterial({ color: 0xa78bff, emissive: 0x6a3dff, emissiveIntensity: 1.5, roughness: 0.3 });
  const voidM = new T3.MeshStandardMaterial({ color: 0x050508, metalness: 0.9, roughness: 0.2 });
  p(RB(0.054, 0.08, 0.34, 0.01), voidM, 0, -0.01, 0.04);
  p(RB(0.048, 0.05, 0.4, 0.01), M.gunDark, 0, 0.014, -0.3);
  p(B(0.008, 0.012, 0.4), amber, 0.028, 0.014, -0.3);
  p(B(0.008, 0.012, 0.4), amber, -0.028, 0.014, -0.3);
  p(CY(0.013, 0.013, 0.22, 12), M.black, 0, 0.014, -0.62, H);
  p(new T3.TorusGeometry(0.04, 0.005, 8, 24), violet, 0, 0.014, -0.58);   // event horizon rings
  p(new T3.TorusGeometry(0.03, 0.004, 8, 24), amber, 0, 0.014, -0.66);
  p(SP(0.014), violet, 0, 0.014, -0.74);
  p(RB(0.046, 0.09, 0.26, 0.012), M.poly, 0, -0.03, 0.28, 0.05);
  p(B(0.048, 0.09, 0.012), M.rubber, 0, -0.035, 0.41);
  p(RB(0.034, 0.1, 0.042, 0.01), M.poly, 0, -0.1, 0.1, -0.28);
  p(B(0.008, 0.006, 0.07), M.gunDark, 0, -0.065, 0);
  p(CY(0.016, 0.016, 0.12, 12), M.black, 0, 0.065, -0.1, H);
  const mag = K.smallMag(M, 0.11);
  mag.position.set(0, -0.055, -0.02);
  g.add(mag);
  const ch = node(0.03, 0.02, 0.02);
  p(RB(0.014, 0.012, 0.03, 0.003), M.steel, 0, 0, 0, 0, 0, 0, ch);
  return K.out(c, {
    cls: 'long', sightY: 0.08, adsZ: 0.36,
    anchors: { grip: V(0.012, -0.15, 0.115), fore: V(0, -0.075, -0.25), mag: V(0, -0.055, -0.02), port: V(0.01, 0.02, 0), handle: V(0.03, 0.02, 0.02) },
    mag, magHome: V(0, -0.055, -0.02), magTilt: 0,
    parts: { charge: { set: (v) => { ch.position.z = 0.02 + v * 0.1; } } },
    muzzle: node(0, 0.014, -0.77), eject: node(0.03, 0.02, 0.02),
  });
};

// ---------------------------------------------------------------- ability
ABILITIES.singularity = (A) => {
  const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _m = new THREE.Vector3();
  const R = 13, DUR = 3.5, BOOM = 9;
  const grp = new THREE.Group();
  grp.visible = false;
  A.scene.add(grp);
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.55, 20, 14), new THREE.MeshBasicMaterial({ color: 0x000000, fog: false }));
  const disc = new THREE.Mesh(new THREE.TorusGeometry(1.1, 0.12, 8, 48), new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  disc.rotation.x = Math.PI / 2.4;
  const halo = new THREE.Mesh(new THREE.SphereGeometry(1.8, 16, 12), new THREE.MeshBasicMaterial({ color: 0x7a4dff, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide, fog: false }));
  grp.add(core, disc, halo);
  let s = null;
  const end = () => { s = null; grp.visible = false; };
  return {
    name: 'SINGULARITY', cd: 30,
    use() {
      A.eye(_o); A.look(_d);
      s = { st: 'fly', p: _o.clone().addScaledVector(_d, 1.2), d: _d.clone(), t: 0, life: 0, tick: 0 };
      grp.position.copy(s.p); grp.visible = true; grp.scale.setScalar(0.5);
      A.audio.play('crossLatch'); A.msg('SINGULARITY', 900);
      return true;
    },
    status: () => (s ? (s.st === 'fly' ? 'LAUNCHED' : `COLLAPSE ${Math.max(0, s.life).toFixed(1)}s`) : ''),
    update(dt) {
      if (!s) return;
      disc.rotation.z += dt * 6;
      halo.scale.setScalar(1 + 0.08 * Math.sin(performance.now() / 90));
      if (s.st === 'fly') {
        const step = 40 * dt, hit = raycastWorld(s.p.x, s.p.y, s.p.z, s.d.x, s.d.y, s.d.z, step + 0.6);
        s.p.addScaledVector(s.d, hit ? Math.max(0, hit.t - 0.5) : step);
        s.t += dt;
        grp.position.copy(s.p); grp.scale.setScalar(Math.min(1, 0.5 + s.t * 2));
        if (hit || s.t > 0.9) { s.st = 'pull'; s.life = DUR; A.audio.play('thud'); }
        return;
      }
      s.life -= dt;
      grp.scale.setScalar(1 + (1 - s.life / DUR) * 1.4);
      s.tick -= dt;
      const tick = s.tick <= 0;
      if (tick) s.tick = 0.25;
      for (const c of A.targets()) {
        if (!c.alive) continue;
        const dx = s.p.x - c.x, dz = s.p.z - c.z, d = Math.hypot(dx, dz);
        if (d > R || Math.abs((c.y || 0) + 1 - s.p.y) > 7) continue;
        if (!c.remote) { c.vx = (c.vx || 0) + (dx / (d || 1)) * 30 * dt; c.vz = (c.vz || 0) + (dz / (d || 1)) * 30 * dt; }
        if (tick) A.hurt(c, 7 + 8 * (1 - d / R), 'body');
      }
      if (s.life <= 0) {
        for (const c of A.targets()) {
          const d = Math.hypot(c.x - s.p.x, c.z - s.p.z);
          if (c.alive && d < BOOM && Math.abs((c.y || 0) + 1 - s.p.y) < 7) A.hurt(c, 140 * (1 - 0.5 * d / BOOM), 'body');
        }
        A.bullets.muzzleFlash(_m.copy(s.p));
        A.bullets.muzzleFlash(_m.set(s.p.x + 1.2, s.p.y + 0.6, s.p.z - 0.8));
        const p = A.player;
        if (Math.hypot(p.x - s.p.x, p.z - s.p.z) < 20) p.shake = Math.max(p.shake || 0, 0.08);
        A.audio.play('shot', undefined, undefined, { snd: 'breacher' });
        end();
      }
    },
    reset: end,
  };
};
