/** Keyboard / mouse / touch. Exposes: keys, stick, firing, consumeLook(), consumeInteract(), consumeCmds(), clear() */
import { applyLayout } from './layout.js';
import { settings } from './settings.js';
import { canon } from './keybinds.js';

export function createInput(canvas, hooks) {
  const {
    isTouch, getPlayer, isActive, onReload, onToggleCamera, onAim, onToggleBuild, onBuildTier, onQuickMelee, onDigit, onScroll,
  } = hooks;
  const keys = new Set(), stick = { x: 0, y: 0 }, look = { dx: 0, dy: 0 };
  const cmds = []; // build commands for the player controller: 'piece:wall' | 'piece:floor' | 'piece:ramp' | 'editDown' | 'editUp'
  let mouseDown = false, touchFire = false, tapUntil = 0, lookDX = 0, lookDY = 0, interact = false, lastWheel = 0;

  const now = () => performance.now();
  const locked = () => document.pointerLockElement === canvas;
  const typing = () => {
    const a = document.activeElement;
    return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA');
  };
  // a click shorter than one frame still fires one shot (the controller buffers it)
  const tap = () => { tapUntil = now() + 55; };

  function lookBy(dx, dy, k) {
    const p = getPlayer();
    const s = k * settings.sens * (p.lookScale || 1);
    p.yaw -= dx * s;
    p.pitch -= dy * s * (settings.invertY ? -1 : 1);
    p.pitch = Math.max(-1.3, Math.min(1.3, p.pitch));
    lookDX += dx;
    lookDY += dy;
  }

  function clear() {
    keys.clear();
    cmds.length = 0;
    mouseDown = false; touchFire = false; tapUntil = 0; interact = false;
    stick.x = stick.y = 0;
    const base = document.getElementById('stickBase');
    if (base) base.classList.remove('on');
  }

  // ---------- keyboard ----------
  addEventListener('keydown', (e) => {
    if (typing() || !isActive()) return;
    if (e.code === 'Space' || e.code === 'Tab' || e.code.startsWith('Arrow')) e.preventDefault();
    const code = canon(e.code);
    if (!code) return;
    keys.add(code);
    if (e.repeat) return;
    switch (code) {
      case 'KeyR': onReload(); break;
      case 'KeyV': onToggleCamera(); break;
      case 'KeyQ': onToggleBuild(); break;
      case 'KeyY': onBuildTier(); break;
      case 'KeyG': cmds.push('editDown'); break;
      case 'KeyZ': cmds.push('piece:wall'); break;
      case 'KeyX': cmds.push('piece:floor'); break;
      case 'KeyB': cmds.push('piece:ramp'); break;
      case 'KeyF': onQuickMelee(); break;
      case 'KeyE': interact = true; break;
      default: if (/^Digit[1-9]$/.test(code)) onDigit(+code.slice(5) - 1);
    }
  });
  addEventListener('keyup', (e) => {
    const c = canon(e.code);
    if (!c) return;
    keys.delete(c);
    if (c === 'KeyG') cmds.push('editUp');
  });
  addEventListener('blur', clear);

  // ---------- mouse ----------
  canvas.addEventListener('click', () => {
    if (!isTouch && !locked() && isActive()) { try { canvas.requestPointerLock(); } catch (_) {} }
  });
  addEventListener('mousedown', (e) => {
    if (isTouch || !locked()) return;
    if (e.button === 0) { mouseDown = true; tap(); }
    else if (e.button === 2) { e.preventDefault(); onAim(true); }
  });
  addEventListener('mouseup', (e) => {
    if (e.button === 0) mouseDown = false;
    else if (e.button === 2) onAim(false);
  });
  addEventListener('contextmenu', (e) => e.preventDefault());
  addEventListener('mousemove', (e) => {
    if (!locked() || !isActive()) return;
    if (Math.abs(e.movementX) > 350 || Math.abs(e.movementY) > 350) return;
    lookBy(e.movementX, e.movementY, 0.0022);
  });
  addEventListener('wheel', (e) => {
    if (!locked() || !isActive()) return;
    e.preventDefault();
    if (now() - lastWheel < 120 || !e.deltaY) return;
    lastWheel = now();
    onScroll(e.deltaY > 0 ? 1 : -1);
  }, { passive: false });
  document.addEventListener('pointerlockchange', () => { if (!locked()) mouseDown = false; });

  // ---------- touch ----------
  const $ = (id) => document.getElementById(id);
  const zone = $('moveZone'), base = $('stickBase'), knob = $('stickKnob'), lz = $('lookZone');
  let mId = null, mx = 0, my = 0, lId = null, lx = 0, ly = 0;
  const R = 52;

  function moveTo(t) {
    let dx = t.clientX - mx, dy = t.clientY - my;
    const m = Math.hypot(dx, dy);
    if (m > R) { dx = (dx / m) * R; dy = (dy / m) * R; }
    stick.x = dx / R;
    stick.y = dy / R;
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    if (stick.y < -0.8 && Math.hypot(stick.x, stick.y) > 0.95) keys.add('ShiftLeft'); else keys.delete('ShiftLeft');
  }

  if (zone) {
    zone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (mId !== null) return;
      const t = e.changedTouches[0];
      mId = t.identifier; mx = t.clientX; my = t.clientY;
      base.style.left = mx + 'px';
      base.style.top = my + 'px';
      base.classList.add('on');
      moveTo(t);
    }, { passive: false });
    zone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) if (t.identifier === mId) moveTo(t);
    }, { passive: false });
  }
  if (lz) {
    lz.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (lId !== null) return;
      const t = e.changedTouches[0];
      lId = t.identifier; lx = t.clientX; ly = t.clientY;
    }, { passive: false });
    lz.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (!isActive()) return;
      for (const t of e.changedTouches) {
        if (t.identifier !== lId) continue;
        lookBy(t.clientX - lx, t.clientY - ly, 0.0045);
        lx = t.clientX; ly = t.clientY;
      }
    }, { passive: false });
  }
  function endTouch(e) {
    for (const t of e.changedTouches) {
      if (t.identifier === mId) {
        mId = null;
        stick.x = stick.y = 0;
        keys.delete('ShiftLeft');
        if (base) base.classList.remove('on');
        if (knob) knob.style.transform = '';
      }
      if (t.identifier === lId) lId = null;
    }
  }
  addEventListener('touchend', endTouch);
  addEventListener('touchcancel', endTouch);

  function bind(id, down, up) {
    const b = $(id);
    if (!b) return;
    b.addEventListener('touchstart', (e) => { e.preventDefault(); b.classList.add('down'); if (isActive() && down) down(); }, { passive: false });
    const end = (e) => { e.preventDefault(); b.classList.remove('down'); if (up) up(); };
    b.addEventListener('touchend', end, { passive: false });
    b.addEventListener('touchcancel', end, { passive: false });
  }

  // EDIT button (created here so index.html doesn't need to change). Sits above BUILD, uses the same .mb touch-button style.
  const mob = $('mobile');
  if (mob && !$('btnEdit')) {
    const css = document.createElement('style');
    css.textContent = '#btnEdit{right:146px;bottom:calc(240px + var(--sb));width:52px;height:52px;border-color:rgba(255,122,200,.8)}';
    document.head.appendChild(css);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mb';
    b.id = 'btnEdit';
    b.textContent = 'EDIT';
    mob.appendChild(b);
    applyLayout(); // restore saved position for btnEdit (created after first applyLayout)
  }

  bind('btnFire', () => { touchFire = true; tap(); }, () => { touchFire = false; });
  bind('btnAim', () => onAim(true), () => onAim(false));
  bind('btnReload', () => onReload());
  bind('btnJump', () => keys.add('Space'), () => keys.delete('Space'));
  bind('btnCam', () => onToggleCamera());
  bind('btnSwap', () => onScroll(1));
  bind('btnMelee', () => onQuickMelee());
  bind('btnBuild', () => onToggleBuild());
  bind('btnEdit', () => cmds.push('editDown'), () => cmds.push('editUp')); // tap = edit / confirm, hold = quick edit (release confirms)
  bind('btnUse', () => { interact = true; });
  bind('btnCrouch', () => {
    if (keys.has('KeyC')) keys.delete('KeyC'); else keys.add('KeyC');
    $('btnCrouch').classList.toggle('on', keys.has('KeyC'));
  });

  return {
    keys,
    stick,
    get firing() { return mouseDown || touchFire || now() < tapUntil; },
    consumeLook() {
      look.dx = lookDX;
      look.dy = lookDY;
      lookDX = lookDY = 0;
      return look;
    },
    consumeInteract() { const v = interact; interact = false; return v; },
    consumeCmds() { if (!cmds.length) return null; const c = cmds.slice(); cmds.length = 0; return c; },
    clear,
  };
}
