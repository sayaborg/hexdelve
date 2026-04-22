import { Hex, EDGE_DIRECTIONS, hexDistance, isInsideWorld } from './hex.js';
import { createRng } from './rng.js';

function tileKey(q, r) {
  return `${q},${r}`;
}

function initRandomTiles(radius, rng, params) {
  const tiles = new Map();
  for (let q = -radius; q <= radius; q += 1) {
    const rMin = Math.max(-radius, -q - radius);
    const rMax = Math.min(radius, -q + radius);
    for (let r = rMin; r <= rMax; r += 1) {
      const ring = Math.max(Math.abs(q), Math.abs(r), Math.abs(-q - r));
      const edgeRatio = ring / Math.max(radius, 1);
      const floorChance = Math.max(0.08, 1 - params.fillProb - edgeRatio * 0.10);
      let terrain = rng.random() < floorChance ? 'floor' : 'wall';
      if (edgeRatio >= 0.94) {
        terrain = 'wall';
      }
      tiles.set(tileKey(q, r), { q, r, terrain });
    }
  }

  const anchor = [[0,0],[1,0],[0,1],[-1,1],[-1,0],[0,-1],[1,-1]];
  for (const [q, r] of anchor) {
    const tile = tiles.get(tileKey(q, r));
    if (tile) tile.terrain = 'floor';
  }
  return tiles;
}

function countWallNeighbors(tiles, q, r, radius) {
  let count = 0;
  for (const heading of EDGE_DIRECTIONS) {
    const nq = q + heading.q;
    const nr = r + heading.r;
    if (!isInsideWorld(new Hex(nq, nr), radius)) {
      count += 1;
      continue;
    }
    const neighbor = tiles.get(tileKey(nq, nr));
    if (!neighbor || neighbor.terrain !== 'floor') {
      count += 1;
    }
  }
  return count;
}

function smoothTiles(tiles, radius, passes) {
  for (let pass = 0; pass < passes; pass += 1) {
    const next = new Map();
    for (const tile of tiles.values()) {
      const wallNeighbors = countWallNeighbors(tiles, tile.q, tile.r, radius);
      let terrain;
      if (tile.terrain === 'wall') {
        terrain = wallNeighbors >= 4 ? 'wall' : 'floor';
      } else {
        terrain = wallNeighbors >= 3 ? 'wall' : 'floor';
      }
      next.set(tileKey(tile.q, tile.r), { q: tile.q, r: tile.r, terrain });
    }
    tiles.clear();
    for (const [key, value] of next.entries()) {
      tiles.set(key, value);
    }
  }
}

function floorComponentFrom(tiles, start) {
  const queue = [start];
  const seen = new Set([start.key()]);
  const out = [];
  while (queue.length) {
    const current = queue.shift();
    out.push(current);
    for (const heading of EDGE_DIRECTIONS) {
      const next = new Hex(current.q + heading.q, current.r + heading.r);
      const tile = tiles.get(next.key());
      if (!tile || tile.terrain !== 'floor') continue;
      const key = next.key();
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push(next);
    }
  }
  return out;
}

function keepLargestFloorRegion(tiles) {
  const visited = new Set();
  let largest = [];
  for (const tile of tiles.values()) {
    if (tile.terrain !== 'floor') continue;
    const key = tileKey(tile.q, tile.r);
    if (visited.has(key)) continue;
    const region = floorComponentFrom(tiles, new Hex(tile.q, tile.r));
    for (const cell of region) visited.add(cell.key());
    if (region.length > largest.length) largest = region;
  }
  const allowed = new Set(largest.map((cell) => cell.key()));
  for (const tile of tiles.values()) {
    if (tile.terrain === 'floor' && !allowed.has(tileKey(tile.q, tile.r))) {
      tile.terrain = 'wall';
    }
  }
}

