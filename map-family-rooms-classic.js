import { CONFIG } from './config.js';
import { EDGE_DIRECTIONS, Hex, hexDistance, isInsideWorld, oppositeHeading } from './hex.js';
import { createRng } from './rng.js';
import { selectEnemiesWithMinDistanceRelaxation } from './map-spawn.js';

// ---- 幾何ヘルパ ----

function axialStep(hex, heading, steps = 1) {
  let current = hex;
  for (let i = 0; i < steps; i += 1) {
    current = current.add(EDGE_DIRECTIONS[heading]);
  }
  return current;
}

function addCell(cellMap, hex, patch) {
  if (!isInsideWorld(hex, CONFIG.worldRadius)) return;
  const key = hex.key();
  const prev = cellMap.get(key) ?? {
    q: hex.q,
    r: hex.r,
    support: 'stable',
    sightH: 'pass',
    sightD: 'block',
    structureKind: 'room',
    feature: null,
    meta: {},
  };
  cellMap.set(key, {
    ...prev,
    ...patch,
    q: hex.q,
    r: hex.r,
    meta: { ...(prev.meta ?? {}), ...(patch.meta ?? {}) },
  });
}

function addRoomDisk(cellMap, center, radius, roomId) {
  for (let q = -radius; q <= radius; q += 1) {
    for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r += 1) {
      const cell = new Hex(center.q + q, center.r + r);
      addCell(cellMap, cell, {
        support: 'stable',
        sightH: 'pass',
        sightD: 'block',
        structureKind: 'room',
        meta: { roomId },
      });
    }
  }
}

function chooseFacingToward(from, to) {
  let bestHeading = 0;
  let bestDistance = Infinity;
  for (let heading = 0; heading < EDGE_DIRECTIONS.length; heading += 1) {
    const candidate = from.add(EDGE_DIRECTIONS[heading]);
    const distance = hexDistance(candidate, to);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestHeading = heading;
    }
  }
  return bestHeading;
}

// ---- 敵 spawn 候補選定 ----

function collectRoomFloorCells(cellMap, rooms, reserved) {
  const candidates = [];
  for (const room of rooms) {
    for (const [key, cell] of cellMap.entries()) {
      if (cell.meta?.roomId !== room.id) continue;
      if (cell.structureKind !== 'room') continue;
      if (reserved.has(key)) continue;
      candidates.push(cell);
    }
  }
  return candidates;
}

function chooseEnemies(rooms, cellMap, startCenter, rng, stairsHex = null) {
  // 仕様(SPEC §11.3): 3〜5 体、プレイヤー初期位置から hexDistance >= 5、
  // 敵同士 hexDistance >= 6(段階的緩和つき、CHANGELOG フェーズ 49)。
  // wt は watcher の wtRange から乱数で決定、以降個体固定。
  const count = rng.int(3, 5);
  const watcherKind = CONFIG.enemyKinds.watcher;
  const [wtMin, wtMax] = watcherKind.wtRange;

  const reserved = new Set([startCenter.key()]);
  if (stairsHex) reserved.add(stairsHex.key());
  const candidates = collectRoomFloorCells(cellMap, rooms, reserved);

  const ranked = candidates
    .map((cell) => ({ cell, dist: hexDistance(new Hex(cell.q, cell.r), startCenter) }))
    .filter((entry) => entry.dist >= 5)
    .sort((a, b) => b.dist - a.dist);

  // shuffle 結果を緩和ループの全段階で再利用するため、ここで 1 回だけ shuffle する
  // (SPEC §11.3 の「配置順の決定論」規約)。
  const orderedCandidates = rng.shuffle(ranked).map((entry) => ({
    q: entry.cell.q,
    r: entry.cell.r,
  }));
  const chosen = selectEnemiesWithMinDistanceRelaxation(orderedCandidates, count);

  return chosen.map((cell, idx) => ({
    id: `e${idx + 1}`,
    kind: 'watcher',
    q: cell.q,
    r: cell.r,
    facing: chooseFacingToward(new Hex(cell.q, cell.r), startCenter),
    wt: rng.int(wtMin, wtMax),
  }));
}

// ---- 階段配置 ----

