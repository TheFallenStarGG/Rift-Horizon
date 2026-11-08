/**
 * Builds the contents of each point of interest on top of the shared terrain.
 * Each POI gets its own seeded generator, so results don't depend on build order.
 * Buildings settle themselves onto the ground (see sceneBuild.building), so most calls no longer pass y0.
 */
import * as THREE from 'three';
import { addCollider, addRamp } from './collision.js';
import { heightAt } from './ground.js';
import { makeRng } from './rng.js';
import { ARENA } from './mapLayout.js';

const PI = Math.PI;

function majorTown(b, p, R) {
  const rows = [-54, -22, 12, 44];
  rows.forEach((dz, row) => {
    let x = -108 + R() * 8;
    while (x < 104) {
      const w = 12 + R() * 6, d = 12 + R() * 2;
      const cz = p.z + dz + (R() - 0.5) * 3;
      if (R() < 0.82) {
        const floors = 1 + Math.floor(R() * 3);
        const mk = ['conc', 'concW', 'brick', 'concC'][Math.floor(R() * 4)];
        const roof = floors <= 2 && R() < 0.5 ? 'gable' : 'flat';
        const shop = roof === 'flat' && floors <= 2 && R() < 0.4;
        b.building(p.x + x + w / 2, cz, w, d, { floors, mk, roof, shop, skipRoad: true, door: row < 2 ? 's' : 'n', doorAt: (R() - 0.5) * 4, part: true });
      }
      x += w + 5 + R() * 4;
    }
  });
  for (let x = -104; x <= 104; x += 26) {
    b.lamp(p.x + x, heightAt(p.x + x, p.z - 33), p.z - 33);
    b.lamp(p.x + x + 13, heightAt(p.x + x + 13, p.z + 0), p.z + 0);
  }
  b.car(p.x - 40, heightAt(p.x - 40, p.z - 33), p.z - 33, 0, 'pRed');
  b.car(p.x + 30, heightAt(p.x + 30, p.z - 33), p.z - 33, 0, 'pBlue');
  b.car(p.x - 10, heightAt(p.x - 10, p.z + 11), p.z + 11, PI / 2, 'pGrey');
  b.crates(p.x - 50, heightAt(p.x - 50, p.z + 4), p.z + 4, 2, 1, 2);
  b.jersey(p.x + 60, heightAt(p.x + 60, p.z + 4), p.z + 4, 'x');
  b.sandbags(p.x - 100, heightAt(p.x - 100, p.z + 4), p.z + 4, 4, 'x');
  b.spots.push({ x: p.x - 20, z: p.z + 0, y: heightAt(p.x - 20, p.z) + 0.4 });
  b.spots.push({ x: p.x + 70, z: p.z - 40, y: heightAt(p.x + 70, p.z - 40) + 0.4 });
}

function majorPlaza(b, p, R) {
  b.drape('pad', p.x, p.z, 50, 50, 0.03, 0, 4);
  b.zone(p.x, p.z, 90, 90, 0);
  for (const sx of [-1, 1]) {
    const yy = (x, z) => heightAt(p.x + x, p.z + z);
    b.jersey(p.x + sx * 14, yy(sx * 14, -4), p.z - 4, 'x');
    b.jersey(p.x + sx * 22, yy(sx * 22, 0), p.z, 'z');
    b.sandbags(p.x + sx * 18, yy(sx * 18, 20), p.z + 20, 5, 'x');
    b.crates(p.x + sx * 24, yy(sx * 24, 18), p.z + 18, 2, 2, 1);
    b.lamp(p.x + sx * 22, yy(sx * 22, 34), p.z + 34);
    b.lamp(p.x + sx * 22, yy(sx * 22, -8), p.z - 8);
    b.barrel(p.x + sx * 16, yy(sx * 16, 28), p.z + 28, sx < 0 ? 'pRed' : 'pBlue');
    b.spots.push({ x: p.x + sx * 14, z: p.z + 12, y: yy(sx * 14, 12) + 0.4 });
  }
  const my = heightAt(p.x, p.z + 20);
  b.solid('concD', p.x, my, p.z + 20, 4, 1.0, 4);
  b.solid('stone', p.x, my + 1.0, p.z + 20, 1.2, 6, 1.2);
  b.building(p.x - 38, p.z + 6, 10, 8, { mk: 'concW', door: 'e', stairs: true, shop: true });
  b.building(p.x + 38, p.z + 6, 10, 8, { mk: 'concC', door: 'w', stairs: true, shop: true });
}

