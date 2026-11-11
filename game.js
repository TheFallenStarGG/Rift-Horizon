/** Realm Range: bootstrap. Renderer (world pass + viewmodel pass), lobby, bot arena, online modes, menus. */
import * as THREE from 'three';
import { settings, saveSettings } from './lib/settings.js';
import { createTextures } from './lib/textures.js';
import { createAudio } from './lib/audio.js';
import { createWorld } from './lib/scene.js';
import { createRadar } from './lib/radar.js';
import { createVehicles } from './lib/vehicles.js';
import { createDrone } from './lib/drone.js';
import { createLottery } from './lib/lottery.js';
import { createSummon } from './lib/summon.js';
import { makeHumanoid, makeViewmodel } from './lib/humanoid.js';
import { createBulletSystem } from './lib/weapons.js';
import { createHud } from './lib/hud.js';
import { createInput } from './lib/input.js';
import { createPlayerState, createPlayerController } from './lib/player.js';
import { createEnemy, updateEnemy, respawnEnemy, applyTeam } from './lib/enemy.js';
import { clampArenaCfg, assignRoles } from './lib/botTeams.js';
import { updateHumanoidAnim, triggerShootKick, triggerMelee, ensureWeapon, LOD } from './lib/anim.js';
import { createBuild } from './lib/build.js';
import { createLobby, LOBBY_SPAWN } from './lib/lobby.js';
import { createMatch, MODES } from './lib/modes.js';
import { loadout, setSlot, loadoutString } from './lib/loadout.js';
import { ALL, SLOTS, bySlot, reloadDuration } from './lib/arsenal.js';
import { createNet, WORKER_URL } from './lib/net.js';
import { initMenus } from './lib/menus.js';
import { createRecorder } from './lib/recorder.js';
import { applyLayout } from './lib/layout.js';
import { look, applyLook, decodeLook } from './lib/look.js';
import { canon } from './lib/keybinds.js';
import { createGfx } from './lib/gfx.js';
import { createDropship } from './lib/dropship.js';
import { initUpdater, isForcedOffline, checkForUpdate, showUpdateModal, refreshOfflineBanner, isWebClient } from './lib/update.js';
import {
  devUnlocked, tryUnlock, checkCallsign, bindDev, mountDevSettingsSection,
  installErrorOverlay, refreshDevUI, showBar, hideBar, setFly,
  fillSpawnButtons, infiniteAmmo,
} from './lib/dev.js';

// ---------- loading screen progress ----------
const _load = (pct, msg) => {
  try { if (window.__riftLoad) window.__riftLoad(pct, msg); } catch (_) {}
};
const _yield = () => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
async function _step(pct, msg) {
  _load(pct, msg);
  await _yield();
}
_load(6, 'Parsing modules…');
await _yield();

const $ = (id) => document.getElementById(id);
const canvas = $('c');
const startEl = $('start'), panel = $('panel'), loadoutPanel = $('loadoutPanel');
const nameInput = $('nameInput'), roomInput = $('roomInput');
const btnStart = $('btnStart'), btnResume = $('btnResume'), btnLobby = $('btnLobby'), btnLoadout = $('btnLoadout');
const chatLog = $('chatLog'), chatForm = $('chatForm'), chatInput = $('chatInput'), playerListEl = $('playerList');

const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('mobile');
const store = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d; } catch (_) { return d; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch (_) {} },
};
nameInput.value = store.get('rr.name', '');
try { checkCallsign(nameInput.value); } catch (_) {}
roomInput.value = store.get('rr.room', '');

let where = 'lobby'; // 'lobby' | 'bots' | 'multi'
let running = false, panelOpen = false, loadoutOpen = false, joining = false;
let forceOffline = false;
let updater = null;
let myName = 'Player', last = performance.now(), fpsT = 0, fpsN = 0, listT = 0;
const chatFocused = () => document.activeElement === chatInput;
const lockPointer = () => { if (!isTouch) { try { canvas.requestPointerLock(); } catch (_) {} } };
const isMulti = () => where === 'multi';

// ---------- hot drop intro (lib/dropship.js) ----------
const DROP_BOUND = 5600; 
const DROP_ENABLED = !/[?&]nodrop\b/.test(location.search); // add ?nodrop to the URL to skip the plane
let dropship = null;

// ---------- renderer / world ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !isTouch && settings.aa, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, Number(settings.maxDpr) || (isTouch ? 1.25 : 1.5))); // gfx.apply() applies scale + maxDpr
renderer.setSize(innerWidth, innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.autoClear = false;
// Surface GPU crashes instead of a silent tab close
canvas.addEventListener('webglcontextlost', (e) => {
  e.preventDefault();
  try {
    const msg = document.createElement('div');
    msg.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:#0a0c10;color:#eef2f7;font:600 16px system-ui;text-align:center;padding:24px';
    msg.innerHTML = '<div><p style="margin:0 0 12px">Graphics crashed (GPU reset).</p><p style="margin:0 0 16px;opacity:.8">Reload with safer settings:</p><a href="?safe" style="color:#ffc247">Open with ?safe</a></div>';
    document.body.appendChild(msg);
  } catch (_) {}
}, false);

await _step(18, 'Preparing renderer…');
await _step(28, 'Generating textures…');
const tex = createTextures({ res: settings.texRes, aniso: Math.min(settings.aniso, renderer.capabilities.getMaxAnisotropy()) });
await _step(34, 'Initializing audio…');
const audio = createAudio(settings);
audio.setVolume(settings.volume);
await _step(42, 'Building world geometry…');
const world = createWorld(renderer, tex);
await _step(52, 'Mapping radar & points of interest…');
const radar = createRadar(world.pois);
const scene = world.scene;
const camera = new THREE.PerspectiveCamera(settings.fov, innerWidth / innerHeight, 0.05, 400);
scene.add(camera);

// the viewmodel renders in its own scene with a fixed FOV (no growing gun when aiming, no wall clipping)
const vmScene = new THREE.Scene();
vmScene.environment = scene.environment;
vmScene.environmentIntensity = 0.9;
vmScene.add(new THREE.HemisphereLight(0xdde8ff, 0x5a5040, 1.0));
const vmSun = new THREE.DirectionalLight(0xfff0d8, 2.2);
vmSun.position.set(0.6, 1, 0.5);
vmScene.add(vmSun);
const vmCamera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.01, 10);

const hud = createHud();

