/**
 * HUD layout manager.
 * Every on-screen element lives in one zone of a CSS grid (3 columns x 3 rows). Zones can't overlap each other,
 * and elements inside one zone stack in a flex column, so nothing can ever sit on top of anything else.
 * The exact center of the screen (crosshair, hit marker, reload bar) is kept clear.
 *
 *   TL  TC  TR      top:    stats / messages / minimap + kill feed
 *   ML  --  MR      middle: skydive altitude gauge, dev bar
 *   BL  BC  BR      bottom: chat + health / prompts + weapon slots / ammo
 *
 * Elements that other modules create themselves (vehicle HUD, Ridgeback badge, recorder bar, dev bar, skydive HUD,
 * offline banner) are moved into zones automatically when they appear.
 * Debug: add ?hudcheck to the URL (outlines zones + logs overlaps), or call hudCheck() in the console.
 */

const CSS = `
@keyframes hzFade{from{opacity:0}}
@keyframes hzHintGone{to{opacity:0;max-height:0;padding:0;overflow:hidden}}

/* ---------- grid + zones ---------- */
#hud > #hudGrid{inset:0;z-index:1;pointer-events:none;display:grid;column-gap:12px;
  --rail:clamp(150px,23vw,340px);
  grid-template-columns:var(--rail) minmax(0,1fr) var(--rail);
  grid-template-rows:auto minmax(0,1fr) auto;
  padding:calc(12px + var(--sa,0px)) max(16px,env(safe-area-inset-right,0px)) calc(14px + var(--sb,0px)) max(16px,env(safe-area-inset-left,0px));
  transition:padding .5s ease}
#hudGrid .hz{display:flex;flex-direction:column;gap:6px;min-width:0;min-height:0;overflow:hidden;pointer-events:none}
#zTL{grid-area:1/1;align-items:flex-start;max-height:38vh}
#zTC{grid-area:1/2;align-items:center;max-height:calc(50vh - 90px - var(--sa,0px))}
#zTR{grid-area:1/3;align-items:flex-end;max-height:38vh}
#zML{grid-area:2/1;align-items:flex-start;justify-content:center}
#zMR{grid-area:2/3;align-items:flex-end;justify-content:center}
#zBL{grid-area:3/1;align-items:flex-start;justify-content:flex-end;max-height:38vh}
#zBC{grid-area:3/2;align-items:center;justify-content:flex-end;max-height:calc(50vh - 124px - var(--sb,0px))}
#zBR{grid-area:3/3;align-items:flex-end;justify-content:flex-end;max-height:38vh}

/* anything inside a zone is laid out by the zone, never by its own old coordinates */
#hud .hz > *{position:relative!important;left:auto!important;right:auto!important;top:auto!important;bottom:auto!important;
  transform:none!important;margin:0!important;z-index:auto!important;flex:0 0 auto;max-width:100%}

/* ---------- order inside each zone ---------- */
#zTL>#radarMini{order:0} #zTL>#recProgress{order:1} #zTL>#fps{order:2} #zTL>#playerList{order:3}
#zTL>#vitals{order:4} #zTL>#vhud{order:5} #zTL>#chatWrap{order:6}
#zTC>#riftOfflineBanner{order:0} #zTC>#score{order:1} #zTC>#status{order:2} #zTC>#recProgress{order:3}
#zTC>#slots{order:4} #zTC>#buildBar{order:5} #zTC>#vprompt,#zTC>#prompt,#zTC>.dh-prompt{order:6}
#zTC>#lotteryBadge{order:7} #zTC>.dh-loc{order:8} #zTC>.dh-zone{order:9} #zTC>.dh-warn{order:10}
#zTC>#msg{order:11} #zTC>#banner{order:12} #zTC>#board{order:13}
#zTR>#ammoBox{order:1} #zTR>#radarMini{order:2} #zTR>#killfeed{order:3}
#zBL>#chatWrap{order:1} #zBL>#vitals{order:2}
#zBC>#lotteryBadge{order:1} #zBC>#vprompt{order:2} #zBC>#prompt,#zBC>.dh-prompt{order:3} #zBC>#buildBar{order:4}
#zBC>#vhud{order:5} #zBC>#slots{order:6} #zBC>#fps{order:7} #zBC>#hint{order:8}

/* ---------- per-element sizing (looks stay as defined in index.html) ---------- */
#hud .hz > #fps:empty,#hud .hz > #playerList:empty,#hud .hz > #status:empty,#hud .hz > #msg:empty,#hud .hz > #killfeed:empty{display:none}
#hud .hz > #playerList{overflow-wrap:anywhere}
#hud .hz > #status{overflow:hidden;text-overflow:ellipsis}
#hud .hz > #msg{text-align:center;overflow-wrap:anywhere;padding:5px 14px;border-radius:6px;background:rgba(0,0,0,.38)}
#hud .hz > #banner{display:none;width:100%;text-align:center}
#hud .hz > #banner.on{display:block;animation:hzFade .2s ease-out}
#hud #bannerTitle{font-size:clamp(20px,4.4vh,36px)}
#hud #bannerSub{font-size:clamp(16px,3.6vh,30px)}
#hud .hz > #prompt{display:none;width:min(420px,100%);min-width:0}
#hud .hz > #prompt.on{display:block;animation:hzFade .15s ease-out}
#hud .hz > #board{width:min(420px,100%);flex:0 1 auto;min-height:0;min-width:0;overflow:auto}
#hud .hz > #killfeed{flex:0 1 auto;min-height:0;width:100%;justify-content:flex-end;overflow:hidden}
#hud #killfeed .kf{max-width:100%}
#hud #killfeed .kf b{min-width:0;max-width:9.5em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#hud .hz > #vitals{width:min(230px,100%)}
#hud .hz > #chatWrap{width:100%;max-width:340px}
#hud #chatLog{max-height:min(130px,16vh)}
#hud #pips{max-width:min(200px,100%)}
#hud .hz > #slots{flex-wrap:nowrap;justify-content:center;align-items:center;gap:5px;overflow:visible}
#hud .hz > #buildBar{flex-wrap:nowrap;justify-content:center;align-items:center;gap:6px;overflow:visible}
#hud .hz > #slots .slot{flex:0 0 auto;white-space:nowrap}
#hud .hz > #hint{text-align:center;padding:0 12px;max-height:4em;animation:hzHintGone 1s 18s forwards}
#hud > #reloadWrap{top:calc(50% + 74px)}

/* radar minimap (placed by radar.js) */
#hud #radarMini{width:min(var(--mm,160px),100%,24vh)!important;height:auto!important;aspect-ratio:1/1;box-sizing:border-box}

/* vehicle HUD / prompt, Ridgeback badge, recorder, dev bar, update banner */
#hud .hz > #vhud{width:min(190px,100%)}
#hud .hz > #vprompt{white-space:normal;text-align:center}
#hud .hz > #recProgress{width:min(420px,100%)}
#hud .hz > #recProgress.recording{width:auto}
#hud .hz > #recProgress:not(.recording){pointer-events:auto}
#hud .hz > #riftOfflineBanner{pointer-events:auto;width:auto}
#hud #zMR > #devBar{width:100%;max-height:100%;min-height:0}
#hud #zMR > #devBar.on{display:flex;flex-direction:column}
#hud #zMR > #devBar .shell{max-height:none;min-height:0;flex:0 1 auto}

/* skydive HUD pieces (dropship.js builds them, we place them) */
body:not(.dropping) #hud .hz > :is(.dh-loc,.dh-zone,.dh-warn,.dh-prompt,.dh-alt){display:none!important}
#hud .hz > :is(.dh-loc,.dh-zone,.dh-warn,.dh-prompt,.dh-alt):not(.on){display:none}
#hud .hz > :is(.dh-loc,.dh-zone,.dh-warn){width:100%;text-align:center}
#hud .hz > .dh-warn{font-size:clamp(24px,5vh,44px)}
#hud .hz > .dh-prompt{min-width:min(280px,100%)}
#hud .hz > .dh-alt{width:100%;text-align:left}
#hud .dh-alt .dh-gauge{margin-left:0;height:clamp(80px,20vh,200px)}
#hud .dh-alt .n{font-size:clamp(26px,5vh,40px)}
body.dropping #slots{display:none}

/* modal-ish states */
body.map-open #hud > #hudGrid{visibility:hidden}
body.editing #fps{display:none}

/* ---------- touch ---------- */
body.mobile #hud > #hudGrid{--rail:clamp(130px,22vw,260px);column-gap:8px;
  padding:calc(10px + var(--sa,0px)) max(12px,env(safe-area-inset-right,0px)) calc(8px + var(--sb,0px)) max(12px,env(safe-area-inset-left,0px))}
body.mobile #zTL,body.mobile #zTR{max-height:46vh}
body.mobile #zTC{max-height:calc(42vh - var(--sa,0px));overflow:visible}
body.mobile #zBC{
  max-height:none;
  justify-content:flex-end;
  padding-bottom:calc(12px + var(--sb,0px));
  overflow:visible;
}
/* Build piece / material bar sits bottom-center, clear of FIRE / AIM on the right */
body.mobile #hud #zBC > #buildBar{
  margin-bottom:8px!important;
  padding:6px 8px;
  border-radius:12px;
  background:rgba(8,10,14,.55);
  backdrop-filter:blur(6px);
}
body.mobile #hud #zTC > #slots{
  flex-wrap:nowrap!important;
  max-width:min(96vw,520px);
}
/* leave room for the PAUSE / CAM / REC buttons that sit under the health bar */
body.mobile #hud #zTL > #vitals{width:min(150px,100%);margin-bottom:64px!important}
body.mobile.in-vehicle #hud #zTL > #vitals{margin-bottom:6px!important}
/* the driving buttons (EXIT / CAM / LIGHTS ...) sit in the top-right corner: start the HUD below them */
body.mobile.in-vehicle #hud > #hudGrid{padding-top:calc(94px + var(--sa,0px))}
body.mobile #hud #chatLog{max-height:min(70px,12vh)}

/* black cinematic bars at the start of the hot drop: keep the HUD between them */
body.drop-cine #hud > #hudGrid{padding-top:calc(8vh + 12px + var(--sa,0px));padding-bottom:calc(8vh + 14px + var(--sb,0px))}

/* ---------- debug (?hudcheck) ---------- */
html.hud-debug #hudGrid .hz{outline:1px dashed rgba(0,255,255,.55)}
html.hud-debug #hudGrid .hz > *{outline:1px solid rgba(255,70,70,.7)}
`;

