/** DOM HUD: vitals, weapon slots, ammo pips, crosshair, scope, hit markers, damage indicators, kill feed,
 *  build bar, prompts, banners, scoreboard, compass. Callbacks to set: api.onSlot(i), api.onBuildPick(i), api.onTier()
 *  Layout (where each element sits on screen) is handled by hudLayout.js, the look by hudSkin.js. */
import { initHudLayout, zone } from './hudLayout.js';
import { installHudSkin } from './hudSkin.js';

const TIER_NAMES = ['Wood', 'Stone', 'Metal'];
const PIECES = ['wall', 'floor', 'ramp'];
const SLOT_ORDER = ['main', 'side', 'melee', 'utility'];
const WHY = { mats: 'Not enough materials', blocked: 'Blocked', level: "Can't build here" };
const TEAM_COL = { A: '#4aa8ff', B: '#ff6b4a' };
const CARD = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };
const CM_HALF = 70; // degrees visible on each side of the compass centre
const CM_PPD = 3.2; // compass pixels per degree

/** The vitals / ammo / score blocks are rebuilt here so the skin can style real elements (bar segments, trail...). */
function buildDom() {
  const byId = (id) => document.getElementById(id);
  const vit = byId('vitals');
  if (vit && !vit.querySelector('#hpTrail')) {
    vit.innerHTML =
      '<div id="hpRow"><div id="hpNum">100</div><div id="hpLabel">HEALTH</div><div id="stance"></div></div>' +
      '<div id="hpBar"><i id="hpTrail"></i><i id="hpFill"></i><div id="hpTicks">' + '<u></u>'.repeat(10) + '</div></div>';
  }
  const amb = byId('ammoBox');
  if (amb && !amb.querySelector('#ammoRow')) {
    amb.innerHTML =
      '<div id="weaponName"></div><div id="ammoRow"><span id="ammoCur">30</span><span id="ammoRes">/ 120</span></div>' +
      '<div id="pips"></div><div id="ammoHint"></div><div id="camMode"></div>';
  }
  const sc = byId('score');
  if (sc && !sc.querySelector('.sc')) {
    sc.innerHTML =
      '<div class="sc"><span>KILLS</span><b id="kills">0</b></div><div class="sc"><span>DEATHS</span><b id="deaths">0</b></div>';
  }
}

/** Heading strip at top centre (desktop only). Fixed pools of ticks + labels that get repositioned, so it stays cheap. */
function buildCompass() {
  if (document.body.classList.contains('mobile') || document.getElementById('compass')) return null;
  const root = document.createElement('div');
  root.id = 'compass';
  const ticks = [], labels = [];
  for (let i = 0; i < 29; i++) { const t = document.createElement('i'); t.className = 'ct'; root.appendChild(t); ticks.push(t); }
  for (let i = 0; i < 10; i++) { const l = document.createElement('b'); l.className = 'cl'; root.appendChild(l); labels.push(l); }
  const mark = document.createElement('div'); mark.id = 'cmMark';
  const val = document.createElement('div'); val.id = 'cmVal';
  root.append(mark, val);
  (zone('TC') || document.getElementById('hud')).appendChild(root);
  return { root, ticks, labels, val };
}

