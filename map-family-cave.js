import { CONFIG } from './config.js';
import { Hex, EDGE_DIRECTIONS, hexDistance, isInsideWorld } from './hex.js';
import { createRng } from './rng.js';

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
  for (const heading of EDGE_DIRECTIONS) {
    const neighbor = tiles.get(tileKey(q + heading.q, r + heading.r));
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

    for (let headingIndex = 0; headingIndex < EDGE_DIRECTIONS.length; headingIndex += 1) {
      const heading = EDGE_DIRECTIONS[headingIndex];
      const next = new Hex(current.q + heading.q, current.r + heading.r);
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
      if (typeof lastDir === 'number' && lastDir === headingIndex) weight += 0.18;
      if (typeof lastDir === 'number' && (lastDir + 3) % 6 === headingIndex) weight *= 0.45;
      candidates.push({ next, headingIndex, weight: Math.max(weight, 0.05) });
    }

    const chosen = chooseWeightedCandidate(candidates, rng);
    if (!chosen) break;
    setFloor(tiles, floorKeys, chosen.next.q, chosen.next.r);
    current = chosen.next;
    visitedDirections.push(chosen.headingIndex);
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
  return { q: choice.q, r: choice.r, facing: 0 };
}

function chooseEnemySpawns(tiles, playerStart, rng) {
  const origin = new Hex(playerStart.q, playerStart.r);
  const floors = collectFloorTiles(tiles).filter((tile) => {
    const dist = hexDistance(origin, new Hex(tile.q, tile.r));
    // SPEC §11.3: プレイヤー初期位置から hexDistance >= 5。上限は過密回避のための family 固有値。
    return dist >= 9 && dist <= 22;
  });
  const shuffled = rng.shuffle(floors);
  const count = rng.int(3, 5);
  const [wtMin, wtMax] = CONFIG.enemyKinds.watcher.wtRange;
  const enemies = [];
  for (const tile of shuffled) {
    if (enemies.length >= count) break;
    const pos = new Hex(tile.q, tile.r);
    const tooClose = enemies.some((enemy) => hexDistance(pos, new Hex(enemy.q, enemy.r)) < 6);
    if (tooClose) continue;
    enemies.push({
      id: `g${enemies.length + 1}`,
      kind: 'watcher',
      q: tile.q,
      r: tile.r,
      facing: rng.int(0, 5),
      wt: rng.int(wtMin, wtMax),
    });
  }
  return enemies;
}

function buildSourceCells(tiles, radius) {
  // source cell を直接出力(adapter 非経由)。
  // 洞窟タイル: structureKind='cave', stable, sightH=pass, sightD=block
  // 外側タイル: structureKind=null, blocked, sightH=block, sightD=block
  const cells = [];
  for (const tile of tiles.values()) {
    if (tile.terrain === 'floor') {
      cells.push({
        q: tile.q,
        r: tile.r,
        support: 'stable',
        sightH: 'pass',
        sightD: 'block',
        structureKind: 'cave',
        feature: null,
      });
    } else {
      cells.push({
        q: tile.q,
        r: tile.r,
        support: 'blocked',
        sightH: 'block',
        sightD: 'block',
        structureKind: null,
        feature: null,
      });
    }
  }
  return cells;
}

export function generateCaveMap({ radius = CONFIG.worldRadius, rng = createRng(20260415), params = {} }) {
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
  const cells = buildSourceCells(tiles, radius);

  return {
    radius,
    cells,
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