function majorIndustrial(b, p, R) {
  const y = (x, z) => heightAt(p.x + x, p.z + z);
  for (const dx of [-30, 30]) b.building(p.x + dx, p.z - 20, 28, 16, { floors: 2, fh: 4.5, mk: 'pGrey', roofMk: 'roofB', door: ['s', 'n'], dw: 5, dh: 3.8, winGap: 5 });
  const cm = ['pRed', 'pBlue', 'pGreen', 'pYellow', 'pGrey', 'pOrange'];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      if (R() < 0.25) continue;
      const x = p.x - 60 + c * 9, z = p.z + 14 + r * 8, m = cm[Math.floor(R() * cm.length)];
      b.container(x, y(x - p.x, z - p.z), z, 'x', m);
      if (R() < 0.35) b.container(x, y(x - p.x, z - p.z), z, 'x', cm[Math.floor(R() * cm.length)], 1);
    }
  }
  for (const [x, z] of [[p.x + 58, p.z - 40], [p.x + 58, p.z - 52], [p.x + 70, p.z - 40], [p.x + 70, p.z - 52]]) b.silo(x, y(x - p.x, z - p.z), z);
  for (const x of [p.x - 10, p.x + 8]) b.solid('pYellow', x, y(x - p.x, 40), p.z + 40, 1.2, 15, 1.2, { tile: 2 });
  b.solid('pYellow', p.x - 1, y(0, 40) + 15, p.z + 40, 22, 1.2, 1.6, { tile: 2 });
  b.car(p.x + 44, y(44, -4), p.z - 4, PI / 2, 'pOrange');
  b.crates(p.x - 44, y(-44, -10), p.z - 10, 2, 2, 2);
  b.jersey(p.x + 6, y(6, -26), p.z - 26, 'x');
  b.spots.push({ x: p.x + 30, z: p.z - 10, y: y(30, -10) + 0.4 });
}

function majorMilitary(b, p, R) {
  const y = (x, z) => heightAt(p.x + x, p.z + z);
  const h = 45;
  b.wallRun('concD', 'x', p.z - h, p.x - h, p.x + h, y(0, -h), 3.6, 1.2, [{ c: p.x, w: 10, lo: 0, hi: 3.6 }], 4);
  b.wallRun('concD', 'x', p.z + h, p.x - h, p.x + h, y(0, h), 3.6, 1.2, [{ c: p.x, w: 10, lo: 0, hi: 3.6 }], 4);
  b.wallRun('concD', 'z', p.x - h, p.z - h, p.z + h, y(-h, 0), 3.6, 1.2, [{ c: p.z, w: 6, lo: 0, hi: 3.6 }], 4);
  b.wallRun('concD', 'z', p.x + h, p.z - h, p.z + h, y(h, 0), 3.6, 1.2, [{ c: p.z, w: 6, lo: 0, hi: 3.6 }], 4);
  b.building(p.x - 24, p.z - 22, 20, 10, { mk: 'concC', roofMk: 'roofB', door: 's', part: true });
  b.building(p.x + 24, p.z - 22, 20, 10, { mk: 'concC', roofMk: 'roofB', door: 's', part: true });
  b.building(p.x - 22, p.z + 18, 30, 20, { mk: 'pGrey', roofMk: 'roofB', fh: 8, door: 's', dw: 8, dh: 6.5, win: false, stairs: false });
  b.building(p.x + 28, p.z + 20, 14, 10, { mk: 'concD', roofMk: 'roofB', t: 0.8, win: false, door: 'w', stairs: true });
  b.drape('hpad', p.x + 26, p.z + 0, 14, 14, 0.04, 0, 4);
  for (const [dx, dz, dir] of [[-41, -41, 2], [41, -41, 0], [-41, 31, 2], [41, 31, 0]]) b.watchtower(p.x + dx, y(dx, dz), p.z + dz, 7, dir);
  b.car(p.x + 12, y(12, -10), p.z - 10, 0, 'pGreen');
  b.car(p.x - 14, y(-14, 8), p.z + 8, PI / 2, 'pGreen');
  b.crates(p.x - 30, y(-30, 0), p.z, 2, 2, 2);
  b.crates(p.x + 36, y(36, -12), p.z - 12, 2, 1, 2);
  b.sandbags(p.x - 8, y(-8, 30), p.z + 30, 4, 'z');
  b.barrel(p.x - 38, y(-38, -15), p.z - 15, 'pRed');
  b.barrel(p.x + 38, y(38, -30), p.z - 30, 'pYellow');
  b.zone(p.x, p.z, 100, 80, 4);
  b.spots.push({ x: p.x, z: p.z + 6, y: y(0, 6) + 0.4 });
}

