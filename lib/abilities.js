/**
 * Ability system for the special weapons. The aim button fires the weapon's ability instead of scoping.
 * Handlers live in the pack files and register into registry.ABILITIES as (A) => handler.
 * Each frame the handlers write into `mods`, which player.js reads (fire rate, recoil, spread, speed, damage, pierce...).
 */
import { ABILITIES } from './registry.js';

export function createAbilities(deps) {
  const { hud, isMulti } = deps;
  const A = { ...deps, msg: (t, ms = 1000) => hud.setMsg(t, ms) };
  const mods = { fireCd: 1, recoil: 1, spread: 1, speed: 1, dmg: 1, noAmmo: false, pierce: false };
  const inst = {}, cdT = {}, cdMax = {};
  let queued = null, queueT = 0, deniedAt = 0, pill = null, txt = null, bar = null;

  const get = (id) => {
    if (!(id in inst)) inst[id] = ABILITIES[id] ? ABILITIES[id](A) : null;
    return inst[id];
  };
  function deny(msg) {
    const now = performance.now();
    if (now - deniedAt > 500) { deniedAt = now; hud.setMsg(msg, 900); }
    return null;
  }
  /** returns the handler if the ability can be used right now (shows a message otherwise) */
  function canUse(id) {
    const h = get(id);
    if (!h) return null;
    if (h.solo && isMulti()) return deny('Not synced online yet');
    if ((cdT[id] || 0) > 0) return deny(`${h.name} ${Math.ceil(cdT[id])}s`);
    return h;
  }
  function start(id, h) {
    if (h.use() === false) return false;
    cdT[id] = cdMax[id] = h.cd;
    return true;
  }
  const use = (id) => { const h = canUse(id); return h ? start(id, h) : false; };

  // melee abilities ride on the swing animation: queue now, fire on the 'swing' or 'hit' event
  const queue = (id) => { queued = id; queueT = 1.5; };
  const clearQueue = () => { queued = null; };
  /** phase = 'swing' | 'hit'. Returns true when the normal melee hit should be skipped. */
  function fire(phase) {
    if (!queued) return false;
    const h = get(queued);
    if (!h || (h.on || 'swing') !== phase) return false;
    const id = queued;
    queued = null;
    start(id, h);
    return !!h.replaceHit;
  }

  function update(dt) {
    mods.fireCd = mods.recoil = mods.spread = mods.speed = mods.dmg = 1;
    mods.noAmmo = mods.pierce = false;
    for (const id in cdT) if (cdT[id] > 0) cdT[id] = Math.max(0, cdT[id] - dt);
    for (const id in inst) if (inst[id] && inst[id].update) inst[id].update(dt, mods);
    if (queued && (queueT -= dt) <= 0) queued = null;
  }
  /** incoming damage goes through every active shield / parry; returns what is left */
  function absorb(dmg) {
    for (const id in inst) if (dmg > 0 && inst[id] && inst[id].absorb) dmg = inst[id].absorb(dmg);
    return dmg;
  }
  function reset() { queued = null; for (const id in inst) if (inst[id] && inst[id].reset) inst[id].reset(); }
  function onRespawn() { reset(); for (const id in cdT) cdT[id] = 0; }

  function buildPill() {
    pill = document.createElement('div');
    pill.style.cssText = 'position:fixed;left:50%;bottom:calc(112px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:20;'
      + 'pointer-events:none;min-width:150px;padding:5px 12px 7px;border-radius:4px;background:rgba(10,14,20,.72);'
      + 'border:1px solid rgba(255,194,71,.55);color:#ffe3a0;font:800 11px ui-monospace,monospace;letter-spacing:.12em;'
      + 'text-transform:uppercase;text-align:center;display:none';
    txt = document.createElement('div');
    const track = document.createElement('div');
    track.style.cssText = 'height:3px;margin-top:4px;background:rgba(255,255,255,.18)';
    bar = document.createElement('div');
    bar.style.cssText = 'height:100%;background:#ffc247';
    track.append(bar);
    pill.append(txt, track);
    document.body.append(pill);
  }
  /** small cooldown pill above the hotbar; pass the equipped weapon def (or null to hide) */
  function ui(def) {
    const id = def && def.ability, h = id ? get(id) : null;
    if (!h) { if (pill) pill.style.display = 'none'; return; }
    if (!pill) buildPill();
    const left = cdT[id] || 0, st = h.status ? h.status() : '';
    pill.style.display = 'block';
    txt.textContent = `${h.name} · ${st || (left > 0 ? Math.ceil(left) + 's' : 'READY')}`;
    bar.style.width = `${left > 0 ? (1 - left / (cdMax[id] || h.cd)) * 100 : 100}%`;
    pill.style.opacity = left > 0 && !st ? 0.6 : 1;
  }

  return { mods, canUse, use, queue, clearQueue, fire, update, absorb, reset, onRespawn, ui };
}
