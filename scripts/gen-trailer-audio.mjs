import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';

const KEY = process.env.ELEVENLABS_API_KEY;
if (!KEY) { console.error('Missing ELEVENLABS_API_KEY secret'); process.exit(1); }

const script = JSON.parse(await readFile('assets/trailer/script.json', 'utf8'));
const outDir = 'assets/trailer/vo';
await mkdir(outDir, { recursive: true });
let manifest = {};
try { manifest = JSON.parse(await readFile(`${outDir}/manifest.json`, 'utf8')); } catch (_) {}

for (const l of script.lines) {
  const voice = script.voices[l.voice];
  const vs = {
    stability: l.stability ?? 0.5, similarity_boost: l.similarity ?? 0.8,
    style: l.style ?? 0.4, use_speaker_boost: true, speed: l.speed ?? 1,
  };
  const hash = createHash('sha1').update(JSON.stringify([l.text, voice, vs, script.model])).digest('hex');
  const file = `${outDir}/${l.id}.mp3`;
  if (manifest[l.id] === hash && existsSync(file)) { console.log('unchanged', l.id); continue; }
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voice}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({ text: l.text, model_id: script.model, voice_settings: vs }),
  });
  if (!res.ok) { console.error('FAILED', l.id, res.status, await res.text()); process.exitCode = 1; continue; }
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
  manifest[l.id] = hash;
  console.log('generated', l.id);
}
await writeFile(`${outDir}/manifest.json`, JSON.stringify(manifest, null, 2));