await _step(58, 'Spawning vehicles…');
const vehicles = createVehicles({ scene, audio, hud });
// ---------- aircraft (plane + helicopter, lib/aircraft.js) ----------
// Loaded defensively: if anything in there fails, the rest of the game still boots and these calls become no-ops.
const NO_AIRCRAFT = {
  list: [], isPiloting: () => false, pilotKind: () => null, tryUse: () => false, toggleCam: () => false, update: () => null, resetAll() {},
  spawnAt: () => null, scrollThrottle: () => false, setNet() {}, hidePrompt() {},
  onVeh: () => false, onVehExit: () => false, onVehClaim: () => false, onVehDeny: () => false,
};
let aircraft = NO_AIRCRAFT;
try {
  const mod = await import('./lib/aircraft.js');
  aircraft = mod.createAircraft({
    scene, audio, hud, isTouch, camera,
    damagePlayer: (dmg, x, z) => { if (ctrl) ctrl.applyDamage(dmg, x, z, 'a crash'); },
  });
} catch (err) {
  console.error('[aircraft] could not start — planes and helicopters are disabled', err);
}
await _step(64, 'Loading scout drone systems…');
const drone = createDrone({ scene, hud, isTouch });
await _step(68, 'Loading utility systems…');
const lottery = createLottery({ scene, hud, audio, camera });
const match = createMatch();
await _step(72, 'Warming up weapons systems…');
const bullets = createBulletSystem(scene, tex, {
  onLand: (kind, x, y, z) => audio.play(kind === 'mag' ? 'magDrop' : 'shell', x, z),
  onWhiz: () => audio.play('whiz'),
});

await _step(78, 'Drawing operators & hands…');
const playerMesh = makeHumanoid(tex, 'player', look);
playerMesh.visible = false;
scene.add(playerMesh);
await _step(82, 'Assembling first-person viewmodel…');
const viewmodel = makeViewmodel(tex);
viewmodel.visible = false;
vmScene.add(viewmodel);
applyLook(viewmodel, look, tex);
const player = createPlayerState();
// what the bots see: while you're in the plane / skydiving high up you simply don't exist to them
const enemyView = new Proxy(player, {
  get: (t, k) => (k === 'alive' ? t.alive && !(dropship && dropship.airborne()) : t[k]),
});
// while you fly an aircraft the car code should not offer you "E · drive" prompts for cars below you
const noVehPrompt = new Proxy(player, { get: (t, k) => (k === 'alive' ? false : t[k]) });
const enemies = []; // active bots
const allEnemies = []; // full pool
const remotes = new Map();
let ctrl = null;

// ---------- multiplayer remotes ----------
function makeTag(name, color) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(0,0,0,.45)'; x.fillRect(0, 8, 256, 48);
  x.font = '700 30px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.fillStyle = color; x.fillText(name, 128, 33, 240);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, fog: false }));
  s.scale.set(1.5, 0.375, 1);
  s.position.y = 2.25;
  return s;
}

function addRemote(p) {
  if (!p || remotes.has(p.id)) return;
  const mesh = makeHumanoid(tex, 'remote', p.lk ? decodeLook(p.lk) : null);  scene.add(mesh);
  const col = match.cfg.teams ? (p.team && p.team === match.team ? '#4aa8ff' : '#ff6b4a') : '#ffffff';
  const tag = makeTag(p.name || 'Player', col);
  mesh.add(tag);
  const x = p.x || 0, y = p.y || 0, z = p.z || 0, yaw = p.yaw || 0;
  mesh.position.set(x, y, z);
  remotes.set(p.id, {
    id: p.id, mesh, tag, name: p.name || 'Player', team: p.team || null,
    x, y, z, tx: x, ty: y, tz: z, px: x, pz: z, yaw, tyaw: yaw, pitch: p.pitch || 0,
    hp: p.hp ?? 100, alive: p.alive !== false, ads: !!p.ads, crouch: !!p.crouch, sprint: !!p.sprint,
    rl: !!p.rl, wasRl: false, rlT: 0, weapon: p.weapon || 'vanguard', speed: 0, flashes: {},
  });
}
function removeRemote(id) {
  const r = remotes.get(id);
  if (!r) return;
  scene.remove(r.mesh);
  r.tag.material.map.dispose();
  r.tag.material.dispose();
  remotes.delete(id);
}
function clearRemotes() { for (const id of [...remotes.keys()]) removeRemote(id); }

function remoteFlash(r, id) {
  return r.flashes[id] || (r.flashes[id] = bullets.attachFlash(ensureWeapon(r.mesh.userData, id).muzzle, 0.55));
}
const _v = new THREE.Vector3();
function remoteEvent(r, name, info) {
  if (name === 'toss' && info) bullets.dropMag(info.pos, _v.set(-1.5, 1, 0.3));
  else if (name === 'eject' && info) bullets.ejectShell(info.pos, _v.set(1.2, 1.2, 0));
  else if (name === 'swing') audio.play('swing', r.x, r.z);
  else if (!['toss', 'eject', 'meleeHit', 'throwStart', 'throwRelease'].includes(name)) audio.play(name, r.x, r.z);
}

function updateRemotes(dt) {
  if (remotes.size === 0) return;
  for (const r of remotes.values()) {
    const dx = r.tx - r.x, dz = r.tz - r.z, dy = r.ty - r.y;
    if (Math.hypot(dx, dz, dy) > 8) { r.x = r.tx; r.y = r.ty; r.z = r.tz; }
    else { const k = Math.min(1, dt * 14); r.x += dx * k; r.y += dy * k; r.z += dz * k; }
    r.yaw += Math.atan2(Math.sin(r.tyaw - r.yaw), Math.cos(r.tyaw - r.yaw)) * Math.min(1, dt * 14);
    const sp = Math.hypot(r.x - r.px, r.z - r.pz) / Math.max(dt, 1e-3);
    r.px = r.x; r.pz = r.z;
    r.speed += (Math.min(sp, 12) - r.speed) * Math.min(1, dt * 8);
    const wid = ALL[r.weapon] ? r.weapon : 'vanguard', def = ALL[wid];
    if (r.rl && !r.wasRl) r.rlT = 0;
    r.wasRl = r.rl;
    if (r.rl) r.rlT += dt;
    r.mesh.position.set(r.x, r.y, r.z);
    r.mesh.rotation.y = r.yaw;
    r.tag.visible = r.alive;
    updateHumanoidAnim(r.mesh.userData, {
      dt, moving: r.speed > 0.4, speed: r.speed, grounded: true, ads: r.ads, sprint: r.sprint, crouch: r.crouch,
      pitch: r.pitch, reloading: r.rl && def.kind === 'gun', reloadT: r.rlT, missing: def.mag || 1, ammo: 1,
      weapon: wid, dead: !r.alive,
      onEvent: (n, i) => remoteEvent(r, n, i),
      onStep: () => audio.play('step', r.x, r.z, { vol: 0.6 }),
    });
  }
}

