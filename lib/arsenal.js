/**
 * Arsenal: stats + animation timelines for every weapon. Pure data (no three.js).
 *
 * Keyframe = { t, a, o, roll, curl }
 *   a: anchor name on the weapon model ('fore','grip','mag','port','handle','string', ...),
 *      'origin' (gun origin) or 'pouch' (vest mag pouch, in rig space)
 *   o: WRIST offset from that anchor, roll / curl: hand rotation + finger curl
 * Reload spec: { total, events:[[t,name]], lh, rh?, tracks:{part:[[t,v]]}, held:[{kind,t0,t1}], mag?:{rel,toss,pouch,ins} }
 * Tracks clamp to their first / last value outside their range.
 */
const PI = Math.PI, R = PI / 2;
const Z = [0, 0, 0];
export const INS = [-0.02, -0.085, 0.04]; // wrist offset that puts a held item exactly on an anchor

const k = (t, a, o = Z, roll = R, curl = 0.9) => ({ t, a, o, roll, curl });
const kr = (t, a, o = Z, roll = -R, curl = 0.95) => ({ t, a, o, roll, curl });
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const IDLE = PI * 0.8;

/** Detachable box magazine: drop it, toss it, grab a fresh one from the vest, seat it, rack / release. */
function boxMag(T, c) {
  const s = (f) => +(T * f).toFixed(3);
  const S = c.seat, D = c.drop;
  const at = (x, y, z) => [S[0] + x, S[1] + y, S[2] + z];
  const clear = at(-0.005, -D, 0.03);
  const lh = [
    k(0, 'fore', Z, IDLE, 0.6),
    k(s(0.13), 'mag', at(-0.055, -0.05, -0.02), R, 0.15),
    k(s(0.18), 'mag', at(0.005, -0.01, 0.02)),
    k(s(0.25), 'mag', at(0.005, -D * 0.3, 0.02)),
    k(s(0.34), 'mag', clear),
    k(s(0.37), 'mag', add(clear, [-0.16, 0.04, -0.08]), R, 0.7),
    k(s(0.4), 'mag', add(clear, [-0.33, 0.07, -0.18]), R, 0.1),
    k(s(0.46), 'pouch', [0, 0.06, 0], R, 0.15),
    k(s(0.51), 'pouch'),
    k(s(0.56), 'pouch', [0.02, 0.1, -0.05]),
    k(s(0.64), 'mag', at(-0.005, -D * 0.58, 0.01)),
    k(s(0.68), 'mag', S),
    k(s(0.72), 'mag', at(-0.045, 0.01, 0.01), R, 0.2),
  ];
  const ev = [[s(0.175), 'magRelease'], [s(0.245), 'magOut'], [s(0.4), 'toss'], [s(0.51), 'pouch'], [s(0.685), 'magIn']];
  const tracks = {}, rh = [];
  const rk = c.rack;
  if (rk && rk.hand === 'L') {
    const h = rk.o || Z, p = rk.pull;
    lh.push(
      k(s(0.76), 'handle', h, R, 0.85),
      k(s(0.81), 'handle', add(h, p)),
      k(s(0.86), 'handle', h),
      k(s(0.9), 'handle', add(h, [-0.01, -0.025, -0.03]), R, 0.2));
    tracks[rk.part] = [[0, 0], [s(0.77), 0], [s(0.81), 1], [s(0.835), 1], [s(0.86), 0], [T, 0]];
    ev.push([s(0.81), 'boltBack'], [s(0.856), 'boltFwd']);
  } else if (rk && rk.hand === 'R') {
    const h = rk.o, p = rk.pull;
    lh.push(k(s(0.8), 'fore', Z, IDLE, 0.6));
    rh.push(kr(s(0.72), 'grip'), kr(s(0.77), 'handle', h), kr(s(0.82), 'handle', add(h, p)),
      kr(s(0.86), 'handle', add(h, p)), kr(s(0.9), 'handle', h), kr(s(0.95), 'grip'));
    tracks[rk.part] = [[0, 0], [s(0.77), 0], [s(0.82), 1], [s(0.86), 1], [s(0.9), 0], [T, 0]];
    ev.push([s(0.82), 'boltBack'], [s(0.9), 'boltFwd']);
  } else if (c.release) {
    lh.push(k(s(0.8), 'fore', Z, IDLE, 0.6));
    tracks[c.release] = [[0, 0], [s(0.68), 0], [s(0.7), 1], [s(0.74), 1], [s(0.77), 0], [T, 0]];
    ev.push([s(0.77), 'boltFwd']);
  }
  lh.push(k(T, 'fore', Z, IDLE, 0.6));
  return {
    total: T, events: ev, lh, rh: rh.length ? rh : null, tracks, held: [],
    mag: { rel: s(0.175), toss: s(0.4), pouch: s(0.51), ins: s(0.685) },
  };
}

