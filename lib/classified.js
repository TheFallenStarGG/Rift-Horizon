/**
 * CLASSIFIED: eight very hard secrets hidden in the Rift Horizon lobby, each with its own cutscene.
 * Finding all eight unseals the reward: the Event Horizon (lib/packClassified.js).
 *
 *   01 HOOK      grapple blade onto the annex roof, open the hatch
 *   02 DASH      wisp phase dash across a 12 m gap onto a floating island
 *   03 ECHO      Sentinel Pulse Scan reveals 5 sigils, shoot them all before they fade
 *   04 CIPHER    the 4 pylons flash a colour code outside, shoot it back in REVERSE at the kiosk
 *   05 FLAWLESS  Reflex Gallery score without ever hitting a blue target
 *   06 LANTERNS  pop all 14 lanterns within a short window
 *   07 GHOST     equip the ghost loadout and stand on the dais
 *   08 BACKROOMS corner under the lounge: face it + jump, fall in, survive, find the exit
 *
 * Lobby hooks it needs (see createClassified call in lobby.js): update(dt,p,interact,active) -> true while a cutscene
 * owns the camera (game.js then skips ctrl.update), abort(), cutsceneOn().
 */
import * as THREE from 'three';
import { addCollider, setColliderActive, raycastWorld } from './collision.js';
import { ABILITIES } from './registry.js';
import { ALL } from './arsenal.js';
import { loadout, setSlot } from './loadout.js';

const PI = Math.PI;
export const CLASSIFIED_TOTAL = 8;
export const REWARD = { slot: 'main', id: 'horizon' };
/** all the difficulty knobs in one place */
export const TUNE = {
  flawless: 520,       // Reflex Gallery score, zero blue hits
  lanternWindow: 18,   // seconds to pop all 14 lanterns
  scanWindow: 7.5,     // seconds the 5 sigils stay revealed after a Pulse Scan
  ghostHold: 4,        // seconds on the dais with the ghost loadout
  gap: 12,             // metres of void between the launch platform and the island
  jumps: 7,            // corner jumps needed
  seq: [0, 1, 1, 3, 2, 0], // pylon flash order (0 NW cyan, 1 NE gold, 2 SE pink, 3 SW green); entered in REVERSE
};
const ORDER = ['hook', 'dash', 'scan', 'cipher', 'flawless', 'lanterns', 'ghost', 'backrooms'];
const FILES = {
  hook:      { n: 1, title: 'THE EYE ABOVE',          hint: 'Some gaps are only crossed by those who slip through the air itself.' },
  dash:      { n: 2, title: 'NOTHING SOLID STOPS YOU', hint: 'What hides in the walls answers only to a sweeping light. Wake the Sentinel.' },
  scan:      { n: 3, title: 'THE SENTINEL SEES',       hint: 'Beyond the glass the corners keep a code. Answer it backwards.' },
  cipher:    { n: 4, title: 'THE CORNERS SPEAK',       hint: `The gallery pays in full to those who never spare a blue. ${TUNE.flawless}, or near it.` },
  flawless:  { n: 5, title: 'NOT ONE FRIEND LOST',     hint: `Fourteen lights hang over the hall. Put them all out within ${TUNE.lanternWindow} seconds.` },
  lanterns:  { n: 6, title: 'FOURTEEN LIGHTS, ONE BREATH', hint: 'Four ghosts, one dais. The rifle that sees through walls, the pistol that slips, the blade that blinks, the eye that flies.' },
  ghost:     { n: 7, title: 'THE GHOST LOADOUT',       hint: 'Where the walls end, the yellow begins. Press into the corner beneath the lounge and keep jumping.' },
  backrooms: { n: 8, title: 'THE WAY OUT',             hint: 'Nothing is left to find. Go and look at the lounge.' },
};