export function createHud() {
  initHudLayout();
  installHudSkin();
  buildDom();
  const compass = buildCompass();

  const el = {};
  for (const id of ['hpFill', 'hpTrail', 'hpNum', 'vitals', 'ammoBox', 'ammoHint', 'weaponName', 'ammoCur', 'ammoRes', 'pips',
    'stance', 'camMode', 'cross', 'hitm', 'dmgFlash', 'lowHp', 'scopeVig', 'scope', 'dmgRing', 'reloadWrap', 'reloadFill', 'msg',
    'respawn', 'respawnTitle', 'respawnCt', 'kills', 'deaths', 'status', 'killfeed', 'fps', 'slots', 'buildBar', 'buildTier',
    'buildMats', 'buildWhy', 'prompt', 'promptText', 'promptSub', 'promptBar', 'banner', 'bannerTitle', 'bannerSub', 'board',
    'boardTitle', 'boardBody']) {
    el[id] = document.getElementById(id);
  }
  const bps = [...document.querySelectorAll('#buildBar .bp')];
  const last = {};
  const api = {};
  let msgTimer = 0, pips = [], gap = 8, gapShown = -1;
  let cmW = 440, cmMeasured = false;

  const flag = (key, node, cls, on) => { if (last[key] !== on) { last[key] = on; node.classList.toggle(cls, on); } };
  const text = (key, node, v) => { if (last[key] !== v) { last[key] = v; node.textContent = v; } };
  const restart = (node, cls) => { node.className = ''; void node.offsetWidth; node.className = cls; };
  const tap = (node, fn) => node.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); fn(); });

  bps.forEach((b, i) => tap(b, () => api.onBuildPick && api.onBuildPick(i)));
  tap(el.buildTier, () => api.onTier && api.onTier());
  addEventListener('resize', () => { cmMeasured = false; last.hd = null; });

  function setMsg(t, ms = 1800) {
    el.msg.textContent = t || '';
    if (t && t !== last.msgText) { el.msg.classList.remove('show'); void el.msg.offsetWidth; el.msg.classList.add('show'); }
    last.msgText = t || '';
    clearTimeout(msgTimer);
    if (t && ms) msgTimer = setTimeout(() => { el.msg.textContent = ''; last.msgText = ''; }, ms);
  }

  function buildPips(n) {
    el.pips.textContent = '';
    pips = [];
    for (let i = 0; i < n; i++) {
      const p = document.createElement('i');
      el.pips.appendChild(p);
      pips.push(p);
    }
    el.pips.classList.toggle('many', n > 36);
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

  /** yaw in radians (game forward = -sin/-cos, so bearing clockwise from north = -yaw) */
  function setHeading(yaw) {
    if (!compass) return;
    let h = ((-yaw * 180) / Math.PI) % 360;
    if (h < 0) h += 360;
    h = Math.round(h * 4) / 4;
    if (!cmMeasured) {
      const w = compass.root.clientWidth;
      if (w) { cmW = w; cmMeasured = true; last.hd = null; }
    }
    if (h === last.hd) return;
    last.hd = h;
    const mid = cmW / 2;

    const t0 = Math.ceil((h - CM_HALF) / 5) * 5;
    for (let i = 0; i < compass.ticks.length; i++) {
      const t = compass.ticks[i], a = t0 + i * 5;
      if (a > h + CM_HALF) { t.style.opacity = '0'; continue; }
      const d = Math.abs(a - h) / CM_HALF;
      t.style.transform = 'translateX(' + (mid + (a - h) * CM_PPD).toFixed(1) + 'px)';
      t.style.opacity = Math.max(0, 1 - Math.pow(d, 2.2)).toFixed(2);
      const m = (((a % 15) + 15) % 15) === 0;
      if (t._m !== m) { t._m = m; t.classList.toggle('m', m); }
    }

    const l0 = Math.ceil((h - CM_HALF) / 15) * 15;
    for (let j = 0; j < compass.labels.length; j++) {
      const l = compass.labels[j], a = l0 + j * 15;
      if (a > h + CM_HALF) { l.style.opacity = '0'; continue; }
      const n = ((a % 360) + 360) % 360;
      const txt = CARD[n] || String(n);
      if (l._t !== txt) {
        l._t = txt;
        l.textContent = txt;
        l.classList.toggle('c', n in CARD);
        l.classList.toggle('n', n === 0);
      }
      const d = Math.abs(a - h) / CM_HALF;
      l.style.transform = 'translateX(' + (mid + (a - h) * CM_PPD).toFixed(1) + 'px)';
      l.style.opacity = Math.max(0, 1 - Math.pow(d, 2.2)).toFixed(2);
    }
    compass.val.textContent = String(Math.round(h) % 360).padStart(3, '0');
  }

  function update(p) {
    const hp = Math.ceil(p.hp);
    if (hp !== last.hp) {
      const prev = last.hp;
      last.hp = hp;
      el.hpNum.textContent = hp;
      const f = Math.max(0, Math.min(1, p.hp / p.maxHp)).toFixed(3);
      el.hpFill.style.transform = `scaleX(${f})`;
      el.hpTrail.classList.toggle('up', prev === undefined || hp > prev); // heal: snap; damage: trail lingers, then drains
      el.hpTrail.style.transform = `scaleX(${f})`;
    }
    flag('hpLow', el.hpFill, 'low', hp < 35);
    flag('vlow', el.vitals, 'low', hp > 0 && hp < 35);
    flag('lowVig', el.lowHp, 'on', hp > 0 && hp < 35);

    const gun = p.weaponKind === 'gun';
    const mag = p.magSize | 0;
    if (mag !== pips.length) buildPips(mag);
    flag('nogun', el.ammoBox, 'nogun', !gun);
    text('wn', el.weaponName, p.weaponName || '');
    const ak = gun ? p.ammo : -1;
    if (ak !== last.ammo) {
      last.ammo = ak;
      el.ammoCur.textContent = gun ? p.ammo : '—';
      el.ammoCur.classList.toggle('low', gun && p.ammo <= p.magSize * 0.25);
      for (let i = 0; i < pips.length; i++) pips[i].classList.toggle('off', i >= p.ammo);
    }
    text('ar', el.ammoRes, gun ? '/ ' + p.reserve : '');
    let hint = '';
    if (gun && p.alive !== false && !p.reloading) {
      if (p.ammo <= 0) hint = p.reserve > 0 ? 'RELOAD' : 'NO AMMO';
      else if (p.ammo <= p.magSize * 0.25) hint = 'LOW AMMO';
    }
    text('ah', el.ammoHint, hint);
    flag('ahe', el.ammoHint, 'empty', gun && p.ammo <= 0);

    text('st', el.stance, !p.alive ? '' : p.sprinting ? 'SPRINT' : p.crouching ? 'CROUCH' : '');
    text('cm', el.camMode, p.thirdPerson ? 'THIRD PERSON' : '');
    if (p.slot !== last.slot) {
      last.slot = p.slot;
      const i = SLOT_ORDER.indexOf(p.slot);
      [...el.slots.children].forEach((c, n) => c.classList.toggle('on', n === i));
    }
    flag('ads', el.cross, 'ads', p.ads && !p.thirdPerson && p.alive);
    flag('hide', el.cross, 'hide', !p.alive || p.building);
    flag('vig', el.scopeVig, 'on', p.ads && p.alive && !last.scopeOn);
    if (typeof p.yaw === 'number') setHeading(p.yaw);
  }

  const hitMarker = (kind = 'hit') => restart(el.hitm, 'show ' + kind);

  /** angle: radians, 0 = from ahead, +PI/2 = from the right. null = no direction. */
  function damage(angle) {
    restart(el.dmgFlash, 'on');
    restart(el.hpNum, 'hit');
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
    row.className = 'kf' + (killer === 'You' ? ' k' : victim === 'You' ? ' d' : '');
    const a = document.createElement('b'), mid = document.createElement('span'), v = document.createElement('b');
    a.textContent = killer; mid.className = 'ico' + (head ? ' hs' : ''); mid.textContent = head ? '◎' : '▸'; v.textContent = victim;
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
    const hd = document.createElement('tr');
    hd.className = 'hd';
    for (const v of ['PLAYER', 'K', 'D']) {
      const td = document.createElement('td');
      td.textContent = v;
      hd.appendChild(td);
    }
    el.boardBody.appendChild(hd);
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
    setPrompt, setBanner, setStatus, setBoard, setSlots, setMode, setFps, setHeading,
  });
}