/** Pump shotgun: shells one at a time, pump at the end. n = shells missing. */
const SG = { start: 0.5, per: 0.62, end: 0.6 };
function shellsSpec(n) {
  const total = +(SG.start + n * SG.per + SG.end).toFixed(3);
  const lh = [k(0, 'fore', Z, IDLE, 0.6), k(SG.start * 0.6, 'fore', [-0.02, -0.03, 0], R, 0.3)];
  const ev = [], held = [];
  for (let i = 0; i < n; i++) {
    const t0 = SG.start + i * SG.per;
    lh.push(
      k(t0 + 0.05, 'pouch', [0, 0.05, 0], R, 0.2),
      k(t0 + 0.18, 'pouch'),
      k(t0 + 0.3, 'pouch', [0.02, 0.1, -0.05]),
      k(t0 + 0.44, 'port', [INS[0] - 0.03, INS[1] - 0.07, INS[2] + 0.03]),
      k(t0 + 0.52, 'port', INS),
      k(t0 + 0.58, 'port', [INS[0] - 0.03, INS[1] - 0.03, INS[2]], R, 0.3));
    ev.push([t0 + 0.18, 'pouch'], [t0 + 0.53, 'shellIn']);
    held.push({ kind: 'shell', t0: t0 + 0.18, t1: t0 + 0.53 });
  }
  const te = SG.start + n * SG.per;
  lh.push(k(te + 0.12, 'fore', Z, R, 0.85), k(te + 0.3, 'fore', [0, 0, 0.12]), k(te + 0.46, 'fore'),
    k(total, 'fore', Z, IDLE, 0.6));
  ev.push([te + 0.3, 'pumpBack'], [te + 0.46, 'pumpFwd']);
  return { total, events: ev, lh, tracks: { pump: [[0, 0], [te + 0.12, 0], [te + 0.3, 1], [te + 0.46, 0], [total, 0]] }, held };
}

const HUNTER_BOLT = [0.03, -0.04, 0.06];
const HUNTER_PULL = [0.03, -0.04, 0.16];
const HUNTER = {
  total: 4.0,
  events: [[0.95, 'boltBack'], [1.1, 'eject'], [1.55, 'pouch'], [2.65, 'shellIn'], [3.15, 'boltFwd'], [3.35, 'boltLock']],
  lh: [
    k(0, 'fore', Z, IDLE, 0.6), k(1.2, 'fore', Z, IDLE, 0.6),
    k(1.35, 'pouch', [0, 0.05, 0], R, 0.2), k(1.55, 'pouch'), k(1.75, 'pouch', [0.02, 0.1, -0.05]),
    k(2.2, 'port', [INS[0] - 0.04, INS[1] - 0.08, INS[2] + 0.04]),
    k(2.65, 'port', INS), k(2.85, 'port', [INS[0] - 0.04, INS[1] - 0.04, INS[2]], R, 0.3),
    k(3.1, 'fore', Z, IDLE, 0.6), k(4.0, 'fore', Z, IDLE, 0.6),
  ],
  rh: [
    kr(0.45, 'grip'), kr(0.7, 'handle', HUNTER_BOLT), kr(0.8, 'handle', HUNTER_BOLT), kr(0.95, 'handle', HUNTER_PULL),
    kr(3.0, 'handle', HUNTER_PULL), kr(3.15, 'handle', HUNTER_BOLT), kr(3.35, 'handle', HUNTER_BOLT), kr(3.7, 'grip'),
  ],
  tracks: { bolt: [[0, 0], [0.72, 0], [0.82, 0.2], [0.95, 1], [3.0, 1], [3.15, 0.2], [3.3, 0], [4, 0]] },
  held: [{ kind: 'round', t0: 1.55, t1: 2.65 }],
};

const CYL_PUSH = [-0.05, -0.01, 0.03];
const REVOLVER = {
  total: 3.2,
  events: [[0.55, 'cylOut'], [0.9, 'eject'], [1.3, 'pouch'], [2.0, 'speedIn'], [2.55, 'cylIn']],
  lh: [
    k(0, 'fore', Z, IDLE, 0.6),
    k(0.35, 'port', [-0.09, -0.02, 0.04], R, 0.3),
    k(0.5, 'port', CYL_PUSH, R, 0.9),
    k(0.8, 'port', [-0.06, -0.04, 0.03]),
    k(1.1, 'pouch', [0, 0.05, 0], R, 0.2),
    k(1.3, 'pouch'),
    k(1.5, 'pouch', [0.02, 0.1, -0.05]),
    k(1.8, 'port', [INS[0] - 0.03, INS[1] - 0.08, INS[2] + 0.03]),
    k(2.0, 'port', INS),
    k(2.2, 'port', [INS[0] - 0.02, INS[1] - 0.03, INS[2] + 0.01], R, 0.3),
    k(2.5, 'port', CYL_PUSH, R, 0.9),
    k(2.9, 'port', [-0.09, -0.02, 0.04], R, 0.3),
    k(3.2, 'fore', Z, IDLE, 0.6),
  ],
  tracks: { cyl: [[0, 0], [0.4, 0], [0.55, 1], [2.45, 1], [2.6, 0], [3.2, 0]] },
  held: [{ kind: 'speed', t0: 1.3, t1: 2.2 }],
};

