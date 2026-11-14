/**
 * Natural body motion for the trailer's soldiers. Runs after the stock humanoid animation
 * (updateHumanoidAnim) and before the body-language clips in trailer.js overlay().
 * Only touches joints the stock animation / tickActor reset every frame, so nothing accumulates.
 */
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const wrapA = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const damp = (c, t, k, dt) => c + (t - c) * (1 - Math.exp(-k * dt));
const hash = (n) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };

/** per-soldier walking pace, so a squad never steps in lock-step */
export function paceOf(a) {
  if (a.pace == null) a.pace = 0.9 + 0.2 * hash(a.idx + 3);
  return a.pace;
}

/** the visible body yaw follows the wanted yaw with a lag; the remaining error becomes upper-body lead (a.lead) */
export function bodyYaw(a, dt) {
  if (a.vyaw == null || !a.init || a.free || a.bal) a.vyaw = a.yaw; // first frame after a cut, or airborne: snap
  const err = wrapA(a.yaw - a.vyaw);
  a.vyaw += err * (1 - Math.exp(-9 * dt));
  a.lead = clamp(wrapA(a.yaw - a.vyaw), -0.9, 0.9);
  return a.vyaw;
}

/** call when a soldier fires: the chest kicks back */
export function kickBody(a) { a.rec = Math.min(1.5, (a.rec || 0) + 1); }

export function naturalMotion(a, dt, T) {
  if (a.dead || a.bal || a.free) return;
  const u = a.ud, t = T + a.ph, aim = a.ads ? 0.45 : 1;
  // acceleration -> lean (forward when speeding up, back when stopping)
  const acc = (a.speed - (a.pSpd == null ? a.speed : a.pSpd)) / Math.max(dt, 1e-3);
  a.pSpd = a.speed;
  a.accS = damp(a.accS || 0, clamp(acc, -40, 40), 10, dt);
  a.rec = (a.rec || 0) * Math.exp(-9 * dt);
  const lean = -clamp(a.accS * 0.006, -0.16, 0.16); // chest.x: negative = forward
  const rc = a.rec;

  // upper body leads every turn: chest first, head a little further
  u.chest.rotation.y += (a.lead || 0) * 0.7;
  u.head.rotation.y += (a.lead || 0) * 0.5;

  const mv = clamp((a.speed - 0.3) / 1.5);
  if (mv > 0.001) {
    const k = clamp(a.speed / 8), ph = u.walkPhase, s = Math.sin(ph);
    u.hips.rotation.y += s * 0.09 * k * mv;
    u.hips.rotation.z += s * 0.07 * k * mv - a.turn * 0.04;
    u.chest.rotation.y += -s * 0.2 * k * mv * aim;
    u.chest.rotation.z += -s * 0.04 * k * mv;
    u.head.rotation.y += s * 0.16 * k * mv * aim; // eyes stay on target while the torso twists
    u.chest.rotation.x += -0.06 * k * mv;
    // combat stance: knees stay bent (pelvis dips, thighs forward, shins back)
    const d = (0.01 + 0.025 * k) * mv, th = Math.sqrt((2 * d) / 0.9);
    u.hips.position.y -= d;
    u.legL.thigh.rotation.x += th; u.legR.thigh.rotation.x += th;
    u.legL.shin.rotation.x -= 2 * th; u.legR.shin.rotation.x -= 2 * th;
  }
  if (mv < 0.999) { // standing: breathing, weight shift, looking around
    const i = 1 - mv, sway = Math.sin(t * 0.45);
    u.chest.rotation.x += Math.sin(t * 1.7) * 0.012 * i;
    u.head.rotation.y += (Math.sin(t * 0.55) * 0.5 + Math.sin(t * 1.3 + 2) * 0.2) * (a.ads ? 0.06 : 0.4) * i;
    u.head.rotation.x += Math.sin(t * 0.8 + 1) * 0.04 * i;
    u.hips.rotation.z += sway * 0.04 * i;
    u.hips.position.y += Math.sin(t * 1.7) * 0.004 * i;
    u.legL.thigh.rotation.x += sway * 0.05 * i; u.legR.thigh.rotation.x -= sway * 0.05 * i;
    u.legL.shin.rotation.x -= Math.max(0, sway) * 0.08 * i; u.legR.shin.rotation.x -= Math.max(0, -sway) * 0.08 * i;
  }
  // acceleration lean + firing recoil
  u.chest.rotation.x += lean * 0.7 + 0.06 * rc * (a.ads ? 0.6 : 1);
  u.hips.rotation.x += lean * 0.4;
  u.head.rotation.x += -0.03 * rc - lean * 0.3;
}
