/**
 * Draws the live DOM HUD into a 2D canvas so recordings show exactly what the player sees: same layout
 * (hudLayout.js zones), colours, fonts, text, minimap, hit markers, scope / damage overlays, vehicle + skydive HUD...
 * It walks the real elements and paints their computed styles. Touch controls (#mobile) are skipped.
 *
 * Supported: backgrounds, linear + radial gradients, borders + radii, box shadows (outer + inset), text shadows,
 * opacity, scale / rotate / skew transforms, overflow clipping, <canvas> elements (minimap), inputs, wrapped text,
 * mix-blend-mode and the few pseudo-elements the HUD uses.
 * Not supported: backdrop blur, CSS filters, clip-path (the HUD doesn't use them).
 *
 * Usage: const cap = createHudCapture(); cap.draw(ctx2d, widthPx, heightPx);  // ctx2d should be a cleared canvas
 */

/** DOM roots painted, bottom to top */
const ROOTS = ['#hud', '#dropHud', '#radarFull', '#radarLegend', '#lotteryEdge', '#lotteryFlash'];
/** ids that never appear in recordings (add 'recProgress' here to hide the recording chip) */
const SKIP_IDS = new Set(['mobile', 'recProgress']);
const SKIP_TAGS = new Set(['STYLE', 'SCRIPT', 'NOSCRIPT', 'BR', 'TEMPLATE']);
/** elements whose ::before / ::after we paint (scope cross-hair lines, prompt progress fill) */
const PSEUDO_IDS = new Set(['scope', 'promptBar']);
const OFF = 20000; // canvas shadow trick: draw the shape far away and offset its shadow back
const IDENT = [1, 0, 0, 1];

const num = (s) => { const n = parseFloat(s); return Number.isFinite(n) ? n : 0; };
const len = (s, base) => (String(s).endsWith('%') ? (parseFloat(s) / 100) * base : num(s));
const isClear = (c) => !c || c === 'transparent' || /^rgba?\(\s*[\d.]+[\s,]+[\d.]+[\s,]+[\d.]+[\s,/]+0(\.0*)?\s*\)$/.test(c);

