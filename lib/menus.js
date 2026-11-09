/** Extra menus injected into the pause panel: controls, touch layout, character, recording, aim assist, pose tuner */
import { ACTIONS, getBind, setBind, resetBinds, keyName } from './keybinds.js';
import { editLayout } from './layout.js';
import { OPTIONS, look, setLook, applyLook, toHex, menuOptions } from './look.js';
import { recCfg, saveRecCfg } from './recorder.js';
import { settings, saveSettings } from './settings.js';
import { OVR } from './ovr.js';
import { ALL } from './arsenal.js';

const POSE_KEY = 'rr.pose.v1';
try { Object.assign(OVR, JSON.parse(localStorage.getItem(POSE_KEY) || '{}')); } catch (_) {}

const CSS = `
#sub{position:fixed;inset:0;z-index:50;display:none;align-items:center;justify-content:center;padding:14px;background:radial-gradient(ellipse at center,rgba(6,8,12,.72),rgba(4,6,9,.94))}
#sub.on{display:flex}
#sub .card{width:min(560px,100%)}
#sub.tune{background:transparent;pointer-events:none;align-items:flex-start;justify-content:flex-start}
#sub.tune .card{width:min(420px,92vw);max-height:94vh;pointer-events:auto;opacity:.95;overflow:auto}
#sub select,#sub input[type=password],#sub input[type=text]{max-width:55%;margin:0}
#sub .sb{min-width:92px;padding:.5rem .8rem;border-radius:4px;border:1px solid rgba(255,255,255,.2);border-bottom-width:2px;background:linear-gradient(180deg,#2b3340,#1b212b);color:#fff;font:800 12px var(--mono);letter-spacing:.06em;text-transform:uppercase;transition:background .15s,border-color .15s,color .15s}
#sub .sb:hover{border-color:rgba(255,194,71,.6);color:#ffe3a0}
#sub .sb.on{background:linear-gradient(180deg,#ffd470,#f0a51a);color:#1a1205;border-color:var(--acc)}
#sub .btns .sb{flex:1}
.sw{width:30px;height:30px;border-radius:6px;border:2px solid rgba(255,255,255,.25);padding:0;transition:transform .12s,border-color .12s}
.sw:hover{transform:scale(1.1)}
.sw.on{border-color:#fff;box-shadow:0 0 0 2px var(--acc)}
.opt{margin:12px 0}
.opt-row{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.opt h4{margin-bottom:8px;font:800 11px var(--mono);letter-spacing:.18em;text-transform:uppercase;color:var(--acc)}
.opt>div{display:flex;flex-wrap:wrap;gap:6px}
body:has(#sub.tune.on) #start{visibility:hidden}
body.editing #panel{display:none!important}
body.editing .mb{outline:2px dashed rgba(255,255,255,.7)}
body.editing .mb.sel{outline:2px solid var(--acc)}
.mb.rec-on{background:rgba(255,0,0,.5)!important;border-color:#ff5a5a!important}
#sub.tune .sec{margin:10px 0 6px;font:800 10px var(--mono);letter-spacing:.14em;text-transform:uppercase;color:var(--acc);opacity:.9}
#sub.tune .row{gap:4px}
#sub.tune input[type=range]{flex:1;min-width:0}
#sub.tune select{max-width:100%;width:100%;margin:4px 0 8px}
#sub.tune .note{font-size:11px;line-height:1.4;opacity:.7;margin:0 0 8px}
#sub.tune .btns{flex-wrap:wrap}
#sub.tune .sb{min-width:70px;padding:.4rem .55rem;font-size:11px}
#btnRec{left:106px;top:calc(70px + var(--sa));width:38px;height:38px;font-size:10px}`;

function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const k in props) {
    const v = props[k];
    if (k === 'style') e.style.cssText = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k in e) e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c) e.append(c);
  return e;
}

