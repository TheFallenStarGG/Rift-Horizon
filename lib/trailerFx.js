/**
 * Trailer-only effects: particle pools (fire / smoke / sparks), debris chunks, shockwave domes and the sky rift.
 */
import * as THREE from 'three';
import { heightAt } from './ground.js';

const PI = Math.PI;
const rnd = (a, b) => a + Math.random() * (b - a);

export function makeFx(scene, tex) {
  const pool = (n, blend) => Array.from({ length: n }, () => {
    const m = new THREE.SpriteMaterial({ map: tex.glow, transparent: true, depthWrite: false, blending: blend, opacity: 0 });
    const s = new THREE.Sprite(m); s.visible = false; scene.add(s);
    return { s, m, life: 0, max: 1, v: new THREE.Vector3(), s0: 1, s1: 2, o: 1, g: 0, drag: 1 };
  });
  const fire = pool(140, THREE.AdditiveBlending), smoke = pool(120, THREE.NormalBlending), spark = pool(260, THREE.AdditiveBlending);
  let fi = 0, si = 0, pi = 0, di = 0, shi = 0, flash = 0, ringT = 0, ringS = 1;
  const light = new THREE.PointLight(0xffa050, 0, 110, 2); scene.add(light);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 56), new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.visible = false; scene.add(ring);
  // debris chunks (boxes that tumble, bounce and vanish)
  const DM = new THREE.MeshStandardMaterial({ color: 0x3a3733, roughness: 0.95 }), DG = new THREE.BoxGeometry(1, 1, 1);
  const deb = Array.from({ length: 44 }, () => { const m = new THREE.Mesh(DG, DM); m.visible = false; scene.add(m); return { m, life: 0, v: new THREE.Vector3(), r: new THREE.Vector3() }; });
  // expanding shock domes
  const shocks = Array.from({ length: 3 }, () => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 14, 0, PI * 2, 0, PI / 2), new THREE.MeshBasicMaterial({ color: 0xffe2b0, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    m.visible = false; scene.add(m); return { m, t: 0, dur: 0.6, r: 10, on: false };
  });
  const emit = (arr, i, x, y, z, vx, vy, vz, s0, s1, life, o, color, g, drag) => {
    const p = arr[i % arr.length];
    p.s.visible = true; p.s.position.set(x, y, z); p.v.set(vx, vy, vz);
    p.s0 = s0; p.s1 = s1; p.max = p.life = life; p.o = o; p.g = g; p.drag = drag; p.m.color.setHex(color);
  };
  return {
    blast(x, y, z, sc = 1) {
      flash = 1; light.position.set(x, y + 2, z);
      for (let i = 0; i < 30; i++) emit(fire, fi++, x + rnd(-1, 1) * sc, y + rnd(0.2, 1.6) * sc, z + rnd(-1, 1) * sc, rnd(-7, 7) * sc, rnd(1, 11) * sc, rnd(-7, 7) * sc, 1.8 * sc, 6.5 * sc, rnd(0.5, 1.3), 0.95, i % 3 ? 0xff7a1a : 0xffd070, -1.5, 1.6);
      for (let i = 0; i < 34; i++) emit(smoke, si++, x + rnd(-1.5, 1.5) * sc, y + rnd(0.5, 2) * sc, z + rnd(-1.5, 1.5) * sc, rnd(-3, 3) * sc, rnd(1, 6) * sc, rnd(-3, 3) * sc, 1.6 * sc, 6.5 * sc, rnd(1.8, 3.6), 0.7, 0x222222, -0.4, 0.8);
      for (let i = 0; i < 50; i++) emit(spark, pi++, x, y + 1, z, rnd(-14, 14) * sc, rnd(2, 18) * sc, rnd(-14, 14) * sc, 0.3, 0.02, rnd(0.6, 1.4), 1, 0xffd27a, 14, 0.4);
      ringT = 1; ringS = sc; ring.position.set(x, y + 0.3, z); ring.visible = true;
      if (sc >= 0.8) { this.debris(x, y + 0.5, z, Math.round(6 + 5 * sc), 9 * sc, 0.28); this.shock(x, y, z, 11 * sc, 0.6); for (let i = 0; i < 8; i++) this.ember(x, y + 1, z, 1, 3 * sc); }
    },
    /** small airburst (flak): flash, black smoke, a few sparks, no ground ring */
    puff(x, y, z, sc = 1) {
      flash = Math.max(flash, 0.55); light.position.set(x, y, z);
      for (let i = 0; i < 6; i++) emit(fire, fi++, x + rnd(-1, 1) * sc, y + rnd(-1, 1) * sc, z + rnd(-1, 1) * sc, rnd(-3, 3) * sc, rnd(-2, 3) * sc, rnd(-3, 3) * sc, 1.2 * sc, 3.2 * sc, rnd(0.25, 0.55), 0.9, 0xffb050, 0, 2);
      for (let i = 0; i < 9; i++) emit(smoke, si++, x + rnd(-1, 1) * sc, y + rnd(-1, 1) * sc, z + rnd(-1, 1) * sc, rnd(-1.5, 1.5), rnd(-0.5, 1), rnd(-1.5, 1.5), 1.6 * sc, 5 * sc, rnd(1.2, 2.4), 0.8, 0x151515, 0, 0.9);
      for (let i = 0; i < 12; i++) emit(spark, pi++, x, y, z, rnd(-8, 8), rnd(-6, 8), rnd(-8, 8), 0.2, 0.02, rnd(0.4, 0.9), 1, 0xffd27a, 6, 0.6);
    },
    dust(x, y, z, sc = 1) { emit(smoke, si++, x, y, z, rnd(-0.6, 0.6), rnd(0.4, 1.2), rnd(-0.6, 0.6), 0.5 * sc, 2.4 * sc, rnd(0.7, 1.2), 0.35, 0xb59f7a, -0.2, 1.2); },
    burst(x, y, z, color, n = 8, sp = 4, life = 0.6, size = 0.3, up = 0, g = 6) { for (let i = 0; i < n; i++) emit(spark, pi++, x, y, z, rnd(-1, 1) * sp, rnd(-0.3, 1) * sp + up, rnd(-1, 1) * sp, size, size * 0.1, life * rnd(0.6, 1.2), 1, color, g, 1.2); },
    flame(x, y, z, sc = 1) { emit(fire, fi++, x + rnd(-1, 1) * sc, y, z + rnd(-1, 1) * sc, rnd(-0.5, 0.5), rnd(2, 5), rnd(-0.5, 0.5), 1.1 * sc, 0.2, rnd(0.4, 0.8), 0.9, fi % 2 ? 0xff7a1a : 0xffd070, -2.5, 1.3); },
    rise(x, y, z, color, n = 3) { for (let i = 0; i < n; i++) emit(spark, pi++, x + rnd(-0.5, 0.5), y, z + rnd(-0.5, 0.5), rnd(-0.3, 0.3), rnd(1.2, 2.6), rnd(-0.3, 0.3), 0.28, 0.06, rnd(0.7, 1.2), 1, color, -0.5, 0.6); },
    smokeTrail(x, y, z, sc = 1) { emit(smoke, si++, x, y, z, rnd(-0.3, 0.3), rnd(0.2, 0.8), rnd(-0.3, 0.3), 0.5 * sc, 2.2 * sc, rnd(0.8, 1.4), 0.5, 0xbfbfbf, -0.1, 0.6); },
    ember(x, y, z, n = 3, sp = 1.5) { for (let i = 0; i < n; i++) emit(spark, pi++, x + rnd(-1, 1), y, z + rnd(-1, 1), rnd(-sp, sp), rnd(0.5, 2.5), rnd(-sp, sp), 0.18, 0.04, rnd(1.5, 3), 1, 0xff9030, -0.8, 0.3); },
    debris(x, y, z, n = 8, sp = 8, sz = 0.25) {
      for (let i = 0; i < n; i++) {
        const d = deb[di++ % deb.length];
        d.m.visible = true; d.m.position.set(x + rnd(-1, 1), y, z + rnd(-1, 1)); d.m.scale.set(sz * rnd(0.5, 1.6), sz * rnd(0.4, 1.2), sz * rnd(0.5, 1.6));
        d.v.set(rnd(-1, 1) * sp, rnd(0.5, 1.2) * sp, rnd(-1, 1) * sp); d.r.set(rnd(-8, 8), rnd(-8, 8), rnd(-8, 8)); d.life = rnd(1.4, 2.6);
      }
    },
    shock(x, y, z, r = 10, dur = 0.6) {
      const s = shocks[shi++ % shocks.length]; s.on = true; s.t = 0; s.dur = dur; s.r = r; s.m.position.set(x, y, z); s.m.visible = true;
    },
    update(dt) {
      for (const arr of [fire, smoke, spark]) {
        for (const p of arr) {
          if (p.life <= 0) continue;
          p.life -= dt;
          if (p.life <= 0) { p.s.visible = false; continue; }
          const k = 1 - p.life / p.max;
          p.v.y -= p.g * dt; p.v.multiplyScalar(Math.max(0, 1 - p.drag * dt));
          p.s.position.addScaledVector(p.v, dt);
          const z = p.s0 + (p.s1 - p.s0) * k; p.s.scale.set(z, z, 1);
          p.m.opacity = p.o * Math.pow(1 - k, 1.4);
        }
      }
      for (const d of deb) {
        if (d.life <= 0) continue;
        d.life -= dt;
        if (d.life <= 0) { d.m.visible = false; continue; }
        d.v.y -= 18 * dt; d.m.position.addScaledVector(d.v, dt);
        d.m.rotation.x += d.r.x * dt; d.m.rotation.y += d.r.y * dt; d.m.rotation.z += d.r.z * dt;
        const g = heightAt(d.m.position.x, d.m.position.z) + 0.1;
        if (d.m.position.y < g) { d.m.position.y = g; d.v.y = Math.abs(d.v.y) * 0.3; d.v.x *= 0.6; d.v.z *= 0.6; d.r.multiplyScalar(0.5); }
      }
      for (const s of shocks) {
        if (!s.on) continue;
        s.t += dt; const k = s.t / s.dur;
        if (k >= 1) { s.on = false; s.m.visible = false; continue; }
        s.m.scale.setScalar(Math.max(0.01, s.r * (1 - Math.pow(1 - k, 2.4)))); s.m.material.opacity = 0.4 * (1 - k);
      }
      flash = Math.max(0, flash - dt * 2.2); light.intensity = flash * 1400;
      if (ringT > 0) {
        ringT = Math.max(0, ringT - dt * 1.6);
        const s = 1 + (1 - ringT) * 18 * ringS; ring.scale.set(s, s, s); ring.material.opacity = ringT * 0.7;
        if (ringT === 0) ring.visible = false;
      }
    },
  };
}

