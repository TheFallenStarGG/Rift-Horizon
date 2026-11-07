/** DOM HUD: vitals, weapon slots, ammo pips, crosshair, scope, hit markers, damage indicators, kill feed,
 *  build bar, prompts, banners, scoreboard. Callbacks to set: api.onSlot(i), api.onBuildPick(i), api.onTier()
 *  Layout (where each element sits on screen) is handled by hudLayout.js. */
import { initHudLayout } from './hudLayout.js';

const TIER_NAMES = ['Wood', 'Stone', 'Metal'];
const PIECES = ['wall', 'floor', 'ramp'];
const SLOT_ORDER = ['main', 'side', 'melee', 'utility'];
const WHY = { mats: 'Not enough materials', blocked: 'Blocked', level: "Can't build here" };
const TEAM_COL = { A: '#4aa8ff', B: '#ff6b4a' };

export function createHud() {
  initHudLayout();
  const el = {};
  for (const id of ['hpFill', 'hpNum', 'weaponName', 'ammoCur', 'ammoRes', 'pips', 'stance', 'camMode', 'cross', 'hitm',
    'dmgFlash', 'lowHp', 'scopeVig', 'scope', 'dmgRing', 'reloadWrap', 'reloadFill', 'msg', 'respawn', 'respawnTitle',
    'respawnCt', 'kills', 'deaths', 'status', 'killfeed', 'fps', 'slots', 'buildBar', 'buildTier', 'buildMats', 'buildWhy',
    'prompt', 'promptText', 'promptSub', 'promptBar', 'banner', 'bannerTitle', 'bannerSub', 'board', 'boardTitle', 'boardBody']) {
    el[id] = document.getElementById(id);
  }
  const bps = [...document.querySelectorAll('#buildBar .bp')];
  const last = {};
  const api = {};
  let msgTimer = 0, pips = [], gap = 8, gapShown = -1;

  const flag = (key, node, cls, on) => { if (last[key] !== on) { last[key] = on; node.classList.toggle(cls, on); } };
  const text = (key, node, v) => { if (last[key] !== v) { last[key] = v; node.textContent = v; } };
  const restart = (node, cls) => { node.className = ''; void node.offsetWidth; node.className = cls; };
  const tap = (node, fn) => node.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); fn(); });

  bps.forEach((b, i) => tap(b, () => api.onBuildPick && api.onBuildPick(i)));
  tap(el.buildTier, () => api.onTier && api.onTier());

  function setMsg(t, ms = 1800) {
    el.msg.textContent = t || '';
    clearTimeout(msgTimer);
    if (t && ms) msgTimer = setTimeout(() => { el.msg.textContent = ''; }, ms);
  }

  function buildPips(n) {
    el.pips.textContent = '';
    pips = [];
    for (let i = 0; i < n; i++) {
      const p = document.createElement('i');
      el.pips.appendChild(p);
      pips.push(p);
    }
    last.ammo = -2;
  }

  /** list: [{ key:'1', name }] */
  function setSlots(list) {
    el.slots.textContent = '';
    list.forEach((s, i) => {
      const d = document.createElement('div');
      d.className = 'slot';
      const k = document.createElement('b'), n = document.createElement('span');
      k.textContent = s.key; n.textContent = s.name;
      d.append(k, n);
      tap(d, () => api.onSlot && api.onSlot(i));
      el.slots.appendChild(d);
    });
    last.slot = null;
  }

  function update(p) {
    const hp = Math.ceil(p.hp);
    if (hp !== last.hp) {
      last.hp = hp;
      el.hpNum.textContent = hp;
      el.hpFill.style.transform = `scaleX(${Math.max(0, p.hp / p.maxHp).toFixed(3)})`;
    }
    flag('hpLow', el.hpFill, 'low', hp < 35);
    flag('lowVig', el.lowHp, 'on', hp > 0 && hp < 35);

    const gun = p.weaponKind === 'gun';
    if (p.magSize !== pips.length) buildPips(p.magSize);
    text('wn', el.weaponName, p.weaponName || '');
    const ak = gun ? p.ammo : -1;
    if (ak !== last.ammo) {
      last.ammo = ak;
      el.ammoCur.textContent = gun ? p.ammo : '—';
      el.ammoCur.classList.toggle('low', gun && p.ammo <= p.magSize * 0.25);
      for (let i = 0; i < pips.length; i++) pips[i].classList.toggle('off', i >= p.ammo);
    }
    text('ar', el.ammoRes, gun ? '/ ' + p.reserve : '');

    text('st', el.stance, !p.alive ? '' : p.sprinting ? 'SPRINT' : p.crouching ? 'CROUCH' : !p.onGround ? 'AIRBORNE' : 'STAND');
    text('cm', el.camMode, p.thirdPerson ? '3RD PERSON' : '1ST PERSON');
    if (p.slot !== last.slot) {
      last.slot = p.slot;
      const i = SLOT_ORDER.indexOf(p.slot);
      [...el.slots.children].forEach((c, n) => c.classList.toggle('on', n === i));
    }
    flag('ads', el.cross, 'ads', p.ads && !p.thirdPerson && p.alive);
    flag('hide', el.cross, 'hide', !p.alive || p.building);
    flag('vig', el.scopeVig, 'on', p.ads && p.alive && !last.scopeOn);
  }

  const hitMarker = (kind = 'hit') => restart(el.hitm, 'show ' + kind);

  /** angle: radians, 0 = from ahead, +PI/2 = from the right. null = no direction. */
  function damage(angle) {
    restart(el.dmgFlash, 'on');
    if (typeof angle !== 'number') return;
    const w = document.createElement('div');
    w.className = 'wedge';
    w.style.transform = `rotate(${angle}rad)`;
    w.appendChild(document.createElement('i'));
    el.dmgRing.appendChild(w);
    while (el.dmgRing.children.length > 6) el.dmgRing.firstChild.remove();
    setTimeout(() => w.remove(), 1300);
  }

  function addKill(killer, victim, head) {
    const row = document.createElement('div');
    row.className = 'kf';
    const a = document.createElement('b'), mid = document.createElement('span'), v = document.createElement('b');
    a.textContent = killer; mid.className = 'ico'; mid.textContent = head ? '◎' : '▸'; v.textContent = victim;
    if (killer === 'You') a.className = 'you';
    if (victim === 'You') v.className = 'you';
    row.append(a, mid, v);
    el.killfeed.appendChild(row);
    while (el.killfeed.children.length > 5) el.killfeed.firstChild.remove();
    setTimeout(() => row.remove(), 6000);
  }

  function setScore(k, d) { el.kills.textContent = k; el.deaths.textContent = d; }

  /** rad = current spread half-angle, fovDeg = vertical camera FOV.
   *  The gap is capped at 56px so the crosshair never grows into the reload bar or the HUD stacks above / below it. */
  function setSpread(rad, fovDeg) {
    const g = (Math.tan(rad) / Math.tan((fovDeg * Math.PI) / 360)) * (innerHeight / 2);
    gap += (Math.min(56, Math.max(5, g)) - gap) * 0.3;
    if (Math.abs(gap - gapShown) > 0.3) { gapShown = gap; el.cross.style.setProperty('--g', gap.toFixed(1) + 'px'); }
  }

  function setReload(f) {
    flag('rl', el.reloadWrap, 'on', f >= 0);
    if (f >= 0) {
      const v = f.toFixed(3);
      if (v !== last.rlv) { last.rlv = v; el.reloadFill.style.transform = `scaleX(${v})`; }
    }
  }

  /** null = hidden, -1 = eliminated (waiting for the next round), 0 = respawning, n = countdown */
  function setRespawn(s) {
    const on = s !== null && s !== undefined;
    flag('rs', el.respawn, 'on', on);
    if (!on) return;
    text('rt', el.respawnTitle, s < 0 ? 'ELIMINATED' : 'YOU DIED');
    text('rc', el.respawnCt, s < 0 ? 'Next round soon…' : s > 0 ? `Respawning in ${s}` : 'Respawning…');
  }

  /** v: 0..1 scope blend (sniper) */
  function setScope(v) {
    const q = Math.round(Math.max(0, Math.min(1, (v - 0.55) / 0.35)) * 50) / 50;
    if (q !== last.scopeV) { last.scopeV = q; el.scope.style.opacity = q; }
    last.scopeOn = q > 0.3;
    flag('scoped', el.cross, 'scoped', last.scopeOn);
  }

  /** b = { type, tier, mats, why } or null */
  function setBuild(b) {
    flag('build', el.buildBar, 'on', !!b);
    flag('bbody', document.body, 'building', !!b);
    if (!b) return;
    const i = PIECES.indexOf(b.type);
    if (last.bi !== i) { last.bi = i; bps.forEach((x, n) => x.classList.toggle('on', n === i)); }
    text('bt', el.buildTier, TIER_NAMES[b.tier] || '');
    text('bm', el.buildMats, String(b.mats));
    text('bw', el.buildWhy, WHY[b.why] || '');
  }

  /** p = { text, sub, progress } or null */
  function setPrompt(p) {
    flag('pr', el.prompt, 'on', !!p);
    if (!p) return;
    text('pt', el.promptText, p.text || '');
    text('ps', el.promptSub, p.sub || '');
    const w = p.progress > 0 ? (p.progress * 100).toFixed(0) + '%' : '0%';
    if (w !== last.pw) { last.pw = w; el.promptBar.style.setProperty('--w', w); }
    flag('pb', el.promptBar, 'on', p.progress > 0);
  }

  /** b = { title, sub } or null */
  function setBanner(b) {
    flag('bn', el.banner, 'on', !!b);
    if (b) { text('bnt', el.bannerTitle, b.title || ''); text('bns', el.bannerSub, b.sub || ''); }
  }

  const setStatus = (t) => text('stt', el.status, t || '');

  /** rows: [{ name, k, d, team, me }] or null to hide */
  function setBoard(rows, title) {
    flag('bd', el.board, 'on', !!rows);
    if (!rows) return;
    const key = title + JSON.stringify(rows);
    if (key === last.bdk) return;
    last.bdk = key;
    el.boardTitle.textContent = title || 'SCOREBOARD';
    el.boardBody.textContent = '';
    for (const r of rows) {
      const tr = document.createElement('tr');
      if (r.me) tr.className = 'me';
      for (const v of [(r.team ? r.team + ' · ' : '') + r.name, r.k, r.d]) {
        const td = document.createElement('td');
        td.textContent = v;
        tr.appendChild(td);
      }
      if (r.team) tr.firstChild.style.color = TEAM_COL[r.team] || '#fff';
      el.boardBody.appendChild(tr);
    }
  }

  const setMode = (m) => { document.body.dataset.mode = m; };
  const setFps = (v) => { el.fps.textContent = v == null ? '' : v + ' FPS'; };

  return Object.assign(api, {
    setMsg, update, hitMarker, damage, addKill, setScore, setSpread, setReload, setRespawn, setScope, setBuild,
    setPrompt, setBanner, setStatus, setBoard, setSlots, setMode, setFps,
  });
}