const ZONE_NAMES = ['TL', 'TC', 'TR', 'ML', 'MR', 'BL', 'BC', 'BR'];

const DESKTOP = {
  TL: ['fps', 'playerList'],
  TC: ['score', 'status', 'msg', 'banner', 'board'],
  TR: ['killfeed'],
  BL: ['chatWrap', 'vitals'],
  BC: ['prompt', 'buildBar', 'slots', 'hint'],
  BR: ['ammoBox'],
};
const MOBILE = {
  TL: ['vitals', 'chatWrap'],
  TC: ['score', 'status', 'slots', 'prompt', 'msg', 'banner', 'board'],
  TR: ['ammoBox', 'killfeed'],
  /* build type + material at bottom middle (not under REC / loadout at top) */
  BC: ['buildBar', 'fps'],
};
/** elements other modules create themselves: [desktop zone, touch zone] */
const LATE = {
  vhud: ['BC', 'TL'],
  vprompt: ['BC', 'TC'],
  lotteryBadge: ['BC', 'TC'],
  recProgress: ['TL', 'TL'],
  devBar: ['MR', 'MR'],
  riftOfflineBanner: ['TC', 'TC'],
};

let zones = null;
let mobile = false;

function adoptDrop(root) {
  const q = (s) => root.querySelector(s);
  for (const s of ['.dh-loc', '.dh-zone', '.dh-warn']) { const e = q(s); if (e) zones.TC.appendChild(e); }
  const p = q('.dh-prompt');
  if (p) zones[mobile ? 'TC' : 'BC'].appendChild(p);
  const a = q('.dh-alt');
  if (a) zones.ML.appendChild(a);
  const sync = () => document.body.classList.toggle('drop-cine', root.classList.contains('cine'));
  new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['class'] });
  sync();
}