function majorHillFort(b, p, R) {
  const base = heightAt(p.x, p.z);
  const fx = p.x, fz = p.z;
  b.solid('rock', fx, base, fz, 70, 6, 56, { tile: 4, nc: true, ground: true });
  addRamp(fx, fz + 48, 12, 40, base, base + 6, 3);
  b.wedge('rock', fx, base, fz + 48, 40, 12, 6, 3, 4);
  b.zone(fx, fz, 86, 76, 4); b.zone(fx, fz + 48, 16, 44, 2);
  b.wallRun('stone', 'x', fz - 27.4, fx - 35, fx + 35, base + 6, 2.8, 1.2, [], 4);
  b.wallRun('stone', 'x', fz + 27.4, fx - 35, fx + 35, base + 6, 2.8, 1.2, [{ c: fx, w: 12, lo: 0, hi: 2.8 }], 4);
  b.wallRun('stone', 'z', fx - 34.4, fz - 28, fz + 28, base + 6, 2.8, 1.2, [], 4);
  b.wallRun('stone', 'z', fx + 34.4, fz - 28, fz + 28, base + 6, 2.8, 1.2, [], 4);
  b.building(fx, fz - 2, 16, 14, { floors: 3, y0: base + 6, mk: 'stone', roofMk: 'roofB', door: 's' });
  for (const [x, z, dr] of [[fx - 26, fz - 20, 's'], [fx + 26, fz - 20, 's'], [fx - 26, fz + 20, 'n'], [fx + 26, fz + 20, 'n']]) {
    b.building(x, z, 8, 8, { floors: 2, y0: base + 6, mk: 'stone', roofMk: 'roofB', door: dr, t: 0.35 });
  }
  b.crates(fx - 10, base + 6, fz + 36, 2, 1, 1);
  b.sandbags(fx + 10, base + 6, fz + 36, 4, 'x');
  b.spots.push({ x: fx, z: fz - 2, y: base + 6.4 });
}

function majorLake(b, p, R) {
  const y = (x, z) => heightAt(x, z);
  for (const [dx, dz, dr] of [[-22, -22, 'e'], [8, -32, 's'], [-20, 14, 'e'], [12, 22, 'n'], [30, -4, 'w']]) {
    const x = p.x + dx, z = p.z + dz;
    b.building(x, z, 10, 8, { mk: R() < 0.5 ? 'woodR' : 'woodD', roof: 'gable', door: dr, stairs: false });
  }
  const px = p.x - 40;
  const deckY = heightAt(px, p.z) + 0.15;
  b.solid('woodD', px, deckY, p.z, 40, 0.3, 3, { tile: 2, nc: true });
  for (let k = 0; k < 4; k++) b.box('woodD', px - 18 + k * 12, heightAt(px - 18 + k * 12, p.z + 1.4), p.z + 1.4, 0.3, Math.max(0.2, deckY - heightAt(px - 18 + k * 12, p.z + 1.4)), 0.3, 1);
  b.car(p.x + 2, y(p.x + 2, p.z - 12), p.z - 12, 0, 'pBlue');
  b.spots.push({ x: p.x - 20, z: p.z - 4, y: y(p.x - 20, p.z - 4) + 0.4 });
}

