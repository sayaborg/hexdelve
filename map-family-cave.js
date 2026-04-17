import { Hex, DIRECTIONS, hexDistance, isInsideWorld } from './hex.js';

function tileKey(q, r) {
  return `${q},${r}`;
}

function initWallTiles(radius) {
  const tiles = new Map();
  for (let q = -radius; q <= radius; q += 1) {
    const rMin = Math.max(-radius, -q - radius);
    const rMax = Math.min(radius, -q + radius);
    for (let r = rMin; r <= rMax; r += 1) {
      tiles.set(tileKey(q, r), { q, r, terrain: 'wall' });
    }
  }
  return tiles;
}

function countFloorNeighbors(tiles, q, r) {
  let count = 0;
  for (const dir of DIRECTIONS) {
    const neighbor = tiles.get(tileKey(q + dir.q, r + dir.r));
    if (neighbor && neighbor.terrain === 'floor') count += 1;
  }
  return count;
}

function collectFloorTiles(tiles) {
  return [...tiles.values()].filter((tile) => tile.terrain === 'floor');
}

function setFloor(tiles, floorKeys, q, r) {
  const key = tileKey(q, r);
  const tile = tiles.get(key);
  if (!tile || tile.terrain === 'floor') return false;
  tile.terrain = 'floor';
  floorKeys.push(key);
  return true;
}

function chooseWeightedCandidate(candidates, rng) {
  if (!candidates.length) return null;
  let total = 0;
  for (const entry of candidates) {
    total += entry.weight;
  }
  let pick = rng.random() * total;
  for (const entry of candidates) {
    pick -= entry.weight;
    if (pick <= 0) return entry;
  }
  return candidates[candidates.length - 1];
}

function carveConnectedSkeleton(tiles, center, rng, params, radius) {
  const floorTarget = Math.max(30, Math.floor(tiles.size * params.floorRate));
  const floorKeys = [];
  const visitedDirections = [];
  let current = new Hex(center.q, center.r);

  setFloor(tiles, floorKeys, current.q, current.r);

  while (floorKeys.length < floorTarget) {
    const candidates = [];

    for (let dirIndex = 0; dirIndex < DIRECTIONS.length; dirIndex += 1) {
      const dir = DIRECTIONS[dirIndex];
      const next = new Hex(current.q + dir.q, current.r + dir.r);
      if (!isInsideWorld(next, radius)) continue;
      const key = next.key();
      const tile = tiles.get(key);
      if (!tile) continue;

      let weight = tile.terrain === 'wall' ? 1.7 : 0.35;
      const floorNeighbors = countFloorNeighbors(tiles, next.q, next.r);
      if (floorNeighbors <= 1) weight += 0.55;
      if (floorNeighbors === 2) weight -= 0.28;
      if (floorNeighbors === 3) weight *= 0.32;
      if (floorNeighbors >= 4) continue;
      const edgeDistance = Math.max(Math.abs(next.q), Math.abs(next.r), Math.abs(-next.q - next.r));
      const edgeRatio = edgeDistance / Math.max(radius, 1);
      if (edgeRatio > 0.82) weight *= 0.72;
      const lastDir = visitedDirections[visitedDirections.length - 1];
      if (typeof lastDir === 'number' && lastDir === dirIndex) weight += 0.18;
      if (typeof lastDir === 'number' && (lastDir + 3) % 6 === dirIndex) weight *= 0.45;
      candidates.push({ next, dirIndex, weight: Math.max(weight, 0.05) });
    }

    const chosen = chooseWeightedCandidate(candidates, rng);
    if (!chosen) break;
    setFloor(tiles, floorKeys, chosen.next.q, chosen.next.r);
    current = chosen.next;
    visitedDirections.push(chosen.dirIndex);
    if (visitedDirections.length > 8) visitedDirections.shift();

    if (rng.chance(0.10) && floorKeys.length > 20) {
      const jumpKey = rng.pick(floorKeys);
      const jumpTile = tiles.get(jumpKey);
      if (jumpTile) current = new Hex(jumpTile.q, jumpTile.r);
    }
  }
}