function adopt(node) {
  if (!zones || !node || node.nodeType !== 1) return;
  if (node.closest && node.closest('#hudGrid')) return;
  if (node.id === 'dropHud') { adoptDrop(node); return; }
  const to = LATE[node.id];
  if (to) zones[to[mobile ? 1 : 0]].appendChild(node);
}

export function zone(name) { return zones ? zones[name] : null; }

export function initHudLayout() {
  if (zones) return zones;
  const hud = document.getElementById('hud');
  if (!hud) return null;
  mobile = document.body.classList.contains('mobile');

  const css = document.createElement('style');
  css.id = 'hudLayoutCss';
  css.textContent = CSS;
  document.head.appendChild(css);

  const grid = document.createElement('div');
  grid.id = 'hudGrid';
  zones = {};
  for (const n of ZONE_NAMES) {
    const z = document.createElement('div');
    z.id = 'z' + n;
    z.className = 'hz';
    grid.appendChild(z);
    zones[n] = z;
  }
  hud.appendChild(grid);

  const map = mobile ? MOBILE : DESKTOP;
  for (const [z, ids] of Object.entries(map)) {
    for (const id of ids) { const el = document.getElementById(id); if (el) zones[z].appendChild(el); }
  }

  // modules that already built their DOM, then everything that shows up later
  for (const id of [...Object.keys(LATE), 'dropHud']) adopt(document.getElementById(id));
  new MutationObserver((ms) => { for (const m of ms) m.addedNodes.forEach(adopt); }).observe(document.body, { childList: true });

  window.hudCheck = hudCheck;
  if (/[?&]hudcheck\b/.test(location.search)) {
    document.documentElement.classList.add('hud-debug');
    setInterval(() => hudCheck(true), 2000);
  }
  return zones;
}

