/**
 * HUD skin: the look of every in-game HUD element (type, colour, shapes).
 * hudLayout.js still decides WHERE things sit; hud.js still drives WHAT they show.
 *
 * Recording note: hudCapture.js paints the DOM onto a canvas and can't do clip-path, filters, backdrop blur or
 * ::before/::after, so this file only uses plain boxes, borders, gradients, skew (on text-free bars) and real
 * child elements.
 *
 * Font: Barlow Condensed from Google Fonts, with condensed system fallbacks if it can't load (offline apps).
 */
const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&display=swap';

const CSS = `
:root{--hf:'Barlow Condensed','Bahnschrift','DIN Alternate','Arial Narrow','Roboto Condensed',system-ui,sans-serif;
  --ink:#f3f1ea;--dim:rgba(243,241,234,.62);--hot:#ff5a4a}
@keyframes hzMsg{from{opacity:0;letter-spacing:.16em}}
@keyframes hzHp{0%{transform:scale(1.14);color:var(--hot)}100%{transform:scale(1)}}
@keyframes hzBlink{50%{opacity:.25}}
#hud{font-family:var(--hf);color:var(--ink)}

/* ---------- screen effects ---------- */
#hud #dmgFlash{background:radial-gradient(ellipse at center,transparent 52%,rgba(150,0,0,.58) 100%)}
#hud #lowHp{box-shadow:inset 0 0 110px 26px rgba(170,0,0,.5)}
#hud .wedge i{left:-40px;top:-190px;width:80px;height:44px;border-radius:50% 50% 0 0 / 100% 100% 0 0;
  background:linear-gradient(to bottom,rgba(255,72,52,.95),rgba(255,72,52,0))}

/* ---------- crosshair / hit marker / reload ---------- */
#hud #cross i{background:#f6f4ee;box-shadow:0 0 0 1px rgba(0,0,0,.65);border-radius:0}
#hud #cross .t,#hud #cross .b{width:2px;height:8px;left:-1px}
#hud #cross .l,#hud #cross .r{height:2px;width:8px;top:-1px}
#hud #cross .t{top:calc(-8px - var(--g))}
#hud #cross .b{top:var(--g)}
#hud #cross .l{left:calc(-8px - var(--g))}
#hud #cross .r{left:var(--g)}
#hud #cross .dot{width:3px;height:3px;left:-1.5px;top:-1.5px;border-radius:50%}
#hud #hitm i{width:10px;height:2px;background:#f6f4ee;box-shadow:0 0 0 1px rgba(0,0,0,.55)}
#hud #hitm i:nth-child(1){transform:translate(-50%,-50%) translate(-13px,-13px) rotate(45deg)}
#hud #hitm i:nth-child(2){transform:translate(-50%,-50%) translate(13px,-13px) rotate(-45deg)}
#hud #hitm i:nth-child(3){transform:translate(-50%,-50%) translate(-13px,13px) rotate(-45deg)}
#hud #hitm i:nth-child(4){transform:translate(-50%,-50%) translate(13px,13px) rotate(45deg)}
#hud #hitm.head i{background:#ff9a2e}
#hud #hitm.kill i{background:#ff4a3a;width:16px;height:3px}
#hud > #reloadWrap{width:132px;margin-left:-66px}
#hud #reloadLabel{font:600 12px var(--hf);letter-spacing:.32em;color:var(--ink);margin-bottom:5px;opacity:.9}
#hud #reloadBar{height:3px;border:0;border-radius:0;background:rgba(255,255,255,.22)}
#hud #reloadFill{background:var(--acc)}

/* ---------- top centre: compass, score, status, messages, banner ---------- */
#zTC>#compass{order:-1}
#hud .hz > #compass{width:min(440px,100%);height:46px;overflow:hidden;
  background:linear-gradient(90deg,rgba(0,0,0,0),rgba(0,0,0,.34) 18%,rgba(0,0,0,.34) 82%,rgba(0,0,0,0))}
#compass .cl{position:absolute;top:3px;left:0;width:44px;margin-left:-22px;text-align:center;
  font:700 16px/1 var(--hf);letter-spacing:.04em;color:var(--dim);opacity:0}
#compass .cl.c{color:var(--ink);font-size:19px;top:1px}
#compass .cl.n{color:var(--acc)}
#compass .ct{position:absolute;top:24px;left:0;width:2px;margin-left:-1px;height:5px;background:rgba(243,241,234,.5);opacity:0}
#compass .ct.m{top:21px;height:9px;background:rgba(243,241,234,.9)}
#hud #cmMark{position:absolute;left:50%;top:19px;width:3px;height:15px;margin-left:-1.5px;background:var(--acc)}
#hud #cmVal{position:absolute;left:0;right:0;top:32px;text-align:center;font:700 14px/1 var(--hf);
  letter-spacing:.22em;text-indent:.22em;color:var(--acc)}
body[data-mode="lobby"] #compass,body.dropping #compass,body.mobile #compass{display:none!important}

#hud .hz > #score{display:flex;gap:26px;align-items:baseline;justify-content:center;background:none;border:0;
  border-radius:0;padding:0;margin-top:4px}
#hud #score .sc{display:flex;align-items:baseline;gap:7px}
#hud #score .sc span{font:600 13px var(--hf);letter-spacing:.22em;color:var(--dim)}
#hud #score .sc b{font:700 30px/1 var(--hf);color:var(--ink)}
#hud #score .sc:first-child b{color:var(--acc)}
#hud .hz > #status{font:600 14px var(--hf);letter-spacing:.22em;color:var(--dim);text-transform:uppercase;opacity:1}
#hud .hz > #msg{font:600 21px var(--hf);letter-spacing:.06em;color:#fff;padding:6px 40px;border-radius:0;max-width:min(620px,100%);
  background:linear-gradient(90deg,rgba(0,0,0,0),rgba(0,0,0,.55) 22%,rgba(0,0,0,.55) 78%,rgba(0,0,0,0))}
#hud .hz > #msg.show{animation:hzMsg .25s ease-out}
#hud #bannerTitle{font:700 clamp(28px,5.5vh,48px)/1 var(--hf);letter-spacing:.28em;text-indent:.28em;text-transform:uppercase;color:#fff}
#hud #bannerSub{font:600 clamp(18px,3.8vh,30px) var(--hf);letter-spacing:.2em;text-indent:.2em;color:var(--acc);margin-top:6px}

/* ---------- death screen ---------- */
#hud #respawn{background:radial-gradient(ellipse at center,rgba(0,0,0,0) 30%,rgba(50,0,0,.72) 100%)}
#hud #respawnTitle{align-self:stretch;text-align:center;padding:16px 0 4px;font:700 clamp(40px,8vh,68px)/1 var(--hf);
  letter-spacing:.34em;text-indent:.34em;color:var(--hot);
  background:linear-gradient(90deg,rgba(0,0,0,0),rgba(0,0,0,.62) 22%,rgba(0,0,0,.62) 78%,rgba(0,0,0,0))}
#hud #respawnCt{align-self:stretch;text-align:center;margin:0;padding:2px 0 16px;font:600 clamp(18px,3.2vh,26px) var(--hf);
  letter-spacing:.2em;text-indent:.2em;color:var(--ink);
  background:linear-gradient(90deg,rgba(0,0,0,0),rgba(0,0,0,.62) 22%,rgba(0,0,0,.62) 78%,rgba(0,0,0,0))}

/* ---------- top left / right ---------- */
#hud .hz > #fps{font:600 13px var(--hf);letter-spacing:.1em;opacity:.75}
#hud .hz > #playerList{font:500 14px/1.35 var(--hf);opacity:.85}
#hud #killfeed .kf{padding:3px 12px 3px 36px;border:0;border-right:3px solid rgba(255,255,255,.3);border-radius:0;
  background:linear-gradient(90deg,rgba(0,0,0,0),rgba(0,0,0,.6) 45%);font:600 18px var(--hf);letter-spacing:.04em;gap:9px;align-items:center}
#hud #killfeed .kf.k{border-right-color:var(--acc);background:linear-gradient(90deg,rgba(255,194,71,0),rgba(110,76,8,.6) 45%)}
#hud #killfeed .kf.d{border-right-color:var(--hot);background:linear-gradient(90deg,rgba(255,90,74,0),rgba(110,18,12,.62) 45%)}
#hud #killfeed .kf b{font-weight:700}
#hud #killfeed .kf b.you{color:var(--acc)}
#hud #killfeed .kf .ico{opacity:.75;font-size:15px}
#hud #killfeed .kf .ico.hs{opacity:1;color:#ff9a2e}

/* ---------- scoreboard ---------- */
#hud .hz > #board{width:min(480px,100%);background:linear-gradient(180deg,rgba(14,17,23,.94),rgba(8,10,14,.94));
  border:0;border-top:3px solid var(--acc);border-radius:0;padding:14px 18px 10px}
#hud #boardTitle{font:700 18px var(--hf);letter-spacing:.3em;color:var(--ink);margin-bottom:10px}
#hud #board table{font:500 17px var(--hf)}
#hud #board td{padding:5px 8px;border-bottom:1px solid rgba(255,255,255,.07)}
#hud #board td + td{font-family:var(--hf);font-weight:700;width:60px}
#hud #board tr.hd td{font:700 12px var(--hf);letter-spacing:.22em;color:var(--dim);border-bottom:1px solid rgba(255,255,255,.2)}
#hud #board tr.me td{background:rgba(255,194,71,.14)}
#hud #board tr.me{background:none}

/* ---------- bottom left: health ---------- */
#hud .hz > #vitals{width:min(270px,100%)}
#hud #hpRow{display:flex;align-items:baseline;gap:10px}
#hud #hpNum{font:700 50px/.9 var(--hf);letter-spacing:.01em;min-width:2ch;transform-origin:left bottom}
#hud #hpNum.hit{animation:hzHp .4s ease-out}
#hud #hpLabel{font:600 13px var(--hf);letter-spacing:.24em;color:var(--dim)}
#hud #stance{margin:0 0 0 auto;font:600 13px var(--hf);letter-spacing:.18em;color:var(--acc);opacity:1}
#hud #hpBar{position:relative;height:9px;margin-top:7px;background:rgba(255,255,255,.14);border:0;overflow:hidden;transform:skewX(-14deg)}
#hud #hpBar i{position:absolute;left:0;top:0;width:100%;height:100%;transform-origin:left}
#hud #hpTrail{background:rgba(255,255,255,.55);transition:transform .55s ease-out .35s}
#hud #hpTrail.up{transition:none}
#hud #hpFill{background:var(--ink);transition:transform .12s}
#hud #hpFill.low{background:var(--hot)}
#hud #hpTicks{position:absolute;left:0;top:0;right:0;bottom:0;display:flex}
#hud #hpTicks u{flex:1;border-right:3px solid rgba(7,9,13,.9);text-decoration:none}
#hud #hpTicks u:last-child{border-right:0}
#hud #vitals.low #hpNum{color:var(--hot)}

/* ---------- bottom right: weapon + ammo ---------- */
#hud .hz > #ammoBox{text-align:right}
#hud #weaponName{font:600 15px var(--hf);letter-spacing:.2em;color:var(--acc);margin:0 0 3px;text-transform:uppercase}
#hud #ammoRow{display:flex;align-items:baseline;justify-content:flex-end;gap:8px}
#hud #ammoCur{font:700 68px/.85 var(--hf);letter-spacing:.01em}
#hud #ammoCur.low{color:var(--hot)}
#hud #ammoRes{font:600 28px/1 var(--hf);color:var(--dim);margin:0}
#hud #pips{display:flex;justify-content:flex-end;flex-wrap:wrap;gap:2px;margin:8px 0 0 auto;max-width:min(210px,100%)}
#hud #pips i{width:4px;height:11px;background:var(--ink);transform:skewX(-14deg)}
#hud #pips i.off{background:rgba(255,255,255,.2)}
#hud #pips.many i{width:2px;height:7px}
#hud #ammoHint{font:700 14px var(--hf);letter-spacing:.26em;color:var(--acc);margin-top:6px}
#hud #ammoHint:empty{display:none}
#hud #ammoHint.empty{color:var(--hot);animation:hzBlink .8s steps(1) infinite}
#hud #camMode{font:600 12px var(--hf);letter-spacing:.24em;color:var(--dim);margin-top:6px;opacity:1}
#hud #camMode:empty{display:none}
#hud #ammoBox.nogun #ammoRow,#hud #ammoBox.nogun #pips,#hud #ammoBox.nogun #ammoHint{display:none}
#hud #ammoBox.nogun #weaponName{font-size:30px;color:var(--ink);letter-spacing:.1em}

/* ---------- bottom centre: hotbar, build bar, prompt, hint ---------- */
#hud .hz > #slots{gap:3px}
#hud .slot{min-width:0;padding:6px 14px 7px;background:linear-gradient(180deg,rgba(0,0,0,0),rgba(0,0,0,.4));border:0;
  border-bottom:2px solid rgba(255,255,255,.16);border-radius:0;font:600 15px var(--hf);letter-spacing:.12em;
  text-transform:uppercase;color:var(--dim);gap:9px;cursor:pointer}
#hud .slot b{display:inline-flex;align-items:center;justify-content:center;min-width:17px;height:17px;padding:0 3px;
  border:1px solid rgba(255,255,255,.35);border-radius:2px;font:700 12px var(--hf);letter-spacing:0;color:var(--dim)}
#hud .slot.on{color:#fff;border-bottom-color:var(--acc);background:linear-gradient(180deg,rgba(255,194,71,0),rgba(255,194,71,.22))}
#hud .slot.on b{background:var(--acc);border-color:var(--acc);color:#1a1205}

#hud .hz > #buildBar{background:linear-gradient(180deg,rgba(0,0,0,0),rgba(0,0,0,.45));border:0;border-bottom:2px solid rgba(255,255,255,.16);
  border-radius:0;padding:4px 6px;gap:2px;font:600 15px var(--hf)}
#hud #buildBar .bp,#hud #buildBar #buildTier{border:0;border-radius:0;background:transparent;color:var(--dim);padding:6px 12px;
  font:600 15px var(--hf);letter-spacing:.12em;text-transform:uppercase}
#hud #buildBar .bp i{font:700 11px var(--hf);margin-left:8px;padding:0 4px;border:1px solid rgba(255,255,255,.3);border-radius:2px;opacity:1}
#hud #buildBar .bp.on{color:#fff;background:linear-gradient(180deg,rgba(255,194,71,0),rgba(255,194,71,.24));box-shadow:inset 0 -2px 0 var(--acc)}
#hud #buildBar #buildTier{color:var(--acc)}
#hud #buildMats{font:700 18px var(--hf);color:var(--ink);min-width:40px;padding:0 6px}
#hud #buildWhy{font:600 14px var(--hf);letter-spacing:.1em;color:var(--hot)}

#hud .hz > #prompt{background:linear-gradient(90deg,rgba(0,0,0,0),rgba(0,0,0,.6) 18%,rgba(0,0,0,.6) 82%,rgba(0,0,0,0));
  border:0;border-radius:0;padding:8px 32px}
#hud #promptText{font:700 20px var(--hf);letter-spacing:.08em;color:#fff;text-transform:uppercase}
#hud #promptSub{font:500 14px var(--hf);letter-spacing:.06em;color:var(--dim);opacity:1;margin-top:2px}
#hud #promptBar{height:2px;background:rgba(255,255,255,.18);margin-top:6px}

#hud .hz > #hint{font:500 13px var(--hf);letter-spacing:.12em;text-transform:uppercase;opacity:.6}

/* ---------- chat ---------- */
#hud #chatLog{background:linear-gradient(90deg,rgba(0,0,0,.45),rgba(0,0,0,0));border-radius:0;padding:6px 10px;
  font:500 15px/1.35 var(--hf);opacity:1}
#hud #chatLog .name{color:var(--acc);font-weight:700}
#hud #chatInput{border-radius:0;border:0;border-bottom:2px solid var(--acc);background:rgba(0,0,0,.55);font:500 15px var(--hf)}
#hud #chatSend{border-radius:0;background:var(--acc);font:700 13px var(--hf);letter-spacing:.14em;text-transform:uppercase}

/* ---------- vehicle panel (light touch, same family) ---------- */
#hud #vhud{border-radius:0;border:0;border-bottom:2px solid var(--acc);
  background:linear-gradient(180deg,rgba(0,0,0,.2),rgba(0,0,0,.6));font-family:var(--hf)}
#hud #vhud .n{font-family:var(--hf);font-size:15px;letter-spacing:.14em;color:var(--acc)}
#hud #vhud .s{font-family:var(--hf);font-weight:700;font-size:44px}

/* ---------- touch ---------- */
body.mobile #hud #pips,body.mobile #hud #camMode,body.mobile #hud #stance,body.mobile #hud #hpLabel,
body.mobile #hud #playerList,body.mobile #hud #hint{display:none}
body.mobile #hud #hpNum{font-size:30px}
body.mobile #hud #hpBar{height:7px;margin-top:5px}
body.mobile #hud #ammoCur{font-size:42px}
body.mobile #hud #ammoRes{font-size:20px}
body.mobile #hud #weaponName{font-size:12px}
body.mobile #hud .slot{padding:4px 8px;font-size:12px}
body.mobile #hud #score .sc b{font-size:22px}
`;

export function installHudSkin() {
  if (document.getElementById('hudSkinCss')) return;
  try {
    if (!document.getElementById('hudSkinFont')) {
      const l = document.createElement('link');
      l.id = 'hudSkinFont';
      l.rel = 'stylesheet';
      l.href = FONT_HREF;
      document.head.appendChild(l);
    }
  } catch (_) {}
  const s = document.createElement('style');
  s.id = 'hudSkinCss';
  s.textContent = CSS; // appended after hudLayout's CSS, so it wins on equal specificity
  document.head.appendChild(s);
}