const SAWN = {
  total: 2.4,
  events: [[0.55, 'open'], [0.85, 'eject'], [1.2, 'pouch'], [1.7, 'shellIn'], [1.95, 'shellIn'], [2.15, 'close']],
  lh: [
    k(0, 'fore', Z, IDLE, 0.6),
    k(0.5, 'fore', [0, -0.01, 0], R, 0.9),
    k(0.65, 'fore', [0, -0.07, 0.01]),
    k(1.0, 'pouch', [0, 0.05, 0], R, 0.2),
    k(1.2, 'pouch'),
    k(1.4, 'pouch', [0.02, 0.1, -0.05]),
    k(1.65, 'port', [INS[0] - 0.03, INS[1] - 0.07, INS[2] + 0.03]),
    k(1.7, 'port', INS),
    k(1.95, 'port', [INS[0] + 0.02, INS[1], INS[2]]),
    k(2.1, 'port', [INS[0] - 0.03, INS[1] - 0.04, INS[2] + 0.02], R, 0.3),
    k(2.2, 'fore', [0, -0.06, 0], R, 0.9),
    k(2.3, 'fore', [0, 0.02, 0]),
    k(2.4, 'fore', Z, IDLE, 0.6),
  ],
  tracks: { break: [[0, 0], [0.45, 0], [0.62, 1], [2.1, 1], [2.22, 0], [2.4, 0]] },
  held: [{ kind: 'shell', t0: 1.2, t1: 2.05 }],
};

const CROSS = {
  total: 2.6,
  events: [[1.0, 'crossCock'], [1.1, 'crossLatch'], [1.45, 'pouch'], [2.25, 'boltIn']],
  lh: [
    k(0, 'fore', Z, IDLE, 0.6),
    k(0.3, 'string', [-0.05, -0.08, 0.04], R, 0.3),
    k(0.45, 'string', [-0.02, -0.06, 0.02], R, 0.9),
    k(1.0, 'string', [-0.02, -0.06, 0.296], R, 0.9),
    k(1.12, 'string', [-0.05, -0.05, 0.3], R, 0.3),
    k(1.25, 'pouch', [0, 0.05, 0], R, 0.2),
    k(1.45, 'pouch'),
    k(1.65, 'pouch', [0.02, 0.1, -0.05]),
    k(1.95, 'port', [INS[0] - 0.03, INS[1] - 0.07, INS[2] + 0.04]),
    k(2.2, 'port', INS),
    k(2.35, 'port', [INS[0] - 0.04, INS[1] - 0.03, INS[2]], R, 0.3),
    k(2.6, 'fore', Z, IDLE, 0.6),
  ],
  tracks: {
    string: [[0, 0], [0.45, 0], [1.0, 1], [2.6, 1]],
    loaded: [[0, 0], [2.2, 0], [2.25, 1], [2.6, 1]],
  },
  held: [{ kind: 'bolt', t0: 1.45, t1: 2.25 }],
};

// ---------- post-shot cycles (bolt / pump) ----------
const SNIPER_H = [0.02, -0.07, 0.05];
const SNIPER_CYCLE = {
  dur: 1.15,
  events: [[0.44, 'boltBack'], [0.5, 'eject'], [0.8, 'boltFwd']],
  rh: [kr(0.1, 'grip'), kr(0.28, 'handle', SNIPER_H), kr(0.44, 'handle', add(SNIPER_H, [0, 0, 0.1])),
    kr(0.62, 'handle', add(SNIPER_H, [0, 0, 0.1])), kr(0.8, 'handle', SNIPER_H), kr(1.0, 'grip')],
  tracks: { bolt: [[0, 0], [0.28, 0], [0.44, 1], [0.62, 1], [0.8, 0], [1.15, 0]] },
};
const PUMP_CYCLE = {
  dur: 0.55,
  events: [[0.26, 'pumpBack'], [0.28, 'eject'], [0.42, 'pumpFwd']],
  lh: [k(0, 'fore', Z, IDLE, 0.75), k(0.12, 'fore', Z, R, 0.85), k(0.26, 'fore', [0, 0, 0.12]), k(0.42, 'fore'),
    k(0.55, 'fore', Z, IDLE, 0.75)],
  tracks: { pump: [[0, 0], [0.12, 0], [0.26, 1], [0.42, 0], [0.55, 0]] },
};

