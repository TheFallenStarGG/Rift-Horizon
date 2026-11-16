/** In-game clip recorder: 60 fps, up to 1080p, hardware H.264 when the browser has it.
 *
 *  Only the owner account (TheFallenStarGG) can record, list or delete clips; the worker enforces it with the login
 *  token, canRecord() only decides whether the UI shows up.
 *
 *  Cost on the game loop per recorded frame: one GPU copy of the game canvas + one blit of the cached HUD layer.
 *  The slow part (painting the DOM HUD) runs on idle time at an adaptive rate, while the boss UI (#rwUI: title
 *  cards, flashes, boss bar, hints) is painted EVERY frame so it stays smooth. Frames are pushed to the encoder
 *  with requestFrame(), so the clip runs at the game's real frame rate instead of a fixed timer.
 *
 *  The clip uploads WHILE you record (worker/src/clips.js), so stopping only has to send the last few MB.
 *  The HUD in clips is the real on-screen HUD (lib/hudCapture.js); the small hand-drawn HUD is only a fallback. */
import { WORKER_URL } from './net.js';
import { createHudCapture } from './hudCapture.js';
import { getToken, getUser } from './account.js';

const KEY = 'realmrange.rec.v2';
/** fps: 60 | 30 · width: 0 = match the game canvas (max 1920) · mbps: 0 = auto from resolution + fps */
export const recCfg = { fps: 60, width: 0, mbps: 0 };
try {
  const s = JSON.parse(localStorage.getItem(KEY) || '{}');
  for (const k of ['fps', 'width', 'mbps']) if (k in s && Number.isFinite(+s[k])) recCfg[k] = +s[k];
} catch (_) {}
export const saveRecCfg = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ fps: recCfg.fps, width: recCfg.width, mbps: recCfg.mbps }));
  } catch (_) {}
};

/** the ACCOUNT username (not the callsign) that may record. The real check is on the server; this just hides the UI. */
const OWNER = 'thefallenstargg';
export const canRecord = () => !!getToken() && String(getUser() || '').toLowerCase() === OWNER;

// hardware H.264 first (cheap on the CPU at 1080p60); software VP8 / VP9 only as a fallback
const MIMES = [
  'video/mp4;codecs=avc1.64002A,mp4a.40.2',
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/webm;codecs=h264,opus',
  'video/mp4;codecs=avc1,mp4a.40.2',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9,opus',
  'video/webm',
  'video/mp4',
];

const PART_BYTES = 4_000_000;   // upload part size while recording
const MAX_BYTES = 850_000_000;  // server keeps one clip under 900 MB
const MAX_MS = 30 * 60 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(path, { method = 'POST', body, timeout = 60000 } = {}) {
  const base = (WORKER_URL || '').replace(/\/$/, '');
  if (!base) throw Object.assign(new Error('no worker URL configured'), { status: 400 });
  const tok = getToken();
  const headers = tok ? { Authorization: 'Bearer ' + tok } : {};
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(base + path, { method, body, headers, signal: ctl.signal });
    let d = {};
    try { d = await r.json(); } catch (_) {}
    if (!r.ok) throw Object.assign(new Error(d.error || `HTTP ${r.status}`), { status: r.status });
    return d;
  } finally {
    clearTimeout(t);
  }
}

/** every stored clip, newest first: { max, total, clips: [{ id, url, ext, label, bytes, born, exp, done }] } */
export const listClips = () => api('/api/rec/list', { method: 'GET' });
export const deleteClip = (id) => api(`/api/rec/delete?id=${encodeURIComponent(id)}`);

async function sendPart(id, key, n, blob) {
  let err;
  for (let a = 0; a < 6; a++) {
    try {
      return await api(`/api/rec/part?id=${id}&key=${key}&n=${n}`, { method: 'PUT', body: blob, timeout: 90000 });
    } catch (e) {
      err = e;
      const s = e.status;
      if (s && ((s >= 400 && s < 500 && s !== 408 && s !== 429) || s === 507)) break; // retrying cannot help
      await sleep(400 * 2 ** a);
    }
  }
  throw err;
}

