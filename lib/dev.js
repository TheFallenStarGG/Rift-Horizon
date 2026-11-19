import { settings, saveSettings } from './settings.js';
import { ALL } from './arsenal.js';
import { isOwnerAccount, onAccountChange } from './account.js';

let _unlocked = false;
let _fly = false;
let _god = false;
let _infAmmo = false;
let _hooks = null;
let _bar = null;
let _minimized = false;

function syncFromAccount() {
  const ok = isOwnerAccount();
  if (ok) {
    _unlocked = true;
  } else {
    _unlocked = false;
    _fly = _god = _infAmmo = false;
    hideBar();
  }
  refreshDevUI();
  try { if (ok && _hooks && _hooks.onUnlock) _hooks.onUnlock(); } catch (_) {}
}

// Keep in lockstep with login / logout (account name, not callsign)
try { onAccountChange(syncFromAccount); } catch (_) {}
try { syncFromAccount(); } catch (_) {}

export function devUnlocked() { return _unlocked && isOwnerAccount(); }

/** @deprecated kept so game.js imports still work — always uses account gate */
export function tryUnlock(_ignored) {
  syncFromAccount();
  return devUnlocked();
}

export function lockDev() {
  _unlocked = false;
  _fly = _god = _infAmmo = false;
  hideBar();
  refreshDevUI();
}

/** Callsigns no longer unlock dev tools */
export function checkCallsign(_name) {
  syncFromAccount();
}

export function flying() { return _unlocked && _fly; }
export function godMode() { return _unlocked && _god; }
export function infiniteAmmo() { return _unlocked && _infAmmo; }

export function setFly(v) { _fly = !!v && _unlocked; syncToggles(); }
export function setGod(v) { _god = !!v && _unlocked; syncToggles(); }
export function setInfAmmo(v) { _infAmmo = !!v && _unlocked; syncToggles(); }

function toast(msg) {
  if (_hooks && _hooks.hud && _hooks.hud.setMsg) _hooks.hud.setMsg(msg, 1600);
}

function syncToggles() {
  if (!_bar) return;
  _bar.querySelectorAll('[data-dev-toggle]').forEach((btn) => {
    const k = btn.getAttribute('data-dev-toggle');
    const on = k === 'fly' ? _fly : k === 'god' ? _god : k === 'ammo' ? _infAmmo : false;
    btn.classList.toggle('on', !!on);
  });
}

export function hideBar() {
  if (_bar) _bar.classList.remove('on');
}

export function showBar() {
  if (!_unlocked || !_bar) return;
  _bar.classList.add('on');
  _minimized = false;
  _bar.classList.remove('min');
  syncToggles();
}

export function bindDev(hooks) {
  _hooks = hooks;
  buildBar();
  refreshDevUI();
}

function allWeaponIds() {
  return Object.keys(ALL).filter((id) => ALL[id] && ALL[id].name);
}

