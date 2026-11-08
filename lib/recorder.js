/** Records canvas + HUD overlay + audio. Upload-first with clear progress bar.
 *  The HUD in clips is the real on-screen HUD (lib/hudCapture.js); the old hand-drawn HUD is only a fallback. */
import { WORKER_URL } from './net.js';
import { createHudCapture } from './hudCapture.js';

const KEY = 'realmrange.rec.v1';
export const recCfg = { mbps: 1.8, width: 1280 };
try {
  const s = JSON.parse(localStorage.getItem(KEY) || '{}');
  if (s.mbps) recCfg.mbps = +s.mbps;
  if (s.width) recCfg.width = +s.width;
} catch (_) {}
export const saveRecCfg = () => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ mbps: recCfg.mbps, width: recCfg.width }));
  } catch (_) {}
};

const MIMES = [
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp9,opus',
  'video/webm',
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1',
  'video/mp4',
];

const MAX_MS = 30 * 60 * 1000;

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
        left: 50%;
        bottom: calc(12px + env(safe-area-inset-bottom, 0px));
        transform: translateX(-50%);
        z-index: 99998;
        width: min(420px, calc(100vw - 24px));
        padding: 10px 12px 12px;
        border-radius: 12px;
        background: rgba(6, 10, 16, 0.92);
        border: 1px solid rgba(255,255,255,0.18);
        color: #eef3fa;
        font: 600 12px system-ui, sans-serif;
        pointer-events: auto;
        box-shadow: 0 8px 28px rgba(0,0,0,.45);
      }
      #recProgress.on { display: block; }
      /* Compact chip while recording — does not cover fire/aim controls */
      #recProgress.recording {
        top: calc(52px + env(safe-area-inset-top, 0px));
        bottom: auto;
        width: auto;
        max-width: min(220px, 55vw);
        padding: 5px 8px 6px;
        border-radius: 8px;
        background: rgba(6, 10, 16, 0.72);
        box-shadow: 0 4px 14px rgba(0,0,0,.35);
        pointer-events: none;
      }
      #recProgress.recording .title,
      #recProgress.recording .pct,
      #recProgress.recording .actions { display: none !important; }
      #recProgress.recording .step {
        font-size: 10px; margin: 0 0 3px; opacity: .9; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
      }
      #recProgress.recording .track { height: 3px; }
      #recProgress .title { font: 800 13px system-ui; letter-spacing: .02em; margin-bottom: 4px; }
      #recProgress .step { opacity: .85; font-size: 11px; margin-bottom: 8px; line-height: 1.35; word-break: break-word; }
      #recProgress .track {
        height: 10px; border-radius: 6px; background: rgba(255,255,255,.12); overflow: hidden;
      }
      #recProgress .fill {
        height: 100%; width: 0%; border-radius: 6px;
        background: linear-gradient(90deg, #3d8bfd, #6dffb0);
        transition: width .2s ease;
      }
      #recProgress .pct {
        margin-top: 6px; font: 700 11px ui-monospace, Menlo, monospace; opacity: .9;
        display: flex; justify-content: space-between; gap: 8px;
      }
      #recProgress a { color: #7ec8ff; }
      #recProgress.done .fill { background: linear-gradient(90deg, #2ecc71, #6dffb0); }
      #recProgress.fail .fill { background: linear-gradient(90deg, #e74c3c, #ff8a5c); }
      #recProgress .actions { margin-top: 8px; display: flex; gap: 8px; flex-wrap: wrap; }
      #recProgress button {
        border: 1px solid rgba(255,255,255,.25); background: rgba(255,255,255,.08);
        color: #fff; border-radius: 8px; padding: 6px 10px; font: 700 11px system-ui; cursor: pointer;
      }
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