function refreshPlayerList() {
  if (!isMulti()) { playerListEl.textContent = ''; return; }
  const lines = [`You — ${Math.round(player.hp)} hp`];
  for (const r of remotes.values()) lines.push(`${r.name} — ${r.alive ? Math.round(r.hp) + ' hp' : 'down'}`);
  playerListEl.textContent = lines.join('\n');
}

function appendChat(msg) {
  const div = document.createElement('div');
  if (msg.id === 'system' || msg.name === 'System') { div.className = 'sys'; div.textContent = msg.text; }
  else {
    const n = document.createElement('span');
    n.className = 'name';
    n.textContent = msg.name;
    div.append(n, ': ' + msg.text);
  }
  chatLog.appendChild(div);
  while (chatLog.children.length > 60) chatLog.firstChild.remove();
  chatLog.scrollTop = chatLog.scrollHeight;
}

// ---------- network ----------
let build = null;
const net = createNet({
  // bot arena server followers

  onWelcome(msg) {
    if (msg.mode === 'lobby') { onLobbyWelcome(msg); return; }
    if (msg.mode === 'bots') {
      // bot arena already set where; keep local leaders
      return;
    }
    where = 'multi';
    joining = false;
    if (dropship) dropship.cancel();
    lobby.setActive(false);
    vehicles.resetAll(player);
    aircraft.resetAll(player);
    for (const e of allEnemies) e.mesh.visible = false;
    build.clear();
    player.canBuild = true;
    match.begin(msg.mode);
    match.apply(msg);
    clearRemotes();
    for (const p of msg.players || []) addRemote(p);
    chatLog.textContent = '';
    for (const c of msg.chat || []) appendChat(c);
    for (const spec of msg.builds || []) build.placeRemote(spec);
    player.kills = player.deaths = 0;
    hud.setScore(0, 0);
    ctrl.respawnAt(msg.spawn);
    if (!match.cfg.teams) startDrop(); // Free For All: hot drop from the plane
    net.startStateLoop(() => player);
    hud.setMode('multi');
    hud.setMsg(match.cfg.name, 2200);
    refreshPlayerList();
    lockPointer();
  },
  onJoin(p) { addRemote(p); refreshPlayerList(); },
  onLeave(id) { removeRemote(id); refreshPlayerList(); },
  onState(msg) {
    const r = remotes.get(msg.id);
    if (!r) return;
    r.tx = msg.x; r.ty = msg.y || 0; r.tz = msg.z; r.tyaw = msg.yaw; r.pitch = msg.pitch || 0;
    r.hp = msg.hp; r.alive = msg.alive; r.ads = !!msg.ads; r.crouch = !!msg.crouch; r.sprint = !!msg.sprint;
    r.rl = !!msg.rl;
    if (msg.weapon) r.weapon = msg.weapon;
  },
  onShoot(msg) {
    const def = ALL[msg.weapon];
    if (!def || def.kind !== 'gun' || msg.ox == null) return;
    const o = new THREE.Vector3(msg.ox, msg.oy, msg.oz);
    const d = new THREE.Vector3(msg.dx, msg.dy, msg.dz).normalize();
    const r = remotes.get(msg.id);
    if (r) { remoteFlash(r, msg.weapon).fire(); triggerShootKick(r.mesh.userData); }
    else bullets.muzzleFlash(o);
    for (let i = 0; i < Math.min(3, def.pellets || 1); i++) bullets.spawn(o, d, def.bulletSpeed || 230, true);
    audio.play('shot', o.x, o.z, { enemy: true, snd: msg.weapon });
  },
  onMelee(msg) {
    const r = remotes.get(msg.id);
    if (r) triggerMelee(r.mesh, msg.thrown ? 'throw' : 'swing');
  },
  onDamage(msg) {
    if (dropship && dropship.airborne()) return; // nothing can touch you up there
    const src = remotes.get(msg.from);
    ctrl.syncHp(msg.hp, msg.alive, src ? src.x : undefined, src ? src.z : undefined);
  },
  onHp(msg) {
    const r = remotes.get(msg.id);
    if (r) { r.hp = msg.hp; r.alive = msg.alive; }
    refreshPlayerList();
  },
  onHeal(msg) { ctrl.heal(msg.hp); },
  onKill(msg) {
    const me = net.getMyId();
    hud.addKill(msg.killer === me ? 'You' : msg.kname, msg.victim === me ? 'You' : msg.vname, msg.head);
    if (msg.killer === me) { hud.hitMarker('kill'); audio.play('kill'); }
    const r = remotes.get(msg.victim);
    if (r) { r.alive = false; audio.play('death', r.x, r.z); }
  },
  onScores(msg) {
    match.apply(msg);
    const mine = (msg.list || []).find((s) => s.id === net.getMyId());
    if (mine) { player.kills = mine.k; player.deaths = mine.d; hud.setScore(mine.k, mine.d); }
  },
  onPhase(msg) { match.apply(msg); },
  onSpawn(msg) {
    if (dropship && dropship.active()) return; // the server's round-start spawn must not yank you out of the plane
    ctrl.respawnAt(msg);
  },
  onRespawnIn(ms) { ctrl.queueRespawn(ms); },
  onChat(msg) { appendChat(msg); },
  onBuild(ev) {
    if (ev.kind === 'place') build.placeRemote(ev.spec);
    else if (ev.kind === 'hit') build.damageByKey(ev.key, ev.dmg);
    else if (ev.kind === 'break') build.destroyByKey(ev.key);
    else if (ev.kind === 'clear') build.clear();
  },
  onBots(msg) {
    if (where !== 'bots' || !msg.list) return;
    const byId = new Map(msg.list.map((b) => [b.id, b]));
    const now = performance.now() / 1000;
    for (const e of enemies) {
      if (!e.serverSide || !e.serverId) continue;
      const b = byId.get(e.serverId);
      if (!b) continue;
      e.sx = b.x; e.sy = b.y; e.sz = b.z; e.syaw = b.yaw;
      e.sMoving = !!b.moving;
      e.sAds = !!b.ads;
      e.sReloading = !!b.reloading;
      e.sAmmo = b.ammo;
      // Never let a laggy snapshot heal a bot we just shot
      const recentHurt = e.lastHurt && (now - e.lastHurt) < 0.6;
      if (!b.alive) {
        e.hp = 0;
      } else if (!recentHurt || b.hp < e.hp) {
        e.hp = b.hp;
      }
      const was = e.alive;
      e.alive = !!b.alive;
      if (!e.alive && was) { e.deathT = 0; audio.play('death', e.x, e.z); }
      if (e.alive) e.mesh.visible = true;
    }
  },
  onBotShoot(msg) {
    if (!msg) return;
    const o = new THREE.Vector3(msg.x, msg.y || 1.4, msg.z);
    const d = new THREE.Vector3(msg.dx || 0, msg.dy || 0, msg.dz || 1).normalize();
    bullets.spawn(o, d, 150, true);
    audio.play('shot', msg.x, msg.z, { enemy: true, snd: 'stinger' });
    for (const e of enemies) {
      if (e.serverId === msg.id && e.mesh) {
        try { triggerShootKick(e.mesh.userData); } catch (_) {}
        break;
      }
    }
  },
  onFull() { joining = false; hud.setMsg('That room is full', 2200); },
  onClose() {
    if (isMulti() && running) enterLobby('Disconnected from the match');
    else if (where === 'lobby' && running) { clearRemotes(); joinGlobalLobby(); }
  },
  onError(reason) { joining = false; hud.setMsg(reason || 'Connection error', 2500); },
  // aircraft ids start with "ac"; the aircraft module claims those messages, everything else goes to the cars
  onVeh(msg) { if (!aircraft.onVeh(msg)) vehicles.onVeh(msg); },
  onVehExit(msg) { if (!aircraft.onVehExit(msg)) vehicles.onVehExit(msg); },
  onVehClaim(msg) { if (!aircraft.onVehClaim(msg)) vehicles.onVehClaim(msg); },
  onVehDeny(msg) { if (!aircraft.onVehDeny(msg)) vehicles.onVehDeny(msg); },
  onVehReset() { vehicles.onVehReset(); },
});
vehicles.setNet(net);
aircraft.setNet(net);

