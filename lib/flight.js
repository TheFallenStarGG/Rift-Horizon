/**
 * Flight physics for the plane and the helicopter. Pure maths (no THREE), so it can be tested without the game.
 * Body frame: forward = -Z, up = +Y, right = +X (same as the rest of the game). Quaternions are [x, y, z, w] (body -> world).
 * Angular velocity w is in the body frame: w[0] = pitch rate (nose up +), w[1] = yaw rate (nose left +), w[2] = about +Z (right wing UP +).
 * Positions in the CONFIG blocks are given in MODEL coordinates (the GLBs: nose = +Z, left = +X) and converted once.
 */
const G = 9.81, PI = Math.PI;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const angDiff = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
export const rho = (y) => 1.225 * Math.exp(-Math.max(0, y) / 8500);

// ---------- tiny vector / quaternion helpers ----------
export const qmul = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
export function rot(q, v) {
  const x = q[0], y = q[1], z = q[2], w = q[3];
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + (y * tz - z * ty), v[1] + w * ty + (z * tx - x * tz), v[2] + w * tz + (x * ty - y * tx)];
}
export const rotInv = (q, v) => rot([-q[0], -q[1], -q[2], q[3]], v);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const qFromYaw = (yaw) => [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];

/** attitude read-out: yaw (game convention, 0 = facing -Z), pitch (nose up +), roll (right wing down +) */
export function attitude(s, out = {}) {
  const f = rot(s.q, [0, 0, -1]), u = rot(s.q, [0, 1, 0]), r = rot(s.q, [1, 0, 0]);
  out.yaw = Math.atan2(-f[0], -f[2]);
  out.pitch = Math.asin(clamp(f[1], -1, 1));
  out.roll = Math.atan2(-r[1], u[1]);
  out.fwd = f; out.up = u; out.right = r;
  return out;
}

const mb = (cg, m) => [-m[0], m[1] - cg[1], -(m[2] - cg[2])]; // model point -> body offset from the centre of gravity

// ======================================================================================
// configs
// ======================================================================================
export const PLANE = {
  kind: 'plane', name: 'Light Plane', hp: 260, fuel: 140, // kg of fuel
  mass: 1100, cgM: [0, 1.15, 0.25], S: 16.2, b: 10.9, c: 1.5, Ip: 1825, Ir: 1285, Iy: 2667,
  CL0: 0.28, CLa: 4.6, aStall: 0.27, flapCL: 0.5, CD0: 0.028, k: 0.058,
  // CHANGED: Cmq -13 -> -15 (a bit more pitch damping), Cmde 1.15 -> 0.9 (weaker elevator), new Cmflap (flaps pitch the nose down)
  Cm0: 0.03, Cma: -0.95, Cmq: -15, Cmde: 0.9, Cmflap: -0.06, Clb: -0.09, Clp: -0.5, Clda: 0.19, Cnb: 0.075, Cnr: -0.13, Cndr: 0.1, Cnda: 0.02, CYb: 0.5,
  maxDefl: { e: 0.38, a: 0.38, r: 0.45 }, // CHANGED: elevator throw 0.44 -> 0.38
  // NEW: yoke / stick travel. Speeds are "full deflections per second" for [pitch, roll, yaw]; expo 0 = linear, 1 = fully quadratic.
  stickUp: [1.1, 2.2, 2.6], stickRet: [2.4, 3.5, 4.0], expo: [0.65, 0.4, 0.2],
  T0: 4700, V0: 108, burn: 0.0085, propArea: 2.5, vne: 92, // static thrust N, prop "pitch speed" m/s, kg/s at full power
  wheels: [
    { m: [0, 0.21, 2.0], r: 0.2, share: 0.125, nose: true }, { m: [1.54, 0.26, 0], r: 0.21, share: 0.4375, brake: true }, { m: [-1.54, 0.26, 0], r: 0.21, share: 0.4375, brake: true },
  ],
  hull: [
    { n: 'prop', m: [0, 1.25, 2.75] }, { n: 'tipL', m: [5.3, 1.3, -0.25], wing: 1 }, { n: 'tipR', m: [-5.3, 1.3, -0.25], wing: 1 },
    { n: 'tail', m: [0, 1.5, -4.9] }, { n: 'belly', m: [0, 0.68, 0.9] }, { n: 'belly2', m: [0, 0.68, -2.5] }, { n: 'roof', m: [0, 2.3, 0.3] },
  ],
};