/** split on commas that are not inside parentheses */
function splitTop(s) {
  const out = [];
  let d = 0, cur = '';
  for (const ch of s) {
    if (ch === '(') d++;
    else if (ch === ')') d--;
    if (ch === ',' && d === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** 2x2 linear part of a computed transform */
function linearOf(t) {
  if (!t || t === 'none') return IDENT;
  const v = t.slice(t.indexOf('(') + 1, -1).split(',').map(Number);
  if (t.startsWith('matrix3d')) return [v[0], v[1], v[4], v[5]];
  return [v[0], v[1], v[2], v[3]];
}
const mul = (p, q) => [
  p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1],
  p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3],
];
const isIdent = (l) => Math.abs(l[0] - 1) < 1e-4 && Math.abs(l[3] - 1) < 1e-4 && Math.abs(l[1]) < 1e-4 && Math.abs(l[2]) < 1e-4;

/** "rgba(0, 0, 0, .5) 0px 4px 18px 0px inset, ..." -> [{ inset, color, ox, oy, blur, spread }] */
function parseShadows(s) {
  const out = [];
  for (const part of splitTop(s)) {
    const inset = /\binset\b/.test(part);
    const cm = /(rgba?\([^)]*\)|#[0-9a-f]{3,8})/i.exec(part);
    if (!cm) continue;
    const r = part.replace(cm[0], '').replace(/\binset\b/, '').trim().split(/\s+/).map(num);
    out.push({ inset, color: cm[0], ox: r[0] || 0, oy: r[1] || 0, blur: r[2] || 0, spread: r[3] || 0 });
  }
  return out;
}

/** color stops of a gradient. L = gradient length in px (to convert px stops). */
function parseStops(parts, L) {
  const stops = [];
  for (const p of parts) {
    const m = /^((?:rgba?|hsla?)\([^)]*\)|#[0-9a-f]{3,8}|[a-z]+)\s*(.*)$/i.exec(p.trim());
    if (!m) continue;
    const pos = m[2].trim() ? m[2].trim().split(/\s+/) : [];
    if (!pos.length) stops.push({ color: m[1], at: null });
    for (const t of pos.slice(0, 2)) stops.push({ color: m[1], at: t.endsWith('%') ? parseFloat(t) / 100 : L ? parseFloat(t) / L : 0 });
  }
  if (!stops.length) return null;
  if (stops[0].at == null) stops[0].at = 0;
  if (stops[stops.length - 1].at == null) stops[stops.length - 1].at = 1;
  for (let i = 0; i < stops.length;) {
    if (stops[i].at != null) { i++; continue; }
    let j = i;
    while (stops[j].at == null) j++;
    const a0 = stops[i - 1].at, a1 = stops[j].at;
    for (let k = i; k < j; k++) stops[k].at = a0 + ((a1 - a0) * (k - i + 1)) / (j - i + 1);
    i = j;
  }
  let mx = 0;
  for (const s of stops) { s.at = Math.max(mx, Math.min(1, s.at)); mx = s.at; }
  // CSS blends fully transparent stops without darkening; canvas does not: give them their neighbour's colour at alpha 0
  const orig = stops.map((s) => s.color);
  for (let k = 0; k < stops.length; k++) {
    if (!isClear(orig[k])) continue;
    let src = null;
    for (let d = 1; d < stops.length && !src; d++) {
      for (const n of [k - d, k + d]) if (orig[n] && !isClear(orig[n])) { src = orig[n]; break; }
    }
    const m = src && /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(src);
    if (m) stops[k].color = `rgba(${m[1]},${m[2]},${m[3]},0)`;
  }
  return stops;
}

/** rounded rect path with elliptical corners (tl, tr, br, bl), added to any context */
function rrAdd(c, x, y, w, h, r) {
  const [tl, tr, br, bl] = r, P = Math.PI;
  c.moveTo(x + tl[0], y);
  c.lineTo(x + w - tr[0], y);
  if (tr[0] > 0 && tr[1] > 0) c.ellipse(x + w - tr[0], y + tr[1], tr[0], tr[1], 0, -P / 2, 0);
  c.lineTo(x + w, y + h - br[1]);
  if (br[0] > 0 && br[1] > 0) c.ellipse(x + w - br[0], y + h - br[1], br[0], br[1], 0, 0, P / 2);
  c.lineTo(x + bl[0], y + h);
  if (bl[0] > 0 && bl[1] > 0) c.ellipse(x + bl[0], y + h - bl[1], bl[0], bl[1], 0, P / 2, P);
  c.lineTo(x, y + tl[1]);
  if (tl[0] > 0 && tl[1] > 0) c.ellipse(x + tl[0], y + tl[1], tl[0], tl[1], 0, P, P * 1.5);
  c.closePath();
}

function radiiOf(cs, w, h) {
  const rd = (k) => {
    const p = cs[k].split(' ');
    return [len(p[0], w), len(p.length > 1 ? p[1] : p[0], h)];
  };
  let r = [rd('borderTopLeftRadius'), rd('borderTopRightRadius'), rd('borderBottomRightRadius'), rd('borderBottomLeftRadius')];
  const f = Math.min(1,
    w / ((r[0][0] + r[1][0]) || 1e9), w / ((r[3][0] + r[2][0]) || 1e9),
    h / ((r[0][1] + r[3][1]) || 1e9), h / ((r[1][1] + r[2][1]) || 1e9));
  if (f < 1) r = r.map(([a, b]) => [a * f, b * f]);
  return r;
}
const shrink = (r, d) => r.map(([a, b]) => [Math.max(0, a - d), Math.max(0, b - d)]);

export function createHudCapture() {
  let ctx = null;
  let S = 1; // output pixels per CSS pixel
  const range = document.createRange();
  const ascCache = new Map();
  const insetCache = new Map();

  const into = (g) => {
    ctx.translate(g.cx, g.cy);
    if (!g.ident) ctx.transform(g.l[0], g.l[1], g.l[2], g.l[3], 0, 0);
  };
  const outOf = (g) => {
    if (!g.ident) {
      const d = g.l[0] * g.l[3] - g.l[1] * g.l[2];
      ctx.transform(g.l[3] / d, -g.l[1] / d, -g.l[2] / d, g.l[0] / d, 0, 0);
    }
    ctx.translate(-g.cx, -g.cy);
  };

  // ---------- gradients ----------
  function paintGradient(css, x, y, w, h, a) {
    const m = /^(repeating-)?(linear|radial)-gradient\(([\s\S]*)\)$/.exec(css.trim());
    if (!m || m[1]) return;
    const parts = splitTop(m[3]);
    const head = /^(rgba?|hsla?)\(|^#|^transparent|^currentcolor/i.test(parts[0]) ? '' : parts.shift();
    ctx.globalAlpha = a;

    if (m[2] === 'linear') {
      let deg = 180;
      if (head) {
        const d = /(-?[\d.]+)(deg|rad|turn|grad)/.exec(head);
        if (d) {
          const v = parseFloat(d[1]);
          deg = d[2] === 'deg' ? v : d[2] === 'rad' ? (v * 180) / Math.PI : d[2] === 'turn' ? v * 360 : v * 0.9;
        } else if (/^to /.test(head)) {
          const t = head.slice(3).trim().split(/\s+/);
          const th = (Math.atan2(w, h) * 180) / Math.PI;
          const top = t.includes('top'), bot = t.includes('bottom'), lf = t.includes('left'), rt = t.includes('right');
          deg = top && rt ? th : top && lf ? -th : bot && rt ? 180 - th : bot && lf ? 180 + th : top ? 0 : rt ? 90 : bot ? 180 : 270;
        }
      }
      const rad = (deg * Math.PI) / 180, sx = Math.sin(rad), sy = -Math.cos(rad);
      const L = Math.abs(w * sx) + Math.abs(h * sy);
      const stops = parseStops(parts, L);
      if (!stops) return;
      const cx = x + w / 2, cy = y + h / 2;
      const g = ctx.createLinearGradient(cx - (sx * L) / 2, cy - (sy * L) / 2, cx + (sx * L) / 2, cy + (sy * L) / 2);
      for (const s of stops) g.addColorStop(s.at, s.color);
      ctx.fillStyle = g;
      ctx.fillRect(x, y, w, h);
      return;
    }

    // radial
    let cxp = x + w / 2, cyp = y + h / 2, circle = false, size = 'farthest-corner', explicit = null;
    if (head) {
      circle = /circle/.test(head);
      const at = /\bat\s+(.+)$/.exec(head);
      const pre = at ? head.slice(0, at.index) : head;
      const sz = /(closest|farthest)-(side|corner)/.exec(pre);
      if (sz) size = sz[0];
      const lens = pre.match(/-?[\d.]+(px|%)/g);
      if (lens) explicit = lens;
      if (at) {
        const tk = (t, s) => (t === 'left' || t === 'top' ? 0 : t === 'right' || t === 'bottom' ? s : t == null || t === 'center' ? s / 2 : len(t, s));
        const t = at[1].trim().split(/\s+/);
        let tx = t[0], ty = t[1];
        if (tx === 'top' || tx === 'bottom') { const tmp = tx; tx = ty || 'center'; ty = tmp; }
        cxp = x + tk(tx, w);
        cyp = y + tk(ty, h);
      }
    }
    const dxMax = Math.max(cxp - x, x + w - cxp), dyMax = Math.max(cyp - y, y + h - cyp);
    const dxMin = Math.min(cxp - x, x + w - cxp), dyMin = Math.min(cyp - y, y + h - cyp);
    let rx, ry;
    if (explicit) {
      rx = len(explicit[0], w);
      ry = circle || !explicit[1] ? rx : len(explicit[1], h);
    } else if (circle) {
      rx = ry = size === 'closest-side' ? Math.min(dxMin, dyMin)
        : size === 'farthest-side' ? Math.max(dxMax, dyMax)
        : size === 'closest-corner' ? Math.hypot(dxMin, dyMin) : Math.hypot(dxMax, dyMax);
    } else if (size === 'closest-side') { rx = dxMin; ry = dyMin; }
    else if (size === 'farthest-side') { rx = dxMax; ry = dyMax; }
    else if (size === 'closest-corner') { rx = dxMin * Math.SQRT2; ry = dyMin * Math.SQRT2; }
    else { rx = dxMax * Math.SQRT2; ry = dyMax * Math.SQRT2; }
    if (!(rx > 0 && ry > 0)) return;
    const stops = parseStops(parts, rx);
    if (!stops) return;
    ctx.save();
    ctx.translate(cxp, cyp);
    const k = ry / rx;
    ctx.scale(1, k);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    for (const s of stops) g.addColorStop(s.at, s.color);
    ctx.fillStyle = g;
    ctx.fillRect(x - cxp, (y - cyp) / k, w, h / k);
    ctx.restore();
  }

  // ---------- shadows ----------
  function outerShadow(sh, g, rad, a) {
    const w = g.w, h = g.h, sp = sh.spread;
    ctx.save();
    ctx.beginPath();
    ctx.rect(-1e5, -1e5, 2e5, 2e5);
    rrAdd(ctx, -w / 2, -h / 2, w, h, rad); // the box itself is not shadowed
    ctx.clip('evenodd');
    ctx.globalAlpha = a;
    const r2 = rad.map(([p, q]) => [p + (p > 0 ? sp : 0), q + (q > 0 ? sp : 0)]);
    if (sh.blur <= 0) {
      ctx.fillStyle = sh.color;
      ctx.beginPath();
      rrAdd(ctx, -w / 2 - sp + sh.ox, -h / 2 - sp + sh.oy, w + 2 * sp, h + 2 * sp, r2);
      ctx.fill();
    } else {
      ctx.shadowColor = sh.color;
      ctx.shadowBlur = sh.blur * S;
      ctx.shadowOffsetX = OFF + sh.ox * S;
      ctx.shadowOffsetY = sh.oy * S;
      ctx.translate(-OFF / S, 0);
      ctx.fillStyle = '#000';
      ctx.beginPath();
      rrAdd(ctx, -w / 2 - sp, -h / 2 - sp, w + 2 * sp, h + 2 * sp, r2);
      ctx.fill();
    }
    ctx.restore();
  }

  /** inset shadows (low-HP red edge, scope vignette) are pre-rendered once per size and reused */
  function insetShadow(sh, g, rad, a) {
    const w = g.w, h = g.h;
    const key = [w | 0, h | 0, sh.color, sh.blur, sh.spread, sh.ox, sh.oy, S.toFixed(3), rad[0][0]].join('|');
    let c = insetCache.get(key);
    if (!c) {
      if (insetCache.size > 6) insetCache.clear();
      c = document.createElement('canvas');
      c.width = Math.max(1, Math.ceil(w * S));
      c.height = Math.max(1, Math.ceil(h * S));
      const cg = c.getContext('2d');
      cg.scale(S, S);
      cg.beginPath();
      rrAdd(cg, 0, 0, w, h, rad);
      cg.clip();
      const m = sh.blur * 2 + Math.abs(sh.spread) + Math.max(Math.abs(sh.ox), Math.abs(sh.oy)) + 24;
      cg.shadowColor = sh.color;
      cg.shadowBlur = sh.blur * S;
      cg.shadowOffsetX = OFF + sh.ox * S;
      cg.shadowOffsetY = sh.oy * S;
      cg.translate(-OFF / S, 0);
      cg.beginPath();
      cg.rect(-m, -m, w + 2 * m, h + 2 * m);
      const sp = sh.spread;
      rrAdd(cg, sp, sp, w - 2 * sp, h - 2 * sp, shrink(rad, sp));
      cg.fillStyle = '#000';
      cg.fill('evenodd');
      insetCache.set(key, c);
    }
    ctx.globalAlpha = a;
    ctx.drawImage(c, -w / 2, -h / 2, w, h);
  }

  // ---------- box painting ----------
  function paintBackground(cs, g, rad, a) {
    const bc = cs.backgroundColor, bi = cs.backgroundImage, bs = cs.boxShadow;
    const hasBg = !isClear(bc), hasImg = bi && bi !== 'none';
    const shadows = bs && bs !== 'none' ? parseShadows(bs) : [];
    if (!hasBg && !hasImg && !shadows.length) return;
    ctx.save();
    into(g);
    const x = -g.w / 2, y = -g.h / 2;
    if (g.ident) for (const sh of shadows) if (!sh.inset) outerShadow(sh, g, rad, a);
    if (hasBg) {
      ctx.globalAlpha = a;
      ctx.fillStyle = bc;
      ctx.beginPath();
      rrAdd(ctx, x, y, g.w, g.h, rad);
      ctx.fill();
    }
    if (hasImg) {
      ctx.save();
      ctx.beginPath();
      rrAdd(ctx, x, y, g.w, g.h, rad);
      ctx.clip();
      const layers = splitTop(bi);
      for (let i = layers.length - 1; i >= 0; i--) paintGradient(layers[i], x, y, g.w, g.h, a);
      ctx.restore();
    }
    for (const sh of shadows) if (sh.inset) insetShadow(sh, g, rad, a);
    ctx.restore();
  }

  function paintBorder(cs, g, rad, bw, a) {
    if (!(bw[0] || bw[1] || bw[2] || bw[3])) return;
    const st = [cs.borderTopStyle, cs.borderRightStyle, cs.borderBottomStyle, cs.borderLeftStyle];
    const col = [cs.borderTopColor, cs.borderRightColor, cs.borderBottomColor, cs.borderLeftColor];
    const vis = (i) => bw[i] > 0 && st[i] !== 'none' && st[i] !== 'hidden' && !isClear(col[i]);
    ctx.save();
    into(g);
    ctx.globalAlpha = a;
    const x = -g.w / 2, y = -g.h / 2;
    if (bw[0] === bw[1] && bw[1] === bw[2] && bw[2] === bw[3] && col[0] === col[1] && col[1] === col[2] && col[2] === col[3] && vis(0)) {
      const hw = bw[0] / 2;
      ctx.lineWidth = bw[0];
      ctx.strokeStyle = col[0];
      ctx.beginPath();
      rrAdd(ctx, x + hw, y + hw, g.w - bw[0], g.h - bw[0], shrink(rad, hw));
      ctx.stroke();
    } else {
      if (vis(0)) { ctx.fillStyle = col[0]; ctx.fillRect(x, y, g.w, bw[0]); }
      if (vis(2)) { ctx.fillStyle = col[2]; ctx.fillRect(x, y + g.h - bw[2], g.w, bw[2]); }
      if (vis(1)) { ctx.fillStyle = col[1]; ctx.fillRect(x + g.w - bw[1], y + bw[0], bw[1], g.h - bw[0] - bw[2]); }
      if (vis(3)) { ctx.fillStyle = col[3]; ctx.fillRect(x, y + bw[0], bw[3], g.h - bw[0] - bw[2]); }
    }
    ctx.restore();
  }

  /** ::before / ::after boxes (only for a few known elements, and only when the parent isn't transformed) */
  function paintPseudo(el, cs, g, bw, which, a) {
    const ps = getComputedStyle(el, which);
    const c = ps.content;
    if (!c || c === 'none' || c === 'normal' || ps.display === 'none') return;
    const w = num(ps.width), h = num(ps.height);
    if (!(w > 0 && h > 0)) return;
    const ox = g.cx - g.w / 2 + bw[3], oy = g.cy - g.h / 2 + bw[0];
    let x, y;
    if (ps.position === 'absolute') { x = ox + num(ps.left) + num(ps.marginLeft); y = oy + num(ps.top) + num(ps.marginTop); }
    else { x = ox + num(cs.paddingLeft); y = oy + num(cs.paddingTop); }
    ctx.save();
    ctx.globalAlpha = a * (parseFloat(ps.opacity) || 1);
    if (!isClear(ps.backgroundColor)) { ctx.fillStyle = ps.backgroundColor; ctx.fillRect(x, y, w, h); }
    if (ps.backgroundImage && ps.backgroundImage !== 'none') {
      ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
      const layers = splitTop(ps.backgroundImage);
      for (let i = layers.length - 1; i >= 0; i--) paintGradient(layers[i], x, y, w, h, a);
    }
    ctx.restore();
  }

  // ---------- text ----------
  function setFont(cs) {
    const f = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    ctx.font = f;
    let asc = ascCache.get(f);
    if (asc == null) {
      const m = ctx.measureText('Hg');
      asc = m.fontBoundingBoxAscent != null ? m.fontBoundingBoxAscent : num(cs.fontSize) * 0.8;
      if (ascCache.size > 60) ascCache.clear();
      ascCache.set(f, asc);
    }
    return asc;
  }

  function setTextShadow(cs) {
    const ts = cs.textShadow;
    if (!ts || ts === 'none') return false;
    const sh = parseShadows(ts)[0];
    if (!sh) return false;
    ctx.shadowColor = sh.color;
    ctx.shadowBlur = sh.blur * S;
    ctx.shadowOffsetX = sh.ox * S;
    ctx.shadowOffsetY = sh.oy * S;
    return true;
  }
  function clearShadow() {
    ctx.shadowColor = 'rgba(0,0,0,0)';
    ctx.shadowBlur = 0;
    ctx.shadowOffsetX = ctx.shadowOffsetY = 0;
  }

  function drawText(tn, cs, a) {
    const raw = tn.data;
    if (!raw || !raw.trim() || isClear(cs.color)) return;
    const asc = setFont(cs);
    ctx.globalAlpha = a;
    ctx.fillStyle = cs.color;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    const shadow = setTextShadow(cs);
    const ls = cs.letterSpacing === 'normal' ? 0 : num(cs.letterSpacing);
    const native = 'letterSpacing' in ctx;
    if (native) ctx.letterSpacing = ls + 'px';
    const tf = cs.textTransform;
    const put = (s, rc) => {
      if (tf === 'uppercase') s = s.toUpperCase();
      else if (tf === 'lowercase') s = s.toLowerCase();
      else if (tf === 'capitalize') s = s.charAt(0).toUpperCase() + s.slice(1);
      const y = rc.top + asc;
      if (ls && !native) {
        let x = rc.left;
        for (const ch of s) { ctx.fillText(ch, x, y); x += ctx.measureText(ch).width + ls; }
      } else ctx.fillText(s, rc.left, y);
    };
    const re = /\S+/g;
    let m;
    while ((m = re.exec(raw))) {
      const word = m[0];
      range.setStart(tn, m.index);
      range.setEnd(tn, m.index + word.length);
      const rs = range.getClientRects();
      if (!rs.length) continue;
      if (rs.length === 1) put(word, rs[0]);
      else {
        // a word that wraps across lines: place it character by character
        for (let i = 0; i < word.length; i++) {
          range.setStart(tn, m.index + i);
          range.setEnd(tn, m.index + i + 1);
          const cr = range.getClientRects()[0];
          if (cr) put(word[i], cr);
        }
      }
    }
    if (native) ctx.letterSpacing = '0px';
    if (shadow) clearShadow();
  }

  function drawInput(el, cs, r, bw, a) {
    const txt = el.value || el.placeholder || '';
    if (!txt) return;
    setFont(cs);
    ctx.globalAlpha = a;
    ctx.fillStyle = el.value ? cs.color : 'rgba(255,255,255,.45)';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText(txt, r.left + bw[3] + num(cs.paddingLeft), r.top + r.height / 2);
    ctx.textBaseline = 'alphabetic';
  }

  // ---------- element walk ----------
  function node(el, L, alpha) {
    const tag = el.tagName;
    if (SKIP_TAGS.has(tag) || SKIP_IDS.has(el.id)) return;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return;
    const op = parseFloat(cs.opacity);
    if (!(op > 0.003)) return;
    const a = alpha * op;
    const l = cs.transform === 'none' ? L : mul(L, linearOf(cs.transform));
    if (Math.abs(l[0] * l[3] - l[1] * l[2]) < 1e-6) return;
    const ident = isIdent(l);
    const r = el.getBoundingClientRect();
    const w = ident ? r.width : el.offsetWidth, h = ident ? r.height : el.offsetHeight;
    const g = { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w, h, l, ident };
    const hasBox = w > 0.5 && h > 0.5;
    const bw = [num(cs.borderTopWidth), num(cs.borderRightWidth), num(cs.borderBottomWidth), num(cs.borderLeftWidth)];

    ctx.save();
    const bm = cs.mixBlendMode;
    if (bm && bm !== 'normal') { try { ctx.globalCompositeOperation = bm; } catch (_) {} }

    let rad = null;
    if (hasBox) {
      rad = radiiOf(cs, w, h);
      paintBackground(cs, g, rad, a);
      paintBorder(cs, g, rad, bw, a);
    }
    const inner = () => [-w / 2 + bw[3], -h / 2 + bw[0], w - bw[1] - bw[3], h - bw[0] - bw[2]];
    const innerRad = () => shrink(rad, Math.max(...bw) / 2);

    if (hasBox && tag === 'CANVAS' && el.width > 0 && el.height > 0) {
      ctx.save();
      into(g);
      ctx.globalAlpha = a;
      const [ix, iy, iw, ih] = inner();
      ctx.beginPath();
      rrAdd(ctx, ix, iy, iw, ih, innerRad());
      ctx.clip();
      try { ctx.drawImage(el, ix, iy, iw, ih); } catch (_) {}
      ctx.restore();
    }

    if (hasBox && (cs.overflowX !== 'visible' || cs.overflowY !== 'visible')) {
      into(g);
      const [ix, iy, iw, ih] = inner();
      ctx.beginPath();
      rrAdd(ctx, ix, iy, iw, ih, innerRad());
      ctx.clip(); // stays active for the children; restored at the end of this element
      outOf(g);
    }

    const pseudo = ident && PSEUDO_IDS.has(el.id);
    if (pseudo) paintPseudo(el, cs, g, bw, '::before', a);
    if ((tag === 'INPUT' || tag === 'TEXTAREA') && hasBox) drawInput(el, cs, r, bw, a);
    for (const c of el.childNodes) {
      if (c.nodeType === 3) drawText(c, cs, a);
      else if (c.nodeType === 1) node(c, l, a);
    }
    if (pseudo) paintPseudo(el, cs, g, bw, '::after', a);
    ctx.restore();
  }

  /** target: a cleared 2D canvas context of size outW x outH (the viewport is scaled to fit) */
  function draw(target, outW, outH) {
    ctx = target;
    const sx = outW / innerWidth, sy = outH / innerHeight;
    S = sx;
    ctx.save();
    ctx.scale(sx, sy);
    try {
      for (const sel of ROOTS) {
        const el = document.querySelector(sel);
        if (el) node(el, IDENT, 1);
      }
    } finally {
      ctx.restore();
    }
  }

  return { draw };
}
