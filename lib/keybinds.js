/** Rebindable keys. The game reads default ("canonical") key codes; canon() maps the key you pressed onto them. */
const KEY = 'realmrange.keys.v1';
export const ACTIONS = [
  ['forward', 'Move forward', 'KeyW'], ['back', 'Move back', 'KeyS'], ['left', 'Move left', 'KeyA'], ['right', 'Move right', 'KeyD'],
  ['jump', 'Jump', 'Space'], ['crouch', 'Crouch', 'KeyC'], ['sprint', 'Sprint', 'ShiftLeft'], ['reload', 'Reload', 'KeyR'],
  ['melee', 'Quick melee', 'KeyF'], ['build', 'Build mode', 'KeyQ'], ['tier', 'Build material', 'KeyY'], ['use', 'Use / interact', 'KeyE'],
  ['edit', 'Edit build (hold = quick edit)', 'KeyG'], ['bwall', 'Quick wall', 'KeyZ'], ['bfloor', 'Quick floor', 'KeyX'], ['bramp', 'Quick ramp', 'KeyB'],
  ['camera', 'Camera view', 'KeyV'], ['chat', 'Chat', 'KeyT'], ['board', 'Scoreboard', 'Tab'],
  ['s1', 'Weapon 1 / wall', 'Digit1'], ['s2', 'Weapon 2 / floor', 'Digit2'], ['s3', 'Weapon 3 / ramp', 'Digit3'],
];
const DEF = {};
for (const [id, , code] of ACTIONS) DEF[id] = code;
const binds = { ...DEF };
try {
  const stored = JSON.parse(localStorage.getItem(KEY) || '{}');
  // older saves had "Build material" on G; G is now Edit, so move material to Y
  if (stored.tier === 'KeyG' && !stored.edit) stored.tier = 'KeyY';
  Object.assign(binds, stored);
} catch (_) {}
const defaults = new Set(Object.values(DEF));
let map = new Map();
const rebuild = () => { map = new Map(); for (const id in DEF) map.set(binds[id], DEF[id]); };
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(binds)); } catch (_) {} };
rebuild();

/** pressed key code -> the code the game logic expects (null = that default key was rebound elsewhere) */
export const canon = (code) => (map.has(code) ? map.get(code) : defaults.has(code) ? null : code);
export const getBind = (id) => binds[id];
export function setBind(id, code) {
  for (const o in binds) if (o !== id && binds[o] === code) binds[o] = binds[id]; // swap with whoever had it
  binds[id] = code;
  rebuild();
  save();
}
export function resetBinds() { Object.assign(binds, DEF); rebuild(); save(); }
export const keyName = (c) => c.replace(/^Key|^Digit/, '').replace('ShiftLeft', 'L-Shift').replace('ShiftRight', 'R-Shift').replace('ControlLeft', 'L-Ctrl').replace('AltLeft', 'L-Alt');
