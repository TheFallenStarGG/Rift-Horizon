/**
 * Minimap + full map for the 12 km world.
 *
 *  - Terrain is baked with the SAME colour rules as terrainMesh.js (biomes, forest floor, shore sand, rock, snow),
 *    all 7 lakes, POI-levelled ground (heightExact) and hillshading, so the map looks like the ground you stand on.
 *    A coarse overview of the whole map is baked in the background; sharp 375 m detail tiles are baked on demand
 *    around you (minimap) or around the view (zoomed full map), a few ms per frame, never a long freeze.
 *  - Roads (mapLayout ROAD_PATHS) and building footprints are drawn on top.
 *  - Full map: scroll / pinch to zoom, drag to pan, double-click / double-tap to zoom in, tap a POI for its name,
 *    distance and bearing. Labels are collision-checked and level-of-detail driven: major POIs always, minor POIs
 *    once you zoom in, so names stay readable no matter how many POIs get added. A landmark list (nearest first)
 *    sits in the side margin on wide screens; click a row to fly there.
 *  - Minimap: heading-up, speed-aware zoom (zooms out while you drive / fly), mouse wheel or long-press to change
 *    zoom, major POI names, rim arrows towards nearby landmarks and a "nearest landmark" readout.
 *  The minimap lives in a HUD zone (top-left or top-right, see hudLayout.js). Drag it to the other top corner to
 *  move it. The full map hides the rest of the HUD while open.
 */
import { MAP_HALF, LAKES, lakeAt, dryness, mesaness, forestDensity } from './terrain.js';
import { heightExact } from './ground.js';
import { ROAD_PATHS } from './mapLayout.js';
import { colliders } from './collision.js';
import { settings } from './settings.js';

const MAP_SIZE = MAP_HALF * 2;
const OV = 768; // overview bake size in px (about 15.6 m per px on the 12 km map)
const TILES = Math.max(1, Math.round(MAP_SIZE / 375)); // detail tiles per side
const TILE_M = MAP_SIZE / TILES;
const TILE_N = 96; // px per detail tile (about 3.9 m per px)
const DETAIL_MPP = 6; // detail tiles are used when one screen px covers this many metres or less
const MAX_TILES = 220;
const GRID_M = 1000;
const GRID_N = Math.max(1, Math.round(MAP_SIZE / GRID_M));

const MINI_RANGE = 220;
const MINI_ZOOMS = [0.6, 1, 1.7, 2.8]; // multipliers on MINI_RANGE (wheel / long-press cycles them)
const MM_AUTOZOOM = true; // zoom the minimap out while you move fast (cars, planes, skydiving)
const SIDE_KEY = 'realmrange.minimap.side.v1';
const ZOOM_KEY = 'realmrange.minimap.zoom.v1';
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
  major: '#f5c76b',
  airfield: '#ff3b3b',
  build: 'rgba(190,200,210,0.9)',
  struct: 'rgba(34,30,26,0.82)',
};

// same palette as terrainMesh.js (0xRRGGBB -> rgb)
const PAL = {
  grassA: [107, 143, 62], grassB: [74, 116, 49], dry: [142, 143, 82], steppe: [177, 164, 104],
  forest: [58, 90, 44], sand: [200, 182, 128], rock: [122, 116, 106], mesa: [156, 106, 72],
  snow: [232, 237, 240], water: [58, 118, 150], deep: [24, 62, 96],
};

/** display names for POI types (minor POIs are named after their type) */
const TYPE_NAME = {
  plaza: 'Plaza', town: 'Town', industrial: 'Industrial', military: 'Military Base', hillfort: 'Hill Fort', lake: 'Lakeside',
  farm: 'Farmstead', ruins: 'Ruins', tower: 'Tower', quarry: 'Quarry', arena: 'Arena', airfield: 'Airfield', lodge: 'Lodge',
  camp: 'Campsite', power: 'Power Station', mine: 'Mine', refinery: 'Refinery', prison: 'Prison', hospital: 'Hospital',
  stadium: 'Stadium', windfarm: 'Wind Farm', harbor: 'Harbour', railyard: 'Rail Yard', observatory: 'Observatory', ghost: 'Ghost Town',
  fuel: 'Fuel Stop', garage: 'Garage', checkpoint: 'Checkpoint', trailer: 'Trailer Park', clinic: 'Clinic', supply: 'Supply Depot',
  dock: 'Dock', lighthouse: 'Lighthouse', cabin: 'Cabin', mineshaft: 'Mineshaft', cellmast: 'Cell Mast', lookout: 'Lookout',
  bunker: 'Bunker', crash: 'Crash Site', ruin: 'Ruins', shack: 'Shack', windmill: 'Windmill', sawmill: 'Sawmill',
  ranger: 'Ranger Station', church: 'Chapel', graveyard: 'Graveyard',
};
/** minor POI marker style: [colour, shape]  (ci circle, sq square, dia diamond, tri triangle) */
const SERVICE = ['#7fc4ff', 'sq'], SHELTER = ['#a6e3a1', 'ci'], WILD = ['#f0b87a', 'tri'], INDUSTRY = ['#d9d3c4', 'dia'];
const TYPE_STYLE = {
  fuel: SERVICE, garage: SERVICE, checkpoint: SERVICE, clinic: SERVICE, supply: SERVICE, trailer: SERVICE,
  cabin: SHELTER, camp: SHELTER, shack: SHELTER, ranger: SHELTER, farm: SHELTER, church: SHELTER, graveyard: SHELTER,
  mineshaft: WILD, lookout: WILD, bunker: WILD, crash: WILD, ruin: WILD, lighthouse: WILD, dock: WILD,
  sawmill: INDUSTRY, windmill: INDUSTRY, cellmast: INDUSTRY,
};
const DEFAULT_STYLE = ['#e9e4d8', 'ci'];

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
const smooth01 = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };

function loadSide() {
  try {
    const s = localStorage.getItem(SIDE_KEY);
    if (s === 'tl' || s === 'tr') return s;
  } catch (_) {}
  return 'tr';
}
function loadZoomIdx() {
  try {
    const n = parseInt(localStorage.getItem(ZOOM_KEY), 10);
    if (n >= 0 && n < MINI_ZOOMS.length) return n;
  } catch (_) {}
  return 1;
}

const titleCase = (s) => String(s || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());
const typeName = (p) => TYPE_NAME[p.type] || titleCase(p.type);
const poiTitle = (p) => (p.tier === 'major' || (p.name && p.name !== p.type) ? p.name || typeName(p) : typeName(p));
function fmtDist(d) {
  return d < 1000 ? Math.round(d / 10) * 10 + ' m' : (d / 1000).toFixed(d < 10000 ? 1 : 0) + ' km';
}
const WINDS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
function bearingName(dx, dz) {
  const a = (Math.atan2(dx, -dz) * 180) / Math.PI;
  return WINDS[(Math.round((a + 360) / 45)) % 8];
}
function gridRef(x, z) {
  const c = clamp(Math.floor((x + MAP_HALF) / GRID_M), 0, GRID_N - 1), r = clamp(Math.floor((z + MAP_HALF) / GRID_M), 0, GRID_N - 1);
  return String.fromCharCode(65 + (c % 26)) + (r + 1);
}

