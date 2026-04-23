import { CONFIG } from './config.js';
import { Hex, EDGE_DIRECTIONS, cubeRound, hexDistance, isInsideWorld, oppositeHeading } from './hex.js';
import { createRng } from './rng.js';

function tileKey(q, r) {
  return `${q},${r}`;
}

// 最大の floor 連結成分を BFS で抽出する(map-family-cave.js と同一ロジック、
// 階段強制配置後の連結性保証用)。
function findMainFloorComponent(tiles) {
  const visited = new Set();
  let largest = [];
  for (const tile of tiles.values()) {
    if (tile.terrain !== 'floor') continue;
    const startKey = tileKey(tile.q, tile.r);
    if (visited.has(startKey)) continue;
    const component = [];
    const queue = [tile];
    visited.add(startKey);
    while (queue.length) {
      const cur = queue.shift();
      component.push(cur);
      for (const h of EDGE_DIRECTIONS) {
        const nk = tileKey(cur.q + h.q, cur.r + h.r);
        if (visited.has(nk)) continue;
        const nb = tiles.get(nk);
        if (!nb || nb.terrain !== 'floor') continue;
        visited.add(nk);
        queue.push(nb);
      }
    }
    if (component.length > largest.length) largest = component;
  }
  return largest;
}

function hexLine(a, b) {
  const N = hexDistance(a, b);
  const line = [];
  for (let i = 0; i <= N; i += 1) {
    const t = N === 0 ? 0 : i / N;
    const qf = a.q + (b.q - a.q) * t;
    const rf = a.r + (b.r - a.r) * t;
    line.push(cubeRound(qf, rf));
  }
  return line;
}

function carveCorridorToMainComponent(tiles, stairsHex, spawnHex) {
  const main = findMainFloorComponent(tiles);
  const mainSet = new Set(main.map((t) => tileKey(t.q, t.r)));
  const stairsKey = tileKey(stairsHex.q, stairsHex.r);

  if (mainSet.has(stairsKey) && (!spawnHex || mainSet.has(tileKey(spawnHex.q, spawnHex.r)))) {
    return;
  }
  if (!main.length) return;

  let nearest = null;
  let nearestDist = Infinity;
  for (const t of main) {
    const d = hexDistance(stairsHex, new Hex(t.q, t.r));
    if (d < nearestDist) {
      nearestDist = d;
      nearest = t;
    }
  }
  if (!nearest) return;

  for (const step of hexLine(stairsHex, new Hex(nearest.q, nearest.r))) {
    if (!isInsideWorld(step, CONFIG.worldRadius)) continue;
    const t = tiles.get(tileKey(step.q, step.r));
    if (t) t.terrain = 'floor';
  }
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

function chooseEnemySpawns(tiles, playerStart, rng, stairsInfo = null) {
  const origin = new Hex(playerStart.q, playerStart.r);
  const floors = collectFloorTiles(tiles).filter((tile) => {
    if (stairsInfo && tile.q === stairsInfo.q && tile.r === stairsInfo.r) return false;
    const dist = hexDistance(origin, new Hex(tile.q, tile.r));
    // SPEC §11.3: プレイヤー初期位置から hexDistance >= 5。
    // 上限 24 は cave_natural family の過密回避のための family 固有値。
    return dist >= 5 && dist <= 24;
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
      id: `e${enemies.length + 1}`,
      kind: 'watcher',
      q: tile.q,
      r: tile.r,
      facing: rng.int(0, 5),
      wt: rng.int(wtMin, wtMax),
    });
  }
  return enemies;
}