function ensureBar() {
  let wrap = document.getElementById('recProgress');
  if (wrap) return wrap;
  wrap = document.createElement('div');
  wrap.id = 'recProgress';
  wrap.innerHTML = `
    <style>
      #recProgress {
        display: none;
        position: fixed;
        z-index: 9990;
        left: max(10px, env(safe-area-inset-left, 0px));
        bottom: calc(12px + env(safe-area-inset-bottom, 0px));
        width: auto;
        max-width: min(280px, 72vw);
        padding: 8px 10px;
        border-radius: 12px;
        background: rgba(8, 12, 18, 0.92);
        border: 1px solid rgba(255,255,255,0.12);
        color: #e8eef6;
        font: 600 12px system-ui, sans-serif;
        pointer-events: auto;
        box-shadow: 0 8px 28px rgba(0,0,0,.45);
      }
      #recProgress.on { display: block; }

      /* Recording: only a tiny pill bottom-left — never center, never top */
      #recProgress.recording {
        top: auto !important;
        bottom: calc(10px + env(safe-area-inset-bottom, 0px)) !important;
        left: max(10px, env(safe-area-inset-left, 0px)) !important;
        right: auto !important;
        width: auto !important;
        max-width: none !important;
        padding: 4px 9px 4px 7px !important;
        border-radius: 999px !important;
        background: rgba(0,0,0,0.5) !important;
        border: 1px solid rgba(255,80,80,0.4) !important;
        box-shadow: none !important;
        pointer-events: none !important;
      }
      #recProgress.recording .title,
      #recProgress.recording .pct,
      #recProgress.recording .actions,
      #recProgress.recording .track { display: none !important; }
      #recProgress.recording .step {
        margin: 0 !important;
        font: 700 11px/1 system-ui, sans-serif !important;
        color: #fff !important;
        word-break: normal !important;
        opacity: 0.95 !important;
      }
      #recProgress.recording .step::before {
        content: '';
        display: inline-block;
        width: 7px; height: 7px;
        margin-right: 6px;
        border-radius: 50%;
        background: #ff2d2d;
        box-shadow: 0 0 6px #ff2d2d;
        vertical-align: middle;
        animation: recBlink 1.1s step-end infinite;
      }
      @keyframes recBlink { 50% { opacity: 0.25; } }

      /* Done / fail: compact card, left side, not full-screen spam */
      #recProgress.done, #recProgress.fail {
        top: auto !important;
        bottom: calc(12px + env(safe-area-inset-bottom, 0px)) !important;
        left: max(10px, env(safe-area-inset-left, 0px)) !important;
        right: auto !important;
        width: min(260px, 78vw) !important;
        max-width: min(260px, 78vw) !important;
        max-height: 42vh !important;
        overflow: auto !important;
        padding: 10px 12px !important;
        pointer-events: auto !important;
        z-index: 10000 !important;
      }
      #recProgress .title { font: 800 13px system-ui; letter-spacing: .02em; margin-bottom: 4px; }
      #recProgress .step {
        opacity: .9; font-size: 11px; margin-bottom: 8px; line-height: 1.35;
        word-break: break-word; max-height: 4.5em; overflow: hidden;
      }
      #recProgress.done .step, #recProgress.fail .step {
        max-height: 3.2em;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }
      #recProgress .track {
        height: 6px; background: rgba(255,255,255,.1); border-radius: 4px; overflow: hidden; margin-bottom: 6px;
      }
      #recProgress .fill {
        height: 100%; width: 0%; background: linear-gradient(90deg, #4aa8ff, #7ec8ff);
        transition: width .15s linear;
      }
      #recProgress .pct {
        display: flex; justify-content: space-between; font-size: 10px; opacity: .7; margin-bottom: 6px;
      }
      #recProgress a { color: #7ec8ff; }
      #recProgress.done .fill { background: linear-gradient(90deg, #2ecc71, #6dffb0); }
      #recProgress.fail .fill { background: linear-gradient(90deg, #e74c3c, #ff8a5c); }
      #recProgress .actions {
        margin-top: 6px; display: flex; gap: 6px; flex-wrap: wrap;
        pointer-events: auto !important; position: relative; z-index: 2;
      }
      #recProgress button {
        pointer-events: auto !important;
        touch-action: manipulation;
        cursor: pointer;
        border: 0; border-radius: 8px; padding: 7px 10px;
        font: 700 11px system-ui; color: #0b1220; background: #e8eef6;
      }
      #recProgress button.secondary { background: rgba(255,255,255,.12); color: #e8eef6; }
    </style>
    <div class="title">Recording</div>
    <div class="step" id="recStep">…</div>
    <div class="track"><div class="fill" id="recFill"></div></div>
    <div class="pct"><span id="recPct">0%</span><span id="recPhase">idle</span></div>
    <div class="actions" id="recActions" style="display:none"></div>
  `;
  document.body.appendChild(wrap);
  return wrap;
}

