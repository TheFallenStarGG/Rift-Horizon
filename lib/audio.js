/** Fully synthesized sound effects (WebAudio) — no audio files needed */

export function createAudio(settings) {
  let ctx = null, master = null, reverb = null, noiseBuf = null, ambientOn = false, recDest = null;
  const L = { x: 0, z: 0, yaw: 0 };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function init() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = settings.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    master.connect(comp);
    comp.connect(ctx.destination);
    recDest = ctx.createMediaStreamDestination();
    comp.connect(recDest);

    const len = ctx.sampleRate * 2;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    const conv = ctx.createConvolver();
    const irLen = Math.floor(ctx.sampleRate * 1.6);
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const a = ir.getChannelData(ch);
      for (let i = 0; i < irLen; i++) a[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 3.2);
    }
    conv.buffer = ir;
    reverb = ctx.createGain();
    reverb.gain.value = 0.35;
    reverb.connect(conv);
    conv.connect(master);
    return true;
  }

  function bus(vol, pan, wet, lp) {
    const g = ctx.createGain();
    g.gain.value = vol;
    let tail = g;
    if (lp < 19000) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = lp;
      tail.connect(f);
      tail = f;
    }
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      tail.connect(p);
      tail = p;
    }
    tail.connect(master);
    if (wet > 0) {
      const w = ctx.createGain();
      w.gain.value = wet;
      tail.connect(w);
      w.connect(reverb);
    }
    return g;
  }

  function noise(dest, t, o) {
    const { type = 'lowpass', f = 1000, f2 = null, q = 0.7, dur = 0.1, gain = 1, attack = 0.001 } = o;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const fl = ctx.createBiquadFilter();
    fl.type = type;
    fl.Q.value = q;
    fl.frequency.setValueAtTime(f, t);
    if (f2) fl.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
    const e = ctx.createGain();
    e.gain.setValueAtTime(0.0001, t);
    e.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), t + attack);
    e.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
    src.connect(fl);
    fl.connect(e);
    e.connect(dest);
    const end = t + attack + dur + 0.02;
    src.onended = () => {
      try { src.disconnect(); } catch (_) {}
      try { fl.disconnect(); } catch (_) {}
      try { e.disconnect(); } catch (_) {}
    };
    src.start(t, Math.random() * 1.5);
    try { src.stop(end); } catch (_) {}
  }

  function tone(dest, t, o) {
    const { type = 'sine', f = 440, f2 = null, dur = 0.15, gain = 0.5, attack = 0.002 } = o;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f, t);
    if (f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, f2), t + dur);
    const e = ctx.createGain();
    e.gain.setValueAtTime(0.0001, t);
    e.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0002), t + attack);
    e.gain.exponentialRampToValueAtTime(0.0001, t + attack + dur);
    osc.connect(e);
    e.connect(dest);
    const end = t + attack + dur + 0.02;
    osc.onended = () => {
      try { osc.disconnect(); } catch (_) {}
      try { e.disconnect(); } catch (_) {}
    };
    osc.start(t);
    try { osc.stop(end); } catch (_) {}
  }

  const G = {
    shot(o, t, p) {
      const f = p.enemy ? 0.85 : 1;
      noise(o, t, { type: 'highpass', f: 1800 * f, dur: 0.07, gain: 0.9 });
      noise(o, t, { type: 'bandpass', f: 1300, f2: 300, q: 0.8, dur: 0.22, gain: 1 });
      tone(o, t, { f: 170 * f, f2: 48, dur: 0.18, gain: 1 });
      noise(o, t + 0.02, { type: 'lowpass', f: 700, f2: 120, dur: 0.35, gain: 0.5 });
    },
    dry(o, t) {
      tone(o, t, { type: 'square', f: 2200, f2: 1400, dur: 0.03, gain: 0.12 });
      noise(o, t, { type: 'highpass', f: 3000, dur: 0.02, gain: 0.2 });
    },
    magRelease(o, t) {
      noise(o, t, { type: 'bandpass', f: 2600, q: 2, dur: 0.03, gain: 0.35 });
      tone(o, t, { type: 'square', f: 900, f2: 700, dur: 0.025, gain: 0.1 });
    },
    magOut(o, t) {
      noise(o, t, { type: 'bandpass', f: 1500, f2: 700, q: 1.2, dur: 0.14, gain: 0.35 });
      tone(o, t + 0.1, { type: 'triangle', f: 300, f2: 200, dur: 0.06, gain: 0.25 });
    },
    magDrop(o, t) {
      tone(o, t, { f: 130, f2: 60, dur: 0.12, gain: 0.7 });
      noise(o, t, { type: 'lowpass', f: 900, f2: 300, dur: 0.1, gain: 0.5 });
      noise(o, t + 0.09, { type: 'bandpass', f: 2400, q: 3, dur: 0.03, gain: 0.2 });
      tone(o, t + 0.13, { type: 'triangle', f: 200, f2: 120, dur: 0.05, gain: 0.25 });
    },
    pouch(o, t) {
      noise(o, t, { type: 'bandpass', f: 3200, f2: 1800, q: 0.7, dur: 0.16, gain: 0.28 });
      noise(o, t + 0.06, { type: 'lowpass', f: 600, dur: 0.08, gain: 0.2 });
    },
    magIn(o, t) {
      noise(o, t, { type: 'bandpass', f: 2500, q: 1.5, dur: 0.03, gain: 0.5 });
      tone(o, t, { type: 'triangle', f: 700, f2: 500, dur: 0.04, gain: 0.2 });
      tone(o, t + 0.05, { f: 180, f2: 90, dur: 0.09, gain: 0.6 });
      noise(o, t + 0.05, { type: 'lowpass', f: 900, dur: 0.07, gain: 0.4 });
    },
    boltBack(o, t) {
      noise(o, t, { type: 'highpass', f: 3200, f2: 1500, dur: 0.13, gain: 0.35 });
      tone(o, t, { type: 'sawtooth', f: 220, f2: 130, dur: 0.1, gain: 0.12 });
      tone(o, t + 0.09, { f: 160, f2: 100, dur: 0.06, gain: 0.3 });
    },
    boltFwd(o, t) {
      noise(o, t, { type: 'bandpass', f: 1900, q: 1.2, dur: 0.04, gain: 0.6 });
      tone(o, t, { type: 'square', f: 1100, f2: 800, dur: 0.02, gain: 0.12 });
      tone(o, t, { f: 230, f2: 110, dur: 0.09, gain: 0.7 });
      noise(o, t + 0.02, { type: 'lowpass', f: 1200, dur: 0.08, gain: 0.35 });
    },
    hit(o, t) {
      tone(o, t, { f: 1900, dur: 0.05, gain: 0.35 });
      tone(o, t + 0.045, { f: 1300, dur: 0.06, gain: 0.3 });
    },
    headshot(o, t) {
      tone(o, t, { f: 2600, dur: 0.06, gain: 0.4 });
      tone(o, t + 0.05, { f: 1800, dur: 0.08, gain: 0.35 });
      noise(o, t, { type: 'highpass', f: 4000, dur: 0.04, gain: 0.2 });
    },
    kill(o, t) {
      tone(o, t, { type: 'triangle', f: 660, dur: 0.1, gain: 0.3 });
      tone(o, t + 0.09, { type: 'triangle', f: 990, dur: 0.18, gain: 0.3 });
    },
    hurt(o, t) {
      tone(o, t, { f: 100, f2: 45, dur: 0.22, gain: 0.8 });
      noise(o, t, { type: 'lowpass', f: 500, f2: 150, dur: 0.2, gain: 0.6 });
    },
    death(o, t) {
      tone(o, t, { type: 'sawtooth', f: 140, f2: 35, dur: 0.9, gain: 0.3 });
      noise(o, t, { type: 'lowpass', f: 600, f2: 80, dur: 0.9, gain: 0.5 });
    },
    step(o, t, p) {
      const v = p.vol ?? 1;
      noise(o, t, { type: 'lowpass', f: 380 + Math.random() * 160, f2: 140, q: 0.9, dur: 0.09, gain: 0.55 * v });
      noise(o, t + 0.01, { type: 'bandpass', f: 2200, q: 0.8, dur: 0.03, gain: 0.1 * v });
    },
    land(o, t) {
      tone(o, t, { f: 110, f2: 50, dur: 0.14, gain: 0.6 });
      noise(o, t, { type: 'lowpass', f: 500, dur: 0.12, gain: 0.5 });
    },
    whiz(o, t) {
      noise(o, t, { type: 'bandpass', f: 3800, f2: 1400, q: 2.5, dur: 0.22, gain: 0.55 });
    },
    shell(o, t) {
      tone(o, t, { f: 3400, f2: 2900, dur: 0.05, gain: 0.12 });
      tone(o, t + 0.07, { f: 3000, f2: 2700, dur: 0.04, gain: 0.08 });
    },
    click(o, t) {
      tone(o, t, { type: 'triangle', f: 900, f2: 600, dur: 0.04, gain: 0.18 });
    },
    respawn(o, t) {
      tone(o, t, { type: 'triangle', f: 440, dur: 0.12, gain: 0.2 });
      tone(o, t + 0.1, { type: 'triangle', f: 660, dur: 0.2, gain: 0.2 });
    },
  };

  Object.assign(G, {
    eject(o, t) {
      tone(o, t, { f: 3300, f2: 2900, dur: 0.04, gain: 0.12 });
      tone(o, t + 0.09, { f: 2800, f2: 2500, dur: 0.04, gain: 0.08 });
    },
    shellIn(o, t) {
      noise(o, t, { type: 'bandpass', f: 1800, q: 2, dur: 0.04, gain: 0.4 });
      tone(o, t, { type: 'triangle', f: 260, f2: 160, dur: 0.06, gain: 0.35 });
    },
    pumpBack(o, t) {
      noise(o, t, { type: 'highpass', f: 2500, f2: 1200, dur: 0.12, gain: 0.35 });
      tone(o, t + 0.05, { f: 140, f2: 90, dur: 0.08, gain: 0.35 });
    },
    pumpFwd(o, t) {
      noise(o, t, { type: 'bandpass', f: 1700, q: 1.2, dur: 0.05, gain: 0.6 });
      tone(o, t, { f: 200, f2: 90, dur: 0.1, gain: 0.8 });
      tone(o, t + 0.02, { type: 'square', f: 1000, f2: 700, dur: 0.02, gain: 0.1 });
    },
    cylOut(o, t) {
      noise(o, t, { type: 'bandpass', f: 2200, q: 3, dur: 0.05, gain: 0.4 });
      tone(o, t + 0.03, { type: 'triangle', f: 420, f2: 300, dur: 0.06, gain: 0.25 });
    },
    speedIn(o, t) {
      noise(o, t, { type: 'bandpass', f: 2800, q: 2, dur: 0.06, gain: 0.45 });
      tone(o, t, { f: 210, f2: 120, dur: 0.08, gain: 0.5 });
    },
    cylIn(o, t) {
      tone(o, t, { type: 'triangle', f: 900, f2: 600, dur: 0.03, gain: 0.25 });
      tone(o, t + 0.02, { f: 190, f2: 100, dur: 0.09, gain: 0.7 });
      noise(o, t, { type: 'bandpass', f: 2400, q: 2, dur: 0.04, gain: 0.45 });
    },
    open(o, t) {
      noise(o, t, { type: 'bandpass', f: 1400, f2: 800, q: 1.5, dur: 0.1, gain: 0.4 });
      tone(o, t, { f: 170, f2: 110, dur: 0.07, gain: 0.4 });
    },
    close(o, t) {
      noise(o, t, { type: 'bandpass', f: 1900, q: 1.5, dur: 0.05, gain: 0.55 });
      tone(o, t, { f: 220, f2: 100, dur: 0.1, gain: 0.8 });
    },
    crossCock(o, t) {
      noise(o, t, { type: 'bandpass', f: 800, f2: 1800, q: 1.5, dur: 0.5, gain: 0.18 });
      tone(o, t, { type: 'sawtooth', f: 120, f2: 260, dur: 0.5, gain: 0.06 });
    },
    crossLatch(o, t) {
      tone(o, t, { type: 'square', f: 1500, f2: 900, dur: 0.025, gain: 0.14 });
      tone(o, t + 0.01, { f: 200, f2: 100, dur: 0.07, gain: 0.5 });
    },
    boltIn(o, t) {
      tone(o, t, { type: 'triangle', f: 600, f2: 400, dur: 0.04, gain: 0.2 });
      noise(o, t, { type: 'bandpass', f: 2000, q: 2, dur: 0.03, gain: 0.3 });
    },
    boltLock(o, t) {
      tone(o, t, { type: 'square', f: 1300, f2: 850, dur: 0.02, gain: 0.12 });
      tone(o, t, { f: 210, f2: 100, dur: 0.08, gain: 0.55 });
    },
    swing(o, t) {
      noise(o, t, { type: 'bandpass', f: 500, f2: 2200, q: 1.5, dur: 0.16, gain: 0.25 });
    },
    stab(o, t) {
      noise(o, t, { type: 'lowpass', f: 1500, f2: 300, dur: 0.12, gain: 0.8 });
      tone(o, t, { f: 240, f2: 100, dur: 0.1, gain: 0.7 });
      noise(o, t, { type: 'highpass', f: 3000, dur: 0.03, gain: 0.25 });
    },
    thud(o, t) {
      tone(o, t, { f: 90, f2: 40, dur: 0.2, gain: 0.9 });
      noise(o, t, { type: 'lowpass', f: 500, f2: 100, dur: 0.18, gain: 0.7 });
    },
    clang(o, t) {
      tone(o, t, { type: 'triangle', f: 1800, f2: 1700, dur: 0.3, gain: 0.2 });
      tone(o, t, { type: 'triangle', f: 2650, f2: 2600, dur: 0.25, gain: 0.15 });
      noise(o, t, { type: 'highpass', f: 3000, dur: 0.04, gain: 0.3 });
    },
    draw(o, t) {
      noise(o, t, { type: 'bandpass', f: 2400, f2: 1400, q: 0.8, dur: 0.1, gain: 0.2 });
    },
    jump2(o, t) {
      noise(o, t, { type: 'bandpass', f: 600, f2: 2000, q: 1.2, dur: 0.18, gain: 0.3 });
    },
  });

  const SHOTS = {
    stinger(o, t) {
      noise(o, t, { type: 'highpass', f: 2200, dur: 0.05, gain: 0.7 });
      noise(o, t, { type: 'bandpass', f: 1700, f2: 500, q: 0.9, dur: 0.14, gain: 0.8 });
      tone(o, t, { f: 210, f2: 70, dur: 0.1, gain: 0.8 });
    },
    breacher(o, t) {
      noise(o, t, { type: 'lowpass', f: 1800, f2: 150, dur: 0.5, gain: 1.2 });
      tone(o, t, { f: 110, f2: 32, dur: 0.35, gain: 1.2 });
      noise(o, t, { type: 'highpass', f: 1500, dur: 0.1, gain: 0.8 });
    },
    longbow(o, t) {
      noise(o, t, { type: 'highpass', f: 1500, dur: 0.12, gain: 1 });
      noise(o, t, { type: 'bandpass', f: 900, f2: 150, q: 0.7, dur: 0.7, gain: 1.1 });
      tone(o, t, { f: 90, f2: 30, dur: 0.5, gain: 1.1 });
      noise(o, t + 0.05, { type: 'lowpass', f: 500, f2: 80, dur: 0.9, gain: 0.5 });
    },
    ridgeback(o, t) {
      noise(o, t, { type: 'highpass', f: 1200, dur: 0.1, gain: 1 });
      noise(o, t, { type: 'bandpass', f: 800, f2: 120, q: 0.7, dur: 0.8, gain: 1.2 });
      tone(o, t, { f: 80, f2: 28, dur: 0.6, gain: 1.2 });
    },
    p9(o, t) {
      noise(o, t, { type: 'highpass', f: 2000, dur: 0.05, gain: 0.7 });
      noise(o, t, { type: 'bandpass', f: 1500, f2: 400, q: 0.9, dur: 0.14, gain: 0.7 });
      tone(o, t, { f: 190, f2: 70, dur: 0.1, gain: 0.7 });
    },
    marshal(o, t) {
      noise(o, t, { type: 'highpass', f: 1400, dur: 0.08, gain: 1 });
      noise(o, t, { type: 'bandpass', f: 1000, f2: 160, q: 0.7, dur: 0.5, gain: 1.1 });
      tone(o, t, { f: 120, f2: 36, dur: 0.4, gain: 1.1 });
      tone(o, t + 0.01, { type: 'triangle', f: 1100, f2: 1000, dur: 0.25, gain: 0.08 });
    },
    spitfire(o, t) {
      noise(o, t, { type: 'highpass', f: 2600, dur: 0.04, gain: 0.6 });
      noise(o, t, { type: 'bandpass', f: 1900, f2: 600, q: 0.9, dur: 0.1, gain: 0.6 });
      tone(o, t, { f: 240, f2: 90, dur: 0.07, gain: 0.6 });
    },
    cutter(o, t) {
      noise(o, t, { type: 'lowpass', f: 2000, f2: 140, dur: 0.45, gain: 1.2 });
      tone(o, t, { f: 120, f2: 34, dur: 0.3, gain: 1.1 });
      noise(o, t, { type: 'highpass', f: 1600, dur: 0.08, gain: 0.8 });
    },
    whisper(o, t) {
      noise(o, t, { type: 'bandpass', f: 1200, f2: 2600, q: 1.5, dur: 0.09, gain: 0.22 });
      tone(o, t, { type: 'triangle', f: 320, f2: 140, dur: 0.08, gain: 0.25 });
    },
  };
  const baseShot = G.shot;
  G.shot = (o, t, p) => (SHOTS[p.snd] || baseShot)(o, t, p);
  
  const VOL = { shot: 1, dry: 0.7, step: 0.5, shell: 0.5, whiz: 0.8 };
  const WET = { shot: 0.45, magDrop: 0.25, boltFwd: 0.15, boltBack: 0.12, magIn: 0.12, land: 0.1, step: 0.05, hit: 0, headshot: 0, kill: 0, click: 0, respawn: 0 };

  /**
   * Voice limiting (same synth; only skips excess under load):
   * 1) Cap concurrent one-shots (mobile-safe)
   * 2) Prefer dropping farthest / quietest world sounds
   * 3) Hard-ish rate limit on world shots always
   * 4) Local sounds (no x,z) always preferred
   */
  const MAX_VOICES = 6;
  const MAX_WORLD_SHOTS = 3;   // concurrent world (enemy) gunshots
  const SHOT_SOFT_MAX = 5;     // world shots per second
  const voices = [];
  let shotWindowT = 0;
  let shotWindowN = 0;

  function pruneVoices(now) {
    for (let i = voices.length - 1; i >= 0; i--) {
      if (voices[i].end <= now) voices.splice(i, 1);
    }
  }

  function estimateDur(name) {
    if (name === 'shot') return 0.55;
    if (name === 'death' || name === 'kill') return 0.7;
    if (name === 'land' || name === 'hurt') return 0.35;
    if (name === 'step' || name === 'shell' || name === 'click' || name === 'dry') return 0.2;
    return 0.4;
  }

  function priority(name, local, dist, vol) {
    if (local) return 1000 + (name === 'shot' ? 50 : 0);
    if (name === 'hurt' || name === 'death' || name === 'hit' || name === 'headshot' || name === 'kill') return 800;
    if (name === 'shot') return 200 - Math.min(dist, 80) + vol * 20;
    return 100 - Math.min(dist, 80);
  }

  function admit(name, local, dist, vol, now) {
    pruneVoices(now);
    const pri = priority(name, local, dist, vol);
    const isShot = name === 'shot';
    const isWorldShot = isShot && !local;

    // 3) world shots: always rate-limit (not only when full)
    if (isWorldShot) {
      if (now - shotWindowT > 1) {
        shotWindowT = now;
        shotWindowN = 0;
      }
      if (shotWindowN >= SHOT_SOFT_MAX) return false;
      let worldShots = 0;
      for (let i = 0; i < voices.length; i++) {
        if (voices[i].shot && !voices[i].local) worldShots++;
      }
      if (worldShots >= MAX_WORLD_SHOTS) {
        // only replace a quieter/farther world shot
        let worst = -1;
        for (let i = 0; i < voices.length; i++) {
          const v = voices[i];
          if (!v.shot || v.local) continue;
          if (worst < 0 || v.pri < voices[worst].pri) worst = i;
        }
        if (worst < 0 || pri <= voices[worst].pri) return false;
        voices[worst] = { t0: now, end: now + estimateDur(name), dist, pri, local, shot: true };
        shotWindowN++;
        return true;
      }
    }

    if (voices.length < MAX_VOICES) {
      if (isWorldShot) shotWindowN++;
      voices.push({ t0: now, end: now + estimateDur(name), dist, pri, local, shot: isShot });
      return true;
    }

    // 1+2) full: replace lowest priority (never blocked if local)
    let worst = 0;
    for (let i = 1; i < voices.length; i++) {
      if (voices[i].pri < voices[worst].pri) worst = i;
    }
    if (pri <= voices[worst].pri && !local) return false;
    voices[worst] = { t0: now, end: now + estimateDur(name), dist, pri, local, shot: isShot };
    if (isWorldShot) shotWindowN++;
    return true;
  }

  /**
   * play(name)                  -> local sound (no positioning)
   * play(name, x, z, {vol,...}) -> positioned in the world relative to the listener
   */
  function play(name, x, z, p = {}) {
    if (!ctx) return;
    // Mobile often parks the context mid-match (suspended / interrupted) without tabbing out
    if (ctx.state !== 'running') {
      if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
        try { ctx.resume(); } catch (_) {}
      }
      if (ctx.state !== 'running') return;
    }
    const gen = G[name];
    if (!gen) return;
    const local = typeof x !== 'number';
    let vol = (VOL[name] ?? 1) * (p.vol ?? 1), pan = 0, lp = 20000, dist = 0;
    if (!local) {
      const dx = x - L.x, dz = z - L.z;
      dist = Math.hypot(dx, dz);
      if (dist > 0.01) pan = (dx * Math.cos(L.yaw) + dz * -Math.sin(L.yaw)) / dist;
      vol *= 1 / (1 + dist * 0.07);
      lp = clamp(20000 / (1 + dist * 0.12), 1800, 20000);
    }
    const now = ctx.currentTime;
    if (!admit(name, local, dist, vol, now)) return;
    gen(bus(vol, pan * 0.9, WET[name] ?? 0.1, lp), now + 0.005, p);
  }

  function startAmbient() {
    if (ambientOn || !ctx) return;
    ambientOn = true;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 420;
    f.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.value = 0.06;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.12;
    const lg = ctx.createGain();
    lg.gain.value = 180;
    lfo.connect(lg);
    lg.connect(f.frequency);
    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.09;
    const lg2 = ctx.createGain();
    lg2.gain.value = 0.03;
    lfo2.connect(lg2);
    lg2.connect(g.gain);
    src.connect(f);
    f.connect(g);
    g.connect(master);
    src.start();
    lfo.start();
    lfo2.start();
  }

  return {
    // call from a user gesture (click / key)
    unlock() {
      if (!init()) return;
      if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
        try { ctx.resume(); } catch (_) {}
      }
      startAmbient();
    },
    recordStream() { return recDest ? recDest.stream : null; },
    getCtx: () => ctx,
    getMaster: () => master,
    setVolume(v) {
      if (master) master.gain.value = v;
    },
    setListener(x, z, yaw) {
      L.x = x; L.z = z; L.yaw = yaw;
    },
    play,
  };
}