function majorFarm(b, p, R) {
  const y = (x, z) => heightAt(p.x + x, p.z + z);
  b.building(p.x + 24, p.z - 22, 24, 14, { floors: 2, fh: 3.8, mk: 'woodR', roofMk: 'roofB', roof: 'gable', door: 's', dw: 4.5, dh: 3.4, winGap: 5 });
  b.building(p.x - 16, p.z - 30, 12, 10, { floors: 2, mk: 'concW', roof: 'gable', door: 's' });
  b.drape('wheat', p.x - 20, p.z + 16, 28, 30, 0.04, 0, 4);
  b.drape('crop', p.x + 12, p.z + 16, 30, 30, 0.04, 0, 4);
  b.drape('plow', p.x + 42, p.z + 16, 28, 30, 0.04, 0, 4);
  b.drape('crop', p.x + 5, p.z + 58, 60, 14, 0.04, 0, 4);
  b.zone(p.x + 10, p.z + 10, 100, 100, 4);
  b.fence(p.x - 34, y(-34, -2), p.z - 2, p.x - 34, p.z + 32);
  b.fence(p.x - 34, y(-34, 32), p.z + 32, p.x + 56, p.z + 32);
  b.fence(p.x + 56, y(56, 32), p.z + 32, p.x + 56, p.z - 2);
  for (let i = 0; i < 7; i++) {
    const x = p.x + 4 + (i % 4) * 4 + R() * 3, z = p.z - 4 + ((i / 4) | 0) * 3;
    b.geo('hay', new THREE.CylinderGeometry(0.7, 0.7, 1.2, 10), [x, y(x - p.x, z - p.z) + 0.7, z], [0, 0, PI / 2]);
    addCollider(x, z, 1.2, y(x - p.x, z - p.z) + 1.4, 1.4, { y0: y(x - p.x, z - p.z) });
  }
  b.silo(p.x + 46, y(46, -24), p.z - 24, 2.6, 11);
  b.silo(p.x + 52, y(52, -24), p.z - 24, 2.6, 11);
  b.spots.push({ x: p.x + 12, z: p.z - 4, y: y(12, -4) + 0.4 }, { x: p.x - 4, z: p.z + 22, y: y(-4, 22) + 0.4 });
}

function majorRuins(b, p, R) {
  const y = (x, z) => heightAt(p.x + x, p.z + z);
  for (let k = 0; k < 9; k++) {
    const a = (k / 9) * PI * 2, r = 22;
    const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
    const h = 5 + R() * 3;
    b.geo('stone', new THREE.CylinderGeometry(0.9, 1.1, h, 8), [x, y(x - p.x, z - p.z) + h / 2, z]);
    addCollider(x, z, 2.0, y(x - p.x, z - p.z) + h, 2.0, { y0: y(x - p.x, z - p.z) });
  }
  for (let i = 0; i < 8; i++) {
    const a = R() * PI * 2, r = 46 + R() * 22;
    const x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
    b.ruinWall(x, y(x - p.x, z - p.z), z, 3 + R() * 5, R() < 0.5 ? 'x' : 'z');
  }
  for (const [dx, dz] of [[-30, 26], [-10, 34], [-40, 6]]) {
    const x = p.x + dx, z = p.z + dz, yy = y(dx, dz);
    b.wedge('canvas', x - 1.1, yy, z, 2.2, 3.2, 1.9, 0); b.wedge('canvas', x + 1.1, yy, z, 2.2, 3.2, 1.9, 2);
    addCollider(x, z, 4.4, yy + 1.9, 3.2, { y0: yy });
  }
  b.spots.push({ x: p.x - 4, z: p.z - 6, y: y(-4, -6) + 0.4 });
}