// ===================== the rift =====================
const RIFT_VS = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const RIFT_FS = `
uniform float uT; uniform float uOpen; uniform float uSeed;
varying vec2 vUv;
float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float vn(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), f.x), mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) {
  float a = 0.5; float s = 0.0; float m = 0.0;
  for (int i = 0; i < OCT; i++) { s += a * vn(p); m += a; p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return s / m;
}
float ridge(vec2 p) {
  float a = 0.5; float s = 0.0; float m = 0.0;
  for (int i = 0; i < OCT; i++) { s += a * (1.0 - abs(vn(p) * 2.0 - 1.0)); m += a; p = p * 2.1 + vec2(3.1, 1.3); a *= 0.5; }
  return s / m;
}
void main() {
  vec2 p = (vUv - 0.5) * 5.2;
  p.y *= 0.82;                                   // taller than wide
  float r = length(p);
  float a = atan(p.y, p.x);
  vec2 dir = vec2(cos(a), sin(a));               // noise is sampled on the unit circle, so there is no seam

  // ---- the torn, writhing edge
  float edge = 0.9
    + (fbm(dir * 2.2 + uSeed) - 0.5) * 0.55
    + (ridge(dir * 3.5 + uSeed * 1.7) - 0.5) * 0.22
    + pow(vn(dir * 7.0 + uSeed), 3.0) * 0.3
    + (fbm(dir * 5.0 + vec2(uT * 0.5, -uT * 0.35)) - 0.5) * 0.08;
  float d = r - edge;
  float inside = 1.0 - smoothstep(-0.02, 0.02, d);
  float outer = smoothstep(0.0, 0.06, d);

  // ---- inside: a vortex of nebula and stars with a white-hot singularity
  float sa = a + 2.4 / (r + 0.18) - uT * 0.35;
  vec2 q = vec2(cos(sa), sin(sa)) * r;
  float n = fbm(q * 2.6 + uT * 0.04);
  vec3 vc = mix(vec3(0.015, 0.005, 0.05), vec3(0.42, 0.08, 0.85), smoothstep(0.25, 0.85, n));
  vc += vec3(1.0, 0.18, 0.45) * pow(fbm(q * 4.5 + 11.0), 4.0) * 1.3;
  vc += vec3(0.25, 0.55, 1.0) * pow(fbm(q * 3.2 - 7.0 + uT * 0.08), 5.0) * 1.1;
  float sh = h21(floor(q * 55.0));
  vc += vec3(step(0.982, sh) * (0.5 + 0.5 * sin(uT * 4.0 + sh * 40.0))) * 1.2;
  float core = exp(-r * r * 16.0);
  float rx = (r - 0.27) * 13.0;
  float ring = exp(-rx * rx) * (0.55 + 0.9 * fbm(vec2(cos(sa * 2.0), sin(sa * 2.0)) * 2.0 + r * 6.0 - uT));
  vc *= smoothstep(0.1, 0.3, r);
  vc += vec3(1.0, 0.75, 0.45) * ring * 1.5 + vec3(1.0, 0.95, 0.9) * core * 1.6;
  float heat = pow(smoothstep(-0.55, 0.0, d), 2.0);    // the inside of the rim burns
  vc = mix(vc, vec3(1.0, 0.45, 0.1) * 1.4, heat * 0.55);

  // ---- outside: glowing cracks, rays, pulse waves, a hot rim
  float ad = max(d, 0.0);
  vec2 cp = p * 1.35 + (vec2(fbm(p * 1.7 + uSeed), fbm(p * 1.7 - uSeed)) - 0.5) * 1.4;
  float cr = ridge(cp + uSeed * 2.0);
  float fl = 0.88 + 0.12 * sin(uT * 7.0) + 0.05 * sin(uT * 17.0);
  float cracks = (pow(cr, 18.0) * 4.0 + pow(cr, 8.0) * 0.35) * outer * exp(-d * 1.5) * (0.6 + 0.4 * sin(uT * 9.0 + r * 8.0));
  float hot = exp(-abs(d) * 34.0);
  float gO = exp(-ad * 5.5);
  float gR = exp(-ad * 2.0);
  float ray = pow(vn(dir * 5.0 + vec2(uT * 0.3, uSeed)), 2.2) * exp(-ad * 1.2) * outer;
  float wx = (ad - fract(uT * 0.22) * 2.2) * 9.0;
  float wave = exp(-wx * wx) * outer * 0.5 * (1.0 - fract(uT * 0.22));
  vec3 glow = vec3(1.0, 0.92, 0.78) * hot * 2.4 + vec3(1.0, 0.42, 0.08) * gO * 1.2 + vec3(0.85, 0.1, 0.04) * gR * 0.5
    + vec3(1.0, 0.55, 0.2) * ray * 1.2 + vec3(1.0, 0.72, 0.4) * cracks + vec3(0.9, 0.4, 0.15) * wave;
  float qf = 1.0 - smoothstep(0.7, 1.0, length(vUv - 0.5) * 2.0); // fade out before the quad's edge
  vec3 col = (vc * inside + glow * fl * qf) * uOpen;
  gl_FragColor = vec4(col, inside * uOpen);        // premultiplied: dark void on top, additive glow around it
}`;