function onLobbyWelcome(msg) {
  clearRemotes();
  for (const p of msg.players || []) addRemote(p);
  chatLog.textContent = '';
  for (const c of msg.chat || []) appendChat(c);
  net.startStateLoop(() => player);
  hud.setMsg(`Global lobby · ${(msg.players || []).length + 1} online`, 2200);
}

// ---------- building ----------
build = createBuild(scene, tex, {
  onPlace: (spec, piece, remote) => {
    if (remote) return;
    audio.play('click');
    if (isMulti()) net.sendBuild(spec);
  },
  onBreak: (piece) => audio.play('thud', piece.geom.x, piece.geom.z),
  onHit: (piece) => audio.play('clang', piece.geom.x, piece.geom.z, { vol: 0.4 }),
  onDenied: (why) => hud.setMsg(why === 'mats' ? 'Not enough materials' : why === 'blocked' ? 'Blocked' : why === 'level' ? "Can't build this high" : '', 800),
});

// ---------- lobby ----------
await _step(88, 'Constructing lobby…');
const lobby = createLobby(scene, tex, {
  onEquip: () => { ctrl.refreshLoadout(); refreshSlotsUI(); audio.play('click'); },
  onRangeHit: (bull) => { audio.play(bull ? 'headshot' : 'hit'); hud.hitMarker(bull ? 'head' : 'hit'); },
});

// ---------- bots ----------
const enemyCtx = {
  bullets, audio, hud, player: enemyView, enemies, build, net,
  onPlayerHit: (dmg, sx, sz, zone, name) => { if (where === 'bots' && running) ctrl.applyDamage(dmg, sx, sz, name); },
  onBotKill: (killer, victim, head) => {
    if (where !== 'bots') return;
    hud.addKill(killer.name, victim.name, head);
  },
};

const MAX_ARENA_BOTS = 40;
/** Create bot humanoids only when needed (Bot Arena / roster size), not on every page load. */
function ensureBotPool(n) {
  const want = Math.max(0, Math.min(MAX_ARENA_BOTS, n | 0));
  while (allEnemies.length < want) {
    const i = allEnemies.length;
    const m = makeHumanoid(tex, 'enemy');
    m.visible = false;
    scene.add(m);
    const e = createEnemy(m, enemyCtx, i);
    allEnemies.push(e);
  }
}

/** Build Bot Arena roster from team/size/leader settings. */
function setupArenaFromSettings() {
  const cfg = clampArenaCfg(settings);
  const roles = assignRoles(cfg);
  ensureBotPool(roles.length);
  enemies.length = 0;
  allEnemies.forEach((e, i) => {
    if (i < roles.length) {
      applyTeam(e, roles[i]);
      enemies.push(e);
    } else {
      e.mesh.visible = false;
      e.alive = false;
    }
  });
  enemyCtx.enemies = enemies;
  enemyCtx.net = net;
  if (where === 'bots') {
    for (const e of enemies) respawnEnemy(e);
  }
}

function setBotCount(n) {
  const teams = Math.max(2, Math.min(4, settings.botTeams || 2));
  settings.botTeamSize = Math.max(4, Math.min(10, Math.round((n || 12) / teams)));
  saveSettings();
  setupArenaFromSettings();
}

// ---------- graphics (quality settings, post effects, menu) ----------
const gfx = createGfx({
  renderer, scene, camera, vmScene, vmCamera, world, tex, isTouch,
  getCharacters: () => {
    const l = [playerMesh];
    for (const e of allEnemies) l.push(e.mesh);
    for (const r of remotes.values()) l.push(r.mesh);
    return l;
  },
  maxBots: MAX_ARENA_BOTS,
  onBots: setBotCount,
  say: (t) => hud.setMsg(t, 2400),
});
gfx.apply();

// optional: skip shell casings / dropped mags (physics + collision checks every frame)
const _eject = bullets.ejectShell, _drop = bullets.dropMag;
bullets.ejectShell = (...a) => { if (settings.debris) _eject(...a); };
bullets.dropMag = (...a) => { if (settings.debris) _drop(...a); };

