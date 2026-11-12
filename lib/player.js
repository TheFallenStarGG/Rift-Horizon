/**
 * Player controller: movement (sprint / crouch / jump / double-jump perk / ramps / ceilings), three weapon slots,
 * hitscan + pellets + falloff, scope, melee + perks, thrown tomahawk, building (+ editing), pickups, damage / death / respawn, cameras.
 * ABILITY: special weapons (arsenal def.ability) fire their ability on the aim button instead of scoping (lib/abilities.js).
 */
import * as THREE from 'three';
import { resolveCircle, raycastWorld, floorAt, ceilAt } from './collision.js';
import {
  updateHumanoidAnim, updateViewmodel, triggerShootKick, triggerMelee, meleeBusy,
  ensureWeapon, setWeapon, resetViewmodelReload, resetReloadAnim,
} from './anim.js';
import { damageEnemy } from './enemy.js';
import { SPAWNS } from './scene.js';
import { EYE_H, CROUCH_EYE, settings } from './settings.js';
import { flying as devFlying, godMode as devGod } from './dev.js';
import { ALL, SLOTS, reloadDuration } from './arsenal.js';
import './weaponsPlus.js'; // ABILITY: registers the special weapons
import { createAbilities } from './abilities.js'; // ABILITY
import { loadout } from './loadout.js';
import { TYPES, ONLINE_EDITS } from './build.js'; // BUILD
import { poseBuildTool, buildToolPulse } from './buildKit.js'; // BUILD

const PI = Math.PI;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rnd = (a, b) => a + Math.random() * (b - a);

const WALK = 5.4, SPRINT = 8.4, CROUCH_SPEED = 2.8, STAND_H = 1.8, CROUCH_H = 1.35;
const JUMP = 6.4, JUMP2 = 5.8, GRAV = 18;
const NO_EJECT = new Set(['marshal', 'cutter', 'whisper', 'ridgeback', 'longbow', 'breacher', 'gale', 'cinder', 'lifeline', 'snare', 'beacon']); // bolt / pump / revolver / crossbow / launchers

export function createPlayerState() {
  return {
    x: 0, z: 8, y: SPAWNS.player[0].y, yaw: 0, pitch: 0.04, vx: 0, vz: 0, velY: 0, onGround: true, jumps: 0,
    hp: 100, maxHp: 100, alive: true, protectT: 0,
    slot: 'main', weaponId: 'vanguard', weaponName: '', weaponKind: 'gun',
    fireCd: 0, ammo: 30, magSize: 30, reserve: 120,
    reloading: false, reloadT: 0, reloadTotal: 2.85, reloadMissing: 1,
    ads: false, adsBlend: 0, scope: 0, lookScale: 1, recoil: 0, bloom: 0,
    radius: 0.42, eyeH: EYE_H,
    thirdPerson: false, inVehicle: false, vehicle: null, moving: false, sprinting: false, crouching: false, crouchBlend: 0,
    building: false, canBuild: true, editing: false, buildBlend: 0, // BUILD
    speed2d: 0, noise: 0, lastShotT: -99, lastHurtT: -99,
    kills: 0, deaths: 0, respawnT: 0, shake: 0, landDip: 0, deadRoll: 0, lean: 0,
  };
}

const hitCache = new WeakMap();
function hitMeshes(root) {
  let l = hitCache.get(root);
  if (!l) {
    l = [];
    root.traverse((o) => { if (o.isMesh && o.userData.hitZone) l.push(o); });
    hitCache.set(root, l);
  }
  return l;
}
const falloff = (f, d) => (!f || d <= f.start ? 1 : d >= f.end ? f.min : 1 + (f.min - 1) * ((d - f.start) / (f.end - f.start)));
/** attacker is behind the target (targets face -Z at yaw 0) */
const isBehind = (att, tgt) => {
  const fx = -Math.sin(tgt.yaw), fz = -Math.cos(tgt.yaw), dx = att.x - tgt.x, dz = att.z - tgt.z, l = Math.hypot(dx, dz) || 1;
  return (fx * dx + fz * dz) / l < -0.15;
};

function makeAxe() {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4527, roughness: 0.7 });
  const steel = new THREE.MeshStandardMaterial({ color: 0xc8ccd0, metalness: 1, roughness: 0.25 });
  const h = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.016, 0.4, 8), wood);
  h.rotation.x = PI / 2;
  const b = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.075, 0.09), steel);
  b.position.z = -0.2;
  g.add(h, b);
  return g;
}