export const HELI = {
  kind: 'heli', name: 'Helicopter', hp: 400, fuel: 220,
  mass: 1500, cgM: [0, 1.5, 0.3], Ip: 7000, Ir: 3000, Iy: 6500, hubM: [0, 3.8, 0], R: 3.98,
  Tmax: 1.6, kz: 0.55, kh: 0.1, vne: 60, burn: 0.012,
  Ap: 2.2, Ar: 2.8, Ay: 2.0, kq: 1.7, kp: 2.2, ky: 1.4, torque: 0.8,
  cdA: [0.9, 4.5, 3.0], // fuselage drag areas: forward, side, vertical
  skids: [[1.1, 0.07, 2.6], [-1.1, 0.07, 2.6], [1.1, 0.07, -1.9], [-1.1, 0.07, -1.9]],
  hull: [
    { n: 'nose', m: [0, 1.0, 4.3] }, { n: 'roof', m: [0, 3.3, 0.2] }, { n: 'belly', m: [0, 0.55, 0.5] },
    { n: 'tailRotor', m: [0.3, 2.13, -6.5], rotor: 1 }, { n: 'tailEnd', m: [0, 2.6, -6.9] }, { n: 'tailFin', m: [0, 3.2, -6.4] },
  ],
};

function prep(cfg) {
  if (cfg._p) return cfg;
  cfg.cg = cfg.cgM;
  cfg._hull = cfg.hull.map((h) => ({ ...h, r: mb(cfg.cg, h.m) }));
  if (cfg.kind === 'plane') {
    cfg._wheels = cfg.wheels.map((w) => {
      const sc = G / Math.pow(2 * PI * 2.2, 2), k = (w.share * cfg.mass * G) / sc; // 2.2 Hz suspension
      return { ...w, r0: mb(cfg.cg, w.m), k, c: 2 * 0.55 * Math.sqrt(k * w.share * cfg.mass), travel: 0.3 };
    });
  } else {
    cfg._skids = cfg.skids.map((m) => ({ r: mb(cfg.cg, m), k: (cfg.mass * G * 0.25) / 0.06, c: 2 * 0.6 * Math.sqrt(((cfg.mass * G * 0.25) / 0.06) * cfg.mass * 0.25) }));
    cfg.hub = mb(cfg.cg, cfg.hubM);
    cfg._rotorPts = [];
    for (let i = 0; i < 8; i++) { const a = (i / 8) * PI * 2; cfg._rotorPts.push([Math.cos(a) * (cfg.R - 0.1) + cfg.hub[0], cfg.hub[1], Math.sin(a) * (cfg.R - 0.1) + cfg.hub[2]]); }
  }
  cfg._p = true;
  return cfg;
}

export function createState(cfg) {
  prep(cfg);
  return {
    cfg, p: [0, 0, 0], v: [0, 0, 0], q: [0, 0, 0, 1], w: [0, 0, 0],
    fuel: cfg.fuel, engine: false, rpm: 0, // rotor / prop speed 0..1
    thr: 0, de: 0, da: 0, dr: 0, gear: 1, flaps: 0, steer: 0, // actuators (gear 1 = down)
    stk: [0, 0, 0], // NEW: smoothed yoke / stick position [pitch, roll, yaw] (plane)
    col: 0, cI: 0, hold: null, hdg: null, // heli
    wheelAng: 0, onGround: false, nGround: 0, wheelLoad: 0, stall: 0, aoa: 0, aglV: 0, gLoad: 1, buffet: 0,
    impact: { wheel: 0, hull: 0, hullName: '', rotor: 0 }, tNow: 0, skidSpeed: 0,
  };
}