function majorQuarry(b, p, R) {
  const y = (x, z) => heightAt(p.x + x, p.z + z);
  b.building(p.x - 20, p.z + 18, 22, 14, { floors: 2, fh: 3.6, mk: 'pGrey', roofMk: 'roofB', door: 'n', win: false });
  for (let i = 0; i < 9; i++) {
    const dx = (R() - 0.5) * 150, dz = (R() - 0.5) * 150;
    if (Math.hypot(dx, dz) < 34) continue;
    const s = 6 + R() * 8, hh = 3 + R() * 6;
    b.solid('rock', p.x + dx, y(dx, dz), p.z + dz, s, hh, s * (0.7 + R() * 0.6), { tile: 5, nc: true, ground: true });
  }
  for (let i = 0; i < 6; i++) {
    const x = p.x + 28 + i * 9, z = p.z - 34;
    b.container(x, y(x - p.x, z - p.z), z, 'x', i % 2 ? 'pOrange' : 'pBlue');
  }
  b.solid('pYellow', p.x + 30, y(30, -4), p.z - 4, 2, 1.2, 14, { tile: 2, ground: true, nc: true });
  b.solid('metalD', p.x + 36, y(36, 2), p.z + 2, 2, 8, 2, { tile: 1, ground: true });
  b.car(p.x - 36, y(-36, 4), p.z + 4, PI / 2, 'pYellow');
  b.car(p.x + 6, y(6, 34), p.z + 34, 0, 'pYellow');
  b.barrel(p.x - 10, y(-10, -12), p.z - 12, 'pOrange');
  b.spots.push({ x: p.x + 10, z: p.z + 6, y: y(10, 6) + 0.4 }, { x: p.x - 40, z: p.z - 20, y: y(-40, -20) + 0.4 });
}

function majorTower(b, p) {
  const y = heightAt(p.x, p.z);
  b.watchtower(p.x, y, p.z, 14, 0);
  b.geo('metalD', new THREE.CylinderGeometry(0.2, 0.3, 26, 8), [p.x, y + 14 + 13, p.z]);
  addCollider(p.x, p.z, 0.5, y + 40, 0.5, { y0: y });
  b.box('lamp', p.x, y + 40.2, p.z, 0.5, 0.4, 0.5, 1);
}

function majorArena(b, p) {
  const ax = p.x, az = p.z, H = ARENA.half, wh = 5, wt = 1.2;
  const y = heightAt(ax, az);
  b.wallRun('concD', 'x', az - H, ax - H, ax + H, y, wh, wt, [{ c: ax, w: 8, lo: 0, hi: wh }], 4);
  b.wallRun('concD', 'x', az + H, ax - H, ax + H, y, wh, wt, [{ c: ax, w: 8, lo: 0, hi: wh }], 4);
  b.wallRun('concD', 'z', ax - H, az - H, az + H, y, wh, wt, [], 4);
  b.wallRun('concD', 'z', ax + H, az - H, az + H, y, wh, wt, [], 4);
  b.drape('pad', ax, az, 2 * H, 2 * H, 0.03, 0, 4);
  b.zone(ax, az, 2 * H + 10, 2 * H + 10, 2);
  b.solid('floor', ax, y + 2.75, az, 12, 0.25, 12);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    b.solid('metalD', ax + sx * 5, y, az + sz * 5, 1, 2.75, 1, { tile: 2 });
    b.solid('conc', ax + sx * 14, y, az + sz * 14, 2, 4, 2, { tile: 3 });
    b.solid('conc', ax + sx * 14, y, az + sz * 6, 6, 1.2, 0.8, { tile: 2 });
    b.solid('conc', ax + sx * 8, y, az + sz * 20, 0.8, 1.2, 6, { tile: 2 });
    b.crates(ax + sx * 20, y, az + sz * 22, 2, 1, 2);
    b.solid('metalD', ax, y + 3.0, az + sz * 5.9, 12, 0.9, 0.15, { tile: 1 });
    b.spots.push({ x: ax + sx * 10, z: az + sz * 10, y: y + 0.4 });
  }
  b.stairs(ax - 11, az, 0, 4, 10, y, 3);
  b.stairs(ax + 11, az, 2, 4, 10, y, 3);
  b.spots.push({ x: ax, z: az, y: y + 3.4 });
}