export function createPlayerController(deps) {
  const {
    scene, camera, playerMesh, viewmodel, player, input, bullets, hud, audio, build, world, net,
    getEnemies, getRemotes, isMulti, isFrozen, isTouch, isFriend, isBots, drone, lottery, summon,
  } = deps;
  const raycaster = new THREE.Raycaster();
  const bodyU = playerMesh.userData, vmU = viewmodel.userData;
  const V = () => new THREE.Vector3();
  const _look = V(), _dir = V(), _o = V(), _right = V(), _up = V(), _a = V(), _b = V(), _c = V(), _m = V(), _vel = V();
  const inv = { main: null, side: null, melee: null, utility: null };
  const flashes = {};
  const axes = [];
  const cand = [];
  const tr = { t: 0, char: null, zone: null, c: null, occ: false };
  const bp = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
  let lastDry = 0, respawnCb = null, prevFiring = false, prevJump = false, fireBuffer = 0, throwCd = 0;
  let pendingSwing = false, time = 0, swayYaw = 0, swayPitch = 0, curPellets = 1;
  // BUILD: edit state + build tool animation state
  const ed = { on: false, held: false, downT: 0, quick: false, ignoreUp: false, paint: null, prevFire: false, fromCombat: false };
  let toolKick = 0, lastPlaced = 0, lastBType = build.type, lastBTier = build.tier;

  const cur = () => ALL[player.weaponId] || ALL.vanguard;
  const swapping = () => (player.thirdPerson ? bodyU : vmU).swapping;
  const H = (fn, ...a) => { if (hud[fn]) hud[fn](...a); };

  // ABILITY: special-weapon abilities (aim button). Handlers register in lib/pack*.js.
  const abil = createAbilities({
    scene, camera, player, hud, audio, bullets, isMulti,
    look: (o) => getLookDir(o),
    eye: (o) => { getLookDir(_look); return eyeOrigin(o); },
    targets: () => candidates().filter((c) => !(isFriend && isFriend(c))),
    hurt: (c, dmg, zone = 'body') => {
      if (c.remote) return false; // online damage needs the server
      const res = damageEnemy(c, dmg, zone);
      if (res.killed) soloKill(c, zone === 'head'); else { hud.hitMarker('hit'); audio.play('hit'); }
      return !!res.killed;
    },
  });

  // ---------- inventory ----------
  const stockFor = (id) => {
    const d = ALL[id];
    return d.kind === 'gun' ? { id, ammo: d.mag, reserve: d.total - d.mag } : { id };
  };
  function saveCur() {
    const s = inv[player.slot];
    if (s && s.id === player.weaponId && s.ammo !== undefined) { s.ammo = player.ammo; s.reserve = player.reserve; }
  }
  function loadCur() {
    const s = inv[player.slot], d = ALL[s.id];
    player.weaponId = s.id; player.weaponName = d.name; player.weaponKind = d.kind;
    if (d.kind === 'gun') { player.ammo = s.ammo; player.reserve = s.reserve; player.magSize = d.mag; }
    else { player.ammo = 0; player.reserve = 0; player.magSize = 0; }
  }
  function restock() {
    for (const sl of SLOTS) inv[sl] = stockFor(loadout[sl]);
    loadCur();
  }
  function refreshLoadout() {
    saveCur();
    const was = player.weaponId;
    for (const sl of SLOTS) if (!inv[sl] || inv[sl].id !== loadout[sl]) inv[sl] = stockFor(loadout[sl]);
    loadCur();
    if (was !== player.weaponId) { cancelReload(); abil.clearQueue(); player.ads = false; }
  }
  restock();

  function equip(slot) {
    if (!player.alive || slot === player.slot || !inv[slot]) return;
    if (summon && summon.busy()) return; // no weapon swaps mid-ritual
    if (player.building) setBuild(false);
    saveCur();
    cancelReload();
    abil.clearQueue(); // ABILITY
    player.slot = slot;
    loadCur();
    player.ads = false;
    fireBuffer = 0;
    audio.play('draw');
  }
  function scroll(dir) {
    if (player.building) { if (!ed.on) build.cycleType(dir); return; } // BUILD
    equip(SLOTS[(SLOTS.indexOf(player.slot) + dir + SLOTS.length) % SLOTS.length]);
  }
  /** digit keys: weapon slot, or piece type in build mode */
  function digit(i) {
    if (summon && summon.digit(i)) return; // 1-4 pick a vessel while the summon panel is open
    if (player.building) { endEdit(); build.select(TYPES[i]); } // BUILD
    else if (SLOTS[i]) equip(SLOTS[i]);
  }
  function quickMelee() {
    if (!player.alive) return;
    if (player.slot !== 'melee') equip('melee');
    pendingSwing = true;
  }

  // ---------- building ----------
  function setBuild(on) {
    if (!on) endEdit(); // BUILD
    if (on && (!player.alive || !player.canBuild)) return;
    player.building = !!on;
    build.setActive(!!on);
    if (on) { cancelReload(); player.ads = false; }
  }
  const toggleBuild = () => setBuild(!player.building);
  const buildTier = () => build.cycleTier();

  // BUILD: Z / X / B = pick that piece and enter build mode in one press; press it again to go back to the gun
  function pickPiece(t) {
    if (!player.alive || !player.canBuild) return;
    endEdit();
    if (player.building && build.type === t) { setBuild(false); return; }
    build.select(t);
    if (!player.building) setBuild(true);
  }

  // BUILD: editing (G = edit, hold G = quick edit, click tiles, G again = confirm, RMB = clear)
  const editOk = () => !isMulti() || ONLINE_EDITS;
  function endEdit() {
    if (!ed.on) return;
    build.cancelEdit();
    ed.on = false; ed.held = false; ed.quick = false; ed.paint = null;
    player.editing = false;
    if (ed.fromCombat) { ed.fromCombat = false; setBuild(false); }
  }
  function confirmEdit() {
    const r = build.confirmEdit();
    if (r === 'empty') { hud.setMsg('Leave at least one tile', 1200); return; }
    if (r === 'edited') audio.play('thud');
    hud.setMsg(r === 'pre' ? 'Next piece pre-edited (G, then RMB to clear)' : r === 'edited' ? 'Edit applied' : '', 1100);
    ed.on = false; ed.held = false; ed.quick = false; ed.paint = null;
    player.editing = false;
    if (ed.fromCombat) { ed.fromCombat = false; setBuild(false); }
  }
  function editDown() {
    if (!player.alive || !player.canBuild || isFrozen()) return;
    if (ed.on) { confirmEdit(); ed.ignoreUp = true; return; }
    if (!editOk()) { hud.setMsg('Editing online needs the server update', 1600); return; }
    getLookDir(_look);
    eyeOrigin(_o);
    let pc = build.pieceAt(_o, _look, 11);
    if (pc && !build.canEdit(pc.spec.type)) pc = null;
    if (!player.building) {
      if (!pc) { hud.setMsg('Aim at a wall or floor to edit', 1200); return; }
      setBuild(true);
      ed.fromCombat = true;
    }
    if (build.beginEdit(pc)) {
      hud.setMsg('Select a wall or floor to pre-edit', 1100);
      if (ed.fromCombat) { ed.fromCombat = false; setBuild(false); }
      return;
    }
    ed.on = true; ed.held = true; ed.downT = 0; ed.quick = false; ed.paint = null; ed.ignoreUp = false;
    player.editing = true;
    hud.setMsg(pc ? 'EDIT: click tiles, G confirm, RMB clear' : 'PRE-EDIT next piece: click tiles, G confirm', 1800);
  }
  function editUp() {
    ed.held = false;
    if (ed.ignoreUp) { ed.ignoreUp = false; return; }
    if (ed.on && ed.quick) confirmEdit();
  }
  function updateEdit(dt) {
    getLookDir(_look);
    eyeOrigin(_o);
    const idx = build.editRay(_o, _look, 12);
    const fire = input.firing;
    if (ed.held) { ed.downT += dt; if (ed.downT > 0.2) ed.quick = true; }
    if (ed.quick) { if (idx >= 0) build.editSet(idx, true); } // quick edit: hover selects
    else {
      if (fire && !ed.prevFire) ed.paint = idx >= 0 ? !build.editBit(idx) : null;
      if (fire && ed.paint !== null && idx >= 0) build.editSet(idx, ed.paint);
      if (!fire) ed.paint = null;
    }
    ed.prevFire = fire;
  }
  function runCmd(c) {
    if (c.startsWith('piece:')) pickPiece(c.slice(6));
    else if (c === 'editDown') editDown();
    else if (c === 'editUp') editUp();
  }

  // ---------- aim / camera mode ----------
  function setAim(down) {
    if (!player.alive) return;
    if (player.building) { if (down) { if (ed.on) build.editReset(); else build.cycleType(1); } return; } // BUILD
    const d = cur();
    if (d.kind === 'melee') {
      if (down) { if (d.ability) useAbility(d); else if (d.perk === 'throw') throwAxe(); } // ABILITY
      return;
    }
    if (d.ability) { if (down) useAbility(d); return; } // ABILITY: special guns can't scope, aim fires the ability
    if (player.reloading) { if (!down && !settings.adsToggle) player.ads = false; return; }
    if (settings.adsToggle) { if (down) player.ads = !player.ads; } else player.ads = down;
  }

  /** ABILITY: aim button on a special weapon. Guns fire it instantly; melee rides on the swing animation. */
  function useAbility(d) {
    if (isFrozen() || swapping()) return;
    if (d.kind === 'melee') {
      if (!abil.canUse(d.ability) || meleeBusy(player.thirdPerson ? playerMesh : viewmodel)) return;
      if (swing()) abil.queue(d.ability); // fires on the swing / hit event (see onAnim)
      return;
    }
    if (abil.use(d.ability)) {
      player.fireCd = Math.max(player.fireCd, 0.3);
      triggerShootKick(vmU);
      triggerShootKick(bodyU);
      audio.play('draw');
    }
  }
  function toggleCamera() {
    player.thirdPerson = !player.thirdPerson;
    hud.setMsg(player.thirdPerson ? 'Third person' : 'First person', 1000);
  }

  // ---------- aiming helpers ----------
  function getLookDir(out) {
    const pitch = clamp(player.pitch + player.recoil + swayPitch, -1.4, 1.4), yaw = player.yaw + swayYaw;
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    return out.set(-sy * cp, sp, -cy * cp).normalize();
  }
  function eyePos(out) {
    return player.thirdPerson ? out.set(player.x, player.y + player.eyeH, player.z) : out.copy(camera.position);
  }
  /** shot origin (3rd person: the camera ray projected to the player's eye depth) */
  function eyeOrigin(out) {
    if (!player.thirdPerson) return out.copy(camera.position);
    _a.set(player.x, player.y + player.eyeH, player.z);
    return out.copy(camera.position).addScaledVector(_look, Math.max(0, _look.dot(_b.subVectors(_a, camera.position))));
  }
  function spread() {
    const d = cur();
    if (!d.spread) return 0.01;
    const pel = d.pellets > 1 ? 0.3 : 1;
    let s = player.ads ? d.spread.ads : d.spread.hip;
    s += clamp(player.speed2d / WALK, 0, 1.6) * (player.ads ? 0.004 : 0.014) * pel;
    if (!player.onGround) s += 0.04 * pel;
    if (player.crouching) s *= 0.65;
    return (s + player.bloom * (player.ads ? 0.006 : 0.014) * pel) * abil.mods.spread; // ABILITY
  }

  function candidates() {
    cand.length = 0;
    if (isMulti()) {
      for (const [id, r] of getRemotes()) if (r.alive) cand.push({ id, mesh: r.mesh, x: r.x, y: r.y || 0, z: r.z, yaw: r.yaw, team: r.team, remote: true });
    } else for (const e of getEnemies()) if (e.alive) cand.push(e);
    return cand;
  }

  /** world + character ray. Returns a shared result { t, char, zone, c, occ } (use it immediately) */
  function trace(o, dir, maxT) {
    const w = raycastWorld(o.x, o.y, o.z, dir.x, dir.y, dir.z, maxT);
    const pierce = abil.mods.pierce; // ABILITY: Phase Rounds ignore the world for character hits
    tr.occ = !!(pierce && w);
    tr.t = w && !pierce ? w.t : maxT;
    tr.c = w && !pierce ? w.c : null;
    tr.char = null; tr.zone = null; tr.drone = false;
    const dh = drone.hitDistance(o, dir, tr.t);
    if (dh !== null) { tr.t = dh; tr.c = null; tr.drone = true; }
    const h2 = dir.x * dir.x + dir.z * dir.z;
    if (h2 < 1e-6) return tr;
    raycaster.set(o, dir);
    for (const c of candidates()) {
      const tt = ((c.x - o.x) * dir.x + (c.z - o.z) * dir.z) / h2;
      if (tt < 0 || tt > tr.t) continue;
      const perp = Math.hypot(o.x + dir.x * tt - c.x, o.z + dir.z * tt - c.z);
      if (!c.remote && perp > 0.45 && perp < 1.8 && tt > 3) c.suppression = Math.min(1, c.suppression + 0.22 / curPellets);
      if (perp > 1.3) continue;
      c.mesh.updateMatrixWorld(true);
      raycaster.far = tr.t;
      const hits = raycaster.intersectObjects(hitMeshes(c.mesh), false);
      if (hits.length && hits[0].distance < tr.t) {
        tr.t = hits[0].distance; tr.char = c; tr.zone = hits[0].object.userData.hitZone || 'body'; tr.c = null;
      }
    }
    return tr;
  }

  // ---------- reload ----------
  function cancelReload() {
    if (!player.reloading) return;
    player.reloading = false;
    player.reloadT = 0;
    resetViewmodelReload(viewmodel);
    resetReloadAnim(bodyU);
  }
  function startReload() {
    const d = cur();
    if (d.kind !== 'gun' || player.reloading || !player.alive || player.building || isFrozen() || swapping()) return;
    if (player.ammo >= d.mag || player.reserve <= 0) return;
    player.reloadMissing = Math.min(d.mag - player.ammo, player.reserve);
    player.reloadTotal = reloadDuration(d, player.reloadMissing);
    player.reloading = true;
    player.reloadT = 0;
    player.ads = false;
    resetViewmodelReload(viewmodel);
    resetReloadAnim(bodyU);
  }
  function finishReload() {
    const d = cur();
    if (d.kind === 'gun' && !(d.reload && d.reload.style === 'shells')) {
      const take = Math.min(d.mag - player.ammo, player.reserve);
      player.ammo += take;
      player.reserve -= take;
    }
    player.reloading = false;
  }

  // ---------- animation events (only the visible rig acts) ----------
  function onAnim(name, info, fp) {
    if (fp === player.thirdPerson) return;
    switch (name) {
      case 'toss': {
        const pos = info.pos.clone();
        if (fp) {
          camera.localToWorld(pos);
          _vel.set(rnd(-3, -2.1), rnd(0.5, 1.3), rnd(-1.2, 0.2)).applyQuaternion(camera.quaternion);
        } else _vel.set(-Math.cos(player.yaw) * 2.4 - Math.sin(player.yaw) * 0.3, rnd(0.7, 1.3), Math.sin(player.yaw) * 2.4 - Math.cos(player.yaw) * 0.3);
        _vel.x += player.vx * 0.5; _vel.z += player.vz * 0.5;
        bullets.dropMag(pos, _vel);
        break;
      }
      case 'eject': {
        const pos = info.pos.clone();
        if (fp) {
          camera.localToWorld(pos);
          _vel.set(rnd(1, 2), rnd(0.8, 1.5), rnd(-0.3, 0.3)).applyQuaternion(camera.quaternion);
        } else _vel.set(Math.cos(player.yaw) * rnd(1, 2), rnd(0.8, 1.5), -Math.sin(player.yaw) * rnd(1, 2));
        bullets.ejectShell(pos, _vel);
        audio.play('eject');
        break;
      }
      case 'shellIn': {
        const d = cur();
        if (d.reload && d.reload.style === 'shells' && player.ammo < d.mag && player.reserve > 0) { player.ammo++; player.reserve--; }
        audio.play('shellIn');
        break;
      }
      case 'swing': audio.play('swing'); abil.fire('swing'); break; // ABILITY
      case 'throwStart': audio.play('swing'); break;
      case 'meleeHit': if (!abil.fire('hit')) resolveMelee(); break; // ABILITY: some abilities replace the normal hit
      case 'throwRelease': launchAxe(info, fp); break;
      case 'grab':
      case 'place':
      case 'tablet':
      case 'tap':
      case 'deployStart':
        if (drone.onDeployEvent) drone.onDeployEvent(name);
        break;
      default: audio.play(name);
    }
  }

  // ---------- shooting ----------
  function flashFor(id) {
    let f = flashes[id];
    if (!f) {
      f = flashes[id] = {
        fp: bullets.attachFlash(ensureWeapon(vmU, id).muzzle, 0.32),
        tp: bullets.attachFlash(ensureWeapon(bodyU, id).muzzle, 0.55),
      };
    }
    return f;
  }

  function tryFire() {
    const d = cur();
    if (!player.alive || isFrozen() || player.building || swapping() || player.fireCd > 0) return false;
    if (player.reloading) {
      if (d.reload && d.reload.style === 'shells' && player.ammo > 0) cancelReload(); else return false;
    }
    if (player.ammo <= 0) {
      if (player.reserve > 0) startReload();
      else { const now = performance.now() / 1000; if (now - lastDry > 0.4) { audio.play('dry'); lastDry = now; } }
      return true;
    }
    shoot(d);
    return true;
  }

  function pieceHit(pc, dmg, weaponId, n) {
    if (isMulti() && net) net.sendBuildDamage(pc.key, weaponId, n);
    else build.damage(pc, dmg);
  }

  function soloKill(c, head) {
    player.kills++;
    hud.hitMarker('kill');
    audio.play('kill');
    hud.addKill('You', c.name, head);
    hud.setScore(player.kills, player.deaths);
    if (isBots && isBots()) {
      const d = ALL[player.weaponId];
      if (c && c.isLeader) {
        // Boss bounty
        if (d && d.kind === 'gun') {
          player.ammo = d.mag;
          player.reserve = Math.min((d.total || d.mag * 4), player.reserve + Math.ceil((d.mag || 30) * 1.5));
        }
        player.hp = Math.min(player.maxHp || 100, player.hp + 45);
        hud.setMsg('BOSS DOWN — full mag + reserves + health', 2800);
        audio.play('kill');
      } else if (d && d.kind === 'gun') {
        const add = Math.max(3, Math.ceil((d.mag || 30) * 0.4));
        player.ammo = Math.min(d.mag, player.ammo + add);
      }
    }
  }

  function shoot(d) {
    const now = performance.now() / 1000, tp = player.thirdPerson, mods = abil.mods;
    // Ridgeback Lottery: next shot becomes a single delete-round
    let lot = null;
    if (lottery && lottery.isArmed && lottery.isArmed()) {
      lot = lottery.consumeShot();
    }
    if (!mods.noAmmo) player.ammo--; // ABILITY: Overdrive doesn't eat ammo
    player.fireCd = lot ? lot.fireCd : d.cd * mods.fireCd; // ABILITY
    if (lot) {
      player.recoil = Math.min(1, (player.recoil || 0) + lot.recoil);
      player.shake = Math.max(player.shake || 0, lot.shake);
      player.bloom = 1;
    } else {
      player.bloom = Math.min(1, player.bloom + 0.12);
    }
    if (!(lot && lot.silent) && !d.silent) player.lastShotT = now;

    getLookDir(_look);
    eyeOrigin(_o);
    _right.set(Math.cos(player.yaw), 0, -Math.sin(player.yaw));
    _up.crossVectors(_right, _look).normalize();
    (tp ? bodyU : vmU).muzzle.getWorldPosition(_m);
    if (!tp) camera.localToWorld(_m);
    const fl = flashFor(d.id);
    if (tp) fl.tp.fire(); else fl.fp.fire(_m);
    audio.play('shot', undefined, undefined, { snd: d.id });

    const n = lot ? 1 : d.pellets;
    const sp = lot ? (lot.spread || 0.001) : spread();
    const dmgTable = lot ? lot.dmg : d.dmg;
    const bulletSpd = lot ? lot.bulletSpeed : d.bulletSpeed;
    curPellets = n;
    const groups = new Map(), pieces = new Map();
    let mainDir = null;
    for (let i = 0; i < n; i++) {
      const ang = rnd(0, PI * 2), rad = sp * Math.sqrt(Math.random());
      _dir.copy(_look).addScaledVector(_right, Math.cos(ang) * rad).addScaledVector(_up, Math.sin(ang) * rad).normalize();
      if (i === 0) mainDir = _dir.clone();
      const r = trace(_o, _dir, 200);
      _c.copy(_o).addScaledVector(_dir, Math.min(r.t, 150));
      if (r.drone) { drone.damage(dmgTable.body); continue; }
      if (r.char) {
        const key = r.char.id + '|' + r.zone;
        let g = groups.get(key);
        if (!g) groups.set(key, (g = { c: r.char, zone: r.zone, n: 0, w: 0 }));
        g.n++;
        g.w += r.occ ? 0.8 : 1; // ABILITY: Phase Rounds do 80% through walls
        bullets.impact(_c, _a.set(-_dir.x, -_dir.y, -_dir.z), 'body');
      } else {
        if (r.c) {
          if (r.c.onShot) r.c.onShot(dmgTable.body, _c);
          if (r.c.piece) {
            let g = pieces.get(r.c.piece.key);
            if (!g) pieces.set(r.c.piece.key, (g = { piece: r.c.piece, n: 0 }));
            g.n++;
          }
        }
        if (n === 1 || i < 3) {
          _b.subVectors(_c, _m);
          const tl = _b.length();
          bullets.spawn(_m, tl > 1.5 ? _b.divideScalar(tl) : _dir, bulletSpd, false);
        }
      }
    }

    // casing
    if (!NO_EJECT.has(d.id)) {
      const ej = tp ? bodyU.eject : vmU.eject;
      ej.getWorldPosition(_a);
      if (tp) _c.copy(_right); else { _c.set(1, 0, 0).applyQuaternion(camera.quaternion); camera.localToWorld(_a); }
      _vel.copy(_c).multiplyScalar(rnd(1.8, 2.8));
      _vel.y += rnd(1.0, 1.8);
      _vel.x += player.vx * 0.5; _vel.z += player.vz * 0.5;
      bullets.ejectShell(_a, _vel);
    }

    // recoil + kick
    if (lot) {
      player.recoil = Math.min(0.45, player.recoil + lot.recoil);
      player.yaw += rnd(-1, 1) * 0.12;
      player.pitch = Math.max(-1.4, player.pitch - 0.18);
      if (lottery.fireBurst) lottery.fireBurst(_m, mainDir || _look);
    } else {
      player.recoil = Math.min(0.25, player.recoil + d.recoil * mods.recoil * (player.ads ? 0.75 : 1) * (player.crouching ? 0.8 : 1));
      player.yaw += rnd(-1, 1) * d.recoil * mods.recoil * 0.25;
    }
    triggerShootKick(vmU);
    triggerShootKick(bodyU);

    // damage
    const hits = [];
    for (const g of groups.values()) {
      const head = g.zone === 'head';
      const dist = Math.hypot(g.c.x - _o.x, g.c.z - _o.z);
      const zoneDmg = dmgTable[g.zone] != null ? dmgTable[g.zone] : dmgTable.body;
      const mark = g.c.markUntil > now ? 1.2 : 1; // ABILITY: Pulse Scan marks
      const raw = lot ? zoneDmg * g.n : zoneDmg * falloff(d.falloff, dist) * g.w * mods.dmg * mark;
      if (g.c.remote) {
        hits.push({ id: g.c.id, zone: g.zone, n: g.n, lottery: !!lot });
        hud.hitMarker(head ? 'head' : 'hit');
        audio.play(head ? 'headshot' : 'hit');
      } else {
        const res = damageEnemy(g.c, raw, g.zone);
        if (res.killed) soloKill(g.c, head);
        else { hud.hitMarker(head ? 'head' : 'hit'); audio.play(head ? 'headshot' : 'hit'); }
      }
    }
    for (const g of pieces.values()) pieceHit(g.piece, dmgTable.body * g.n, lot ? 'ridgeback' : d.id, g.n);
    if (isMulti() && net) {
      net.sendShoot({ weapon: lot ? 'ridgeback' : d.id, ox: _m.x, oy: _m.y, oz: _m.z, dx: mainDir.x, dy: mainDir.y, dz: mainDir.z, hits, lottery: !!lot });
    }
  }

  // ---------- melee ----------
  function swing() {
    const d = cur();
    if (!player.alive || isFrozen() || player.building || swapping()) return false;
    // Utilities
    if (d.kind === 'utility') {
      if (meleeBusy(player.thirdPerson ? playerMesh : viewmodel)) return false;
      if (d.perk === 'drone') {
        if (!drone.begin(player)) return false;
        triggerMelee(viewmodel, 'deploy');
        triggerMelee(playerMesh, 'deploy');
        return true;
      }
      if (d.perk === 'lottery') {
        if (!lottery || !lottery.arm()) return false;
        triggerMelee(viewmodel, 'deploy');
        triggerMelee(playerMesh, 'deploy');
        return true;
      }
      if (d.perk === 'summon') {
        if (summon) summon.use(player); // opens the vessel picker; the ritual animation starts once you pick
        return false;
      }
      return false;
    }
    if (d.kind !== 'melee') return false;
    if (meleeBusy(player.thirdPerson ? playerMesh : viewmodel)) return false;
    triggerMelee(viewmodel, 'swing');
    triggerMelee(playerMesh, 'swing');
    return true;
  }

  function hitMelee(d, c, zone) {
    audio.play('stab');
    const head = zone === 'head';
    const behind = !!d.dmg.back && isBehind(player, c);
    if (behind) hud.setMsg('BACKSTAB', 900);
    if (c.remote) {
      if (net) net.sendMelee({ weapon: d.id, id: c.id, zone });
      hud.hitMarker(head || behind ? 'head' : 'hit');
      return;
    }
    const dmg = behind ? d.dmg.back : head ? d.dmg.head : d.dmg.front;
    const res = damageEnemy(c, dmg, head ? 'head' : 'body');
    if (d.knockback) { c.vx += _look.x * d.knockback; c.vz += _look.z * d.knockback; }
    if (res.killed) {
      soloKill(c, head || behind);
      if (d.heal) {
        player.hp = Math.min(player.maxHp, player.hp + d.heal);
        hud.setMsg(`+${d.heal} HP`, 900);
      }
    } else hud.hitMarker(head || behind ? 'head' : 'hit');
  }

  function resolveMelee() {
    const d = cur();
    if (d.kind !== 'melee' || !player.alive) return;
    getLookDir(_look);
    eyePos(_o);
    const reach = d.range, list = candidates();
    let best = null, bestT = 1e9, zone = 'front';
    raycaster.set(_o, _look);
    raycaster.far = reach + 0.25;
    for (const c of list) {
      if (Math.hypot(c.x - _o.x, c.z - _o.z) > reach + 1.2) continue;
      c.mesh.updateMatrixWorld(true);
      const hs = raycaster.intersectObjects(hitMeshes(c.mesh), false);
      if (hs.length && hs[0].distance < bestT) {
        bestT = hs[0].distance; best = c; zone = hs[0].object.userData.hitZone === 'head' ? 'head' : 'front';
      }
    }
    if (!best) { // forgiving cone
      let bd = 1e9;
      for (const c of list) {
        const dx = c.x - _o.x, dz = c.z - _o.z, h = Math.hypot(dx, dz);
        if (h > reach + 0.5) continue;
        const dy = c.y + 1.1 - _o.y, l = Math.hypot(h, dy) || 1;
        if ((dx * _look.x + dy * _look.y + dz * _look.z) / l < 0.8) continue;
        if (h < bd) { bd = h; best = c; }
      }
    }
    if (best) { // line of sight
      _b.set(best.x - _o.x, best.y + 1.1 - _o.y, best.z - _o.z);
      const L = _b.length() || 1;
      _b.divideScalar(L);
      const w = raycastWorld(_o.x, _o.y, _o.z, _b.x, _b.y, _b.z, L);
      if (w && w.t < L - 0.4) best = null;
    }
    if (best) { hitMelee(d, best, zone); return; }
    const w = raycastWorld(_o.x, _o.y, _o.z, _look.x, _look.y, _look.z, reach);
    if (!w) return;
    const c = w.c;
    audio.play(c && c.piece ? 'thud' : 'clang');
    if (c) {
      if (c.onShot) c.onShot(d.dmg.front, null);
      if (c.piece) pieceHit(c.piece, d.perk === 'demolish' ? 99999 : d.dmg.front, d.id, 1);
    }
  }

  // ---------- thrown tomahawk ----------
  function throwAxe() {
    const d = cur();
    if (d.perk !== 'throw' || throwCd > 0 || !player.alive || isFrozen() || swapping()) return;
    if (meleeBusy(player.thirdPerson ? playerMesh : viewmodel)) return;
    throwCd = d.throwCd;
    triggerMelee(viewmodel, 'throw');
    triggerMelee(playerMesh, 'throw');
  }
  function launchAxe(info, fp) {
    const d = cur();
    const pos = info.pos.clone();
    if (fp) camera.localToWorld(pos);
    getLookDir(_look);
    const mesh = makeAxe();
    mesh.position.copy(pos);
    scene.add(mesh);
    axes.push({ mesh, p: pos, v: _look.clone().multiplyScalar(38), life: d.throwRange / 38 + 0.3, stuck: 0, id: d.id, dmg: d.dmg.thrown });
  }
  function updateAxes(dt) {
    for (let i = axes.length - 1; i >= 0; i--) {
      const a = axes[i];
      if (a.stuck > 0) {
        a.stuck -= dt;
        if (a.stuck <= 0) { scene.remove(a.mesh); axes.splice(i, 1); }
        continue;
      }
      a.life -= dt;
      a.v.y -= 8 * dt;
      const len = a.v.length() * dt;
      _dir.copy(a.v).normalize();
      const w = raycastWorld(a.p.x, a.p.y, a.p.z, _dir.x, _dir.y, _dir.z, len);
      const reach = w ? w.t : len;
      let hit = null;
      for (const c of candidates()) { // closest approach of the segment to the chest
        _b.set(c.x - a.p.x, c.y + 1.1 - a.p.y, c.z - a.p.z);
        const t = clamp(_b.dot(_dir), 0, reach);
        if (_b.distanceTo(_c.copy(_dir).multiplyScalar(t)) < 0.6) { hit = c; break; }
      }
      if (hit) {
        if (hit.remote) { if (net) net.sendMelee({ weapon: a.id, id: hit.id, thrown: true, zone: 'front' }); hud.hitMarker('hit'); }
        else {
          const res = damageEnemy(hit, a.dmg, 'body');
          if (res.killed) soloKill(hit, false); else hud.hitMarker('hit');
        }
        audio.play('stab');
        scene.remove(a.mesh); axes.splice(i, 1);
        continue;
      }
      a.p.addScaledVector(_dir, reach);
      a.mesh.position.copy(a.p);
      a.mesh.rotation.x += dt * 22;
      if (w) {
        a.stuck = 4;
        audio.play(w.c && w.c.piece ? 'thud' : 'clang');
        if (w.c && w.c.piece) pieceHit(w.c.piece, 40, a.id, 1);
      } else if (a.life <= 0) { scene.remove(a.mesh); axes.splice(i, 1); }
    }
  }

  // ---------- damage / death / respawn ----------
  function hurtFeedback(sx, sz) {
    player.lastHurtT = performance.now() / 1000;
    player.shake = Math.min(0.06, player.shake + 0.03);
    audio.play('hurt');
    if (typeof sx === 'number') {
      const dx = sx - player.x, dz = sz - player.z;
      const fwd = -Math.sin(player.yaw) * dx - Math.cos(player.yaw) * dz;
      const rgt = Math.cos(player.yaw) * dx - Math.sin(player.yaw) * dz;
      hud.damage(Math.atan2(rgt, fwd));
    } else hud.damage(null);
  }
  function queueRespawn(ms, cb) {
    player.respawnT = Math.max(0.05, ms / 1000);
    respawnCb = cb || null;
  }
  function die(by) {
    if (!player.alive) return;
    player.alive = false; player.hp = 0; player.ads = false; player.reloading = false; player.sprinting = false;
    abil.reset(); // ABILITY: end shields / buffs / marks
    setBuild(false);
    player.deaths++;
    audio.play('death');
    if (!isMulti()) {
      if (by) hud.addKill(by, 'You', false);
      hud.setScore(player.kills, player.deaths);
      queueRespawn(3000);
    }
  }
  /** solo damage from a bot */
  function applyDamage(dmg, sx, sz, by) {
    if (devGod()) return;
    if (!player.alive || player.protectT > 0) return;
    dmg = abil.absorb(dmg); // ABILITY: Barrier / parries soak damage first
    if (dmg <= 0) return;
    player.hp = Math.max(0, player.hp - dmg);
    hurtFeedback(sx, sz);
    if (player.hp <= 0) die(by);
  }
  /** multiplayer: server-authoritative hp */
  function syncHp(hp, alive, sx, sz) {
    const was = player.hp;
    player.hp = hp;
    if (hp < was) hurtFeedback(sx, sz);
    if (!alive && player.alive) die();
  }
  function heal(hp) { player.hp = Math.min(player.maxHp, hp); }

  function respawnAt(sp) {
    player.x = sp.x; player.z = sp.z; player.y = sp.y || 0; player.yaw = sp.yaw || 0; player.pitch = 0.05;
    player.vx = player.vz = player.velY = 0;
    player.onGround = true; player.jumps = 0;
    player.recoil = 0; player.bloom = 0;
    player.hp = player.maxHp; player.alive = true;
    abil.onRespawn(); // ABILITY: fresh cooldowns every life
    if (lottery && lottery.onRespawn) lottery.onRespawn();
    if (summon) summon.onRespawn();
    player.reloading = false; player.ads = false; player.respawnT = 0; player.adsBlend = 0;
    player.eyeH = EYE_H; player.deadRoll = 0; player.crouchBlend = 0;
    player.protectT = isMulti() ? 0 : 1.5;
    setBuild(false);
    player.slot = 'main';
    restock();
    setWeapon(viewmodel, player.weaponId, true);
    setWeapon(playerMesh, player.weaponId, true);
    hud.setRespawn(null);
    audio.play('respawn');
  }
  function respawn() {
    const sp = SPAWNS.player[Math.floor(Math.random() * SPAWNS.player.length)];
    respawnAt({ x: sp.x + rnd(-1, 1), z: sp.z + rnd(-1, 1), y: sp.y, yaw: sp.yaw || 0 });
  }

  // ---------- pickups ----------
  function collect(pk) {
    if (pk.kind === 'ammo') {
      saveCur();
      let any = false;
      for (const sl of ['main', 'side']) {
        const s = inv[sl], d = ALL[s.id];
        if (s.reserve >= d.total) continue;
        s.reserve = Math.min(d.total, s.reserve + Math.ceil(d.total * 0.4));
        any = true;
      }
      if (!any) return;
      loadCur();
      hud.setMsg('+ Ammo', 900);
    } else if (pk.kind === 'mats') {
      build.addMats(150);
      hud.setMsg('+ Materials', 900);
    } else if (pk.kind === 'health') {
      if (isMulti() || player.hp >= player.maxHp) return;
      player.hp = Math.min(player.maxHp, player.hp + 45);
      hud.setMsg('+ Health', 900);
    }
    audio.play('pouch');
    world.consumePickup(pk);
  }

  // ---------- camera ----------
  function syncCamera(dt) {
    const d = cur(), tp = player.thirdPerson;
    player.eyeH += ((player.alive ? lerp(EYE_H, CROUCH_EYE, player.crouchBlend) : 0.3) - player.eyeH) * Math.min(1, dt * 12);
    player.deadRoll += ((player.alive ? 0 : 0.7) - player.deadRoll) * Math.min(1, dt * 4);
    player.landDip = Math.max(0, player.landDip - dt * 0.35);

    const scopeOn = !!d.scope && !tp;
    player.adsBlend += ((player.ads && player.alive ? 1 : 0) - player.adsBlend) * Math.min(1, dt * (scopeOn ? 8 : 12));
    player.scope = scopeOn ? player.adsBlend : 0;
    player.lookScale = player.ads ? (scopeOn ? 0.62 / (d.scope.zoom * 0.7) : 0.62) : 1;
    if (scopeOn && player.ads) {
      const amp = d.scope.sway * (1 + clamp(player.speed2d / 3, 0, 2) * 2) * (player.crouching ? 0.5 : 1);
      swayYaw = (Math.sin(time * 1.1) + 0.5 * Math.sin(time * 2.7)) * amp;
      swayPitch = (Math.cos(time * 0.9) + 0.5 * Math.sin(time * 2.1 + 1)) * amp;
    } else { swayYaw *= 0.8; swayPitch *= 0.8; }

    playerMesh.position.set(player.x, player.y, player.z);
    playerMesh.rotation.y = player.yaw;
    const sc = !!player.showcase;
    playerMesh.visible = tp || sc;
    viewmodel.visible = !tp && !sc && player.alive && player.scope < 0.9;
    if (sc) playerMesh.rotation.y = player.yaw + time * 0.6;

    getLookDir(_look);
    const cy = Math.cos(player.yaw), sy = Math.sin(player.yaw);
    if (sc) {
      camera.position.set(player.x - sy * 2.8, player.y + 1.35, player.z - cy * 2.8);
      camera.lookAt(player.x + cy * 0.9, player.y + 1.0, player.z - sy * 0.9);
    } else if (tp) {
      _a.set(player.x, player.y + player.eyeH, player.z);
      _right.set(cy, 0, -sy);
      const back = player.ads ? 1.9 : 3.0, side = player.ads ? 0.5 : 0.8;
      _b.copy(_a).addScaledVector(_look, -back).addScaledVector(_right, side);
      _b.y += 0.2;
      _c.subVectors(_b, _a);
      const L = _c.length();
      _c.divideScalar(L);
      const h = raycastWorld(_a.x, _a.y, _a.z, _c.x, _c.y, _c.z, L + 0.2);
      _b.copy(_a).addScaledVector(_c, h ? Math.max(0.3, h.t - 0.2) : L);
      _b.y = Math.max(player.y + 0.25, _b.y);
      camera.position.copy(_b);
      camera.lookAt(_b.x + _look.x * 20, _b.y + _look.y * 20, _b.z + _look.z * 20);
    } else {
      camera.position.set(player.x, player.y + player.eyeH - player.landDip, player.z);
      camera.lookAt(camera.position.x + _look.x, camera.position.y + _look.y, camera.position.z + _look.z);
    }
    const lateral = player.vx * cy - player.vz * sy;
    player.lean += (-lateral * 0.0025 - player.lean) * Math.min(1, dt * 8);
    const roll = player.lean + player.deadRoll + (Math.random() - 0.5) * player.shake;
    if (roll) camera.rotateZ(roll);

    const base = settings.fov;
    let tf = base + (player.sprinting ? 4 : 0);
    if (player.ads) {
      if (scopeOn) tf = (2 * Math.atan(Math.tan((base * PI) / 360) / d.scope.zoom) * 180) / PI;
      else tf = base * (tp ? 0.78 : d.adsZoom || 0.8);
    }
    camera.fov += (tf - camera.fov) * Math.min(1, dt * (scopeOn && player.ads ? 14 : 10));
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  // ---------- mobile aim assist + auto fire ----------
  let aTarget = null, aErr = 9, aDist = 50, autoOn = false;
  function assist(dt, d) {
    aTarget = null; aErr = 9;
    if (!isTouch || !player.alive || player.building || d.kind !== 'gun' || isFrozen()) return;
    getLookDir(_look);
    eyePos(_o);
    const rng = d.scope ? 120 : Math.min(90, d.falloff ? d.falloff.end * 1.4 : 90);
    for (const c of candidates()) {
      if (isFriend && isFriend(c)) continue;
      _b.set(c.x - _o.x, c.y + 1.3 - _o.y, c.z - _o.z);
      const dist = _b.length();
      if (dist < 1 || dist > rng) continue;
      _b.divideScalar(dist);
      const err = Math.acos(clamp(_b.dot(_look), -1, 1));
      if (err > 0.05 + 1.2 / dist || err > aErr) continue;
      const w = raycastWorld(_o.x, _o.y, _o.z, _b.x, _b.y, _b.z, dist);
      if (w && w.t < dist - 0.6) continue;
      aTarget = c; aErr = err; aDist = dist;
    }
  }
  function pullAim(dt) {
    const s = settings.assistStrength;
    player.lookScale *= 1 - 0.45 * s; // friction near a target
    const k = Math.min(1, (input.firing || autoOn ? 7 : 2.2) * s * (player.ads ? 1.4 : 1) * dt);
    const dx = aTarget.x - player.x, dz = aTarget.z - player.z, dy = aTarget.y + 1.3 - (player.y + player.eyeH);
    const wy = Math.atan2(-dx, -dz) - (player.yaw + swayYaw);
    player.yaw += Math.atan2(Math.sin(wy), Math.cos(wy)) * k;
    player.pitch += (Math.atan2(dy, Math.hypot(dx, dz)) - (player.pitch + player.recoil + swayPitch)) * k;
  }

  // ---------- per-frame ----------
  function update(dt) {
    const now = performance.now() / 1000;
    time += dt;
    const frozen = isFrozen() || drone.busy() || (summon && summon.busy());
    player.fireCd = Math.max(0, player.fireCd - dt);
    throwCd = Math.max(0, throwCd - dt);
    fireBuffer = Math.max(0, fireBuffer - dt);
    player.protectT = Math.max(0, player.protectT - dt);
    player.bloom = Math.max(0, player.bloom - dt * 1.6);
    player.recoil = Math.max(0, player.recoil - dt * (0.05 + 1.2 * player.recoil));
    player.shake = Math.max(0, player.shake - dt * 3);
    abil.update(dt); // ABILITY: cooldowns + active effects (writes abil.mods)
    const look = input.consumeLook();
    const k = input.keys, st = input.stick;
    const cmds = input.consumeCmds ? input.consumeCmds() : null; // BUILD
    if (cmds) for (const c of cmds) runCmd(c);

    if (player.respawnT > 0) {
      player.respawnT -= dt;
      if (player.respawnT <= 0 && !isMulti()) {
        const cb = respawnCb;
        respawnCb = null;
        respawn();
        if (cb) cb();
      }
    }
    if (!player.alive) hud.setRespawn(player.respawnT > 0 ? Math.ceil(player.respawnT) : isMulti() ? -1 : 0);
    else hud.setRespawn(null);

    const wasDrone = drone.isActive && drone.isActive();
    drone.update(dt, player, k, camera, look, st);
    if (lottery && lottery.update) lottery.update(dt, player);
    if (summon) summon.update(dt, player);
    // play tablet put-away on the character when the drone is being recalled
    if (drone.needsStowAnim && drone.needsStowAnim()) {
      triggerMelee(viewmodel, 'stow');
      triggerMelee(playerMesh, 'stow');
    }
    // drone fully closed → force-clear any stuck tablet hold
    if (wasDrone && drone.isActive && !drone.isActive()) {
      const vu = viewmodel.userData, bu = playerMesh.userData;
      if (vu) vu.mel = null;
      if (bu) bu.mel = null;
      // hide tablet meshes if still visible
      for (const root of [viewmodel, playerMesh]) {
        const g = root.userData;
        if (g && g.w && g.w.tablet) g.w.tablet.visible = false;
        if (g && g.w && g.w.droneParts) for (const p of g.w.droneParts) p.visible = false;
        if (g && g.w && g.w.group) g.w.group.visible = false;
      }
    }
    if (drone.takesCamera()) {
      // body stays at the deploy point
      const bp = drone.bodyPos ? drone.bodyPos() : null;
      if (bp) {
        player.x = bp.x; player.y = bp.y; player.z = bp.z; player.yaw = bp.yaw;
        player.vx = player.vz = player.velY = 0;
        player.moving = player.sprinting = false;
      }
      playerMesh.position.set(player.x, player.y, player.z);
      playerMesh.rotation.y = player.yaw;
      playerMesh.visible = true;
      // while piloting the drone, hide FP hands; during stow keep them so the put-away is visible on the body
      viewmodel.visible = false;
      // still tick the body (and optional FP) anim so tablet-hold / stow plays while the camera is on the drone
      const common = {
        dt, moving: false, grounded: true, ads: false, sprint: false,
        reloading: false, reloadT: 0, missing: 1, ammo: 0,
        weapon: player.weaponId, weaponHidden: false,
        tabletHold: !!(drone.wantsTabletHold && drone.wantsTabletHold()),
      };
      updateHumanoidAnim(bodyU, {
        ...common, speed: 0, crouch: false, pitch: 0.1, dead: !player.alive,
        onEvent: (n, i) => onAnim(n, i, false),
      });
      if (drone.isStowing && drone.isStowing()) {
        updateViewmodel(viewmodel, { ...common, lookDX: 0, lookDY: 0, onEvent: (n, i) => onAnim(n, i, true) });
      }
      return;
    }
    if (drone.hideHands && drone.hideHands()) {
      viewmodel.visible = false;
    }

    if (player.reloading) {
      player.reloadT += dt;
      if (player.reloadT >= player.reloadTotal) finishReload();
    }
    if (pendingSwing && !swapping() && cur().kind === 'melee') { pendingSwing = false; swing(); }

    // ----- movement -----
    if (player.inVehicle) {
      if (!frozen && player.alive) {
        player.yaw += look.dx;
        player.pitch = Math.max(-1.4, Math.min(1.4, player.pitch + look.dy));
      }
      player.vx = 0; player.vz = 0; player.moving = false;
      playerMesh.visible = false;
      viewmodel.visible = false;
      return;
    }
    const d = cur();
    if (player.alive) {
      let ix = 0, iz = 0;
      if (!frozen) {
        if (k.has('KeyW') || k.has('ArrowUp')) iz -= 1;
        if (k.has('KeyS') || k.has('ArrowDown')) iz += 1;
        if (k.has('KeyA') || k.has('ArrowLeft')) ix -= 1;
        if (k.has('KeyD') || k.has('ArrowRight')) ix += 1;
        ix += st.x; iz += st.y;
      }
      const len = Math.hypot(ix, iz);
      if (len > 1) { ix /= len; iz /= len; }
      const wantMove = len > 0.1;

      const headroom = ceilAt(player.x, player.z, player.y, 0.3) - player.y;
      player.crouching = (k.has('KeyC') && !frozen) || drone.wantsCrouch() || (summon && summon.wantsCrouch()) || (player.crouching && headroom < STAND_H + 0.05);
      const sprintKey = k.has('ShiftLeft') || k.has('ShiftRight');
      player.sprinting = sprintKey && iz < -0.2 && wantMove && !player.ads && !player.reloading && !player.crouching && !input.firing;

      let speed = WALK * (d.move || 1);
      if (player.sprinting) speed = SPRINT * (d.move || 1);
      else if (player.crouching) speed = CROUCH_SPEED * (d.move || 1);
      else if (player.ads) speed = WALK * (d.adsMove || 0.62);
      else if (player.reloading) speed = WALK * 0.82 * (d.move || 1);
      speed *= abil.mods.speed; // ABILITY
      if (iz > 0.2) speed *= 0.8;

      const cos = Math.cos(player.yaw), sin = Math.sin(player.yaw);
      const dvx = (ix * cos + iz * sin) * speed, dvz = (-ix * sin + iz * cos) * speed;
      const acc = Math.min(1, dt * (player.onGround ? 12 : 3));
      player.vx += (dvx - player.vx) * acc;
      player.vz += (dvz - player.vz) * acc;
      const hgt = player.crouching ? CROUCH_H : STAND_H;
      const res = resolveCircle(player.x + player.vx * dt, player.z + player.vz * dt, player.radius, player.y, hgt);
      player.x = res.x;
      player.z = res.z;
      player.speed2d = Math.hypot(player.vx, player.vz);
      player.moving = wantMove && player.speed2d > 0.3;

      const jumpDown = k.has('Space') && !frozen;
      const fl = floorAt(player.x, player.z, player.y, 0.3);
      const ce = ceilAt(player.x, player.z, player.y, 0.3);

      if (devFlying()) {
        // noclip fly — Space up, Ctrl / C down
        let vy = 0;
        if (jumpDown) vy += 1;
        if (k.has('ControlLeft') || k.has('ControlRight') || k.has('KeyC')) vy -= 1;
        player.velY = vy * 10;
        player.y += player.velY * dt;
        player.onGround = false;
        player.jumps = 1;
        prevJump = jumpDown;
      } else {
        if (jumpDown && !prevJump && !player.crouching) {
          if (player.onGround) { player.velY = JUMP; player.onGround = false; player.jumps = 1; }
          else if (player.jumps === 1 && ALL[loadout.melee] && ALL[loadout.melee].perk === 'doubleJump') {
            player.velY = JUMP2; player.jumps = 2; audio.play('jump2');
          }
        }
        prevJump = jumpDown;

        player.velY -= GRAV * dt;
        const pv = player.velY;
        player.y += player.velY * dt;
        if (player.y + hgt > ce) { player.y = ce - hgt; if (player.velY > 0) player.velY = 0; }
        if (player.y <= fl) {
          if (!player.onGround && pv < -4.5) { audio.play('land'); player.landDip = Math.min(0.14, -pv * 0.012); }
          player.y = fl; player.velY = 0; player.onGround = true;
        } else if (player.y > fl + 0.03) player.onGround = false;
        if (player.onGround) player.jumps = 0; else if (player.jumps === 0) player.jumps = 1;
      }

      player.noise = player.sprinting ? 1 : player.crouching ? 0.2 : player.speed2d > 0.8 ? 0.55 : 0;
      if (!isMulti() && player.hp < player.maxHp && now - player.lastHurtT > 5) {
        player.hp = Math.min(player.maxHp, player.hp + dt * 12);
      }
      if (world && world.nearestPickup) {
        const pk = world.nearestPickup(player.x, player.y, player.z, 1.6);
        if (pk) collect(pk);
      }
    } else {
      player.vx = player.vz = player.speed2d = player.noise = 0;
      player.sprinting = player.crouching = player.moving = false;
      prevJump = false;
    }
    player.crouchBlend += ((player.crouching ? 1 : 0) - player.crouchBlend) * Math.min(1, dt * 10);

    // ----- building -----
    if (player.building && player.alive) {
      bp.x = player.x; bp.y = player.y; bp.z = player.z; bp.yaw = player.yaw; bp.pitch = player.pitch;
      if (ed.on) updateEdit(dt); // BUILD
      build.update(dt, bp, input.firing && !frozen && !ed.on);
    } else build.update(dt, null, false);

    // BUILD: build-tool animation state (blend in / out, kick on every piece placed, flick on piece / material change)
    player.buildBlend += ((player.building && player.alive ? 1 : 0) - player.buildBlend) * Math.min(1, dt * 12);
    if (!player.building && player.buildBlend < 0.01) player.buildBlend = 0;
    toolKick = Math.max(0, toolKick - dt * 7);
    if (build.placedCount !== lastPlaced) {
      lastPlaced = build.placedCount;
      toolKick = 1;
      buildToolPulse(bodyU, 'place'); buildToolPulse(vmU, 'place');
    }
    if (build.type !== lastBType || build.tier !== lastBTier) {
      lastBType = build.type; lastBTier = build.tier;
      buildToolPulse(bodyU, 'type'); buildToolPulse(vmU, 'type');
    }

    assist(dt, d);
    syncCamera(dt);
    if (aTarget && settings.aimAssist) pullAim(dt);

    // ----- animate both rigs (reload / swap progress is shared) -----
    const common = {
      dt, moving: player.moving, grounded: player.onGround, ads: player.ads, sprint: player.sprinting,
      reloading: player.reloading, reloadT: player.reloadT, missing: player.reloadMissing,
      ammo: player.ammo, weapon: player.weaponId, weaponHidden: player.buildBlend > 0.5, // BUILD
    };
    updateHumanoidAnim(bodyU, {
      ...common, speed: player.speed2d, crouch: player.crouching, pitch: player.pitch + player.recoil, dead: !player.alive,
      onEvent: (n, i) => onAnim(n, i, false),
      onStep: () => audio.play('step', undefined, undefined, { vol: player.crouching ? 0.3 : player.sprinting ? 1 : player.ads ? 0.5 : 0.6 }),
    });
    if (player.alive) {
      updateViewmodel(viewmodel, { ...common, lookDX: look.dx, lookDY: look.dy, onEvent: (n, i) => onAnim(n, i, true) });
    }
    // BUILD: the Constructor takes over both arms (runs after the weapon pose and blends from it)
    const bo = {
      k: player.buildBlend, dt, time, kick: toolKick, type: build.type, tier: build.tier,
      bad: !!build.lastWhy && build.lastWhy !== 'occupied', editing: ed.on,
    };
    poseBuildTool(bodyU, bo);
    if (player.alive) poseBuildTool(vmU, bo);

    // ----- firing -----
    autoOn = !!aTarget && settings.autoFire && aErr < 0.015 + 0.4 / Math.max(5, aDist);
    const firing = (input.firing || autoOn) && player.alive && !frozen;
    if (!player.building) {
      if (firing && (!prevFiring || autoOn)) fireBuffer = 0.15;
      if (d.kind === 'gun') {
        if (d.auto ? firing : fireBuffer > 0) { if (tryFire()) fireBuffer = 0; }
      } else if (fireBuffer > 0 && swing()) fireBuffer = 0;
    }
    prevFiring = firing;

    updateAxes(dt);
    audio.setListener(player.x, player.z, player.yaw);
    bullets.setListener(player.x, player.y + player.eyeH, player.z);
    hud.update(player);
    hud.setSpread(spread(), camera.fov);
    hud.setReload(player.reloading ? player.reloadT / player.reloadTotal : -1);
    H('setScope', player.scope);
    H('setBuild', player.building ? { type: build.type, tier: build.tier, mats: build.mats, why: build.lastWhy } : null);
    abil.ui(player.alive && !player.building ? d : null); // ABILITY: cooldown pill
  }

  return {
    update, shoot: tryFire, startReload, toggleCamera, setAim,
    respawn, respawnAt, queueRespawn, applyDamage, syncHp, heal, getLookDir,
    equip, digit, scroll, quickMelee, toggleBuild, buildTier, pickPiece, refreshLoadout, restock, // BUILD: pickPiece
  };
}