function carveSoftLoops(tiles, rng, count) {
  const candidates = [];
  for (const tile of tiles.values()) {
    if (tile.terrain !== 'wall') continue;
    let floorNeighbors = 0;
    for (const heading of EDGE_DIRECTIONS) {
      const neighbor = tiles.get(tileKey(tile.q + heading.q, tile.r + heading.r));
      if (neighbor && neighbor.terrain === 'floor') floorNeighbors += 1;
    }
    if (floorNeighbors >= 2 && floorNeighbors <= 3) candidates.push(tile);
  }
  const shuffled = rng.shuffle(candidates);
  for (let i = 0; i < Math.min(count, shuffled.length); i += 1) {
    shuffled[i].terrain = 'floor';
  }
}

function collectFloorTiles(tiles) {
  return [...tiles.values()].filter((tile) => tile.terrain === 'floor');
}

function countFloorNeighbors(tiles, q, r) {
  let count = 0;
  for (const heading of EDGE_DIRECTIONS) {
    const tile = tiles.get(tileKey(q + heading.q, r + heading.r));
    if (tile && tile.terrain === 'floor') count += 1;
  }
  return count;
}

function choosePlayerStart(tiles) {
  const floors = collectFloorTiles(tiles);
  floors.sort((a, b) => {
    const da = Math.max(Math.abs(a.q), Math.abs(a.r), Math.abs(-a.q - a.r));
    const db = Math.max(Math.abs(b.q), Math.abs(b.r), Math.abs(-b.q - b.r));
    return da - db;
  });
  const central = floors.slice(0, Math.max(1, Math.floor(floors.length * 0.20)));
  const spacious = central.filter((tile) => countFloorNeighbors(tiles, tile.q, tile.r) >= 2);
  const choice = spacious[0] ?? central[0] ?? floors[0] ?? { q: 0, r: 0 };
  return { q: choice.q, r: choice.r, facing: 0 };
}

function chooseEnemySpawns(tiles, playerStart, rng) {
  const origin = new Hex(playerStart.q, playerStart.r);
  const floors = collectFloorTiles(tiles).filter((tile) => {
    const dist = hexDistance(origin, new Hex(tile.q, tile.r));
    return dist >= 8 && dist <= 24;
  });
  const shuffled = rng.shuffle(floors);
  const enemies = [];
  for (const tile of shuffled) {
    const pos = new Hex(tile.q, tile.r);
    const tooClose = enemies.some((enemy) => hexDistance(pos, new Hex(enemy.q, enemy.r)) < 6);
    if (tooClose) continue;
    enemies.push({ id: `n${enemies.length + 1}`, name: 'Watcher', q: tile.q, r: tile.r, facing: rng.int(0, 5), profile: 'watcher', wt: 10 + enemies.length });
    if (enemies.length >= 3) break;
  }
  return enemies;
}

function buildFloorSet(tiles) {
  const floor = new Set();
  for (const tile of tiles.values()) {
    if (tile.terrain === 'floor') floor.add(tileKey(tile.q, tile.r));
  }
  return floor;
}

function generateNaturalAttempt(radius, rng, params) {
  const tiles = initRandomTiles(radius, rng, params);
  smoothTiles(tiles, radius, params.smoothPasses);
  keepLargestFloorRegion(tiles);
  carveSoftLoops(tiles, rng, params.loopOpenings);
  keepLargestFloorRegion(tiles);
  return tiles;
}

export function generateNaturalCaveMap({ radius, rng = createRng(20260418), params = {} }) {
  const resolvedParams = { fillProb: params.fillProb ?? 0.49, smoothPasses: params.smoothPasses ?? 5, loopOpenings: params.loopOpenings ?? 2, minFloorCount: params.minFloorCount ?? 300 };
  let bestTiles = null;
  let bestFloorCount = -1;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const tiles = generateNaturalAttempt(radius, rng, resolvedParams);
    const floorCount = collectFloorTiles(tiles).length;
    if (floorCount > bestFloorCount) {
      bestTiles = tiles;
      bestFloorCount = floorCount;
    }
    if (floorCount >= resolvedParams.minFloorCount) {
      bestTiles = tiles;
      break;
    }
  }
  const playerStart = choosePlayerStart(bestTiles);
  const enemies = chooseEnemySpawns(bestTiles, playerStart, rng);
  return { floor: buildFloorSet(bestTiles), playerStart, enemies, meta: { family: 'cave_natural', radius, floorCount: collectFloorTiles(bestTiles).length, params: resolvedParams } };
}