// ---------- input + controller ----------
// While you are flying an aircraft its own controls own the keys (R = engine, F = flaps, number keys, build keys, ...)
const flying = () => aircraft.isPiloting();
const input = createInput(canvas, {
  isTouch,
  getPlayer: () => player,
  isActive: () => running && !panelOpen && !loadoutOpen && !chatFocused(),
  onReload: () => { if (!flying()) ctrl.startReload(); },
  onToggleCamera: () => {
    if (dropship && dropship.active()) return;
    if (drone.isFlying()) drone.toggleView();
    else if (flying()) aircraft.toggleCam();
    else if (vehicles.isDriving()) vehicles.toggleDriveCam();
    else ctrl.toggleCamera();
  },
  onAim: (down) => { if (!flying()) ctrl.setAim(down); },
  onToggleBuild: () => {
    if (flying()) return;
    if (dropship && dropship.active()) return;
    if (!player.canBuild) { hud.setMsg('Building is disabled in the lobby', 1200); return; }
    ctrl.toggleBuild();
  },
  onBuildTier,
  onQuickMelee: () => { if (!flying() && !(dropship && dropship.active())) ctrl.quickMelee(); },
  onDigit: (i) => { if (!flying() && !(dropship && dropship.active())) ctrl.digit(i); },
  onScroll: (d) => {
    if (flying()) { aircraft.scrollThrottle(-Math.sign(d)); return; }
    if (!(dropship && dropship.active())) ctrl.scroll(d);
  },
});
function onBuildTier() {
  if (!player.building) return;
  hud.setMsg(ctrl.buildTier(), 700);
}

await _step(93, 'Binding controls & combat…');

const summon = createSummon({
  scene, hud, audio, camera, vehicles,
  playAnim: () => { triggerMelee(viewmodel, 'swing'); triggerMelee(playerMesh, 'swing'); },
});

ctrl = createPlayerController({
  scene, camera, playerMesh, viewmodel, player, input, bullets, hud, audio, build, world, net, drone, lottery, summon,
  getEnemies: () => (where === 'bots' ? enemies : []),
  getRemotes: () => remotes,
  isMulti,
  isBots: () => where === 'bots',
  isFrozen: () => isMulti() && match.frozen,
  isTouch,
  isFriend: (c) => !!(c.remote && match.cfg.teams && c.team && c.team === match.team),
});
hud.onSlot = (i) => ctrl.digit(i);
hud.onBuildPick = (i) => ctrl.digit(i);
hud.onTier = onBuildTier;

dropship = createDropship({ scene, camera, playerMesh, viewmodel, player, input, audio, hud, world, tex, bullets, isTouch });

bindDev({
  hud,
  onUnlock() {
    if (lobby && lobby.enableDevPortal) lobby.enableDevPortal();
    refreshDevUI();
  },
  heal() {
    player.hp = player.maxHp;
    player.alive = true;
    hud.setMsg('Full heal', 1200);
  },
  restock() {
    player.ammo = player.magSize || 30;
    const def = ALL[player.weaponId];
    player.reserve = def && def.total != null ? def.total : 120;
    if (ctrl.refreshLoadout) ctrl.refreshLoadout();
    hud.setMsg('Restocked', 1200);
  },
  buildPiece(type, tier) {
    try {
      build.setActive && build.setActive(true);
      const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
      const ix = Math.round((player.x + fx * 4) / 4);
      const iz = Math.round((player.z + fz * 4) / 4);
      const lv = Math.max(0, Math.round((player.y - 0.25) / 3));
      const o = ((Math.round(player.yaw / (Math.PI / 2)) % 4) + 4) % 4;
      const spec = { type, ix, iz, lv, o, tier: tier | 0 };
      const piece = build.place(spec, { remote: true });
      hud.setMsg(piece ? (`Spawned ${type}` + (tier ? ` T${tier}` : '')) : 'Could not place (blocked)', 1200);
    } catch (err) {
      console.error(err);
      hud.setMsg('Build failed', 1500);
    }
  },
  clearBuilds() { build.clear(); hud.setMsg('Builds cleared', 1200); },
  bot() {
    ensureBotPool(Math.min(20, allEnemies.length || 8));
    let spawned = false;
    for (const e of allEnemies) {
      if (!e.mesh.visible || !e.alive) {
        e.mesh.visible = true; e.alive = true; e.hp = e.maxHp || 100;
        if (typeof respawnEnemy === 'function') respawnEnemy(e);
        spawned = true; break;
      }
    }
    hud.setMsg(spawned ? 'Bot spawned' : 'No free bot slots', 1000);
  },
  killBots() {
    for (const e of allEnemies) { e.mesh.visible = false; e.alive = false; }
    hud.setMsg('Bots cleared', 1000);
  },
  lobby() { hideBar(); setFly(false); enterLobby('Left developer sandbox'); },
  spawn(spec) {
    if (spec.startsWith('weapon:')) {
      const id = spec.slice(7);
      const def = ALL[id];
      if (!def) return;
      const slot = def.slot || (def.kind === 'melee' ? 'melee' : def.kind === 'utility' ? 'utility' : 'main');
      setSlot(slot, id);
      if (ctrl.refreshLoadout) ctrl.refreshLoadout();
      if (ctrl.equip) ctrl.equip(slot);
      hud.setMsg('Equipped ' + def.name, 1200);
      return;
    }
    if (spec.startsWith('vehicle:')) {
      const id = spec.slice(8);
      const fx = -Math.sin(player.yaw), fz = -Math.cos(player.yaw);
      if (id === 'plane' || id === 'helicopter') {
        // aircraft are big: spawn them further out, on the ground in front of you
        const d = id === 'plane' ? 16 : 13;
        aircraft.spawnAt({ type: id, x: player.x + fx * d, z: player.z + fz * d, yaw: player.yaw });
        hud.setMsg('Spawned ' + id + (aircraft.list.length ? '' : ' (aircraft system not loaded)'), 1400);
        return;
      }
      if (vehicles && typeof vehicles.spawnAt === 'function') {
        vehicles.spawnAt({ type: id, x: player.x + fx * 6, y: player.y, z: player.z + fz * 6, yaw: player.yaw });
        hud.setMsg('Spawned ' + id, 1200);
      } else {
        hud.setMsg('Vehicle spawn not available — use map vehicles (E)', 1800);
      }
    }
  },
});
// developer bar: add the two aircraft next to the cars (the bar's click handler already routes data-spawn buttons)
{
  const vRow = document.querySelector('#devBar [data-spawn-vehicles]');
  if (vRow) {
    for (const id of ['helicopter', 'plane']) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'act';
      b.textContent = id;
      b.setAttribute('data-spawn', 'vehicle:' + id);
      vRow.appendChild(b);
    }
  }
}
if (devUnlocked() && lobby.enableDevPortal) lobby.enableDevPortal();
installErrorOverlay();
mountDevSettingsSection();
refreshDevUI();

