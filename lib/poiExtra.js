/**
 * New POIs for the big map. Same toolkit as poiBuilders.js. spots can carry a `kind` ('ammo' | 'mats' | 'health')
 * so each POI is worth visiting for something specific: hospitals and clinics = health, mines and sawmills = materials,
 * prisons, depots and checkpoints = ammo.
 */
import * as THREE from 'three';
import { addCollider } from './collision.js';
import { heightAt as Y } from './ground.js';
import { makeRng } from './rng.js';
import { LAKES } from './terrain.js';

const PI = Math.PI;
const loot = (b, x, z, kind, dy = 0.4) => b.spots.push({ x, z, y: Y(x, z) + dy, kind });
const cyl = (b, mk, x, z, rb, rt, h, seg = 14) => {
  const y = Y(x, z), w = Math.max(rb, rt) * 1.75;
  b.geo(mk, new THREE.CylinderGeometry(rt, rb, h + 0.4, seg), [x, y - 0.4 + (h + 0.4) / 2, z]);
  addCollider(x, z, w, y + h, w, { y0: y });
  return y;
};
const tank = (b, x, z, r, h, mk = 'pWhite') => {
  const y = cyl(b, mk, x, z, r, r, h, 18);
  b.geo('roofB', new THREE.ConeGeometry(r * 1.03, 1.4, 18), [x, y + h + 0.7, z]);
  b.zone(x, z, r * 2, r * 2, 2);
};
const tent = (b, x, z) => {
  const y = Y(x, z);
  b.wedge('canvas', x - 1.1, y, z, 2.2, 3.2, 1.9, 0); b.wedge('canvas', x + 1.1, y, z, 2.2, 3.2, 1.9, 2);
  addCollider(x, z, 4.4, y + 1.9, 3.2, { y0: y });
};
const fenceRect = (b, cx, cz, w, d) => {
  const x0 = cx - w / 2, x1 = cx + w / 2, z0 = cz - d / 2, z1 = cz + d / 2;
  b.fence(x0, 0, z0, x1, z0); b.fence(x1, 0, z0, x1, z1); b.fence(x1, 0, z1, x0, z1); b.fence(x0, 0, z1, x0, z0);
};
const redCross = (b, x, y, z) => { b.box('pRed', x, y, z, 5, 0.3, 1.4, 1); b.box('pRed', x, y, z, 1.4, 0.3, 5, 1); };