/** put the aircraft on the ground at (x, z) with the given yaw so that the wheels / skids just touch */
export function placeOnGround(s, x, z, yaw, ground) {
  const cfg = s.cfg;
  s.q = qFromYaw(yaw); s.v = [0, 0, 0]; s.w = [0, 0, 0];
  const pts = cfg.kind === 'plane' ? cfg._wheels.map((w) => [w.r0[0], w.r0[1] - w.r, w.r0[2]]) : cfg._skids.map((k) => k.r);
  let best = -1e9;
  for (const r of pts) { const wp = rot(s.q, r); best = Math.max(best, ground(x + wp[0], z + wp[2]) - wp[1]); }
  s.p = [x, best + 0.02, z];
  if (cfg.kind === 'plane') { s.gear = 1; s.thr = 0; s.rpm = 0; s.stk = [0, 0, 0]; s.de = 0; s.da = 0; s.dr = 0; } else { s.rpm = 0; s.col = 0; }
  s.engine = false; s.onGround = true; s.cI = 0; s.hold = null; s.hdg = null;
}

/** model origin (ground level under the model) in world space */
export function originOf(s) {
  const o = rot(s.q, [-s.cfg.cg[0], -s.cfg.cg[1], -s.cfg.cg[2]]);
  return [s.p[0] + o[0], s.p[1] + o[1], s.p[2] + o[2]];
}

// ======================================================================================
// shared integration + ground contact helpers
// ======================================================================================
function pointVel(s, r) { return [s.v[0], s.v[1], s.v[2]].map((x, i) => x + rot(s.q, cross(s.w, r))[i]); }

/** apply a world force at body offset r: accumulates into acc.F (world) and acc.T (body) */
function applyAt(s, acc, r, Fw) {
  acc.F[0] += Fw[0]; acc.F[1] += Fw[1]; acc.F[2] += Fw[2];
  const t = cross(r, rotInv(s.q, Fw));
  acc.T[0] += t[0]; acc.T[1] += t[1]; acc.T[2] += t[2];
}

function integrate(s, acc, dt, mass) {
  const cfg = s.cfg;
  s.v[0] += (acc.F[0] / mass) * dt; s.v[1] += (acc.F[1] / mass - G) * dt; s.v[2] += (acc.F[2] / mass) * dt;
  const w = s.w, Ix = cfg.Ip, Iy = cfg.Iy, Iz = cfg.Ir; // x = pitch axis, y = yaw axis, z = roll axis
  const gx = ((Iy - Iz) * w[1] * w[2]) / Ix, gy = ((Iz - Ix) * w[2] * w[0]) / Iy, gz = ((Ix - Iy) * w[0] * w[1]) / Iz;
  w[0] += (acc.T[0] / Ix + gx) * dt; w[1] += (acc.T[1] / Iy + gy) * dt; w[2] += (acc.T[2] / Iz + gz) * dt;
  s.p[0] += s.v[0] * dt; s.p[1] += s.v[1] * dt; s.p[2] += s.v[2] * dt;
  const dq = qmul(s.q, [w[0] * 0.5 * dt, w[1] * 0.5 * dt, w[2] * 0.5 * dt, 0]);
  const q = s.q; q[0] += dq[0]; q[1] += dq[1]; q[2] += dq[2]; q[3] += dq[3];
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1; q[0] /= l; q[1] /= l; q[2] /= l; q[3] /= l;
}

/** body hull points against the ground: stiff penalty spring, records the closing speed for crash damage */
function hullContacts(s, acc, kHull, ground) {
  for (const h of s.cfg._hull) {
    const wp = rot(s.q, h.r), x = s.p[0] + wp[0], y = s.p[1] + wp[1], z = s.p[2] + wp[2];
    const pen = ground(x, z) - y;
    if (pen <= 0) continue;
    const vp = pointVel(s, h.r), vn = vp[1];
    if (vn < 0 && -vn > s.impact.hull) { s.impact.hull = -vn; s.impact.hullName = h.n; if (h.rotor) s.impact.rotor = -vn; }
    const Fn = Math.max(0, kHull * Math.min(pen, 0.6) - kHull * 0.25 * vn);
    const hs = Math.hypot(vp[0], vp[2]) || 1;
    applyAt(s, acc, h.r, [(-vp[0] / hs) * Math.min(Fn * 0.6, hs * s.cfg.mass * 6), Fn, (-vp[2] / hs) * Math.min(Fn * 0.6, hs * s.cfg.mass * 6)]);
  }
}