if (devUnlocked() && lobby.enableDevPortal) lobby.enableDevPortal();

function startDrop() {
  if (!DROP_ENABLED || !dropship) return;
  dropship.begin({ bound: DROP_BOUND, accent: where === 'bots' ? 0xff4d6a : 0xff8a2b });
}

// ---------- game flow ----------
function refreshSlotsUI() {
  hud.setSlots(SLOTS.map((s, i) => ({ key: String(i + 1), name: ALL[loadout[s]].name })));
}

const GLOBAL_LOBBY_ROOM = 'global-lobby';
function joinGlobalLobby() {
  if (WORKER_URL.includes('YOUR_SUBDOMAIN')) return;
  if (!isWebClient() && (forceOffline || isForcedOffline())) return; // native offline lock only
  net.connect(GLOBAL_LOBBY_ROOM, myName, 'lobby', loadoutString());
}

function enterLobby(msg) {
  if (dropship) dropship.cancel();
  hideBar();
  setFly(false);
  if (devUnlocked() && lobby.enableDevPortal) lobby.enableDevPortal();
  where = 'lobby';
  vehicles.resetAll(player);
  aircraft.resetAll(player);
  joining = false;
  net.disconnect();
  clearRemotes();
  for (const e of allEnemies) e.mesh.visible = false;
  build.clear();
  build.setActive(false);
  match.begin('bots');
  lobby.setActive(true);
  player.canBuild = false;
  player.kills = player.deaths = 0;
  hud.setScore(0, 0);
  ctrl.respawnAt(LOBBY_SPAWN);
  hud.setMode('lobby');
  hud.setBanner(null);
  hud.setStatus('');
  playerListEl.textContent = '';
  if (msg) hud.setMsg(msg, 2500);
  if (running) joinGlobalLobby();
}


function startDev() {
  if (!devUnlocked()) {
    hud.setMsg('Developer mode locked', 2000);
    return;
  }
  if (dropship) dropship.cancel();
  where = 'dev';
  vehicles.resetAll(player);
  aircraft.resetAll(player);
  lobby.setActive(false);
  build.clear();
  match.begin('bots');
  player.canBuild = true;
  player.kills = player.deaths = 0;
  hud.setScore(0, 0);
  ensureBotPool(4);
  for (const e of allEnemies) e.mesh.visible = false;
  ctrl.respawn();
  setFly(true);
  showBar();
  hud.setMode('dev');
  hud.setMsg('Developer sandbox — fly ON', 2500);
  lockPointer();
}

async function startBots() {
  if (dropship) dropship.cancel();
  where = 'bots';
  vehicles.resetAll(player);
  aircraft.resetAll(player);
  lobby.setActive(false);
  build.clear();
  match.begin('bots');
  player.canBuild = true;
  player.kills = player.deaths = 0;
  hud.setScore(0, 0);
  if (typeof setupArenaFromSettings === 'function') setupArenaFromSettings();
  else {
    ensureBotPool(12);
    for (const e of enemies) { e.mesh.visible = true; }
  }
  ctrl.respawn();
  for (const e of enemies) {
    if (e.isLeader) respawnEnemy(e);
    else { e.mesh.visible = true; e.alive = true; e.hp = e.maxHp; }
  }
  startDrop(); // Bot Arena: hot drop from the plane
  const cfg = typeof clampArenaCfg === 'function' ? clampArenaCfg(settings) : { teams: 2, size: 6, leaders: 1 };
  hud.setMode('bots');
  hud.setMsg(`Bot Arena — connecting followers to server…`, 2000);
  const room = 'bots-' + Math.random().toString(36).slice(2, 8);
  const ok = await net.connect(room, 'Player', 'bots', loadoutString(), {
    teams: cfg.teams, size: cfg.size, leaders: cfg.leaders,
  });
  if (ok) {
    net.startStateLoop(() => player);
    hud.setMsg(`Bot Arena — ${cfg.teams} teams × ${cfg.size} (${cfg.leaders} leaders client / rest server)`, 3500);
  } else {
    hud.setMsg('Server followers unavailable — local followers fallback', 3500);
    for (const e of enemies) { e.serverSide = false; if (!e.isLeader) respawnEnemy(e); }
  }
}

async function startOnline(modeId) {
  if (joining) return;
  if (!isWebClient() && (forceOffline || isForcedOffline())) {
    hud.setMsg('Update required for multiplayer — open the update prompt', 3200);
    try {
      const info = await checkForUpdate({ force: true });
      if (info) await showUpdateModal(info);
      forceOffline = isForcedOffline();
      refreshOfflineBanner(null, info);
    } catch (_) {}
    return;
  }
  if (WORKER_URL.includes('YOUR_SUBDOMAIN')) { hud.setMsg('Set WORKER_URL in lib/net.js first', 3000); return; }
  joining = true;
  const code = roomInput.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 24);
  hud.setMsg(code ? `Joining room “${code}”…` : `Finding a ${MODES[modeId].name} match…`, 0);
  let ok;
  if (code) ok = await net.connect(code, myName, modeId, loadoutString());
  else ok = !!(await net.join(modeId, myName, loadoutString(), { onTry: (n) => hud.setMsg(`Searching… room ${n}`, 0) }));
  if (!ok) {
    joining = false;
    hud.setMsg('No match found — try again', 2500);
    if (where === 'lobby') joinGlobalLobby();
  }
}

const enterPortal = (id) => {
  if (id === 'dev') return startDev();
  if (id === 'bots') return startBots();
  return startOnline(id);
};

// ---------- panels ----------
function openPanel() {
  panelOpen = true;
  input.clear();
  panel.classList.add('on');
  btnResume.textContent = running ? 'Resume' : 'Back';
  btnLobby.style.display = running && where !== 'lobby' ? '' : 'none';
  btnLoadout.style.display = where === 'lobby' ? '' : 'none';
  if (document.pointerLockElement) document.exitPointerLock();
}
function closePanel() {
  panelOpen = false;
  panel.classList.remove('on');
  store.set('rr.room', roomInput.value.trim());
  if (running) lockPointer();
}