// ---------- weapons ----------
const gun = (o) => ({ kind: 'gun', pellets: 1, falloff: null, scope: null, cycle: null, silent: false, bulletSpeed: 230,
  move: 1, adsMove: 0.62, adsZoom: 0.8, draw: 0.45, ...o });

export const WEAPONS = {
  vanguard: gun({
    id: 'vanguard', slot: 'main', name: 'AR-17 Vanguard', blurb: 'Reliable all-rounder. Controllable full-auto.',
    model: 'ar', cls: 'long', auto: true, cd: 0.1, mag: 30, total: 150,
    dmg: { head: 40, body: 20, limb: 14 }, spread: { hip: 0.016, ads: 0.0035 }, recoil: 0.015,
    reload: boxMag(2.85, { seat: [-0.025, -0.07, 0.05], drop: 0.24, rack: { hand: 'L', part: 'charge', pull: [0, 0, 0.09] } }),
  }),
  stinger: gun({
    id: 'stinger', slot: 'main', name: 'Stinger SMG', blurb: 'Fastest fire rate. Deadly up close, weak at range.',
    model: 'smg', cls: 'long', auto: true, cd: 0.067, mag: 35, total: 140, move: 1.08, draw: 0.35,
    dmg: { head: 26, body: 13, limb: 10 }, falloff: { start: 12, end: 28, min: 0.5 },
    spread: { hip: 0.024, ads: 0.006 }, recoil: 0.008, adsZoom: 0.85,
    reload: boxMag(1.95, { seat: [-0.025, -0.07, 0.045], drop: 0.2, rack: { hand: 'L', part: 'charge', o: [-0.045, -0.03, 0.05], pull: [0, 0, 0.07] } }),
  }),
  breacher: gun({
    id: 'breacher', slot: 'main', name: 'Breacher Shotgun', blurb: 'Pump action. One good hit up close ends it.',
    model: 'shotgun', cls: 'long', auto: false, cd: 0.9, mag: 6, total: 30, pellets: 8, move: 0.96, draw: 0.55,
    dmg: { head: 24, body: 12, limb: 8 }, falloff: { start: 6, end: 20, min: 0.15 },
    spread: { hip: 0.055, ads: 0.04 }, recoil: 0.06, cycle: PUMP_CYCLE, adsZoom: 0.88,
    reload: { style: 'shells', build: shellsSpec, total: SG.start + SG.per * 6 + SG.end },
  }),
  longbow: gun({
    id: 'longbow', slot: 'main', name: 'Longbow Sniper', blurb: 'Headshot kills. Body = 1/3 health. Slow bolt.',
    model: 'sniper', cls: 'long', auto: false, cd: 1.2, mag: 4, total: 20, move: 0.9, adsMove: 0.5, draw: 0.7,
    dmg: { head: 200, body: 34, limb: 34 }, spread: { hip: 0.07, ads: 0.0006 }, recoil: 0.09,
    scope: { zoom: 4, sway: 0.0012 }, cycle: SNIPER_CYCLE, bulletSpeed: 400,
    reload: boxMag(3.0, { seat: [-0.025, -0.06, 0.04], drop: 0.14, rack: { hand: 'R', part: 'bolt', o: SNIPER_H, pull: [0, 0, 0.1] } }),
  }),
  ridgeback: gun({
    id: 'ridgeback', slot: 'main', name: 'Ridgeback Hunting Rifle', blurb: 'One round. One kill, anywhere. Long reload.',
    model: 'hunter', cls: 'long', auto: false, cd: 0.6, mag: 1, total: 10, move: 0.95, adsMove: 0.6, draw: 0.6,
    dmg: { head: 300, body: 300, limb: 300 }, spread: { hip: 0.045, ads: 0.0015 }, recoil: 0.1, adsZoom: 0.68, bulletSpeed: 330,
    reload: HUNTER,
  }),
  p9: gun({
    id: 'p9', slot: 'side', name: 'P9 Pistol', blurb: 'Accurate semi-auto. Quick to draw and reload.',
    model: 'pistol', cls: 'short', auto: false, cd: 0.14, mag: 15, total: 75, move: 1.05, draw: 0.28,
    dmg: { head: 34, body: 17, limb: 12 }, falloff: { start: 20, end: 50, min: 0.55 },
    spread: { hip: 0.02, ads: 0.004 }, recoil: 0.02, adsZoom: 0.88,
    reload: boxMag(1.5, { seat: [-0.02, -0.17, 0.03], drop: 0.13, rack: { hand: 'L', part: 'slide', o: [-0.045, -0.03, 0.05], pull: [0, 0, 0.04] } }),
  }),
  marshal: gun({
    id: 'marshal', slot: 'side', name: 'Marshal .44', blurb: 'Hand cannon. Three body shots, or head + body.',
    model: 'revolver', cls: 'short', auto: false, cd: 0.5, mag: 6, total: 30, draw: 0.4,
    dmg: { head: 75, body: 38, limb: 28 }, falloff: { start: 20, end: 45, min: 0.6 },
    spread: { hip: 0.022, ads: 0.003 }, recoil: 0.07, adsZoom: 0.86,
    reload: REVOLVER,
  }),
  spitfire: gun({
    id: 'spitfire', slot: 'side', name: 'Spitfire Machine Pistol', blurb: 'Bullet hose. Falls off hard past 8 m.',
    model: 'mpistol', cls: 'short', auto: true, cd: 0.06, mag: 20, total: 100, move: 1.06, draw: 0.28,
    dmg: { head: 18, body: 9, limb: 7 }, falloff: { start: 8, end: 20, min: 0.4 },
    spread: { hip: 0.03, ads: 0.011 }, recoil: 0.01, adsZoom: 0.9,
    reload: boxMag(1.65, { seat: [-0.02, -0.19, 0.03], drop: 0.17, release: 'slide' }),
  }),
  cutter: gun({
    id: 'cutter', slot: 'side', name: 'Cutter Sawn-Off', blurb: 'Two shells, devastating at point blank.',
    model: 'sawnoff', cls: 'short', auto: false, cd: 0.3, mag: 2, total: 16, pellets: 10, draw: 0.35,
    dmg: { head: 20, body: 10, limb: 7 }, falloff: { start: 4, end: 14, min: 0.1 },
    spread: { hip: 0.07, ads: 0.055 }, recoil: 0.07, adsZoom: 0.9,
    reload: SAWN,
  }),
  whisper: gun({
    id: 'whisper', slot: 'side', name: 'Whisper Crossbow', blurb: 'Silent. One bolt, then recock.',
    model: 'crossbow', cls: 'long', auto: false, cd: 0.9, mag: 1, total: 12, silent: true, bulletSpeed: 95, draw: 0.5,
    dmg: { head: 130, body: 75, limb: 55 }, spread: { hip: 0.03, ads: 0.0012 }, recoil: 0.03, adsZoom: 0.72,
    reload: CROSS,
  }),
};