/**
 * The rift: a tear in the sky (one shader quad + halo + embers).
 * place(x, y, z, size, open 0..1) every frame it should be visible; update(dt, camera) billboards it; hide() removes it.
 */
export function makeRift(scene, tex, lite = false) {
  const g = new THREE.Group(); g.visible = false; scene.add(g);
  const mat = new THREE.ShaderMaterial({
    defines: { OCT: lite ? 3 : 5 },
    uniforms: { uT: { value: 0 }, uOpen: { value: 0 }, uSeed: { value: 3.7 } },
    vertexShader: RIFT_VS, fragmentShader: RIFT_FS,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: false,
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 5.2), mat); quad.renderOrder = 31; quad.frustumCulled = false; g.add(quad);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex.glow, color: 0xff7a2a, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  halo.renderOrder = 29; halo.scale.set(7.5, 7.5, 1); g.add(halo);
  // embers spiralling into the void
  const M = lite ? 120 : 220, spos = new Float32Array(M * 3), sgeo = new THREE.BufferGeometry(); sgeo.setAttribute('position', new THREE.BufferAttribute(spos, 3));
  const swirl = new THREE.Points(sgeo, new THREE.PointsMaterial({ color: 0xffc880, size: 3, sizeAttenuation: false, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  swirl.frustumCulled = false; swirl.renderOrder = 32; g.add(swirl);
  const seed = Array.from({ length: M }, () => ({ a: Math.random() * 6.283, r: 0.25 + Math.random() * 2.4, s: 0.4 + Math.random() * 1.2 }));
  let open = 0, size = 1, T = 0;
  return {
    group: g,
    place(x, y, z, sz, o) { g.position.set(x, y, z); size = sz; open = Math.max(0, Math.min(1, o)); g.visible = open > 0.002; },
    hide() { g.visible = false; },
    update(dt, cam) {
      if (!g.visible) return;
      T += dt;
      g.lookAt(cam.position);
      g.scale.set(Math.max(0.001, size * Math.pow(open, 1.5)), Math.max(0.001, size * Math.pow(open, 0.75)), 1);
      mat.uniforms.uT.value = T; mat.uniforms.uOpen.value = open;
      halo.material.opacity = (0.45 + 0.2 * Math.sin(T * 5)) * open; halo.scale.setScalar(7.5 + Math.sin(T * 3) * 0.4);
      for (let i = 0; i < M; i++) {
        const p = seed[i];
        p.a += p.s * dt * 1.6; p.r -= p.s * dt * 0.32; if (p.r < 0.2) p.r = 1.2 + Math.random() * 1.5;
        spos[i * 3] = Math.cos(p.a) * p.r; spos[i * 3 + 1] = Math.sin(p.a) * p.r * 0.85; spos[i * 3 + 2] = 0.03;
      }
      sgeo.attributes.position.needsUpdate = true;
    },
  };
}