// 階段情報を決定する。
//   stairsConstraint あり(フロア遷移時): 指定の (q, r), enterHeading, verticalMode を強制
//   stairsConstraint なし(初期フロア):    (0, -1) 固定、enterHeading=0 (N)、verticalMode は乱数
function resolveStairsInfo(stairsConstraint, rng) {
  if (stairsConstraint) {
    return {
      q: stairsConstraint.q,
      r: stairsConstraint.r,
      enterHeading: stairsConstraint.enterHeading,
      exitHeading: stairsConstraint.enterHeading,  // 通過型(SPEC §4.3, §12.5)
      verticalMode: stairsConstraint.verticalMode,
    };
  }
  // 初期フロア: 中心部屋 (0, 0) の N 隣接 = (0, -1)
  const initialHeading = 0;
  return {
    q: 0 + EDGE_DIRECTIONS[initialHeading].q,
    r: 0 + EDGE_DIRECTIONS[initialHeading].r,
    enterHeading: initialHeading,
    exitHeading: initialHeading,
    verticalMode: rng.chance(0.5) ? 'up' : 'down',
  };
}

// ---- 生成本体 ----

// v1-0b.1.2(フェーズ 54、A-3): rooms_classic family の wall 明示登録。
// 構造化セル(room / corridor)群の境界に隣接する 1 層分のセルを
// wall として addCell に登録する。これにより:
//   - getCellSource(wallCell) が non-null を返す(以前は void)
//   - getTileSprite(wallCell) が kind: 'wall' を返す → wall PNG 経路に乗る
//   - shadow pass の getTileHeight が runtime null フォールバックではなく
//     明示的な wall として z=+h を返す
// 機能的には canStandAt = false、blocksSightH = block で従来と一致するが、
// source-of-truth として wall が明示登録される(STATUS §4.7 の負債解消)。
//
// v1-0b.1.2 フェーズ 54.1: threshold セルからの隣接展開は除外する。threshold は
// 閉領域(部屋)と外部(corridor / 隣接部屋)を結ぶ出入口で、その外向き隣接位置に
// 壁を置くと「ドアを抜けたらすぐ壁で塞がれる」(corridor 0 マスケースで顕在化、
// rooms_classic の seed によっては threshold 同士が直接隣接して corridor が空になる)。
// room / corridor からの展開だけで部屋外周の wall は十分カバーされる。
function addWallRing(cellMap) {
  // 反復中変更を避けるため snapshot を取る
  const snapshot = Array.from(cellMap.values());
  for (const cell of snapshot) {
    // threshold 起点の隣接展開は skip(出入口の外を塞がないため)
    if (cell.structureKind === 'threshold') continue;
    const here = new Hex(cell.q, cell.r);
    for (let h = 0; h < 6; h += 1) {
      const neighbor = axialStep(here, h, 1);
      const key = neighbor.key();
      if (cellMap.has(key)) continue;  // 既に登録済(構造化セル)はスキップ
      // wall として登録(unstable / sight block 両方向)
      addCell(cellMap, neighbor, {
        support: 'unstable',
        sightH: 'block',
        sightD: 'block',
        structureKind: 'wall',
        feature: null,
        meta: {},
      });
    }
  }
}