// ---------------------------------------------------------------- terrain baking
const _c = [0, 0, 0];
function mixTo(t, k) {
  _c[0] += (t[0] - _c[0]) * k; _c[1] += (t[1] - _c[1]) * k; _c[2] += (t[2] - _c[2]) * k;
}
/** colour of one ground sample, same rules as terrainMesh.colourAt, plus water */
function paintTerrain(x, z, h, ny, sh, d, o) {
  const w = lakeAt(x, z, 0.96);
  if (w && h < w.y + 0.05) {
    const t = clamp01((w.y - h) / (w.depth || 6));
    d[o] = PAL.water[0] + (PAL.deep[0] - PAL.water[0]) * t;
    d[o + 1] = PAL.water[1] + (PAL.deep[1] - PAL.water[1]) * t;
    d[o + 2] = PAL.water[2] + (PAL.deep[2] - PAL.water[2]) * t;
    d[o + 3] = 255;
    return;
  }
  const v = 0.5 + 0.5 * Math.sin(x * 0.013 + z * 0.021) * Math.cos(z * 0.017 - x * 0.007);
  _c[0] = PAL.grassB[0] + (PAL.grassA[0] - PAL.grassB[0]) * v;
  _c[1] = PAL.grassB[1] + (PAL.grassA[1] - PAL.grassB[1]) * v;
  _c[2] = PAL.grassB[2] + (PAL.grassA[2] - PAL.grassB[2]) * v;
  const dr = dryness(x, z), ms = mesaness(x, z);
  mixTo(PAL.dry, smooth01(0.7, 0.9, Math.sin(x * 0.004 - z * 0.006) * 0.5 + 0.5) * 0.5 * (1 - dr));
  mixTo(PAL.steppe, dr * 0.85);
  mixTo(PAL.forest, forestDensity(x, z, h) * 0.55);
  mixTo(PAL.mesa, ms * 0.8);
  const lk = lakeAt(x, z, 1.5);
  if (lk) mixTo(PAL.sand, 1 - smooth01(lk.y + 0.5, lk.y + 2.3, h));
  mixTo(PAL.rock, Math.max(smooth01(0.82, 0.6, ny), smooth01(70, 130, h)));
  mixTo(PAL.snow, smooth01(210, 250, h) * (0.5 + 0.5 * ny));
  const k = sh * (0.94 + 0.1 * clamp01(h / 220));
  d[o] = _c[0] * k; d[o + 1] = _c[1] * k; d[o + 2] = _c[2] * k; d[o + 3] = 255;
}

/**
 * Incremental terrain baker: an n x n px image covering [x0, x0 + n*step] x [z0, z0 + n*step].
 * advance(ms) does a few rows of work and returns; the canvas fills in top to bottom.
 */
function makeBaker(x0, z0, n, step) {
  const P = n + 2; // padded height grid (1 sample border so shading is seamless between tiles)
  const H = new Float32Array(P * P);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = n;
  const g = canvas.getContext('2d');
  const img = g.createImageData(n, n);
  const d = img.data;
  let p = 0, flushed = 0, rows = 0, done = false;
  function shadeRow(j) {
    const zc = z0 + (j + 0.5) * step;
    for (let i = 0; i < n; i++) {
      const k = (j + 1) * P + (i + 1), h = H[k];
      const gx = (H[k + 1] - H[k - 1]) / (2 * step), gz = (H[k + P] - H[k - P]) / (2 * step);
      const ny = 1 / Math.sqrt(1 + gx * gx + gz * gz);
      // light from the north-west; flat ground = 0.8
      const dot = (0.45 * gx + 0.8 + 0.4 * gz) * ny;
      paintTerrain(x0 + (i + 0.5) * step, zc, h, ny, clamp(1 + (dot - 0.8) * 1.5, 0.6, 1.3), d, (j * n + i) * 4);
    }
    rows = j + 1;
  }
  return {
    canvas,
    get done() { return done; },
    advance(ms) {
      const end = performance.now() + ms;
      while (!done) {
        const z = z0 + (p - 0.5) * step;
        for (let q = 0; q < P; q++) H[p * P + q] = heightExact(x0 + (q - 0.5) * step, z);
        if (p >= 2) shadeRow(p - 2);
        p++;
        if (p >= P) done = true;
        if (performance.now() >= end) break;
      }
      if (rows > flushed) {
        g.putImageData(img, 0, 0, 0, flushed, n, rows - flushed);
        flushed = rows;
      }
    },
  };
}

// ---------------------------------------------------------------- roads
const ROADS_V = (ROAD_PATHS || []).map((r) => {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const q of r.pts) { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < z0) z0 = q[1]; if (q[1] > z1) z1 = q[1]; }
  return { pts: r.pts, x0, z0, x1, z1 };
});

/** strokes every road that touches the rect, in whatever transform the context currently has (lw in world metres) */
function strokeRoads(ctx, rx0, rz0, rx1, rz1, lw, casing, core) {
  const path = new Path2D();
  let any = false;
  for (const r of ROADS_V) {
    if (r.x1 < rx0 || r.x0 > rx1 || r.z1 < rz0 || r.z0 > rz1) continue;
    const pts = r.pts;
    let pen = false, prevIn = false;
    for (let i = 0; i < pts.length; i++) {
      const q = pts[i], inn = q[0] >= rx0 && q[0] <= rx1 && q[1] >= rz0 && q[1] <= rz1;
      if (inn || prevIn) {
        if (!pen) {
          const a = i > 0 ? pts[i - 1] : q;
          path.moveTo(a[0], a[1]);
          pen = true;
        }
        path.lineTo(q[0], q[1]);
        any = true;
      } else pen = false;
      prevIn = inn;
    }
  }
  if (!any) return;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = casing;
  ctx.lineWidth = lw * 1.8;
  ctx.stroke(path);
  ctx.strokeStyle = core;
  ctx.lineWidth = lw;
  ctx.stroke(path);
}

function drawStructuresWorld(ctx, rx0, rz0, rx1, rz1, minSize) {
  ctx.fillStyle = COL.struct;
  ctx.beginPath();
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i];
    if (c.ramp) continue;
    const w = c.maxX - c.minX, d = c.maxZ - c.minZ;
    if (w < minSize && d < minSize) continue;
    if (c.maxX < rx0 || c.minX > rx1 || c.maxZ < rz0 || c.minZ > rz1) continue;
    ctx.rect(c.minX, c.minZ, Math.max(w, minSize * 0.5), Math.max(d, minSize * 0.5));
  }
  ctx.fill();
}

function drawBuildsWorld(ctx, build, rx0, rz0, rx1, rz1, minSize) {
  if (!build || !build.pieces) return;
  ctx.fillStyle = COL.build;
  for (const p of build.pieces.values()) {
    const g = p.geom;
    if (!g) continue;
    const x0 = g.minX ?? (g.x - g.w / 2), z0 = g.minZ ?? (g.z - g.d / 2);
    const x1 = g.maxX ?? (g.x + g.w / 2), z1 = g.maxZ ?? (g.z + g.d / 2);
    if (x1 < rx0 || x0 > rx1 || z1 < rz0 || z0 > rz1) continue;
    ctx.fillRect(Math.min(x0, x1), Math.min(z0, z1), Math.max(Math.abs(x1 - x0), minSize), Math.max(Math.abs(z1 - z0), minSize));
  }
}

// ---------------------------------------------------------------- markers + labels
function marker(ctx, x, y, r, shape, fill, stroke) {
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke || 'rgba(0,0,0,.75)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  if (shape === 'sq') ctx.rect(x - r, y - r, r * 2, r * 2);
  else if (shape === 'dia') { ctx.moveTo(x, y - r * 1.3); ctx.lineTo(x + r * 1.3, y); ctx.lineTo(x, y + r * 1.3); ctx.lineTo(x - r * 1.3, y); ctx.closePath(); }
  else if (shape === 'tri') { ctx.moveTo(x, y - r * 1.25); ctx.lineTo(x + r * 1.15, y + r * 0.9); ctx.lineTo(x - r * 1.15, y + r * 0.9); ctx.closePath(); }
  else ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}
function drawPoiMarker(ctx, p, x, y, r) {
  if (p.tier === 'major') {
    const air = p.type === 'airfield';
    marker(ctx, x, y, r, 'ci', air ? COL.airfield : COL.major, 'rgba(20,14,4,.9)');
    if (air) {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, r + 2.5, 0, Math.PI * 2);
      ctx.stroke();
    }
  } else {
    const st = TYPE_STYLE[p.type] || DEFAULT_STYLE;
    marker(ctx, x, y, r, st[1], st[0]);
  }
}