// ======================================================================================
// PLANE
// ======================================================================================
/**
 * ctl = { pitch (+ = pull / nose up), roll (+ = right), yaw (+ = right rudder), thr (0..1 target), brake 0..1, flaps 0..3, gear 0|1 target, assist, engine }
 */
export function stepPlane(s, dt, ctl, ground) {
  const cfg = s.cfg, m = cfg.mass + s.fuel, att = attitude(s, s._att || (s._att = {}));
  s.tNow += dt;
  // ---- actuators ----
  const slew = (cur, tgt, rate) => cur + clamp(tgt - cur, -rate * dt, rate * dt);
  s.thr = slew(s.thr, clamp(ctl.thr, 0, 1), 1.2);
  s.gear = slew(s.gear, ctl.gear ? 1 : 0, 0.28);
  s.flaps = slew(s.flaps, ctl.flaps / 3, 0.35); // 0..1
  const engineOn = ctl.engine !== false && s.fuel > 0;
  s.engine = engineOn;
  s.rpm += ((engineOn ? 0.28 + 0.72 * s.thr : Math.min(s.rpm, 0.14)) - s.rpm) * Math.min(1, dt * 3);
  // ---- air data ----
  const Vb = rotInv(s.q, s.v), vf = -Vb[2], vr = Vb[0], vu = Vb[1];
  const V = Math.hypot(vf, vr, vu), Vp = Math.hypot(vf, vu), Vs = Math.max(V, 8);
  const alpha = Vp > 2 ? Math.atan2(-vu, vf) : 0, beta = Math.atan2(vr, Math.max(Math.abs(vf), 4));
  const rh = rho(s.p[1]), q = 0.5 * rh * V * V;
  const T0 = cfg.T0 * clamp((rh / 1.225 - 0.12) / 0.88, 0.2, 1);
  const thrust = engineOn ? s.thr * T0 * Math.max(0, 1 - Math.pow(Math.max(vf, 0) / cfg.V0, 2)) + (s.thr * T0 * 0.15) * (vf < 0 ? 1 : 0) : 0;
  const wash = engineOn ? 0.4 * ((2 * Math.abs(thrust)) / (rh * cfg.propArea)) : 0; // slipstream over the tail (CHANGED: 0.6 -> 0.4)
  const qc = 0.5 * rh * (V * V + wash);
  const agl = Math.max(0, s.p[1] - ground(s.p[0], s.p[2]));
  s.aglV = agl;
  // ---- yoke / stick: finite travel speed + expo, so a digital "pull" can't snap the elevator to full deflection ----
  const stk = s.stk || (s.stk = [0, 0, 0]);
  const stickTo = (cur, tgt, i) => {
    const rate = (Math.abs(tgt) > Math.abs(cur) && tgt * cur >= 0) ? cfg.stickUp[i] : cfg.stickRet[i];
    return cur + clamp(tgt - cur, -rate * dt, rate * dt);
  };
  stk[0] = stickTo(stk[0], clamp(ctl.pitch, -1, 1), 0);
  stk[1] = stickTo(stk[1], clamp(ctl.roll, -1, 1), 1);
  stk[2] = stickTo(stk[2], clamp(ctl.yaw, -1, 1), 2);
  const expo = (x, i) => (1 - cfg.expo[i]) * x + cfg.expo[i] * x * Math.abs(x);
  // ---- control inputs (+ gentle stability assist) ----
  let ie = expo(stk[0], 0), ia = expo(stk[1], 1), ir = expo(stk[2], 2);
  const onG = s.onGround;
  if (ctl.assist && !onG) {
    const pitchRate = s.w[0], rollRate = -s.w[2];
    if (Math.abs(stk[0]) < 0.05) { if (s.hold === null) s.hold = att.pitch; ie += clamp((s.hold - att.pitch) * 2.2 - pitchRate * 0.6, -0.5, 0.5); } else s.hold = null;
    if (Math.abs(stk[1]) < 0.05) ia += clamp(-att.roll * 1.6 - rollRate * 0.5, -0.5, 0.5);
    ir += clamp(-beta * 3 + s.w[1] * 0.2, -0.4, 0.4) * 0.4;
  } else s.hold = null;
  // assist protections (only with assist on; with it off you get the raw physics)
  if (ctl.assist && ie > 0) {
    if (onG) ie *= clamp((0.2 - att.pitch) / 0.05, 0, 1); // rotation guard: no pitching past ~11 deg on the wheels (tail strike at ~14)
    else ie *= clamp((cfg.aStall - 0.035 * s.flaps - 0.02 - alpha) / 0.08, 0, 1); // soft alpha limiter: pull authority fades near the stall
  }
  ie = clamp(ie, -1, 1); ia = clamp(ia, -1, 1); ir = clamp(ir, -1, 1);
  s.de = slew(s.de, ie * cfg.maxDefl.e, 2.0); s.da = slew(s.da, ia * cfg.maxDefl.a, 4); s.dr = slew(s.dr, ir * cfg.maxDefl.r, 3.5);
  // ---- lift / drag ----
  const f = s.flaps, aS = cfg.aStall - 0.035 * f, CL0 = cfg.CL0 + cfg.flapCL * f * 0.9;
  const lin = CL0 + cfg.CLa * clamp(alpha, -0.3, aS), CLmax = CL0 + cfg.CLa * aS;
  let CL = lin, post = 0;
  if (alpha > aS) { post = clamp((alpha - aS) / 0.14, 0, 1); CL = lerp(CLmax, Math.max(0.45, 1.1 * Math.sin(2 * alpha)), post); }
  else if (alpha < -0.22) { post = clamp((-0.22 - alpha) / 0.14, 0, 1); CL = lerp(lin, -0.5, post); }
  s.stall = clamp((alpha - (aS - 0.06)) / 0.06, 0, 1) * (vf > 5 ? 1 : 0);
  s.aoa = alpha;
  const ge = (() => { const x = (16 * (agl + 1.0)) / cfg.b; return (x * x) / (1 + x * x); })();
  const CD = cfg.CD0 + 0.03 * f + 0.016 * s.gear + cfg.k * (0.4 + 0.6 * ge) * CL * CL + 1.3 * Math.sin(alpha) ** 2 * post + 0.35 * beta * beta;
  const L = q * cfg.S * CL;
  const D = q * cfg.S * CD;
  const acc = { F: [0, 0, 0], T: [0, 0, 0] };
  // body-frame forces
  const Lf = Vp > 1 ? (L * -vu) / Vp : 0, Lu = Vp > 1 ? (L * vf) / Vp : L;
  // body-frame force: lift is perpendicular to the airflow, drag opposes it, thrust pulls along -Z
  const Fb = [
    -q * cfg.S * cfg.CYb * beta - (V > 0.5 ? (D * vr) / V : 0),
    Lu - (V > 0.5 ? (D * vu) / V : 0),
    -Lf + (V > 0.5 ? (D * vf) / V : 0) - thrust,
  ];
  const Fw = rot(s.q, Fb);
  acc.F[0] += Fw[0]; acc.F[1] += Fw[1]; acc.F[2] += Fw[2];
  // ---- moments ----
  const qS = q * cfg.S, ws = s.w, vv = 2 * Vs;
  const Mp = qc * cfg.S * cfg.c * cfg.Cmde * s.de + qS * cfg.c * (cfg.Cm0 + cfg.Cmflap * f + cfg.Cma * clamp(alpha, -0.5, 0.5) + (cfg.Cmq * ws[0] * cfg.c) / vv) * 1;
  const pRoll = -ws[2];
  const Lr = qS * cfg.b * (cfg.Clb * beta + (cfg.Clp * pRoll * cfg.b) / vv) + qc * cfg.S * cfg.b * cfg.Clda * s.da;
  const Ny = -qS * cfg.b * cfg.Cnb * beta - qc * cfg.S * cfg.b * cfg.Cndr * s.dr + qS * cfg.b * ((cfg.Cnr * ws[1] * cfg.b) / vv) + qS * cfg.b * cfg.Cnda * s.da
    + (engineOn ? 380 * s.thr * Math.max(0, 1 - V / 55) : 0);
  acc.T[0] += Mp; acc.T[2] += -Lr; acc.T[1] += Ny;
  // stall buffet + wing drop
  s.buffet = s.stall;
  if (s.stall > 0) { acc.T[2] += (Math.random() - 0.5) * 2400 * s.stall + Math.sign(beta + 0.01 + s.w[1] * 0.1) * 900 * s.stall; acc.T[0] += (Math.random() - 0.5) * 700 * s.stall; }
  s.gLoad = clamp(rotInv(s.q, acc.F)[1] / (m * G), -5, 9);
  // ---- gear & ground ----
  s.onGround = false; s.nGround = 0; s.wheelLoad = 0; s.impact.wheel = 0; s.impact.hull = 0; s.impact.rotor = 0;
  const up = att.up;
  const wheelsOut = s.gear > 0.9;
  const hdgF = [att.fwd[0], 0, att.fwd[2]], hl = Math.hypot(hdgF[0], hdgF[2]) || 1;
  for (const w of cfg._wheels) {
    if (!wheelsOut) break;
    const wp = rot(s.q, w.r0), x = s.p[0] + wp[0], y = s.p[1] + wp[1], z = s.p[2] + wp[2];
    const pen = ground(x, z) - (y - w.r);
    if (pen <= 0) continue;
    const vp = pointVel(s, w.r0), vn = vp[1];
    if (vn < 0 && -vn > s.impact.wheel) s.impact.wheel = -vn;
    let Fn = w.k * Math.min(pen, w.travel) + (pen > w.travel ? w.k * 6 * (pen - w.travel) : 0) - w.c * (vn < 0 ? vn : vn * 0.4);
    Fn = clamp(Fn, 0, cfg.mass * G * 8);
    s.onGround = true; s.nGround++; s.wheelLoad += Fn;
    // wheel axes on the ground plane
    let ang = 0;
    if (w.nose) ang = s.steer;
    const fw = rot(s.q, [-Math.sin(ang), 0, -Math.cos(ang)]);
    let fx = fw[0], fz = fw[2]; const fl = Math.hypot(fx, fz) || 1; fx /= fl; fz /= fl;
    const rx = -fz, rz = fx;
    const vlong = vp[0] * fx + vp[2] * fz, vlat = vp[0] * rx + vp[2] * rz;
    const mu = 0.9, rr = 0.03 + (s.cfg._grass ? 0.02 : 0);
    let Flong = -(rr + (w.brake ? 0.55 * (ctl.brake || 0) : 0)) * Fn * Math.tanh(vlong * 1.5);
    if (w.nose && !wheelsOut) Flong = 0;
    const Flat = -mu * Fn * Math.tanh(vlat * 3);
    applyAt(s, acc, w.r0, [fx * Flong + rx * Flat, Fn, fz * Flong + rz * Flat]);
    if (w.brake) s.wheelAng += (vlong / w.r) * dt * 0.5;
  }
  hullContacts(s, acc, cfg.mass * 70, ground);
  if (s.impact.hull > 0) s.onGround = true;
  integrate(s, acc, dt, m);
  // fuel
  if (engineOn) s.fuel = Math.max(0, s.fuel - cfg.burn * (0.2 + 0.8 * s.thr) * dt);
  s.V = V; s.vf = vf;
}

