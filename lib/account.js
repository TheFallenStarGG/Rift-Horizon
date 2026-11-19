/**
 * Accounts (client): login / sign-up UI, session token, record sync, leaderboard fetch.
 * Importing this module injects the account strip on the home page and an "Account" button in the pause menu.
 */
import { WORKER_URL } from './net.js';

const API = WORKER_URL.replace(/\/$/, '');
const K_TOKEN = 'rr.token', K_USER = 'rr.user', K_SYNC = 'rr.lbSynced';
const ls = {
  get(k) { try { return localStorage.getItem(k) || ''; } catch (_) { return ''; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* private mode */ } },
  del(k) { try { localStorage.removeItem(k); } catch (_) { /* private mode */ } },
};
const DID_KEY = 'rr.did';
export function getDeviceId() {
  let id = ls.get(DID_KEY);
  if (!id || id.length < 8) {
    id = (crypto.randomUUID && crypto.randomUUID()) || ('d' + Math.random().toString(36).slice(2) + Date.now().toString(36));
    ls.set(DID_KEY, id);
  }
  return id;
}
/** Wipe local progress/settings tied to a player (not the device ban id). */
export function wipeLocalPlayerData() {
  try {
    const keep = new Set([DID_KEY]); // keep device id so bans still stick
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) keys.push(localStorage.key(i));
    for (const k of keys) {
      if (!k || keep.has(k)) continue;
      if (/^(rr\.|lobby\.|rift\.|realmrange)/i.test(k)) localStorage.removeItem(k);
    }
  } catch (_) {}
}
let token = ls.get(K_TOKEN), user = ls.get(K_USER);
let nameInput = null, strip = null, modal = null, mode = 'login', busy = false, locked = false, syncing = false;
const listeners = new Set();
const $ = (id) => document.getElementById(id);

export const getToken = () => token;
export const getUser = () => user;
export const isLoggedIn = () => !!token && !!user;
export function onAccountChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** Account username (not callsign) that owns the project — same gate as recording. */
export const OWNER_USERNAME = 'thefallenstargg';
export const isOwnerAccount = () => !!token && String(user || '').toLowerCase() === OWNER_USERNAME;

/**
 * Ban impersonation names. Exact owner username is allowed (only one account can hold it).
 * Strips case / spaces / punctuation so TheFallenStar, fallen_star, etc. all match.
 */
export function isReservedName(name) {
  const s = String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!s) return false;
  if (s === OWNER_USERNAME) return false;
  if (s.includes('fallenstar')) return true;
  if (s.includes('fallenstarg')) return true;
  if (s.startsWith('thefallen')) return true;
  return false;
}

const ERR = {
  bad_username: '3–16 letters, numbers or underscores.',
  name_reserved: 'That name is reserved.',
  bad_password: 'Password must be 6–128 characters.',
  username_taken: 'That username is taken.',
  bad_login: 'Wrong username or password.',
  too_many_attempts: 'Too many tries. Wait a few minutes.',
  accounts_offline: 'Accounts are offline right now.',
  unauthorized: 'Session expired. Log in again.',
  banned: 'This device or network is banned from Rift Horizon.',
  account_deleted_impersonation: 'Your account was deleted for impersonating the owner.',
  cannot_ban_owner: 'The owner account cannot be banned.',
  not_found: 'Account not found.',

};
async function api(path, opt = {}) {
  const headers = { 'X-Device-Id': getDeviceId() };
  if (opt.body) headers['Content-Type'] = 'application/json';
  if (opt.auth && token) headers.Authorization = 'Bearer ' + token;
  let res;
  try {
    res = await fetch(API + path, { method: opt.body ? 'POST' : 'GET', headers, body: opt.body ? JSON.stringify(opt.body) : undefined });
  } catch (_) {
    const e = new Error("Can't reach the server."); e.code = 'network'; throw e;
  }
  let j = null;
  try { j = await res.json(); } catch (_) { /* no body */ }
  if (!res.ok) {
    const e = new Error(ERR[j && j.error] || 'Something went wrong.');
    e.code = (j && j.error) || 'http_' + res.status;
    throw e;
  }
  return j;
}

