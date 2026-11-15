/**
 * Runs inside the page BEFORE the game loads (Playwright addInitScript).
 * Turns the game into a deterministic frame-by-frame renderer without touching any game file:
 *  - virtual clock (performance.now) and a hand-cranked requestAnimationFrame
 *  - seeded Math.random, so every parallel job simulates the exact same trailer
 *  - the game's AudioContext becomes an OfflineAudioContext that is stepped in lockstep with the video
 *  - CSS keyframe animations are driven by the virtual clock. An animation the game has stopped (class removed) is
 *    cancelled for real: a script-paused CSS animation otherwise survives its class and keeps holding opacity:1,
 *    which left card text on screen until the next card replaced it
 *  - the trailer overlay's CSS transitions are switched off
 *  - a switch that skips GPU draw calls on frames this job does not capture. Draws into CUBE-MAP framebuffers are never
 *    skipped: three.js bakes scene.background (the equirect sky) into a cube map ONCE and caches it forever
 *  - WebSocket is disabled so the render never connects to the multiplayer worker
 */
(() => {
  const CFG = window.__RT_CFG || {};
  const FPS = CFG.fps || 30, DT = 1000 / FPS, SR = CFG.sampleRate || 48000, SECS = CFG.audioSecs || 130;
  const S = {
    vt: 0, q: [], id: 1, skipGL: false, ready: false, tm: false, scoreSeen: false,
    oc: null, rs: null, audioOn: false, next: null, rend: null, buf: null,
  };

  // ---------- seeded Math.random (mulberry32) ----------
  let seed = 0x1badb002;
  Math.random = () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  // ---------- virtual time + hand-cranked rAF ----------
  performance.now = () => S.vt;
  window.requestAnimationFrame = (cb) => { const id = S.id++; S.q.push([id, cb]); return id; };
  window.cancelAnimationFrame = (id) => { S.q = S.q.filter((e) => e[0] !== id); };

  // ---------- no network ----------
  window.WebSocket = function () { throw new Error('network is off while rendering'); };

  // ---------- trailer overlay: no CSS transitions (only the trailer's own elements, so game boot is untouched) ----------
  const noTrans = document.createElement('style');
  noTrans.textContent = '#trailerUI,#trailerUI *,#trailerGrade{transition:none!important}';
  const mountStyle = () => { if (document.head) { document.head.appendChild(noTrans); return true; } return false; };
  if (!mountStyle()) {
    const mo = new MutationObserver(() => { if (mountStyle()) mo.disconnect(); });
    mo.observe(document, { childList: true, subtree: true });
  }

  // ---------- card text: cancel its animations whenever the game swaps its class ----------
  // The game does `card.className = 'trcard'` (hide) and later `card.className = 'trcard on s'` (show, replays trSlam).
  // Cancelling first guarantees the hide is instant and the next show starts a fresh animation.
  try {
    const d = Object.getOwnPropertyDescriptor(Element.prototype, 'className');
    if (d && d.set) {
      Object.defineProperty(Element.prototype, 'className', {
        configurable: true, enumerable: d.enumerable, get: d.get,
        set(v) {
          try { if (this.classList && this.classList.contains('trcard')) for (const a of this.getAnimations()) a.cancel(); } catch (_) {}
          d.set.call(this, v);
        },
      });
    }
  } catch (_) {}

  // ---------- skip GPU work on frames this job does not capture ----------
  const NOOP = ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'drawRangeElements',
    'clear', 'clearBufferfv', 'clearBufferiv', 'clearBufferuiv', 'clearBufferfi', 'blitFramebuffer'];
  const FB = 0x8D40, DRAW_FB = 0x8CA9, CUBE_LO = 0x8515, CUBE_HI = 0x851A; // FRAMEBUFFER, DRAW_FRAMEBUFFER, TEXTURE_CUBE_MAP_POSITIVE_X .. NEGATIVE_Z
  const cubeFB = new WeakSet(); // framebuffers that have a cube-map face attached: one-off bakes (the sky) render into these
  for (const C of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!C) continue;
    const P = C.prototype, bindFB = P.bindFramebuffer, fbTex = P.framebufferTexture2D;
    P.bindFramebuffer = function (t, fb) { if (t === FB || t === DRAW_FB) this.__rtFB = fb; return bindFB.call(this, t, fb); };
    P.framebufferTexture2D = function (t, a, tt, tex, l) {
      if ((t === FB || t === DRAW_FB) && this.__rtFB && tt >= CUBE_LO && tt <= CUBE_HI) cubeFB.add(this.__rtFB);
      return fbTex.call(this, t, a, tt, tex, l);
    };
    for (const f of NOOP) {
      const orig = P[f];
      if (typeof orig !== 'function') continue;
      P[f] = function (...a) { return S.skipGL && !(this.__rtFB && cubeFB.has(this.__rtFB)) ? undefined : orig.apply(this, a); };
    }
  }

  // ---------- audio: an offline context we advance by hand ----------
  const quant = (t) => (Math.ceil((t * SR) / 128) * 128) / SR; // suspend points land on 128-sample render quanta
  function FakeAC() {
    if (S.oc) return S.oc;
    const oc = new OfflineAudioContext({ numberOfChannels: 2, length: Math.ceil(SR * SECS), sampleRate: SR });
    S.rs = { resume: oc.resume.bind(oc), suspend: oc.suspend.bind(oc), start: oc.startRendering.bind(oc) };
    Object.defineProperty(oc, 'state', { get: () => 'running', configurable: true }); // the game only schedules sound while 'running'
    oc.resume = () => Promise.resolve();
    oc.createMediaStreamDestination = () => { const g = oc.createGain(); g.stream = null; return g; };
    const cc = oc.createDynamicsCompressor.bind(oc);
    oc.createDynamicsCompressor = () => {
      const n = cc();
      // buildScore() (lib/trailerScore.js) makes the first compressor after the trailer starts; start() sets ready right after it returns
      if (!S.scoreSeen && document.body && document.body.classList.contains('trailer-mode')) {
        S.scoreSeen = true;
        queueMicrotask(() => { S.ready = true; });
      }
      return n;
    };
    S.oc = oc;
    return oc;
  }
  window.AudioContext = FakeAC;
  window.webkitAudioContext = FakeAC;

  // same random stream in every job from the moment the trailer starts building
  new MutationObserver(() => {
    if (!S.tm && document.body && document.body.classList.contains('trailer-mode')) { S.tm = true; seed = 0x5eed1234; }
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ['class'] });

  // ---------- CSS animations follow the virtual clock ----------
  const born = new WeakMap();
  function syncAnims() {
    let list;
    try { list = document.getAnimations(); } catch (_) { return; }
    for (const a of list) {
      try {
        // a CSS animation whose name is no longer in its element's animation-name was stopped by the game: cancel it for real
        if (typeof CSSAnimation !== 'undefined' && a instanceof CSSAnimation) {
          const el = a.effect && a.effect.target;
          if (el && el.isConnected) {
            const names = getComputedStyle(el, a.effect.pseudoElement || null).animationName.split(',').map((s) => s.trim());
            if (!names.includes(a.animationName)) { a.cancel(); continue; }
          }
        }
      } catch (_) {}
      let t0 = born.get(a);
      if (t0 === undefined) { t0 = S.vt; born.set(a, t0); }
      try { if (a.playState === 'running') a.pause(); a.currentTime = S.vt - t0; } catch (_) {}
    }
  }

  const b64 = (u8) => {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  };

  window.__rt = {
    isReady: () => S.ready,
    /** identical random stream in every job from here on */
    begin() { seed = 0x00c0ffee; },
    /** text of the trailer's own warning chip (missing radio lines etc.), '' when none */
    chip() { const e = document.querySelector('#trailerUI .trsnd'); return e && e.style.display !== 'none' ? e.textContent : ''; },
    /** debug: what CSS animations exist right now (RT_DEBUG=1) */
    anims() {
      try {
        return document.getAnimations().slice(0, 12).map((a) => `${a.constructor.name}:${a.animationName || a.transitionProperty || '?'}:${a.playState}:${Math.round(a.currentTime || 0)}`).join(' | ') || '(none)';
      } catch (e) { return 'n/a'; }
    },
    /**
     * Run exactly one frame. skip = no GPU work. k = trailer frame index (>= 0 once it runs, -1 while booting).
     * Returns true while the trailer is still playing.
     */
    async step(skip, k) {
      S.skipGL = !!skip;
      S.vt += DT;
      if (S.audioOn) await S.next; // audio is parked at this frame's time
      const q = S.q; S.q = [];
      for (const [, cb] of q) { try { cb(S.vt); } catch (e) { console.error('[rt] frame callback failed:', e); } }
      syncAnims();
      if (S.audioOn) {
        const nt = (k + 1) / FPS;
        if (nt + 0.5 >= SECS) throw new Error('audio_secs is too short for this trailer: raise it in the workflow inputs');
        S.next = S.rs.suspend(quant(nt)); // register the next stop BEFORE letting the audio run
        S.rs.resume().catch((e) => console.error('[rt] audio resume failed:', e));
      }
      return !!document.body && document.body.classList.contains('trailer-mode');
    },
    /** call right after frame 0 */
    startAudio() {
      S.next = S.rs.suspend(quant(1 / FPS));
      S.rend = S.rs.start();
      S.audioOn = true;
    },
    async finishAudio() {
      if (!S.audioOn) return 0;
      await S.next;
      S.rs.resume().catch(() => {});
      S.buf = await S.rend;
      S.audioOn = false;
      return S.buf.length;
    },
    /** send the first n samples (16-bit stereo PCM) to the Node side in chunks */
    async exportAudio(n) {
      const b = S.buf; if (!b) return;
      const c0 = b.getChannelData(0), c1 = b.numberOfChannels > 1 ? b.getChannelData(1) : c0;
      const STEP = 1 << 17;
      for (let i = 0; i < n; i += STEP) {
        const m = Math.min(STEP, n - i), out = new Int16Array(m * 2);
        for (let j = 0; j < m; j++) {
          const ok = i + j < b.length, l = ok ? c0[i + j] : 0, r = ok ? c1[i + j] : 0;
          out[2 * j] = Math.max(-1, Math.min(1, l)) * 32767;
          out[2 * j + 1] = Math.max(-1, Math.min(1, r)) * 32767;
        }
        await window.__rtSave(b64(new Uint8Array(out.buffer)));
      }
    },
  };
})();