// ======================= MAJOR =======================
function power(b, p, R) {
  b.zone(p.x, p.z, 210, 170, 4);
  for (const dx of [-60, -10]) { const x = p.x + dx, z = p.z - 44; cyl(b, 'concC', x, z, 14, 9, 46, 24); b.zone(x, z, 30, 30, 2); }
  b.building(p.x + 52, p.z - 30, 44, 20, { floors: 2, fh: 6, mk: 'pGrey', roofMk: 'roofB', door: ['s', 'n'], dw: 5, dh: 4.6, winGap: 6 });
  b.building(p.x - 44, p.z + 30, 16, 12, { floors: 2, mk: 'concC', door: 'n', part: true });
  const yx = p.x + 20, yz = p.z + 38;
  fenceRect(b, yx, yz, 54, 34);
  for (let i = 0; i < 6; i++) {
    const x = yx - 20 + (i % 3) * 20, z = yz - 7 + ((i / 3) | 0) * 14;
    b.solid('pGrey', x, Y(x, z), z, 3.4, 3.4, 2.8, { tile: 2, ground: true });
    b.solid('metalD', x, Y(x, z) + 3.4, z, 1.4, 1.2, 1.4, { tile: 1 });
  }
  for (let k = 0; k < 4; k++) {
    const x = p.x + 100 + k * 30, z = p.z + 60 - k * 12;
    b.solid('metalD', x, Y(x, z), z, 0.9, 30, 0.9, { tile: 1 }); b.box('metalD', x, Y(x, z) + 26, z, 11, 0.3, 0.3, 1); b.box('metalD', x, Y(x, z) + 22, z, 8, 0.3, 0.3, 1);
  }
  b.car(p.x - 20, Y(p.x - 20, p.z + 10), p.z + 10, 0, 'pYellow');
  loot(b, p.x + 30, p.z - 8, 'ammo'); loot(b, p.x - 30, p.z + 12, 'mats'); loot(b, p.x + 10, p.z + 40, 'mats'); loot(b, p.x - 60, p.z - 20, 'ammo');
}
function mine(b, p, R) {
  const y = (dx, dz) => Y(p.x + dx, p.z + dz);
  b.zone(p.x, p.z, 170, 140, 4);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.solid('metalD', p.x + sx * 3, y(0, 0), p.z + sz * 3, 0.6, 22, 0.6, { tile: 1 });
  b.solid('metalD', p.x, y(0, 0) + 22, p.z, 7, 0.8, 7, { tile: 1 });
  b.geo('metalD', new THREE.CylinderGeometry(2.4, 2.4, 0.6, 16), [p.x, y(0, 0) + 24, p.z], [PI / 2, 0, 0]);
  b.building(p.x + 24, p.z + 8, 18, 12, { floors: 1, fh: 5, mk: 'woodD', roof: 'shed', door: 'w' });
  b.solid('pGrey', p.x - 24, y(-24, 8), p.z + 8, 10, 6, 8, { tile: 2 });
  const tz = p.z - 40, ty = y(0, -40);
  b.solid('rock', p.x - 11, ty, tz, 9, 9, 16, { tile: 4, ground: true, nc: true });
  b.solid('rock', p.x + 11, ty, tz, 9, 9, 16, { tile: 4, ground: true, nc: true });
  b.solid('rock', p.x, ty + 3.8, tz, 14, 5.2, 16, { tile: 4, nc: true });
  b.drape('dirt', p.x, p.z - 20, 3.2, 40, 0.04, 0, 3);
  b.solid('pOrange', p.x + 4, y(4, -16), p.z - 16, 2.4, 1.2, 1.4, { tile: 1 });
  for (let i = 0; i < 5; i++) { const dx = (R() - 0.5) * 120, dz = 20 + R() * 40, s = 5 + R() * 6; b.solid('rock', p.x + dx, y(dx, dz), p.z + dz, s, 2 + R() * 3, s, { tile: 4, ground: true, nc: true }); }
  b.car(p.x - 40, y(-40, 30), p.z + 30, PI / 2, 'pYellow');
  loot(b, p.x, p.z - 52, 'mats'); loot(b, p.x + 20, p.z + 10, 'mats'); loot(b, p.x - 24, p.z + 16, 'ammo'); loot(b, p.x + 10, p.z - 10, 'mats');
}
function refinery(b, p, R) {
  b.zone(p.x, p.z, 190, 160, 4);
  for (const [dx, dz, r, h] of [[-50, -30, 9, 15], [-28, -30, 8, 13], [-6, -30, 10, 16], [-50, -6, 7, 12], [-28, -6, 8, 14], [-4, -6, 7, 12]]) tank(b, p.x + dx, p.z + dz, r, h);
  for (let x = -56; x <= 10; x += 12) b.solid('metalD', p.x + x, Y(p.x + x, p.z + 14), p.z + 14, 0.5, 4.2, 0.5, { tile: 1 });
  b.solid('metalD', p.x - 23, Y(p.x - 23, p.z + 14) + 4.2, p.z + 14, 70, 0.7, 1.6, { tile: 1 });
  const fx = p.x + 62, fz = p.z - 44, fy = Y(fx, fz);
  cyl(b, 'metalD', fx, fz, 0.8, 0.5, 38, 8); b.box('lamp', fx, fy + 38, fz, 1.2, 1.2, 1.2, 1);
  b.building(p.x + 42, p.z + 24, 22, 14, { floors: 2, fh: 4, mk: 'pGrey', roofMk: 'roofB', door: 'w', winGap: 5 });
  for (let i = 0; i < 2; i++) { const x = p.x - 20 + i * 18, z = p.z + 40; b.solid('pWhite', x, Y(x, z), z, 10, 3, 2.6, { tile: 2, ground: true }); b.barrel(x + 7, Y(x + 7, z), z, 'pOrange'); }
  fenceRect(b, p.x, p.z, 150, 120);
  loot(b, p.x + 30, p.z + 10, 'ammo'); loot(b, p.x - 30, p.z + 26, 'mats'); loot(b, p.x + 56, p.z + 28, 'mats');
}
function prison(b, p, R) {
  const H = 52, wh = 6, gy = (dx, dz) => Y(p.x + dx, p.z + dz);
  b.zone(p.x, p.z, 2 * H + 16, 2 * H + 16, 2);
  b.wallRun('concD', 'x', p.z - H, p.x - H, p.x + H, gy(0, -H), wh, 1.4, [], 4);
  b.wallRun('concD', 'x', p.z + H, p.x - H, p.x + H, gy(0, H), wh, 1.4, [{ c: p.x, w: 9, lo: 0, hi: wh }], 4);
  b.wallRun('concD', 'z', p.x - H, p.z - H, p.z + H, gy(-H, 0), wh, 1.4, [], 4);
  b.wallRun('concD', 'z', p.x + H, p.z - H, p.z + H, gy(H, 0), wh, 1.4, [], 4);
  for (const [dx, dz, dr] of [[-H + 4, -H + 4, 2], [H - 4, -H + 4, 0], [-H + 4, H - 4, 2], [H - 4, H - 4, 0]]) b.watchtower(p.x + dx, gy(dx, dz), p.z + dz, 9, dr);
  b.building(p.x - 24, p.z - 20, 36, 14, { floors: 2, fh: 3.4, mk: 'concD', roofMk: 'roofB', door: 's', part: true });
  b.building(p.x + 24, p.z - 20, 36, 14, { floors: 2, fh: 3.4, mk: 'concD', roofMk: 'roofB', door: 's', part: true });
  b.building(p.x, p.z + 32, 20, 10, { mk: 'concC', door: 's' });
  fenceRect(b, p.x, p.z + 8, 80, 30);
  b.sandbags(p.x - 10, gy(-10, 20), p.z + 20, 5, 'x'); b.crates(p.x + 20, gy(20, 22), p.z + 22, 2, 1, 2);
  loot(b, p.x - 24, p.z - 20, 'ammo'); loot(b, p.x + 24, p.z - 20, 'ammo'); loot(b, p.x, p.z + 32, 'health'); loot(b, p.x - 30, p.z + 8, 'ammo'); loot(b, p.x + 30, p.z + 8, 'mats');
}
function hospital(b, p, R) {
  b.zone(p.x, p.z, 130, 100, 4);
  b.building(p.x, p.z - 8, 56, 18, { floors: 3, fh: 3.6, mk: 'concW', door: ['s', 'n'], dw: 3.2, part: true });
  for (const sx of [-1, 1]) b.building(p.x + sx * 34, p.z + 24, 14, 30, { floors: 2, mk: 'concC', door: 'n', dw: 2.6 });
  redCross(b, p.x, Y(p.x, p.z - 8) + 3 * 3.6 + 1.1, p.z - 8);
  b.drape('hpad', p.x, p.z + 46, 18, 18, 0.04, 0, 4);
  for (const dx of [-12, 12]) b.lamp(p.x + dx, Y(p.x + dx, p.z + 38), p.z + 38);
  b.car(p.x - 24, Y(p.x - 24, p.z + 38), p.z + 38, 0, 'pWhite'); b.car(p.x + 24, Y(p.x + 24, p.z + 40), p.z + 40, PI, 'pWhite');
  tent(b, p.x - 50, p.z + 4);
  for (const [dx, dz] of [[-18, -8], [18, -8], [-40, 24], [40, 24]]) loot(b, p.x + dx, p.z + dz, 'health');
  loot(b, p.x, p.z + 20, 'ammo');
}
function stadium(b, p, R) {
  const W = 70, D = 44, y0 = Y(p.x, p.z);
  b.zone(p.x, p.z, 2 * W + 60, 2 * D + 60, 2);
  b.drape('crop', p.x, p.z, 2 * W - 4, 2 * D - 4, 0.05, 0, 4);
  for (let t = 0; t < 3; t++) {
    const off = 6 + t * 5, h = 2.2 + t * 2.4;
    for (const s of [-1, 1]) {
      for (const hs of [-1, 1]) {
        b.solid('conc', p.x + hs * (W + off) / 2 + hs * 2.5, y0, p.z + s * (D + off), W + off - 5, h, 5, { tile: 3, nc: false });
        b.solid('conc', p.x + s * (W + off), y0, p.z + hs * (D + off) / 2 + hs * 2.5, 5, h, D + off - 5, { tile: 3, nc: false });
      }
    }
  }
  for (const s of [-1, 1]) for (const sx of [-30, 30]) b.stairs(p.x + sx, p.z + s * (D + 16 + 2.5 + 4.65), s > 0 ? 3 : 1, 3, 9.3, y0, 7.0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const x = p.x + sx * (W + 24), z = p.z + sz * (D + 24);
    b.solid('metalD', x, Y(x, z), z, 0.8, 30, 0.8, { tile: 1 }); b.box('lamp', x, Y(x, z) + 30, z, 3, 0.8, 1, 1);
  }
  b.building(p.x + W + 40, p.z, 14, 30, { floors: 2, mk: 'concC', door: 'w' });
  loot(b, p.x - 30, p.z + D + 18, 'ammo', 7.4); loot(b, p.x + 30, p.z - D - 18, 'ammo', 7.4); loot(b, p.x, p.z, 'mats'); loot(b, p.x + W + 40, p.z, 'health');
}
function windfarm(b, p, R) {
  for (let i = 0; i < 8; i++) {
    const a = (i / 7 - 0.5) * 2.2, x = p.x + a * 120 + (R() - 0.5) * 16, z = p.z + Math.sin(a * 2.4) * 80 + (R() - 0.5) * 16, y = Y(x, z), rot = R() * PI;
    b.geo('pWhite', new THREE.CylinderGeometry(0.9, 1.7, 64, 12), [x, y + 31.5, z]);
    b.geo('pWhite', new THREE.BoxGeometry(2.4, 2.6, 5.5), [x, y + 65, z + 1.2]);
    for (let k = 0; k < 3; k++) { const ang = rot + (k * PI * 2) / 3; b.geo('pWhite', new THREE.BoxGeometry(0.5, 28, 0.14), [x + Math.sin(ang) * 14, y + 65 + Math.cos(ang) * 14, z - 1.9], [0, 0, -ang]); }
    addCollider(x, z, 3.2, y + 64, 3.2, { y0: y }); b.zone(x, z, 8, 8, 2);
  }
  b.zone(p.x, p.z, 60, 50, 2);
  b.building(p.x, p.z, 14, 10, { mk: 'concW', roof: 'flat', door: 's' });
  fenceRect(b, p.x, p.z + 4, 40, 36);
  for (const dx of [-12, 12]) b.solid('pGrey', p.x + dx, Y(p.x + dx, p.z + 18), p.z + 18, 3, 3, 2.6, { tile: 2, ground: true });
  loot(b, p.x, p.z, 'mats'); loot(b, p.x + 10, p.z + 14, 'ammo');
}
function harbor(b, p, R) {
  const L = LAKES[p.lake], wy = L.y, deck = wy + 0.9;
  b.zone(p.x, p.z, 150, 120, 4);
  for (const dz of [-26, 6]) {
    b.solid('woodD', p.x + 50, deck, p.z + dz, 60, 0.3, 4, { tile: 2 });
    for (let k = 0; k < 6; k++) for (const s of [-1, 1]) b.box('woodD', p.x + 26 + k * 10, wy - 2.2, p.z + dz + s * 1.8, 0.35, deck - (wy - 2.2), 0.35, 1);
  }
  const bx = p.x + 66, bz = p.z - 20;
  b.box('pBlue', bx, wy - 0.3, bz, 12, 1.8, 3.8, 2); addCollider(bx, bz, 12, wy + 1.5, 3.8, { y0: wy - 0.3 });
  for (const dz of [-22, 26]) b.building(p.x - 36, p.z + dz, 34, 16, { floors: 1, fh: 7, mk: 'pGrey', roofMk: 'roofB', door: ['e', 'w'], dw: 6, dh: 5.4, win: false, stairs: false });
  for (const dz of [-8, 20]) {
    const x = p.x + 4, z = p.z + dz;
    for (const s of [-1, 1]) b.solid('pYellow', x, Y(x, z + s * 8), z + s * 8, 1.2, 26, 1.2, { tile: 1 });
    b.solid('pYellow', x, Y(x, z) + 26, z, 1.6, 1.4, 18, { tile: 1 });
  }
  b.container(p.x - 4, Y(p.x - 4, p.z + 46), p.z + 46, 'x', 'pBlue'); b.container(p.x - 4, Y(p.x - 4, p.z + 46), p.z + 46, 'x', 'pRed', 1);
  b.lamp(p.x + 20, Y(p.x + 20, p.z - 12), p.z - 12);
  loot(b, p.x - 20, p.z - 22, 'mats'); loot(b, p.x - 20, p.z + 26, 'ammo'); loot(b, p.x + 30, p.z - 10, 'mats'); loot(b, p.x + 4, p.z + 40, 'ammo');
}
function railyard(b, p, R) {
  b.zone(p.x, p.z, 200, 100, 4);
  const gy = Y(p.x, p.z) + 0.05, cars = ['pRed', 'pGreen', 'pBlue', 'pOrange', 'pGrey'];
  for (let t = 0; t < 4; t++) {
    const z = p.z - 24 + t * 14;
    b.drape('dirt', p.x, z, 180, 3.6, 0.05, 0, 3);
    for (const s of [-0.75, 0.75]) b.box('metalD', p.x, gy, z + s, 180, 0.18, 0.12, 1);
    for (let k = 0; k < 6; k++) {
      if (R() < 0.35) continue;
      const x = p.x - 75 + k * 28 + (R() - 0.5) * 4, kind = R();
      if (kind < 0.5) { b.solid(cars[Math.floor(R() * cars.length)], x, gy, z, 12, 3.2, 2.8, { tile: 2 }); b.box('metalD', x, gy + 3.2, z, 12.2, 0.2, 3, 1); }
      else if (kind < 0.8) { b.geo('pGrey', new THREE.CylinderGeometry(1.4, 1.4, 11, 14), [x, gy + 2, z], [0, 0, PI / 2]); addCollider(x, z, 11, gy + 3.4, 2.8, { y0: gy }); }
      else b.container(x, gy, z, 'x', cars[Math.floor(R() * cars.length)]);
    }
  }
  b.building(p.x - 34, p.z + 36, 26, 10, { mk: 'brick', roof: 'gable', door: 'n', shop: true });
  b.solid('conc', p.x - 34, gy, p.z + 26, 40, 0.6, 5, { tile: 3 });
  const wx = p.x + 60, wz = p.z + 36;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.solid('woodD', wx + sx * 2.2, Y(wx, wz), wz + sz * 2.2, 0.5, 11, 0.5, { tile: 1 });
  cyl(b, 'woodD', wx, wz + 0.01, 3.2, 3.2, 4, 14);
  b.container(p.x + 20, gy, p.z + 44, 'x', 'pOrange');
  loot(b, p.x - 34, p.z + 36, 'ammo'); loot(b, p.x + 10, p.z - 6, 'mats'); loot(b, p.x - 50, p.z + 6, 'mats'); loot(b, p.x + 50, p.z + 8, 'ammo');
}
function observatory(b, p, R) {
  const y = Y(p.x, p.z);
  b.zone(p.x, p.z, 80, 80, 4);
  b.geo('pWhite', new THREE.CylinderGeometry(9, 10, 9, 24), [p.x, y + 4.5, p.z]);
  b.geo('pWhite', new THREE.SphereGeometry(8.6, 24, 12, 0, PI * 2, 0, PI / 2), [p.x, y + 9, p.z]);
  b.box('metalD', p.x, y + 11, p.z - 6.5, 1.6, 6, 1.5, 1);
  addCollider(p.x, p.z, 18, y + 13, 18, { y0: y });
  b.building(p.x + 22, p.z + 6, 16, 12, { floors: 2, mk: 'concW', roof: 'flat', door: 'w' });
  cyl(b, 'metalD', p.x - 26, p.z + 12, 0.35, 0.2, 22, 8);
  b.drape('hpad', p.x - 24, p.z - 14, 14, 14, 0.04, 0, 4);
  b.watchtower(p.x - 22, Y(p.x - 22, p.z + 26), p.z + 26, 8, 0);
  b.car(p.x + 8, Y(p.x + 8, p.z + 24), p.z + 24, 0, 'pGrey');
  loot(b, p.x + 22, p.z + 6, 'health'); loot(b, p.x + 14, p.z - 14, 'ammo'); loot(b, p.x - 22, p.z + 26, 'ammo', 9);
}
function ghost(b, p, R) {
  b.zone(p.x, p.z, 200, 110, 2);
  b.drape('dirt', p.x, p.z, 180, 12, 0.03, 0, 4);
  for (let i = 0; i < 6; i++) for (const s of [-1, 1]) {
    if (R() < 0.15) continue;
    const w = 11 + R() * 5, d = 10 + R() * 3;
    b.building(p.x - 78 + i * 29 + R() * 3, p.z + s * (12 + d / 2 + 2), w, d, { floors: R() < 0.4 ? 2 : 1, fh: 3.4, mk: R() < 0.5 ? 'woodD' : 'woodR', roof: 'flat', door: s < 0 ? 's' : 'n', dw: 2 });
  }
  b.building(p.x + 100, p.z, 12, 16, { mk: 'conc', roof: 'gable', door: 'w' });
  const wx = p.x - 100, wz = p.z + 4;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.solid('woodD', wx + sx * 2, Y(wx, wz), wz + sz * 2, 0.5, 9, 0.5, { tile: 1 });
  cyl(b, 'woodD', wx, wz + 0.01, 3, 3, 3.5, 12);
  for (let i = 0; i < 4; i++) { const x = p.x - 60 + i * 34, z = p.z + (i % 2 ? 4 : -4); b.solid('woodD', x, Y(x, z), z, 3, 1, 0.25, { tile: 1 }); b.barrel(x + 2, Y(x + 2, z + 2), z + 2, 'pRed'); }
  b.car(p.x + 40, Y(p.x + 40, p.z), p.z, 0.3, 'pYellow');
  loot(b, p.x - 40, p.z - 24, 'ammo'); loot(b, p.x + 20, p.z + 24, 'health'); loot(b, p.x + 70, p.z - 22, 'mats'); loot(b, p.x + 100, p.z, 'health');
}