const _mw = new Map();
function textW(ctx, font, text) {
  const k = font + '|' + text;
  let w = _mw.get(k);
  if (w === undefined) {
    ctx.font = font;
    w = ctx.measureText(text).width;
    if (_mw.size > 2000) _mw.clear();
    _mw.set(k, w);
  }
  return w;
}
/** split a long name over two lines at the space that balances them best */
function wrapName(text, maxChars) {
  if (text.length <= maxChars || text.indexOf(' ') < 0) return [text];
  let best = null, bw = Infinity;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== ' ') continue;
    const a = text.slice(0, i), b = text.slice(i + 1), m = Math.max(a.length, b.length);
    if (m < bw) { bw = m; best = [a, b]; }
  }
  return best || [text];
}
/**
 * items: { x, y, r, lines, w, h, soft } in priority order. Tries 8 spots round each marker and keeps the first that
 * hits no earlier label and no other marker. soft items (majors) retry ignoring markers before giving up.
 * ok(l,t,r,b) can veto a box (the round minimap uses it).
 */
function layoutLabels(items, dots, bx0, by0, bx1, by1, ok) {
  const placed = [], out = [];
  for (let n = 0; n < items.length; n++) {
    const it = items[n], x = it.x, y = it.y, r = it.r + 2, w = it.w, h = it.h;
    const cand = [
      [r, -h / 2], [-r - w, -h / 2], [-w / 2, -r - h], [-w / 2, r],
      [r - 2, -r - h + 2], [r - 2, r - 2], [-r - w + 2, -r - h + 2], [-r - w + 2, r - 2],
    ];
    let hit = null;
    for (let pass = 0; pass < (it.soft ? 2 : 1) && !hit; pass++) {
      for (let k = 0; k < 8; k++) {
        const l = x + cand[k][0], t = y + cand[k][1], rr = l + w, bb = t + h;
        if (l < bx0 || t < by0 || rr > bx1 || bb > by1) continue;
        if (ok && !ok(l, t, rr, bb)) continue;
        let bad = false;
        for (let q = 0; q < placed.length; q++) {
          const o = placed[q];
          if (!(rr + 2 < o[0] || l - 2 > o[2] || bb + 1 < o[1] || t - 1 > o[3])) { bad = true; break; }
        }
        if (bad) continue;
        if (pass === 0) {
          for (let q = 0; q < dots.length; q++) {
            const dd = dots[q];
            if (dd.ref === it.ref) continue;
            if (dd.x > l - 3 && dd.x < rr + 3 && dd.y > t - 3 && dd.y < bb + 3) { bad = true; break; }
          }
          if (bad) continue;
        }
        hit = { l, t };
        placed.push([l, t, rr, bb]);
        break;
      }
    }
    if (hit) out.push({ it, l: hit.l, t: hit.t });
  }
  return out;
}
function drawLabel(ctx, o, font, fill, lineH) {
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(0,0,0,.8)';
  ctx.fillStyle = fill;
  const lines = o.it.lines, cx = o.l + o.it.w / 2;
  for (let i = 0; i < lines.length; i++) {
    const y = o.t + lineH * (i + 0.5) + 0.5;
    ctx.strokeText(lines[i], cx, y);
    ctx.fillText(lines[i], cx, y);
  }
}
function makeLabelItem(ctx, font, lineH, text, x, y, r, ref, soft, wrapAt) {
  const lines = wrapName(text, wrapAt);
  let w = 0;
  for (const l of lines) w = Math.max(w, textW(ctx, font, l));
  return { x, y, r, lines, w: w + 2, h: lines.length * lineH, ref, soft };
}