// ======================================================================================
// HELICOPTER
// ======================================================================================
/**
 * ctl = { pitch (+ = nose DOWN / forward), roll (+ = bank right), yaw (+ = right pedal), up (+1 climb / -1 descend lever), colLever (manual 0..1), assist, engine }
 */
export function stepHeli(s, dt, ctl, ground) {
  const cfg = s.cfg, m = cfg.mass + s.fuel, att = attitude(s, s._att || (s._att = {}));
  s.tNow += dt;
  const slew = (cur, tgt, rate) => cur + clamp(tgt - cur, -rate * dt, rate * dt);
  const rh = rho(s.p[1]), dens = rh / 1.225;
  const engineOn = ctl.engine !== false && s.fuel > 0;
  s.engine = engineOn;
  const Vb = rotInv(s.q, s.v), vf = -Vb[2], vr = Vb[0], vu = Vb[1];
  const V = Math.hypot(vf, vr, vu), Vh = Math.hypot(s.v[0], s.v[2]);
  const hubW = rot(s.q, cfg.hub), hubY = s.p[1] + hubW[1];
  const agl = Math.max(0, s.p[1] - cfg._skids[0].r[1] - ground(s.p[0], s.p[2]));
  s.aglV = agl;
  // ---- rotor speed ----
  const axial = -dot(s.v, att.up); // + when the air flows up through the disc (descending)
  if (engineOn) {
    if (s.rpm < 0.92) s.rpm = Math.min(1, s.rpm + 0.17 * dt);
    else s.rpm += (1 - s.rpm) * Math.min(1, dt * 2.5);
  } else {
    s.rpm += (-(0.022 + 0.055 * s.col) + 0.011 * clamp(axial, 0, 15) * (s.col < 0.6 ? 1 : 0.35)) * dt;
    s.rpm = clamp(s.rpm, 0, 1.08);
  }
  const om = s.rpm, om2 = om * om;
  // ---- controls ----
  let ip = ctl.pitch, ir = ctl.roll, iy = ctl.yaw;
  const sas = !!ctl.assist && engineOn;
  let colTgt;
  if (sas) {
    const vz = s.v[1];
    let vzt;
    if (Math.abs(ctl.up) > 0.05) { vzt = ctl.up > 0 ? 6.5 * ctl.up : 5 * ctl.up; s.hold = null; }
    else { if (s.hold === null) s.hold = s.p[1]; vzt = clamp((s.hold - s.p[1]) * 0.9, -2.5, 2.5); }
    const tilt = Math.max(0.55, att.up[1]);
    s.cI = clamp(s.cI + (vzt - vz) * 0.05 * dt, -0.3, 0.3);
    colTgt = 1 / cfg.Tmax / tilt / Math.max(0.5, dens) + 0.085 * (vzt - vz) + s.cI;
    if (agl < 0.4 && vzt <= 0) colTgt = Math.min(colTgt, 0.42);
    colTgt = clamp(colTgt, 0, 1);
  } else { colTgt = ctl.colLever; s.cI = 0; if (!ctl.assist) s.hold = null; }
  s.col = slew(s.col, colTgt, sas ? 1.6 : 1.0);
  // fuselage attitude demands
  const grounded = s.nGround > 1 && agl < 0.5;
  let aP, aR, aY;
  const pitchRate = s.w[0], rollRate = -s.w[2];
  if (sas) {
    const tp = ip > 0 ? -0.38 * ip : 0.25 * -ip; // nose down = negative pitch
    const tr = 0.5 * ir; // right bank = positive roll
    aP = clamp((tp - att.pitch) * 7 - pitchRate * 3.2, -cfg.Ap * 2.2, cfg.Ap * 2.2) / cfg.Ap;
    aR = clamp((tr - att.roll) * 7 - rollRate * 3.4, -cfg.Ar * 2.2, cfg.Ar * 2.2) / cfg.Ar;
  } else { aP = -ip; aR = ir; }
  aP = clamp(aP, -2.2, 2.2); aR = clamp(aR, -2.2, 2.2);
  // thrust
  const ge = 1 + 0.28 * Math.pow(Math.max(0, 1 - (agl + 1.2) / (2.2 * cfg.R)), 2);
  const tl = 1 + 0.13 * sstep(Vh / 11) * (1 - sstep((Vh - 28) / 25));
  const vrs = 1 - 0.35 * sstep((axial - 5.5) / 5) * (1 - sstep(Vh / 7));
  const kV = 1 - 0.3 * Math.min(1.5, Math.pow(Vh / cfg.vne, 3));
  const Tn = cfg.Tmax * s.col * om2 * dens * tl * ge * vrs * kV; // thrust / weight(at base mass)
  const T = Tn * cfg.mass * G;
  // yaw
  const hdg = att.yaw, yawRate = s.w[1];
  let pedal;
  const torqueAcc = -cfg.torque * Tn * om;
  if (sas) {
    if (Math.abs(iy) > 0.05) { s.hdg = null; pedal = clamp((-iy * 1.4 - yawRate) * 3 / cfg.Ay + 0.4 * (Tn - 1), -1, 1); }
    else { if (s.hdg === null) s.hdg = hdg; pedal = clamp(((angDiff(s.hdg, hdg)) * 2.4 - yawRate * 2.6) / cfg.Ay + 0.4 * (Tn - 1), -1, 1); }
  } else pedal = clamp(-iy * 0.8, -1, 1);
  const tailAcc = cfg.Ay * om * (pedal + 0.4);
  aY = torqueAcc + tailAcc;
  // ---- forces ----
  const acc = { F: [0, 0, 0], T: [0, 0, 0] };
  const up = att.up;
  // rotor thrust along the mast + heave and in-plane damping
  const Fr = T;
  acc.F[0] += up[0] * Fr; acc.F[1] += up[1] * Fr; acc.F[2] += up[2] * Fr;
  const vax = dot(s.v, up);
  const dz = -cfg.kz * m * vax * om;
  acc.F[0] += up[0] * dz; acc.F[1] += up[1] * dz; acc.F[2] += up[2] * dz;
  const kh = cfg.kh * m * om;
  acc.F[0] -= kh * (s.v[0] - up[0] * vax); acc.F[1] -= kh * (s.v[1] - up[1] * vax); acc.F[2] -= kh * (s.v[2] - up[2] * vax);
  // fuselage drag
  const qd = 0.5 * rh;
  const Db = [-qd * cfg.cdA[1] * Math.abs(Vb[0]) * Vb[0], -qd * cfg.cdA[2] * Math.abs(Vb[1]) * Vb[1], -qd * cfg.cdA[0] * Math.abs(Vb[2]) * Vb[2]];
  const Dw = rot(s.q, Db); acc.F[0] += Dw[0]; acc.F[1] += Dw[1]; acc.F[2] += Dw[2];
  // ---- moments: control accelerations + damping + weathervane ----
  const Ip = cfg.Ip, Ir = cfg.Ir, Iy = cfg.Iy;
  const beta = Math.atan2(vr, Math.max(Math.abs(vf), 3)), sp = Math.min(1, V / 12);
  const wv = -0.4 * beta * sp;
  acc.T[0] += Ip * (cfg.Ap * om2 * aP - cfg.kq * s.w[0] * om);
  acc.T[2] += Ir * -(cfg.Ar * om2 * aR - cfg.kp * rollRate * om);
  acc.T[1] += Iy * (aY - cfg.ky * yawRate * (0.4 + 0.6 * om) + wv);
  // ---- ground ----
  s.onGround = false; s.nGround = 0; s.impact.wheel = 0; s.impact.hull = 0; s.impact.rotor = 0; s.skidSpeed = 0;
  for (const k of cfg._skids) {
    const wp = rot(s.q, k.r), x = s.p[0] + wp[0], y = s.p[1] + wp[1], z = s.p[2] + wp[2];
    const pen = ground(x, z) - y;
    if (pen <= 0) continue;
    const vp = pointVel(s, k.r), vn = vp[1];
    if (vn < 0 && -vn > s.impact.wheel) s.impact.wheel = -vn;
    const Fn = clamp(k.k * Math.min(pen, 0.4) - k.c * (vn < 0 ? vn : vn * 0.4), 0, cfg.mass * G * 8);
    s.onGround = true; s.nGround++;
    const hs = Math.hypot(vp[0], vp[2]);
    s.skidSpeed = Math.max(s.skidSpeed, hs);
    const f = -0.65 * Fn * Math.tanh(hs / 0.25) / (hs || 1);
    applyAt(s, acc, k.r, [vp[0] * f, Fn, vp[2] * f]);
  }
  hullContacts(s, acc, cfg.mass * 70, ground);
  // main rotor blades hitting the ground
  for (const rp of cfg._rotorPts) {
    if (om < 0.25) break;
    const wp = rot(s.q, rp), pen = ground(s.p[0] + wp[0], s.p[2] + wp[2]) - (s.p[1] + wp[1]);
    if (pen > 0) { s.impact.rotor = Math.max(s.impact.rotor, 6 + om * 10); s.impact.hull = Math.max(s.impact.hull, 6); s.impact.hullName = 'rotor'; }
  }
  if (s.onGround && s.nGround > 1) { // static friction on yaw so skids don't spin forever
    if (Tn < 0.6) s.w[1] *= 1 / (1 + 2.5 * dt);
  }
  integrate(s, acc, dt, m);
  if (engineOn) s.fuel = Math.max(0, s.fuel - cfg.burn * (0.2 + 0.8 * Math.min(1, s.col)) * dt);
  s.V = V; s.vf = vf; s.Tn = Tn; s.pedal = pedal; s.vh = Vh;
}
