#!/usr/bin/env node
/**
 * Renders the RIFT HORIZON trailer frame by frame in headless Chrome (software WebGL) and encodes this job's share.
 * Env: RT_WIDTH RT_HEIGHT RT_FPS RT_SHARD RT_SHARDS RT_AUDIO_SECS RT_CHUNK_SECS RT_CRF RT_OUT
 *      RT_WARM (frames every job fully renders at the start, default 2) RT_MAX_SECS (0 = whole trailer, else stop after N s)
 *      RT_REQUIRE_POST ('false' to allow a flat render when post effects fail) RT_DEBUG ('true' = log CSS animation state)
 * Output (in RT_OUT): seg_00000.mp4 ... (this shard's 2-second pieces), meta-<shard>.json, and audio.pcm (shard 0 only).
 * The segments are encoded at final quality: the merge job only joins them (stream copy), it does not re-encode.
 */
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..', '..');
const num = (k, d) => { const v = Number(process.env[k]); return Number.isFinite(v) && v > 0 ? v : d; };
const even = (n) => Math.max(2, Math.round(n / 2) * 2);
const W = even(num('RT_WIDTH', 1920)), H = even(num('RT_HEIGHT', 1080)), FPS = Math.round(num('RT_FPS', 30));
const SHARDS = Math.max(1, Math.round(num('RT_SHARDS', 1))), SHARD = Math.max(0, Math.round(Number(process.env.RT_SHARD) || 0));
const CHUNK = Math.max(1, Math.round(FPS * num('RT_CHUNK_SECS', 2)));
const AUDIO_SECS = num('RT_AUDIO_SECS', 130), CRF = String(num('RT_CRF', 15)), SR = 48000;
const WARM = Math.max(0, Math.round(Number(process.env.RT_WARM ?? 2) || 0));
const MAX_FRAMES = num('RT_MAX_SECS', 0) > 0 ? Math.round(num('RT_MAX_SECS', 0) * FPS) : Infinity;
const REQUIRE_POST = process.env.RT_REQUIRE_POST !== 'false';
const DEBUG = process.env.RT_DEBUG === 'true' || process.env.RT_DEBUG === '1';
const OUT = path.resolve(process.env.RT_OUT || path.join(ROOT, 'render-out'));
const log = (...a) => console.log(`[shard ${SHARD}/${SHARDS}]`, ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hr = () => Number(process.hrtime.bigint() / 1000000n);
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timed out (${Math.round(ms / 1000)}s): ${what}`)), ms))]);

// ---------- tiny static server for the repo ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.wav': 'audio/wav', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream', '.wasm': 'application/wasm', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2',
};
function serve() {
  const srv = http.createServer((req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
      fs.stat(f, (e, st) => {
        if (e || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-store' });
        fs.createReadStream(f).pipe(res);
      });
    } catch (_) { res.writeHead(400); res.end(); }
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

// ---------- ffmpeg segment writer (final quality: the merge job does not re-encode) ----------
function openSeg(c) {
  const file = path.join(OUT, `seg_${String(c).padStart(5, '0')}.mp4`);
  const p = spawn('ffmpeg', [
    '-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'png', '-i', 'pipe:0',
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv:flags=accurate_rnd+full_chroma_int,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', CRF, '-bf', '0', '-g', String(CHUNK), '-r', String(FPS),
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv', file,
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const seg = { p, file };
  seg.done = new Promise((res, rej) => {
    p.on('error', rej);
    p.on('exit', (code) => (code === 0 ? res() : rej(new Error('ffmpeg exited with code ' + code))));
  });
  seg.done.catch(() => {});
  p.stdin.on('error', () => {});
  return seg;
}
async function writeFrame(seg, buf) {
  if (!seg.p.stdin.write(buf)) await Promise.race([once(seg.p.stdin, 'drain'), seg.done]);
}
async function closeSeg(seg) { seg.p.stdin.end(); await seg.done; }

// ---------- main ----------
async function main() {
  const tStart = hr();
  fs.mkdirSync(OUT, { recursive: true });
  const srv = await serve();
  const BASE = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
      '--disable-dev-shm-usage', '--mute-audio', '--autoplay-policy=no-user-gesture-required',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
      '--js-flags=--max-old-space-size=6144',
    ],
  });
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await context.route('**/*', (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort())); // nothing leaves this machine
  await context.addInitScript(`window.__RT_CFG = ${JSON.stringify({ fps: FPS, audioSecs: AUDIO_SECS, sampleRate: SR })};`);
  await context.addInitScript({ path: path.join(here, 'inject.js') });
  const page = await context.newPage();
  page.setDefaultTimeout(0);

  let postFailed = false;
  page.on('console', (m) => {
    const t = m.text();
    if (/post-processing disabled/i.test(t)) postFailed = true;
    if (/Failed to load resource/i.test(t)) return;
    if (m.type() === 'error' || /trailer|\[rt\]|post-processing/i.test(t)) log('page:', m.type(), t.slice(0, 400));
  });
  page.on('pageerror', (e) => log('PAGE ERROR:', String(e).slice(0, 600)));
  page.on('crash', () => { log('PAGE CRASHED'); process.exit(3); });

  let pcm = null;
  if (SHARD === 0) {
    pcm = fs.createWriteStream(path.join(OUT, 'audio.pcm'));
    await page.exposeFunction('__rtSave', (b64) => { pcm.write(Buffer.from(b64, 'base64')); });
  } else await page.exposeFunction('__rtSave', () => {});

  const cdp = await context.newCDPSession(page);
  const grab = async () => Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true, optimizeForSpeed: true })).data, 'base64');
  const step = (skip, k) => withTimeout(page.evaluate(([s, kk]) => window.__rt.step(s, kk), [skip, k]), 15 * 60e3, `frame ${k}`);

  // 1) boot the game (hand-cranking its animation frames until the Start button is enabled)
  log(`booting the game (${W}x${H} @ ${FPS}fps)...`);
  await page.goto(`${BASE}/index.html?trailer`, { waitUntil: 'commit' });
  const tBoot = hr();
  for (;;) {
    await step(true, -1);
    const ok = await page.evaluate(() => { const b = document.getElementById('btnStart'); return !!b && !b.disabled; });
    if (ok) break;
    if (hr() - tBoot > 15 * 60e3) throw new Error('the game never finished loading (the Start button stayed disabled)');
    await sleep(20);
  }
  const bootMs = hr() - tBoot;
  log('WebGL:', await page.evaluate(() => {
    try { const g = document.createElement('canvas').getContext('webgl2'); const e = g.getExtension('WEBGL_debug_renderer_info'); return String(g.getParameter(e ? e.UNMASKED_RENDERER_WEBGL : g.RENDERER)); } catch (e) { return 'no webgl2: ' + e; }
  }));

  // 2) press Start (?trailer launches the trailer) and wait until it has built everything
  await page.evaluate(() => document.getElementById('btnStart').click());
  log('trailer is loading...');
  const tReady = hr();
  while (!(await page.evaluate(() => window.__rt.isReady()))) {
    if (hr() - tReady > 10 * 60e3) throw new Error('the trailer never became ready (see the page errors above)');
    await sleep(100);
  }
  const loadMs = hr() - tReady;
  await page.evaluate(() => window.__rt.begin());

  // 3) frame loop: every job simulates every frame, but only draws + captures its own 2-second chunks.
  //    The first WARM frames are drawn by every job (nothing captured) so one-off GPU work happens everywhere.
  log(`boot ${(bootMs / 1000).toFixed(0)} s, trailer load ${(loadMs / 1000).toFixed(0)} s. Rendering (chunks of ${CHUNK} frames, round-robin over ${SHARDS} jobs, ${WARM} warm-up frames)`);
  const tRun = hr();
  const tm = { drawMs: 0, drawN: 0, simMs: 0, simN: 0, grabMs: 0, writeMs: 0, closeMs: 0 };
  const avg = (ms, n) => (n ? Math.round(ms / n) : 0);
  let k = 0, mine = 0, seg = null, segIdx = -1;
  for (;;) {
    if (k >= MAX_FRAMES) { log(`RT_MAX_SECS reached at frame ${k}`); break; }
    const own = Math.floor(k / CHUNK) % SHARDS === SHARD;
    const draw = own || k < WARM;
    const t1 = hr();
    const playing = await step(!draw, k);
    const dt1 = hr() - t1;
    if (draw) { tm.drawMs += dt1; tm.drawN++; } else { tm.simMs += dt1; tm.simN++; }
    if (postFailed && REQUIRE_POST) {
      throw new Error('The game switched its post effects (bloom / AO / god rays / grade) off because this software renderer could not run them, so the video would look flat. Stopping now instead of rendering for an hour. Look for "post-processing disabled" above, or set require_post to false to render anyway.');
    }
    if (k === 0) await page.evaluate(() => window.__rt.startAudio());
    if (!playing) break; // the trailer ended during this step: this frame belongs to the game again
    if (k === 3) { const chip = await page.evaluate(() => window.__rt.chip()); if (chip) log('TRAILER WARNING CHIP:', chip); }
    if (own) {
      const c = Math.floor(k / CHUNK);
      if (c !== segIdx) { if (seg) { const t = hr(); await closeSeg(seg); tm.closeMs += hr() - t; } seg = openSeg(c); segIdx = c; }
      const t2 = hr(); const buf = await grab(); tm.grabMs += hr() - t2;
      const t3 = hr(); await writeFrame(seg, buf); tm.writeMs += hr() - t3;
      mine++;
      if (mine % 20 === 0) {
        log(`frame ${k} (${mine} captured, ${((hr() - tRun) / 60000).toFixed(1)} min) | per drawn frame: step ${avg(tm.drawMs, tm.drawN)} ms, grab ${avg(tm.grabMs, mine)} ms, write ${avg(tm.writeMs, mine)} ms | per sim-only frame: ${avg(tm.simMs, tm.simN)} ms`);
        if (DEBUG) log('[anims]', await page.evaluate(() => window.__rt.anims()));
      }
    }
    k++;
  }
  if (seg) { const t = hr(); await closeSeg(seg); tm.closeMs += hr() - t; }
  log(`trailer is ${k} frames (${(k / FPS).toFixed(2)} s), this job captured ${mine}`);
  log(`TIMING boot ${(bootMs / 1000).toFixed(0)} s | load ${(loadMs / 1000).toFixed(0)} s | drawn frames ${(tm.drawMs / 1000).toFixed(0)} s (${tm.drawN}) | sim-only frames ${(tm.simMs / 1000).toFixed(0)} s (${tm.simN}) | screenshots ${(tm.grabMs / 1000).toFixed(0)} s | ffmpeg feed ${(tm.writeMs / 1000).toFixed(0)} s | segment close ${(tm.closeMs / 1000).toFixed(0)} s | total ${((hr() - tStart) / 60000).toFixed(1)} min`);
  fs.writeFileSync(path.join(OUT, `meta-${SHARD}.json`), JSON.stringify({ frames: k, fps: FPS, chunk: CHUNK, width: W, height: H }));

  // 4) shard 0 also delivers the audio
  if (SHARD === 0) {
    const n = Math.round((k / FPS) * SR);
    log('rendering audio...');
    const len = await withTimeout(page.evaluate(async (nn) => { const l = await window.__rt.finishAudio(); await window.__rt.exportAudio(nn); return l; }, n), 30 * 60e3, 'audio render');
    if (len < n) log('WARNING: audio buffer is shorter than the video, raise audio_secs');
    await new Promise((r) => pcm.end(r));
  }
  if (postFailed) console.log('::warning::The game switched its post effects (bloom / AO / god rays / grade) off because this software renderer could not run them. The video will look flatter than on your phone.');

  // Tear down hard: Playwright / the static server often leave handles open and Node never exits,
  // so the GitHub Actions step sits on "done" forever and merge never starts.
  try { await context.close(); } catch (_) {}
  try { await browser.close(); } catch (_) {}
  await new Promise((resolve) => {
    try { srv.close(() => resolve()); } catch (_) { resolve(); }
    setTimeout(resolve, 3000);
  });
  log('done');
  process.exit(0);
}

main().catch((e) => { console.error('RENDER FAILED:', e); process.exit(1); });