// ---------- leaderboards ----------
let lbCache = null, lbT = 0;
export async function fetchBoards(force = false) {
  if (!force && lbCache && Date.now() - lbT < 15000) return lbCache;
  lbCache = await api('/api/lb');
  lbT = Date.now();
  return lbCache;
}

// ---------- session ----------
function setSession(tok, name) {
  const changed = (name || '') !== user;
  token = tok || ''; user = name || '';
  if (token) { ls.set(K_TOKEN, token); ls.set(K_USER, user); } else { ls.del(K_TOKEN); ls.del(K_USER); }
  if (changed) ls.del(K_SYNC);
  applyName();
  renderStrip();
  if (modal && modal.classList.contains('on')) renderModal();
  listeners.forEach((fn) => { try { fn(user); } catch (_) { /* listener bug */ } });
  if (token) syncScores(true);
}
function applyName() {
  if (!nameInput) return;
  if (user) {
    nameInput.value = user; nameInput.readOnly = true; nameInput.style.opacity = '.7'; locked = true;
    ls.set('rr.name', user);
  } else if (locked) {
    nameInput.value = ''; nameInput.readOnly = false; nameInput.style.opacity = ''; locked = false;
    ls.set('rr.name', '');
  }
}

// ---------- push local records up (lobby.js keeps them in localStorage under "lobby.*") ----------
function readLocal() {
  const raw = (k) => { try { return JSON.parse(localStorage.getItem('lobby.' + k)); } catch (_) { return null; } };
  const run = Number(raw('runBest')) || 0;
  return {
    run_ms: run > 0 ? Math.round(run * 1000) : null,
    reflex: Number(raw('reflexBest')) || 0,
    dps: Number(raw('dpsBest')) || 0,
    secrets: Array.isArray(raw('secrets')) ? raw('secrets').length : 0,
    classified: Array.isArray(raw('classified')) ? raw('classified').length : 0,
  };
}
async function syncScores(force) {
  if (!token || syncing) return;
  const cur = readLocal(), key = JSON.stringify(cur);
  if (!force && key === ls.get(K_SYNC)) return;
  if (!cur.run_ms && !cur.reflex && !cur.dps && !cur.secrets && !cur.classified) return;
  syncing = true;
  try { await api('/api/score', { body: cur, auth: true }); ls.set(K_SYNC, key); }
  catch (e) { if (e.code === 'unauthorized') setSession('', ''); }
  syncing = false;
}
setInterval(() => syncScores(false), 5000);

// ---------- UI ----------
const CSS = `
#acctPanel{position:fixed;inset:0;z-index:60;display:none;align-items:center;justify-content:center;padding:16px;background:radial-gradient(ellipse at center,rgba(6,8,12,.7),rgba(4,6,9,.94))}
#acctPanel.on{display:flex}
.acct-strip{display:flex;align-items:center;gap:8px;margin:0 0 12px;padding:8px 10px;border:1px solid rgba(255,255,255,.12);border-left:3px solid var(--acc);border-radius:3px;background:rgba(8,11,16,.6);font:700 11px var(--mono);letter-spacing:.12em;text-transform:uppercase;color:rgba(238,242,247,.7)}
.acct-strip .who{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.acct-strip .who b{color:var(--acc)}
.acct-strip button{padding:.45rem .7rem;border-radius:3px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.07);color:var(--ui);font:800 10px var(--mono);letter-spacing:.14em;text-transform:uppercase}
.acct-strip button:hover{background:rgba(255,194,71,.12);border-color:rgba(255,194,71,.55);color:#ffe3a0}
.acct-tabs{display:flex;gap:6px;margin-bottom:6px}
.acct-tabs button{flex:1;padding:.6rem;border:0;border-bottom:2px solid transparent;background:transparent;color:rgba(238,242,247,.55);font:800 12px var(--mono);letter-spacing:.14em;text-transform:uppercase}
.acct-tabs button.on{color:var(--acc);border-bottom-color:var(--acc)}
.acct-err{min-height:1.3em;margin:2px 0 4px;font-size:12px;color:#ff8a8a}
.acct-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 18px;margin:4px 0 6px}
.acct-grid div{display:flex;justify-content:space-between;gap:8px;padding:7px 2px;border-bottom:1px solid rgba(255,255,255,.07);font-size:13px}
.acct-grid b{font:800 13px var(--mono);color:var(--acc)}
@media(max-width:520px){.acct-grid{grid-template-columns:1fr}}`;