function majorAirfield(b, p) {
  const y = (x, z) => heightAt(p.x + x, p.z + z);
  b.drape('pad', p.x, p.z, 200, 26, 0.03, 0, 4);
  b.drape('mark', p.x, p.z, 190, 0.4, 0.05, 0, 4);
  b.zone(p.x, p.z, 200, 30, 2);
  b.building(p.x - 60, p.z - 34, 36, 22, { floors: 1, fh: 6, mk: 'pGrey', roofMk: 'roofB', door: 's', dw: 8, dh: 5.6, win: false, stairs: false });
  b.watchtower(p.x + 40, y(40, -34), p.z - 34, 10, 2);
  crashedPlane(b, p, y);
  for (let i = 0; i < 4; i++) b.silo(p.x + 80 + i * 6, y(80 + i * 6, 36), p.z + 36, 3, 10);
  for (let k = 0; k < 5; k++) {
    const x = p.x + 20 + k * 14, z = p.z + 34;
    b.wedge('canvas', x - 1.1, y(20 + k * 14, 34), z, 2.2, 3.2, 1.9, 0); b.wedge('canvas', x + 1.1, y(20 + k * 14, 34), z, 2.2, 3.2, 1.9, 2);
    addCollider(x, z, 3.6, y(20 + k * 14, 34) + 1.7, 2.6, { y0: y(20 + k * 14, 34) });
  }
  b.crates(p.x - 90, y(-90, 8), p.z + 8, 2, 2, 2);
  b.barrel(p.x - 100, y(-100, -6), p.z - 6, 'pRed');
  b.spots.push({ x: p.x - 70, z: p.z + 6, y: y(-70, 6) + 0.4 });
  b.spots.push({ x: p.x + 30, z: p.z - 10, y: y(30, -10) + 0.4 });
}

/** crashed plane on the airfield apron */
function crashedPlane(b, p, y) {
  const x = p.x + 60, z = p.z - 2, yy = y(60, -2);
  b.geo('pWhite', new THREE.CylinderGeometry(1.8, 1.5, 16, 10), [x, yy + 1.8, z], [0, 0, PI / 2]);
  b.box('pWhite', x + 2, yy + 1.4, z, 3, 0.25, 20, 2);
  b.box('pWhite', x + 8, yy + 2.2, z, 1.4, 3.2, 0.25, 2);
  addCollider(x, z, 14, yy + 3.2, 3.0, { y0: yy });
}

function majorLodge(b, p) {
  const y = heightAt(p.x, p.z);
  b.building(p.x, p.z, 18, 14, { floors: 2, fh: 3.4, mk: 'woodR', roof: 'gable', door: 's' });
  b.solid('woodD', p.x, y, p.z + 12, 30, 0.3, 6, { tile: 2 });
  b.car(p.x - 20, heightAt(p.x - 20, p.z + 4), p.z + 4, PI / 2, 'pBlue');
  b.crates(p.x + 20, heightAt(p.x + 20, p.z), p.z, 2, 2, 1);
  b.watchtower(p.x - 24, heightAt(p.x - 24, p.z - 24), p.z - 24, 6, 0);
  b.spots.push({ x: p.x + 4, z: p.z - 22, y: heightAt(p.x + 4, p.z - 22) + 0.4 });
}

