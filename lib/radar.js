/**
 * Corner minimap + full map (M). Terrain bake, structures, players, bots. Size is configurable.
 * The minimap lives in a HUD zone (top-left or top-right, see hudLayout.js) so it can never sit on the kill feed or
 * any other element. Drag it to the other top corner to move it; the full map hides the rest of the HUD while open.
 */
import { MAP_HALF, LAKE, WATER_Y, naturalHeight } from './terrain.js';
import { colliders } from './collision.js';
import { settings } from './settings.js';

const FULL_SIZE = 640;
const MINI_RANGE = 220;
const BAKE = 512;
const SIDE_KEY = 'realmrange.minimap.side.v1';
const DRAG_PX = 8;
/** Which way the minimap world turns under you. Forward is (-sin yaw, -cos yaw), so +1 keeps "forward" pointing up.
 *  If the minimap ever turns the wrong way for you, flip this to -1. */
const MM_ROT = 1;
const HUD_FONT = '"Barlow Condensed","Bahnschrift","Arial Narrow",sans-serif';

const COL = {
  me: '#ffffff',
  foe: '#ff6b5a',
  bot: '#ff9a3c',
  botLeader: '#ffd24a',
  down: '#7a7a7a',
  ally: '#5dff9a',
  poi: '#e9e4d8',
  major: '#f5c76b',
  build: 'rgba(180,190,200,0.85)',
  struct: 'rgba(30,28,24,0.75)',
};

function loadSide() {
  try {
    const s = localStorage.getItem(SIDE_KEY);
    if (s === 'tl' || s === 'tr') return s;
  } catch (_) {}
  return 'tr';
}

function heightColor(h, x, z) {
  const lx = (x - LAKE.x) / LAKE.rx, lz = (z - LAKE.z) / LAKE.rz;
  if (lx * lx + lz * lz < 1.05 && h <= WATER_Y + 1.5) {
    const deep = Math.min(1, Math.max(0, (WATER_Y + 1 - h) / 6));
    const r = 30 + deep * 10, g = 80 + deep * 30, b = 110 + deep * 40;
    return `rgb(${r|0},${g|0},${b|0})`;
  }
  // elevation ramp: low valley green → mid olive → high rock/snow
  const t = Math.min(1, Math.max(0, (h + 20) / 160));
  if (t < 0.35) {
    const u = t / 0.35;
    return `rgb(${(40 + u * 30)|0},${(70 + u * 50)|0},${(35 + u * 20)|0})`;
  }
  if (t < 0.7) {
    const u = (t - 0.35) / 0.35;
    return `rgb(${(55 + u * 50)|0},${(90 + u * 20)|0},${(40 + u * 10)|0})`;
  }
  const u = (t - 0.7) / 0.3;
  return `rgb(${(110 + u * 80)|0},${(100 + u * 70)|0},${(70 + u * 80)|0})`;
}