function buildStrip() {
  const field = nameInput && nameInput.closest('.sfield');
  if (!field) return;
  strip = document.createElement('div');
  strip.className = 'acct-strip';
  strip.style.setProperty('--i', '3');
  field.insertAdjacentElement('afterend', strip);
  renderStrip();
}
function renderStrip() {
  if (!strip) return;
  strip.textContent = '';
  const who = document.createElement('span');
  who.className = 'who';
  if (user) {
    const b = document.createElement('b');
    b.textContent = user;
    who.append('Signed in as ', b);
  } else who.textContent = 'Guest · stats not saved';
  strip.append(who);
  const add = (label, fn) => {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = label; b.addEventListener('click', fn);
    strip.append(b);
  };
  if (user) add('Stats', () => openAccount());
  else { add('Log in', () => openAccount('login')); add('Sign up', () => openAccount('signup')); }
}
function buildPauseBtn() {
  const nav = $('pauseNav');
  if (!nav) return;
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'pnav'; b.id = 'btnAccount'; b.textContent = 'Account';
  b.addEventListener('click', () => openAccount());
  nav.insertBefore(b, $('btnLobby') || null);
}

function buildModal() {
  if (modal) return;
  modal = document.createElement('div');
  modal.id = 'acctPanel';
  modal.innerHTML = `
    <div class="card" role="dialog" aria-modal="true" aria-labelledby="acctTitle">
      <h2 id="acctTitle">Account</h2>
      <div id="acctForm">
        <div class="acct-tabs"><button type="button" data-m="login">Log in</button><button type="button" data-m="signup">Create account</button></div>
        <p class="sub" id="acctSub"></p>
        <input id="acctUser" type="text" maxlength="16" placeholder="Username" autocomplete="username" autocapitalize="off" spellcheck="false" />
        <input id="acctPass" type="password" maxlength="128" placeholder="Password" autocomplete="current-password" />
        <input id="acctPass2" type="password" maxlength="128" placeholder="Repeat password" autocomplete="new-password" />
        <p class="acct-err" id="acctErr"></p>
      </div>
      <div id="acctInfo"></div>
      <div class="btns">
        <button type="button" class="ghost" id="acctClose">Close</button>
        <button type="button" class="ghost" id="acctOut">Log out</button>
        <button type="button" class="primary" id="acctGo">Log in</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modal.addEventListener('keydown', (e) => {
    e.stopPropagation(); // keep typing away from the game's key handlers
    if (e.key === 'Escape') closeAccount();
    else if (e.key === 'Enter' && !user) submit();
  });
  modal.addEventListener('mousedown', (e) => { if (e.target === modal) closeAccount(); });
  modal.querySelectorAll('.acct-tabs button').forEach((b) => b.addEventListener('click', () => { mode = b.dataset.m; renderModal(); }));
  $('acctClose').addEventListener('click', closeAccount);
  $('acctGo').addEventListener('click', submit);
  $('acctOut').addEventListener('click', logout);
}
const err = (m) => { const el = $('acctErr'); if (el) el.textContent = m || ''; };

function renderModal() {
  const inn = !!user;
  $('acctTitle').textContent = inn ? 'Account' : (mode === 'signup' ? 'Create account' : 'Log in');
  $('acctForm').style.display = inn ? 'none' : '';
  $('acctInfo').style.display = inn ? '' : 'none';
  $('acctGo').style.display = inn ? 'none' : '';
  $('acctOut').style.display = inn ? '' : 'none';
  modal.querySelectorAll('.acct-tabs button').forEach((b) => b.classList.toggle('on', b.dataset.m === mode));
  $('acctPass2').style.display = mode === 'signup' ? '' : 'none';
  $('acctPass').autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
  $('acctGo').textContent = mode === 'signup' ? 'Create account' : 'Log in';
  $('acctSub').textContent = mode === 'signup'
    ? 'Pick a username and password. No email needed, so there is no password reset: remember it.'
    : 'Log in to save your stats and appear on the global leaderboards.';
  err('');
  if (inn) showInfo();
}
async function showInfo() {
  const box = $('acctInfo');
  box.textContent = 'Loading…';
  try {
    const { user: s } = await api('/api/auth/me', { auth: true });
    if (!user) return;
    const n = (v) => Number(v) || 0;
    const rows = [
      ['Callsign', s.username], ['Kills', n(s.kills)], ['Deaths', n(s.deaths)],
      ['K/D', (n(s.kills) / Math.max(1, n(s.deaths))).toFixed(2)], ['Headshots', n(s.headshots)], ['Bot kills', n(s.botKills)],
      ['Match wins', n(s.wins)], ['Best streak', n(s.streak)],
      ['Rift Run', s.runMs ? (s.runMs / 1000).toFixed(2) + 's' : '—'], ['Reflex best', n(s.reflex) || '—'],
      ['DPS record', n(s.dps) || '—'], ['Secrets', n(s.secrets) + '/8'], ['Classified', n(s.classified) + '/8'],
    ];
    const grid = document.createElement('div');
    grid.className = 'acct-grid';
    for (const [k, v] of rows) {
      const d = document.createElement('div'), b = document.createElement('b');
      b.textContent = String(v);
      d.append(k, b);
      grid.append(d);
    }
    box.textContent = '';
    box.append(grid);
  } catch (e) {
    if (e.code === 'unauthorized') setSession('', '');
    else box.textContent = e.message;
  }
}
async function submit() {
  if (busy || user) return;
  const u = $('acctUser').value.trim(), p = $('acctPass').value;
  if (!/^[A-Za-z0-9_]{3,16}$/.test(u)) return err(ERR.bad_username);
  if (isReservedName(u)) return err(ERR.name_reserved);
  if (p.length < 6) return err(ERR.bad_password);
  if (mode === 'signup' && p !== $('acctPass2').value) return err("Passwords don't match.");
  busy = true; err(''); $('acctGo').disabled = true;
  try {
    const j = await api('/api/auth/' + mode, { body: { username: u, password: p, device: getDeviceId() } });
    $('acctPass').value = ''; $('acctPass2').value = '';
    setSession(j.token, j.user.username);
  } catch (e) {
    if (e.code === 'account_deleted_impersonation') {
      wipeLocalPlayerData();
      err(e.message || ERR.account_deleted_impersonation);
    } else if (e.code === 'banned') {
      err(e.message || ERR.banned);
    } else err(e.message);
  }
  busy = false; $('acctGo').disabled = false;
}
async function logout() {
  const t = token;
  setSession('', '');
  closeAccount();
  if (t) { try { await fetch(API + '/api/auth/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + t } }); } catch (_) { /* offline */ } }
}
export function openAccount(m) {
  buildModal();
  if (m) mode = m;
  modal.classList.add('on');
  renderModal();
  if (!user) setTimeout(() => { try { $('acctUser').focus(); } catch (_) { /* hidden */ } }, 30);
}
export function closeAccount() { if (modal) modal.classList.remove('on'); }

function init() {
  try {
    nameInput = $('nameInput');
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
    buildStrip();
    buildPauseBtn();
    applyName();
    if (token) {
      api('/api/auth/me', { auth: true })
        .then((j) => {
          const un = j.user && j.user.username;
          if (un && isReservedName(un)) { setSession('', ''); return; } // server should have renamed; never keep a reserved session
          if (un && un !== user) setSession(token, un);
          else syncScores(true);
        })
        .catch((e) => { if (e.code === 'unauthorized') setSession('', ''); });
    }
  } catch (e) { console.error('[account] init failed', e); }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();

// ---------- owner moderation (server enforces owner token) ----------
export async function modLookup(username) {
  return api('/api/mod/lookup?username=' + encodeURIComponent(username), { auth: true });
}
export async function modListBans() {
  return api('/api/mod/bans', { auth: true });
}
export async function modBan({ username, ip, device, reason }) {
  return api('/api/mod/ban', { auth: true, body: { username, ip, device, reason, deviceSelf: getDeviceId() } });
}
export async function modDeleteAccount(username) {
  return api('/api/mod/delete', { auth: true, body: { username } });
}
export async function modUnban(kind, value) {
  return api('/api/mod/unban', { auth: true, body: { kind, value } });
}
