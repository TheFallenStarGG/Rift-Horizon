/**
 * Point-of-interest layout for the whole map. Deterministic: every client places the same POIs.
 * Major POIs are hand-placed landmarks; minor POIs are scattered across the land by a seeded generator.
 */
import { makeRng } from './rng.js';
import { MAP_HALF, WATER_Y, LAKE, naturalHeight } from './terrain.js';

export const ARENA = { x: 420, z: 430, half: 32 };

const MAJOR = [
  { name: 'Crossroads', type: 'plaza', x: 0, z: 0, r: 60 },
  { name: 'Port Haven', type: 'town', x: -170, z: -90, r: 150 },
  { name: 'Iron Works', type: 'industrial', x: 230, z: -150, r: 130 },
  { name: 'Fort Keller', type: 'military', x: 0, z: -430, r: 120 },
  { name: 'Hill Fort', type: 'hillfort', x: 560, z: -330, r: 90 },
  { name: 'Lakeside', type: 'lake', x: LAKE.x + LAKE.rx + 40, z: LAKE.z, r: 100 },
  { name: 'Green Acres', type: 'farm', x: 400, z: 140, r: 130 },
  { name: 'Standing Stones', type: 'ruins', x: -330, z: 430, r: 100 },
  { name: 'Sky Tower', type: 'tower', x: -700, z: -450, r: 40 },
  { name: 'Granite Quarry', type: 'quarry', x: 760, z: 80, r: 100 },
  { name: 'The Pit', type: 'arena', x: ARENA.x, z: ARENA.z, r: 44 },
  { name: 'Mercy Airfield', type: 'airfield', x: -120, z: 560, r: 150 },
  { name: 'Summit Lodge', type: 'lodge', x: -740, z: 640, r: 60 },
  { name: 'Ridgeback Camp', type: 'camp', x: 640, z: 560, r: 70 },
  { name: 'Asphalt Angels', type: 'jumps', x: -420, z: -520, r: 95 },
];

const MINOR_TYPES = ['farm', 'cabin', 'camp', 'shack', 'gas', 'lookout', 'church', 'bunker', 'radio', 'ruin'];
const MINOR_COUNT = 90;

function buildPois() {
  const pois = MAJOR.map((m, i) => ({ id: 'M' + i, tier: 'major', ...m }));
  const R = makeRng(7331);
  const far = (x, z, r) => pois.every((p) => Math.hypot(p.x - x, p.z - z) > p.r + r + 30);
  let placed = 0;
  for (let tries = 0; tries < 9000 && placed < MINOR_COUNT; tries++) {
    const x = (R() * 2 - 1) * (MAP_HALF - 60), z = (R() * 2 - 1) * (MAP_HALF - 60);
    const r = 18 + R() * 8;
    const h = naturalHeight(x, z);
    if (h < WATER_Y + 1.5 || h > 120) continue;
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.rx + 40) continue;
    if (!far(x, z, r)) continue;
    const type = MINOR_TYPES[placed % MINOR_TYPES.length];
    pois.push({ id: 'm' + placed, name: type, tier: 'minor', type, x, z, r });
    placed++;
  }
  return pois;
}

export const POIS = buildPois();

/** Roads join the major POIs in a loop plus a few cross links, so every landmark is reachable. */
export const ROADS = [
  [0, 1], [0, 2], [0, 6], [1, 7], [2, 4], [3, 2], [3, 1], [5, 1], [6, 10], [6, 9], [9, 4], [11, 3], [11, 7], [12, 8], [8, 11], [13, 1], [14, 3], [14, 0],
];
