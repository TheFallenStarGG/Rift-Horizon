/**
 * Multiplayer client. WORKER_URL = your deployed worker origin (no trailing slash).
 * join(mode, name, loadoutString)  -> matchmaking: tries rooms `${mode}-1`, `${mode}-2`, ... until one isn't full
 * connect(room, name, mode, lo)    -> private / custom room code
 */
import { lookString } from './look.js';
import { getDeviceId } from './account.js';
export const WORKER_URL = 'https://fps-game-server.darkstargaming23266.workers.dev';

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
/** account session token (kept by lib/account.js). The server swaps your callsign for your account name. */
const sessionToken = () => { try { return localStorage.getItem('rr.token') || ''; } catch (_) { return ''; } };

export function createNet(hooks = {}) {
  const H = hooks;
  let ws = null, myId = null, connected = false, stateTimer = null, token = 0;

  function wsUrl(room, name, mode, lo, extra = {}) {
    const q = new URLSearchParams({ room: room || 'lobby', name: name || 'Player', mode: mode || 'custom', lo: lo || '', lk: lookString() });
    for (const [k, v] of Object.entries(extra || {})) if (v != null && v !== '') q.set(k, String(v));
    const tk = sessionToken();
    if (tk) q.set('tk', tk);
    try { const did = getDeviceId(); if (did) q.set('did', did); } catch (_) {}
    return (WORKER_URL.replace(/\/$/, '') + '/ws?' + q.toString()).replace(/^http/, 'ws');
  }

  function dispatch(msg) {
    switch (msg.type) {
      case 'welcome': myId = msg.id; H.onWelcome && H.onWelcome(msg); break;
      case 'join': H.onJoin && H.onJoin(msg.player); break;
      case 'leave': H.onLeave && H.onLeave(msg.id); break;
      case 'state': H.onState && H.onState(msg); break;
      case 'shoot': H.onShoot && H.onShoot(msg); break;
      case 'melee': H.onMelee && H.onMelee(msg); break;
      case 'damage': H.onDamage && H.onDamage(msg); break;
      case 'hp': H.onHp && H.onHp(msg); break;
      case 'heal': H.onHeal && H.onHeal(msg); break;
      case 'kill': H.onKill && H.onKill(msg); break;
      case 'scores': H.onScores && H.onScores(msg); break;
      case 'phase': H.onPhase && H.onPhase(msg); break;
      case 'spawn': H.onSpawn && H.onSpawn(msg); break;
      case 'respawn_in': H.onRespawnIn && H.onRespawnIn(msg.ms); break;
      case 'chat': H.onChat && H.onChat(msg); break;
      case 'bplace': H.onBuild && H.onBuild({ kind: 'place', spec: msg.spec }); break;
      case 'bhit': H.onBuild && H.onBuild({ kind: 'hit', key: msg.key, dmg: msg.dmg }); break;
      case 'bbreak': H.onBuild && H.onBuild({ kind: 'break', key: msg.key }); break;
      case 'bclear': H.onBuild && H.onBuild({ kind: 'clear' }); break;
      case 'bots': H.onBots && H.onBots(msg); break;
      case 'veh': H.onVeh && H.onVeh(msg); break;
      case 'veh_exit': H.onVehExit && H.onVehExit(msg); break;
      case 'veh_claim': H.onVehClaim && H.onVehClaim(msg); break;
      case 'veh_deny': H.onVehDeny && H.onVehDeny(msg); break;
      case 'veh_reset': H.onVehReset && H.onVehReset(msg); break;
      case 'bot_shoot': H.onBotShoot && H.onBotShoot(msg); break;
      case 'full': H.onFull && H.onFull(); break;
      default: break;
    }
  }

  /** resolves 'ok' | 'full' | 'error' */
  function open(room, name, mode, lo, extra = {}) {
    return new Promise((resolve) => {
      let settled = false, sock = null;
      const done = (r) => { if (settled) return; settled = true; clearTimeout(to); resolve(r); };
      const to = setTimeout(() => { done('error'); try { sock && sock.close(); } catch (_) {} }, 9000);
      try { sock = new WebSocket(wsUrl(room, name, mode, lo, extra)); } catch (_) { done('error'); return; }
      sock.onmessage = (ev) => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch { return; }
        if (!settled) {
          if (msg.type === 'welcome') { ws = sock; connected = true; myId = msg.id; done('ok'); dispatch(msg); }
          else if (msg.type === 'full') { done('full'); try { sock.close(); } catch (_) {} }
          return;
        }
        if (sock === ws) dispatch(msg);
      };
      sock.onclose = () => {
        if (!settled) { done('error'); return; }
        if (sock === ws) { ws = null; connected = false; myId = null; stopStateLoop(); H.onClose && H.onClose(); }
      };
      sock.onerror = () => {
        if (!settled) done('error');
        else if (sock === ws && H.onError) H.onError('Connection error');
      };
    });
  }

  function disconnect() {
    token++;
    stopStateLoop();
    const s = ws;
    ws = null; connected = false; myId = null;
    if (s) { try { s.close(); } catch (_) {} }
  }

  /** matchmaking: first non-full room of this mode */
  async function join(mode, name, lo, opt = {}) {
    disconnect();
    const my = token;
    for (let n = 1; n <= (opt.max || 12); n++) {
      if (my !== token) return null;
      if (opt.onTry) opt.onTry(n);
      const r = await open(`${mode}-${n}`, name, mode, lo);
      if (my !== token) { if (r === 'ok') disconnect(); return null; }
      if (r === 'ok') return `${mode}-${n}`;
      if (r === 'error') break;
    }
    if (H.onError) H.onError('Could not find a room');
    return null;
  }

  async function connect(room, name, mode = 'custom', lo = '', extra = {}) {
    disconnect();
    const my = token;
    const r = await open(room, name, mode, lo, extra);
    if (my !== token) { if (r === 'ok') disconnect(); return false; }
    if (r === 'full') H.onFull && H.onFull();
    else if (r === 'error' && H.onError) H.onError('Could not connect');
    return r === 'ok';
  }

  function send(obj) {
    if (!ws || ws.readyState !== 1) return;
    try { ws.send(JSON.stringify(obj)); } catch (_) {}
  }

  /** player needs: x y z yaw pitch ads crouching sprinting reloading weaponId */
  function sendState(p) {
    send({
      type: 'state', x: r2(p.x), y: r2(p.y), z: r2(p.z), yaw: r2(p.yaw), pitch: r2(p.pitch),
      ads: !!p.ads, crouch: !!p.crouching, sprint: !!p.sprinting, rl: !!p.reloading, weapon: p.weaponId,
    });
  }

  function startStateLoop(getPlayer) {
    stopStateLoop();
    stateTimer = setInterval(() => {
      if (!connected) return;
      const p = getPlayer();
      if (p) sendState(p);
    }, 50);
  }
  function stopStateLoop() {
    if (stateTimer) { clearInterval(stateTimer); stateTimer = null; }
  }

  return {
    join, connect, disconnect, send, sendState, startStateLoop, stopStateLoop,
    /** { weapon, ox,oy,oz, dx,dy,dz, hits:[{ id, zone:'head'|'body'|'limb', n }] } */
    sendShoot: (p) => send({ type: 'shoot', ...p }),
    /** { weapon, id (target), zone:'front'|'head', thrown } */
    sendMelee: (p) => send({ type: 'melee', ...p }),
    sendBuild: (spec) => send({ type: 'build', spec }),
    /** damage to a build piece: weapon + n pellets that hit it */
    sendBuildDamage: (key, weapon, n = 1) => send({ type: 'bdmg', key, weapon, n }),
    sendChat: (text) => send({ type: 'chat', text }),
    sendRespawn: () => send({ type: 'respawn' }),
    sendLoadout: (lo) => send({ type: 'loadout', lo }),
    sendBotOrder: (team, order) => send({ type: 'bot_order', team, order }),
    sendBotHit: (id, dmg, head) => send({ type: 'bot_hit', id, dmg, head: !!head }),
    sendVeh: (p) => send({ type: 'veh', ...p }),
    sendVehExit: (p) => send({ type: 'veh_exit', ...p }),
    sendVehClaim: (id) => send({ type: 'veh_claim', id }),
    // Worker expects leader-hit inside bot_order.order.type = 'leader_hit'
    sendBotLeaderHit: (team, x, z, dmg = 0, hit = 'body') =>
      send({ type: 'bot_order', team, order: { type: 'leader_hit', x: r2(x), z: r2(z), dmg: Math.max(0, +dmg || 0), hit } }),
    getMyId: () => myId,
    isConnected: () => connected,
  };
}
