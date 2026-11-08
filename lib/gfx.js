/**
 * Graphics manager: applies the quality settings (shadows, view distance, render scale, effects), owns the optional
 * post-processing (lib/post.js), the auto-performance helper and the Graphics menu.
 *
 * View distance: settings.viewDist is in metres. It sets the camera far plane, the fog, and (through world.setView /
 * world.cull) which trees, rocks, grass and pickups are drawn at all.
 *
 * Ultra Performance toggles (all independent):
 *   cheapMats, maxDpr, propScale, charCull, simpleVm, animLod, autoPerf + autoPerfTarget
 */
import * as THREE from 'three';
import { settings, saveSettings, PRESETS, applyPreset, detectPreset } from './settings.js';
import { createPost } from './post.js';

const SHADOWS = [
  null,
  { size: 1024, half: 38, every: 2, chars: false }, // basic
  { size: 2048, half: 45, every: 1, chars: true }, // normal
  { size: 4096, half: 36, every: 1, chars: true }, // high
  { size: 8192, half: 30, every: 1, chars: true }, // ultra
];
const BUMP = [['grass', 0.5], ['concrete', 1.2], ['wood', 1.0], ['metal', 0.6], ['bark', 1.0]];

/** settings.viewDist in metres (old saves used 1 / 2 / 3 = short / medium / far) */
function viewMeters() {
  const v = Number(settings.viewDist);
  if (v >= 4) return Math.max(80, Math.min(600, v));
  return [400, 170, 250, 400][v | 0] || 400;
}

const CSS = `
#gfxPanel{position:fixed;inset:0;z-index:60;display:none;align-items:center;justify-content:center;padding:14px;background:rgba(6,8,12,.9)}
#gfxPanel.on{display:flex}
#gfxPanel .card{width:min(520px,100%);max-height:min(92vh,900px);overflow:auto}
#gfxPanel h4{font:800 12px var(--mono);letter-spacing:.18em;color:var(--acc);margin:16px 0 4px}
#gfxPanel select{padding:.45rem;border-radius:6px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.08);color:#fff}
#gfxPanel select option{color:#000}
.gp{padding:.55rem .8rem;border-radius:6px;border:1px solid rgba(255,255,255,.2);background:rgba(255,255,255,.1);color:#fff;font-weight:700}
.gp.on{background:var(--acc);color:#1a1205;border-color:var(--acc)}
#gfxRestart{display:none;margin-top:12px;padding:8px 10px;border-radius:6px;background:rgba(255,194,71,.18);font-size:13px}
#gfxRestart.on{display:flex;gap:10px;align-items:center;justify-content:space-between}`;

function h(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const k in props) {
    const v = props[k];
    if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k in e) e[k] = v;
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c) e.append(c);
  return e;
}