export function initMenus({ isTouch, player, ctrl, tex, playerMesh, viewmodel, recorder, panel, ui }) {
  document.head.append(h('style', {}, CSS));
  const card = h('div', { class: 'card' });
  const sub = h('div', { id: 'sub' }, card);
  document.body.append(sub);
  let timer = 0, onClose = null, lastW = '';

  function open(title, build, o = {}) {
    clearInterval(timer);
    card.replaceChildren(h('h2', {}, title), ...build(), h('div', { class: 'btns' }, h('button', { class: 'primary', onclick: close }, 'Back')));
    card.scrollTop = 0;
    sub.classList.add('on');
    sub.classList.toggle('tune', !!o.tune);
    if (o.tune) { ui.hidePanel(); ui.live(true); }
    onClose = o.onClose || null;
    if (o.poll) timer = setInterval(o.poll, 400);
  }
  function close() {
    clearInterval(timer);
    sub.classList.remove('on', 'tune');
    ui.live(false);
    if (onClose) onClose();
    onClose = null;
    ui.showPanel();
  }

  const kv = (label, ...c) => h('label', { class: 'row' }, h('span', {}, label), ...c);
  const chk = (label, key) => h('label', { class: 'row chk' },
    h('input', { type: 'checkbox', checked: !!settings[key], onchange: (e) => { settings[key] = e.target.checked; saveSettings(); } }), h('span', {}, label));

  // ----- controls (PC) -----
  const controls = () => [
    ...ACTIONS.map(([id, label]) => kv(label, h('button', {
      class: 'sb',
      onclick: (ev) => {
        ev.currentTarget.textContent = 'press a key…';
        const on = (e) => {
          e.preventDefault(); e.stopPropagation();
          removeEventListener('keydown', on, true);
          if (e.code !== 'Escape') setBind(id, e.code);
          show('controls');
        };
        addEventListener('keydown', on, true);
      },
    }, keyName(getBind(id))))),
    h('div', { class: 'btns' }, h('button', { class: 'sb', onclick: () => { resetBinds(); show('controls'); } }, 'Reset to defaults')),
  ];

  // ----- touch layout -----
  const layout = () => [
    h('div', { class: 'note' }, 'Drag any button to move it. Tap a button to select it, then use the slider to resize it. Saved on this device.'),
    h('div', { class: 'btns' }, h('button', { class: 'sb', onclick: () => { close(); ui.hidePanel(); editLayout(() => ui.showPanel()); } }, 'Edit layout')),
  ];

  // ----- aim assist (mobile) -----
  const assist = () => [
    chk('Aim assist (slows + pulls toward targets)', 'aimAssist'),
    chk('Auto-fire when the crosshair is on a target', 'autoFire'),
    kv('Assist strength', h('input', { type: 'range', min: 0.1, max: 1, step: 0.05, value: settings.assistStrength, oninput: (e) => { settings.assistStrength = +e.target.value; saveSettings(); } })),
  ];

  // ----- character (Rifleman-aware options) -----
  const refreshLook = () => {
    applyLook(playerMesh, look, tex);
    applyLook(viewmodel, look, tex);
  };
  const character = () => {
    const rifleman = !!(playerMesh && playerMesh.userData && playerMesh.userData.skin);
    const opts = menuOptions(rifleman);
    const rows = opts.map((o) => h('div', { class: 'opt' }, h('h4', {}, o.label),
      h('div', { class: 'opt-row' }, ...(o.vals || o.pal).map((v, i) => {
        const on = look[o.k] === i;
        const pick = () => {
          setLook(o.k, i);
          // Female → auto clean-shaven (beard mesh off)
          if (o.k === 'gender' && i === 1) setLook('mask', 1);
          refreshLook();
          [...b.parentNode.children].forEach((c, n) => c.classList.toggle('on', n === i));
        };
        const b = o.vals
          ? h('button', { class: 'sb' + (on ? ' on' : ''), onclick: pick }, v)
          : h('button', { class: 'sw' + (on ? ' on' : ''), style: `background:${toHex(v)}`, onclick: pick, title: o.label });
        return b;
      }))));
    return [
      h('div', { class: 'note' }, rifleman
        ? 'Customize your operator. Gender, height and build reshape the Rifleman model. Helmet and facial hair toggle mesh parts.'
        : 'Customize your operator. Changes save on this device and show in multiplayer.'),
      ...rows,
    ];
  };
  const openChar = () => { player.showcase = true; show('character'); };

  // ----- recording -----
  const recording = () => {
    const sel = (label, key, vals, unit) => kv(label, h('select', { onchange: (e) => { recCfg[key] = +e.target.value; saveRecCfg(); } },
      ...vals.map((m) => h('option', { value: m, selected: recCfg[key] === m }, m + unit))));
    const mp4 = window.MediaRecorder && MediaRecorder.isTypeSupported('video/mp4');
    const link = recorder.lastUrl || '';
    const host = recorder.lastHost || '';
    const hostNote = host === 'litterbox'
      ? `On Litterbox — link expires in ${recorder.lastExpires || '72 hours'}`
      : host === 'catbox'
        ? 'On Catbox — long-term link'
        : '';
    return [
      h('div', { class: 'note' }, `Format: ${mp4 ? 'MP4 ✔' : window.MediaRecorder ? 'WebM only' : 'not supported'}. Uploads to Catbox (≤200 MB, long-term) or Litterbox if larger (expires in 72 hours). One clip per take, max ~30 min.`),
      sel('Quality', 'mbps', [1.5, 2.5, 4], ' Mbps'), sel('Width', 'width', [854, 1280, 1600], ' px'),
      hostNote ? h('div', { class: 'note' }, hostNote) : null,
      link ? h('div', { class: 'note' }, link) : null,
      h('div', { class: 'btns' },
        h('button', { class: 'sb', onclick: () => { recorder.toggle(); show('recording'); } }, recorder.active ? '■ Stop recording' : '● Start recording'),
        h('button', { class: 'sb', onclick: () => recorder.copyLastUrl() }, 'Copy link'),
        h('button', { class: 'sb', onclick: () => recorder.retry() }, 'Retry uploads'),
        h('button', { class: 'sb', onclick: () => recorder.downloadAll() }, 'Download unsent')),
    ];
  };

  // ----- pose tuner (full FP animation editor) -----
  // Live state forced by the tuner so you can scrub every animation.
  const _tune = {
    mode: 'hip',          // hip | sprint | ads | reload | cycle | melee
    t: 0,                 // scrub time inside the active sequence
    playing: false,
    lastId: '',
  };

  const FINGER_KEYS = ['index', 'middle', 'ring', 'pinky', 'thumb'];
  const ensureVec3 = (o, k, def = [0, 0, 0]) => {
    if (!Array.isArray(o[k]) || o[k].length !== 3) o[k] = def.slice();
    return o[k];
  };
  const ensurePose = (o, k) => {
    if (!o[k] || typeof o[k] !== 'object') o[k] = { p: [0, 0, 0], r: [0, 0, 0] };
    if (!Array.isArray(o[k].p) || o[k].p.length !== 3) o[k].p = [0, 0, 0];
    if (!Array.isArray(o[k].r) || o[k].r.length !== 3) o[k].r = [0, 0, 0];
    return o[k];
  };
  const ensureFingers = (o, k) => {
    if (!o[k] || typeof o[k] !== 'object') {
      o[k] = { index: 0.9, middle: 0.9, ring: 0.9, pinky: 0.85, thumb: 0.55 };
    }
    for (const f of FINGER_KEYS) if (o[k][f] == null) o[k][f] = 0.9;
    return o[k];
  };

  const tuner = () => {
    const id = player.weaponId, d = ALL[id] || { name: id || '?', kind: 'gun', cls: 'long' };
    lastW = id;
    if (_tune.lastId !== id) { _tune.lastId = id; _tune.t = 0; _tune.playing = false; }
    const o = (OVR[id] = OVR[id] || {});
    ensureVec3(o, 'grip');
    ensureVec3(o, 'fore');
    ensureVec3(o, 'hip');
    if (o.ads == null) o.ads = 0;
    ensurePose(o, 'hipPose');
    ensurePose(o, 'sprintPose');
    ensurePose(o, 'reloadPose');
    ensureVec3(o, 'poleR', [0.6, -1, 0.3]);
    ensureVec3(o, 'poleL', [-0.5, -1, 0.2]);
    ensureVec3(o, 'restL', [-0.22, -0.2, -0.3]);
    ensureVec3(o, 'meleeOff', [0, 0.16, -0.03]);
    if (o.rollR == null) o.rollR = -Math.PI / 2;
    if (o.rollL == null) o.rollL = Math.PI * 0.8;
    if (o.curlR == null) o.curlR = 0.92;
    if (o.curlL == null) o.curlL = 0.7;
    ensureFingers(o, 'fingersR');
    ensureFingers(o, 'fingersL');
    if (o.reloadScale == null) o.reloadScale = 1;
    if (o.cycleScale == null) o.cycleScale = 1;

    const save = () => { try { localStorage.setItem(POSE_KEY, JSON.stringify(OVR)); } catch (_) {} };

    const slider = (label, get, set, min, max, step = 0.005) => {
      const out = h('b', {}, (+get()).toFixed(3));
      const r = h('input', {
        type: 'range', min, max, step, value: get(),
        oninput: () => { set(+r.value); out.textContent = (+get()).toFixed(3); save(); },
      });
      return h('label', { class: 'row' }, h('span', {}, label), r, out);
    };
    const v3 = (name, arr, min = -0.4, max = 0.4) =>
      ['x', 'y', 'z'].map((a, i) => slider(`${name}.${a}`, () => arr[i], (v) => { arr[i] = v; }, min, max));
    const poseSliders = (label, pose) => [
      h('div', { class: 'sec' }, label + ' position'),
      ...v3(label + ' p', pose.p, -0.8, 0.8),
      h('div', { class: 'sec' }, label + ' rotation'),
      ...v3(label + ' r', pose.r, -2, 2, 0.01),
    ];
    const fingerSliders = (side, obj) =>
      FINGER_KEYS.map((f) => slider(`${side} ${f}`, () => obj[f], (v) => { obj[f] = v; }, 0, 1.25, 0.01));

    // Force player state from the selected mode so the viewmodel matches what you are editing
    const applyMode = () => {
      if (!player) return;
      player.ads = false;
      player.sprint = false;
      if (_tune.mode === 'ads') player.ads = true;
      if (_tune.mode === 'sprint') player.sprint = true;
      if (_tune.mode === 'reload' && d.kind === 'gun') {
        player.ammo = 0;
        player.reserve = Math.max(player.reserve || 0, (d.mag || 1) * 2);
        if (ctrl && ctrl.startReload) ctrl.startReload();
        // freeze reload progress at scrub time
        if (player.reloadT != null) player.reloadT = _tune.t;
      }
      if (_tune.mode === 'cycle' && d.cycle && ctrl && ctrl.forceCycle) {
        // best-effort; not all builds expose forceCycle
        try { ctrl.forceCycle(); } catch (_) {}
      }
    };

    const modeSelect = h('select', {
      onchange: (e) => { _tune.mode = e.target.value; _tune.t = 0; applyMode(); show('tune'); },
    },
      ...['hip', 'sprint', 'ads', 'reload', 'cycle', 'melee'].map((m) => {
        const opt = h('option', { value: m }, m.toUpperCase());
        if (m === _tune.mode) opt.selected = true;
        return opt;
      }),
    );

    const maxT = () => {
      if (_tune.mode === 'reload') {
        const base = (o.reload && o.reload.total) || (d.reload && d.reload.total) || 2.85;
        return base * (o.reloadScale || 1);
      }
      if (_tune.mode === 'cycle' && d.cycle) {
        const base = (o.cycle && o.cycle.total) || d.cycle.total || 1;
        return base * (o.cycleScale || 1);
      }
      return 1;
    };

    const scrub = slider('Time', () => _tune.t, (v) => {
      _tune.t = v;
      if (_tune.mode === 'reload' && player) player.reloadT = v;
    }, 0, Math.max(0.01, maxT()), 0.01);

    const copyCode = () => {
      // Produce a complete drop-in lib/ovr.js — no further editing required.
      const body = JSON.stringify(OVR, null, 2);
      const code = `/**\n * Per-weapon first-person pose overrides (Pose Tuner export).\n * Drop this file in as lib/ovr.js (full replacement).\n * Any weapon / field not listed falls back to the built-in defaults.\n */\nexport const OVR = ${body};\n`;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(() => {
          if (ui && ui.toast) ui.toast('ovr.js copied — paste over lib/ovr.js');
        }).catch(() => {
          // fallback prompt
          prompt('Copy this into lib/ovr.js:', code);
        });
      } else {
        prompt('Copy this into lib/ovr.js:', code);
      }
    };

    const resetWeapon = () => {
      delete OVR[id];
      save();
      show('tune');
    };

    const forceButtons = h('div', { class: 'btns' },
      h('button', { class: 'sb', onclick: () => { if (d.kind === 'gun') { player.ads = !player.ads; _tune.mode = player.ads ? 'ads' : 'hip'; show('tune'); } } }, 'Toggle ADS'),
      h('button', { class: 'sb', onclick: () => {
        if (d.kind !== 'gun') return;
        player.ammo = 0;
        player.reserve = Math.max(player.reserve || 0, (d.mag || 1) * 2);
        if (ctrl && ctrl.startReload) ctrl.startReload();
        _tune.mode = 'reload';
        _tune.t = 0;
        show('tune');
      } }, 'Start Reload'),
      h('button', { class: 'sb', onclick: () => { player.sprint = !player.sprint; _tune.mode = player.sprint ? 'sprint' : 'hip'; show('tune'); } }, 'Toggle Sprint'),
      h('button', { class: 'sb', onclick: resetWeapon }, 'Reset weapon'),
      h('button', { class: 'sb', onclick: copyCode }, 'Copy Code'),
    );

    // Build the panel
    const kids = [
      h('div', { class: 'note' }, `${d.name} (${id}). First-person only. Switch weapons with the slot bar. Copy Code writes a complete lib/ovr.js — paste it over the file and any missing keys fall back to defaults.`),
      h('div', { class: 'sec' }, 'Animation mode'),
      modeSelect,
      forceButtons,
    ];

    if (_tune.mode === 'reload' || _tune.mode === 'cycle') {
      kids.push(h('div', { class: 'sec' }, 'Scrub'), scrub);
      if (_tune.mode === 'reload') {
        kids.push(slider('Reload length scale', () => o.reloadScale, (v) => { o.reloadScale = v; }, 0.25, 3, 0.01));
      }
      if (_tune.mode === 'cycle') {
        kids.push(slider('Cycle length scale', () => o.cycleScale, (v) => { o.cycleScale = v; }, 0.25, 3, 0.01));
      }
    }

    kids.push(
      h('div', { class: 'sec' }, 'Gun base poses (absolute)'),
      ...poseSliders('Hip', o.hipPose),
      ...poseSliders('Sprint', o.sprintPose),
      ...poseSliders('Reload pose', o.reloadPose),
      h('div', { class: 'sec' }, 'Gun offsets (additive)'),
      ...v3('Hip offset', o.hip),
      slider('ADS distance', () => o.ads, (v) => { o.ads = v; }, -0.25, 0.35),
      h('div', { class: 'sec' }, 'Wrist offsets (anchor space)'),
      ...v3('Right wrist (grip)', o.grip),
      ...v3('Left wrist (fore)', o.fore),
      h('div', { class: 'sec' }, 'Elbow poles (IK aim)'),
      ...v3('Pole R', o.poleR, -2, 2, 0.01),
      ...v3('Pole L', o.poleL, -2, 2, 0.01),
      h('div', { class: 'sec' }, 'Rest / melee'),
      ...v3('Rest L', o.restL, -1, 1, 0.01),
      ...v3('Melee off', o.meleeOff, -1, 1, 0.01),
      h('div', { class: 'sec' }, 'Wrist rotation (roll) & base curl'),
      slider('Roll R', () => o.rollR, (v) => { o.rollR = v; }, -Math.PI, Math.PI, 0.01),
      slider('Roll L', () => o.rollL, (v) => { o.rollL = v; }, -Math.PI, Math.PI, 0.01),
      slider('Curl R', () => o.curlR, (v) => { o.curlR = v; }, 0, 1.25, 0.01),
      slider('Curl L', () => o.curlL, (v) => { o.curlL = v; }, 0, 1.25, 0.01),
      h('div', { class: 'sec' }, 'Right fingers (0 = open, 1.25 = fully curled)'),
      ...fingerSliders('R', o.fingersR),
      h('div', { class: 'sec' }, 'Left fingers'),
      ...fingerSliders('L', o.fingersL),
      h('div', { class: 'note' }, 'Advanced: to replace an entire reload/cycle timeline, put a full arsenal-style object on OVR[id].reload or OVR[id].cycle (including per-key `fingers` maps). The Copy Code button already serialises whatever is in OVR.'),
    );

    // Keep mode force applied while the panel is open
    applyMode();
    return kids;
  };

  const SEC = {
    controls: { title: 'Controls', build: controls },
    layout: { title: 'Touch layout', build: layout },
    assist: { title: 'Aim assist', build: assist },
    character: { title: 'Character', build: character, opts: { tune: true, onClose: () => { player.showcase = false; } } },
    recording: { title: 'Recording', build: recording },
    tune: { title: 'Pose tuner', build: tuner, opts: { tune: true, poll: () => { if (player.weaponId !== lastW) show('tune'); } } },
  };
  function show(n) { open(SEC[n].title, SEC[n].build, SEC[n].opts); }

  // ----- pause menu: fill the left rail, move injected pieces into their tabs -----
  const nav = panel.querySelector('#pauseNav');
  if (nav) {
    const lobbyBtn = panel.querySelector('#btnLobby');
    const label = (t) => nav.insertBefore(h('div', { class: 'pnav-label' }, t), lobbyBtn);
    const add = (txt, fn) => nav.insertBefore(h('button', { type: 'button', class: 'pnav', onclick: fn }, txt), lobbyBtn);

    label('Options');
    // game.js injects a "Graphics & performance" button into the card; pull it into the rail
    const gb = [...panel.querySelectorAll('button')].find((b) => /^graphics/i.test(b.textContent.trim()));
    if (gb) {
      const wrap = gb.parentNode;
      gb.className = 'pnav';
      gb.textContent = 'Graphics';
      nav.insertBefore(gb, lobbyBtn);
      if (wrap && wrap !== nav && wrap.classList.contains('btns') && !wrap.children.length) wrap.remove();
    }
    if (isTouch) { add('Touch layout', () => show('layout')); add('Aim assist', () => show('assist')); }
    else add('Controls', () => show('controls'));

    label('Extras');
    add('Character', openChar);
    add('Recording', () => show('recording'));
    add('Pose tuner', () => show('tune'));
  }

  // developer section (mounted by lib/dev.js) lives in its own tab
  const devSec = document.getElementById('devSec');
  const devPane = panel.querySelector('[data-pane="dev"]');
  if (devSec && devPane) {
    devPane.append(devSec);
    const dt = panel.querySelector('[data-tab="dev"]');
    if (dt) dt.hidden = false;
  }

  // home page Character button
  const cs = document.getElementById('btnCharStart');
  if (cs) cs.addEventListener('click', openChar);

  if (isTouch) {
    const rb = h('button', { id: 'btnRec', class: 'mb', type: 'button' }, 'REC');
    rb.addEventListener('touchstart', (e) => { e.preventDefault(); recorder.toggle(); }, { passive: false });
    document.getElementById('mobile').append(rb);
    setInterval(() => {
      const a = recorder.active, s = Math.floor(recorder.elapsed);
      rb.classList.toggle('rec-on', a);
      rb.textContent = a ? '●' : 'REC';
      rb.style.background = a ? 'rgba(200,30,30,0.85)' : '';
      rb.style.color = a ? '#fff' : '';
    }, 500);
  }
}