export function createClassified(ctx) {
  const { scene, root, L, X, Y, Z, hooks, store, std, basic, unit, box, solid, glow, put, act, note, burst, spark, sign, cv, canvasTex, clamp } = ctx;
  const { darkM, baseM } = ctx.mats;
  const { camera, viewmodel, playerMesh } = hooks;
  const W = (x, y, z) => [X(x), Y(y), Z(z)];
  const done = new Set(store.get('classified', []));
  const rnd = Math.random;
  let T = 0, P = null;

  const addM = (color, op = 0.6) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, fog: false });
  const tex2 = (w, h, draw, rep) => {
    const [c, g] = cv(w, h); draw(g, w, h);
    const t = canvasTex(c);
    if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep[0], rep[1]); }
    return t;
  };

  // =====================================================================================
  //  tweens + effects
  // =====================================================================================
  const fx = [];
  const tween = (d, fn, end) => fx.push({ t: 0, d, fn, end });
  function tickFx(dt) {
    for (let i = fx.length - 1; i >= 0; i--) {
      const f = fx[i]; f.t += dt;
      const u = Math.min(1, f.t / f.d);
      f.fn(u);
      if (u >= 1) { fx.splice(i, 1); if (f.end) f.end(); }
    }
  }
  function ring(x, y, z, color, R, d) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.92, 1, 48), addM(color, 0.9));
    m.rotation.x = -PI / 2; m.position.set(x, y, z); root.add(m);
    tween(d, (u) => { m.scale.setScalar(0.3 + u * R); m.material.opacity = 0.9 * (1 - u); }, () => { root.remove(m); m.geometry.dispose(); m.material.dispose(); });
  }
  const UP = new THREE.Vector3(0, 1, 0);
  function beam(a, b, color, r = 0.12) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 8, 1, true), addM(color, 0.85));
    root.add(m);
    const A = new THREE.Vector3(...a), dir = new THREE.Vector3(...b).sub(A), len = dir.length();
    dir.normalize(); m.quaternion.setFromUnitVectors(UP, dir);
    const set = (u) => { m.scale.set(1, Math.max(0.001, len * u), 1); m.position.copy(A).addScaledVector(dir, (len * u) / 2); };
    set(0.001);
    return { set, kill() { root.remove(m); m.geometry.dispose(); m.material.dispose(); } };
  }

  // =====================================================================================
  //  cinematic director (owns camera + letterbox while playing; game.js skips ctrl.update meanwhile)
  // =====================================================================================
  const ui = document.createElement('div');
  ui.style.cssText = 'position:fixed;inset:0;z-index:26;pointer-events:none;font-family:ui-monospace,Menlo,monospace';
  ui.innerHTML = '<div data-t></div><div data-b></div><div data-c></div><div data-f></div><div data-s></div><div data-k></div><div data-card></div>';
  document.body.appendChild(ui);
  const el = {};
  for (const k of ['t', 'b', 'c', 'f', 's', 'k', 'card']) el[k] = ui.querySelector(`[data-${k}]`);
  Object.assign(el.t.style, { position: 'absolute', left: '0', right: '0', top: '0', height: '11vh', background: '#000', transform: 'translateY(-100%)', transition: 'transform .6s' });
  Object.assign(el.b.style, { position: 'absolute', left: '0', right: '0', bottom: '0', height: '11vh', background: '#000', transform: 'translateY(100%)', transition: 'transform .6s' });
  Object.assign(el.c.style, { position: 'absolute', left: '0', right: '0', bottom: '13vh', textAlign: 'center', color: '#ffe3a0', textShadow: '0 2px 14px #000', opacity: '0', transition: 'opacity .5s' });
  Object.assign(el.f.style, { position: 'absolute', inset: '0', background: '#000', opacity: '0', transition: 'opacity .4s' });
  Object.assign(el.s.style, { position: 'absolute', inset: '0', background: 'radial-gradient(transparent 38%, rgba(150,0,0,.85))', opacity: '0' });
  Object.assign(el.k.style, { position: 'absolute', right: '18px', bottom: 'calc(11vh + 10px)', color: '#cfd8e3', font: '700 11px ui-monospace,monospace', letterSpacing: '.2em', opacity: '0', transition: 'opacity .5s' });
  el.k.textContent = 'E · SKIP';
  Object.assign(el.card.style, { position: 'absolute', left: '50%', top: '14vh', transform: 'translateX(-50%)', maxWidth: 'min(560px,88vw)', padding: '14px 20px', background: 'rgba(8,12,18,.86)', border: '1px solid rgba(255,194,71,.6)', color: '#ffe3a0', textAlign: 'center', opacity: '0', transition: 'opacity .6s' });
  const bars = (on) => { el.t.style.transform = on ? 'none' : 'translateY(-100%)'; el.b.style.transform = on ? 'none' : 'translateY(100%)'; };
  function fade(o, ms = 400, color = '#000') { el.f.style.transition = `opacity ${ms}ms`; el.f.style.background = color; el.f.style.opacity = String(o); }
  function caption(cap, sub) {
    if (!cap) { el.c.style.opacity = '0'; return; }
    el.c.innerHTML = `<div style="font:700 12px ui-monospace,monospace;letter-spacing:.4em;opacity:.75">${cap}</div><div style="font:800 26px ui-monospace,monospace;letter-spacing:.2em;margin-top:6px">${sub || ''}</div>`;
    el.c.style.opacity = '1';
  }
  function showCard(head, title, text) {
    el.card.innerHTML = `<div style="font:700 11px ui-monospace,monospace;letter-spacing:.35em;opacity:.7">${head}</div><div style="font:800 20px ui-monospace,monospace;letter-spacing:.14em;margin:6px 0">${title}</div><div style="font:600 14px system-ui,sans-serif;color:#cfd8e3">${text}</div>`;
    el.card.style.opacity = '1';
    clearTimeout(showCard.h); showCard.h = setTimeout(() => { el.card.style.opacity = '0'; }, 12000);
  }

  const cine = { on: false, q: [], i: -1, t: 0, age: 0, speed: 1, done: null, vm: true, pm: false };
  function playCine(shots, onDone) {
    if (cine.on) return;
    Object.assign(cine, { on: true, q: shots, i: -1, t: 0, age: 0, speed: 1, done: onDone || null });
    cine.vm = viewmodel ? viewmodel.visible : true; cine.pm = playerMesh ? playerMesh.visible : false;
    if (viewmodel) viewmodel.visible = false;
    if (playerMesh) playerMesh.visible = false;
    const inp = hooks.getInput && hooks.getInput(); if (inp && inp.clear) inp.clear();
    bars(true); el.k.style.opacity = '0.8';
    nextShot();
  }
  function nextShot() {
    cine.i++; cine.t = 0;
    const s = cine.q[cine.i];
    if (!s) { endCine(false); return; }
    if (s.fade !== undefined) fade(s.fade, s.fadeMs ?? 400, s.fadeColor);
    caption(s.cap, s.sub);
    if (s.on) { try { s.on(); } catch (e) { console.error('[classified]', e); } }
  }
  function endCine(aborted) {
    cine.on = false; cine.speed = 1; bars(false); caption(null); el.k.style.opacity = '0';
    camera.fov = hooks.getFov ? hooks.getFov() : 75; camera.updateProjectionMatrix();
    if (viewmodel) viewmodel.visible = cine.vm;
    if (playerMesh) playerMesh.visible = cine.pm;
    const inp = hooks.getInput && hooks.getInput(); if (inp && inp.clear) inp.clear();
    fade(0, 500);
    const d = cine.done; cine.done = null;
    if (d && !aborted) d();
  }
  function applyShot(s) {
    const u0 = clamp(cine.t / s.d, 0, 1);
    const u = s.ez === 'in' ? u0 * u0 * u0 : s.ez === 'out' ? 1 - (1 - u0) ** 3 : u0 < 0.5 ? 4 * u0 ** 3 : 1 - (-2 * u0 + 2) ** 3 / 2;
    const a = s.a, b = s.b || s.a, la = s.la, lb = s.lb || s.la, sh = s.shake || 0;
    camera.position.set(a[0] + (b[0] - a[0]) * u + (rnd() - 0.5) * sh, a[1] + (b[1] - a[1]) * u + (rnd() - 0.5) * sh, a[2] + (b[2] - a[2]) * u + (rnd() - 0.5) * sh);
    camera.lookAt(la[0] + (lb[0] - la[0]) * u, la[1] + (lb[1] - la[1]) * u, la[2] + (lb[2] - la[2]) * u);
    const f0 = s.f0 || 70;
    camera.fov = f0 + ((s.f1 ?? f0) - f0) * u; camera.updateProjectionMatrix();
  }
  function stepCine(dt, interact) {
    cine.age += dt;
    if (interact && cine.age > 1.2 && cine.speed === 1) { cine.speed = 24; el.k.style.opacity = '0'; }
    let rem = dt * cine.speed;
    while (cine.on && rem > 0) {
      const s = cine.q[cine.i], step = Math.min(rem, s.d - cine.t);
      cine.t += step; rem -= step;
      if (cine.t >= s.d - 1e-6) nextShot();
    }
    if (cine.on) applyShot(cine.q[cine.i]);
  }

  // =====================================================================================
  //  progress
  // =====================================================================================
  function complete(id) {
    if (done.has(id)) return;
    done.add(id); store.set('classified', [...done]);
    if (done.size >= CLASSIFIED_TOTAL) { finale(); return; }
    const f = FILES[id];
    showCard(`CLASSIFIED ${done.size}/${CLASSIFIED_TOTAL} · FILE 0${f.n}`, f.title, f.hint);
  }
  function trigger(id, shots) { if (done.has(id) || cine.on || br.on) return; playCine(shots(), () => complete(id)); }

  // =====================================================================================
  //  01 HOOK: annex roof (grapple blade)
  // =====================================================================================
  const HX = -47, HZ = 33, ROOF = 7.0;
  const hatchA = box(darkM, X(HX), Y(ROOF + 0.06), Z(HZ - 0.75), 3, 0.12, 1.5);
  const hatchB = box(darkM, X(HX), Y(ROOF + 0.06), Z(HZ + 0.75), 3, 0.12, 1.5);
  glow(0x2fb7ff, X(HX), Y(ROOF + 0.02), Z(HZ), 3.4, 0.03, 3.4);
  glow(0x2fb7ff, X(HX), Y(ROOF + 0.02), Z(25.3), 19, 0.03, 0.08); // the only hint from the hall: a faint seam on the roof lip
  const hbeam = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 8, 16, 1, true), addM(0x7fd8ff, 0.5));
  hbeam.visible = false; root.add(hbeam);
  if (done.has('hook')) { hatchA.position.z -= 1.4; hatchB.position.z += 1.4; }
  act({ x: X(HX), z: Z(HZ), y: ROOF, r: 2.6, off: () => done.has('hook'), prompt: () => ({ text: 'E — Open the hatch', sub: '', progress: 0 }), run: () => { trigger('hook', cineHook); return null; } });
  const cineHook = () => [
    { d: 2.6, a: W(HX, 11, 41), b: W(HX, 9.2, 37), la: W(HX, ROOF, HZ), f0: 62, f1: 50, cap: 'FILE 01', sub: 'THE EYE ABOVE',
      on() { tween(2.4, (u) => { hatchA.position.z = Z(HZ - 0.75) - u * 1.4; hatchB.position.z = Z(HZ + 0.75) + u * 1.4; }); ring(X(HX), Y(ROOF + 0.1), Z(HZ), 0x7fd8ff, 6, 1.8); } },
    { d: 2.2, a: W(HX + 1.2, ROOF + 0.5, HZ + 2.2), b: W(HX + 0.6, ROOF + 0.3, HZ + 0.8), la: W(HX, ROOF + 6, HZ), lb: W(HX + 0.01, ROOF + 9, HZ), f0: 72, f1: 98,
      on() { hbeam.visible = true; tween(1.6, (u) => { hbeam.scale.y = Math.max(0.01, u); hbeam.position.set(X(HX), Y(ROOF) + 4 * u, Z(HZ)); }); } },
    { d: 2.4, a: W(HX, ROOF + 1, HZ + 0.01), b: W(HX + 8, 13.4, HZ - 12), la: W(HX, ROOF + 8, HZ), lb: W(-20, 1, 6), f0: 80, f1: 60,
      on() { burst(X(HX), Y(14), Z(HZ), 0x7fd8ff, 40, 6, 2); } },
  ];

  // =====================================================================================
  //  02 DASH: floating island across a 12 m gap (wisp phase dash)
  // =====================================================================================
  const AX1 = -22.8, IX = AX1 + TUNE.gap + 1.2, IZ = 50, ITOP = 4.0;
  for (let i = 0; i < 5; i++) solid(baseM, X(-35 + i * 1.6), Y(0), Z(IZ), 1.6, 0.8 * (i + 1), 3, 1.5);
  solid(baseM, X(-25.3), Y(0), Z(IZ), 5, ITOP, 4, 1.5);
  glow(0xb56bff, X(-25.3), Y(ITOP + 0.02), Z(IZ), 4.6, 0.03, 3.6);
  solid(baseM, X(IX), Y(ITOP - 0.7), Z(IZ), 2.4, 0.7, 2.4, 1.5);
  glow(0xb56bff, X(IX), Y(ITOP + 0.02), Z(IZ), 2.0, 0.03, 2.0);
  const mist = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.1, 9, 12, 1, true), addM(0xb56bff, 0.07));
  mist.position.set(X(IX), Y(ITOP + 4.5), Z(IZ)); root.add(mist);
  const isl = { t: 0 };
  const cineDash = () => [
    { d: 2.8, a: W(IX + 8, 7, IZ + 8), b: W(IX - 4, 6, IZ + 9), la: W(IX, ITOP + 0.8, IZ), f0: 60, f1: 52, cap: 'FILE 02', sub: 'NOTHING SOLID STOPS YOU',
      on() { ring(X(IX), Y(ITOP + 0.1), Z(IZ), 0xb56bff, 9, 2.2); ring(X(IX), Y(ITOP + 0.1), Z(IZ), 0x6ad0ff, 5, 1.6); } },
    { d: 2.4, a: W(IX + 1, 5.6, IZ + 3), b: W(IX - 1, 5.2, IZ + 0.5), la: W(IX - 6, ITOP + 1, IZ), lb: W(AX1 - 3, ITOP + 1, IZ), f0: 70, f1: 86,
      on() {
        const gh = [];
        for (let i = 0; i < 14; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.45, 10, 8), addM(0xb56bff, 0)); m.position.set(X(AX1 + (TUNE.gap * i) / 13), Y(ITOP + 1), Z(IZ)); root.add(m); gh.push(m); }
        tween(2.2, (u) => gh.forEach((m, i) => { const k = clamp(u * 16 - i, 0, 1); m.material.opacity = 0.8 * Math.sin(k * PI); m.scale.setScalar(0.6 + k); }),
          () => gh.forEach((m) => { root.remove(m); m.geometry.dispose(); m.material.dispose(); }));
      } },
    { d: 1.6, a: W(AX1 - 6, 8, IZ + 10), b: W(IX, 9, IZ + 10), la: W(IX, ITOP, IZ), f0: 60, f1: 60, on() { burst(X(IX), Y(ITOP + 1), Z(IZ), 0xb56bff, 40, 5, 3); } },
  ];

  // =====================================================================================
  //  03 ECHO: Sentinel Pulse Scan reveals 5 sigils
  // =====================================================================================
  const SIG = [[-32, 6.5, -39.3, 0], [55.3, 3.0, 28, -PI / 2], [-12, 2.2, 39.3, PI], [55.3, 8.0, -12, -PI / 2], [-55.3, 7.0, 2, PI / 2]];
  const sigTex = tex2(128, 128, (g) => {
    g.strokeStyle = '#ff7a3c'; g.lineWidth = 8;
    g.beginPath(); g.moveTo(64, 10); g.lineTo(118, 64); g.lineTo(64, 118); g.lineTo(10, 64); g.closePath(); g.stroke();
    g.beginPath(); g.arc(64, 64, 18, 0, PI * 2); g.stroke();
    g.fillStyle = '#ffd2a0'; g.beginPath(); g.arc(64, 64, 7, 0, PI * 2); g.fill();
  });
  const sc = { t: 0, hit: new Set(), pl: [] };
  const hideSig = () => sc.pl.forEach((s) => { s.m.visible = false; setColliderActive(s.col, false); });
  sc.pl = SIG.map(([x, y, z, ry], i) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), new THREE.MeshBasicMaterial({ map: sigTex, transparent: true, toneMapped: false, side: THREE.DoubleSide, depthWrite: false }));
    m.position.set(X(x), Y(y), Z(z)); m.rotation.y = ry; m.visible = false; root.add(m);
    const side = Math.abs(Math.sin(ry)) > 0.5;
    const col = addCollider(X(x), Z(z), side ? 0.35 : 1.2, Y(y) + 0.6, side ? 1.2 : 0.35, { y0: Y(y) - 0.6, noCover: true });
    setColliderActive(col, false);
    col.onShot = () => {
      if (sc.t <= 0 || sc.hit.has(i)) return;
      sc.hit.add(i); m.visible = false; setColliderActive(col, false);
      burst(X(x), Y(y), Z(z), 0xff7a3c, 20, 4, 2);
      note(`ECHO ${sc.hit.size}/${SIG.length}`, '');
      if (sc.hit.size === SIG.length) { sc.t = 0; hideSig(); trigger('scan', cineScan); }
    };
    return { m, col };
  });
  function hookAbility(id, cb) { // wraps an ability's use() so the lobby can react to it (installed before the first use)
    const cur = ABILITIES[id];
    if (!cur) return;
    if (cur.__cls) { cur.__cls.cb = cb; return; }
    const holder = { cb };
    const wrapped = (A) => {
      const h = cur(A);
      if (!h || !h.use) return h;
      const use = h.use;
      h.use = function () { const r = use.apply(this, arguments); if (r !== false) { try { holder.cb(A); } catch (_) { /* never break the ability */ } } return r; };
      return h;
    };
    wrapped.__cls = holder; ABILITIES[id] = wrapped;
  }
  const inLobby = (p) => Math.abs(p.x - L.x) < 100 && Math.abs(p.z - L.z) < 80 && p.y > L.y - 10 && p.y < L.y + 40;
  hookAbility('scan', (A) => {
    if (done.has('scan') || cine.on || br.on || !inLobby(A.player)) return;
    sc.t = TUNE.scanWindow; sc.hit.clear();
    sc.pl.forEach((s) => { s.m.visible = true; setColliderActive(s.col, true); });
    note('ECHOES REVEALED', `${SIG.length} sigils · ${TUNE.scanWindow}s`);
  });
  const cineScan = () => {
    const core = W(ctx.CX, ctx.H0, ctx.CZ), lines = [];
    return [
      { d: 2.6, a: W(4, 12, 12), b: W(10, 8, 6), la: core, f0: 62, f1: 54, cap: 'FILE 03', sub: 'THE SENTINEL SEES',
        on() {
          sc.pl.forEach((s, i) => { s.m.visible = true; const b = beam(W(SIG[i][0], SIG[i][1], SIG[i][2]), core, 0xff7a3c, 0.07); lines.push(b); });
          tween(2.2, (u) => lines.forEach((b) => b.set(u)));
        } },
      { d: 2.6, a: W(10, 4, -2), b: W(-2, 5, -10), la: core, f0: 56, f1: 50, on() { ring(core[0], core[1] - 2.4, core[2], 0xff7a3c, 10, 2); burst(core[0], core[1], core[2], 0xff9a5c, 40, 6, 2); } },
      { d: 1.8, a: W(4, 4, -6.01), b: W(4, 14, -6.01), la: W(4, 40, -6), f0: 70, f1: 90, on() { lines.forEach((b) => b.kill()); sc.pl.forEach((s) => { s.m.visible = false; }); } },
    ];
  };

  // =====================================================================================
  //  04 CIPHER: pylon colour code (outside), reverse entry at the east kiosk
  // =====================================================================================
  const PYL = [[-78, -58, 0x2fe0ff], [78, -58, 0xffc247], [78, 58, 0xff5ad8], [-78, 58, 0x6aff7a]];
  const PLATE_ORDER = [1, 3, 0, 2]; // plate j on the kiosk shows pylon colour PLATE_ORDER[j]
  const sig4 = PYL.map(([px, pz, c]) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.7, 14, 12), basic({ color: c, transparent: true, opacity: 0.18 }));
    m.position.set(X(px + (px < 0 ? 2.4 : -2.4)), Y(27), Z(pz + (pz < 0 ? 2.4 : -2.4))); root.add(m);
    const halo = new THREE.Mesh(new THREE.SphereGeometry(2.4, 12, 10), addM(c, 0)); m.add(halo);
    return { m, halo };
  });
  const KX = 72, KZ = 8;
  solid(darkM, X(KX), Y(0), Z(KZ), 0.5, 2.6, 4.6, 1);
  put(sign('WHAT THE CORNERS SAY', 'answer backwards', 3.8, 0.7, 0x9fb3c8), X(KX - 0.28), Y(2.3), Z(KZ), -PI / 2);
  const ci = { i: 0, t: 0 };
  const plates = PLATE_ORDER.map((pi, j) => {
    const z = KZ - 1.65 + j * 1.1, c = PYL[pi][2];
    const m = glow(c, X(KX - 0.31), Y(1.45), Z(z), 0.1, 0.8, 0.8);
    const col = addCollider(X(KX - 0.36), Z(z), 0.25, Y(1.9), 0.9, { y0: Y(1.0), noCover: true });
    col.onShot = () => press(pi, z, c);
    return { m };
  });
  function press(pi, z, c) {
    if (done.has('cipher') || cine.on) return;
    ci.t = T;
    burst(X(KX - 0.5), Y(1.45), Z(z), c, 10, 3, 1.5);
    const want = [...TUNE.seq].reverse()[ci.i];
    if (pi === want) {
      ci.i++;
      if (ci.i >= TUNE.seq.length) { ci.i = 0; trigger('cipher', cineCipher); } else note(`CIPHER ${ci.i}/${TUNE.seq.length}`, '');
    } else { ci.i = 0; note('CIPHER RESET', 'wrong colour'); burst(X(KX - 0.5), Y(1.45), Z(z), 0xff3030, 14, 3, 1.5); }
  }
  const cineCipher = () => {
    const bs = [], top = W(0, 112, 0);
    return [
      { d: 2.4, a: W(KX - 6, 2, KZ), b: W(KX - 3, 2.2, KZ), la: W(KX, 1.4, KZ), f0: 62, f1: 50, cap: 'FILE 04', sub: 'THE CORNERS SPEAK', on() { plates.forEach((p) => burst(p.m.position.x, p.m.position.y, p.m.position.z, 0xffffff, 8, 3, 1)); } },
      { d: 3.2, a: W(KX - 5, 2, KZ), b: W(KX - 5, 2, KZ), la: W(KX + 8, 8, 30), lb: W(0, 70, 0), f0: 70, f1: 84,
        on() { PYL.forEach(([px, pz, c], i) => bs.push(beam([sig4[i].m.position.x, sig4[i].m.position.y, sig4[i].m.position.z], top, c, 0.35))); tween(3, (u) => bs.forEach((b) => b.set(u))); } },
      { d: 2.2, a: W(60, 60, 60), b: W(40, 72, 40), la: W(0, 100, 0), f0: 70, f1: 60, on() { burst(top[0], top[1], top[2], 0xffffff, 60, 14, 0); ring(top[0], top[1], top[2], 0xffffff, 40, 1.8); },
        } ,
    ];
  };

  // =====================================================================================
  //  07 GHOST: loadout on the dais
  // =====================================================================================
  const GHOST = { main: 'spectre', side: 'wisp', melee: 'katana', utility: 'drone' };
  const gh = { t: 0 };
  const cineGhost = () => {
    const core = W(ctx.CX, ctx.H0, ctx.CZ);
    return [
      { d: 3.0, a: W(12, 3, 2), b: W(4, 4.2, 8), la: core, f0: 64, f1: 52, cap: 'FILE 07', sub: 'THE GHOST LOADOUT',
        on() { ring(core[0], core[1] - 2.5, core[2], 0xdff1ff, 12, 2.4); ring(core[0], core[1] - 2.5, core[2], 0xb56bff, 8, 1.8); } },
      { d: 2.6, a: W(4, 5.5, -15), b: W(4, 3.8, -9.6), la: core, f0: 56, f1: 40, on() { burst(core[0], core[1], core[2], 0xdff1ff, 60, 7, 2); tween(2, (u) => ring(core[0], core[1] - 2.5 + u * 0, core[2], 0xffffff, 4 + u * 10, 0.9) ); } },
    ];
  };

  // =====================================================================================
  //  05 FLAWLESS / 06 LANTERNS (read the lobby's own state)
  // =====================================================================================
  const fl = { live: false, clean: true, last: 0 };
  const cineFlawless = () => [
    { d: 2.8, a: W(17, 3, 0), b: W(30, 2.2, 0), la: W(46, 2.6, 0), f0: 66, f1: 50, cap: 'FILE 05', sub: 'NOT ONE FRIEND LOST',
      on() { for (let z = -10; z <= 10; z += 4) burst(X(45), Y(1.8), Z(z), 0xffd23f, 22, 6, 3); } },
    { d: 2.6, a: W(30, 2.2, 0), b: W(20, 9, 0), la: W(46, 4, 0), f0: 50, f1: 70, on() { for (let i = 0; i < 6; i++) burst(X(45 + (rnd() - 0.5) * 8), Y(6 + rnd() * 3), Z((rnd() - 0.5) * 20), 0xffe9a0, 20, 4, 1); } },
  ];
  const lp = ctx.orbs.map(() => ({ was: false, at: -999 }));
  const cineLanterns = () => {
    const to = new THREE.Vector3(X(ctx.CX), Y(ctx.H0), Z(ctx.CZ));
    return [
      { d: 3.4, a: W(16, 6, 6), b: W(-8, 6, 6), la: [to.x, to.y + 1, to.z], f0: 66, f1: 56, cap: 'FILE 06', sub: 'FOURTEEN LIGHTS, ONE BREATH',
        on() {
          ctx.orbs.forEach((o, i) => {
            const m = new THREE.Mesh(new THREE.SphereGeometry(0.28, 10, 8), addM(i % 2 ? 0x2fb7ff : 0x3dff9a, 0.95));
            const s0 = o.m.position.clone(); m.position.copy(s0); root.add(m);
            tween(2.6 + (i % 4) * 0.12, (u) => { const k = u * u * (3 - 2 * u); m.position.lerpVectors(s0, to, k); m.position.y += Math.sin(u * PI) * 2.5; m.scale.setScalar(1 - 0.5 * u); },
              () => { burst(to.x, to.y, to.z, 0xdff6ff, 6, 3, 1); root.remove(m); m.geometry.dispose(); m.material.dispose(); });
          });
        } },
      { d: 2.2, a: W(ctx.CX + 2, ctx.H0 + 0.5, ctx.CZ + 5), b: W(ctx.CX + 0.5, ctx.H0 + 0.2, ctx.CZ + 2.4), la: [to.x, to.y, to.z], f0: 52, f1: 36, on() { ring(to.x, to.y - 2.4, to.z, 0xdff6ff, 12, 1.6); burst(to.x, to.y, to.z, 0xffffff, 50, 8, 2); } },
    ];
  };

  // =====================================================================================
  //  08 BACKROOMS
  // =====================================================================================
  const BR = { n: 9, S: 5, H: 3.4, T: 0.45, x: L.x + 640, y: L.y, z: L.z, seed: 1990117 };
  const NOOK = { x: -36.6, z: 39.1 };
  const br = { built: false, on: false, g: null, cols: [], open: null, start: null, exit: null, ent: null, t: 0, esc: [], flick: 0, door: null, fog: null, prevFog: null, x0: BR.x - (BR.n * BR.S) / 2, z0: BR.z - (BR.n * BR.S) / 2 };
  const DIRS = [['n', 0, -1, 's'], ['e', 1, 0, 'w'], ['s', 0, 1, 'n'], ['w', -1, 0, 'e']];
  const cellPos = (cx, cy) => [br.x0 + (cx + 0.5) * BR.S, br.z0 + (cy + 0.5) * BR.S];
  const cellOf = (x, z) => [clamp(Math.floor((x - br.x0) / BR.S), 0, BR.n - 1), clamp(Math.floor((z - br.z0) / BR.S), 0, BR.n - 1)];
  function mulberry(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function genMaze() {
    const n = BR.n, r = mulberry(BR.seed);
    const o = Array.from({ length: n }, () => Array.from({ length: n }, () => ({ n: 0, e: 0, s: 0, w: 0 })));
    const seen = Array.from({ length: n }, () => Array(n).fill(false));
    const st = [[0, 0]]; seen[0][0] = true;
    while (st.length) {
      const [x, y] = st[st.length - 1];
      const nb = DIRS.filter(([, dx, dy]) => { const nx = x + dx, ny = y + dy; return nx >= 0 && ny >= 0 && nx < n && ny < n && !seen[ny][nx]; });
      if (!nb.length) { st.pop(); continue; }
      const [d, dx, dy, opp] = nb[Math.floor(r() * nb.length)];
      o[y][x][d] = 1; o[y + dy][x + dx][opp] = 1; seen[y + dy][x + dx] = true; st.push([x + dx, y + dy]);
    }
    for (let k = 0; k < n * n * 0.22; k++) { // knock a few extra doors so there are loops to run around
      const x = Math.floor(r() * n), y = Math.floor(r() * n), [d, dx, dy, opp] = DIRS[Math.floor(r() * 4)], nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue;
      o[y][x][d] = 1; o[ny][nx][opp] = 1;
    }
    return o;
  }
  function distsFrom(from) {
    const n = BR.n, d = Array.from({ length: n }, () => Array(n).fill(-1)), q = [from];
    d[from[1]][from[0]] = 0;
    while (q.length) {
      const [x, y] = q.shift();
      for (const [k, dx, dy] of DIRS) if (br.open[y][x][k]) { const nx = x + dx, ny = y + dy; if (d[ny][nx] < 0) { d[ny][nx] = d[y][x] + 1; q.push([nx, ny]); } }
    }
    return d;
  }
  function pathTo(a, b) {
    const n = BR.n, par = Array.from({ length: n }, () => Array(n).fill(null)), q = [a];
    par[a[1]][a[0]] = a;
    while (q.length) {
      const [x, y] = q.shift();
      if (x === b[0] && y === b[1]) break;
      for (const [k, dx, dy] of DIRS) if (br.open[y][x][k]) { const nx = x + dx, ny = y + dy; if (!par[ny][nx]) { par[ny][nx] = [x, y]; q.push([nx, ny]); } }
    }
    const out = []; let c = b;
    if (!par[b[1]][b[0]]) return out;
    while (!(c[0] === a[0] && c[1] === a[1])) { out.push(c); c = par[c[1]][c[0]]; }
    return out.reverse();
  }
  function makeEntity() {
    const g = new THREE.Group(), blk = new THREE.MeshBasicMaterial({ color: 0x060606 }), eye = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });
    const part = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); g.add(o); return o; };
    part(new THREE.BoxGeometry(0.16, 1.15, 0.16), blk, -0.14, 0.58, 0); part(new THREE.BoxGeometry(0.16, 1.15, 0.16), blk, 0.14, 0.58, 0);
    part(new THREE.BoxGeometry(0.5, 0.95, 0.26), blk, 0, 1.6, 0);
    g.userData.armL = part(new THREE.BoxGeometry(0.09, 1.3, 0.09), blk, -0.34, 1.35, 0);
    g.userData.armR = part(new THREE.BoxGeometry(0.09, 1.3, 0.09), blk, 0.34, 1.35, 0);
    part(new THREE.SphereGeometry(0.2, 12, 10), blk, 0, 2.3, 0);
    part(new THREE.BoxGeometry(0.07, 0.05, 0.02), eye, -0.08, 2.34, 0.18); part(new THREE.BoxGeometry(0.07, 0.05, 0.02), eye, 0.08, 2.34, 0.18);
    part(new THREE.BoxGeometry(0.2, 0.025, 0.02), eye, 0, 2.24, 0.19);
    return g;
  }
  function buildBR() {
    if (br.built) return;
    br.built = true;
    const n = BR.n, S = BR.S, size = n * S;
    br.open = genMaze();
    br.g = new THREE.Group(); br.g.visible = false; root.add(br.g);
    br.fog = new THREE.Fog(0x201a06, 1.5, 30);
    const wallM = new THREE.MeshBasicMaterial({ map: tex2(256, 256, (g, w, h) => {
      g.fillStyle = '#b7a548'; g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 32) { g.fillStyle = 'rgba(110,90,25,.35)'; g.fillRect(x, 0, 10, h); g.fillStyle = 'rgba(240,225,150,.16)'; g.fillRect(x + 12, 0, 4, h); }
      for (let i = 0; i < 26; i++) { const x = rnd() * w, y = rnd() * h, r = 10 + rnd() * 40, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(70,50,10,.22)'); gr.addColorStop(1, 'rgba(70,50,10,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
      g.fillStyle = 'rgba(60,45,10,.5)'; g.fillRect(0, h - 18, w, 18);
    }) });
    const floorM = new THREE.MeshBasicMaterial({ map: tex2(128, 128, (g, w, h) => {
      g.fillStyle = '#8f7b34'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 900; i++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '40,30,5' : '200,180,90'},${rnd() * 0.18})`; g.fillRect(rnd() * w, rnd() * h, 2, 2); }
    }, [size / 3, size / 3]) });
    const ceilM = new THREE.MeshBasicMaterial({ map: tex2(128, 128, (g, w, h) => {
      g.fillStyle = '#d2c88e'; g.fillRect(0, 0, w, h); g.strokeStyle = 'rgba(90,80,40,.6)'; g.lineWidth = 3; g.strokeRect(0, 0, w, h);
    }, [size / 1.2, size / 1.2]) });
    const flo = new THREE.Mesh(new THREE.PlaneGeometry(size + 2, size + 2), floorM); flo.rotation.x = -PI / 2; flo.position.set(BR.x, BR.y + 0.01, BR.z); br.g.add(flo);
    const cei = new THREE.Mesh(new THREE.PlaneGeometry(size + 2, size + 2), ceilM); cei.rotation.x = PI / 2; cei.position.set(BR.x, BR.y + BR.H, BR.z); br.g.add(cei); // faces DOWN: invisible from above, so the fall passes straight through
    br.cols.push(addCollider(BR.x, BR.z, size + 4, BR.y, size + 4, { y0: BR.y - 2, noCover: true }));
    br.cols.push(addCollider(BR.x, BR.z, size + 4, BR.y + BR.H + 1, size + 4, { y0: BR.y + BR.H, noCover: true }));
    const wall = (cx, cz, w, d) => {
      const m = new THREE.Mesh(unit, wallM); m.scale.set(w, BR.H, d); m.position.set(cx, BR.y + BR.H / 2, cz); br.g.add(m);
      br.cols.push(addCollider(cx, cz, w, BR.y + BR.H, d, { y0: BR.y, noCover: true }));
    };
    const lightM = new THREE.MeshBasicMaterial({ color: 0xfff4c0, fog: false });
    for (let cy = 0; cy < n; cy++) for (let cx = 0; cx < n; cx++) {
      const [x, z] = cellPos(cx, cy), o = br.open[cy][cx];
      if (!o.s) wall(x, z + S / 2, S + BR.T, BR.T);
      if (!o.e) wall(x + S / 2, z, BR.T, S + BR.T);
      if (cy === 0) wall(x, z - S / 2, S + BR.T, BR.T);
      if (cx === 0) wall(x - S / 2, z, BR.T, S + BR.T);
      const l = new THREE.Mesh(unit, lightM); l.scale.set(1.6, 0.05, 0.6); l.position.set(x, BR.y + BR.H - 0.03, z); br.g.add(l);
    }
    const ds = distsFrom([0, 0]);
    br.start = [0, 0];
    let best = null; // exit = the farthest dead end
    for (let cy = 0; cy < n; cy++) for (let cx = 0; cx < n; cx++) {
      const o = br.open[cy][cx], c = o.n + o.e + o.s + o.w;
      if (c === 1 && (!best || ds[cy][cx] > best.d)) best = { cx, cy, d: ds[cy][cx] };
    }
    br.exit = [best.cx, best.cy];
    const eo = br.open[best.cy][best.cx], od = DIRS.find(([k]) => eo[k]), back = DIRS.find(([k]) => k === od[3]);
    const [ex, ez] = cellPos(best.cx, best.cy), dx = back[1] * (S / 2 - 0.4), dz = back[2] * (S / 2 - 0.4);
    const horiz = back[1] === 0;
    const door = new THREE.Mesh(unit, new THREE.MeshBasicMaterial({ color: 0xcfffd8, fog: false }));
    door.scale.set(horiz ? 2.2 : 0.12, 2.8, horiz ? 0.12 : 2.2); door.position.set(ex + dx, BR.y + 1.4, ez + dz); br.g.add(door);
    const halo = new THREE.Mesh(unit, addM(0x7affb0, 0.25)); halo.scale.set(horiz ? 3.4 : 0.2, 3.6, horiz ? 0.2 : 3.4); halo.position.copy(door.position); br.g.add(halo);
    const exitSign = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.45), new THREE.MeshBasicMaterial({ map: tex2(256, 80, (g, w, h) => { g.fillStyle = '#0a3'; g.fillRect(0, 0, w, h); g.fillStyle = '#eaffef'; g.font = '800 54px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('EXIT', w / 2, h / 2 + 3); }), fog: false, side: THREE.DoubleSide }));
    exitSign.position.set(door.position.x - back[1] * 0.1, BR.y + 3.1, door.position.z - back[2] * 0.1); exitSign.rotation.y = horiz ? (back[2] > 0 ? PI : 0) : (back[1] > 0 ? -PI / 2 : PI / 2); br.g.add(exitSign);
    br.door = { x: ex + dx, z: ez + dz, pos: door.position };
    // the stalker: starts about 45% of the way along the longest route
    let pick = null;
    for (let cy = 0; cy < n; cy++) for (let cx = 0; cx < n; cx++) {
      const d = ds[cy][cx];
      if (d < 8 || (cx === best.cx && cy === best.cy)) continue;
      const score = Math.abs(d - best.d * 0.45);
      if (!pick || score < pick.s) pick = { cx, cy, s: score };
    }
    const g = makeEntity(); br.g.add(g);
    br.ent = { g, x: 0, z: 0, state: 'patrol', goal: null, path: [], repath: 0, lost: 0, spawn: [pick.cx, pick.cy] };
  }
  function enterBR(p) {
    buildBR();
    br.prevFog = scene.fog; scene.fog = br.fog;
    br.g.visible = true; br.cols.forEach((c) => setColliderActive(c, true));
    const [sx, sz] = cellPos(...br.start), o = br.open[br.start[1]][br.start[0]], d = DIRS.find(([k]) => o[k]);
    ctx.teleport(p, sx, BR.y + 0.05, sz);
    p.yaw = d[0] === 'n' ? 0 : d[0] === 's' ? PI : d[0] === 'e' ? -PI / 2 : PI / 2; p.pitch = 0;
    const e = br.ent, [ex, ez] = cellPos(...e.spawn);
    Object.assign(e, { x: ex, z: ez, state: 'patrol', goal: null, path: [], lost: 0 });
    e.g.position.set(ex, BR.y, ez);
  }
  function leaveBR(p) {
    br.on = false; if (br.g) br.g.visible = false;
    br.cols.forEach((c) => setColliderActive(c, false));
    if (br.prevFog !== null) { scene.fog = br.prevFog; br.prevFog = null; }
    el.s.style.opacity = '0';
    if (p) { ctx.teleport(p, X(-34.6), Y(0.05), Z(36.4)); p.yaw = 0; p.pitch = 0; }
  }
  function tickBR(dt, p, interact) {
    const e = br.ent;
    if (!br.on || !e) return;
    br.t += dt;
    if (interact) { br.esc.push(T); br.esc = br.esc.filter((x) => T - x < 1.8); if (br.esc.length >= 3) { loseBR(true); return; } } // triple-E = wake up (failsafe)
    br.flick -= dt;
    if (br.flick <= 0 && rnd() < dt * 0.12) br.flick = 0.28;
    br.fog.far = br.flick > 0 ? 6 : 30;
    const dx = p.x - e.x, dz = p.z - e.z, d = Math.hypot(dx, dz) || 0.001;
    let see = false;
    if (d < 24) see = !raycastWorld(e.x, BR.y + 1.4, e.z, dx / d, 0, dz / d, d);
    if (see || (p.sprinting && d < 18) || d < 6) { e.state = 'chase'; e.lost = 5; } else if (e.state === 'chase' && (e.lost -= dt) <= 0) e.state = 'patrol';
    const ec = cellOf(e.x, e.z), pc = cellOf(p.x, p.z);
    if (e.state === 'patrol' && (!e.goal || (ec[0] === e.goal[0] && ec[1] === e.goal[1]))) e.goal = [Math.floor(rnd() * BR.n), Math.floor(rnd() * BR.n)];
    e.repath -= dt;
    if (e.repath <= 0) { e.repath = 0.35; e.path = pathTo(ec, e.state === 'chase' ? pc : e.goal); }
    const spd = e.state === 'chase' ? Math.min(5.4, 3.7 + br.t / 160) : 2.1;
    let tx = e.x, tz = e.z;
    if (e.state === 'chase' && pc[0] === ec[0] && pc[1] === ec[1]) { tx = p.x; tz = p.z; } else if (e.path.length) [tx, tz] = cellPos(...e.path[0]);
    const mx = tx - e.x, mz = tz - e.z, md = Math.hypot(mx, mz);
    if (md > 0.05) { const st = Math.min(md, spd * dt); e.x += (mx / md) * st; e.z += (mz / md) * st; e.g.rotation.y = Math.atan2(mx, mz); }
    if (e.path.length && md < 0.25) e.path.shift();
    e.g.position.set(e.x, BR.y, e.z);
    e.g.userData.armL.rotation.x = Math.sin(T * 5) * 0.5; e.g.userData.armR.rotation.x = -Math.sin(T * 5) * 0.5;
    const prox = clamp((18 - d) / 18, 0, 1);
    el.s.style.opacity = (prox * prox * 0.85 + (e.state === 'chase' ? 0.08 : 0)).toFixed(2);
    p.shake = Math.max(p.shake || 0, prox * prox * 0.035);
    if (d < 1.2) { loseBR(false); return; }
    if (Math.hypot(p.x - br.door.x, p.z - br.door.z) < 1.8) winBR(p);
  }
  const wakeShot = (cap, sub) => ({ d: 2.4, a: W(-31, 3.4, 31), b: W(-34, 2.2, 35.5), la: W(NOOK.x + 0.2, 1.2, NOOK.z - 0.2), f0: 64, f1: 56, cap, sub, fade: 0, fadeMs: 900 });
  function loseBR(woke) {
    const p = P, e = br.ent;
    br.on = false; el.s.style.opacity = '0';
    const eye = [p.x, p.y + 1.6, p.z], shots = [];
    if (!woke) shots.push({ d: 1.0, a: eye, la: [e.x, BR.y + 2.1, e.z], f0: 80, f1: 46, shake: 0.14, on() { el.s.style.opacity = '1'; } });
    shots.push({ d: 1.1, a: eye, la: [e.x, BR.y + 2.1, e.z], f0: 46, fade: 1, fadeMs: 250, on() { leaveBR(p); } });
    shots.push(wakeShot('YOU WOKE UP', 'it is still down there'));
    playCine(shots, () => note('Back in the lobby', 'face the corner and jump to try again'));
  }
  function winBR(p) {
    br.on = false; el.s.style.opacity = '0';
    const dp = br.door.pos, eye = [p.x, p.y + 1.6, p.z];
    playCine([
      { d: 2.4, a: eye, b: [dp.x, dp.y + 0.4, dp.z], la: [dp.x, dp.y, dp.z], f0: 70, f1: 90, cap: 'FILE 08', sub: 'THE WAY OUT', fade: 1, fadeMs: 2200, fadeColor: '#eafff0' },
      { d: 1.2, a: eye, la: [dp.x, dp.y, dp.z], fade: 1, fadeColor: '#eafff0', on() { leaveBR(p); } },
      wakeShot('FILE 08', 'THE WAY OUT'),
    ], () => complete('backrooms'));
  }
  const cineBackrooms = () => {
    buildBR();
    const p = P, cx = X(NOOK.x), cz = Z(NOOK.z), [sx, sz] = cellPos(...br.start), sy = BR.y;
    const o = br.open[br.start[1]][br.start[0]], d = DIRS.find(([k]) => o[k]);
    return [
      { d: 2.6, a: [p.x, p.y + 1.6, p.z], b: [cx + 0.3, p.y + 1.55, cz - 0.3], la: [cx, p.y + 1.3, cz], f0: 74, f1: 56, shake: 0.03,
        on() { fade(0, 100); tween(2.4, (u) => { el.f.style.background = `rgba(210,190,70,${(u * u * 0.5).toFixed(2)})`; el.f.style.opacity = '1'; }); } },
      { d: 2.8, a: [cx + 0.3, p.y + 1.5, cz - 0.3], b: [cx + 0.3, L.y - 70, cz - 0.3], la: [cx, p.y + 0.5, cz], lb: [X(-20), Y(40), Z(20)], f0: 70, f1: 100, ez: 'in', shake: 0.05, fade: 0, fadeMs: 200,
        on() { el.f.style.background = '#000'; el.f.style.opacity = '0'; } },
      { d: 1.0, a: [cx, L.y - 70, cz], la: [cx, L.y - 200, cz], fade: 1, fadeMs: 300, fadeColor: '#b9a640' },
      { d: 3.4, a: [sx, sy + 20, sz], b: [sx, sy + 1.65, sz], la: [sx + 0.01, sy - 5, sz], lb: [sx + d[1] * 4, sy + 1.5, sz + d[2] * 4], f0: 84, f1: 70, ez: 'out', fade: 0, fadeMs: 1200, fadeColor: '#000',
        on() { enterBR(p); tween(3.4, () => {}, () => { br.on = true; br.t = 0; br.esc = []; showCard('???', 'FIND THE EXIT', 'Do not let it catch you. Tap E three times to wake up.'); }); } },
    ];
  };
  const jw = { g: true, j: [] };

  // =====================================================================================
  //  reward altar + finale
  // =====================================================================================
  let altar = null;
  function buildAltar() {
    if (altar) return;
    const x = -1, z = 35.5, y0 = 4.4;
    solid(darkM, X(x), Y(y0), Z(z), 2.2, 0.55, 2.2, 1);
    glow(0xffb25a, X(x), Y(y0 + 0.57), Z(z), 2.0, 0.04, 2.0);
    const holder = new THREE.Group(); holder.position.set(X(x), Y(y0 + 1.7), Z(z)); root.add(holder);
    const def = ALL[REWARD.id];
    if (def) holder.add(ctx.getModel(def, 1.6, 'cls:'));
    put(sign('EVENT HORIZON', 'classified · all eight recovered', 4.6, 0.9, 0xffb25a), X(x), Y(y0 + 3.3), Z(z), PI);
    act({
      x: X(x), z: Z(z), y: y0, r: 2.4,
      prompt: () => ({ text: loadout[REWARD.slot] === REWARD.id ? 'Event Horizon — equipped' : 'E — Equip Event Horizon', sub: 'PRIMARY · CLASSIFIED', progress: 0 }),
      run: () => {
        if (loadout[REWARD.slot] === REWARD.id) return null;
        grant(); burst(X(x), Y(y0 + 1.8), Z(z), 0xffb25a, 24, 4.5, 3);
        return { type: 'equip', slot: REWARD.slot, id: REWARD.id };
      },
    });
    altar = { holder };
  }
  function grant() {
    setSlot(REWARD.slot, REWARD.id);
    ctx.refresh();
    if (hooks.onEquip) hooks.onEquip(REWARD.slot, REWARD.id);
    note('EVENT HORIZON EQUIPPED', 'primary slot');
  }
  function finale() {
    const bs = [], ax = W(-1, 5.6, 35.5);
    playCine([
      { d: 2.6, a: W(-34, 9, 6), b: W(-14, 12, 14), la: ax, f0: 62, f1: 55, cap: 'ALL EIGHT FILES', sub: 'ARCHIVE UNSEALED',
        on() { ORDER.forEach((id, i) => { const a = (i / 8) * PI * 2; bs.push(beam(W(-1 + Math.cos(a) * 14, 14.4, 20 + Math.sin(a) * 6), ax, [0x2fb7ff, 0xb56bff, 0xff7a3c, 0xffc247, 0xff4a5e, 0x3dff9a, 0xdff1ff, 0xffd23f][i], 0.1)); }); tween(2.4, (u) => bs.forEach((b) => b.set(u))); } },
      { d: 2.8, a: W(9, 7.5, 28), b: W(3, 6.2, 31.5), la: ax, f0: 58, f1: 48,
        on() { bs.forEach((b) => b.kill()); buildAltar(); altar.holder.scale.setScalar(0.001); tween(2.4, (u) => altar.holder.scale.setScalar(Math.max(0.001, u))); ring(ax[0], Y(4.5), ax[2], 0xffb25a, 9, 2); burst(ax[0], ax[1], ax[2], 0xffb25a, 60, 7, 3); } },
      { d: 2.6, a: W(1.6, 5.9, 32.8), b: W(0.4, 6.1, 34.3), la: W(-1, 6.1, 35.5), f0: 50, f1: 38 },
    ], () => { grant(); showCard('CLASSIFIED 8/8', 'EVENT HORIZON', 'Equipped as your primary. It waits on the altar in the lounge whenever you swap away.'); });
  }
  if (done.size >= CLASSIFIED_TOTAL) buildAltar();

  // =====================================================================================
  //  the corner hint (faint flicker) + per-frame logic
  // =====================================================================================
  const seamM = basic({ color: 0xd4c25a, transparent: true, opacity: 0.1 });
  const seamA = new THREE.Mesh(unit, seamM); seamA.scale.set(0.06, 1.2, 0.02); seamA.position.set(X(-35.9), Y(0.6), Z(39.47)); root.add(seamA);
  const seamB = new THREE.Mesh(unit, seamM); seamB.scale.set(0.02, 1.2, 0.06); seamB.position.set(X(-36.97), Y(0.6), Z(38.9)); root.add(seamB);

  function ambient(dt) {
    // pylon code
    const ph = (T % 24) - 3;
    sig4.forEach((s, i) => {
      let lvl = 0.18;
      if (ph >= 0) { const k = Math.floor(ph / 1.5); if (k < TUNE.seq.length && TUNE.seq[k] === i && ph % 1.5 < 0.9) lvl = 1; }
      s.m.material.opacity = lvl; s.halo.material.opacity = lvl > 0.5 ? 0.5 : 0; s.m.scale.setScalar(lvl > 0.5 ? 1.6 : 1);
    });
    if (ci.i > 0 && T - ci.t > 15) ci.i = 0;
    seamM.opacity = 0.05 + (Math.sin(T * 7) > 0.6 || Math.sin(T * 2.3) > 0.97 ? 0.35 : 0.04);
    mist.material.opacity = 0.06 + 0.03 * Math.sin(T * 1.5);
    if (!cine.on) hbeam.visible = false;
    if (sc.t > 0) { sc.t -= dt; sc.pl.forEach((s) => { if (s.m.visible) s.m.material.opacity = 0.6 + 0.4 * Math.sin(T * 12); }); if (sc.t <= 0) { hideSig(); if (sc.hit.size < SIG.length && !done.has('scan')) note('The echoes fade', ''); } }
    if (altar) altar.holder.rotation.y = T * 0.6;
  }
  function detect(dt, p) {
    // 01: mantle assist, so a grapple that ends right at the roof lip lands you on the roof
    if (!done.has('hook') && p.weaponId === 'hookblade' && !p.onGround && p.x > X(-58) && p.x < X(-36) && p.z > Z(21) && p.z < Z(25.6) && p.y > Y(4.6) && p.y < Y(8.6) && (p.velY || 0) > -2) {
      p.x = clamp(p.x, X(-56), X(-38)); p.z = Z(27.4); p.y = Y(ROOF) + 0.1; p.velY = 0; p.vx = 0; p.vz = 0;
      burst(p.x, p.y + 1, p.z, 0x7fd8ff, 16, 3, 2);
    }
    // 02: standing on the island
    if (!done.has('dash') && Math.abs(p.x - X(IX)) < 1.3 && Math.abs(p.z - Z(IZ)) < 1.3 && Math.abs(p.y - Y(ITOP)) < 0.7) { isl.t += dt; if (isl.t > 1) trigger('dash', cineDash); } else isl.t = 0;
    // 05: flawless gallery
    if (ctx.gal.on) { if (!fl.live) { fl.live = true; fl.clean = true; fl.last = 0; } if (ctx.gal.score < fl.last) fl.clean = false; fl.last = ctx.gal.score; }
    else if (fl.live) { fl.live = false; if (fl.clean && fl.last >= TUNE.flawless) trigger('flawless', cineFlawless); }
    // 06: lanterns
    ctx.orbs.forEach((o, i) => { const popped = o.respawn > 0; if (popped && !lp[i].was) lp[i].at = T; lp[i].was = popped; });
    if (!done.has('lanterns') && lp.every((s) => T - s.at <= TUNE.lanternWindow)) trigger('lanterns', cineLanterns);
    // 07: ghost loadout on the dais
    const onDais = Math.hypot(p.x - X(ctx.CX), p.z - Z(ctx.CZ)) < 2.6 && p.y > Y(0.2) && p.y < Y(2.4);
    if (!done.has('ghost') && onDais && Object.keys(GHOST).every((k) => loadout[k] === GHOST[k])) {
      gh.t += dt;
      if (rnd() < dt * 24) { const a = rnd() * PI * 2; spark(X(ctx.CX) + Math.cos(a) * 1.8, p.y + 0.2, Z(ctx.CZ) + Math.sin(a) * 1.8, 0, 1.5 + gh.t, 0, 0xdff1ff, 0.9, 0, 1.4); }
      if (gh.t >= TUNE.ghostHold) { gh.t = 0; trigger('ghost', cineGhost); }
    } else gh.t = Math.max(0, gh.t - dt * 2);
    // 08: face the corner under the lounge and jump
    if (!done.has('backrooms')) {
      const cx = X(NOOK.x), cz = Z(NOOK.z), air = !p.onGround;
      if (Math.hypot(p.x - cx, p.z - cz) < 1.3 && p.y < Y(1)) {
        const want = Math.atan2(-(cx - p.x), -(cz - p.z)), dy = Math.atan2(Math.sin(p.yaw - want), Math.cos(p.yaw - want));
        if (Math.abs(dy) < 0.75) {
          if (jw.g && air && (p.velY || 0) > 3) jw.j.push(T);
          jw.j = jw.j.filter((x) => T - x < 9);
          if (jw.j.length >= TUNE.jumps) { jw.j = []; trigger('backrooms', cineBackrooms); }
        }
      } else if (jw.j.length) jw.j = jw.j.filter((x) => T - x < 9);
      jw.g = !!p.onGround;
    }
  }

  /** returns true while a cutscene owns the camera */
  function update(dt, p, interact, active) {
    T += dt; P = p;
    tickFx(dt * (cine.on ? cine.speed : 1));
    if (cine.on) stepCine(dt, interact);
    ambient(dt);
    if (br.on && p) tickBR(dt, p, interact);
    if (active && p && p.alive && !cine.on && !br.on) detect(dt, p);
    return cine.on;
  }
  function abort() {
    if (cine.on) endCine(true);
    if (br.on || (br.g && br.g.visible)) leaveBR(P);
  }

  return { update, abort, cutsceneOn: () => cine.on, count: () => done.size };
}