export function createGfx(o) {
  const { renderer, scene, camera, vmScene, vmCamera, world, tex, isTouch } = o;
  const sun = world.sun;
  const post = createPost(renderer);
  const muzzle = [];
  scene.traverse((n) => { if (n.isPointLight) muzzle.push(n); });
  const v2 = new THREE.Vector2();

  let frame = 0, shadowEvery = 1, charShadows = true, bumpOn = false, charT = 0, perfAcc = 0, perfN = 0, perfLow = 0;

  function setChars(on) {
    charShadows = on;
    scene.traverse((n) => {
      if (n.isMesh && n.userData && n.userData.humanoid) n.castShadow = on;
    });
  }

  function applyShadows() {
    const q = SHADOWS[settings.shadows];
    sun.castShadow = !!q;
    if (!q) { shadowEvery = 1; charShadows = true; return; }
    const size = isTouch ? Math.min(q.size, 1024) : q.size, s = sun.shadow, c = s.camera;
    if (s.mapSize.x !== size) { s.mapSize.set(size, size); s.map && (s.map.dispose(), (s.map = null)); }
    if (c.right !== q.half) { c.left = -q.half; c.right = q.half; c.top = q.half; c.bottom = -q.half; c.updateProjectionMatrix(); }
    s.bias = -0.0004;
    shadowEvery = q.every;
    if (q.chars !== charShadows) setChars(q.chars);
    renderer.shadowMap.needsUpdate = true;
  }

  function applyView() {
    const d = viewMeters();
    camera.far = Math.max(120, d + 40);
    camera.updateProjectionMatrix();
    if (world.setView) world.setView(d);
    if (scene.fog && scene.fog.isFog) {
      scene.fog.near = Math.min(40, d * 0.25);
      scene.fog.far = d;
    }
  }

  function applyScale() {
    const dprCap = Math.max(0.5, Math.min(2, Number(settings.maxDpr) || 1.5));
    const base = Math.min(devicePixelRatio || 1, dprCap);
    const scale = Math.max(0.4, Math.min(1.25, Number(settings.renderScale) || 1));
    // Never multiply past the user's DPR cap
    renderer.setPixelRatio(Math.min(base * scale, dprCap));
    renderer.setSize(innerWidth, innerHeight, false);
    renderer.getDrawingBufferSize(v2);
    post.setSize(v2.x, v2.y);
  }

  function applyBump() {
    const want = !!settings.bump;
    if (want === bumpOn) return;
    bumpOn = want;
    for (const [name, scale] of BUMP) {
      const m = tex[name];
      if (!m || !m.isTexture) continue;
      // bump maps only applied where materials reference them (world handles on rebuild flags)
    }
  }

  function applyWorldOpts() {
    if (world.setCheapMats) world.setCheapMats(!!settings.cheapMats);
    if (world.setPropScale) world.setPropScale(Number(settings.propScale) || 1);
  }

  function apply() {
    world.setDetail(settings.detail);
    applyWorldOpts();
    applyShadows();
    applyView();
    applyScale();
    applyBump();
    for (const l of muzzle) if (l.visible !== !!settings.muzzleLights) l.visible = !!settings.muzzleLights;
    post.configure({
      rays: settings.godRays,
      ao: settings.ao,
      bloom: settings.bloom,
      grade: settings.grade,
      msaa: settings.aa && !isTouch,
    });
    saveSettings();
  }

  function failPost(e) {
    console.error('post-processing disabled:', e);
    settings.godRays = settings.ao = settings.bloom = settings.grade = false;
    saveSettings();
    post.configure({});
    if (o.say) o.say('Post effects turned off (not supported here)');
  }

  function render(vmOn) {
    frame++;
    if (world.cull) world.cull(camera);
    if (sun.castShadow && shadowEvery > 1) {
      renderer.shadowMap.autoUpdate = false;
      if (frame % shadowEvery === 0) renderer.shadowMap.needsUpdate = true;
    } else renderer.shadowMap.autoUpdate = true;
    let done = false;
    if (post.active) {
      try { post.render(scene, camera, world.sunDir); done = true; } catch (e) { failPost(e); }
    }
    if (!done) { renderer.setRenderTarget(null); renderer.clear(); renderer.render(scene, camera); }
    if (vmOn) { renderer.setRenderTarget(null); renderer.clearDepth(); renderer.render(vmScene, vmCamera); }
  }

  /** rawDt = real frame time in seconds */
  function tick(rawDt) {
    if (!charShadows && sun.castShadow && (charT += rawDt) > 1.5) { charT = 0; setChars(false); }
    if (!settings.autoPerf || rawDt > 0.5) return;
    perfAcc += rawDt; perfN++;
    if (perfAcc < 1.5) return;
    const fps = perfN / perfAcc;
    perfAcc = perfN = 0;
    const target = Math.max(25, Math.min(60, Number(settings.autoPerfTarget) || 45));
    // Step down when below target (not only under 28)
    perfLow = fps < target ? perfLow + 1 : Math.max(0, perfLow - 1);
    if (perfLow >= 2) { perfLow = 0; stepDown(); }
  }

  function stepDown() {
    const s = settings;
    let msg = '';
    if (s.godRays || s.ao || s.bloom || s.grade) { s.godRays = s.ao = s.bloom = s.grade = false; msg = 'post effects off'; }
    else if (!s.cheapMats) { s.cheapMats = true; msg = 'cheap materials on'; }
    else if (s.detail > 0) { s.detail--; msg = 'detail: ' + ['off', 'normal', 'high', 'ultra'][s.detail]; }
    else if ((s.propScale || 1) > 0.2) { s.propScale = Math.max(0.1, (s.propScale || 1) * 0.6); msg = 'props ' + Math.round(s.propScale * 100) + '%'; }
    else if (s.shadows >= 4) { s.shadows = 3; msg = 'shadows: high'; }
    else if (s.shadows >= 3) { s.shadows = 2; msg = 'shadows: normal'; }
    else if (s.renderScale > 0.85) { s.renderScale = 0.85; msg = 'render scale 85%'; }
    else if (s.shadows === 2) { s.shadows = 1; msg = 'shadows: basic'; }
    else if (s.viewDist > 240) { s.viewDist = 240; msg = 'view distance: 240 m'; }
    else if (s.muzzleLights) { s.muzzleLights = false; msg = 'muzzle lights off'; }
    else if ((s.maxDpr || 2) > 1.1) { s.maxDpr = 1.0; msg = 'max pixel ratio 1.0'; }
    else if (s.renderScale > 0.7) { s.renderScale = 0.7; msg = 'render scale 70%'; }
    else if (s.shadows === 1) { s.shadows = 0; msg = 'shadows off'; }
    else if (s.viewDist > 150) { s.viewDist = 150; msg = 'view distance: 150 m'; }
    else if (!s.animLod) { s.animLod = true; msg = 'character anim LOD on'; }
    else if (!s.simpleVm) { s.simpleVm = true; msg = 'simple viewmodel on'; }
    else if (!(s.charCull > 0)) { s.charCull = 70; msg = 'cull characters beyond 70 m'; }
    else if (s.renderScale > 0.55) { s.renderScale = 0.55; msg = 'render scale 55%'; }
    else if (s.viewDist > 100) { s.viewDist = 100; msg = 'view distance: 100 m'; }
    else return;
    apply();
    if (o.say) o.say('Auto performance: ' + msg);
  }

  // ---------- menu ----------
  let panel, card, bar, presetBtns = [];

  function openMenu() {
    if (!panel) {
      const st = document.createElement('style');
      st.textContent = CSS;
      document.head.appendChild(st);
      panel = h('div', { id: 'gfxPanel' });
      card = h('div', { class: 'card panel' });
      panel.append(card);
      panel.addEventListener('click', (e) => { if (e.target === panel) closeMenu(); });
      document.body.appendChild(panel);
    }
    fill();
    panel.classList.add('on');
  }

  function closeMenu() {
    if (panel) panel.classList.remove('on');
  }

  function refresh() {
    const cur = detectPreset();
    for (const [n, b] of presetBtns) b.classList.toggle('on', n === cur);
  }

  function fill() {
    const changed = (fast) => {
      if (fast) fast();
      else apply();
      saveSettings();
      refresh();
    };

    const check = (label, key, extra) => {
      const el = h('input', { type: 'checkbox' });
      el.checked = !!settings[key];
      el.addEventListener('change', () => {
        settings[key] = el.checked;
        if (extra) extra(el.checked);
        changed();
      });
      return h('label', { class: 'row' }, el, document.createTextNode(' ' + label));
    };

    const select = (label, key, opts, extra) => {
      const sel = h('select');
      for (const [v, t] of opts) {
        const op = h('option', { value: String(v) }, t);
        if (String(settings[key]) === String(v)) op.selected = true;
        sel.append(op);
      }
      sel.addEventListener('change', () => {
        const raw = sel.value;
        settings[key] = /^-?\d+(\.\d+)?$/.test(raw) ? Number(raw) : raw;
        if (extra) extra(settings[key]);
        changed();
      });
      return h('label', { class: 'row col' }, h('span', {}, label), sel);
    };

    const range = (label, key, min, max, step, fmt, fast) => {
      const out = h('span', {}, fmt(settings[key]));
      return h('label', { class: 'row col' }, h('span', {}, label), h('input', {
        type: 'range', min, max, step, value: settings[key],
        oninput: (e) => {
          settings[key] = Number(e.target.value);
          out.textContent = fmt(settings[key]);
          changed(fast);
        },
      }), out);
    };

    presetBtns.length = 0;
    const pr = h('div', { class: 'btns' });
    for (const [n, t] of [
      ['ultraPerf', 'Ultra Perf'],
      ['perf', 'Performance'],
      ['def', 'Normal'],
      ['high', 'High'],
      ['ultra', 'Ultra'],
    ]) {
      const b = h('button', {
        class: 'gp',
        type: 'button',
        onclick: () => { applyPreset(n); apply(); fill(); },
      }, t);
      presetBtns.push([n, b]);
      pr.append(b);
    }

    card.replaceChildren(
      h('h2', {}, 'GRAPHICS'),
      pr,
      h('div', { class: 'note' },
        'Ultra Perf turns every speed option on. Each control below stays independent — keep what is worth the cost.'),
      h('h4', {}, 'PERFORMANCE'),
      select('Shadows', 'shadows', [[0, 'Off (fastest)'], [1, 'Basic'], [2, 'Normal'], [3, 'High'], [4, 'Ultra']]),
      select('Detail (grass, trees, rocks)', 'detail', [[0, 'Off'], [1, 'Normal'], [2, 'High'], [3, 'Ultra']]),
      range('World props amount (trees / rocks)', 'propScale', 0, 1, 0.05, (v) => Math.round(v * 100) + '%'),
      range('View distance (only this much is drawn)', 'viewDist', 80, 500, 10, (v) => Math.round(v) + ' m', applyView),
      range('Render scale', 'renderScale', 0.4, 1.5, 0.05, (v) => Math.round(v * 100) + '%'),
      range('Max pixel ratio (caps sharpness / cost)', 'maxDpr', 0.5, 2, 0.05, (v) => v.toFixed(2) + '×'),
      h('h4', {}, 'CHARACTERS & BOTS'),
      range('Bot teams (vs you & each other)', 'botTeams', 2, 4, 1, (v) => String(v)),
      range('Bots per team', 'botTeamSize', 2, 10, 1, (v) => String(v)),
      range('Leaders per team (smart AI)', 'botLeaders', 1, 3, 1, (v) => String(v)),
      check('Animate distant characters less often', 'animLod'),
      range('Hide characters beyond (0 = never)', 'charCull', 0, 150, 5, (v) => (v <= 0 ? 'off' : Math.round(v) + ' m')),
      check('Simple viewmodel (skip finger wrap / extra detail)', 'simpleVm'),
      h('h4', {}, 'WORLD COST'),
      check('Cheap materials (Lambert instead of PBR on terrain / props)', 'cheapMats'),
      check('Muzzle flash lighting', 'muzzleLights'),
      check('Shell casings & dropped mags', 'debris'),
      check('Auto performance (lowers settings if FPS stays low)', 'autoPerf'),
      range('Auto-perf target FPS', 'autoPerfTarget', 30, 60, 1, (v) => Math.round(v) + ' fps'),
      h('h4', {}, 'QUALITY'),
      select('Texture resolution (restart)', 'texRes', [[0.5, 'Low'], [1, 'Default'], [2, 'High'], [3, 'Ultra']], (v) => {
        settings.aniso = v >= 2 ? 16 : v < 1 ? 1 : 8;
      }),
      check('Anti-aliasing (restart)', 'aa'),
      check('Surface detail (bump maps)', 'bump'),
      h('h4', {}, 'HIGH-END EFFECTS' + (post.supported ? '' : ' (not supported on this device)')),
      check('Sun god rays', 'godRays'),
      check('Ambient occlusion (contact shadows)', 'ao'),
      check('Bloom', 'bloom'),
      check('Cinematic colour + vignette', 'grade'),
      h('div', { id: 'gfxRestart', class: '' }),
      h('div', { class: 'note' }, 'If the screen ever breaks, add ?safe to the end of the game URL to reset graphics.'),
      h('div', { class: 'btns' }, h('button', { class: 'primary', type: 'button', onclick: closeMenu }, 'Back')),
    );
    refresh();
  }

  return { apply, render, tick, openMenu, closeMenu, resize: applyScale, post };
}