const describe = (d) => ((d.kind === 'melee' || d.kind === 'utility') ? (d.blurb || d.name) : `${d.mag}/${d.total} ammo · ${Math.round(60 / d.cd)} rpm · ${reloadDuration(d, d.mag).toFixed(1)}s reload`);
const SLOT_LABEL = { main: 'PRIMARY', side: 'SECONDARY', melee: 'MELEE', utility: 'UTILITY' };
function renderLoadout() {
  const grid = $('loadoutGrid');
  grid.textContent = '';
  for (const slot of SLOTS) {
    const col = document.createElement('div');
    col.className = 'lcol';
    const h = document.createElement('h3');
    h.textContent = SLOT_LABEL[slot];
    col.appendChild(h);
    for (const d of bySlot(slot)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'lw' + (loadout[slot] === d.id ? ' on' : '');
      const n = document.createElement('b'), s = document.createElement('span');
      n.textContent = d.name; s.textContent = describe(d);
      b.append(n, s);
      b.addEventListener('click', () => {
        setSlot(slot, d.id);
        lobby.refresh();
        ctrl.refreshLoadout();
        refreshSlotsUI();
        audio.play('click');
        renderLoadout();
      });
      col.appendChild(b);
    }
    grid.appendChild(col);
  }
}
function openLoadout() {
  loadoutOpen = true;
  input.clear();
  renderLoadout();
  loadoutPanel.classList.add('on');
  if (document.pointerLockElement) document.exitPointerLock();
}
function closeLoadout() {
  loadoutOpen = false;
  loadoutPanel.classList.remove('on');
  if (running && !panelOpen) lockPointer();
}

btnStart.addEventListener('click', () => {
  audio.unlock();
  myName = (nameInput.value || 'Player').trim().slice(0, 20) || 'Player';
  store.set('rr.name', nameInput.value.trim());
  checkCallsign(myName);
  if (devUnlocked() && lobby.enableDevPortal) lobby.enableDevPortal();
  refreshDevUI();
  running = true;
  last = performance.now();
  startEl.classList.add('hide');
  input.clear();
  joinGlobalLobby();
  lockPointer();
});
$('btnSettingsStart').addEventListener('click', openPanel);
$('btnLoadoutStart').addEventListener('click', openLoadout);
$('btnLoadoutDone').addEventListener('click', closeLoadout);
btnResume.addEventListener('click', closePanel);
btnLoadout.addEventListener('click', () => { closePanel(); openLoadout(); });
btnLobby.addEventListener('click', () => { closePanel(); enterLobby('Back in the lobby'); });
$('btnPause').addEventListener('click', () => { if (running) openPanel(); });
document.addEventListener('pointerlockchange', () => {
  if (isTouch) return;
  if (document.pointerLockElement !== canvas && running && !panelOpen && !loadoutOpen && !chatFocused()) openPanel();
});

// ---------- chat ----------
chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (text) {
    if (net.isConnected()) net.sendChat(text);
    else appendChat({ id: 'local', name: myName, text });
  }
  chatInput.value = '';
  chatInput.blur();
  if (running && !panelOpen) lockPointer();
});
chatInput.addEventListener('keydown', (e) => {
  if (e.code === 'Escape') { chatInput.blur(); lockPointer(); }
  e.stopPropagation();
});
addEventListener('keydown', (e) => {
  if (!running || panelOpen || loadoutOpen || chatFocused()) return;
  if (canon(e.code) === 'KeyM' && running && where !== 'lobby') { radar.toggleFull(); return; }
  if (canon(e.code) === 'KeyT' || e.code === 'Enter') {
    e.preventDefault();
    input.clear();
    chatInput.focus();
    if (document.pointerLockElement) document.exitPointerLock();
  }
});

// ---------- settings UI ----------
function bindRange(id, key, fmt, apply) {
  const el = $(id), out = $(id + 'Val');
  el.value = settings[key];
  const show = () => { out.textContent = fmt(settings[key]); };
  show();
  el.addEventListener('input', () => {
    settings[key] = parseFloat(el.value);
    show();
    if (apply) apply();
    saveSettings();
  });
}
function bindCheck(id, key, apply) {
  const el = $(id);
  el.checked = !!settings[key];
  el.addEventListener('change', () => {
    settings[key] = el.checked;
    if (apply) apply();
    saveSettings();
  });
}
bindRange('setSens', 'sens', (v) => v.toFixed(2) + '×');
bindRange('setFov', 'fov', (v) => Math.round(v) + '°');
bindRange('setVol', 'volume', (v) => Math.round(v * 100) + '%', () => audio.setVolume(settings.volume));
bindCheck('setAdsToggle', 'adsToggle');
bindCheck('setInvert', 'invertY');
bindCheck('setFps', 'showFps', () => { if (!settings.showFps) hud.setFps(null); });
bindCheck('setMinimap', 'showMinimap');
bindRange('setMinimapSize', 'minimapSize', (v) => Math.round(v) + 'px');

// Graphics button in the pause menu
{
  const pc = panel.querySelector('.card');
  const gb = document.createElement('div');
  gb.className = 'btns';
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'ghost';
  b.textContent = 'Graphics & performance';
  b.addEventListener('click', () => gfx.openMenu());
  gb.append(b);
  pc.insertBefore(gb, pc.querySelector('.keys'));
}

// ---------- loop ----------
function introCam(t) {
  const a = t * 0.06;
  camera.position.set(Math.sin(a) * 40, 12 + Math.sin(t * 0.13) * 2, 10 + Math.cos(a) * 40);
  camera.lookAt(0, 4, 10);
  camera.fov = settings.fov;
  camera.updateProjectionMatrix();
}