function buildSourceCells(tiles, stairsInfo) {
  const cells = [];
  for (const tile of tiles.values()) {
    if (tile.terrain === 'floor') {
      const isStairs = stairsInfo && tile.q === stairsInfo.q && tile.r === stairsInfo.r;
      cells.push({
        q: tile.q,
        r: tile.r,
        support: 'stable',
        sightH: 'pass',
        sightD: 'block',
        structureKind: 'cave',
        feature: isStairs ? {
          kind: 'stairs',
          state: 'normal',
          params: {
            enterHeading: stairsInfo.enterHeading,
            exitHeading: stairsInfo.exitHeading,
            verticalMode: stairsInfo.verticalMode,
          },
        } : null,
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

function placeStairsForNaturalCave(tiles, playerStart, stairsConstraint, rng) {
  if (stairsConstraint) {
    const key = tileKey(stairsConstraint.q, stairsConstraint.r);
    const tile = tiles.get(key);
    if (tile) tile.terrain = 'floor';
    // プレイヤー spawn 側 = opposite(enterHeading) 方向隣接も floor 化
    const spawnOff = EDGE_DIRECTIONS[oppositeHeading(stairsConstraint.enterHeading)];
    const spawnHex = new Hex(stairsConstraint.q + spawnOff.q, stairsConstraint.r + spawnOff.r);
    const neighbor = tiles.get(tileKey(spawnHex.q, spawnHex.r));
    if (neighbor) neighbor.terrain = 'floor';
    // 連結性保証(設計判断: 強制 floor 化した階段がメイン洞窟から孤立しないよう line で掘る)
    carveCorridorToMainComponent(
      tiles,
      new Hex(stairsConstraint.q, stairsConstraint.r),
      spawnHex,
    );
    return {
      q: stairsConstraint.q,
      r: stairsConstraint.r,
      enterHeading: stairsConstraint.enterHeading,
      exitHeading: stairsConstraint.enterHeading,
      verticalMode: stairsConstraint.verticalMode,
    };
  }
  const origin = new Hex(playerStart.q, playerStart.r);
  const floors = collectFloorTiles(tiles).filter((t) => {
    const d = hexDistance(origin, new Hex(t.q, t.r));
    return d >= 5 && d <= 15;
  });
  for (const tile of rng.shuffle(floors)) {
    const walkableHeadings = [];
    for (let h = 0; h < 6; h += 1) {
      const off = EDGE_DIRECTIONS[h];
      const n = tiles.get(tileKey(tile.q + off.q, tile.r + off.r));
      if (n && n.terrain === 'floor') walkableHeadings.push(h);
    }
    if (walkableHeadings.length === 0) continue;
    const enterHeading = rng.pick(walkableHeadings);
    return {
      q: tile.q,
      r: tile.r,
      enterHeading,
      exitHeading: enterHeading,
      verticalMode: rng.chance(0.5) ? 'up' : 'down',
    };
  }
  return {
    q: playerStart.q,
    r: playerStart.r,
    enterHeading: 0,
    exitHeading: 0,
    verticalMode: 'down',
  };
}

function generateNaturalAttempt(radius, rng, params) {
  const tiles = initRandomTiles(radius, rng, params);
  smoothTiles(tiles, radius, params.smoothPasses);
  keepLargestFloorRegion(tiles);
  carveSoftLoops(tiles, rng, params.loopOpenings);
  keepLargestFloorRegion(tiles);
  return tiles;
}

export function generateNaturalCaveMap({ radius = CONFIG.worldRadius, rng = createRng(20260418), params = {}, stairsConstraint = null }) {
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

  let playerStart;
  let stairsInfo;
  if (stairsConstraint) {
    stairsInfo = placeStairsForNaturalCave(bestTiles, { q: 0, r: 0 }, stairsConstraint, rng);
    // 遷移時配置(SPEC §9.9): 階段の opposite(enterHeading) 方向隣接、
    // facing = 旧 exitHeading = opposite(新 enterHeading)。
    const spawnHeading = oppositeHeading(stairsInfo.enterHeading);
    const off = EDGE_DIRECTIONS[spawnHeading];
    playerStart = { q: stairsInfo.q + off.q, r: stairsInfo.r + off.r, facing: spawnHeading };
  } else {
    playerStart = choosePlayerStart(bestTiles);
    stairsInfo = placeStairsForNaturalCave(bestTiles, playerStart, null, rng);
  }

  const enemies = chooseEnemySpawns(bestTiles, playerStart, rng, stairsInfo);
  const cells = buildSourceCells(bestTiles, stairsInfo);
  return {
    radius,
    cells,
    playerStart,
    enemies,
    stairs: stairsInfo,
    meta: { family: 'cave_natural', radius, floorCount: collectFloorTiles(bestTiles).length, params: resolvedParams },
  };
}