export function createRecorder({ canvas, audio, getState }) {
  const out = document.createElement('canvas');
  const g = out.getContext('2d', { alpha: false });
  // the DOM HUD is painted onto its own transparent layer (slowly, on idle time) and blitted onto every frame
  const hudCap = createHudCapture();
  const hudL = document.createElement('canvas');
  const hudG = hudL.getContext('2d');
  let hudOk = true;
  let hudBusy = false;
  let hudAt = -1e9;
  let hudEvery = 0;

  let rec = null;
  let stream = null;
  let vt = null;            // video track
  let manual = false;       // frames are pushed with requestFrame()
  let active = false;
  let t0 = 0;
  let interval = 1000 / 60;
  let acc = 0;
  let lastT = 0;
  let uiT = 0;
  let mime = '';
  let stamp = '';
  let finalized = false;
  let warnedDiscard = false;

  // clip data + upload state
  let chunks = [];
  let totalBytes = 0;
  let sess = null;          // { id, key, url }
  let sentChunks = 0;
  let sentBytes = 0;
  let partN = 0;
  let pumping = null;
  let stopped = false;
  let upErr = '';
  let fatal = false;
  let finished = false;
  let busyUp = false;
  let lastUrl = '';
  let lastHost = '';
  let lastExpires = '';
  let lastName = '';

  const bar = ensureBar();
  const elStep = () => document.getElementById('recStep');
  const elFill = () => document.getElementById('recFill');
  const elPct = () => document.getElementById('recPct');
  const elPhase = () => document.getElementById('recPhase');
  const elActions = () => document.getElementById('recActions');
  const baseMime = () => (mime || 'video/webm').split(';')[0];
  const mb = (n) => (n / 1048576).toFixed(1);

  // ---------- audio: music that plays through <audio> elements ----------
  // Boss music (and the trailer score) plays through an <audio> element, which never reaches the Web Audio graph
  // the recorder taps, so it was missing from clips. The first time such an element plays, route it through the
  // master bus: it is recorded, and it now follows the master volume too.
  function routeMedia(el) {
    if (!el || el.__rrRoute) return;
    const ctx = audio && audio.getCtx && audio.getCtx();
    const master = audio && audio.getMaster && audio.getMaster();
    if (!ctx || !master) return;
    const src = el.src || el.currentSrc;
    if (!src) return;
    try { if (new URL(src, location.href).origin !== location.origin) return; } catch (_) { return; } // cross-origin would go silent
    try {
      ctx.createMediaElementSource(el).connect(master);
      el.__rrRoute = true;
    } catch (_) {}
  }
  const proto = window.HTMLMediaElement && HTMLMediaElement.prototype;
  if (proto && !proto.__rrHook) {
    const play = proto.play;
    proto.play = function (...a) {
      try { if (window.__rrRoute) window.__rrRoute(this); } catch (_) {}
      return play.apply(this, a);
    };
    proto.__rrHook = true;
  }
  window.__rrRoute = routeMedia;

  // ---------- progress / result UI ----------
  function setBar({ title, step, pct, phase, mode, show }) {
    if (show === false) {
      bar.classList.remove('on', 'done', 'fail', 'recording');
      try { document.body.classList.remove('recording'); } catch (_) {}
      if (elActions()) { elActions().style.display = 'none'; elActions().innerHTML = ''; }
      return;
    }
    bar.classList.add('on');
    bar.classList.toggle('done', mode === 'done');
    bar.classList.toggle('fail', mode === 'fail');
    const isRec = mode === 'recording' || phase === 'recording';
    bar.classList.toggle('recording', isRec);
    try { document.body.classList.toggle('recording', isRec); } catch (_) {}
    if (title) bar.querySelector('.title').textContent = title;
    if (step != null && elStep()) elStep().textContent = step;
    const p = Math.max(0, Math.min(100, pct == null ? 0 : pct));
    if (elFill()) elFill().style.width = p + '%';
    if (elPct()) elPct().textContent = Math.round(p) + '%';
    if (phase != null && elPhase()) elPhase().textContent = phase;
  }

  const mkBtn = (text, cls, fn) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = text;
    if (cls) b.className = cls;
    b.onclick = (e) => { e.preventDefault(); e.stopPropagation(); fn(); };
    return b;
  };

  function showLinkActions(url) {
    const a = elActions();
    if (!a) return;
    a.style.display = 'flex';
    a.innerHTML = '';
    a.append(
      mkBtn('Open', '', () => { try { window.open(url, '_blank'); } catch (_) {} }),
      mkBtn('Copy', '', async () => {
        try {
          await navigator.clipboard.writeText(url);
          if (elStep()) elStep().textContent = 'Link copied';
        } catch (_) {
          if (elStep()) elStep().textContent = 'Copy failed — long-press the Open button';
        }
      }),
      mkBtn('Dismiss', 'secondary', () => setBar({ show: false })),
    );
  }

  function showFail(msg) {
    setBar({ title: 'Upload failed', step: msg, pct: 100, phase: 'failed', mode: 'fail' });
    const a = elActions();
    if (!a) return;
    a.style.display = 'flex';
    a.innerHTML = '';
    a.append(
      mkBtn('Retry upload', '', () => retry()),
      mkBtn('Download clip', 'secondary', () => downloadAll()),
      mkBtn('Dismiss', 'secondary', () => setBar({ show: false })),
    );
  }

  // ---------- upload (runs while recording) ----------
  async function openSession() {
    const ext = baseMime().includes('mp4') ? 'mp4' : 'webm';
    const d = await api(`/api/rec/start?ext=${ext}&label=${encodeURIComponent(lastName)}`);
    sess = { id: d.id, key: d.key, url: d.url };
  }

  function pump() {
    if (pumping) return pumping;
    const p = (async () => {
      try {
        if (!sess) await openSession();
        for (;;) {
          let n = 0;
          let bytes = 0;
          while (sentChunks + n < chunks.length && bytes < PART_BYTES) bytes += chunks[sentChunks + n++].size;
          if (!n || (bytes < PART_BYTES && !stopped)) break; // while recording, wait for a full part
          const blob = new Blob(chunks.slice(sentChunks, sentChunks + n), { type: baseMime() });
          await sendPart(sess.id, sess.key, partN, blob);
          sentChunks += n;
          sentBytes += bytes;
          partN++;
        }
        upErr = '';
      } catch (e) {
        upErr = String((e && e.message) || e);
        const s = e && e.status;
        fatal = !!s && ((s >= 400 && s < 500 && s !== 408 && s !== 429) || s === 507);
      }
    })();
    pumping = p;
    p.then(() => { if (pumping === p) pumping = null; });
    return p;
  }

  async function uploadAll() {
    busyUp = true;
    const total = chunks.reduce((a, c) => a + c.size, 0);
    if (elActions()) { elActions().style.display = 'none'; elActions().innerHTML = ''; }
    const t = setInterval(() => {
      setBar({
        title: 'Uploading',
        step: `Uploading ${mb(sentBytes)} / ${mb(total)} MB…`,
        pct: 25 + 70 * (total ? sentBytes / total : 0),
        phase: 'upload',
        mode: '',
      });
    }, 250);
    try {
      stopped = true;
      for (let i = 0; i < 3 && !fatal && sentChunks < chunks.length; i++) await pump();
      if (!sess || sentChunks < chunks.length) throw new Error(upErr || 'upload stalled');
      const d = await api(`/api/rec/finish?id=${sess.id}&key=${sess.key}`);
      finished = true;
      lastUrl = d.url || sess.url;
      lastHost = 'cloudflare';
      lastExpires = d.expires || '14 days';
      setBar({ title: 'Saved', step: `Saved (${mb(total)} MB) — link copied`, pct: 100, phase: 'done', mode: 'done' });
      showLinkActions(lastUrl);
      try { if (navigator.clipboard) await navigator.clipboard.writeText(lastUrl); } catch (_) {}
    } catch (e) {
      showFail(`${String((e && e.message) || e).slice(0, 80)}. The clip is still on this device.`);
    } finally {
      clearInterval(t);
      busyUp = false;
    }
  }

  function retry() {
    if (active || busyUp || !chunks.length) return;
    if (finished || fatal) {
      // start over with a fresh upload
      sess = null; sentChunks = 0; sentBytes = 0; partN = 0; finished = false; fatal = false;
    }
    upErr = '';
    return uploadAll();
  }

  function downloadAll() {
    if (!chunks.length) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(chunks, { type: baseMime() }));
    a.download = lastName || `realmrange-${stamp}.${baseMime().includes('mp4') ? 'mp4' : 'webm'}`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  // ---------- capture ----------
  function fallbackHud(s) {
    if (!s) return;
    const W = out.width;
    const H = out.height;
    const k = H / 600;
    g.save();
    g.shadowColor = 'rgba(0,0,0,.8)';
    g.shadowBlur = 4 * k;
    g.strokeStyle = '#fff';
    g.fillStyle = '#fff';
    g.lineWidth = 2 * k;
    const c = W / 2;
    const m = H / 2;
    g.beginPath();
    g.moveTo(c - 14 * k, m); g.lineTo(c - 6 * k, m);
    g.moveTo(c + 6 * k, m); g.lineTo(c + 14 * k, m);
    g.moveTo(c, m - 14 * k); g.lineTo(c, m - 6 * k);
    g.moveTo(c, m + 6 * k); g.lineTo(c, m + 14 * k);
    g.stroke();
    g.textAlign = 'left';
    g.font = `800 ${28 * k}px monospace`;
    g.fillText(String(s.hp | 0), 16 * k, H - 24 * k);
    g.textAlign = 'right';
    g.font = `700 ${14 * k}px monospace`;
    g.fillText(s.weapon || '', W - 16 * k, H - 62 * k);
    g.font = `800 ${32 * k}px monospace`;
    if (s.kind === 'gun') g.fillText(`${s.ammo} / ${s.reserve}`, W - 16 * k, H - 24 * k);
    g.restore();
  }

  /** repaint the cached HUD layer on idle time; the rate adapts to how long a repaint takes */
  function refreshHud() {
    if (hudBusy) return;
    hudBusy = true;
    const run = () => {
      hudBusy = false;
      if (!active || !hudOk) return;
      const t = performance.now();
      try {
        hudG.clearRect(0, 0, hudL.width, hudL.height);
        hudCap.draw(hudG, hudL.width, hudL.height);
      } catch (e) {
        hudOk = false;
        console.warn('[rec] HUD capture failed, using the simple HUD instead', e);
        return;
      }
      const ms = performance.now() - t;
      hudEvery = Math.min(100, ms * 8); // a 1 ms repaint runs every frame, a 4 ms one ~30x/s, a 12 ms one ~10x/s
      hudAt = performance.now();
    };
    if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 120 });
    else run();
  }

  /** composite one frame: game canvas, cached HUD, then the boss UI (painted live every frame) */
  function paint(now = performance.now()) {
    g.drawImage(canvas, 0, 0, out.width, out.height);
    if (hudOk) {
      if (now - hudAt >= hudEvery) refreshHud();
      g.drawImage(hudL, 0, 0);
    } else {
      try { fallbackHud(getState && getState()); } catch (_) {}
    }
    const boss = document.getElementById('rwUI');
    if (boss && boss.classList.contains('on')) {
      try { hudCap.draw(g, out.width, out.height, ['#rwUI']); } catch (_) {}
    }
  }

  function frame(now) {
    if (!active) return;
    acc += lastT ? Math.min(now - lastT, 250) : interval;
    lastT = now;
    if (acc < interval * 0.85) return; // 60 on a 60 Hz screen, every other frame on 120 Hz, every other on 60 for 30 fps
    acc = Math.max(0, Math.min(acc - interval, interval));
    paint(now);
    if (manual && vt) { try { vt.requestFrame(); } catch (_) {} }
  }

  function tick() {
    if (!active) return;
    const sec = Math.floor((performance.now() - t0) / 1000);
    setBar({
      title: 'Recording',
      step: `REC ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}${upErr ? ' · retrying upload' : ''}`,
      pct: 3,
      phase: 'recording',
      mode: 'recording',
    });
    if (performance.now() - t0 > MAX_MS || totalBytes >= MAX_BYTES) stop();
  }

  function start() {
    if (active || busyUp || !canRecord()) return;
    if (chunks.length && !finished && !warnedDiscard) {
      warnedDiscard = true;
      showFail('The last clip never finished uploading. Retry or download it first, or press REC again to discard it.');
      return;
    }
    mime = window.MediaRecorder ? MIMES.find((m) => MediaRecorder.isTypeSupported(m)) || '' : '';
    if (!mime) {
      setBar({ title: 'Recording', step: 'Not supported on this browser', pct: 0, phase: 'error', mode: 'fail', show: true });
      return;
    }
    warnedDiscard = false;
    const fps = recCfg.fps >= 45 ? 60 : 30;
    interval = 1000 / fps;
    const srcW = canvas.width || 1280;
    const srcH = canvas.height || 720;
    let w = recCfg.width > 0 ? recCfg.width : Math.min(srcW, 1920);
    w = Math.max(320, Math.round(w)) & ~1;
    out.width = w;
    out.height = Math.round((w * srcH) / srcW) & ~1;
    hudL.width = out.width;
    hudL.height = out.height;
    g.imageSmoothingQuality = 'medium';
    hudOk = true;
    hudBusy = false;
    hudAt = -1e9;
    hudEvery = 0;

    chunks = []; totalBytes = 0;
    sess = null; sentChunks = 0; sentBytes = 0; partN = 0; pumping = null;
    stopped = false; upErr = ''; fatal = false; finished = false; finalized = false;
    lastUrl = ''; lastHost = ''; lastExpires = '';
    acc = interval; lastT = 0;
    stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    lastName = `realmrange-${stamp}.${mime.includes('mp4') ? 'mp4' : 'webm'}`;
    if (elActions()) { elActions().style.display = 'none'; elActions().innerHTML = ''; }

    try {
      paint(); // first frame, so the clip never opens on black
      let vs = out.captureStream(0);
      vt = vs.getVideoTracks()[0];
      manual = !!(vt && typeof vt.requestFrame === 'function');
      if (!manual) {
        vs.getTracks().forEach((t) => t.stop());
        vs = out.captureStream(fps);
        vt = vs.getVideoTracks()[0];
      }
      try { vt.contentHint = 'motion'; } catch (_) {} // keep the frame rate when the encoder is under pressure
      const as = audio && audio.recordStream ? audio.recordStream() : null;
      stream = new MediaStream([...vs.getVideoTracks(), ...(as ? as.getAudioTracks() : [])]);

      const h264 = /avc1|h264/i.test(mime);
      let bps = recCfg.mbps > 0 ? recCfg.mbps * 1e6 : out.width * out.height * fps * (h264 ? 0.085 : 0.12);
      bps = Math.max(2.5e6, Math.min(24e6, bps)); // 1080p60 -> ~10.5 Mbps, 720p60 -> ~4.7 Mbps
      rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: Math.round(bps), audioBitsPerSecond: 160000 });
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size) {
          chunks.push(e.data);
          totalBytes += e.data.size;
          if (!fatal) pump();
        }
      };
      active = true;
      t0 = performance.now();
      rec.start(1000);
    } catch (e) {
      active = false;
      try { if (stream) stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
      stream = null; vt = null; rec = null;
      setBar({ title: 'Recording', step: 'Could not start the recorder', pct: 0, phase: 'error', mode: 'fail', show: true });
      console.warn('[rec] start failed', e);
      return;
    }
    clearInterval(uiT);
    uiT = setInterval(tick, 1000);
    setBar({ title: 'Recording', step: 'REC 0:00', pct: 3, phase: 'recording', mode: 'recording', show: true });
    pump(); // opens the upload right away
  }

  async function finalize() {
    if (finalized) return;
    finalized = true;
    try { if (stream) stream.getTracks().forEach((t) => t.stop()); } catch (_) {}
    stream = null;
    vt = null;
    if (!chunks.length) {
      setBar({ title: 'Finalizing', step: 'Nothing was recorded (browser blocked capture)', pct: 0, mode: 'fail', phase: 'empty' });
      return;
    }
    await uploadAll();
  }

  function stop() {
    if (!active) return;
    active = false;
    clearInterval(uiT);
    uiT = 0;
    setBar({ title: 'Finalizing', step: 'Stopping recorder…', pct: 22, phase: 'stopping', mode: '' });
    const r = rec;
    rec = null;
    if (!r) { finalize(); return; }
    r.onstop = () => finalize();
    try {
      if (r.state !== 'inactive') {
        try { r.requestData(); } catch (_) {}
        r.stop();
      } else finalize();
    } catch (_) {
      finalize();
    }
    setTimeout(finalize, 2500); // safety net if onstop never fires
  }

  return {
    start,
    stop,
    frame,
    toggle() { if (active) stop(); else start(); },
    get active() { return active; },
    get elapsed() { return active ? (performance.now() - t0) / 1000 : 0; },
    get lastUrl() { return lastUrl; },
    get lastHost() { return lastHost; },
    get lastExpires() { return lastExpires; },
    // kept so game.js can still call them; the real HUD (hudCapture) draws the kill feed and hit markers now
    feedKill() {},
    hitMarker() {},
    retryUpload: retry,
    retry,
    copyLastUrl() {
      if (lastUrl && navigator.clipboard) return navigator.clipboard.writeText(lastUrl).catch(() => {});
    },
    downloadAll,
    listClips,
    async deleteClip(id) {
      await deleteClip(id);
      if (lastUrl && lastUrl.includes(id)) { lastUrl = ''; lastHost = ''; lastExpires = ''; }
    },
  };
}
