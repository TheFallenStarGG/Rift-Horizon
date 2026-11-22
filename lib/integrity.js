const BASE = new URL('../', import.meta.url);
let cache = null, bad = null, inflight = null;

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
async function hashFile(path) {
  try {
    const res = await fetch(new URL(path, BASE), { cache: 'force-cache' }); // the copy the browser cached = the copy that ran
    if (!res.ok) return 'missing';
    return hex(await crypto.subtle.digest('SHA-256', await res.arrayBuffer()));
  } catch (_) { return 'missing'; }
}

async function run(workerUrl, did) {
  const api = workerUrl.replace(/\/$/, '');
  let st;
  try { st = await (await fetch(api + '/api/ac/status', { cache: 'no-store' })).json(); } catch (_) { return { ok: true, token: '' }; }
  if (!st || st.mode === 'off' || !Array.isArray(st.files) || !st.files.length) return { ok: true, token: '' };
  const hashes = {}, queue = [...st.files];
  await Promise.all(Array.from({ length: 8 }, async () => { for (let p; (p = queue.pop());) hashes[p] = await hashFile(p); }));
  let j;
  try {
    const r = await fetch(api + '/api/ac/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ did, hashes }) });
    j = await r.json();
  } catch (_) { return { ok: true, token: '' }; }
  if (j && j.ok && j.token) { cache = { exp: j.exp, res: { ok: true, token: j.token } }; return cache.res; }
  if (j && j.error === 'modified') {
    const res = { ok: false, denied: true, error: 'modified', bad: j.bad || [] };
    bad = { at: Date.now(), res };
    return res;
  }
  return { ok: true, token: '' }; // server not configured / rate limited: the worker decides at join time
}

/** -> { ok:true, token } | { ok:false, denied:true, error, bad[] } */
export function getPass(workerUrl, did) {
  const now = Date.now();
  if (cache && cache.exp - now > 5 * 60 * 1000) return Promise.resolve(cache.res);
  if (bad && now - bad.at < 15000) return Promise.resolve(bad.res);
  if (!inflight) inflight = run(workerUrl, did).finally(() => { inflight = null; });
  return inflight;
}
