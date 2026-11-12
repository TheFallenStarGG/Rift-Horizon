/**
 * Helpers for the special weapons: same keyframe format as arsenal.js (copied so arsenal.js stays untouched).
 * Reloads: boxMag (detachable mags) and shellReload (one shell at a time + pump). Also gun / melee def helpers.
 */
const PI = Math.PI, R = PI / 2, Z = [0, 0, 0];
export const INS = [-0.02, -0.085, 0.04];
const IDLE = PI * 0.8;
export const k = (t, a, o = Z, roll = R, curl = 0.9) => ({ t, a, o, roll, curl });
const kr = (t, a, o = Z, roll = -R, curl = 0.95) => ({ t, a, o, roll, curl });
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];

/** Detachable box magazine: drop it, toss it, grab a fresh one from the vest, seat it, rack / release. */
export function boxMag(T, c) {
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

/** Pump / tube shotgun: shells one at a time, pump at the end. cfg = { start, per, end } seconds. */
export function shellReload(cfg, max) {
  const build = (n) => {
    const total = +(cfg.start + n * cfg.per + cfg.end).toFixed(3);
    const lh = [k(0, 'fore', Z, IDLE, 0.6), k(cfg.start * 0.6, 'fore', [-0.02, -0.03, 0], R, 0.3)];
    const ev = [], held = [], f = cfg.per / 0.62, e = cfg.end / 0.6;
    for (let i = 0; i < n; i++) {
      const t0 = cfg.start + i * cfg.per;
      lh.push(
        k(t0 + 0.05 * f, 'pouch', [0, 0.05, 0], R, 0.2),
        k(t0 + 0.18 * f, 'pouch'),
        k(t0 + 0.3 * f, 'pouch', [0.02, 0.1, -0.05]),
        k(t0 + 0.44 * f, 'port', [INS[0] - 0.03, INS[1] - 0.07, INS[2] + 0.03]),
        k(t0 + 0.52 * f, 'port', INS),
        k(t0 + 0.58 * f, 'port', [INS[0] - 0.03, INS[1] - 0.03, INS[2]], R, 0.3));
      ev.push([t0 + 0.18 * f, 'pouch'], [t0 + 0.53 * f, 'shellIn']);
      held.push({ kind: 'shell', t0: t0 + 0.18 * f, t1: t0 + 0.53 * f });
    }
    const te = cfg.start + n * cfg.per;
    lh.push(k(te + 0.12 * e, 'fore', Z, R, 0.85), k(te + 0.3 * e, 'fore', [0, 0, 0.12]), k(te + 0.46 * e, 'fore'),
      k(total, 'fore', Z, IDLE, 0.6));
    ev.push([te + 0.3 * e, 'pumpBack'], [te + 0.46 * e, 'pumpFwd']);
    return { total, events: ev, lh, tracks: { pump: [[0, 0], [te + 0.12 * e, 0], [te + 0.3 * e, 1], [te + 0.46 * e, 0], [total, 0]] }, held };
  };
  return { style: 'shells', build, total: build(max).total };
}

export const PUMP_CYCLE = {
  dur: 0.5,
  events: [[0.24, 'pumpBack'], [0.26, 'eject'], [0.38, 'pumpFwd']],
  lh: [k(0, 'fore', Z, IDLE, 0.75), k(0.12, 'fore', Z, R, 0.85), k(0.24, 'fore', [0, 0, 0.12]), k(0.38, 'fore'),
    k(0.5, 'fore', Z, IDLE, 0.75)],
  tracks: { pump: [[0, 0], [0.12, 0], [0.24, 1], [0.38, 0], [0.5, 0]] },
};

export const gun = (o) => ({ kind: 'gun', pellets: 1, falloff: null, scope: null, cycle: null, silent: false, bulletSpeed: 230,
  move: 1, adsMove: 0.62, adsZoom: 0.8, draw: 0.45, ...o });

// ---- melee helpers (used by the melee pack) ----
export const kf = (t, Rp, rot, L = null) => ({ t, R: Rp, rot, L });
const REST = [0.22, -0.26, -0.40], REST_ROT = [0.15, 0.0, 0.08];
export const rest = (t) => kf(t, REST, REST_ROT);
export const melee = (o) => ({ kind: 'melee', slot: 'melee', cls: 'melee', draw: 0.3, move: 1, ...o });