export function generateClassicRoomsMap({ radius = CONFIG.worldRadius, rng = null, params = {}, stairsConstraint = null } = {}) {
  const localRng = rng ?? createRng(params.seed ?? 20260419);
  const cellMap = new Map();
  const roomCount = localRng.chance(0.5) ? 3 : 4;

  // 階段情報を先に確定させる(centerRoom の位置決めに使う)
  const stairsInfo = resolveStairsInfo(stairsConstraint, localRng);

  // centerRoom.center:
  //   stairsConstraint あり → 階段位置に中心部屋を寄せる(プレイヤーは階段 exitHeading 隣接で spawn)
  //   stairsConstraint なし → (0, 0)(プレイヤーは (0, 0) spawn、階段は (0, -1))
  const centerRoomCenter = stairsConstraint
    ? new Hex(stairsInfo.q, stairsInfo.r)
    : new Hex(0, 0);
  const centerRoom = { id: 'r1', center: centerRoomCenter, radius: 2 };

  const outerHeadings = roomCount === 3 ? [0, 3] : [0, 2, 4];
  const rooms = [centerRoom];
  outerHeadings.forEach((heading, index) => {
    rooms.push({
      id: `r${index + 2}`,
      center: axialStep(centerRoom.center, heading, 7),
      radius: 2,
      heading,
    });
  });

  for (const room of rooms) addRoomDisk(cellMap, room.center, room.radius, room.id);

  // 階段を中心部屋内の該当タイルに配置(既に room として addCell されているので、feature を重ねる)
  const stairsHex = new Hex(stairsInfo.q, stairsInfo.r);
  addCell(cellMap, stairsHex, {
    support: 'stable',
    sightH: 'pass',
    sightD: 'block',
    structureKind: 'room',
    feature: {
      kind: 'stairs',
      state: 'normal',
      params: {
        enterHeading: stairsInfo.enterHeading,
        exitHeading: stairsInfo.exitHeading,
        verticalMode: stairsInfo.verticalMode,
      },
    },
    meta: { roomId: centerRoom.id },
  });

  // v0 動作確認用: 外部屋のうち 1 つの出口を closed ドア、もう 1 つを locked ドアにする。
  // 3 部屋(外 2 つ)なら 1 つずつ、4 部屋(外 3 つ)なら 1 つは扉なし。
  const outerRooms = rooms.slice(1);
  const closedDoorRoomId = outerRooms[0]?.id ?? null;
  const lockedDoorRoomId = outerRooms[1]?.id ?? null;

  for (const room of rooms.slice(1)) {
    const entry = axialStep(centerRoom.center, room.heading, 3);
    const exit = axialStep(room.center, (room.heading + 3) % 6, 3);

    let current = entry.add(EDGE_DIRECTIONS[room.heading]);
    while (!current.equals(exit)) {
      addCell(cellMap, current, {
        support: 'stable',
        sightH: 'pass',
        sightD: 'block',
        structureKind: 'corridor',
        meta: { corridorId: `c_${centerRoom.id}_${room.id}` },
      });
      current = current.add(EDGE_DIRECTIONS[room.heading]);
    }

    // threshold の source support は常に stable(GLOSSARY §5, SPEC §6.2)。
    // closed/locked の effective 降格は resolve が担当する。
    addCell(cellMap, entry, {
      support: 'stable',
      sightH: 'pass',
      sightD: 'block',
      structureKind: 'threshold',
      feature: null,
      meta: { roomId: centerRoom.id },
    });

    let doorState = null;
    if (room.id === closedDoorRoomId) doorState = 'closed';
    else if (room.id === lockedDoorRoomId) doorState = 'locked';

    addCell(cellMap, exit, {
      support: 'stable',
      sightH: 'pass',
      sightD: 'block',
      structureKind: 'threshold',
      feature: doorState ? { kind: 'door', state: doorState, params: {} } : null,
      meta: { roomId: room.id },
    });
  }

  // プレイヤー初期位置を決定
  //   初期フロア: centerRoom.center (= (0, 0))、facing = 0
  //   フロア遷移: 階段の「開口部側」= opposite(enterHeading) 方向隣接タイルに spawn。
  //              facing は旧フロアでの進行方向(= 旧 exitHeading)を維持 =
  //              新 enterHeading の opposite。
  let playerStart;
  if (stairsConstraint) {
    const spawnHeading = oppositeHeading(stairsInfo.enterHeading);
    const off = EDGE_DIRECTIONS[spawnHeading];
    playerStart = {
      q: stairsInfo.q + off.q,
      r: stairsInfo.r + off.r,
      facing: spawnHeading,
    };
  } else {
    playerStart = { q: centerRoom.center.q, r: centerRoom.center.r, facing: 0 };
  }

  // v1-0b.1.2(フェーズ 54、A-3): 構造化セル全部の登録が終わった段階で wall 1 層を追加。
  // chooseEnemies は room cell のみを候補にするため、wall 追加は enemy 配置に影響しない。
  addWallRing(cellMap);

  const cells = Array.from(cellMap.values());
  const enemies = chooseEnemies(rooms, cellMap, new Hex(playerStart.q, playerStart.r), localRng, stairsHex);

  return {
    radius,
    cells,
    playerStart,
    enemies,
    stairs: stairsInfo,
    meta: {
      family: 'rooms_classic',
      radius,
      floorCount: cells.filter((cell) => cell.support === 'stable').length,
      roomCount,
      params: { seed: localRng.seed, ...params },
    },
  };
}