// ---------- melee ----------
// keyframe: { t, R:[x,y,z] hand/weapon pos (viewmodel space), rot:[x,y,z] weapon rotation, L: [x,y,z] | 'weapon' | null }
const kf = (t, Rp, rot, L = null) => ({ t, R: Rp, rot, L });
const REST = [0.22, -0.26, -0.40], REST_ROT = [0.15, 0.0, 0.08];
const rest = (t) => kf(t, REST, REST_ROT);
const melee = (o) => ({ kind: 'melee', slot: 'melee', cls: 'melee', draw: 0.3, move: 1, ...o });

export const MELEES = {
  fists: melee({
    id: 'fists', name: 'Bare Knuckle', model: 'fists', blurb: 'Perk: double jump.', perk: 'doubleJump',
    dmg: { front: 18, head: 28 }, range: 1.7, cd: 0.34, draw: 0.2,
    // R = right fist, L = left fist — both curled, raised slightly
    idle: kf(0, [0.18, -0.22, -0.48], [0, 0, 0], [-0.18, -0.22, -0.48]),
    swings: [
      { dur: 0.34, hit: 0.12, keys: [
        kf(0, [0.18, -0.22, -0.48], [0, 0, 0], [-0.18, -0.22, -0.48]),
        kf(0.12, [0.18, -0.22, -0.48], [0, 0, 0], [-0.05, -0.08, -0.72]),
        kf(0.34, [0.18, -0.22, -0.48], [0, 0, 0], [-0.18, -0.22, -0.48])] },
      { dur: 0.34, hit: 0.13, keys: [
        kf(0, [0.18, -0.22, -0.48], [0, 0, 0], [-0.18, -0.22, -0.48]),
        kf(0.13, [0.05, -0.08, -0.72], [0, 0, 0], [-0.18, -0.22, -0.48]),
        kf(0.34, [0.18, -0.22, -0.48], [0, 0, 0], [-0.18, -0.22, -0.48])] },
    ],
  }),
  knife: melee({
    id: 'knife', name: 'Combat Knife', model: 'knife', blurb: 'Perk: backstab = instant kill.', perk: 'backstab',
    dmg: { front: 30, head: 45, back: 200 }, range: 1.9, cd: 0.42, draw: 0.2, idle: rest(0),
    swings: [
      { dur: 0.42, hit: 0.2, keys: [rest(0),
        kf(0.1, [0.3, -0.2, -0.3], [-0.1, -0.9, 0.4]),
        kf(0.2, [0.0, -0.15, -0.55], [-0.1, 0.1, 0.0]),
        kf(0.3, [-0.18, -0.2, -0.4], [-0.2, 0.9, -0.3]), rest(0.42)] },
      { dur: 0.42, hit: 0.2, keys: [rest(0),
        kf(0.1, [-0.1, -0.2, -0.3], [-0.1, 0.9, -0.4]),
        kf(0.2, [0.1, -0.15, -0.55], [-0.1, -0.1, 0.0]),
        kf(0.3, [0.32, -0.2, -0.4], [-0.2, -0.9, 0.3]), rest(0.42)] },
    ],
  }),
  machete: melee({
    id: 'machete', name: 'Machete', model: 'machete', blurb: 'Perk: kills heal 35 HP.', perk: 'lifesteal',
    dmg: { front: 45, head: 65 }, range: 2.2, cd: 0.7, draw: 0.35, heal: 35, idle: rest(0),
    swings: [
      { dur: 0.7, hit: 0.3, keys: [rest(0),
        kf(0.22, [0.28, -0.05, -0.3], [1.2, -0.3, 0.2]),
        kf(0.34, [0.1, -0.28, -0.55], [-0.7, 0.1, 0.0]),
        kf(0.46, [0.0, -0.4, -0.45], [-1.0, 0.2, 0.0]), rest(0.7)] },
      { dur: 0.7, hit: 0.3, keys: [rest(0),
        kf(0.2, [-0.05, -0.4, -0.35], [-0.8, 0.9, 0.2]),
        kf(0.34, [0.15, -0.2, -0.55], [0.5, -0.1, 0.0]),
        kf(0.46, [0.3, -0.05, -0.4], [1.1, -0.8, 0.0]), rest(0.7)] },
    ],
  }),
  tomahawk: melee({
    id: 'tomahawk', name: 'Tomahawk', model: 'tomahawk', blurb: 'Perk: right-click to throw. Kills at range.', perk: 'throw',
    dmg: { front: 40, head: 60, thrown: 120 }, range: 2.0, cd: 0.5, draw: 0.25, throwRange: 45, throwCd: 3.5, idle: rest(0),
    swings: [
      { dur: 0.5, hit: 0.2, keys: [rest(0),
        kf(0.14, [0.26, -0.08, -0.32], [1.0, -0.2, 0.15]),
        kf(0.22, [0.1, -0.26, -0.55], [-0.6, 0.1, 0.0]), rest(0.5)] },
    ],
    throw: { dur: 0.45, release: 0.22, keys: [rest(0),
      kf(0.14, [0.3, 0.0, -0.1], [1.1, 0.0, 0.0]),
      kf(0.24, [0.1, -0.1, -0.7], [0.1, 0.0, 0.0]), rest(0.45)] },
  }),
  sledge: melee({
    id: 'sledge', name: 'Sledgehammer', model: 'sledge', blurb: 'Perk: instantly smashes builds.', perk: 'demolish',
    dmg: { front: 80, head: 100 }, range: 2.5, cd: 1.1, draw: 0.6, move: 0.94, knockback: 5,
    idle: kf(0, [0.16, -0.26, -0.38], [0.25, 0.0, 0.05], 'weapon'),
    swings: [
      { dur: 1.1, hit: 0.55, keys: [
        kf(0, [0.12, -0.3, -0.42], [-0.15, 0.1, 0.1], 'weapon'),
        kf(0.4, [0.16, 0.0, -0.3], [1.45, 0.0, 0.0], 'weapon'),
        kf(0.55, [0.1, -0.3, -0.55], [-0.45, 0.0, 0.0], 'weapon'),
        kf(0.75, [0.1, -0.36, -0.5], [-0.5, 0.0, 0.0], 'weapon'),
        kf(1.1, [0.12, -0.3, -0.42], [-0.15, 0.1, 0.1], 'weapon')] },
    ],
  }),
  drone: {
    kind: 'utility', slot: 'utility', cls: 'melee', id: 'drone', name: 'Scout Drone', model: 'drone',
    blurb: 'Deploy a scout drone. Your body stays behind.', perk: 'drone',
    dmg: { front: 0, head: 0 }, range: 0, cd: 1.5, draw: 0.5, move: 1, idle: rest(0),
    swings: [{ dur: 0.5, hit: 0.5, keys: [rest(0), rest(0.5)] }],
    // Empty hands → reach back → grab drone → crouch place → stand → tablet → tap → hold tablet
    deploy: {
      dur: 5.4,
      events: [
        [0.90, 'grab'],
        [2.40, 'place'],
        [3.50, 'tablet'],
        [4.60, 'tap'],
      ],
      keys: [
        // empty hands (no prop yet)
        kf(0.00, [0.20, -0.30, -0.40], [-0.30, 0.15, 0.20]),
        // reach up and over the right shoulder / back
        kf(0.30, [0.32, 0.02, -0.18], [0.50, 0.90, 0.40]),
        kf(0.60, [0.20, 0.14, 0.08], [0.85, 1.20, 0.55]),
        kf(0.85, [0.10, 0.08, 0.02], [0.70, 1.00, 0.35]),
        // grab + pull the drone off the pack into view
        kf(1.05, [0.14, 0.00, -0.28], [0.35, 0.50, 0.15], 'weapon'),
        kf(1.35, [0.18, -0.12, -0.40], [0.10, 0.20, 0.00], 'weapon'),
        // lower in front of body
        kf(1.65, [0.15, -0.38, -0.44], [0.60, 0.08, 0.00], 'weapon'),
        // crouch and plant on the ground
        kf(2.00, [0.12, -0.58, -0.50], [1.10, 0.05, 0.00], 'weapon'),
        kf(2.35, [0.10, -0.74, -0.56], [1.50, 0.00, 0.00], 'weapon'),
        // open hands / release (empty again)
        kf(2.55, [0.14, -0.62, -0.48], [1.05, 0.12, 0.00]),
        // stand up, reach back again for the tablet
        kf(2.85, [0.22, -0.28, -0.36], [0.20, 0.35, 0.12]),
        kf(3.20, [0.28, 0.06, -0.10], [0.65, 0.95, 0.40]),
        // tablet comes into frame — upright in front of chest
        kf(3.50, [0.10, -0.08, -0.36], [-0.15, 0.05, 0.02], 'weapon'),
        kf(3.85, [0.08, -0.10, -0.38], [-0.20, 0.02, 0.00], 'weapon'),
        // left index taps the screen
        kf(4.15, [0.08, -0.10, -0.38], [-0.20, 0.02, 0.00], 'weapon'),
        kf(4.40, [0.08, -0.10, -0.38], [-0.20, 0.02, 0.00], 'tap'),
        kf(4.55, [0.08, -0.10, -0.38], [-0.20, 0.02, 0.00], 'tap'),
        kf(4.70, [0.08, -0.10, -0.38], [-0.20, 0.02, 0.00], 'weapon'),
        // hold tablet steady (pose freezes here until recall)
        kf(5.40, [0.08, -0.10, -0.38], [-0.20, 0.02, 0.00], 'weapon'),
      ],
    },
    // Put the tablet away on recall
    stow: {
      dur: 0.95,
      events: [[0.55, 'stowed']],
      keys: [
        kf(0.00, [0.15, -0.14, -0.45], [-0.50, 0.00, 0.00], 'weapon'),
        kf(0.25, [0.20, -0.08, -0.32], [-0.20, 0.25, 0.10], 'weapon'),
        kf(0.50, [0.26, 0.04, -0.12], [0.40, 0.70, 0.30]),
        kf(0.70, [0.22, -0.10, -0.28], [0.10, 0.30, 0.12]),
        kf(0.95, [0.20, -0.30, -0.40], [-0.30, 0.15, 0.20]),
      ],
    },
  },

  lottery: {
    kind: 'utility', slot: 'utility', cls: 'melee', id: 'lottery', name: 'Ridgeback Lottery', model: 'lottery',
    blurb: 'Arm it. Your next shot is a Ridgeback round — then the flash owns you.', perk: 'lottery',
    dmg: { front: 0, head: 0 }, range: 0, cd: 1.2, draw: 0.45, move: 1, idle: rest(0),
    swings: [{ dur: 0.85, hit: 0.85, keys: [rest(0), rest(0.85)] }],
    deploy: {
      dur: 0.85,
      events: [
        [0.15, 'grab'],
        [0.45, 'chamber'],
        [0.80, 'armed'],
      ],
      keys: [
        // raise empty hands
        kf(0.00, [0.18, -0.28, -0.42], [-0.25, 0.10, 0.15]),
        // pull golden shell from vest
        kf(0.18, [0.22, -0.05, -0.22], [0.20, 0.55, 0.25], 'weapon'),
        kf(0.35, [0.12, -0.08, -0.36], [-0.10, 0.15, 0.05], 'weapon'),
        // inspect the round in front of face
        kf(0.50, [0.08, -0.02, -0.32], [-0.35, 0.05, 0.00], 'weapon'),
        // chamber gesture / pocket it
        kf(0.68, [0.14, -0.18, -0.40], [0.15, 0.25, 0.10], 'weapon'),
        kf(0.85, [0.18, -0.28, -0.42], [-0.25, 0.10, 0.15]),
      ],
    },
  },

};

