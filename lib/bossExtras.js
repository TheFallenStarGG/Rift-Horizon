/**
 * THE RIFTWARDEN — EXTRAS (lib/bossExtras.js)
 * 5 new attacks, the phase 2 / phase 3 mini cutscenes and the visible body transformation.
 * boss.js creates this in build() and passes in everything it needs through `K`.
 */
import * as THREE from 'three';

const PI = Math.PI, TAU = PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);
const ease = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const outBack = (t) => { t = clamp(t, 0, 1); return 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2); };
const prog = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
const faceYaw = (dx, dz) => Math.atan2(-dx, -dz);
const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > PI) d -= TAU; if (d < -PI) d += TAU; return d; };

// size / strength of each transformation piece per stage (stage = phase)
const STAGE = {
  1: { wing: 0, blades: 0, crown: 0, spur: 0, crack: 0, scale: 1, heat: 0 },
  2: { wing: 0.7, blades: 3, crown: 0.55, spur: 0.65, crack: 0.7, scale: 1.1, heat: 0.3 },
  3: { wing: 1, blades: 5, crown: 1, spur: 1.15, crack: 1, scale: 1.22, heat: 0.55 },
};

export function createBossExtras(K) {
  const { S, player, AX, AY, AZ, COL, fx, sfx, ui, rig, arena } = K;
  const { vol, shake, fwd, anchor, later, pose, rest, turnTo, face, during, handSparks, wave, impact, geyser, pillarHit, hurt, knock, airH, regrowPillars, vent } = K;
  const _w = new THREE.Vector3(), _p = new THREE.Vector3(), _l = new THREE.Vector3();
  const ringsL = [], orbsL = [], wallsL = [];

  // ======================================================================
  //  ATTACK: WARDEN'S RUSH — locks a lane, then charges down it. Bait him into a pillar to stun him.
  // ======================================================================
  function* rush() {
    S.lockLegs = true;
    pose({ hipY: -1.5, torsoX: 0.6, lLegX: 0.8, rLegX: -0.4, lKneeX: 1.3, rKneeX: 0.7, lShX: -0.8, rShX: 1.7, rShZ: 0.45, headX: 0.35 }, 5);
    const wind = 1.4;
    let ax = 0, az = 1, lockLen = 30;
    const aim = () => { const x = player.x - S.x, z = player.z - S.z, l = Math.hypot(x, z) || 1; ax = x / l; az = z / l; };
    const pathLen = () => {
      const px = S.x - AX, pz = S.z - AZ, b = px * ax + pz * az, c = px * px + pz * pz - 900;
      const edge = -b + Math.sqrt(Math.max(0, b * b - c));
      return clamp(Math.min(Math.hypot(player.x - S.x, player.z - S.z) + 14, edge), 10, 60);
    };
    aim(); lockLen = pathLen();
    const tl = fx.tele('rect', { x: S.x, z: S.z, dx: ax, dz: az, len: lockLen, w: 10, dur: wind, col: 0xff3a3a });
    sfx.charge(wind, vol(S.x, S.z));
    yield* during(wind * 0.55, () => {                       // tracks you, then the lane LOCKS
      face(4); aim(); lockLen = pathLen();
      tl.o.x = S.x; tl.o.z = S.z; tl.o.dx = ax; tl.o.dz = az; tl.o.len = lockLen;
      handSparks('rFist', 1);
    });
    yield wind * 0.45;
    const D = lockLen, sx = S.x, sz = S.z, dur = D / 46 + 0.2;
    pose({ hipY: -0.9, torsoX: 0.75, lLegX: 0.9, rLegX: -0.2, lKneeX: 0.9, rKneeX: 0.5, rShX: 1.5, lShX: 1.5, headX: 0.2 }, 18);
    sfx.roar(vol(sx, sz)); shake(0.5);
    fx.burst(sx, AY + 0.6, sz, 24, 18, 0.8, 1.4, 0.2, 0xffffff, 0xff5a1a, { up: 0.8, grav: 8 });
    let t = 0, dd = 0, hitDone = false, stunned = false;
    while (t < dur && !stunned) {
      t += S.dt; dd += S.dt;
      const q = ease(t / dur);
      S.x = sx + ax * D * q; S.z = sz + az * D * q;
      turnTo(faceYaw(ax, az), 30);
      for (const n of ['lSole', 'rSole']) {
        const a = anchor(n);
        fx.dust(a.x, a.y + 0.3, a.z, rnd(-4, 4), rnd(0.5, 3), rnd(-4, 4), 0.9, 1.8, 5, 0x6b5a55, 0x20202a, 0.5, 0, 1.5);
        fx.add(a.x, a.y + 0.2, a.z, rnd(-3, 3), rnd(2, 7), rnd(-3, 3), 0.5, 1.2, 0.1, 0xffe0a0, 0xff5a1a, 1, 4, 1);
      }
      if (dd > 0.1) { dd = 0; fx.decal(S.x, S.z, 4, 'scorch', 0x000000, 6); }
      shake(0.02);
      if (!hitDone && player.alive && Math.hypot(player.x - S.x, player.z - S.z) < 4.6 && airH() < 4.5) {
        hitDone = true; hurt(36, S.x, S.z); knock(S.x, S.z, 20, 6);
      }
      for (const pl of arena.pillars) if (pl.alive && Math.hypot(pl.x - S.x, pl.z - S.z) < 5.6) { pillarHit(pl, 1e6); stunned = true; break; }
      yield 0;
    }
    impact(S.x + ax * 3, S.z + az * 3, stunned ? 2.0 : 1.3);
    wave(S.x, S.z, { v: 22, maxR: 22, dmg: 16, col: COL.fire });
    if (stunned) {                                           // crashed into a pillar: core exposed
      ui.flash('#ffe0b0', 0.35, 0.5); S.ventCd = Math.max(S.ventCd, 12);
      yield* vent(4.5);
      return;
    }
    pose({ hipY: -0.5, torsoX: 0.4 }, 6);
    yield 0.9;
  }

  // ======================================================================
  //  ATTACK: SUNDERING BLADES — expanding blade rings with narrow gaps (green lanes). Or jump them.
  // ======================================================================
  function* blades() {
    S.lockLegs = true;
    pose({ rShZ: 1.45, lShZ: 1.45, rShX: 0.4, lShX: 0.4, torsoX: -0.3, headX: -0.45, hipY: -0.45 }, 5);
    const nR = S.phase >= 3 ? 3 : S.phase >= 2 ? 2 : 1, gap = S.phase >= 3 ? 0.8 : 0.95, wind = 1.2, a0 = rnd(0, TAU), bx = S.x, bz = S.z;
    for (let k = 0; k < 4; k++) {
      const a = a0 + (k * PI) / 2 + PI / 4;
      fx.tele('rect', { x: bx, z: bz, dx: Math.cos(a), dz: Math.sin(a), len: 46, w: 2.6, dur: wind + (nR - 1) * gap, col: 0x55ff99 });
    }
    ui.hint('STAND IN THE GREEN LANES — OR JUMP', 3);
    sfx.charge(wind, vol(bx, bz));
    yield* during(wind, () => { face(1.5); handSparks('rFist', 2); handSparks('lMuz', 2); shake(0.012); });
    for (let i = 0; i < nR; i++) {
      pose({ torsoX: 0.5, rShZ: 0.3, lShZ: 0.3, rShX: 0.1, lShX: 0.1 }, 30);
      sfx.boom(1.1, vol(bx, bz)); shake(0.35);
      fx.ball(bx, AY + 1.5, bz, 12, 0xffd0a0, 0.25);
      ringsL.push({ x: bx, z: bz, r: 4, v: 20 + i * 2, maxR: 48, a0, dmg: 26, hit: false, col: i % 2 ? 0xffd0a0 : 0xff6a3a, h: [fx.crescent(), fx.crescent(), fx.crescent(), fx.crescent()] });
      if (i < nR - 1) { yield 0.2; pose({ torsoX: -0.3, rShZ: 1.45, lShZ: 1.45 }, 8); yield gap - 0.2; }
    }
    yield 1.4;
  }
  function updRings(dt) {
    for (let i = ringsL.length - 1; i >= 0; i--) {
      const R = ringsL[i]; R.r += R.v * dt;
      const a = clamp(1 - R.r / R.maxR, 0, 1);
      let th = null;
      if (!R.hit && player.alive && airH() < 0.75 && Math.abs(Math.hypot(player.x - R.x, player.z - R.z) - R.r) < 1.7) th = Math.atan2(player.x - R.x, player.z - R.z);
      for (let k = 0; k < 4; k++) {
        const ang = R.a0 + (k * PI) / 2, dx = Math.cos(ang), dz = Math.sin(ang), base = Math.atan2(dx, dz);
        R.h[k].place(R.x, AY + 0.05, R.z, dx, dz, R.r, 1.5, 0.45 + 0.55 * a, R.col);
        if (Math.random() < dt * 16) { const ba = base + rnd(-0.6, 0.6); fx.add(R.x + Math.sin(ba) * R.r, AY + rnd(0.2, 1.4), R.z + Math.cos(ba) * R.r, rnd(-1, 1), rnd(1, 4), rnd(-1, 1), 0.5, 1.3, 0.1, 0xffffff, 0xff5a2a, 1, 4, 1); }
        if (th !== null && !R.hit && Math.abs(angDiff(th, base)) < 0.62) { R.hit = true; hurt(R.dmg, R.x, R.z); knock(R.x, R.z, 14, 4); }
      }
      if (R.r > R.maxR) { for (const h of R.h) h.hide(); ringsL.splice(i, 1); }
    }
  }

  // ======================================================================
  //  ATTACK: SEEKER RIFTS — slow homing orbs. Pillars absorb them.
  // ======================================================================
  function* seekers() {
    S.lockLegs = true;
    pose({ rShX: 2.4, lShX: 2.4, rShZ: 0.9, lShZ: 0.9, torsoX: -0.3, headX: -0.4 }, 5);
    S.orbitSpin = 5;
    sfx.charge(0.9, vol(S.x, S.z));
    yield* during(0.9, () => {
      face(2);
      for (const sh of rig.shards) { sh.getWorldPosition(_w); fx.add(_w.x, _w.y, _w.z, rnd(-1, 1), rnd(-1, 1), rnd(-1, 1), 0.4, 0.8, 0.1, 0xffffff, COL.void, 1, 0, 1); }
    });
    ui.hint('SEEKERS — HIDE BEHIND A PILLAR', 4);
    const n = S.phase >= 3 ? 5 : 3;
    for (let i = 0; i < n; i++) { spawnSeeker(); pose({ torsoX: 0.2 }, 20); yield 0.18; pose({ torsoX: -0.3 }, 6); yield 0.3; }
    S.orbitSpin = 1;
    yield 0.8;
  }
  function spawnSeeker() {
    const sh = rig.shards[(Math.random() * rig.shards.length) | 0]; sh.getWorldPosition(_w);
    const x = _w.x, y = _w.y, z = _w.z;
    let dx = player.x - x, dy = player.y + 1.2 - y, dz = player.z - z; const l = Math.hypot(dx, dy, dz) || 1;
    orbsL.push({ x, y, z, dx: dx / l, dy: dy / l, dz: dz / l, spd: 14, t: 0, life: 7.5, h: fx.sprite(), h2: fx.sprite() });
    fx.burst(x, y, z, 10, 8, 0.4, 1, 0.1, 0xffffff, COL.void, { grav: 0 });
    sfx.zap(vol(x, z));
  }
  function updSeekers(dt) {
    for (let i = orbsL.length - 1; i >= 0; i--) {
      const o = orbsL[i]; o.t += dt;
      if (player.alive && o.t < o.life - 1) {
        let tx = player.x - o.x, ty = player.y + 1.1 - o.y, tz = player.z - o.z; const l = Math.hypot(tx, ty, tz) || 1, k = Math.min(1, 1.5 * dt);
        o.dx = lerp(o.dx, tx / l, k); o.dy = lerp(o.dy, ty / l, k); o.dz = lerp(o.dz, tz / l, k);
        const n = Math.hypot(o.dx, o.dy, o.dz) || 1; o.dx /= n; o.dy /= n; o.dz /= n;
      }
      const sp = o.spd * (o.t < 0.5 ? 0.4 + o.t : 1);
      o.x += o.dx * sp * dt; o.y += o.dy * sp * dt; o.z += o.dz * sp * dt;
      if (o.y < AY + 0.7) { o.y = AY + 0.7; if (o.dy < 0) o.dy = 0; }
      o.h.set(o.x, o.y, o.z, 3.0 + Math.sin(o.t * 12) * 0.25, COL.void, 1); o.h2.set(o.x, o.y, o.z, 1.3, 0xffffff, 1);
      fx.add(o.x, o.y, o.z, rnd(-1, 1), rnd(-1, 1), rnd(-1, 1), 0.5, 1.4, 0.1, 0xe0c0ff, 0x5020c0, 0.9, 0, 1);
      let boom = false;
      if (player.alive && Math.hypot(player.x - o.x, player.y + 0.9 - o.y, player.z - o.z) < 1.5) { hurt(24, o.x, o.z); knock(o.x, o.z, 8, 3); boom = true; }
      else for (const pl of arena.pillars) if (pl.alive && Math.hypot(pl.x - o.x, pl.z - o.z) < 2.4 && o.y < AY + 17) { pillarHit(pl, 220); boom = true; break; }
      if (boom || o.t > o.life) {
        fx.burst(o.x, o.y, o.z, 18, 14, 0.6, 1.2, 0.1, 0xffffff, COL.void, { grav: 10 });
        fx.ball(o.x, o.y, o.z, 4, COL.void, 0.25); sfx.shatter(vol(o.x, o.z) * 0.6);
        o.h.hide(); o.h2.hide(); orbsL.splice(i, 1);
      }
    }
  }

  // ======================================================================
  //  ATTACK: PYRE WALL — a firewall sweeps the arena with two gaps (green lanes). Or jump it.
  // ======================================================================
  function* firewall() {
    S.lockLegs = true;
    pose({ rShX: 3.0, lShX: 3.0, rShZ: 0.2, lShZ: 0.2, torsoX: -0.4, hipY: -0.4, headX: -0.5 }, 5);
    sfx.roar(vol(S.x, S.z));
    ui.hint('FIND THE GAP — OR JUMP', 3.5);
    const nW = S.phase >= 3 ? 3 : 2, a0 = Math.atan2(player.z - AZ, player.x - AX);
    for (let i = 0; i < nW; i++) {
      launchWall(a0 + (i % 2 ? PI : 0) + rnd(-0.5, 0.5), S.phase >= 3 ? 26 : 22);
      shake(0.2);
      yield i < nW - 1 ? 1.9 : 0.5;
    }
    yield 4.2;
  }
  function launchWall(a, v) {
    const sx = AX + Math.cos(a) * 46, sz = AZ + Math.sin(a) * 46, dx = -Math.cos(a), dz = -Math.sin(a), px = -dz, pz = dx;
    const u1 = rnd(-26, -6), u2 = rnd(6, 26), g = [[u1 - 4, u1 + 4], [u2 - 4, u2 + 4]];
    const segs = [[-70, g[0][0]], [g[0][1], g[1][0]], [g[1][1], 70]];
    for (const [lo, hi] of g) fx.tele('rect', { x: sx + px * ((lo + hi) / 2), z: sz + pz * ((lo + hi) / 2), dx, dz, len: 94, w: 6.4, dur: 1.3 + 94 / v, col: 0x55ff99 });
    wallsL.push({ sx, sz, dx, dz, px, pz, v, s: -2, delay: 1.3, hit: false, segs, h: segs.map(() => fx.beam()) });
  }
  function updWalls(dt) {
    for (let i = wallsL.length - 1; i >= 0; i--) {
      const W = wallsL[i];
      if (W.delay > 0) { W.delay -= dt; continue; }
      W.s += W.v * dt;
      const cx = W.sx + W.dx * W.s, cz = W.sz + W.dz * W.s;
      W.segs.forEach((sg, k) => {
        W.h[k].set(cx + W.px * sg[0], AY + 0.5, cz + W.pz * sg[0], cx + W.px * sg[1], AY + 0.5, cz + W.pz * sg[1], 0.85, 0xff6a2a, 1);
        for (let e = 0; e < 2; e++) { const u = rnd(sg[0], sg[1]); fx.add(cx + W.px * u, AY + 0.3, cz + W.pz * u, rnd(-1, 1), rnd(3, 8), rnd(-1, 1), 0.7, 1.8, 0.2, 0xffd080, 0xff3a0a, 1, -2, 0.5); }
      });
      if (!W.hit && player.alive && airH() < 0.75) {
        const rx = player.x - W.sx, rz = player.z - W.sz, along = rx * W.dx + rz * W.dz, lat = rx * W.px + rz * W.pz;
        if (Math.abs(along - W.s) < 1.7) for (const sg of W.segs) if (lat > sg[0] - 0.4 && lat < sg[1] + 0.4) {
          W.hit = true; hurt(30, cx + W.px * lat, cz + W.pz * lat); knock(player.x - W.dx * 2, player.z - W.dz * 2, 14, 4); break;
        }
      }
      if (W.s > 98) { for (const h of W.h) h.hide(); wallsL.splice(i, 1); }
    }
  }

  // ======================================================================
  //  ATTACK: RIFT BLOOM — eruption rings centred on where you stand; each ring re-centres on you.
  // ======================================================================
  function* bloom() {
    S.lockLegs = true;
    pose({ rShX: 3.0, rElbX: 0.15, lShX: 0.5, torsoX: -0.4, hipY: -0.5, headX: -0.3 }, 5);
    sfx.charge(0.8, vol(S.x, S.z));
    yield* during(0.8, () => { face(2); handSparks('rFist', 3); });
    pose({ rShX: 0.05, torsoX: 0.5, hipY: -0.15 }, 28);
    sfx.thump(vol(S.x, S.z)); shake(0.3);
    ui.hint('KEEP MOVING — THE RINGS CLOSE IN', 3);
    const plan = S.phase >= 3 ? [[17, 6], [10, 6], [4.5, 4]] : [[16, 6], [8.5, 5]], lim = S.arenaR - 3;
    for (const [r, n] of plan) {
      const cx = player.x, cz = player.z, a0 = rnd(0, TAU);
      for (let k = 0; k < n; k++) {
        const a = a0 + (k / n) * TAU, x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
        if (Math.hypot(x - AX, z - AZ) > lim) continue;                       // would be off the island
        fx.tele('disc', { x, z, r: 3.1, dur: 0.85, col: 0xff7a2a });
        later(0.85, () => geyser(x, z, true));
      }
      yield 0.9;
    }
    const fx2 = player.x, fz2 = player.z;
    fx.tele('disc', { x: fx2, z: fz2, r: 3.1, dur: 0.85, col: 0xff2a2a });
    later(0.85, () => geyser(fx2, fz2, true));
    yield 1.8;
  }

  // ======================================================================
  //  TRANSFORMATION: extra geometry on the rig that grows in per stage
  // ======================================================================
  const wingG = {}, wingB = {}, crownS = [], spurs = [], cracks = [];
  let crown = null;
  const V = { ...STAGE[1] };

  function dress() {
    const { torso, neck, arms, M } = rig;
    const prep = (o) => { o.frustumCulled = false; o.castShadow = false; return o; };
    const LEN = [9, 12.5, 14.5, 12.5, 9.5];
    for (const [side, s] of [['l', -1], ['r', 1]]) {                 // wings: a fan of flat blades on the back
      const wg = new THREE.Group(); wg.position.set(s * 1.5, 4.7, 1.9); wg.rotation.x = 0.45; torso.add(wg); wingG[side] = wg;
      wingB[side] = LEN.map((len, i) => {
        const bp = new THREE.Group(); bp.rotation.z = -s * (0.25 + i * 0.3); wg.add(bp);
        const blade = prep(new THREE.Mesh(new THREE.ConeGeometry(0.6, len, 4).translate(0, len / 2, 0), M.armor)); blade.scale.set(1, 1, 0.22); bp.add(blade);
        bp.add(prep(new THREE.Mesh(new THREE.BoxGeometry(0.13, len * 0.9, 0.34).translate(0, len * 0.47, 0), M.vein)));
        return bp;
      });
    }
    crown = new THREE.Group(); crown.position.set(0, 3.9, -0.2); neck.add(crown);   // floating rift crown
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * TAU, g = new THREE.Group();
      g.position.set(Math.cos(a) * 1.9, 0, Math.sin(a) * 1.9); g.rotation.set(Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3); crown.add(g);
      const m = prep(new THREE.Mesh(new THREE.OctahedronGeometry(0.6, 0), M.vein)); m.scale.set(0.5, 2.2, 0.5); g.add(m);
      crownS.push(g);
    }
    for (const s of [-1, 1]) {                                        // shoulder crystal spurs
      const sh = arms[s < 0 ? 'l' : 'r'].sh;
      for (let i = 0; i < 3; i++) {
        const g = new THREE.Group(); g.position.set(s * (0.3 + i * 0.6), 1.2, (i - 1) * 0.9); g.rotation.z = -s * (0.55 + i * 0.2); sh.add(g);
        g.add(prep(new THREE.Mesh(new THREE.ConeGeometry(0.5, 4.2, 5).translate(0, 2.1, 0), M.vein)));
        spurs.push(g);
      }
    }
    for (const [x, rz, len] of [[-1.6, 0.3, 3.0], [1.6, -0.3, 3.0], [-2.8, -0.25, 2.2], [2.8, 0.25, 2.2]]) {   // glowing cracks in the chest armour
      const g = new THREE.Group(); g.position.set(x, 2.0, -1.7); g.rotation.z = rz; torso.add(g);
      g.add(prep(new THREE.Mesh(new THREE.BoxGeometry(0.14, len, 0.08).translate(0, len / 2, 0), M.vein)));
      cracks.push(g);
    }
    snapStage(1);
  }
  function applyV() {
    for (const side of ['l', 'r']) {
      const wg = wingG[side]; if (!wg) continue;
      wg.visible = V.wing > 0.01; wg.scale.setScalar(Math.max(V.wing, 0.001));
      wingB[side].forEach((bp, i) => { const v = clamp(V.blades - i, 0, 1); bp.visible = v > 0.01; bp.scale.setScalar(Math.max(v, 0.001)); });
    }
    if (crown) {
      crown.visible = V.crown > 0.01;
      crownS.forEach((g, i) => { g.visible = i % 2 === 0 || V.crown > 0.75; g.scale.setScalar(Math.max(V.crown, 0.001)); });
    }
    spurs.forEach((g) => { g.visible = V.spur > 0.01; g.scale.setScalar(Math.max(V.spur, 0.001)); });
    cracks.forEach((g) => { g.visible = V.crack > 0.01; g.scale.y = Math.max(V.crack, 0.001); });
    rig.root.scale.setScalar(V.scale);
    S.bodyScale = V.scale; S.heat = V.heat;
  }
  function snapStage(n) { Object.assign(V, STAGE[n]); applyV(); }
  const part = (key, n, p, fn = ease) => { V[key] = lerp(STAGE[n - 1][key], STAGE[n][key], fn(p)); };
  function setPalette(n) {
    const hex = n === 2 ? 0xff4fd8 : n === 3 ? 0xff4a2a : 0xa36bff;
    arena.setPalette(hex); rig.M.vein.color.setHex(hex);
  }

  // ======================================================================
  //  MINI CUTSCENES (phase 2 and phase 3). Skippable: boss.js handles the skip + cleanup.
  // ======================================================================
  function frame(bx, bz, yaw) {            // boss-local camera helpers: lx = his right, ly = up, lz = in front of him
    const fxv = -Math.sin(yaw), fzv = -Math.cos(yaw), rxv = Math.cos(yaw), rzv = -Math.sin(yaw);
    return {
      P: (lx, ly, lz) => _p.set(bx + rxv * lx + fxv * lz, AY + ly, bz + rzv * lx + fzv * lz),
      L: (lx, ly, lz) => _l.set(bx + rxv * lx + fxv * lz, AY + ly, bz + rzv * lx + fzv * lz),
    };
  }

  function* cut2() {                       // PHASE II: armour splits, wings tear out, crown rises
    const bx = S.x, bz = S.z, F = frame(bx, bz, S.yaw), T = 5.2;
    S.cineT = 0;
    S.cine = (t) => {
      let p, l, fov;
      if (t < 1.3) { const k = t / 1.3; p = F.P(-10 + 3 * k, 4.5, 26 - 6 * k); l = F.L(0, 11, 0); fov = 58 - 6 * k; }                       // 1 low, front-left: he staggers, cracks glow
      else if (t < 2.8) { const k = (t - 1.3) / 1.5; p = F.P(8 - 3 * k, 6 - k, -23 + 3 * k); l = F.L(0, 12.5, 0); fov = 56; }               // 2 CUT behind him: wings tear out
      else if (t < 3.9) { const k = (t - 2.8) / 1.1; p = F.P(2.5 - 2 * k, 15.2, 13 - 3 * k); l = F.L(0, 14.9, 0); fov = 46 - 4 * k; }       // 3 CUT face close-up: eyes ignite
      else { const k = (t - 3.9) / 1.3; p = F.P(-6 + 12 * k, 5 + 2 * k, 30 + 8 * k); l = F.L(0, 12, 0); fov = 62; }                         // 4 CUT wide: the new silhouette
      return { p, l, w: t > T - 0.8 ? 1 - ease((t - (T - 0.8)) / 0.8) : 1, fov };
    };
    pose({ torsoX: -0.55, headX: -0.8, rShZ: 1.3, lShZ: 1.3, rShX: 0.5, lShX: 0.5, plates: 0.6, hipY: -0.2 }, 5);
    sfx.roar(1); sfx.swell(1); shake(1); ui.flash('#ffffff', 0.6, 1.0);
    S.portalBoost = 1;
    arena.pillars.forEach((p, i) => later(0.15 + i * 0.25, () => {
      fx.arc(p.x, AY + 19, p.z, bx, AY + 11, bz, 0xd8b8ff, 0.5, 3);
      fx.burst(p.x, AY + 19, p.z, 14, 9, 0.7, 1.1, 0.1, 0xffffff, COL.void, { grav: 2 });
      sfx.zap(1); shake(0.15);
    }));
    later(1.3, () => {
      setPalette(2);
      pose({ plates: 1, torsoX: 0.1, headX: -0.3, rShZ: 1.5, lShZ: 1.5, rShX: 0.2, lShX: 0.2 }, 10);
      const c = anchor('core'), f = fwd(), x = c.x - f.x * 4, y = c.y, z = c.z - f.z * 4;
      fx.ball(x, y, z, 34, 0xffffff, 0.5); fx.ball(x, y, z, 60, 0xff4fd8, 0.9);
      fx.burst(x, y, z, 70, 30, 1.2, 2, 0.2, 0xffffff, 0xff4fd8, { grav: 3 });
      fx.debris(x, y, z, 24, 18, 18, 1.6, 0.4);
      fx.light(x, y, z, 0xff4fd8, 5000, 0.8);
      wave(bx, bz, { v: 30, maxR: 46, dmg: 0, col: 0xff4fd8, wallH: 3 });
      ui.flash('#ffffff', 0.85, 0.6); sfx.boom(1.8, 1); shake(0.9);
    });
    later(2.8, () => {
      pose({ eyes: 3, halo: 3, headX: -0.15, torsoX: -0.3, plates: 0.2 }, 6);
      sfx.roar(1); shake(0.8); ui.flash('#ff4fd8', 0.5, 0.6);
      ui.card('PHASE II', 'THE RIFT WIDENS', 3.0);
    });
    later(3.9, () => {
      rest(4); impact(bx, bz, 1.8, COL.void); regrowPillars(); sfx.boom(1.6, 1);
      for (let i = 0; i < 3; i++) later(i * 0.22, () => wave(bx, bz, { v: 26 + i * 6, maxR: 46, dmg: 0, col: i === 1 ? 0xffffff : 0xff4fd8, wallH: 4 }));
    });
    yield* during(T, () => {
      const t = S.cineT;
      part('heat', 2, prog(t, 0, 1.3)); part('crack', 2, prog(t, 0.2, 1.3));
      part('wing', 2, prog(t, 1.3, 2.6), outBack); part('blades', 2, prog(t, 1.3, 2.4)); part('spur', 2, prog(t, 1.6, 2.8), outBack);
      part('crown', 2, prog(t, 2.9, 3.8), outBack); part('scale', 2, prog(t, 3.9, 4.8), outBack);
      applyV();
      if (t < 1.3) {
        const c = anchor('core');
        for (let i = 0; i < 3; i++) fx.add(c.x + rnd(-3, 3), c.y + rnd(-3, 3), c.z + rnd(-1, 1), rnd(-3, 3), rnd(2, 8), rnd(-3, 3), 0.8, 1.4, 0.1, 0xffe0a0, 0xff4fd8, 1, -2, 0.5);
        shake(0.03);
      } else if (t < 3.9 && Math.random() < 0.5) fx.arc(bx + rnd(-8, 8), AY + rnd(8, 18), bz + rnd(-8, 8), bx + rnd(-3, 3), AY + rnd(6, 16), bz + rnd(-3, 3), 0xffc0f0, 0.15, 1.5);
    });
  }

  function* cut3() {                       // PHASE III: he kneels under a sky-beam, then rises bigger, winged and crowned
    const bx = S.x, bz = S.z, F = frame(bx, bz, S.yaw), T = 6.6;
    S.cineT = 0;
    S.cine = (t) => {
      let p, l, fov;
      if (t < 1.8) { const k = t / 1.8; p = F.P(-4 + 8 * k, 9, 46 - 6 * k); l = F.L(0, 8, 0); fov = 56; }                                     // 1 wide: he kneels, the sky tears
      else if (t < 3.4) { const k = (t - 1.8) / 1.6; p = F.P(-3 + 2 * k, 12.5, 12 - 2 * k); l = F.L(0, 12, -1); fov = 48 - 4 * k; }          // 2 CUT face: eyes ignite
      else if (t < 5.0) { const k = (t - 3.4) / 1.6; p = F.P(-7 + 3 * k, 1.6, 22 - 3 * k); l = F.L(0, 7 + 9 * k, 0); fov = 64 - 6 * k; }      // 3 CUT low angle: he rises, wings unfurl
      else { const k = (t - 5.0) / 1.6; p = F.P(-24 + 24 * k, 11 - 2 * k, 36 + 8 * k); l = F.L(0, 12, 0); fov = 60; }                        // 4 CUT pull-back: the final form
      return { p, l, w: t > T - 0.8 ? 1 - ease((t - (T - 0.8)) / 0.8) : 1, fov };
    };
    pose({ hipY: -2.3, lLegX: 0.9, rLegX: 0.9, lKneeX: 1.8, rKneeX: 1.8, torsoX: 0.5, headX: 0.45, plates: 0.8, rShX: 0.2, lShX: 0.2, eyes: 0.4, halo: 0.3 }, 4);
    sfx.swell(1); shake(0.6); ui.flash('#000000', 0.8, 0.8);
    S.portalBoost = 1;
    fx.beamT(bx, AY, bz, bx, AY + 240, bz, 5, COL.void, 2.4);
    fx.light(bx, AY + 10, bz, COL.void, 5000, 0.9);
    fx.decal(bx, bz, 12, 'glow', 0xff4a2a, 6);
    arena.pillars.forEach((p, i) => later(0.3 + i * 0.3, () => { fx.arc(p.x, AY + 19, p.z, bx, AY + 10, bz, 0xffc0a0, 0.5, 3); sfx.zap(1); shake(0.2); }));
    later(1.8, () => {
      setPalette(3);
      pose({ eyes: 3.4, halo: 4, headX: -0.1, torsoX: 0.3, plates: 0.4 }, 5);
      sfx.roar(1); shake(0.8); ui.flash('#ff4a2a', 0.55, 0.7);
    });
    later(3.4, () => {
      pose({ hipY: 0.2, lLegX: 0, rLegX: 0, lKneeX: 0, rKneeX: 0, torsoX: -0.35, headX: -0.6, rShZ: 1.5, lShZ: 1.5, rShX: 0.3, lShX: 0.3, plates: 0.9, eyes: 3, halo: 3.5 }, 5);
      ui.flash('#ffffff', 0.9, 0.8); sfx.boom(2.2, 1); sfx.roar(1); shake(1);
      impact(bx, bz, 2.2, 0xff4a2a); fx.debris(bx, AY + 2, bz, 40, 26, 26, 2, 0.4);
      for (let i = 0; i < 3; i++) later(i * 0.25, () => wave(bx, bz, { v: 28 + i * 8, maxR: 48, dmg: 0, col: i === 1 ? 0xffffff : 0xff4a2a, wallH: 5 }));
    });
    later(5.0, () => {
      rest(4); ui.card('PHASE III', 'THE SKY BURNS', 3.0); regrowPillars(); sfx.boom(1.6, 1);
      wave(bx, bz, { v: 40, maxR: 48, dmg: 0, col: 0xff4a2a, wallH: 6 });
    });
    yield* during(T, (p, dt) => {
      const t = S.cineT;
      part('heat', 3, prog(t, 0.4, 3.4)); part('crack', 3, prog(t, 0.6, 2.8));
      part('crown', 3, prog(t, 2.0, 3.2), outBack); part('spur', 3, prog(t, 2.4, 3.6), outBack);
      part('wing', 3, prog(t, 3.4, 4.6), outBack); part('blades', 3, prog(t, 3.4, 4.4)); part('scale', 3, prog(t, 3.6, 4.8), outBack);
      applyV();
      if (t < 3.4) {
        if (Math.random() < dt * 12) fx.arc(bx + rnd(-30, 30), AY + 120, bz + rnd(-30, 30), bx + rnd(-3, 3), AY + 10, bz + rnd(-3, 3), 0xffc8a0, 0.25, 5);
        for (let i = 0; i < 3; i++) fx.add(bx + rnd(-10, 10), AY + 0.3, bz + rnd(-10, 10), 0, rnd(5, 14), 0, 1, 1.5, 0.1, 0xffe0a0, 0xff3a0a, 1, -1, 0);
        shake(0.03);
      } else shake(0.015);
    });
  }
  function* cutscene(n) { yield* (n === 2 ? cut2() : cut3()); }

  // ======================================================================
  function update(dt) {
    updRings(dt); updSeekers(dt); updWalls(dt);
    const t = S.t;
    if (crown && crown.visible) { crown.rotation.y += dt * (0.5 + V.crown); crown.position.y = 3.9 + Math.sin(t * 2) * 0.12; }
    for (const side of ['l', 'r']) {
      const wg = wingG[side];
      if (wg && wg.visible) wg.rotation.y = (side === 'l' ? 1 : -1) * (0.25 + Math.sin(t * 1.3) * 0.06);
    }
  }
  function clear() {
    for (const R of ringsL) for (const h of R.h) h.hide(); ringsL.length = 0;
    for (const o of orbsL) { o.h.hide(); o.h2.hide(); } orbsL.length = 0;
    for (const W of wallsL) for (const h of W.h) h.hide(); wallsL.length = 0;
  }

  return { rush, blades, seekers, firewall, bloom, cutscene, dress, snapStage, setPalette, update, clear };
}