/** Lists pairs of visible HUD elements that overlap. Returns the list (and warns in the console when log = true). */
export function hudCheck(log = true) {
  const items = [];
  const add = (name, el, clip) => {
    if (!el || !el.isConnected) return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) < 0.05) return;
    const r = el.getBoundingClientRect();
    let { left, top, right, bottom } = r;
    if (clip) {
      const c = clip.getBoundingClientRect();
      left = Math.max(left, c.left); top = Math.max(top, c.top); right = Math.min(right, c.right); bottom = Math.min(bottom, c.bottom);
    }
    if (right - left < 2 || bottom - top < 2) return;
    items.push({ name, el, left, top, right, bottom });
  };
  document.querySelectorAll('#hudGrid .hz').forEach((z) => {
    for (const el of z.children) add(z.id + ':' + (el.id || el.className), el, z);
  });
  const $ = (id) => document.getElementById(id);
  const rs = $('respawn');
  if (rs && rs.classList.contains('on')) { add('respawnTitle', $('respawnTitle')); add('respawnCt', $('respawnCt')); }
  add('reloadWrap', $('reloadWrap'));
  add('radarFull', $('radarFull'));
  if (mobile) document.querySelectorAll('#mobile .mb').forEach((b) => add('btn:' + b.id, b));
  const cross = $('cross');
  if (cross && parseFloat(getComputedStyle(cross).opacity) > 0.05) {
    const cx = innerWidth / 2, cy = innerHeight / 2;
    items.push({ name: 'crosshair', el: cross, left: cx - 66, right: cx + 66, top: cy - 66, bottom: cy + 66 });
  }
  const out = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const a = items[i], b = items[j];
      if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
      if (a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2) out.push([a.name, b.name]);
    }
  }
  if (log && out.length) console.warn('[hud] overlapping elements:', out);
  return out;
}