// Hellgate Summon: once per life, pick a vehicle, carve the seal, it rises from the pit (lib/summon.js)
const SUMMON = {
  kind: 'utility', slot: 'utility', cls: 'melee', id: 'summon', name: 'Hellgate Summon', model: 'summon',
  blurb: 'Once per life: carve the seal and call a vehicle of your choice up from the pit.', perk: 'summon',
  dmg: { front: 0, head: 0 }, range: 0, cd: 1.0, draw: 0.45, move: 1, idle: rest(0),
  swings: [{
    dur: 7.0, hit: 7.0,
    keys: [
      rest(0),
      // raise the bone dagger, open the left palm
      kf(0.55, [0.26, -0.14, -0.34], [0.95, -0.25, 0.10], [-0.20, -0.20, -0.42]),
      kf(0.95, [0.20, 0.00, -0.36], [1.30, -0.10, 0.10], [-0.17, -0.15, -0.46]),
      // cut the palm
      kf(1.15, [-0.04, -0.15, -0.46], [-0.25, 0.60, 0.10], [-0.16, -0.15, -0.48]),
      kf(1.30, [-0.02, -0.18, -0.46], [-0.15, 0.50, 0.05], [-0.16, -0.15, -0.48]),
      // plunge the blade down, palm flat on the ground
      kf(1.55, [0.08, -0.50, -0.50], [-1.00, 0.00, 0.00], [-0.18, -0.46, -0.48]),
      kf(1.80, [0.10, -0.64, -0.52], [-1.40, 0.00, 0.00], [-0.18, -0.60, -0.50]),
      // hands tremble while the pit opens
      kf(2.40, [0.11, -0.63, -0.52], [-1.40, 0.00, 0.00], [-0.18, -0.60, -0.50]),
      kf(3.00, [0.09, -0.65, -0.52], [-1.40, 0.00, 0.00], [-0.18, -0.60, -0.50]),
      kf(3.60, [0.115, -0.63, -0.53], [-1.40, 0.00, 0.00], [-0.18, -0.60, -0.50]),
      kf(4.20, [0.09, -0.645, -0.52], [-1.40, 0.00, 0.00], [-0.18, -0.60, -0.50]),
      kf(4.80, [0.11, -0.63, -0.52], [-1.40, 0.00, 0.00], [-0.18, -0.60, -0.50]),
      kf(5.40, [0.10, -0.64, -0.52], [-1.40, 0.00, 0.00], [-0.18, -0.60, -0.50]),
      // pull free, arms rise as the vehicle comes up
      kf(5.80, [0.12, -0.42, -0.48], [-0.80, 0.00, 0.05], [-0.20, -0.40, -0.48]),
      kf(6.30, [0.30, 0.06, -0.36], [0.65, -0.20, 0.10], [-0.30, 0.04, -0.40]),
      kf(6.70, [0.28, -0.04, -0.38], [0.45, -0.15, 0.10], [-0.26, -0.06, -0.42]),
      rest(7.0),
    ],
  }],
};

export const UTILITIES = {
  drone: MELEES.drone,
  lottery: MELEES.lottery,
  summon: SUMMON,
};

export const ALL = { ...WEAPONS, ...MELEES, ...UTILITIES };
export const SLOTS = ['main', 'side', 'melee', 'utility'];
export const DEFAULT_LOADOUT = { main: 'vanguard', side: 'p9', melee: 'knife', utility: 'drone' };

export const weaponById = (id) => ALL[id];
export const bySlot = (slot) => Object.values(ALL).filter((w) => w.slot === slot);

/** Resolved reload timeline. missing = rounds needed (shotgun reloads per shell). */
export function reloadSpec(def, missing = 1) {
  const r = def.reload;
  return r.style === 'shells' ? r.build(Math.max(1, missing)) : r;
}
export function reloadDuration(def, missing) {
  const r = def.reload;
  return r.style === 'shells' ? r.build(Math.max(1, missing)).total : r.total;
}

/** Sanitise a saved / received loadout */
export function cleanLoadout(l = {}) {
  const out = { ...DEFAULT_LOADOUT };
  for (const s of SLOTS) if (l[s] && ALL[l[s]] && ALL[l[s]].slot === s) out[s] = l[s];
  return out;
}