function frame(nowMs) {
  requestAnimationFrame(frame);
  const raw = (nowMs - last) / 1000;
  const dt = Math.min(0.05, raw);
  last = nowMs;
  const interact = input.consumeInteract();
  LOD.on = !!settings.animLod; LOD.x = player.x; LOD.z = player.z;
  LOD.simpleVm = !!settings.simpleVm;
  // Hide far characters when charCull > 0 (metres)
  {
    const cull = Number(settings.charCull) || 0;
    if (cull > 0) {
      const c2 = cull * cull;
      if (where === 'bots') {
        for (const e of enemies) {
          if (!e.mesh) continue;
          const dx = e.mesh.position.x - player.x, dz = e.mesh.position.z - player.z;
          const far = dx * dx + dz * dz > c2;
          if (e.alive) e.mesh.visible = !far;
        }
      }
      for (const r of remotes.values()) {
        if (!r.mesh) continue;
        const dx = r.x - player.x, dz = r.z - player.z;
        const far = dx * dx + dz * dz > c2;
        r.mesh.visible = r.alive && !far;
        if (r.tag) r.tag.visible = r.mesh.visible;
      }
    }
  }
  gfx.tick(raw);

  if (running) {
    const paused = panelOpen && !live && where !== 'multi';
    if (!paused) {
      const now = performance.now() / 1000;
      const dropping = dropship.active();
      if (interact && drone.isFlying()) drone.recall();
      else if (interact && !dropping) {
        // E: leave the aircraft you're flying, else climb into one next to you, else the usual car handling
        if (aircraft.isPiloting()) aircraft.tryUse(player);
        else if (vehicles.isDriving() || !aircraft.tryUse(player)) vehicles.tryUse(player);
      }
      if (aircraft.isPiloting() && input.consumeCmds) input.consumeCmds(); // Z/X/B/G build shortcuts do nothing in a cockpit
      if (dropping) dropship.update(dt);
      else { dropship.tick(dt); ctrl.update(dt); }
      if (infiniteAmmo() && player.alive) { player.ammo = player.magSize; }
      if (!player.alive && drone.isActive()) drone.recall();
      if (vehicles.isDriving()) {
        vehicles.update(dt, player, {
          forward: input.keys.has('KeyW') || input.keys.has('ArrowUp'),
          back: input.keys.has('KeyS') || input.keys.has('ArrowDown'),
          left: input.keys.has('KeyA') || input.keys.has('ArrowLeft'),
          right: input.keys.has('KeyD') || input.keys.has('ArrowRight'),
          jump: input.keys.has('Space'),
        }, camera);
      } else {
        vehicles.update(dt, aircraft.isPiloting() ? noVehPrompt : player, {}, null);
      }
      aircraft.update(dt, player, {}, camera);
      if (where === 'lobby') {
        const act = lobby.update(dt, player, vehicles.isDriving() || aircraft.isPiloting() ? false : interact);
        hud.setPrompt(joining ? { text: 'Searching for a match…', sub: 'Hang tight', progress: 0 } : lobby.prompt);
        if (act && act.type === 'portal' && !joining) enterPortal(act.mode);
        updateRemotes(dt);
      } else {
        hud.setPrompt(null);
        if (where === 'bots') {
          for (const e of enemies) updateEnemy(dt, now, e);
        } else {
          updateRemotes(dt);
          match.tick(dt);
          hud.setBanner(dropship.active() ? null : match.banner());
          hud.setStatus(match.status());
          listT -= dt;
          if (listT <= 0) { listT = 0.25; refreshPlayerList(); }
        }
      }
      bullets.update(dt);
      world.update(player.x, player.z, dt);
      radar.update(player, remotes, dt, {
        active: running && where !== 'lobby',
        enemies: where === 'bots' ? enemies : null,
        build,
      });
    }
    if (isMulti() && input.keys.has('Tab')) hud.setBoard(match.rows(net.getMyId()), match.cfg.teams ? 'TEAMS' : 'SCOREBOARD');
    else hud.setBoard(null);
    fpsT += Math.min(raw, 1); fpsN++; // real frame time (not the clamped sim step)
    if (fpsT >= 0.5) {
      if (settings.showFps) hud.setFps(Math.round(fpsN / fpsT));
      fpsT = fpsN = 0;
    }
  } else {
    introCam(nowMs / 1000);
    world.update(0, 10, dt);
    bullets.update(dt);
  }

  gfx.render(running && viewmodel.visible);
  recorder.frame(nowMs);
}

addEventListener('resize', () => {
  const w = innerWidth, h = innerHeight;
  gfx.resize();
  camera.aspect = vmCamera.aspect = w / h;
  camera.updateProjectionMatrix();
  vmCamera.updateProjectionMatrix();
});

// ---------- recording, extra menus, touch layout ----------
let live = false;
const recorder = createRecorder({
  canvas, audio,
  onStatus: (m) => hud.setMsg(m, 5000),
  getState: () => {
    const slots = ['main', 'side', 'melee', 'utility'].map((sl) => {
      const id = (player.slot === sl) ? player.weaponId : null;
      const labels = { main: 'Primary', side: 'Side', melee: 'Melee', utility: 'Utility' };
      return {
        id: sl,
        on: player.slot === sl,
        name: player.slot === sl ? (player.weaponName || labels[sl]) : labels[sl],
      };
    });
    return {
      hp: Math.ceil(player.hp),
      alive: player.alive,
      weapon: player.weaponName,
      kind: player.weaponKind,
      ammo: player.ammo,
      reserve: player.reserve,
      kills: player.kills,
      deaths: player.deaths,
      scope: player.scope || 0,
      ads: !!player.ads,
      adsBlend: player.adsBlend || 0,
      reloading: !!player.reloading,
      reloadT: player.reloadT || 0,
      reloadTotal: player.reloadTotal || 1,
      crouching: !!player.crouching,
      sprinting: !!player.sprinting,
      thirdPerson: !!player.thirdPerson,
      building: !!player.building,
      slots,
      msg: (hud.getMsg && hud.getMsg()) || '',
    };
  },
});
const _addKill = hud.addKill;
hud.addKill = (a, b, head) => { recorder.feedKill(a, b, head); _addKill(a, b, head); };
const _hitMarker = hud.hitMarker;
hud.hitMarker = (kind) => { recorder.hitMarker(kind); _hitMarker(kind); };
initMenus({
  isTouch, player, ctrl, tex, playerMesh, viewmodel, recorder, panel,
  startCard: document.querySelector('#start .card'),
  ui: {
    hidePanel: () => panel.classList.remove('on'),
    showPanel: () => { if (panelOpen) panel.classList.add('on'); },
    live: (on) => { live = on; },
  },
});
applyLayout();

// ---------- boot ----------
await _step(97, 'Finalizing session…');
refreshSlotsUI();
enterLobby();
hud.update(player);
await _step(100, 'Ready');
try { if (window.__riftLoadDone) window.__riftLoadDone(); } catch (_) {}
btnStart.disabled = false;
btnStart.textContent = 'Enter lobby';

// Auto-update check (GitHub Releases). Cancel → offline lock until updated.
try {
  updater = await initUpdater({
    onLockChange: (forced) => {
      if (isWebClient()) { forceOffline = false; return; }
      forceOffline = !!forced;
      if (forced && where === 'multi') enterLobby('Update required — offline mode');
    },
  });
  forceOffline = isWebClient() ? false : !!(updater && updater.forcedOffline && updater.forcedOffline());
} catch (e) {
  console.warn('[update] init failed', e);
  forceOffline = false;
}

requestAnimationFrame(frame);
