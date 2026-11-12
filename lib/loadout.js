/** Persisted loadout: main, secondary, melee, utility */
import './weaponsPlus.js'; // registers the special weapons BEFORE the saved loadout is validated
import { cleanLoadout, DEFAULT_LOADOUT, SLOTS } from './arsenal.js';

const KEY = 'realmrange.loadout.v2';
export const loadout = { ...DEFAULT_LOADOUT };
try { Object.assign(loadout, cleanLoadout(JSON.parse(localStorage.getItem(KEY) || '{}'))); } catch (_) {}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(loadout)); } catch (_) {}
}

export function setSlot(slot, id) {
  Object.assign(loadout, cleanLoadout({ ...loadout, [slot]: id }));
  save();
  return loadout[slot];
}

/** 'main.side.melee' (sent to the server) */
export const loadoutString = () => SLOTS.map((s) => loadout[s]).join('.');