function majorCamp(b, p) {
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * PI * 2, x = p.x + Math.cos(a) * 26, z = p.z + Math.sin(a) * 26, yy = heightAt(x, z);
    b.wedge('canvas', x - 1.1, yy, z, 2.2, 3.2, 1.9, 0); b.wedge('canvas', x + 1.1, yy, z, 2.2, 3.2, 1.9, 2);
    addCollider(x, z, 4.4, yy + 1.9, 3.2, { y0: yy });
    b.spots.push({ x: x * 0.6 + p.x * 0.4, z: z * 0.6 + p.z * 0.4, y: heightAt(x * 0.6 + p.x * 0.4, z * 0.6 + p.z * 0.4) + 0.4 });
  }
  const cy = heightAt(p.x, p.z);
  b.barrel(p.x, cy, p.z, 'pOrange');
  b.crates(p.x + 6, cy, p.z + 6, 2, 1, 2);
  b.jersey(p.x - 6, cy, p.z - 6, 'x');
}

function minorBuilding(b, p, R, kind) {
  const y = heightAt(p.x, p.z);
  const at = (dx, dz) => heightAt(p.x + dx, p.z + dz);
  switch (kind) {
    case 'farm':
      b.building(p.x, p.z, 14, 10, { floors: 1, mk: 'woodR', roof: 'gable', door: 's', skipRoad: true });
      b.silo(p.x + 14, at(14, -6), p.z - 6, 2.4, 9);
      b.fence(p.x - 12, at(-12, 10), p.z + 10, p.x + 12, p.z + 10);
      break;
    case 'cabin':
      b.building(p.x, p.z, 10, 8, { mk: 'woodD', roof: 'gable', door: 's', stairs: false, skipRoad: true });
      b.crates(p.x + 8, at(8, 4), p.z + 4, 1, 2, 1);
      break;
    case 'camp':
      for (let i = 0; i < 3; i++) {
        const x = p.x - 8 + i * 8, z = p.z + (i % 2) * 5 - 2, yy = at(x - p.x, z - p.z);
        b.wedge('canvas', x - 1.1, yy, z, 2.2, 3.2, 1.9, 0); b.wedge('canvas', x + 1.1, yy, z, 2.2, 3.2, 1.9, 2);
        addCollider(x, z, 4.4, yy + 1.9, 3.2, { y0: yy });
      }
      b.crates(p.x + 10, at(10, 8), p.z + 8, 2, 1, 1);
      break;
    case 'shack':
      b.building(p.x, p.z, 7, 6, { mk: 'concD', roof: 'shed', door: 'n', win: false, stairs: false, skipRoad: true });
      break;
    case 'gas':
      b.solid('metalD', p.x, at(0, -2), p.z - 2, 0.3, 0.3, 0.3, { tile: 1 });
      b.box('pRed', p.x, at(0, 0) + 3.6, p.z, 8, 0.4, 6, 2);
      for (const sx of [-1, 1]) b.solid('metalD', p.x + sx * 3, at(sx * 3, 0), p.z, 0.3, 3.6, 0.3, { tile: 1 });
      b.solid('pGrey', p.x - 2, at(-2, 0), p.z + 2, 0.9, 1.4, 0.9, { tile: 1 });
      b.car(p.x + 4, at(4, 8), p.z + 8, 0, 'pYellow');
      b.barrel(p.x - 5, at(-5, -4), p.z - 4, 'pRed');
      break;
    case 'lookout':
      b.watchtower(p.x, y, p.z, 8, Math.floor(R() * 4));
      break;
    case 'church':
      b.building(p.x, p.z, 12, 10, { mk: 'conc', roof: 'gable', door: 's', skipRoad: true });
      b.geo('roofB', new THREE.ConeGeometry(3, 8, 4), [p.x, y + 4 + 3.2, p.z - 3], [0, PI / 4, 0]);
      break;
    case 'bunker':
      b.building(p.x, p.z, 10, 10, { mk: 'concD', roofMk: 'concD', door: 's', win: false, stairs: false, parapet: false, skipRoad: true });
      break;
    case 'radio':
      b.watchtower(p.x, y, p.z, 9, 0);
      b.geo('metalD', new THREE.CylinderGeometry(0.2, 0.3, 14, 8), [p.x, y + 9 + 7, p.z]);
      addCollider(p.x, p.z, 0.5, y + 22, 0.5, { y0: y });
      break;
    case 'ruin':
      for (let i = 0; i < 3; i++) {
        const dx = (i - 1) * 9 + (R() - 0.5) * 2, dz = (R() - 0.5) * 6;
        b.ruinWall(p.x + dx, at(dx, dz), p.z + dz, 4 + R() * 4, R() < 0.5 ? 'x' : 'z');
      }
      break;
    default:
      break;
  }
  b.spots.push({ x: p.x + 2, z: p.z + 2, y: at(2, 2) + 0.4 });
}


