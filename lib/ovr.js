/**
 * Per-weapon first-person pose overrides (Pose Tuner).
 * Shared by anim.js + menus.js.
 *
 * Schema (all fields optional — missing = use arsenal / TUNE defaults):
 *
 * OVR[weaponId] = {
 *   // continuous offsets (existing)
 *   grip:  [x,y,z],   // right-hand wrist offset on grip anchor
 *   fore:  [x,y,z],   // left-hand wrist offset on fore anchor
 *   hip:   [x,y,z],   // gun hip-position additive
 *   ads:   number,    // extra ADS distance along -Z
 *
 *   // full base poses (replace TUNE.fp.{long|short}.{hip|sprint|reload})
 *   hipPose:    { p:[x,y,z], r:[x,y,z] },
 *   sprintPose: { p:[x,y,z], r:[x,y,z] },
 *   reloadPose: { p:[x,y,z], r:[x,y,z] },
 *
 *   // IK poles (elbow aim) and resting left hand
 *   poleR: [x,y,z],
 *   poleL: [x,y,z],
 *   restL: [x,y,z],
 *   meleeOff: [x,y,z],
 *
 *   // base hand orientation / curl when not driven by a keyframe track
 *   rollR: number, curlR: number,
 *   rollL: number, curlL: number,
 *
 *   // per-finger curl 0..1.25 (index, middle, ring, pinky, thumb)
 *   fingersR: { index, middle, ring, pinky, thumb },
 *   fingersL: { index, middle, ring, pinky, thumb },
 *
 *   // timeline length multipliers (1 = default)
 *   reloadScale: number,
 *   cycleScale:  number,
 *
 *   // full timeline replacements (deep — only the keys you supply are used)
 *   // same shape as arsenal reloadSpec / cycle objects
 *   reload: { total, events, lh, rh, tracks, held, mag, ... },
 *   cycle:  { total, events, lh, rh, tracks, ... },
 * }
 *
 * Paste the output of "Copy Code" from the Pose Tuner here to make permanent.
 * Anything not listed falls back to the built-in defaults.
 */
export const OVR = {};
