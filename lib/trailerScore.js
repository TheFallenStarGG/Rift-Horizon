/**
 * RIFT HORIZON trailer score: all synthesised with WebAudio, driven by the PLAN cut list so every hit lands on a cut.
 * Layers: sub drone + heartbeat, taiko, brass stabs, staccato strings, choir pad, snare rolls, risers, crashes, braams.
 * Radio lines are routed around the music (music ducks, effects never do) with a squelch click before and after each line.
 * play(name, vol) fires one-shot effects live (the director calls it): boom hit whoosh rumble crack thud impact sweep place zap tick squelch rocket flak
 */
export function buildScore(c, out, lines, M) {
  const { TM, HITS, PLAN } = M;
  const comp = c.createDynamicsCompressor();
  comp.threshold.value = -15; comp.knee.value = 14; comp.ratio.value = 5; comp.attack.value = 0.004; comp.release.value = 0.2; comp.connect(out);
  const bus = c.createGain(); bus.connect(comp);
  const mg = c.createGain(); mg.gain.value = 0.85; mg.connect(bus);   // music (ducks under the radio)
  const sg = c.createGain(); sg.gain.value = 0.95; sg.connect(bus);   // effects (never ducked)
  const conv = c.createConvolver();
  { const n = Math.floor(c.sampleRate * 2.6), ir = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2.6); }
    conv.buffer = ir; }
  const rv = c.createGain(); rv.gain.value = 0.5; rv.connect(conv); conv.connect(mg);
  // soft-clip bus for the brass / braam so they bite
  const shaper = c.createWaveShaper();
  { const n = 1024, cv = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; cv[i] = Math.tanh(x * 3.5); } shaper.curve = cv; }
  const dist = c.createGain(); dist.gain.value = 0.4; const dout = c.createGain(); dout.gain.value = 0.55; dist.connect(shaper); shaper.connect(dout); dout.connect(mg);
  const nb = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
  { const d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
  const t0 = c.currentTime + 0.45, at = (t) => t0 + t;
  let SF = 0; // 1 while a live effect is being built: routes to the effects bus
  const route = (node, wet, tgt) => { node.connect(tgt); if (wet > 0) { const w = c.createGain(); w.gain.value = wet; node.connect(w); w.connect(rv); } };
  function tone({ type = 'sawtooth', f, f2, t, a = 0.01, d = 0.3, g = 0.2, lp = 0, lp2 = 0, det = 0, wet = 0.2, ds = 0, vib = 0 }) {
    const osc = c.createOscillator(); osc.type = type; osc.detune.value = det;
    osc.frequency.setValueAtTime(f, at(t));
    if (f2) osc.frequency.exponentialRampToValueAtTime(f2, at(t) + a + d);
    const e = c.createGain();
    e.gain.setValueAtTime(0.0001, at(t)); e.gain.linearRampToValueAtTime(g, at(t) + a); e.gain.exponentialRampToValueAtTime(0.0001, at(t) + a + d);
    let n = osc;
    if (lp) { const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.setValueAtTime(lp, at(t)); if (lp2) fl.frequency.exponentialRampToValueAtTime(lp2, at(t) + a + d * 0.7); osc.connect(fl); n = fl; }
    if (vib) { const l = c.createOscillator(); l.frequency.value = 5.2; const lg = c.createGain(); lg.gain.value = vib; l.connect(lg); lg.connect(osc.frequency); l.start(at(t)); l.stop(at(t) + a + d + 0.1); }
    n.connect(e); route(e, wet, SF ? sg : ds ? dist : mg); osc.start(at(t)); osc.stop(at(t) + a + d + 0.1);
  }
  function noise({ t, d = 0.3, g = 0.3, type = 'lowpass', f = 800, f2 = 0, q = 0.7, wet = 0.2, a = 0.002 }) {
    const s = c.createBufferSource(); s.buffer = nb; s.loop = true;
    const fl = c.createBiquadFilter(); fl.type = type; fl.Q.value = q; fl.frequency.setValueAtTime(f, at(t));
    if (f2) fl.frequency.exponentialRampToValueAtTime(Math.max(20, f2), at(t) + a + d);
    const e = c.createGain();
    e.gain.setValueAtTime(0.0001, at(t)); e.gain.exponentialRampToValueAtTime(Math.max(g, 0.0002), at(t) + a); e.gain.exponentialRampToValueAtTime(0.0001, at(t) + a + d);
    s.connect(fl); fl.connect(e); route(e, wet, SF ? sg : mg); s.start(at(t), Math.random() * 1.5); s.stop(at(t) + a + d + 0.1);
  }
  // ---- drums + hits
  const boom = (t, p = 1) => {
    tone({ type: 'sine', f: 95, f2: 28, t, a: 0.004, d: 1.7, g: 0.95 * p, wet: 0.45 });
    noise({ t, d: 1.8, g: 0.8 * p, f: 1400, f2: 60, wet: 0.55 });
    tone({ type: 'triangle', f: 55, t, a: 0.01, d: 2.4, g: 0.45 * p, wet: 0.4 });
  };
  const kick = (t, g = 0.55) => tone({ type: 'sine', f: 150, f2: 44, t, a: 0.002, d: 0.22, g, wet: 0.05 });
  const snare = (t, g = 0.35) => { noise({ t, d: 0.2, g, type: 'bandpass', f: 1900, q: 0.8, wet: 0.35 }); tone({ type: 'triangle', f: 210, f2: 140, t, a: 0.002, d: 0.1, g: g * 0.6, wet: 0.2 }); };
  const hat = (t, g = 0.07) => noise({ t, d: 0.05, g, type: 'highpass', f: 7000, wet: 0.02 });
  const taiko = (t, g = 0.7) => { tone({ type: 'sine', f: 120, f2: 52, t, a: 0.003, d: 0.45, g, wet: 0.35 }); noise({ t, d: 0.18, g: g * 0.5, type: 'lowpass', f: 700, f2: 150, wet: 0.35 }); };
  const crash = (t, g = 0.22) => noise({ t, a: 0.004, d: 2.4, g, type: 'highpass', f: 5200, q: 0.5, wet: 0.5 });
  const rev = (t, dur, g = 0.2) => noise({ t, a: dur, d: 0.05, g, type: 'highpass', f: 2500, f2: 9000, q: 0.6, wet: 0.4 });
  const whoosh = (t) => noise({ t, a: 0.3, d: 0.3, g: 0.14, type: 'bandpass', f: 400, f2: 5000, q: 0.9, wet: 0.35 });
  const riser = (t, dur, g = 0.3) => {
    noise({ t, d: dur * 0.1, a: dur * 0.9, g, type: 'bandpass', f: 300, f2: 9000, q: 1.2, wet: 0.3 });
    tone({ type: 'sawtooth', f: 90, f2: 1400, t, a: dur * 0.9, d: dur * 0.1, g: g * 0.35, lp: 3000, wet: 0.3 });
  };
  const stab = (t, notes, d, g) => notes.forEach((f) => {
    for (const det of [-9, 0, 9]) tone({ type: 'sawtooth', f, t, a: 0.03, d, g, lp: 1500, det, wet: 0.5 });
    tone({ type: 'sawtooth', f: f * 2, t, a: 0.05, d, g: g * 0.5, lp: 2600, wet: 0.5 });
  });
  const brass = (t, notes, d, g) => notes.forEach((f) => { for (const det of [-10, 0, 10]) tone({ type: 'sawtooth', f, t, a: 0.045, d, g, lp: 700, lp2: 3200, det, wet: 0.4, ds: 1 }); });
  const pad = (t, notes, d, g) => notes.forEach((f) => {
    for (const det of [-7, 7]) tone({ type: 'triangle', f, t, a: d * 0.4, d: d * 0.7, g, lp: 1800, det, wet: 0.6, vib: 2.5 });
    tone({ type: 'sine', f: f * 2, t, a: d * 0.5, d: d * 0.6, g: g * 0.5, wet: 0.6 });
  });
  const braam = (t, root, g = 0.5) => {
    for (const [m, det] of [[1, -12], [1, 0], [1, 12], [1.5, 0], [2, 6], [0.5, 0]]) tone({ type: 'sawtooth', f: root * m, f2: root * m * 0.96, t, a: 0.05, d: 3.6, g: g * 0.22, lp: 900, lp2: 260, det, wet: 0.5, ds: 1 });
    tone({ type: 'sine', f: root * 0.5, f2: root * 0.4, t, a: 0.02, d: 3.8, g: g * 0.9, wet: 0.3 });
    noise({ t, d: 2.4, g: g * 0.55, f: 2200, f2: 90, wet: 0.5 });
  };
  const beat = (t, p = 0.8) => { tone({ type: 'sine', f: 58, f2: 40, t, d: 0.18, g: p, wet: 0.1 }); tone({ type: 'sine', f: 58, f2: 40, t: t + 0.18, d: 0.18, g: p * 0.7, wet: 0.1 }); };
  const tick = (t) => { noise({ t, d: 0.03, g: 0.25, type: 'highpass', f: 5000, wet: 0.1 }); tone({ type: 'sine', f: 1300, t, a: 0.001, d: 0.04, g: 0.08, wet: 0.1 }); };
  const squelch = (t) => { noise({ t, d: 0.07, g: 0.22, type: 'bandpass', f: 1800, q: 1, wet: 0.05 }); tone({ type: 'sine', f: 1000, t, a: 0.001, d: 0.04, g: 0.08, wet: 0.05 }); };
  // ---- beds (engines, wind, rotor)
  const engine = (t, d, g, f = 62, am = 14) => {
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f, at(t)); o.frequency.linearRampToValueAtTime(f * 1.5, at(t + d));
    const fl = c.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 420;
    const e = c.createGain(); e.gain.setValueAtTime(0.0001, at(t)); e.gain.linearRampToValueAtTime(g, at(t + 0.5)); e.gain.setValueAtTime(g, at(t + d - 0.5)); e.gain.linearRampToValueAtTime(0.0001, at(t + d));
    const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = am; lg.gain.value = g * 0.5; l.connect(lg); lg.connect(e.gain);
    o.connect(fl); fl.connect(e); route(e, 0.15, sg); o.start(at(t)); o.stop(at(t + d + 0.1)); l.start(at(t)); l.stop(at(t + d + 0.1));
  };
  const rotor = (t, d, g, rate = 11) => {
    const s = c.createBufferSource(); s.buffer = nb; s.loop = true;
    const fl = c.createBiquadFilter(); fl.type = 'bandpass'; fl.frequency.value = 220; fl.Q.value = 0.8;
    const e = c.createGain(); e.gain.setValueAtTime(0.0001, at(t)); e.gain.linearRampToValueAtTime(g, at(t + 0.6)); e.gain.setValueAtTime(g, at(t + d - 0.6)); e.gain.linearRampToValueAtTime(0.0001, at(t + d));
    const l = c.createOscillator(), lg = c.createGain(); l.frequency.value = rate; lg.gain.value = g * 0.9; l.connect(lg); lg.connect(e.gain);
    s.connect(fl); fl.connect(e); route(e, 0.2, sg); s.start(at(t)); s.stop(at(t + d + 0.1)); l.start(at(t)); l.stop(at(t + d + 0.1));
  };
  const wind = (t, d, g) => noise({ t, a: d * 0.8, d: d * 0.2, g, type: 'bandpass', f: 500, f2: 1800, q: 0.6, wet: 0.2 });

  const CH = { Dm: [146.8, 174.6, 220], Bb: [116.5, 146.8, 174.6], Gm: [98, 116.5, 146.8], A: [110, 138.6, 164.8] };
  const NAMES = ['Dm', 'Bb', 'Gm', 'A'], ROOT = [73.4, 58.3, 49, 55], PAT = [0, 0, 7, 0, 3, 0, 7, 12];
  const rootIdx = (t) => { let k = 0; for (let i = 0; i < HITS.length; i++) if (t >= HITS[i]) k = i; return k % 4; };
  // events are scheduled lazily (about 1.5 s ahead) so a phone never has to build thousands of nodes at once
  const E = [], ev = (t, fn) => E.push({ t, fn });
  const si = TM.silence.t0, ch = TM.charge, ti = TM.title.t0, pl = TM.plane.t0, ff = TM.freefall.t0, ct = TM.contact.t0, gn = TM.guns.t0, pr = TM.prim.t0;

  // cold open: sub drone, heartbeat, riser into the first cut
  ev(0, () => { tone({ f: 36.7, t: 0, a: 5, d: 1.4, g: 0.3, lp: 140, wet: 0.3 }); tone({ f: 55, t: 0, a: 5, d: 1.4, g: 0.18, lp: 200, wet: 0.3 }); riser(1.8, 4.2, 0.34); });
  for (let t = 1.0; t < pl - 0.6; t += 1) ev(t, () => beat(t, 0.5));
  // every cut: boom + taiko + crash + brass, with a riser and reverse cymbal leading in
  HITS.forEach((h, i) => {
    if (h > 8 && h < si) { ev(h - 2.2, () => riser(h - 2.2, 2.2, 0.24)); ev(h - 1.1, () => rev(h - 1.1, 1.0, 0.16)); }
    ev(h, () => {
      boom(h, h === ch.t0 || h === ti ? 1.4 : 1); taiko(h, 0.8); crash(h, 0.16);
      if (h === ch.t0 || h === ti) braam(h, 36.7, h === ti ? 1 : 0.8);
      if (h === ti) { tone({ f: 36.7, t: h, a: 0.5, d: 7, g: 0.35, lp: 160, wet: 0.4 }); }
      else { stab(h, CH[NAMES[i % 4]], 2.6, 0.05); brass(h, CH[NAMES[i % 4]].map((f) => f * 2), 1.4, 0.05); }
    });
  });
  PLAN.forEach(([n], i) => { if (i > 0 && n !== 'silence' && n !== 'title') { const w = TM[n].t0 - 0.25; ev(w, () => whoosh(w)); } });
  // driving ostinato (8ths, then 16ths from the ability reels on) + staccato strings from the weapons montage
  { let k = 0;
    for (let t = pl; t < si - 0.3; k++) {
      const tt = t, kk = k, r = ROOT[rootIdx(tt)], k01 = (tt - pl) / (si - pl), slow = tt < pr;
      ev(tt, () => tone({ f: r * Math.pow(2, PAT[kk % 8] / 12), t: tt, a: 0.005, d: slow ? 0.22 : 0.1, g: 0.05 + 0.1 * k01, lp: 350 + 2200 * k01, wet: 0.12 }));
      if (tt >= gn && kk % 2 === 0) ev(tt, () => tone({ f: r * 4 * Math.pow(2, PAT[kk % 8] / 12), t: tt, a: 0.004, d: 0.08, g: 0.03, lp: 2400, wet: 0.2 }));
      t += slow ? 0.25 : 0.125;
    } }
  // drums
  for (let t = ff; t < si - 0.3; t += 0.5) ev(t, () => kick(t));
  for (let t = ct + 0.5; t < si - 0.3; t += 1) ev(t, () => snare(t));
  for (let t = gn; t < si - 0.3; t += 0.25) ev(t, () => hat(t));
  for (let t = pl; t < si - 0.3; t += 1) ev(t, () => taiko(t, t < pr ? 0.45 : 0.6));
  HITS.forEach((h) => { if (h > gn && h < si) for (let j = 0; j < 8; j++) { const t = h - 1 + j * 0.125, gg = 0.12 + j * 0.035; ev(t, () => snare(t, gg)); } });
  // choir pad + brass motif, one phrase per bar from the ability reels on
  for (let t = gn; t < si - 0.3; t += 4) { const tt = t, nn = CH[NAMES[rootIdx(tt)]].map((f) => f * 2); ev(tt, () => pad(tt, nn, 4, 0.032)); }
  { let bi = 0;
    for (let t = pr; t < si - 1; t += 2, bi++) {
      const tt = t, nn = CH[NAMES[bi % 4]].map((f) => f * 2);
      ev(tt, () => brass(tt, nn, 1.1, 0.045)); ev(tt + 1, () => brass(tt + 1, nn, 0.4, 0.04)); ev(tt + 1.5, () => brass(tt + 1.5, nn.map((f) => f * 1.5), 0.3, 0.035));
    } }
  // set-piece beds
  ev(ff, () => wind(ff, 2.3, 0.3));
  ev(pl, () => engine(pl, 6, 0.16));
  ev(TM.chase.t0, () => engine(TM.chase.t0, 6, 0.14, 70, 18));
  ev(TM.flyby.t0 + 0.6, () => tone({ type: 'sawtooth', f: 260, f2: 120, t: TM.flyby.t0 + 0.6, a: 0.8, d: 2.2, g: 0.12, lp: 1400, wet: 0.2 }));
  ev(TM.heli.t0, () => rotor(TM.heli.t0, 4, 0.3, 10));
  // the silence: sub drone, heartbeats, a ticking clock that speeds up, riser into the finale
  ev(si, () => tone({ f: 36.7, t: si, a: 1.5, d: 3.4, g: 0.25, lp: 120, wet: 0.3 }));
  [0.8, 1.85, 2.9].forEach((o) => ev(si + o, () => beat(si + o, 0.9)));
  for (let t = si + 0.3; t < si + 2.5; t += 0.5) ev(t, () => tick(t));
  for (let t = si + 2.5; t < si + 3.5; t += 0.25) ev(t, () => tick(t));
  for (let t = si + 3.5; t < ch.t0 - 0.05; t += 0.125) ev(t, () => tick(t));
  ev(si + 1.4, () => riser(si + 1.4, 2.6, 0.36));
  // finale: double-time ostinato + strings, kick/snare/taiko, brass fanfare, rising pad, snare roll, riser
  { let k = 0;
    for (let t = ch.t0; t < ch.t1 - 0.3; t += 0.125, k++) {
      const tt = t, kk = k;
      ev(tt, () => tone({ f: 73.4 * Math.pow(2, PAT[kk % 8] / 12), t: tt, a: 0.004, d: 0.1, g: 0.17, lp: 3000, wet: 0.12 }));
      if (kk % 2 === 0) ev(tt, () => tone({ f: 73.4 * 4 * Math.pow(2, PAT[kk % 8] / 12), t: tt, a: 0.004, d: 0.08, g: 0.035, lp: 2600, wet: 0.2 }));
    } }
  for (let t = ch.t0; t < ch.t1 - 0.3; t += 0.5) ev(t, () => { kick(t, 0.65); taiko(t, 0.35); });
  for (let t = ch.t0 + 0.5; t < ch.t1 - 0.3; t += 1) ev(t, () => snare(t, 0.4));
  for (let t = ch.t0; t < ch.t1 - 0.3; t += 0.25) ev(t, () => hat(t, 0.08));
  { let bi = 0;
    for (let t = ch.t0; t < ch.t1 - 1; t += 2, bi++) {
      const tt = t, nn = CH[NAMES[bi % 4]].map((f) => f * 2);
      ev(tt, () => { brass(tt, nn, 1.2, 0.055); crash(tt, 0.14); }); ev(tt + 1, () => brass(tt + 1, nn.map((f) => f * 1.5), 0.5, 0.045));
    } }
  ev(ch.t0, () => pad(ch.t0, [293.7, 349.2, 440, 587.3], 6, 0.04)); ev(ch.t0 + 6, () => pad(ch.t0 + 6, [349.2, 440, 523.3, 698.5], 6, 0.045));
  for (let t = ch.t1 - 2.0; t < ch.t1 - 0.05; t += 0.125) ev(t, () => snare(t, 0.2 + 0.25 * ((t - (ch.t1 - 2)) / 2)));
  ev(ch.t1 - 2.8, () => riser(ch.t1 - 2.8, 2.6, 0.4));
  // title: RIFT / HORIZON hits, then a quiet pad and a last heartbeat
  ev(ti + 0.95, () => { boom(ti + 0.95, 1.1); stab(ti + 0.95, [293.7, 349.2, 440], 4, 0.045); crash(ti + 0.95, 0.2); });
  ev(ti + 1.5, () => { boom(ti + 1.5, 1.3); brass(ti + 1.5, [293.7, 349.2, 440, 587.3], 2.6, 0.06); crash(ti + 1.5, 0.28); tone({ type: 'sine', f: 70, f2: 24, t: ti + 1.5, a: 0.01, d: 3, g: 0.8, wet: 0.3 }); });
  ev(ti + 2.6, () => pad(ti + 2.6, [293.7, 349.2, 440, 587.3], 5, 0.04));
  ev(ti + 5.6, () => beat(ti + 5.6, 0.9));

  // radio lines (+ music ducking and a squelch click on each side)
  const voSrc = [];
  for (const l of [...lines].sort((a, b) => a.at - b.at)) {
    if (!l.buf) continue;
    const s = c.createBufferSource(); s.buffer = l.buf;
    const g = c.createGain(); g.gain.value = l.gain != null ? l.gain : 1.1;
    const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 480;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3400;
    s.connect(hp); hp.connect(lp); lp.connect(g); g.connect(bus); s.start(at(l.at)); voSrc.push(s);
    mg.gain.setTargetAtTime(0.42, at(l.at) - 0.12, 0.06);
    mg.gain.setTargetAtTime(0.85, at(l.at) + l.buf.duration + 0.1, 0.3);
    const a0 = l.at - 0.1, a1 = l.at + l.buf.duration;
    ev(a0, () => { SF = 1; squelch(a0); SF = 0; }); ev(a1, () => { SF = 1; squelch(a1); SF = 0; });
  }
  E.sort((a, b) => a.t - b.t);
  let ei = 0;

  // live one-shot effects
  const FXS = {
    boom: (t, v) => boom(t, 0.85 * v),
    hit: (t, v) => { tone({ type: 'sine', f: 190, f2: 55, t, a: 0.002, d: 0.14, g: 0.6 * v, wet: 0.1 }); noise({ t, d: 0.1, g: 0.35 * v, type: 'bandpass', f: 1400, q: 0.8, wet: 0.2 }); },
    whoosh: (t, v) => noise({ t, a: 0.22, d: 0.25, g: 0.3 * v, type: 'bandpass', f: 400, f2: 5200, q: 0.9, wet: 0.35 }),
    rumble: (t, v) => { noise({ t, a: 0.6, d: 2.6, g: 0.55 * v, f: 160, f2: 50, wet: 0.5 }); tone({ type: 'sine', f: 42, f2: 30, t, a: 0.5, d: 2.5, g: 0.5 * v, wet: 0.3 }); },
    crack: (t, v) => { noise({ t, d: 0.7, g: 0.7 * v, type: 'highpass', f: 2800, f2: 800, wet: 0.5 }); tone({ type: 'sawtooth', f: 2600, f2: 120, t, a: 0.002, d: 0.45, g: 0.25 * v, lp: 5000, wet: 0.3 }); boom(t + 0.02, 0.5 * v); },
    thud: (t, v) => { tone({ type: 'sine', f: 80, f2: 40, t, a: 0.002, d: 0.3, g: 0.8 * v, wet: 0.2 }); noise({ t, d: 0.2, g: 0.3 * v, f: 300, f2: 90, wet: 0.2 }); },
    impact: (t, v) => { boom(t, 0.5 * v); tone({ type: 'square', f: 880, f2: 600, t, a: 0.002, d: 0.18, g: 0.1 * v, wet: 0.2 }); },
    sweep: (t, v) => tone({ type: 'sawtooth', f: 1400, f2: 55, t, a: 0.02, d: 1.1, g: 0.14 * v, lp: 2400, lp2: 200, wet: 0.5 }),
    place: (t, v) => { tone({ type: 'triangle', f: 600, f2: 1200, t, a: 0.002, d: 0.08, g: 0.15 * v, wet: 0.2 }); noise({ t, d: 0.05, g: 0.1 * v, type: 'highpass', f: 4000, wet: 0.1 }); },
    zap: (t, v) => { tone({ type: 'sawtooth', f: 2400, f2: 200, t, a: 0.002, d: 0.3, g: 0.12 * v, lp: 4000, wet: 0.3 }); noise({ t, d: 0.2, g: 0.12 * v, type: 'highpass', f: 3000, wet: 0.2 }); },
    tick: (t) => tick(t),
    squelch: (t) => squelch(t),
    rocket: (t, v) => { noise({ t, a: 0.1, d: 0.7, g: 0.25 * v, type: 'bandpass', f: 600, f2: 2200, q: 0.8, wet: 0.3 }); tone({ type: 'sawtooth', f: 80, f2: 160, t, a: 0.05, d: 0.7, g: 0.1 * v, lp: 800, wet: 0.2 }); },
    flak: (t, v) => { noise({ t, d: 0.25, g: 0.4 * v, f: 900, f2: 200, wet: 0.3 }); tone({ type: 'sine', f: 120, f2: 60, t, a: 0.002, d: 0.2, g: 0.4 * v, wet: 0.2 }); },
  };
  return {
    ctx: c, t0,
    update() { const lim = c.currentTime - t0 + 1.6; while (ei < E.length && E[ei].t <= lim) { try { E[ei].fn(); } catch (_) {} ei++; } },
    play(name, v = 1) { const f = FXS[name]; if (!f) return; SF = 1; try { f(c.currentTime - t0 + 0.02, v); } catch (_) {} SF = 0; },
    stop() {
      try { bus.gain.setTargetAtTime(0, c.currentTime, 0.2); } catch (_) {}
      voSrc.forEach((s) => { try { s.stop(); } catch (_) {} });
      setTimeout(() => { try { bus.disconnect(); } catch (_) {} }, 900);
    },
  };
}
