import { CONFIG } from './config.js';
import { Hex, EDGE_DIRECTIONS, cubeRound, hexDistance, isInsideWorld, oppositeHeading } from './hex.js';
import { createRng } from './rng.js';
import { selectEnemiesWithMinDistanceRelaxation } from './map-spawn.js';

function tileKey(q, r) {
  return `${q},${r}`;
}

// 最大の floor 連結成分を BFS で抽出する。
// stairsConstraint で強制配置した階段がメイン成分から切り離されている場合の
// 連結性保証(設計判断 D2 の副産物、STATUS の既知制約を v0 で解消)。
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

// hex 上の 2 点を結ぶ直線経路(端点含む)。
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

// 階段タイル(および必要なら spawn 隣接)がメイン連結成分に含まれない場合、
// メイン成分の最寄りタイルまで hex line で wall を floor に掘って連結を保証する。
function carveCorridorToMainComponent(tiles, stairsHex, spawnHex) {
  const main = findMainFloorComponent(tiles);
  const mainSet = new Set(main.map((t) => tileKey(t.q, t.r)));
  const stairsKey = tileKey(stairsHex.q, stairsHex.r);

  // 階段とその spawn 隣接の両方が既にメイン成分にあれば何もしない
  if (mainSet.has(stairsKey) && (!spawnHex || mainSet.has(tileKey(spawnHex.q, spawnHex.r)))) {
    return;
  }
  if (!main.length) return;  // メイン成分が空(ほぼあり得ない)

  // 階段から最も近いメイン成分タイルを探す
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

  // 経路上のタイルを floor 化(world 内のみ)
  for (const step of hexLine(stairsHex, new Hex(nearest.q, nearest.r))) {
    if (!isInsideWorld(step, CONFIG.worldRadius)) continue;
    const t = tiles.get(tileKey(step.q, step.r));
    if (t) t.terrain = 'floor';
  }
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

function chooseEnemySpawns(tiles, playerStart, rng, stairsInfo = null) {
  // 仕様(SPEC §11.3): 3〜5 体、プレイヤー初期位置から hexDistance >= 5、
  // 敵同士 hexDistance >= 6(段階的緩和つき、CHANGELOG フェーズ 49)。
  const origin = new Hex(playerStart.q, playerStart.r);
  const floors = collectFloorTiles(tiles).filter((tile) => {
    if (stairsInfo && tile.q === stairsInfo.q && tile.r === stairsInfo.r) return false;
    const dist = hexDistance(origin, new Hex(tile.q, tile.r));
    // SPEC §11.3: プレイヤー初期位置から hexDistance >= 5。
    // 上限 22 は cave family の過密回避のための family 固有値(SPEC §11.3)。
    return dist >= 5 && dist <= 22;
  });
  // shuffle 結果を緩和ループの全段階で再利用(SPEC §11.3 の「配置順の決定論」規約)。
  const orderedCandidates = rng.shuffle(floors).map((tile) => ({ q: tile.q, r: tile.r }));
  const count = rng.int(3, 5);
  const [wtMin, wtMax] = CONFIG.enemyKinds.watcher.wtRange;
  const chosen = selectEnemiesWithMinDistanceRelaxation(orderedCandidates, count);
  return chosen.map((cell, idx) => ({
    id: `e${idx + 1}`,
    kind: 'watcher',
    q: cell.q,
    r: cell.r,
    facing: rng.int(0, 5),
    wt: rng.int(wtMin, wtMax),
  }));
}

function buildSourceCells(tiles, radius, stairsInfo) {
  // source cell を直接出力(adapter 非経由)。
  // 洞窟タイル: structureKind='cave', stable, sightH=pass, sightD=block
  // 外側タイル: structureKind=null, blocked, sightH=block, sightD=block
  // 階段タイル: 上記洞窟タイルに feature.kind='stairs' を重ねる
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

// 階段の (q, r) / enterHeading / verticalMode を決定する(SPEC §12.5)。
// stairsConstraint があればそれに従う。なければ: player から離れた floor で、
// 歩行可能な隣接タイルを持つものをランダム選択。
function placeStairsForCave(tiles, playerStart, stairsConstraint, rng) {
  if (stairsConstraint) {
    // フロア遷移時の対応階段契約: 指定位置を強制で floor にし、プレイヤーが spawn する
    // opposite(enterHeading) 方向隣接も floor 化(そこに spawn するため)。
    const key = tileKey(stairsConstraint.q, stairsConstraint.r);
    let tile = tiles.get(key);
    if (tile) tile.terrain = 'floor';
    const spawnOffset = EDGE_DIRECTIONS[oppositeHeading(stairsConstraint.enterHeading)];
    const spawnKey = tileKey(stairsConstraint.q + spawnOffset.q, stairsConstraint.r + spawnOffset.r);
    const spawnNeighbor = tiles.get(spawnKey);
    if (spawnNeighbor) spawnNeighbor.terrain = 'floor';
    // 連結性保証: 強制 floor 化した階段/spawn がメイン洞窟から孤立する可能性があるため、
    // 必要なら最寄りメインタイルまで line で掘って接続する。
    carveCorridorToMainComponent(
      tiles,
      new Hex(stairsConstraint.q, stairsConstraint.r),
      new Hex(stairsConstraint.q + spawnOffset.q, stairsConstraint.r + spawnOffset.r),
    );
    return {
      q: stairsConstraint.q,
      r: stairsConstraint.r,
      enterHeading: stairsConstraint.enterHeading,
      exitHeading: stairsConstraint.enterHeading,
      verticalMode: stairsConstraint.verticalMode,
    };
  }

  // 初期フロア: player から適度に離れた floor tile を選ぶ
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
    // SPEC §4.3:enterHeading は「主体が階段に入る時の進行方向ベクトル」。
    // walkableHeadings[h] は「階段から見て床がある方向」=「プレイヤーが階段から出る方向」。
    // プレイヤーがその床から階段に入る時の移動方向はその opposite。
    // CHANGELOG フェーズ 50:v0 期から残存していた逆向き bug を修正
    //   (旧コード: enterHeading = floorSide で、初期階段に到達不能なフロアが生成されていた)。
    const floorSide = rng.pick(walkableHeadings);
    const enterHeading = oppositeHeading(floorSide);
    return {
      q: tile.q,
      r: tile.r,
      enterHeading,
      exitHeading: enterHeading,
      verticalMode: rng.chance(0.5) ? 'up' : 'down',
    };
  }
  // フォールバック: playerStart 位置に階段(ありえないが防御的に)
  return {
    q: playerStart.q,
    r: playerStart.r,
    enterHeading: 0,
    exitHeading: 0,
    verticalMode: 'down',
  };
}

export function generateCaveMap({ radius = CONFIG.worldRadius, rng = createRng(20260415), params = {}, stairsConstraint = null }) {
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

  // フロア遷移時は、階段位置近くからプレイヤーが spawn する必要があるため、
  // まず stairs を確定させ、それを元に playerStart を決める。
  // 遷移時の配置(SPEC §9.9): 階段の opposite(enterHeading) 方向隣接 = 物理的に
  // プレイヤーが出てきた側。facing は旧 exitHeading(= opposite(新 enterHeading))。
  let playerStart;
  let stairsInfo;
  if (stairsConstraint) {
    stairsInfo = placeStairsForCave(tiles, { q: 0, r: 0 }, stairsConstraint, rng);
    const spawnHeading = oppositeHeading(stairsInfo.enterHeading);
    const off = EDGE_DIRECTIONS[spawnHeading];
    playerStart = { q: stairsInfo.q + off.q, r: stairsInfo.r + off.r, facing: spawnHeading };
  } else {
    playerStart = choosePlayerStart(tiles);
    stairsInfo = placeStairsForCave(tiles, playerStart, null, rng);
  }

  const enemies = chooseEnemySpawns(tiles, playerStart, rng, stairsInfo);
  const cells = buildSourceCells(tiles, radius, stairsInfo);

  return {
    radius,
    cells,
    playerStart,
    enemies,
    stairs: stairsInfo,
    meta: {
      family: 'cave',
      radius,
      floorCount: collectFloorTiles(tiles).length,
      params: resolvedParams,
    },
  };
}