// ======================= MINOR =======================
function fuel(b, p, R) {
  const y0 = Y(p.x, p.z);
  b.zone(p.x, p.z, 36, 30, 2);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.solid('metalD', p.x + sx * 5, Y(p.x + sx * 5, p.z + sz * 3.5), p.z + sz * 3.5, 0.4, 4.6, 0.4, { tile: 1 });
  b.box('pRed', p.x, y0 + 4.6, p.z, 13, 0.5, 9, 2); b.box('pWhite', p.x, y0 + 5.1, p.z, 13.2, 0.2, 9.2, 2);
  for (const dx of [-3, 3]) for (const dz of [-1.6, 1.6]) b.solid('pYellow', p.x + dx, Y(p.x + dx, p.z + dz), p.z + dz, 0.9, 1.5, 0.6, { tile: 1 });
  b.building(p.x - 4, p.z - 14, 14, 8, { mk: 'concW', roof: 'flat', door: 's', shop: true });
  b.solid('metalD', p.x + 12, Y(p.x + 12, p.z - 4), p.z - 4, 0.4, 9, 0.4, { tile: 1 }); b.box('pRed', p.x + 12, Y(p.x + 12, p.z - 4) + 8, p.z - 4, 3, 1.6, 0.3, 1);
  b.car(p.x + 10, Y(p.x + 10, p.z + 10), p.z + 10, 0.4, 'pYellow'); b.barrel(p.x - 8, Y(p.x - 8, p.z + 8), p.z + 8, 'pRed');
  loot(b, p.x - 4, p.z - 14, 'ammo'); loot(b, p.x + 6, p.z + 4, 'health');
}
function supply(b, p, R) {
  b.zone(p.x, p.z, 36, 30, 2);
  b.container(p.x - 6, Y(p.x - 6, p.z), p.z, 'x', 'pGreen'); b.container(p.x + 6, Y(p.x + 6, p.z + 6), p.z + 6, 'z', 'pGrey');
  b.crates(p.x, Y(p.x, p.z + 12), p.z + 12, 2, 2, 2); b.sandbags(p.x - 8, Y(p.x - 8, p.z - 8), p.z - 8, 5, 'x'); b.jersey(p.x + 10, Y(p.x + 10, p.z - 6), p.z - 6, 'z');
  tent(b, p.x - 14, p.z + 8);
  loot(b, p.x - 2, p.z + 4, 'ammo'); loot(b, p.x + 8, p.z - 2, 'ammo'); loot(b, p.x - 14, p.z + 12, 'ammo'); loot(b, p.x + 2, p.z + 16, 'mats');
}
function clinic(b, p, R) {
  b.zone(p.x, p.z, 34, 30, 2);
  b.building(p.x, p.z, 12, 9, { mk: 'concW', roof: 'flat', door: 's' });
  redCross(b, p.x, Y(p.x, p.z) + 3.4, p.z);
  b.car(p.x + 12, Y(p.x + 12, p.z + 10), p.z + 10, 0, 'pWhite'); tent(b, p.x - 12, p.z + 8);
  loot(b, p.x, p.z, 'health'); loot(b, p.x - 12, p.z + 8, 'health'); loot(b, p.x + 10, p.z + 4, 'health');
}
function garage(b, p, R) {
  b.zone(p.x, p.z, 40, 34, 2);
  b.building(p.x, p.z, 16, 12, { mk: 'pGrey', roofMk: 'roofB', roof: 'flat', door: 's', dw: 5, dh: 3.6, win: false });
  b.car(p.x - 12, Y(p.x - 12, p.z + 12), p.z + 12, 0.5, 'pRed'); b.car(p.x + 12, Y(p.x + 12, p.z + 14), p.z + 14, -0.3, 'pBlue');
  for (let i = 0; i < 3; i++) b.barrel(p.x + 10 + i, Y(p.x + 10 + i, p.z - 9), p.z - 9, 'pOrange');
  loot(b, p.x, p.z, 'mats'); loot(b, p.x + 4, p.z + 3, 'mats'); loot(b, p.x - 6, p.z - 2, 'ammo');
}
function sawmill(b, p, R) {
  b.zone(p.x, p.z, 44, 34, 2);
  b.building(p.x - 6, p.z, 16, 10, { mk: 'woodD', roof: 'shed', door: 's', dw: 4, dh: 3.2 });
  for (let i = 0; i < 4; i++) for (let l = 0; l < 2; l++) { const x = p.x + 14, z = p.z - 8 + i * 5, y = Y(x, z); b.geo('wood', new THREE.CylinderGeometry(0.45, 0.45, 7, 8), [x, y + 0.45 + l * 0.8, z], [0, 0, PI / 2]); }
  addCollider(p.x + 14, p.z, 7, Y(p.x + 14, p.z) + 1.7, 17, { y0: Y(p.x + 14, p.z) });
  b.crates(p.x - 4, Y(p.x - 4, p.z + 12), p.z + 12, 3, 1, 1);
  loot(b, p.x - 6, p.z, 'mats'); loot(b, p.x + 12, p.z + 6, 'mats'); loot(b, p.x - 4, p.z + 12, 'mats');
}
function mineshaft(b, p, R) {
  const ty = Y(p.x, p.z);
  b.zone(p.x, p.z, 34, 30, 2);
  b.solid('rock', p.x - 5.5, ty, p.z - 6, 5, 6, 10, { tile: 4, ground: true, nc: true }); b.solid('rock', p.x + 5.5, ty, p.z - 6, 5, 6, 10, { tile: 4, ground: true, nc: true });
  b.solid('rock', p.x, ty + 3.2, p.z - 6, 8, 3, 10, { tile: 4, nc: true });
  b.drape('dirt', p.x, p.z + 6, 3, 14, 0.04, 0, 3); b.solid('pOrange', p.x + 2, Y(p.x + 2, p.z + 8), p.z + 8, 2.2, 1.1, 1.3, { tile: 1 });
  loot(b, p.x, p.z - 6, 'mats'); loot(b, p.x + 4, p.z + 10, 'ammo');
}
function dock(b, p, R) {
  const L = LAKES[p.lake], wy = L.y, dx = L.x - p.x, dz = L.z - p.z, ax = Math.abs(dx) > Math.abs(dz), sg = (ax ? dx : dz) > 0 ? 1 : -1;
  b.zone(p.x, p.z, 40, 40, 2);
  if (ax) b.solid('woodD', p.x + sg * 16, wy + 0.9, p.z, 30, 0.3, 3, { tile: 2 }); else b.solid('woodD', p.x, wy + 0.9, p.z + sg * 16, 3, 0.3, 30, { tile: 2 });
  const bx = ax ? p.x + sg * 22 : p.x + 4, bz = ax ? p.z + 4 : p.z + sg * 22;
  b.box('pBlue', bx, wy - 0.3, bz, ax ? 8 : 3, 1.6, ax ? 3 : 8, 2); addCollider(bx, bz, ax ? 8 : 3, wy + 1.3, ax ? 3 : 8, { y0: wy - 0.3 });
  b.building(p.x - sg * (ax ? 10 : 0), p.z - sg * (ax ? 0 : 10), 7, 6, { mk: 'woodD', roof: 'gable', door: ax ? (sg > 0 ? 'e' : 'w') : (sg > 0 ? 's' : 'n'), stairs: false });
  loot(b, p.x, p.z, 'ammo'); loot(b, p.x + 3, p.z + 3, 'health');
}
function windmill(b, p, R) {
  b.zone(p.x, p.z, 40, 40, 2);
  const y = cyl(b, 'woodD', p.x, p.z, 2.6, 1.6, 14, 10), rot = R() * PI;
  for (let k = 0; k < 4; k++) { const a = rot + (k * PI) / 2; b.geo('wood', new THREE.BoxGeometry(0.8, 8, 0.12), [p.x + Math.sin(a) * 4, y + 14 + Math.cos(a) * 4, p.z - 2.1], [0, 0, -a]); }
  b.building(p.x + 14, p.z + 6, 12, 9, { mk: 'woodR', roof: 'gable', door: 's' });
  loot(b, p.x + 14, p.z + 6, 'mats'); loot(b, p.x + 4, p.z + 8, 'ammo');
}
function trailer(b, p, R) {
  b.zone(p.x, p.z, 40, 34, 2);
  for (let i = 0; i < 3; i++) { const x = p.x - 12 + i * 12, z = p.z + (i % 2) * 6, y = Y(x, z); b.solid('pWhite', x, y, z, 8, 2.7, 2.6, { tile: 2, ground: true }); b.box('metalD', x, y + 2.7, z, 8.2, 0.15, 2.8, 1); }
  b.building(p.x + 6, p.z - 12, 6, 5, { mk: 'woodD', roof: 'shed', door: 's', win: false, stairs: false });
  b.car(p.x - 8, Y(p.x - 8, p.z + 12), p.z + 12, 0.3, 'pGreen');
  loot(b, p.x - 12, p.z + 4, 'health'); loot(b, p.x + 6, p.z - 12, 'ammo');
}
function checkpoint(b, p, R) {
  b.zone(p.x, p.z, 36, 30, 2);
  for (let i = 0; i < 4; i++) b.jersey(p.x - 9 + i * 6, Y(p.x - 9 + i * 6, p.z + (i % 2) * 3), p.z + (i % 2) * 3, 'z');
  b.building(p.x + 12, p.z - 6, 4.5, 4.5, { mk: 'concD', roof: 'flat', door: 'w', win: false, stairs: false });
  b.sandbags(p.x - 12, Y(p.x - 12, p.z - 8), p.z - 8, 5, 'x'); b.watchtower(p.x + 14, Y(p.x + 14, p.z + 8), p.z + 8, 6, 2); b.car(p.x, Y(p.x, p.z + 12), p.z + 12, 0.2, 'pGreen');
  loot(b, p.x + 12, p.z - 6, 'ammo'); loot(b, p.x - 10, p.z - 6, 'ammo');
}
function crash(b, p, R) {
  const x = p.x, z = p.z, y = Y(x, z);
  b.zone(p.x, p.z, 30, 30, 2);
  b.geo('pGrey', new THREE.CylinderGeometry(1.2, 0.9, 9, 10), [x, y + 1.4, z], [0.1, 0, PI / 2]);
  b.geo('pGrey', new THREE.BoxGeometry(7, 0.4, 0.5), [x - 8, y + 2.2, z + 0.5], [0, 0.2, 0.2]);
  b.geo('metalD', new THREE.BoxGeometry(0.3, 6, 0.15), [x + 2, y + 4, z], [0, 0, 1.1]);
  addCollider(x, z, 9, y + 2.8, 2.6, { y0: y });
  b.crates(x + 7, Y(x + 7, z + 5), z + 5, 2, 1, 1); b.barrel(x - 6, Y(x - 6, z - 5), z - 5, 'pOrange');
  loot(b, x + 3, z + 4, 'ammo'); loot(b, x - 3, z - 3, 'ammo'); loot(b, x + 7, z + 5, 'health'); loot(b, x - 6, z + 4, 'ammo');
}
function graveyard(b, p, R) {
  b.zone(p.x, p.z, 30, 24, 2);
  fenceRect(b, p.x, p.z, 22, 16);
  for (let i = 0; i < 12; i++) { const x = p.x - 8 + (i % 6) * 3.2, z = p.z - 3 + ((i / 6) | 0) * 5; b.solid('stone', x, Y(x, z), z, 0.7, 1.2, 0.3, { tile: 1, ground: true, nc: false }); }
  b.building(p.x, p.z - 14, 6, 8, { mk: 'concW', roof: 'gable', door: 's', stairs: false });
  loot(b, p.x, p.z - 14, 'health');
}
function ranger(b, p, R) {
  b.zone(p.x, p.z, 36, 30, 2);
  b.building(p.x, p.z, 10, 8, { mk: 'woodR', roof: 'gable', door: 's', stairs: false });
  b.watchtower(p.x + 14, Y(p.x + 14, p.z + 6), p.z + 6, 9, 2); b.fence(p.x - 12, 0, p.z + 10, p.x + 8, p.z + 10);
  loot(b, p.x, p.z, 'ammo'); loot(b, p.x + 14, p.z + 6, 'mats', 9.4);
}
function cellmast(b, p, R) {
  const y = Y(p.x, p.z);
  b.zone(p.x, p.z, 26, 26, 2);
  b.solid('metalD', p.x, y, p.z, 1.0, 34, 1.0, { tile: 1 }); b.box('metalD', p.x, y + 30, p.z, 6, 0.3, 0.3, 1); b.box('metalD', p.x, y + 24, p.z, 4, 0.3, 0.3, 1);
  b.building(p.x + 7, p.z + 5, 4, 4, { mk: 'pGrey', roof: 'flat', door: 'w', win: false, stairs: false });
  fenceRect(b, p.x + 2, p.z + 2, 18, 16);
  loot(b, p.x + 7, p.z + 5, 'ammo');
}
function lighthouse(b, p, R) {
  b.zone(p.x, p.z, 34, 34, 2);
  const y = cyl(b, 'pWhite', p.x, p.z, 2.8, 1.8, 20, 14);
  b.box('pRed', p.x, y + 8, p.z, 4.2, 1.2, 4.2, 1); b.box('lamp', p.x, y + 20, p.z, 2.4, 1.6, 2.4, 1); b.box('roofB', p.x, y + 21.6, p.z, 3.2, 0.4, 3.2, 1);
  b.building(p.x + 10, p.z + 6, 8, 7, { mk: 'woodD', roof: 'gable', door: 's', stairs: false });
  loot(b, p.x + 10, p.z + 6, 'health'); loot(b, p.x + 3, p.z + 4, 'ammo');
}

const BUILD = { power, mine, refinery, prison, hospital, stadium, windfarm, harbor, railyard, observatory, ghost, fuel, supply, clinic, garage, sawmill, mineshaft, dock, windmill, trailer, checkpoint, crash, graveyard, ranger, cellmast, lighthouse };
export const EXTRA_TYPES = new Set(Object.keys(BUILD));

export function buildExtra(b, p, idx) {
  const R = makeRng(9000 + idx * 131);
  b.setRng(R);
  const f = BUILD[p.type];
  if (f) f(b, p, R);
}