function majorJumpPark(b, p, R) {
  const y = (dx, dz) => heightAt(p.x + dx, p.z + dz);
  // wide concrete apron
  b.solid('concD', p.x, y(0, 0), p.z, 90, 0.35, 90, { tile: 5, ground: true, nc: true });
  b.zone(p.x, p.z, 100, 100, 5);
  // Four big approach ramps into the center (dir: 0 +x, 1 +z, 2 -x, 3 -z)
  const arms = [
    [0, -32, 0, 14, 28, 9],
    [2, 32, 0, 14, 28, 9],
    [1, 0, -32, 14, 28, 9],
    [3, 0, 32, 14, 28, 9],
  ];
  for (const [dir, ox, oz, w, len, rise] of arms) {
    b.stairs(p.x + ox, p.z + oz, dir, w, len, y(ox, oz), rise, 'concD');
  }
  // High kickers in the corners
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI * 0.5 + Math.PI * 0.25;
    const ox = Math.cos(a) * 40, oz = Math.sin(a) * 40;
    b.stairs(p.x + ox, p.z + oz, i % 4, 10, 20, y(ox, oz), 11, 'metalD');
  }
  // Spine ramps for chain jumps
  for (const [ox, oz, dir] of [[-12, 12, 0], [12, -12, 2], [-12, -12, 1], [12, 12, 3]]) {
    b.stairs(p.x + ox, p.z + oz, dir, 8, 14, y(ox, oz) + 0.2, 5.5, 'conc');
  }
  // Barriers / jersey walls along edges so you don't yeet into the void immediately
  for (let i = -3; i <= 3; i++) {
    b.jersey(p.x + i * 8, y(i * 8, -48), p.z - 48, 'x');
    b.jersey(p.x + i * 8, y(i * 8, 48), p.z + 48, 'x');
  }
  b.spots.push(
    { x: p.x, z: p.z, y: y(0, 0) + 0.5 },
    { x: p.x + 20, z: p.z, y: y(20, 0) + 0.5 },
    { x: p.x - 20, z: p.z, y: y(-20, 0) + 0.5 },
  );
}

/** Builds one POI. idx keeps each POI's random sequence independent. */
export function buildPoi(b, p, idx) {
  const R = makeRng(9000 + idx * 131);
  b.setRng(R);
  if (p.tier !== 'major') { minorBuilding(b, p, R, p.type); return; }
  switch (p.type) {
    case 'plaza': majorPlaza(b, p, R); break;
    case 'town': majorTown(b, p, R); break;
    case 'industrial': majorIndustrial(b, p, R); break;
    case 'military': majorMilitary(b, p, R); break;
    case 'hillfort': majorHillFort(b, p, R); break;
    case 'lake': majorLake(b, p, R); break;
    case 'farm': majorFarm(b, p, R); break;
    case 'ruins': majorRuins(b, p, R); break;
    case 'quarry': majorQuarry(b, p, R); break;
    case 'tower': majorTower(b, p); break;
    case 'arena': majorArena(b, p); break;
    case 'airfield': majorAirfield(b, p); break;
    case 'lodge': majorLodge(b, p); break;
    case 'camp': majorCamp(b, p); break;
    case 'jumps': majorJumpPark(b, p, R); break;
    default: break;
  }
}