export function createRecorder({ canvas, audio, getState, onStatus }) {
  const out = document.createElement('canvas');
  const g = out.getContext('2d', { alpha: false });
  // exact HUD: drawn on its own transparent layer, then composited onto every frame
  const hudCap = createHudCapture();
  const hudL = document.createElement('canvas');
  const hudG = hudL.getContext('2d');
  let hudOk = true;
  let hudAt = 0;
  let hudEvery = 0;
  const feed = [];
  const hits = [];
  const pending = [];
  let rec = null;
  let stream = null;
  let active = false;
  let t0 = 0;
  let last = 0;
  let maxTimer = 0;
  let mime = '';
  let stamp = '';
  let chunks = [];
  let lastUrl = '';
  let lastHost = '';
  let lastExpires = '';
  let chunkBytes = 0;
  let lastBlob = null;
  let lastName = '';

  const bar = ensureBar();
  const elStep = () => document.getElementById('recStep');
  const elFill = () => document.getElementById('recFill');
  const elPct = () => document.getElementById('recPct');
  const elPhase = () => document.getElementById('recPhase');
  const elActions = () => document.getElementById('recActions');

  function setBar({ title, step, pct, phase, mode, show }) {
    if (show === false) {
      bar.classList.remove('on', 'done', 'fail', 'recording');
      return;
    }
    bar.classList.add('on');
    bar.classList.toggle('done', mode === 'done');
    bar.classList.toggle('fail', mode === 'fail');
    bar.classList.toggle('recording', mode === 'recording' || phase === 'recording');
    if (title) bar.querySelector('.title').textContent = title;
    if (step != null && elStep()) elStep().textContent = step;
    const p = Math.max(0, Math.min(100, pct == null ? 0 : pct));
    if (elFill()) elFill().style.width = p + '%';
    if (elPct()) elPct().textContent = Math.round(p) + '%';
    if (phase != null && elPhase()) elPhase().textContent = phase;
    if (onStatus && step) onStatus(step);
  }

  function showLinkActions(url) {
    const a = elActions();
    if (!a) return;
    a.style.display = 'flex';
    a.innerHTML = '';
    const open = document.createElement('button');
    open.textContent = 'Open link';
    open.onclick = () => { try { window.open(url, '_blank'); } catch (_) {} };
    const copy = document.createElement('button');
    copy.textContent = 'Copy link';
    copy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(url);
        setBar({ step: 'Link copied', pct: 100, phase: 'done', mode: 'done' });
      } catch (_) {
        setBar({ step: url, pct: 100, phase: 'done', mode: 'done' });
      }
    };
    const hide = document.createElement('button');
    hide.textContent = 'Dismiss';
    hide.onclick = () => setBar({ show: false });
    a.append(open, copy, hide);
  }

  function hostLabel(host, expires) {
    if (host === 'litterbox') return `Litterbox (${expires || '72h'})`;
    if (host === 'discord') return 'Discord (watchable + embeds)';
    if (host === 'catbox') return 'Catbox (keeps file)';
    if (host === 'pixeldrain') return 'Pixeldrain (watchable)';
    if (host === 'uguu') return 'Uguu';
    if (host === 'gofile') return 'Gofile';
    if (host === '0x0') return '0x0.st';
    if (host === 'tmpfiles') return `tmpfiles (${expires || 'short'})`;
    if (host === 'file.io') return `file.io (${expires || 'temp'})`;
    if (host === 'worker') return 'Worker';
    return host || 'host';
  }

  /** XHR PUT/POST with upload progress (0–100 of this request) */
  function xhrSend({ url, method = 'POST', body, headers = {}, timeoutMs = 90000, onProg }) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(method, url, true);
      for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
      xhr.timeout = timeoutMs;
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProg) onProg(e.loaded / e.total);
      };
      xhr.onload = () => {
        resolve({ status: xhr.status, text: xhr.responseText || '', ok: xhr.status >= 200 && xhr.status < 300 });
      };
      xhr.onerror = () => reject(new Error('network error (blocked or offline — is workers.dev reachable?)'));
      xhr.ontimeout = () => reject(new Error('timed out'));
      xhr.send(body);
    });
  }

  async function uploadViaWorker(it, basePct, span, host = 'auto') {
    const base = (WORKER_URL || '').replace(/\/$/, '');
    if (!base) throw new Error('no worker URL configured');
    const ext = it.name.split('.').pop() || 'webm';
    const type = ext === 'webm' ? 'video/webm' : 'video/mp4';
    const url = `${base}/api/rec?name=${encodeURIComponent(it.name)}&host=${encodeURIComponent(host || 'auto')}`;
    setBar({
      title: 'Uploading',
      step: `Sending to server (${host})…`,
      pct: basePct,
      phase: 'worker',
      mode: '',
    });
    const res = await xhrSend({
      url,
      method: 'PUT',
      body: it.blob,
      headers: { 'Content-Type': type },
      timeoutMs: 120000,
      onProg: (f) => {
        setBar({
          step: `Uploading to server… ${Math.round(f * 100)}%`,
          pct: basePct + f * span,
          phase: 'worker',
          mode: '',
        });
      },
    });
    let data = {};
    try { data = JSON.parse(res.text); } catch (_) {}
    if (!res.ok) throw new Error(data.error || res.text.slice(0, 100) || (`HTTP ${res.status}`));
    if (!data.url) throw new Error(data.error || 'server returned no link');
    return { url: data.url, host: data.host || host, expires: data.expires || '' };
  }

  async function upload(it) {
    lastBlob = it.blob;
    lastName = it.name;
    const mb = (it.blob.size / 1048576).toFixed(2);
    setBar({
      title: 'Uploading',
      step: `Clip ready (${mb} MB). Uploading via server…`,
      pct: 30,
      phase: 'upload',
      mode: '',
    });
    if (elActions()) { elActions().style.display = 'none'; elActions().innerHTML = ''; }

    // Browser cannot POST to catbox/0x0 directly (CORS → "network error").
    // All uploads go through the Cloudflare worker.
    const attempts = [
      { host: 'auto', label: 'server (auto)' },
      { host: 'discord', label: 'server → Discord' },
      { host: 'litterbox', label: 'server → litterbox' },
      { host: 'catbox', label: 'server → catbox' },
    ];
    const errors = [];
    for (let i = 0; i < attempts.length; i++) {
      const a = attempts[i];
      const startPct = 30 + (i / attempts.length) * 60;
      setBar({
        title: 'Uploading',
        step: `Trying ${a.label} (${i + 1}/${attempts.length})…`,
        pct: startPct,
        phase: a.host,
        mode: '',
      });
      try {
        const result = await uploadViaWorker(it, startPct, 60 / attempts.length, a.host);
        lastUrl = result.url;
        lastHost = result.host;
        lastExpires = result.expires || '';
        setBar({
          title: 'Uploaded',
          step: `Done — ${hostLabel(lastHost, lastExpires)}\n${lastUrl}`,
          pct: 100,
          phase: 'done',
          mode: 'done',
        });
        showLinkActions(lastUrl);
        try {
          if (navigator.clipboard && lastUrl) await navigator.clipboard.writeText(lastUrl);
        } catch (_) {}
        return;
      } catch (e) {
        errors.push(`${a.label}: ${e.message || e}`);
        setBar({
          step: `${a.label} failed — ${String(e.message || e).slice(0, 70)}`,
          pct: startPct + 60 / attempts.length,
          phase: a.host,
          mode: '',
        });
      }
    }
    pending.push(it);
    setBar({
      title: 'Upload failed',
      step: `Server could not host the file:\n${errors.join('\n')}`,
      pct: 100,
      phase: 'failed',
      mode: 'fail',
    });
    const act = elActions();
    if (act) {
      act.style.display = 'flex';
      act.innerHTML = '';
      const retry = document.createElement('button');
      retry.textContent = 'Retry upload';
      retry.onclick = () => {
        if (lastBlob) upload({ blob: lastBlob, name: lastName || 'clip.webm' });
      };
      const dismiss = document.createElement('button');
      dismiss.textContent = 'Dismiss';
      dismiss.onclick = () => setBar({ show: false });
      act.append(retry, dismiss);
    }
  }

  function encodeSettings(elapsedMs) {
    let w = recCfg.width || 1280;
    let mbps = recCfg.mbps || 1.8;
    if (elapsedMs > 4 * 60 * 1000) {
      w = Math.min(w, 960);
      mbps = Math.min(mbps, 1.4);
    }
    if (elapsedMs > 8 * 60 * 1000) {
      w = Math.min(w, 854);
      mbps = Math.min(mbps, 1.0);
    }
    return { w, mbps };
  }

  function start() {
    if (active) return;
    mime = window.MediaRecorder ? MIMES.find((m) => MediaRecorder.isTypeSupported(m)) || '' : '';
    if (!mime) {
      setBar({ title: 'Recording', step: 'Not supported on this browser', pct: 0, phase: 'error', mode: 'fail', show: true });
      return;
    }
    const { w, mbps } = encodeSettings(0);
    const srcW = canvas.width || 1280;
    const srcH = canvas.height || 720;
    out.width = Math.min(w, srcW);
    out.height = Math.round((out.width * srcH) / srcW / 2) * 2;
    hudL.width = out.width;
    hudL.height = out.height;
    hudAt = 0;
    hudEvery = 0;
    hudOk = true;

    const as = audio && audio.recordStream ? audio.recordStream() : null;
    const vstream = out.captureStream(30);
    stream = new MediaStream([
      ...vstream.getVideoTracks(),
      ...(as ? as.getAudioTracks() : []),
    ]);

    chunks = [];
    chunkBytes = 0;
    t0 = performance.now();
    last = 0;
    stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    active = true;
    lastUrl = '';
    if (elActions()) { elActions().style.display = 'none'; elActions().innerHTML = ''; }

    const bits = Math.round(mbps * 1e6);
    rec = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: bits,
      audioBitsPerSecond: 128000,
    });
    rec.ondataavailable = (e) => {
      if (e.data && e.data.size) {
        chunks.push(e.data);
        chunkBytes += e.data.size;
        if (active) {
          const sec = Math.floor((performance.now() - t0) / 1000);
          const mb = (chunkBytes / 1048576).toFixed(1);
          setBar({
            title: 'Recording',
            step: `REC ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')} · ${mb}MB`,
            pct: Math.min(20, 4 + sec * 0.15),
            phase: 'recording',
            mode: 'recording',
          });
        }
      }
    };
    rec.onstop = () => {};
    try {
      rec.start(250);
    } catch (e) {
      active = false;
      setBar({ title: 'Recording', step: 'Could not start recorder', pct: 0, mode: 'fail' });
      return;
    }
    maxTimer = setTimeout(() => {
      if (active) {
        setBar({ step: 'Hit 30 min limit — stopping', pct: 22, phase: 'limit' });
        stop();
      }
    }, MAX_MS);
    setBar({
      title: 'Recording',
      step: 'REC 0:00',
      pct: 3,
      phase: 'recording',
      mode: 'recording',
      show: true,
    });
  }

  function stop() {
    if (!active) return;
    active = false;
    if (maxTimer) {
      clearTimeout(maxTimer);
      maxTimer = 0;
    }
    setBar({
      title: 'Finalizing',
      step: 'Stopping recorder…',
      pct: 22,
      phase: 'stopping',
      mode: '',
    });
    const recRef = rec;
    let finished = false;
    const forceFinish = () => {
      if (finished) return;
      finished = true;
      try {
        if (stream) stream.getTracks().forEach((t) => t.stop());
      } catch (_) {}
      stream = null;
      const localMime = (mime || 'video/webm').split(';')[0];
      const localChunks = chunks.slice();
      chunks = [];
      if (!localChunks.length) {
        setBar({
          title: 'Finalizing',
          step: 'Nothing was recorded (browser blocked capture)',
          pct: 0,
          mode: 'fail',
          phase: 'empty',
        });
        return;
      }
      setBar({
        title: 'Finalizing',
        step: `Building file from ${localChunks.length} chunks…`,
        pct: 24,
        phase: 'blob',
      });
      let blob;
      try {
        blob = new Blob(localChunks, { type: localMime });
      } catch (e) {
        setBar({
          title: 'Finalizing',
          step: 'Failed to build file (out of memory?)',
          pct: 0,
          mode: 'fail',
        });
        return;
      }
      localChunks.length = 0;
      const name = `realmrange-${stamp}.${localMime.includes('mp4') ? 'mp4' : 'webm'}`;
      setBar({
        title: 'Finalizing',
        step: `File ready (${(blob.size / 1048576).toFixed(1)} MB). Starting upload…`,
        pct: 28,
        phase: 'ready',
      });
      upload({ blob, name });
    };

    if (recRef) {
      recRef.onstop = () => forceFinish();
      try {
        if (recRef.state === 'recording') {
          try { recRef.requestData(); } catch (_) {}
          setTimeout(() => { try { recRef.requestData(); } catch (_) {} }, 50);
          recRef.stop();
        } else if (recRef.state === 'inactive') {
          forceFinish();
        } else {
          try { recRef.requestData(); } catch (_) {}
          try { recRef.stop(); } catch (_) {}
        }
      } catch (_) {
        forceFinish();
      }
      setTimeout(() => {
        if (!finished) {
          setBar({ step: 'Recorder stuck — forcing finalize…', pct: 23, phase: 'force' });
          forceFinish();
        }
      }, 2000);
    } else {
      forceFinish();
    }
    rec = null;
  }

  // ---------- fallback HUD (hand-drawn) — only used if the exact HUD capture fails ----------
  function drawScope(W, H, amount) {
    const a = Math.min(1, Math.max(0, amount));
    if (a < 0.02) return;
    const cx = W / 2;
    const cy = H / 2;
    const R = Math.min(W, H) * 0.33;
    g.save();
    g.globalAlpha = a;
    // black outside the optic (even-odd hole)
    g.fillStyle = 'rgba(0,0,0,0.97)';
    g.beginPath();
    g.rect(0, 0, W, H);
    g.moveTo(cx + R, cy);
    g.arc(cx, cy, R, 0, Math.PI * 2, true);
    g.fill('evenodd');
    // crosshair
    g.strokeStyle = '#0a0a0a';
    g.lineWidth = Math.max(2, W * 0.002);
    g.beginPath();
    g.moveTo(cx, cy - R);
    g.lineTo(cx, cy + R);
    g.moveTo(cx - R, cy);
    g.lineTo(cx + R, cy);
    g.stroke();
    // mild inner edge
    g.strokeStyle = 'rgba(0,0,0,0.55)';
    g.lineWidth = Math.max(4, W * 0.006);
    g.beginPath();
    g.arc(cx, cy, R, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  }

  function drawAdsVignette(W, H, ads) {
    if (!ads || ads < 0.05) return;
    g.save();
    g.globalAlpha = Math.min(0.55, ads * 0.5);
    const grd = g.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.min(W, H) * 0.7);
    grd.addColorStop(0, 'rgba(0,0,0,0)');
    grd.addColorStop(1, 'rgba(0,0,0,0.85)');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);
    g.restore();
  }

  function hudDraw(s) {
    if (!s) return;
    const W = out.width;
    const H = out.height;
    const k = H / 600;
    const now = performance.now();

    // Scope / ADS overlays first (over world, under chrome)
    drawAdsVignette(W, H, s.adsBlend != null ? s.adsBlend : s.ads ? 1 : 0);
    if (s.scope > 0.05) drawScope(W, H, s.scope);

    g.save();
    g.shadowColor = 'rgba(0,0,0,.8)';
    g.shadowBlur = 4 * k;

    // Crosshair only when not scoped
    if (!(s.scope > 0.45)) {
      g.strokeStyle = '#fff';
      g.lineWidth = 2 * k;
      const c = W / 2;
      const m = H / 2;
      const a = 6 * k;
      const b = 14 * k;
      g.beginPath();
      g.moveTo(c - b, m);
      g.lineTo(c - a, m);
      g.moveTo(c + a, m);
      g.lineTo(c + b, m);
      g.moveTo(c, m - b);
      g.lineTo(c, m - a);
      g.moveTo(c, m + a);
      g.lineTo(c, m + b);
      g.stroke();
    }

    // Hit markers
    const hx = W / 2, hy = H / 2;
    for (const h of hits) {
      const age = now - h.t;
      const life = h.kind === 'kill' ? 550 : 300;
      if (age > life) continue;
      const a = 1 - age / life;
      const col = h.kind === 'kill' ? '#ff3b3b' : h.kind === 'head' ? '#ff9a2e' : '#ffffff';
      const arm = (h.kind === 'kill' ? 15 : 11) * k;
      const gap = 6 * k;
      g.save();
      g.globalAlpha = a;
      g.strokeStyle = col;
      g.lineWidth = 2 * k;
      g.beginPath();
      g.moveTo(hx - gap - arm * 0.7, hy - gap - arm * 0.7);
      g.lineTo(hx - gap, hy - gap);
      g.moveTo(hx + gap + arm * 0.7, hy - gap - arm * 0.7);
      g.lineTo(hx + gap, hy - gap);
      g.moveTo(hx - gap - arm * 0.7, hy + gap + arm * 0.7);
      g.lineTo(hx - gap, hy + gap);
      g.moveTo(hx + gap + arm * 0.7, hy + gap + arm * 0.7);
      g.lineTo(hx + gap, hy + gap);
      g.stroke();
      g.restore();
    }

    // Low HP pulse
    if (s.hp < 35 && s.alive !== false) {
      g.save();
      g.globalAlpha = 0.25 + 0.15 * Math.sin(now / 180);
      g.fillStyle = '#ff2a1a';
      g.fillRect(0, 0, W, H);
      g.restore();
    }

    // Top center: K / D
    g.textAlign = 'center';
    g.fillStyle = 'rgba(0,0,0,.45)';
    g.fillRect(W / 2 - 70 * k, 12 * k, 140 * k, 28 * k);
    g.fillStyle = '#fff';
    g.font = `700 ${16 * k}px monospace`;
    g.fillText(`K ${s.kills|0}    D ${s.deaths|0}`, W / 2, 32 * k);

    // Weapon slots (main / side / melee)
    const slots = s.slots || [];
    if (slots.length) {
      let x = W / 2 - (slots.length * 72 * k) / 2;
      const y = 48 * k;
      g.font = `600 ${11 * k}px system-ui`;
      g.textAlign = 'center';
      slots.forEach((sl, i) => {
        const on = sl.on;
        g.fillStyle = on ? 'rgba(255,194,71,.25)' : 'rgba(0,0,0,.4)';
        g.strokeStyle = on ? '#ffc247' : 'rgba(255,255,255,.25)';
        g.lineWidth = on ? 2 * k : 1 * k;
        g.beginPath();
        g.roundRect?.(x, y, 68 * k, 22 * k, 6 * k);
        if (!g.roundRect) g.rect(x, y, 68 * k, 22 * k);
        g.fill();
        g.stroke();
        g.fillStyle = on ? '#ffc247' : '#ddd';
        g.fillText(`${i + 1} ${(sl.name || '').slice(0, 10)}`, x + 34 * k, y + 15 * k);
        x += 72 * k;
      });
    }

    // Stance / cam (top-left under minimap area)
    g.textAlign = 'left';
    g.font = `600 ${12 * k}px system-ui`;
    g.fillStyle = 'rgba(255,255,255,.75)';
    const stance = s.crouching ? 'CROUCH' : s.sprinting ? 'SPRINT' : '';
    const cam = s.thirdPerson ? '3RD' : '1ST';
    if (stance) g.fillText(stance, 16 * k, 56 * k);
    g.fillText(cam, 16 * k, 72 * k);

    // Bottom-left HP
    g.fillStyle = 'rgba(0,0,0,.5)';
    g.fillRect(16 * k, H - 40 * k, 220 * k, 12 * k);
    g.fillStyle = s.hp < 35 ? '#ff5a4a' : '#4be08e';
    g.fillRect(16 * k, H - 40 * k, (220 * k * Math.max(0, Math.min(100, s.hp))) / 100, 12 * k);
    g.fillStyle = '#fff';
    g.font = `800 ${28 * k}px monospace`;
    g.fillText(String(s.hp|0), 16 * k, H - 50 * k);
    g.font = `600 ${11 * k}px system-ui`;
    g.fillStyle = 'rgba(255,255,255,.7)';
    g.fillText('HEALTH', 70 * k, H - 50 * k);

    // Bottom-right weapon + ammo
    g.textAlign = 'right';
    g.fillStyle = '#ffc247';
    g.font = `700 ${14 * k}px monospace`;
    g.fillText(s.weapon || '', W - 16 * k, H - 62 * k);
    g.fillStyle = '#fff';
    g.font = `800 ${32 * k}px monospace`;
    if (s.kind === 'gun') g.fillText(`${s.ammo} / ${s.reserve}`, W - 16 * k, H - 24 * k);
    else g.fillText(s.kind === 'melee' ? 'MELEE' : '', W - 16 * k, H - 24 * k);

    // Reload bar
    if (s.reloading && s.reloadTotal > 0) {
      const t = Math.min(1, (s.reloadT || 0) / s.reloadTotal);
      const bw = 160 * k;
      const bx = W / 2 - bw / 2;
      const by = H - 90 * k;
      g.fillStyle = 'rgba(0,0,0,.5)';
      g.fillRect(bx, by, bw, 8 * k);
      g.fillStyle = '#ffc247';
      g.fillRect(bx, by, bw * t, 8 * k);
      g.fillStyle = '#fff';
      g.font = `600 ${12 * k}px system-ui`;
      g.textAlign = 'center';
      g.fillText('RELOADING', W / 2, by - 6 * k);
    }

    // Kill feed
    g.textAlign = 'right';
    g.font = `600 ${13 * k}px system-ui`;
    feed
      .filter((f) => now - f.t < 6000)
      .forEach((f, i) => {
        const y = 100 * k + i * 24 * k;
        const text = f.s;
        const tw = g.measureText(text).width;
        const padX = 10 * k, h = 18 * k;
        g.fillStyle = 'rgba(0,0,0,.55)';
        g.fillRect(W - 16 * k - tw - padX * 2, y - h + 4 * k, tw + padX * 2, h);
        g.fillStyle = '#ffc247';
        g.fillRect(W - 16 * k - tw - padX * 2, y - h + 4 * k, 3 * k, h);
        g.fillStyle = '#fff';
        g.fillText(text, W - 16 * k - padX, y);
      });

    // Center message
    if (s.msg) {
      g.textAlign = 'center';
      g.font = `700 ${18 * k}px system-ui`;
      g.fillStyle = 'rgba(0,0,0,.55)';
      const tw = g.measureText(s.msg).width;
      g.fillRect(W / 2 - tw / 2 - 12 * k, H * 0.18, tw + 24 * k, 28 * k);
      g.fillStyle = '#fff';
      g.fillText(s.msg, W / 2, H * 0.18 + 20 * k);
    }

    // Building badge
    if (s.building) {
      g.textAlign = 'center';
      g.fillStyle = 'rgba(80,200,120,.35)';
      g.fillRect(W / 2 - 50 * k, H - 110 * k, 100 * k, 22 * k);
      g.fillStyle = '#9dffb0';
      g.font = `700 ${13 * k}px system-ui`;
      g.fillText('BUILD MODE', W / 2, H - 94 * k);
    }

      g.restore();
  }

  /** the real on-screen HUD, redrawn every frame (or less often if that gets slow), with the hand-drawn HUD as fallback */
  function drawHud(now) {
    if (hudOk) {
      try {
        if (now - hudAt >= hudEvery) {
          const t = performance.now();
          hudG.clearRect(0, 0, hudL.width, hudL.height);
          hudCap.draw(hudG, hudL.width, hudL.height);
          const ms = performance.now() - t;
          hudEvery = ms > 8 ? Math.min(150, ms * 3) : 0;
          hudAt = now;
        }
        g.drawImage(hudL, 0, 0);
        return;
      } catch (e) {
        hudOk = false;
        console.warn('[rec] HUD capture failed, using the simple HUD instead', e);
      }
    }
    hudDraw(getState());
  }

  function frame(now) {
    if (!active || now - last < 33) return;
    last = now;
    // Long recording: optionally downscale mid-session is hard; keep frame path light
    g.drawImage(canvas, 0, 0, out.width, out.height);
    try {
      drawHud(now);
    } catch (_) {}
  }

  return {
    start,
    stop,
    frame,
    toggle() {
      if (active) stop();
      else start();
    },
    get active() {
      return active;
    },
    get elapsed() {
      return active ? (performance.now() - t0) / 1000 : 0;
    },
    get lastUrl() {
      return lastUrl;
    },
    get lastHost() {
      return lastHost;
    },
    get lastExpires() {
      return lastExpires;
    },
    feedKill(a, b, head) {
      feed.push({ t: performance.now(), s: `${a} ${head ? '◎' : '▸'} ${b}` });
      if (feed.length > 6) feed.shift();
    },
    hitMarker(kind = 'hit') {
      const k = kind === 'head' || kind === 'headshot' ? 'head' : kind === 'kill' ? 'kill' : 'hit';
      hits.push({ t: performance.now(), kind: k });
      if (hits.length > 8) hits.shift();
    },
    retryUpload() {
      if (lastBlob) return upload({ blob: lastBlob, name: lastName || 'clip.webm' });
    },
    // used by the Recording menu buttons (menus.js)
    retry() {
      if (lastBlob) return upload({ blob: lastBlob, name: lastName || 'clip.webm' });
    },
    copyLastUrl() {
      if (lastUrl && navigator.clipboard) return navigator.clipboard.writeText(lastUrl).catch(() => {});
    },
    downloadAll() {
      if (!lastBlob) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(lastBlob);
      a.download = lastName || 'clip.webm';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    },
  };
}