function buildBar() {
  if (_bar) return;
  const style = document.createElement('style');
  style.textContent = `
#devBar{display:none;position:fixed;right:12px;bottom:12px;z-index:60;width:min(380px,calc(100vw - 24px));
  max-height:min(52vh,520px);font-family:system-ui,-apple-system,sans-serif;pointer-events:none}
#devBar.on{display:block}
#devBar.min .body{display:none}
#devBar.min{max-height:none}
#devBar .shell{pointer-events:auto;background:linear-gradient(180deg,rgba(14,18,26,.96),rgba(8,10,14,.98));
  border:1px solid rgba(255,194,71,.4);border-radius:14px;box-shadow:0 10px 36px rgba(0,0,0,.55);
  backdrop-filter:blur(14px);color:#eef2f7;overflow:hidden;display:flex;flex-direction:column;max-height:min(52vh,520px)}
#devBar .head{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid rgba(255,255,255,.08);
  cursor:default;flex-shrink:0}
#devBar .head h3{margin:0;flex:1;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#ffc247;font-weight:700}
#devBar .head button{appearance:none;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.06);
  color:#eef2f7;border-radius:8px;width:30px;height:28px;font:700 14px system-ui;cursor:pointer;line-height:1}
#devBar .head button:hover{border-color:rgba(255,194,71,.5);color:#ffc247}
#devBar .body{overflow:auto;padding:10px 12px 12px;flex:1;-webkit-overflow-scrolling:touch}
#devBar .label{font-size:9px;letter-spacing:.12em;text-transform:uppercase;opacity:.45;margin:10px 0 6px}
#devBar .label:first-child{margin-top:0}
#devBar .row{display:flex;flex-wrap:wrap;gap:6px}
#devBar button.act{appearance:none;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.05);
  color:#eef2f7;border-radius:9px;padding:7px 10px;font:600 11px system-ui;cursor:pointer}
#devBar button.act:hover{background:rgba(255,194,71,.12);border-color:rgba(255,194,71,.45)}
#devBar button.act.on{background:rgba(255,194,71,.22);border-color:#ffc247;color:#ffc247}
#devBar button.act.danger{border-color:rgba(255,77,77,.35)}
#devBar button.act.danger:hover{background:rgba(255,77,77,.14);border-color:#ff4d4d;color:#ff8a8a}
#devSec{display:none;margin-top:14px;padding-top:14px;border-top:1px solid rgba(255,255,255,.08)}
#devSec.on{display:block}
#devSec h3{margin:0 0 10px;font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#ffc247}
#devSec .note{font-size:12px;opacity:.6;margin:0 0 10px;line-height:1.45}
#devUnlockRow{display:flex;gap:8px;margin-bottom:10px}
#devUnlockRow input{flex:1;background:rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.12);border-radius:10px;
  color:#eef2f7;padding:8px 10px;font:13px system-ui}
#devUnlockRow button{border:1px solid rgba(255,194,71,.4);background:rgba(255,194,71,.12);color:#ffc247;
  border-radius:10px;padding:8px 12px;font:600 12px system-ui;cursor:pointer}
`;
  document.head.appendChild(style);

  _bar = document.createElement('div');
  _bar.id = 'devBar';
  _bar.innerHTML = `
    <div class="shell">
      <div class="head">
        <h3>Developer</h3>
        <button type="button" data-ui="min" title="Minimize">–</button>
        <button type="button" data-ui="close" title="Close">×</button>
      </div>
      <div class="body">
        <div class="label">Movement & combat</div>
        <div class="row">
          <button type="button" class="act" data-dev-toggle="fly">Fly</button>
          <button type="button" class="act" data-dev-toggle="god">God</button>
          <button type="button" class="act" data-dev-toggle="ammo">Inf ammo</button>
          <button type="button" class="act" data-act="heal">Heal</button>
          <button type="button" class="act" data-act="restock">Restock</button>
        </div>
        <div class="label">Build pieces (in front of you)</div>
        <div class="row">
          <button type="button" class="act" data-act="build:wall:0">Wall wood</button>
          <button type="button" class="act" data-act="build:wall:1">Wall stone</button>
          <button type="button" class="act" data-act="build:wall:2">Wall metal</button>
          <button type="button" class="act" data-act="build:floor:0">Floor</button>
          <button type="button" class="act" data-act="build:ramp:0">Ramp</button>
          <button type="button" class="act" data-act="build:ramp:1">Ramp stone</button>
          <button type="button" class="act" data-act="build:ramp:2">Ramp metal</button>
          <button type="button" class="act danger" data-act="clearBuilds">Clear builds</button>
        </div>
        <div class="label">Vehicles</div>
        <div class="row" data-spawn-vehicles></div>
        <div class="label">Weapons (equip)</div>
        <div class="row" data-spawn-weapons></div>
        <div class="label">Bots</div>
        <div class="row">
          <button type="button" class="act" data-act="bot">Spawn bot</button>
          <button type="button" class="act danger" data-act="killBots">Clear bots</button>
        </div>
        <div class="label">Session</div>
        <div class="row">
          <button type="button" class="act" data-act="lobby">Back to lobby</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(_bar);

  // populate weapons + vehicles
  const vRow = _bar.querySelector('[data-spawn-vehicles]');
  for (const id of ['sedan', 'truck', 'van', 'motorcycle']) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'act';
    b.textContent = id;
    b.setAttribute('data-spawn', 'vehicle:' + id);
    vRow.appendChild(b);
  }
  const wRow = _bar.querySelector('[data-spawn-weapons]');
  for (const id of allWeaponIds()) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'act';
    b.textContent = ALL[id].name;
    b.setAttribute('data-spawn', 'weapon:' + id);
    wRow.appendChild(b);
  }

  _bar.addEventListener('click', (e) => {
    const t = e.target.closest('button');
    if (!t) return;
    const ui = t.getAttribute('data-ui');
    if (ui === 'close') { hideBar(); return; }
    if (ui === 'min') {
      _minimized = !_minimized;
      _bar.classList.toggle('min', _minimized);
      t.textContent = _minimized ? '+' : '–';
      return;
    }
    if (!_unlocked) return;
    const toggle = t.getAttribute('data-dev-toggle');
    const act = t.getAttribute('data-act');
    const spawn = t.getAttribute('data-spawn');
    if (toggle === 'fly') { _fly = !_fly; syncToggles(); toast(_fly ? 'Fly ON — Space up · Ctrl down' : 'Fly OFF'); }
    if (toggle === 'god') { _god = !_god; syncToggles(); toast(_god ? 'God ON' : 'God OFF'); }
    if (toggle === 'ammo') { _infAmmo = !_infAmmo; syncToggles(); toast(_infAmmo ? 'Inf ammo ON' : 'Inf ammo OFF'); }
    if (act && act.startsWith('build:') && _hooks && _hooks.buildPiece) {
      const [, type, tier] = act.split(':');
      _hooks.buildPiece(type, parseInt(tier, 10) || 0);
      return;
    }
    if (act && _hooks && typeof _hooks[act] === 'function') _hooks[act]();
    if (spawn && _hooks && _hooks.spawn) _hooks.spawn(spawn);
  });
}

export function fillSpawnButtons() { /* populated in buildBar */ }

export function refreshDevUI() {
  const sec = document.getElementById('devSec');
  if (!sec) return;
  sec.style.display = isOwnerAccount() ? '' : 'none';
  sec.classList.add('on');
  for (const [id, key] of [['setDevErrors', 'devShowErrors'], ['setDevLoadLogs', 'devShowLoadLogs']]) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.checked = !!settings[key];
    el.onchange = () => {
      settings[key] = el.checked;
      saveSettings();
      applyErrorOverlaySetting();
    };
  }
  applyErrorOverlaySetting();
}

export function applyErrorOverlaySetting() {
  document.documentElement.classList.toggle('dev-errors', !!(settings.devShowErrors && _unlocked));
  const box = document.getElementById('devErrBox');
  if (box && !(settings.devShowErrors && _unlocked)) {
    box.classList.remove('show');
    box.textContent = '';
  }
}

/** Call as early as possible (top of game.js). Gates load-log spam. */
export function installErrorOverlay() {
  if (window.__riftDevErrInstalled) return;
  window.__riftDevErrInstalled = true;

  const box = document.createElement('pre');
  box.id = 'devErrBox';
  box.style.cssText = 'position:fixed;left:0;right:0;bottom:0;max-height:36%;overflow:auto;margin:0;padding:10px 12px;background:rgba(90,0,0,.94);color:#fff;font:11px/1.45 ui-monospace,Menlo,Consolas,monospace;z-index:99999;white-space:pre-wrap;display:none;user-select:text;pointer-events:auto;touch-action:pan-y;border-top:1px solid rgba(255,80,80,.5)';
  const style = document.createElement('style');
  style.textContent = 'html.dev-errors #devErrBox.show{display:block}';
  document.head.appendChild(style);

  function show(t) {
    if (!settings.devShowErrors || !_unlocked) return;
    if (!box.parentNode) document.body.appendChild(box);
    box.classList.add('show');
    box.textContent += t + '\n\n';
  }
  addEventListener('error', (e) => {
    if (e.target && e.target !== window && e.target.tagName) {
      show('Failed to load: ' + (e.target.src || e.target.href || e.target.tagName));
      return;
    }
    show((e.message || 'Error') + '\n' + String(e.filename || '').split('/').slice(-2).join('/') + ':' + e.lineno + ':' + e.colno);
  }, true);
  addEventListener('unhandledrejection', (e) => {
    show('Promise error: ' + ((e.reason && (e.reason.stack || e.reason.message)) || e.reason));
  });
}

export function mountDevSettingsSection() {
  const panel = document.querySelector('#panel .card');
  if (!panel || document.getElementById('devSec')) return;
  const sec = document.createElement('div');
  sec.id = 'devSec';
  sec.className = 'on';
  sec.innerHTML = `
    <h3>Developer</h3>
    <p class="note" id="devOwnerNote">Owner account only. No access codes.</p>
    <label class="row chk"><input id="setDevErrors" type="checkbox" /><span>Show red error overlay</span></label>
    <label class="row chk"><input id="setDevLoadLogs" type="checkbox" /><span>Log model load messages</span></label>
    <div id="devMod" style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,.08)">
      <h3 style="margin:0 0 8px">Moderation</h3>
      <p class="note">Ban = delete account + block IP + device (cannot rejoin as guest). Delete = wipe account only.</p>
      <input id="modUser" type="text" maxlength="16" placeholder="Username" autocomplete="off" style="width:100%;margin:6px 0;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.35);color:#fff" />
      <input id="modReason" type="text" maxlength="120" placeholder="Reason (optional)" autocomplete="off" style="width:100%;margin:6px 0;padding:8px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.35);color:#fff" />
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px">
        <button type="button" id="modLookup" class="ghost">Lookup</button>
        <button type="button" id="modBan" class="ghost" style="border-color:rgba(255,80,80,.5);color:#ff8a8a">Ban permanently</button>
        <button type="button" id="modDelete" class="ghost">Delete account</button>
        <button type="button" id="modRefreshBans" class="ghost">List bans</button>
      </div>
      <pre id="modOut" style="margin-top:10px;max-height:140px;overflow:auto;font:11px/1.4 ui-monospace,monospace;opacity:.85;white-space:pre-wrap"></pre>
    </div>
  `;
  const keys = panel.querySelector('.keys');
  if (keys) panel.insertBefore(sec, keys);
  else panel.appendChild(sec);

  const out = () => document.getElementById('modOut');
  const say = (t) => { const el = out(); if (el) el.textContent = t; };

  const run = async (fn) => {
    try {
      const { isOwnerAccount, modLookup, modBan, modDeleteAccount, modListBans } = await import('./account.js');
      if (!isOwnerAccount()) { say('Log in as the owner account.'); return; }
      await fn({ modLookup, modBan, modDeleteAccount, modListBans });
    } catch (e) {
      say(String((e && e.message) || e));
    }
  };

  sec.querySelector('#modLookup').onclick = () => run(async ({ modLookup }) => {
    const u = document.getElementById('modUser').value.trim();
    const j = await modLookup(u);
    say(j.user ? JSON.stringify(j.user, null, 2) : 'No account found.');
  });
  sec.querySelector('#modBan').onclick = () => run(async ({ modBan }) => {
    const u = document.getElementById('modUser').value.trim();
    const reason = document.getElementById('modReason').value.trim() || 'banned';
    if (!u || !confirm('Permanently ban "' + u + '"? Deletes account and blocks IP + device.')) return;
    const j = await modBan({ username: u, reason });
    say('Banned:\\n' + JSON.stringify(j.banned, null, 2));
  });
  sec.querySelector('#modDelete').onclick = () => run(async ({ modDeleteAccount }) => {
    const u = document.getElementById('modUser').value.trim();
    if (!u || !confirm('Delete account "' + u + '" only (no IP/device ban)?')) return;
    const j = await modDeleteAccount(u);
    say('Deleted: ' + (j.deleted || u));
  });
  sec.querySelector('#modRefreshBans').onclick = () => run(async ({ modListBans }) => {
    const j = await modListBans();
    say((j.bans || []).map((b) => b.kind + ' ' + b.value + (b.reason ? ' — ' + b.reason : '')).join('\\n') || 'No bans.');
  });

  refreshDevUI();
}