function arrow(ctx, k = 1) {
  ctx.fillStyle = COL.me;
  ctx.strokeStyle = 'rgba(0,0,0,.85)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, -8 * k);
  ctx.lineTo(5.5 * k, 6 * k);
  ctx.lineTo(0, 3 * k);
  ctx.lineTo(-5.5 * k, 6 * k);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
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

// ================================================================ the radar
export function createRadar(pois) {
  const touch = document.body.classList.contains('mobile');
  const dprNow = () => Math.min(2, window.devicePixelRatio || 1);
  let dpr = dprNow();

  // ---- POIs (re-split if more get added after startup) ----
  let majors = [], all = [], poiCount = -1;
  function syncPois() {
    const src = pois || [];
    if (src.length === poiCount) return false;
    poiCount = src.length;
    all = Array.from(src);
    majors = all.filter((p) => p.tier === 'major');
    return true;
  }
  syncPois();

  // ---- terrain: overview in the background + on-demand detail tiles ----
  const ov = makeBaker(-MAP_HALF, -MAP_HALF, OV, MAP_SIZE / OV);
  (function ovLoop() {
    try { ov.advance(5); } catch (_) { return; }
    if (!ov.done) setTimeout(ovLoop, 6);
  })();

  const tiles = new Map(); // key -> { canvas }
  let job = null, want = [];
  const tKey = (tx, tz) => tz * TILES + tx;
  function wantTiles(x0, z0, x1, z1, fx, fz) {
    const i0 = clamp(Math.floor((x0 + MAP_HALF) / TILE_M), 0, TILES - 1), i1 = clamp(Math.floor((x1 + MAP_HALF) / TILE_M), 0, TILES - 1);
    const j0 = clamp(Math.floor((z0 + MAP_HALF) / TILE_M), 0, TILES - 1), j1 = clamp(Math.floor((z1 + MAP_HALF) / TILE_M), 0, TILES - 1);
    const arr = [];
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dx = -MAP_HALF + (i + 0.5) * TILE_M - fx, dz = -MAP_HALF + (j + 0.5) * TILE_M - fz;
      arr.push([dx * dx + dz * dz, tKey(i, j)]);
    }
    arr.sort((a, b) => a[0] - b[0]);
    want = arr.slice(0, MAX_TILES - 40).map((a) => a[1]);
  }
  function bakeStep(ms) {
    const end = performance.now() + ms;
    while (performance.now() < end) {
      if (job && want.indexOf(job.key) < 0) job = null; // scrolled away from it
      if (!job) {
        let k = -1;
        for (let i = 0; i < want.length; i++) if (!tiles.has(want[i])) { k = want[i]; break; }
        if (k < 0) return;
        const tx = k % TILES, tz = (k / TILES) | 0;
        job = { key: k, b: makeBaker(-MAP_HALF + tx * TILE_M, -MAP_HALF + tz * TILE_M, TILE_N, TILE_M / TILE_N) };
      }
      job.b.advance(Math.max(0.5, end - performance.now()));
      if (job.b.done) {
        tiles.set(job.key, { canvas: job.b.canvas });
        job = null;
        while (tiles.size > MAX_TILES) tiles.delete(tiles.keys().next().value);
      } else return;
    }
  }
  /** terrain in the context's CURRENT transform (world metres); rect = visible world rect, mpp = metres per screen px */
  function drawTerrainLayer(ctx, rx0, rz0, rx1, rz1, mpp) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const x0 = Math.max(rx0, -MAP_HALF), z0 = Math.max(rz0, -MAP_HALF), x1 = Math.min(rx1, MAP_HALF), z1 = Math.min(rz1, MAP_HALF);
    if (x1 <= x0 || z1 <= z0) return;
    const k = OV / MAP_SIZE;
    ctx.drawImage(ov.canvas, (x0 + MAP_HALF) * k, (z0 + MAP_HALF) * k, (x1 - x0) * k, (z1 - z0) * k, x0, z0, x1 - x0, z1 - z0);
    if (mpp > DETAIL_MPP) return;
    const i0 = clamp(Math.floor((x0 + MAP_HALF) / TILE_M), 0, TILES - 1), i1 = clamp(Math.floor((x1 + MAP_HALF) / TILE_M), 0, TILES - 1);
    const j0 = clamp(Math.floor((z0 + MAP_HALF) / TILE_M), 0, TILES - 1), j1 = clamp(Math.floor((z1 + MAP_HALF) / TILE_M), 0, TILES - 1);
    const e = mpp * 0.6; // tiny overlap so no seams show
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const key = tKey(i, j), t = tiles.get(key);
      if (!t) continue;
      tiles.delete(key); tiles.set(key, t); // keep drawn tiles fresh in the cache
      ctx.drawImage(t.canvas, -MAP_HALF + i * TILE_M, -MAP_HALF + j * TILE_M, TILE_M + e, TILE_M + e);
    }
  }

  // ---- canvases / DOM ----
  let miniSize = miniPx();
  // fixed top-right is only a fallback until the HUD zones exist; placeMini() then moves it into a zone
  const mini = makeCanvas(miniSize, 'radarMini', 'top:16px;right:16px;border-radius:50%;border:2px solid rgba(243,241,234,0.5);display:none;');
  const full = makeCanvas(640, 'radarFull', 'left:50%;top:calc(50% - 22px);transform:translate(-50%,-50%);border-radius:3px;border:1px solid rgba(243,241,234,0.35);box-shadow:0 12px 40px rgba(0,0,0,.55);display:none;z-index:40;cursor:grab;');
  mini.style.setProperty('--mm', miniSize + 'px');
  const miniCtx = mini.getContext('2d');
  const fullCtx = full.getContext('2d');
  let fullOpen = false, active = false, legendT = 0, side = loadSide(), placed = false, zoomIdx = loadZoomIdx();
  let zoomToast = 0, autoZ = 1, speed = 0, lastX = null, lastZ = null;

  function applyMiniCss() {
    mini.style.width = miniSize + 'px';
    mini.style.height = miniSize + 'px';
  }
  function sizeMiniCanvas() {
    mini.width = mini.height = Math.round(miniSize * dpr);
    mini.style.setProperty('--mm', miniSize + 'px');
    applyMiniCss();
  }
  sizeMiniCanvas();

  const legend = document.createElement('div');
  legend.id = 'radarLegend';
  legend.style.cssText = 'position:fixed;left:50%;bottom:12px;transform:translateX(-50%);color:#f3f1ea;font:600 16px "Barlow Condensed","Bahnschrift","Arial Narrow",sans-serif;letter-spacing:.1em;text-transform:uppercase;background:linear-gradient(90deg,rgba(0,0,0,0),rgba(0,0,0,.65) 15%,rgba(0,0,0,.65) 85%,rgba(0,0,0,0));padding:6px 40px;display:none;z-index:41;max-width:90vw;text-align:center;';
  document.body.appendChild(legend);

  // buttons over the full map
  const ctl = document.createElement('div');
  ctl.id = 'radarCtl';
  ctl.style.cssText = 'position:fixed;z-index:42;display:none;';
  document.body.appendChild(ctl);
  function ctlBtn(label, title, fn) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.title = title;
    b.style.cssText = 'display:block;width:40px;height:40px;margin:0 0 6px;padding:0;font:700 20px/1 "Barlow Condensed","Bahnschrift",Arial,sans-serif;color:#f3f1ea;background:rgba(8,10,14,.8);border:1px solid rgba(243,241,234,.35);border-radius:6px;cursor:pointer;touch-action:manipulation;';
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
    for (const ev of ['pointerdown', 'pointerup', 'mousedown', 'mouseup']) b.addEventListener(ev, (e) => e.stopPropagation());
    ctl.appendChild(b);
    return b;
  }

  // landmark list (wide screens): every major POI, nearest first, click to fly there
  const listEl = document.createElement('div');
  listEl.id = 'radarList';
  listEl.style.cssText = 'position:fixed;z-index:42;width:216px;overflow-y:auto;background:rgba(8,10,14,.8);border:1px solid rgba(243,241,234,.3);border-radius:6px;padding:4px 0;display:none;font:600 14px "Barlow Condensed","Bahnschrift","Arial Narrow",sans-serif;letter-spacing:.06em;text-transform:uppercase;color:#f3f1ea;';
  document.body.appendChild(listEl);
  for (const ev of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'wheel']) listEl.addEventListener(ev, (e) => e.stopPropagation());
  let rows = [];
  function buildList() {
    listEl.replaceChildren();
    rows = majors.map((p) => {
      const el = document.createElement('div');
      el.style.cssText = 'display:flex;justify-content:space-between;gap:8px;padding:5px 10px;cursor:pointer;';
      const n = document.createElement('span'), d = document.createElement('span');
      n.textContent = p.name;
      n.style.color = p.type === 'airfield' ? '#ffb4b4' : '#f3f1ea';
      d.style.opacity = '.6';
      d.style.whiteSpace = 'nowrap';
      el.append(n, d);
      el.addEventListener('click', () => focusPoi(p));
      listEl.appendChild(el);
      return { p, el, d, dist: 0 };
    });
  }
  buildList();
  function syncListSel() {
    for (const r of rows) r.el.style.background = r.p === selected ? 'rgba(245,199,107,.25)' : 'transparent';
  }
  function updateList(me) {
    for (const r of rows) r.dist = Math.hypot(r.p.x - me.x, r.p.z - me.z);
    rows.sort((a, b) => a.dist - b.dist);
    for (const r of rows) { r.d.textContent = fmtDist(r.dist); listEl.appendChild(r.el); }
    syncListSel();
  }
  let listPref = null; // null = automatic (shown when the margin beside the map has room)
  const roomForList = () => (W - Math.min(W, H)) / 2 >= 228;
  const listShown = () => (listPref === null ? roomForList() : listPref);

  // ---- minimap: dragging between corners, wheel / long-press zoom ----
  /** put the minimap into its HUD zone (retries each frame until the HUD has built its zones) */
  function placeMini() {
    const z = document.getElementById(side === 'tr' ? 'zTR' : 'zTL');
    if (!z) return false;
    if (mini.parentNode !== z) z.insertBefore(mini, z.firstChild);
    for (const p of ['position', 'top', 'right', 'left', 'bottom', 'transform', 'z-index']) mini.style.removeProperty(p);
    mini.style.pointerEvents = 'auto';
    mini.style.touchAction = 'none';
    mini.style.cursor = 'grab';
    applyMiniCss();
    return true;
  }
  function cycleZoom(dir) {
    zoomIdx = (zoomIdx + dir + MINI_ZOOMS.length) % MINI_ZOOMS.length;
    zoomToast = 1.2;
    try { localStorage.setItem(ZOOM_KEY, String(zoomIdx)); } catch (_) {}
  }

  let drag = null;
  const endDrag = () => {
    for (const p of ['position', 'left', 'top', 'width', 'z-index', 'right', 'bottom', 'transform']) mini.style.removeProperty(p);
  };
  mini.style.pointerEvents = 'auto';
  mini.style.touchAction = 'none';
  full.style.pointerEvents = 'auto';
  full.style.touchAction = 'none';
  mini.addEventListener('pointerdown', (e) => {
    if (!settings.showMinimap) return;
    e.preventDefault();
    e.stopPropagation();
    const r = mini.getBoundingClientRect();
    drag = { x: e.clientX, y: e.clientY, ox: e.clientX - r.left, oy: e.clientY - r.top, w: r.width, moved: false, long: false, lp: 0 };
    drag.lp = setTimeout(() => { if (drag && !drag.moved) { drag.long = true; cycleZoom(1); } }, 550);
    try { mini.setPointerCapture(e.pointerId); } catch (_) {}
  });
  mini.addEventListener('pointermove', (e) => {
    if (!drag) return;
    e.preventDefault();
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) <= DRAG_PX) return;
      drag.moved = true;
      clearTimeout(drag.lp);
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
    clearTimeout(d.lp);
    if (!d.moved) { if (!d.long) toggleFull(); return; }
    endDrag();
    side = e.clientX < window.innerWidth / 2 ? 'tl' : 'tr';
    try { localStorage.setItem(SIDE_KEY, side); } catch (_) {}
    placeMini();
  });
  mini.addEventListener('pointercancel', () => {
    if (drag) clearTimeout(drag.lp);
    if (drag && drag.moved) { endDrag(); placeMini(); }
    drag = null;
  });
  mini.addEventListener('wheel', (e) => {
    e.preventDefault();
    e.stopPropagation();
    cycleZoom(e.deltaY > 0 ? 1 : -1);
  }, { passive: false });
  legend.style.pointerEvents = 'auto';
  legend.addEventListener('pointerup', () => {
    if (fullOpen) toggleFull();
  });

  function ensureMiniSize() {
    const want = miniPx(), d = dprNow();
    if (want === miniSize && d === dpr) return;
    miniSize = want;
    dpr = d;
    sizeMiniCanvas();
  }

  // ---- full map: size, view, gestures ----
  let W = 640, H = 640;
  const view = { cx: 0, cz: 0, mpp: 20 }, tgt = { cx: 0, cz: 0, mpp: 20 };
  let selected = null, hover = null;
  const fitMpp = () => (MAP_SIZE / Math.min(W, H)) * 1.015;
  const MIN_MPP = 1.1;
  function clampTgt() {
    tgt.mpp = clamp(tgt.mpp, MIN_MPP, fitMpp());
    const hw = (W * tgt.mpp) / 2, hh = (H * tgt.mpp) / 2;
    tgt.cx = hw >= MAP_HALF ? 0 : clamp(tgt.cx, -MAP_HALF + hw, MAP_HALF - hw);
    tgt.cz = hh >= MAP_HALF ? 0 : clamp(tgt.cz, -MAP_HALF + hh, MAP_HALF - hh);
  }
  function snapView() { view.cx = tgt.cx; view.cz = tgt.cz; view.mpp = tgt.mpp; }

  function ensureFullSize() {
    const pad = 16, d = dprNow();
    const w = Math.round(clamp(window.innerWidth - pad * 2, 240, 1600));
    const h = Math.round(clamp(window.innerHeight - pad * 2 - 44, 200, 1000));
    if (w === W && h === H && d === dpr && full.width === Math.round(w * d)) return;
    const first = W === 640 && H === 640 && full.width === 640;
    W = w; H = h; dpr = d;
    full.width = Math.round(W * dpr);
    full.height = Math.round(H * dpr);
    full.style.width = W + 'px';
    full.style.height = H + 'px';
    const left = (window.innerWidth - W) / 2, top = (window.innerHeight - H) / 2 - 22;
    ctl.style.left = left + W - 50 + 'px';
    ctl.style.top = top + 10 + 'px';
    listEl.style.left = left + 8 + 'px';
    listEl.style.top = top + 8 + 'px';
    listEl.style.maxHeight = H - 16 + 'px';
    if (first) { tgt.mpp = fitMpp(); clampTgt(); snapView(); } else { clampTgt(); }
  }
  window.addEventListener('resize', () => { if (fullOpen) ensureFullSize(); });

  const w2s = (x, z, out) => { out[0] = (x - view.cx) / view.mpp + W / 2; out[1] = (z - view.cz) / view.mpp + H / 2; return out; };
  const _s = [0, 0];

  function zoomAt(sx, sy, f) {
    const wx = tgt.cx + (sx - W / 2) * tgt.mpp, wz = tgt.cz + (sy - H / 2) * tgt.mpp;
    tgt.mpp = clamp(tgt.mpp / f, MIN_MPP, fitMpp());
    tgt.cx = wx - (sx - W / 2) * tgt.mpp;
    tgt.cz = wz - (sy - H / 2) * tgt.mpp;
    clampTgt();
  }
  function fitView() { tgt.mpp = fitMpp(); tgt.cx = 0; tgt.cz = 0; clampTgt(); }
  function focusPoi(p) {
    selected = p;
    tgt.cx = p.x; tgt.cz = p.z; tgt.mpp = Math.min(tgt.mpp, 4);
    clampTgt();
    syncListSel();
  }
  let lastMe = { x: 0, z: 0, yaw: 0 };
  function centreOnMe() {
    tgt.cx = lastMe.x; tgt.cz = lastMe.z; tgt.mpp = Math.min(tgt.mpp, 5);
    clampTgt();
  }

  ctlBtn('+', 'Zoom in', () => zoomAt(W / 2, H / 2, 1.8));
  ctlBtn('\u2212', 'Zoom out', () => zoomAt(W / 2, H / 2, 1 / 1.8));
  ctlBtn('\u2316', 'Centre on me', centreOnMe);
  ctlBtn('\u2922', 'Whole map', fitView);
  ctlBtn('\u2630', 'Landmark list', () => { listPref = !listShown(); });
  ctlBtn('\u2715', 'Close map', () => { if (fullOpen) toggleFull(); });

  function pickPoi(sx, sy, coarse) {
    let best = null, bd = Infinity;
    for (let i = 0; i < all.length; i++) {
      const p = all[i];
      w2s(p.x, p.z, _s);
      const d = Math.hypot(_s[0] - sx, _s[1] - sy), rad = (p.tier === 'major' ? 14 : 10) * (coarse ? 1.5 : 1);
      if (d > rad) continue;
      const score = d - (p.tier === 'major' ? 4 : 0);
      if (score < bd) { bd = score; best = p; }
    }
    return best;
  }

  const ptrs = new Map();
  let down = null, pinch = null, wasMulti = false, lastTap = { t: 0, x: 0, y: 0 };
  const local = (e) => { const r = full.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  for (const ev of ['mousedown', 'mouseup', 'click', 'contextmenu']) full.addEventListener(ev, (e) => { e.stopPropagation(); if (ev === 'contextmenu') e.preventDefault(); });
  full.addEventListener('pointerdown', (e) => {
    if (!fullOpen) return;
    e.preventDefault();
    e.stopPropagation();
    const [x, y] = local(e);
    try { full.setPointerCapture(e.pointerId); } catch (_) {}
    ptrs.set(e.pointerId, { x, y });
    if (ptrs.size === 1) { down = { x, y, moved: false, type: e.pointerType }; wasMulti = false; full.style.cursor = 'grabbing'; }
    else if (ptrs.size === 2) {
      wasMulti = true;
      const [a, b] = [...ptrs.values()], mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, mpp: tgt.mpp, wx: tgt.cx + (mx - W / 2) * tgt.mpp, wz: tgt.cz + (my - H / 2) * tgt.mpp };
    }
  });
  full.addEventListener('pointermove', (e) => {
    if (!fullOpen) return;
    const [x, y] = local(e), p = ptrs.get(e.pointerId);
    if (!p) { hover = e.pointerType === 'mouse' ? pickPoi(x, y, false) : null; full.style.cursor = hover ? 'pointer' : 'grab'; return; }
    e.preventDefault();
    if (ptrs.size === 2 && pinch) {
      p.x = x; p.y = y;
      const [a, b] = [...ptrs.values()], mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      tgt.mpp = clamp(pinch.mpp * (pinch.d / d), MIN_MPP, fitMpp());
      tgt.cx = pinch.wx - (mx - W / 2) * tgt.mpp;
      tgt.cz = pinch.wz - (my - H / 2) * tgt.mpp;
      clampTgt();
      snapView();
      return;
    }
    if (down && !down.moved && Math.hypot(x - down.x, y - down.y) > 6) down.moved = true;
    if (down && down.moved) {
      tgt.cx -= (x - p.x) * view.mpp; tgt.cz -= (y - p.y) * view.mpp;
      clampTgt();
      view.cx = tgt.cx; view.cz = tgt.cz;
    }
    p.x = x; p.y = y;
  });
  const upPtr = (e, cancelled) => {
    if (!ptrs.has(e.pointerId)) return;
    const [x, y] = local(e);
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) pinch = null;
    if (ptrs.size === 0) {
      full.style.cursor = 'grab';
      const d = down;
      down = null;
      if (!cancelled && d && !d.moved && !wasMulti) onTap(x, y, d.type);
    }
  };
  full.addEventListener('pointerup', (e) => upPtr(e, false));
  full.addEventListener('pointercancel', (e) => upPtr(e, true));
  function onTap(x, y, type) {
    if (type === 'mouse') { selected = pickPoi(x, y, false); syncListSel(); return; }
    const now = performance.now();
    if (now - lastTap.t < 320 && Math.hypot(x - lastTap.x, y - lastTap.y) < 28) { zoomAt(x, y, 2.4); lastTap.t = 0; return; }
    lastTap = { t: now, x, y };
    selected = pickPoi(x, y, true);
    syncListSel();
  }
  full.addEventListener('dblclick', (e) => { if (!fullOpen) return; const [x, y] = local(e); zoomAt(x, y, 2.2); });
  full.addEventListener('wheel', (e) => {
    if (!fullOpen) return;
    e.preventDefault();
    e.stopPropagation();
    const [x, y] = local(e);
    zoomAt(x, y, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016)));
  }, { passive: false });

  function animateView(dt) {
    const k = 1 - Math.exp(-14 * dt);
    view.cx += (tgt.cx - view.cx) * k;
    view.cz += (tgt.cz - view.cz) * k;
    view.mpp *= Math.pow(tgt.mpp / view.mpp, k);
    if (Math.abs(view.mpp / tgt.mpp - 1) < 0.002) view.mpp = tgt.mpp;
    if (Math.abs(view.cx - tgt.cx) < 0.05 * view.mpp) view.cx = tgt.cx;
    if (Math.abs(view.cz - tgt.cz) < 0.05 * view.mpp) view.cz = tgt.cz;
  }

  // ---- drawing: actors ----
  function drawActorsAt(ctx, enemies, remotes, toPx, w, h, showNames) {
    if (enemies) {
      for (const e of enemies) {
        if (!e.alive && (e.deathT || 0) > 4) continue;
        const p = toPx(e.x, e.z);
        if (p[0] < -6 || p[1] < -6 || p[0] > w + 6 || p[1] > h + 6) continue;
        dot(ctx, p[0], p[1], e.isLeader ? 4.5 : 3.5, !e.alive ? COL.down : e.isLeader ? COL.botLeader : COL.bot);
      }
    }
    if (remotes) {
      for (const r of remotes.values()) {
        const p = toPx(r.x, r.z);
        dot(ctx, p[0], p[1], 4.2, r.alive ? COL.foe : COL.down);
        if (showNames && r.name) {
          ctx.font = '700 11px ' + HUD_FONT;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'alphabetic';
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(0,0,0,.8)';
          ctx.fillStyle = r.alive ? '#ffd0c8' : '#aaa';
          ctx.strokeText(String(r.name).toUpperCase(), p[0] + 7, p[1] + 4);
          ctx.fillText(String(r.name).toUpperCase(), p[0] + 7, p[1] + 4);
        }
      }
    }
  }

  // ---- drawing: minimap ----
  function drawMini(ctx, size, me, remotes, enemies, build, range) {
    const c = size / 2, r = range * 1.45, s = size / (2 * r);
    const theta = MM_ROT * (me.yaw || 0), cos = Math.cos(theta), sin = Math.sin(theta);
    const band = Math.max(8, Math.min(16, Math.round(size * 0.085)));
    const vis = c - band * 0.7;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#2b4631';
    ctx.fillRect(0, 0, size, size);

    const ext = r * 1.42, rx0 = me.x - ext, rz0 = me.z - ext, rx1 = me.x + ext, rz1 = me.z + ext, mpp = 1 / s;
    ctx.save();
    ctx.translate(c, c);
    ctx.rotate(theta);
    ctx.scale(s, s);
    ctx.translate(-me.x, -me.z);
    drawTerrainLayer(ctx, rx0, rz0, rx1, rz1, mpp);
    strokeRoads(ctx, rx0, rz0, rx1, rz1, Math.max(1.5, 7 * s) / s, 'rgba(20,18,14,0.55)', 'rgba(232,222,190,0.9)');
    drawStructuresWorld(ctx, rx0, rz0, rx1, rz1, 2.5);
    drawBuildsWorld(ctx, build, rx0, rz0, rx1, rz1, mpp);
    ctx.restore();

    const mp = (x, z) => {
      const a = (x - me.x) * s, b = (z - me.z) * s;
      return [c + a * cos - b * sin, c + a * sin + b * cos];
    };
    // POI markers (screen space so icons never turn with the map)
    const labelItems = [], dots = [], reach = r * 1.15;
    const wantLabels = size >= 120;
    const lf = '700 ' + (size >= 200 ? 11 : 10) + 'px ' + HUD_FONT, lh = size >= 200 ? 12 : 11;
    for (let i = 0; i < all.length; i++) {
      const p = all[i];
      if (Math.abs(p.x - me.x) > reach || Math.abs(p.z - me.z) > reach) continue;
      const q = mp(p.x, p.z);
      if (Math.hypot(q[0] - c, q[1] - c) > vis) continue;
      const major = p.tier === 'major', rad = major ? 4 : 2.4;
      drawPoiMarker(ctx, p, q[0], q[1], rad);
      dots.push({ x: q[0], y: q[1], ref: p });
      if (major && wantLabels) labelItems.push(makeLabelItem(ctx, lf, lh, (p.name || '').toUpperCase(), q[0], q[1], rad, p, true, 11));
    }
    drawActorsAt(ctx, enemies, remotes, mp, size, size, false);

    drawMiniOverlay(ctx, size, theta, band);

    if (labelItems.length) {
      const inCircle = (l, t, rr, bb) => {
        const R = vis - 1;
        return Math.hypot(l - c, t - c) < R && Math.hypot(rr - c, t - c) < R && Math.hypot(l - c, bb - c) < R && Math.hypot(rr - c, bb - c) < R;
      };
      const placedL = layoutLabels(labelItems, dots, band, band, size - band, size - band, inCircle);
      for (const o of placedL) drawLabel(ctx, o, lf, o.it.ref.type === 'airfield' ? '#ffb4b4' : '#fff4d6', lh);
    }

    // rim arrows to the nearest landmarks that are off the map + nearest-landmark readout
    let near = null, nd = Infinity;
    const far = [];
    for (let i = 0; i < majors.length; i++) {
      const p = majors[i], dx = p.x - me.x, dz = p.z - me.z, d = Math.hypot(dx, dz);
      if (d < nd) { nd = d; near = p; }
      if (d * s > vis && d < 3000) far.push({ p, d });
    }
    far.sort((a, b) => a.d - b.d);
    for (let i = 0; i < Math.min(3, far.length); i++) {
      const q = mp(far[i].p.x, far[i].p.z), ang = Math.atan2(q[1] - c, q[0] - c), rr = c - band - 5;
      ctx.save();
      ctx.translate(c + Math.cos(ang) * rr, c + Math.sin(ang) * rr);
      ctx.rotate(ang + Math.PI / 2);
      ctx.fillStyle = far[i].p.type === 'airfield' ? COL.airfield : COL.major;
      ctx.strokeStyle = 'rgba(0,0,0,.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, -4.5); ctx.lineTo(4, 3); ctx.lineTo(-4, 3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    if (near && nd < 4000 && size >= 120) {
      const t = (near.name || '').toUpperCase() + '  ' + fmtDist(nd);
      ctx.font = '700 ' + (size >= 200 ? 11 : 10) + 'px ' + HUD_FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(0,0,0,.85)';
      ctx.fillStyle = near.type === 'airfield' ? '#ffb4b4' : '#f5c76b';
      const ty = size - band - 11;
      let txt = t;
      while (txt.length > 6 && ctx.measureText(txt).width > size * 0.62) txt = txt.slice(0, -2);
      if (txt !== t) txt += '\u2026';
      ctx.strokeText(txt, c, ty);
      ctx.fillText(txt, c, ty);
    }
    if (zoomToast > 0) {
      ctx.font = '700 12px ' + HUD_FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,.85)';
      ctx.fillStyle = '#fff';
      const t = Math.round(MINI_RANGE * MINI_ZOOMS[zoomIdx] * 2) + ' m view';
      ctx.strokeText(t, c, band + 12);
      ctx.fillText(t, c, band + 12);
    }
  }

  /** Everything drawn over the rotating minimap in screen space: tint, vignette, vision cone, rim, cardinals, you.
   *  theta = rotation applied to the world (clockwise radians). North ends up at theta clockwise from "up". */
  function drawMiniOverlay(ctx, size, theta, band) {
    const c = size / 2;
    ctx.fillStyle = 'rgba(8,12,16,0.14)';
    ctx.fillRect(0, 0, size, size);
    const vg = ctx.createRadialGradient(c, c, size * 0.3, c, c, c);
    vg.addColorStop(0, 'rgba(6,9,12,0)');
    vg.addColorStop(1, 'rgba(6,9,12,0.5)');
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

    // 30 degree ticks + cardinals, turning with the world
    const at = (bearingDeg, r) => {
      const a = theta + (bearingDeg * Math.PI) / 180;
      return [c + Math.sin(a) * r, c - Math.cos(a) * r];
    };
    ctx.strokeStyle = 'rgba(243,241,234,0.55)';
    ctx.lineWidth = 1.5;
    for (const b of [30, 60, 120, 150, 210, 240, 300, 330]) {
      const p0 = at(b, c - 1), p1 = at(b, c - 1 - band * 0.45);
      ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
    }
    ctx.font = '700 ' + Math.round(band * 0.95) + 'px ' + HUD_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const [b, t] of [[0, 'N'], [90, 'E'], [180, 'S'], [270, 'W']]) {
      const p = at(b, c - band / 2);
      ctx.fillStyle = b === 0 ? '#ffc247' : 'rgba(243,241,234,0.85)';
      ctx.fillText(t, p[0], p[1] + 0.5);
    }

    // you
    ctx.save();
    ctx.translate(c, c);
    arrow(ctx);
    ctx.restore();
  }

  // ---- drawing: full map ----
  const _p = [0, 0];
  function drawFull(ctx, me, remotes, enemies, build) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0b0f14';
    ctx.fillRect(0, 0, W, H);
    const m = view.mpp, hw = (W * m) / 2, hh = (H * m) / 2;
    const rx0 = view.cx - hw, rx1 = view.cx + hw, rz0 = view.cz - hh, rz1 = view.cz + hh;

    // world layer
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(1 / m, 1 / m);
    ctx.translate(-view.cx, -view.cz);
    drawTerrainLayer(ctx, rx0, rz0, rx1, rz1, m);
    // 1 km grid
    ctx.lineWidth = m;
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath();
    for (let g = Math.ceil((rx0 + MAP_HALF) / GRID_M); g * GRID_M - MAP_HALF <= rx1; g++) { const x = g * GRID_M - MAP_HALF; if (x < -MAP_HALF || x > MAP_HALF) continue; ctx.moveTo(x, Math.max(rz0, -MAP_HALF)); ctx.lineTo(x, Math.min(rz1, MAP_HALF)); }
    for (let g = Math.ceil((rz0 + MAP_HALF) / GRID_M); g * GRID_M - MAP_HALF <= rz1; g++) { const z = g * GRID_M - MAP_HALF; if (z < -MAP_HALF || z > MAP_HALF) continue; ctx.moveTo(Math.max(rx0, -MAP_HALF), z); ctx.lineTo(Math.min(rx1, MAP_HALF), z); }
    ctx.stroke();
    strokeRoads(ctx, rx0, rz0, rx1, rz1, clamp(7 / m, 1.4, 6) * m, 'rgba(20,18,14,0.6)', 'rgba(232,222,190,0.92)');
    if (m <= 10) drawStructuresWorld(ctx, rx0, rz0, rx1, rz1, 1.5 * m);
    if (m <= 6) drawBuildsWorld(ctx, build, rx0, rz0, rx1, rz1, m);
    ctx.restore();

    // map border
    w2s(-MAP_HALF, -MAP_HALF, _p);
    const bx0 = _p[0], by0 = _p[1];
    w2s(MAP_HALF, MAP_HALF, _p);
    ctx.strokeStyle = 'rgba(243,241,234,0.3)';
    ctx.lineWidth = 2;
    ctx.strokeRect(bx0, by0, _p[0] - bx0, _p[1] - by0);

    // grid references (A-L across, 1-12 down) in each visible cell's top/left edge
    if (m <= 24) {
      ctx.font = '700 12px ' + HUD_FONT;
      ctx.fillStyle = 'rgba(243,241,234,0.55)';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      for (let g = 0; g < GRID_N; g++) {
        w2s(-MAP_HALF + (g + 0.5) * GRID_M, 0, _p);
        if (_p[0] > 8 && _p[0] < W - 8) ctx.fillText(String.fromCharCode(65 + (g % 26)), _p[0], 9);
        w2s(0, -MAP_HALF + (g + 0.5) * GRID_M, _p);
        if (_p[1] > 8 && _p[1] < H - 8) ctx.fillText(String(g + 1), 8, _p[1]);
      }
    }

    // POI markers
    const rMajor = 5.5, rMinor = clamp(2 + 5 / m, 2.4, 4.2);
    const dots = [], lblMajor = [], lblMinor = [];
    const cx0 = view.cx, cz0 = view.cz;
    const showMinorNames = m <= 8;
    const fMajor = '700 13px ' + HUD_FONT, fMinor = '600 11px ' + HUD_FONT, fLake = 'italic 600 12px ' + HUD_FONT;
    // minors first so majors paint over them
    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < all.length; i++) {
        const p = all[i], major = p.tier === 'major';
        if (major !== (pass === 1)) continue;
        w2s(p.x, p.z, _p);
        if (_p[0] < -12 || _p[1] < -12 || _p[0] > W + 12 || _p[1] > H + 12) continue;
        const rad = major ? rMajor : rMinor;
        drawPoiMarker(ctx, p, _p[0], _p[1], rad);
        if (p === selected || p === hover) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(_p[0], _p[1], rad + 4.5, 0, Math.PI * 2);
          ctx.stroke();
        }
        dots.push({ x: _p[0], y: _p[1], ref: p });
        if (major) lblMajor.push(makeLabelItem(ctx, fMajor, 14, (p.name || '').toUpperCase(), _p[0], _p[1], rad + (p.type === 'airfield' ? 2.5 : 0), p, true, 12));
        else if (showMinorNames && _p[0] > 6 && _p[0] < W - 6 && _p[1] > 6 && _p[1] < H - 6) {
          lblMinor.push({ d: Math.hypot(p.x - cx0, p.z - cz0), item: makeLabelItem(ctx, fMinor, 12, poiTitle(p).toUpperCase(), _p[0], _p[1], rad, p, false, 14) });
        }
      }
    }
    lblMinor.sort((a, b) => a.d - b.d);
    const items = lblMajor.concat(lblMinor.slice(0, 140).map((a) => a.item));
    // lake names (low priority, only when the lake is on screen and big enough to carry one)
    if (m <= 22) {
      for (const L of LAKES) {
        w2s(L.x, L.z, _p);
        if (_p[0] < 0 || _p[1] < 0 || _p[0] > W || _p[1] > H) continue;
        if ((L.rx * 2) / m < 40) continue;
        items.push(makeLabelItem(ctx, fLake, 13, String(L.name).toUpperCase(), _p[0], _p[1], 0, L, false, 14));
        items[items.length - 1].lake = true;
      }
    }
    const laid = layoutLabels(items, dots, 3, 3, W - 3, H - 3, null);
    for (const o of laid) {
      if (o.it.lake) drawLabel(ctx, o, fLake, '#bfe3ff', 13);
      else if (o.it.ref.tier === 'major') drawLabel(ctx, o, fMajor, o.it.ref.type === 'airfield' ? '#ffb4b4' : '#fff4d6', 14);
      else drawLabel(ctx, o, fMinor, '#e9e4d8', 12);
    }

    // actors + you
    const toPx = (x, z) => w2s(x, z, [0, 0]);
    drawActorsAt(ctx, enemies, remotes, toPx, W, H, m <= 14);
    w2s(me.x, me.z, _p);
    ctx.save();
    ctx.translate(_p[0], _p[1]);
    ctx.rotate(-(me.yaw || 0)); // forward = (-sin yaw, -cos yaw)
    arrow(ctx, 1.25);
    ctx.restore();

    // route line + info card for the selected / hovered POI
    const sel = selected || hover;
    if (sel) drawCard(ctx, sel, me, sel === selected);
    drawScaleBar(ctx, m);
  }

  function drawCard(ctx, p, me, withLine) {
    const px = (p.x - view.cx) / view.mpp + W / 2, py = (p.z - view.cz) / view.mpp + H / 2;
    const dx = p.x - me.x, dz = p.z - me.z, d = Math.hypot(dx, dz);
    if (withLine) {
      w2s(me.x, me.z, _p);
      ctx.save();
      ctx.setLineDash([7, 5]);
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(_p[0], _p[1]);
      ctx.lineTo(px, py);
      ctx.stroke();
      ctx.restore();
    }
    const title = poiTitle(p).toUpperCase();
    const sub = typeName(p).toUpperCase() + '  \u00b7  ' + fmtDist(d) + ' ' + bearingName(dx, dz);
    const f1 = '700 15px ' + HUD_FONT, f2 = '600 12px ' + HUD_FONT;
    const bw = Math.max(textW(ctx, f1, title), textW(ctx, f2, sub)) + 18, bh = 40;
    const bx = clamp(px + 12, 4, W - bw - 4), by = clamp(py - bh - 12, 4, H - bh - 4);
    ctx.fillStyle = 'rgba(8,10,14,0.9)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.strokeStyle = p.type === 'airfield' ? COL.airfield : COL.major;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = f1;
    ctx.fillStyle = '#fff4d6';
    ctx.fillText(title, bx + 9, by + 14);
    ctx.font = f2;
    ctx.fillStyle = 'rgba(243,241,234,0.75)';
    ctx.fillText(sub, bx + 9, by + 29);
  }

  function drawScaleBar(ctx, m) {
    const opts = [50, 100, 200, 500, 1000, 2000, 5000];
    let len = opts[0];
    for (const o of opts) if (o / m <= 150) len = o;
    const px = len / m, x = 16, y = H - 16;
    ctx.strokeStyle = 'rgba(0,0,0,.8)';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x, y); ctx.lineTo(x + px, y); ctx.lineTo(x + px, y - 5); ctx.stroke();
    ctx.strokeStyle = '#f3f1ea';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x, y); ctx.lineTo(x + px, y); ctx.lineTo(x + px, y - 5); ctx.stroke();
    ctx.font = '700 12px ' + HUD_FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,.8)';
    ctx.fillStyle = '#f3f1ea';
    const t = len >= 1000 ? len / 1000 + ' km' : len + ' m';
    ctx.strokeText(t, x + 4, y - 8);
    ctx.fillText(t, x + 4, y - 8);
  }

  const legendMain = document.createElement('span');
  const legendHint = document.createElement('span');
  legendHint.style.cssText = 'display:block;font-size:12px;opacity:.55;letter-spacing:.12em;margin-top:2px;';
  legendHint.textContent = touch ? 'Pinch to zoom \u00b7 drag to pan \u00b7 double-tap to zoom in \u00b7 tap a POI' : 'Scroll to zoom \u00b7 drag to pan \u00b7 click a POI \u00b7 M to close';
  legend.append(legendMain, legendHint);

  function updateLegend(me, remotes, enemies) {
    const bits = ['Grid ' + gridRef(me.x, me.z)];
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
    legendMain.textContent = bits.join(' \u00b7 ');
  }

  function toggleFull() {
    if (!active) return;
    fullOpen = !fullOpen;
    legendT = 0;
    ptrs.clear(); down = null; pinch = null;
    if (fullOpen) {
      ensureFullSize();
      fitView();
      snapView();
      selected = null; hover = null;
    }
    document.body.classList.toggle('map-open', fullOpen);
  }

  const hideFull = () => { full.style.display = legend.style.display = ctl.style.display = listEl.style.display = 'none'; };

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
      const step = dt > 0 ? Math.min(dt, 0.1) : 1 / 60;

      if (!placed) placed = placeMini();
      document.body.classList.toggle('map-open', fullOpen && active);

      if (!active) {
        mini.style.display = 'none';
        hideFull();
        lastX = null;
        return;
      }
      syncPois() && buildList();
      lastMe = me;

      // how fast are we moving? (ignore teleports like the drop start)
      if (lastX !== null) {
        const v = Math.hypot(me.x - lastX, me.z - lastZ) / step;
        if (v < 150) speed += (v - speed) * Math.min(1, step * 2);
      }
      lastX = me.x; lastZ = me.z;
      if (zoomToast > 0) zoomToast -= step;

      if (fullOpen) {
        mini.style.display = 'none';
        full.style.display = legend.style.display = ctl.style.display = 'block';
        ensureFullSize();
        const showList = listShown();
        listEl.style.display = showList ? 'block' : 'none';
        animateView(step);
        const hw = (W * view.mpp) / 2, hh = (H * view.mpp) / 2;
        if (view.mpp <= DETAIL_MPP) wantTiles(view.cx - hw, view.cz - hh, view.cx + hw, view.cz + hh, view.cx, view.cz);
        else want = [];
        bakeStep(7);
        drawFull(fullCtx, me, remotes, enemies, build);
        legendT -= step;
        if (legendT <= 0) { legendT = 0.4; updateLegend(me, remotes, enemies); if (showList) updateList(me); }
        return;
      }

      hideFull();
      if (!show) {
        mini.style.display = 'none';
        return;
      }
      ensureMiniSize();
      mini.style.display = 'block';
      const target = MM_AUTOZOOM ? 1 + clamp((speed - 14) / 45, 0, 1) * 0.9 : 1;
      autoZ += (target - autoZ) * Math.min(1, step * 1.5);
      const range = MINI_RANGE * MINI_ZOOMS[zoomIdx] * autoZ, r = range * 1.45, ext = r * 1.42;
      if ((2 * r) / miniSize <= DETAIL_MPP) wantTiles(me.x - ext, me.z - ext, me.x + ext, me.z + ext, me.x, me.z);
      else want = [];
      bakeStep(3);
      drawMini(miniCtx, miniSize, me, remotes, enemies, build, range);
    },
    toggleFull,
    isFullOpen: () => fullOpen,
    close() {
      fullOpen = false;
      active = false;
      ptrs.clear(); down = null; pinch = null;
      document.body.classList.remove('map-open');
      mini.style.display = 'none';
      hideFull();
    },
  };
}