function addBulges(tiles, rng) {
  const toFloor = [];
  for (const tile of tiles.values()) {
    if (tile.terrain !== 'wall') continue;
    const neighbors = countFloorNeighbors(tiles, tile.q, tile.r);
    if (neighbors >= 3 && rng.chance(0.14)) {
      toFloor.push(tile);
    } else if (neighbors >= 2 && rng.chance(0.04)) {
      toFloor.push(tile);
    }
  }
  for (const tile of toFloor) {
    tile.terrain = 'floor';
  }
}

function addLoops(tiles, rng, params) {
  const candidates = [];
  for (const tile of tiles.values()) {
    if (tile.terrain !== 'wall') continue;
    const floorNeighbors = countFloorNeighbors(tiles, tile.q, tile.r);
    if (floorNeighbors >= 2 && floorNeighbors <= 3) {
      candidates.push(tile);
    }
  }
  const shuffled = rng.shuffle(candidates);
  const openCount = Math.floor(shuffled.length * params.loopiness * 0.12);
  for (let i = 0; i < openCount; i += 1) {
    shuffled[i].terrain = 'floor';
  }
}

function choosePlayerStart(tiles) {
  const floors = collectFloorTiles(tiles);
  floors.sort((a, b) => {
    const da = Math.max(Math.abs(a.q), Math.abs(a.r), Math.abs(-a.q - a.r));
    const db = Math.max(Math.abs(b.q), Math.abs(b.r), Math.abs(-b.q - b.r));
    return da - db;
  });
  const bucket = floors.slice(0, Math.max(1, Math.floor(floors.length * 0.18)));
  const spacious = bucket.filter((tile) => countFloorNeighbors(tiles, tile.q, tile.r) >= 2);
  const choice = spacious[0] ?? bucket[0] ?? floors[0] ?? { q: 0, r: 0 };
  return { q: choice.q, r: choice.r, facing: 2 };
}

function chooseEnemySpawns(tiles, playerStart, rng) {
  const origin = new Hex(playerStart.q, playerStart.r);
  const floors = collectFloorTiles(tiles).filter((tile) => {
    const dist = hexDistance(origin, new Hex(tile.q, tile.r));
    return dist >= 9 && dist <= 22;
  });
  const shuffled = rng.shuffle(floors);
  const enemies = [];
  for (const tile of shuffled) {
    const pos = new Hex(tile.q, tile.r);
    const tooClose = enemies.some((enemy) => hexDistance(pos, new Hex(enemy.q, enemy.r)) < 6);
    if (tooClose) continue;
    enemies.push({
      id: `g${enemies.length + 1}`,
      name: 'Watcher',
      q: tile.q,
      r: tile.r,
      facing: rng.int(0, 5),
      profile: 'watcher',
      wt: 10 + enemies.length,
    });
    if (enemies.length >= 3) break;
  }
  return enemies;
}

function buildFloorSet(tiles) {
  const floor = new Set();
  for (const tile of tiles.values()) {
    if (tile.terrain === 'floor') {
      floor.add(tileKey(tile.q, tile.r));
    }
  }
  return floor;
}

export function generateCaveMap({ radius, rng, params = {} }) {
  const resolvedParams = {
    floorRate: params.floorRate ?? 0.36,
    loopiness: params.loopiness ?? 0.14,
    chokeDensity: params.chokeDensity ?? 0.30,
  };

  const tiles = initWallTiles(radius);
  const center = { q: 0, r: 0 };
  carveConnectedSkeleton(tiles, center, rng, resolvedParams, radius);
  addBulges(tiles, rng);
  addLoops(tiles, rng, resolvedParams);

  const playerStart = choosePlayerStart(tiles);
  const enemies = chooseEnemySpawns(tiles, playerStart, rng);

  return {
    floor: buildFloorSet(tiles),
    playerStart,
    enemies,
    meta: {
      family: 'cave',
      radius,
      floorCount: collectFloorTiles(tiles).length,
      params: resolvedParams,
    },
  };
}
