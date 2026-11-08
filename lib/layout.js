/** Mobile layout editor: drag buttons, resize them, saved per device */
const KEY = 'realmrange.layout.v1';
const IDS = ['btnFire', 'btnAim', 'btnJump', 'btnReload', 'btnCrouch', 'btnSwap', 'btnMelee', 'btnBuild', 'btnEdit', 'btnUse', 'btnCam', 'btnPause', 'btnRec'];
let L = {};
try { L = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (_) {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(L)); } catch (_) {} };
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function place(id) {
  const e = $(id), l = L[id];
  if (!e) return;
  e.style.cssText = l ? `left:${l.x}%;top:${l.y}%;right:auto;bottom:auto;transform:translate(-50%,-50%) scale(${l.s || 1})` : '';
}
export const applyLayout = () => IDS.forEach(place);

export function editLayout(onDone) {
  let bar = $('layoutBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'layoutBar';
    bar.style.cssText = 'position:fixed;left:50%;bottom:10px;transform:translateX(-50%);z-index:60;display:flex;gap:8px;align-items:center;background:rgba(0,0,0,.78);padding:8px 12px;border-radius:8px;color:#fff;font:700 12px system-ui';
    bar.innerHTML = '<span>Drag · tap to select</span><input id="layoutScale" type="range" min="0.6" max="1.8" step="0.05" value="1"><button id="layoutReset">Reset</button><button id="layoutDone">Done</button>';
    document.body.append(bar);
  }
  const slider = $('layoutScale');
  let sel = null, drag = false;
  bar.style.display = 'flex';
  document.body.classList.add('editing');

  const cur = () => {
    if (!sel) return null;
    if (!L[sel]) {
      const r = $(sel).getBoundingClientRect();
      L[sel] = { x: ((r.left + r.width / 2) / innerWidth) * 100, y: ((r.top + r.height / 2) / innerHeight) * 100, s: 1 };
    }
    return L[sel];
  };
  const start = (e) => {
    const b = e.target.closest && e.target.closest('.mb');
    if (!b) return;
    e.preventDefault();
    e.stopPropagation();
    document.querySelectorAll('.mb.sel').forEach((x) => x.classList.remove('sel'));
    sel = b.id; drag = true;
    b.classList.add('sel');
    slider.value = cur().s || 1;
  };
  const move = (e) => {
    if (!drag || !sel) return;
    e.preventDefault();
    const t = e.touches[0], l = cur();
    l.x = clamp((t.clientX / innerWidth) * 100, 3, 97);
    l.y = clamp((t.clientY / innerHeight) * 100, 3, 97);
    place(sel);
  };
  const end = () => { if (drag) { drag = false; save(); } };
  slider.oninput = () => { const l = cur(); if (l) { l.s = +slider.value; place(sel); save(); } };
  $('layoutReset').onclick = () => { L = {}; save(); applyLayout(); };
  document.addEventListener('touchstart', start, { capture: true, passive: false });
  document.addEventListener('touchmove', move, { passive: false });
  document.addEventListener('touchend', end);
  $('layoutDone').onclick = () => {
    document.removeEventListener('touchstart', start, true);
    document.removeEventListener('touchmove', move);
    document.removeEventListener('touchend', end);
    document.querySelectorAll('.mb.sel').forEach((x) => x.classList.remove('sel'));
    document.body.classList.remove('editing');
    bar.style.display = 'none';
    save();
    if (onDone) onDone();
  };
}