function bakeTerrain() {
  const c = document.createElement('canvas');
  c.width = c.height = BAKE;
  const g = c.getContext('2d');
  const img = g.createImageData(BAKE, BAKE);
  const data = img.data;
  const step = (MAP_HALF * 2) / BAKE;
  for (let py = 0; py < BAKE; py++) {
    for (let px = 0; px < BAKE; px++) {
      const x = -MAP_HALF + (px + 0.5) * step;
      const z = -MAP_HALF + (py + 0.5) * step;
      const h = naturalHeight(x, z);
      const col = heightColor(h, x, z);
      const m = /rgb\((\d+),(\d+),(\d+)\)/.exec(col);
      const i = (py * BAKE + px) * 4;
      data[i] = +m[1]; data[i + 1] = +m[2]; data[i + 2] = +m[3]; data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // soft grid
  g.strokeStyle = 'rgba(255,255,255,0.04)';
  g.lineWidth = 1;
  for (let i = 0; i <= 8; i++) {
    const p = (i / 8) * BAKE;
    g.beginPath(); g.moveTo(p, 0); g.lineTo(p, BAKE); g.stroke();
    g.beginPath(); g.moveTo(0, p); g.lineTo(BAKE, p); g.stroke();
  }
  return c;
}

function worldToBake(x, z) {
  return [
    ((x + MAP_HALF) / (MAP_HALF * 2)) * BAKE,
    ((z + MAP_HALF) / (MAP_HALF * 2)) * BAKE,
  ];
}

function makeCanvas(size, id, css) {
  const c = document.createElement('canvas');
  c.id = id;
  c.width = c.height = size;
  c.style.cssText = `position:fixed;pointer-events:none;z-index:20;${css}`;
  document.body.appendChild(c);
  return c;
}

function miniPx() {
  return Math.max(80, Math.min(320, Math.round(settings.minimapSize || 160)));
}

function fullMapPx() {
  const pad = 16;
  return Math.max(200, Math.min(FULL_SIZE, window.innerWidth - pad * 2, window.innerHeight - pad * 2 - 40));
}

export function createRadar(pois) {
  const touch = document.body.classList.contains('mobile');
  let miniSize = miniPx();
  const terrain = bakeTerrain();
  // fixed top-right is only a fallback until the HUD zones exist; placeMini() then moves it into a zone
  const mini = makeCanvas(miniSize, 'radarMini', 'top:16px;right:16px;border-radius:50%;border:2px solid rgba(243,241,234,0.5);display:none;');
  const full = makeCanvas(FULL_SIZE, 'radarFull', 'left:50%;top:50%;transform:translate(-50%,-50%);border-radius:3px;border:1px solid rgba(243,241,234,0.35);box-shadow:0 12px 40px rgba(0,0,0,.55);display:none;z-index:40;');
  mini.style.setProperty('--mm', miniSize + 'px');
  const miniCtx = mini.getContext('2d');
  const fullCtx = full.getContext('2d');
  let fullOpen = false, active = false, legendT = 0, side = loadSide(), placed = false;

  const legend = document.createElement('div');
  legend.id = 'radarLegend';
  legend.style.cssText = 'position:fixed;left:50%;bottom:12px;transform:translateX(-50%);color:#f3f1ea;font:600 16px "Barlow Condensed","Bahnschrift","Arial Narrow",sans-serif;letter-spacing:.1em;text-transform:uppercase;background:linear-gradient(90deg,rgba(0,0,0,0),rgba(0,0,0,.65) 15%,rgba(0,0,0,.65) 85%,rgba(0,0,0,0));padding:6px 40px;display:none;z-index:41;max-width:90vw;text-align:center;';
  document.body.appendChild(legend);

  /** put the minimap into its HUD zone (retries each frame until the HUD has built its zones) */
  function placeMini() {
    const z = document.getElementById(side === 'tr' ? 'zTR' : 'zTL');
    if (!z) return false;
    if (mini.parentNode !== z) z.insertBefore(mini, z.firstChild);
    for (const p of ['position', 'top', 'right', 'left', 'bottom', 'transform', 'z-index']) mini.style.removeProperty(p);
    mini.style.pointerEvents = 'auto';
    mini.style.touchAction = 'none';
    mini.style.cursor = 'grab';
    return true;
  }

  // drag between top corners (desktop + touch)
  let drag = null;
  const endDrag = () => {
    for (const p of ['position', 'left', 'top', 'width', 'z-index', 'right', 'bottom', 'transform']) mini.style.removeProperty(p);
  };
  mini.style.pointerEvents = 'auto';
  mini.style.touchAction = 'none';
  full.style.pointerEvents = 'auto';
  mini.addEventListener('pointerdown', (e) => {
    if (!settings.showMinimap) return;
    e.preventDefault();
    e.stopPropagation();
    const r = mini.getBoundingClientRect();
    drag = { x: e.clientX, y: e.clientY, ox: e.clientX - r.left, oy: e.clientY - r.top, w: r.width, moved: false };
    try { mini.setPointerCapture(e.pointerId); } catch (_) {}
  });
  mini.addEventListener('pointermove', (e) => {
    if (!drag) return;
    e.preventDefault();
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) <= DRAG_PX) return;
      drag.moved = true;
      mini.style.setProperty('position', 'fixed', 'important');
      mini.style.setProperty('width', drag.w + 'px', 'important');
      mini.style.setProperty('z-index', '60', 'important');
    }
    mini.style.setProperty('left', (e.clientX - drag.ox) + 'px', 'important');
    mini.style.setProperty('top', (e.clientY - drag.oy) + 'px', 'important');
  });
  mini.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.moved) { toggleFull(); return; }
    endDrag();
    side = e.clientX < window.innerWidth / 2 ? 'tl' : 'tr';
    try { localStorage.setItem(SIDE_KEY, side); } catch (_) {}
    placeMini();
  });
  mini.addEventListener('pointercancel', () => {
    if (drag && drag.moved) { endDrag(); placeMini(); }
    drag = null;
  });
  full.addEventListener('pointerup', () => {
    if (fullOpen) toggleFull();
  });
  legend.style.pointerEvents = 'auto';
  legend.addEventListener('pointerup', () => {
    if (fullOpen) toggleFull();
  });

  function ensureMiniSize() {
    const want = miniPx();
    if (want === miniSize) return;
    miniSize = want;
    mini.width = mini.height = miniSize;
    mini.style.setProperty('--mm', miniSize + 'px');
  }

  let fullSize = FULL_SIZE;
  function ensureFullSize() {
    const want = fullMapPx();
    if (want === fullSize) return;
    fullSize = want;
    full.width = full.height = fullSize;
    full.style.width = fullSize + 'px';
    full.style.height = fullSize + 'px';
  }
  window.addEventListener('resize', ensureFullSize);

  function drawTerrainPatch(ctx, size, cx, cz, range) {
    // blit from baked map: world range size covers `range` meters around (cx,cz)
    const half = range;
    const x0 = cx - half, z0 = cz - half, x1 = cx + half, z1 = cz + half;
    const [sx0, sy0] = worldToBake(x0, z0);
    const [sx1, sy1] = worldToBake(x1, z1);
    ctx.drawImage(terrain, sx0, sy0, sx1 - sx0, sy1 - sy0, 0, 0, size, size);
  }

  function drawFullTerrain(ctx) {
    const s = ctx.canvas.width;
    ctx.drawImage(terrain, 0, 0, s, s);
  }

  function toMini(me, x, z, size, range) {
    const s = size / (2 * range);
    return [(x - me.x) * s + size / 2, (z - me.z) * s + size / 2];
  }

  function toFull(x, z, size) {
    const s = size || fullSize || FULL_SIZE;
    return [
      ((x + MAP_HALF) / (MAP_HALF * 2)) * s,
      ((z + MAP_HALF) / (MAP_HALF * 2)) * s,
    ];
  }

  function drawStructures(ctx, toPx, scale, me, range) {
    // world colliders near the player (or all for full map when range is huge)
    const r = range || MAP_HALF;
    const list = me
      ? colliders.filter((c) => {
          const mx = (c.minX + c.maxX) * 0.5, mz = (c.minZ + c.maxZ) * 0.5;
          return Math.abs(mx - me.x) < r + 40 && Math.abs(mz - me.z) < r + 40;
        })
      : colliders;
    ctx.fillStyle = COL.struct;
    for (const c of list) {
      if (c.ramp) continue;
      const [x0, y0] = toPx(c.minX, c.minZ);
      const [x1, y1] = toPx(c.maxX, c.maxZ);
      const w = Math.abs(x1 - x0), h = Math.abs(y1 - y0);
      if (w < 0.5 && h < 0.5) continue;
      if (x1 < 0 && x0 < 0) continue;
      ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.max(w, 1), Math.max(h, 1));
    }
  }

  function drawBuilds(ctx, build, toPx) {
    if (!build || !build.pieces) return;
    ctx.fillStyle = COL.build;
    for (const p of build.pieces.values()) {
      const g = p.geom;
      if (!g) continue;
      const [x0, y0] = toPx(g.minX ?? (g.x - g.w/2), g.minZ ?? (g.z - g.d/2));
      const [x1, y1] = toPx(g.maxX ?? (g.x + g.w/2), g.maxZ ?? (g.z + g.d/2));
      ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.max(Math.abs(x1 - x0), 1), Math.max(Math.abs(y1 - y0), 1));
    }
  }

  function drawPois(ctx, toPx, labels) {
    for (const p of pois || []) {
      const [x, y] = toPx(p.x, p.z);
      if (x < -10 || y < -10 || x > ctx.canvas.width + 10 || y > ctx.canvas.height + 10) continue;
      const major = p.tier === 'major';
      ctx.fillStyle = major ? COL.major : COL.poi;
      ctx.beginPath();
      ctx.arc(x, y, major ? 4 : 1.8, 0, Math.PI * 2);
      ctx.fill();
      if (labels && major) {
        ctx.font = '700 14px ' + HUD_FONT;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(0,0,0,.7)';
        ctx.strokeText((p.name || '').toUpperCase(), x + 7, y + 4);
        ctx.fillStyle = '#f3f1ea';
        ctx.fillText((p.name || '').toUpperCase(), x + 7, y + 4);
      }
    }
  }

  function dot(ctx, x, y, r, fill) {
    ctx.fillStyle = fill;
    ctx.strokeStyle = 'rgba(0,0,0,.7)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  function drawActors(ctx, me, remotes, enemies, toPx, playerFixed) {
    if (enemies) {
      for (const e of enemies) {
        if (!e.alive && (e.deathT || 0) > 4) continue;
        const [x, y] = toPx(e.x, e.z);
        if (x < -6 || y < -6 || x > ctx.canvas.width + 6 || y > ctx.canvas.height + 6) continue;
        dot(ctx, x, y, e.isLeader ? 4.5 : 3.5, !e.alive ? COL.down : e.isLeader ? COL.botLeader : COL.bot);
      }
    }
    if (remotes) {
      for (const r of remotes.values()) {
        const [x, y] = toPx(r.x, r.z);
        dot(ctx, x, y, 4, r.alive ? COL.foe : COL.down);
      }
    }
    // On the rotating minimap the player is drawn after restore (always faces up).
    if (playerFixed) return;
    // Full map: arrow pointing along your heading (forward = (-sin yaw, -cos yaw))
    const [mx, my] = toPx(me.x, me.z);
    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(-(me.yaw || 0));
    arrow(ctx);
    ctx.restore();
  }

  function arrow(ctx) {
    ctx.fillStyle = COL.me;
    ctx.strokeStyle = 'rgba(0,0,0,.85)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(5.5, 6);
    ctx.lineTo(0, 3);
    ctx.lineTo(-5.5, 6);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();
  }

  /** Everything drawn over the rotating minimap in screen space: tint, vignette, vision cone, rim, cardinals, you.
   *  theta = rotation applied to the world (clockwise radians). North ends up at theta clockwise from "up". */
  function drawMiniOverlay(ctx, size, theta) {
    const c = size / 2;
    ctx.fillStyle = 'rgba(8,12,16,0.2)';
    ctx.fillRect(0, 0, size, size);
    const vg = ctx.createRadialGradient(c, c, size * 0.28, c, c, c);
    vg.addColorStop(0, 'rgba(6,9,12,0)');
    vg.addColorStop(1, 'rgba(6,9,12,0.55)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, size, size);

    // vision cone
    const cr = c * 0.72;
    const cg = ctx.createRadialGradient(c, c, 0, c, c, cr);
    cg.addColorStop(0, 'rgba(255,255,255,0.26)');
    cg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = cg;
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.arc(c, c, cr, -Math.PI / 2 - 0.62, -Math.PI / 2 + 0.62);
    ctx.closePath();
    ctx.fill();

    // rim band + inner hairline
    const band = Math.max(8, Math.min(16, Math.round(size * 0.085)));
    ctx.lineWidth = band;
    ctx.strokeStyle = 'rgba(8,10,14,0.82)';
    ctx.beginPath();
    ctx.arc(c, c, c - band / 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(243,241,234,0.28)';
    ctx.beginPath();
    ctx.arc(c, c, c - band, 0, Math.PI * 2);
    ctx.stroke();

    // 30° ticks + cardinals, turning with the world
    const at = (bearingDeg, r) => {
      const a = theta + (bearingDeg * Math.PI) / 180;
      return [c + Math.sin(a) * r, c - Math.cos(a) * r];
    };
    ctx.strokeStyle = 'rgba(243,241,234,0.55)';
    ctx.lineWidth = 1.5;
    for (const b of [30, 60, 120, 150, 210, 240, 300, 330]) {
      const [x0, y0] = at(b, c - 1);
      const [x1, y1] = at(b, c - 1 - band * 0.45);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
    ctx.font = '700 ' + Math.round(band * 0.95) + 'px ' + HUD_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cards = [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']];
    for (const [b, t] of cards) {
      const [x, y] = at(b, c - band / 2);
      ctx.fillStyle = b === 0 ? '#ffc247' : 'rgba(243,241,234,0.85)';
      ctx.fillText(t, x, y + 0.5);
    }

    // you
    ctx.save();
    ctx.translate(c, c);
    arrow(ctx);
    ctx.restore();
  }

  function drawFrame(ctx, size, me, remotes, enemies, build, range, fullMap) {
    if (fullMap) {
      drawFullTerrain(ctx);
      const toPx = (x, z) => toFull(x, z, size);
      const scale = size / (MAP_HALF * 2);
      drawStructures(ctx, toPx, scale, null, MAP_HALF * 2);
      drawBuilds(ctx, build, toPx);
      drawPois(ctx, toPx, true);
      drawActors(ctx, me, remotes, enemies, toPx, false);
      ctx.strokeStyle = 'rgba(243,241,234,0.25)';
      ctx.lineWidth = 2;
      ctx.strokeRect(1, 1, size - 2, size - 2);
    } else {
      // Heading-up: you stay centred facing UP, the world turns under you.
      // Pad range so rotation never shows empty corners (the canvas is a circle on screen anyway).
      const r = range * 1.45;
      const theta = MM_ROT * (me.yaw || 0);
      ctx.fillStyle = '#2b4631';
      ctx.fillRect(0, 0, size, size);
      ctx.save();
      ctx.translate(size / 2, size / 2);
      ctx.rotate(theta);
      ctx.translate(-size / 2, -size / 2);
      drawTerrainPatch(ctx, size, me.x, me.z, r);
      const toPx = (x, z) => toMini(me, x, z, size, r);
      const scale = size / (2 * r);
      drawStructures(ctx, toPx, scale, me, r);
      drawBuilds(ctx, build, toPx);
      drawPois(ctx, toPx, false);
      drawActors(ctx, me, remotes, enemies, toPx, true);
      ctx.restore();
      drawMiniOverlay(ctx, size, theta);
    }
  }

  function updateLegend(me, remotes, enemies) {
    legend.replaceChildren();
    const bits = [];
    if (remotes && remotes.size) {
      for (const r of remotes.values()) {
        const d = Math.round(Math.hypot(r.x - me.x, r.z - me.z));
        bits.push(`${r.name} ${d}m ${r.alive ? 'alive' : 'down'}`);
      }
    }
    if (enemies && enemies.length) {
      const alive = enemies.filter((e) => e.alive).length;
      bits.push(`Bots ${alive}/${enemies.length}`);
    }
    legend.textContent = bits.length ? bits.join(' · ') : 'Map';
  }

  function toggleFull() {
    if (!active) return;
    fullOpen = !fullOpen;
    legendT = 0;
    document.body.classList.toggle('map-open', fullOpen);
  }

  return {
    /**
     * @param me player
     * @param remotes Map of remote players
     * @param dt
     * @param opts {{ active?: boolean, enemies?: array, build?: object }}
     */
    update(me, remotes, dt, opts = {}) {
      const show = opts.active !== false && settings.showMinimap;
      active = !!opts.active;
      const enemies = opts.enemies || null;
      const build = opts.build || null;

      if (!placed) placed = placeMini();
      document.body.classList.toggle('map-open', fullOpen && active);

      if (!active) {
        mini.style.display = full.style.display = legend.style.display = 'none';
        return;
      }

      if (fullOpen) {
        mini.style.display = 'none';
        full.style.display = legend.style.display = 'block';
        ensureFullSize();
        fullCtx.clearRect(0, 0, fullSize, fullSize);
        drawFrame(fullCtx, fullSize, me, remotes, enemies, build, MAP_HALF, true);
        if (legendT <= 0) { legendT = 0.25; updateLegend(me, remotes, enemies); }
        return;
      }

      full.style.display = legend.style.display = 'none';
      if (!show) {
        mini.style.display = 'none';
        return;
      }
      ensureMiniSize();
      mini.style.display = 'block';
      miniCtx.clearRect(0, 0, miniSize, miniSize);
      drawFrame(miniCtx, miniSize, me, remotes, enemies, build, MINI_RANGE, false);
    },
    toggleFull,
    isFullOpen: () => fullOpen,
    close() {
      fullOpen = false;
      active = false;
      document.body.classList.remove('map-open');
      mini.style.display = full.style.display = legend.style.display = 'none';
    },
  };
}
