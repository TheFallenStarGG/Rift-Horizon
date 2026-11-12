/** Shared registry for the special weapons: model builders + aim-button abilities. */
export const MODELS = {};     // model id -> (tex, KIT) => weapon model (same shape as weaponModels.js builders)
export const ABILITIES = {};  // ability id -> (A) => { name, cd, use(), update?(dt, mods), absorb?(dmg), status?(), reset?(), on?, replaceHit?, solo? }
