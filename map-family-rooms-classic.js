import { CONFIG } from './config.js';
import { EDGE_DIRECTIONS, Hex, hexDistance, isInsideWorld, oppositeHeading } from './hex.js';
import { createRng } from './rng.js';
import { selectEnemiesWithMinDistanceRelaxation } from './map-spawn.js';

// ==============================================================================
// rooms_classic family — v1-0b.1.2 フェーズ 54.2 で全面再設計
// ==============================================================================
//
// 構造化された手順で source map を組み立てる:
//
//   1. 部屋の内側を floor(structureKind: 'room')で塗り潰す
//   2. 中心部屋 ↔ 各外部屋を corridor で繋ぐ
//      - 各部屋の出入口に threshold(structureKind: 'threshold')を 1 マス置く
//      - threshold 同士を corridor(structureKind: 'corridor')で直線接続
//      - corridor 長は両部屋の幾何で必ず ≥ 1 マスになるよう中心間距離を確保
//   3. 全構造化セル(room / corridor / threshold)の 6 隣接で
//      未登録のセルを wall(structureKind: 'wall')で囲む
//
// 幾何(中心部屋 (0,0) 半径 2、外部屋 (0, -9) heading=0 半径 2 の例):
//
//          外部屋 (0,-9) 中心
//   外部屋外周(distance 2): (0,-7) .. (0,-11) など
//   外部屋 threshold:        (0,-6)  ← 外部屋外周の 1 マス内側ではなく外側
//   corridor:                (0,-5), (0,-4)  ← 2 マス
//   中心部屋 threshold:       (0,-3)
//   中心部屋外周(distance 2): (0,-2)
//          中心部屋 (0,0)
//
// ※ threshold は **部屋の一部ではなく corridor の端**。room 外周(distance ≤ 2)
//   の 1 マス外側に配置することで、threshold 自身も corridor として通行可能にする。
//   threshold には door feature を載せられる(closed / locked / open)。
//
// ※ 中心部屋から各外部屋への heading は 0/2/4(roomCount=4)or 0/3(roomCount=3)。
//   各外部屋の中心 = axialStep(中心部屋, heading, 9)。
// ==============================================================================

// ---- 幾何ヘルパ ----

function axialStep(hex, heading, steps = 1) {
  let current = hex;
  for (let i = 0; i < steps; i += 1) {
    current = current.add(EDGE_DIRECTIONS[heading]);
  }
  return current;
}

// addCell:cellMap に entry を追加 / patch する。
// prev デフォルトは付けない(明示的に structureKind を指定して呼ぶ前提)。
function addCell(cellMap, hex, patch) {
  if (!isInsideWorld(hex, CONFIG.worldRadius)) return;
  const key = hex.key();
  const prev = cellMap.get(key);
  cellMap.set(key, {
    q: hex.q,
    r: hex.r,
    support: patch.support ?? prev?.support ?? 'stable',
    sightH: patch.sightH ?? prev?.sightH ?? 'pass',
    sightD: patch.sightD ?? prev?.sightD ?? 'block',
    structureKind: patch.structureKind ?? prev?.structureKind ?? 'room',
    feature: patch.feature ?? prev?.feature ?? null,
    meta: { ...(prev?.meta ?? {}), ...(patch.meta ?? {}) },
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
        feature: null,
        meta: { roomId },
      });
    }
  }
}

// 部屋同士を corridor で繋ぐ。
//   roomCenter1 → 部屋 1 中心、heading で部屋 2 へ向かう
//   roomRadius:両部屋とも同じ半径(本 generator では 2 固定)
//
// 配置:
//   - threshold1 = roomCenter1 から heading 方向に (roomRadius + 1) ステップ
//     例: 中心 (0,0) 半径 2 → threshold1 = (0,-3)
//   - threshold2 = roomCenter2 から oppositeHeading 方向に (roomRadius + 1) ステップ
//   - threshold1 と threshold2 の間を corridor で直線接続
//
// corridorId は呼び出し側から与える。
function connectRoomsWithCorridor(cellMap, roomCenter1, roomCenter2, heading, roomRadius, corridorId) {
  const threshold1 = axialStep(roomCenter1, heading, roomRadius + 1);
  const threshold2 = axialStep(roomCenter2, oppositeHeading(heading), roomRadius + 1);

  // threshold を登録(door feature は呼び出し側で重ね描く)
  addCell(cellMap, threshold1, {
    support: 'stable',
    sightH: 'pass',
    sightD: 'block',
    structureKind: 'threshold',
    feature: null,
    meta: { corridorId, side: 'near' },
  });
  addCell(cellMap, threshold2, {
    support: 'stable',
    sightH: 'pass',
    sightD: 'block',
    structureKind: 'threshold',
    feature: null,
    meta: { corridorId, side: 'far' },
  });

  // threshold1 から heading 方向に進み、threshold2 までを corridor で埋める
  // (threshold1 の次のセルから threshold2 の手前まで)
  let current = axialStep(threshold1, heading, 1);
  while (!current.equals(threshold2)) {
    addCell(cellMap, current, {
      support: 'stable',
      sightH: 'pass',
      sightD: 'block',
      structureKind: 'corridor',
      feature: null,
      meta: { corridorId },
    });
    current = axialStep(current, heading, 1);
  }

  return { threshold1, threshold2 };
}

// 全構造化セル(room / corridor / threshold)の 6 隣接で未登録のセルを wall として埋める。
// threshold 起点も含めて OK:新仕様では threshold の外向きも必ず corridor or room なので、
// wall になる位置は room/corridor/threshold が既に占有していて自然に skip される。
// (旧設計では entry/exit threshold が 1 マスで隣接 = corridor 0 マスケースが起こり、
//  threshold の外向き隣接に wall ができてしまっていた。新設計では幾何的に発生しない。)
function addWallRing(cellMap) {
  const snapshot = Array.from(cellMap.values());
  for (const cell of snapshot) {
    const here = new Hex(cell.q, cell.r);
    for (let h = 0; h < 6; h += 1) {
      const neighbor = axialStep(here, h, 1);
      const key = neighbor.key();
      if (cellMap.has(key)) continue;
      // wall の support は 'blocked' を使う(cave 系と同じ規約)。
      // map-compile.js の canStandAtHere = (effective.support !== 'blocked') という規則により、
      // 'blocked' のときだけ canStandAtHere = false となり、プレイヤーが立てない + getTileHeight が
      // 1 を返して shadow source として認識される。'unstable' では立てる扱いになって
      // shadow が出ない / プレイヤーが壁にめり込む問題が発生する(フェーズ 54.3 で発見)。
      addCell(cellMap, neighbor, {
        support: 'blocked',
        sightH: 'block',
        sightD: 'block',
        structureKind: 'wall',
        feature: null,
        meta: {},
      });
    }
  }
}

// 進行先方向のヒューリスティック(敵の facing 決定用)
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

// ---- 敵 spawn 候補選定(SPEC §11.3) ----

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

const ROOM_RADIUS = 2;       // 各部屋の hex disk 半径
const ROOM_DISTANCE = 9;     // 中心部屋 ↔ 外部屋の中心間距離(corridor 2 マスを確保)

export function generateClassicRoomsMap({ radius = CONFIG.worldRadius, rng = null, params = {}, stairsConstraint = null } = {}) {
  const localRng = rng ?? createRng(params.seed ?? 20260419);
  const cellMap = new Map();
  const roomCount = localRng.chance(0.5) ? 3 : 4;

  // 階段情報を先に確定(centerRoom の位置決めに使う)
  const stairsInfo = resolveStairsInfo(stairsConstraint, localRng);

  // 中心部屋:
  //   stairsConstraint あり → 階段位置に中心部屋を寄せる(プレイヤーは階段 exitHeading 隣接で spawn)
  //   stairsConstraint なし → (0, 0)(プレイヤーは (0, 0) spawn、階段は (0, -1))
  const centerRoomCenter = stairsConstraint
    ? new Hex(stairsInfo.q, stairsInfo.r)
    : new Hex(0, 0);
  const centerRoom = { id: 'r1', center: centerRoomCenter, radius: ROOM_RADIUS };

  // 外部屋の方向(roomCount で決定)
  const outerHeadings = roomCount === 3 ? [0, 3] : [0, 2, 4];

  // 部屋を作る:中心 + 各外部屋
  const rooms = [centerRoom];
  outerHeadings.forEach((heading, index) => {
    rooms.push({
      id: `r${index + 2}`,
      center: axialStep(centerRoom.center, heading, ROOM_DISTANCE),
      radius: ROOM_RADIUS,
      heading,
    });
  });

  // (1) 部屋の内側を floor で塗り潰す
  for (const room of rooms) {
    addRoomDisk(cellMap, room.center, room.radius, room.id);
  }

  // 中心部屋に階段 feature を載せる(addRoomDisk 後なので room の上に重ねる)
  const stairsHex = new Hex(stairsInfo.q, stairsInfo.r);
  addCell(cellMap, stairsHex, {
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

  // (2) 中心部屋 ↔ 各外部屋を corridor で繋ぐ
  // v0 動作確認用: 外部屋のうち 1 つの出口を closed ドア、もう 1 つを locked ドアにする。
  // 3 部屋(外 2 つ)なら 1 つずつ、4 部屋(外 3 つ)なら 1 つは扉なし。
  const outerRooms = rooms.slice(1);
  const closedDoorRoomId = outerRooms[0]?.id ?? null;
  const lockedDoorRoomId = outerRooms[1]?.id ?? null;

  for (const room of outerRooms) {
    const corridorId = `c_${centerRoom.id}_${room.id}`;
    const { threshold1: nearThreshold, threshold2: farThreshold } = connectRoomsWithCorridor(
      cellMap,
      centerRoom.center,
      room.center,
      room.heading,
      ROOM_RADIUS,
      corridorId,
    );
    // 外部屋側の threshold(threshold2 = farThreshold)に door を配置する
    let doorState = null;
    if (room.id === closedDoorRoomId) doorState = 'closed';
    else if (room.id === lockedDoorRoomId) doorState = 'locked';
    if (doorState) {
      addCell(cellMap, farThreshold, {
        structureKind: 'threshold',
        feature: { kind: 'door', state: doorState, params: {} },
        meta: { corridorId, roomId: room.id, side: 'far' },
      });
    } else {
      // ドアなし threshold には roomId メタを付ける(meta 整理のため)
      addCell(cellMap, farThreshold, {
        meta: { corridorId, roomId: room.id, side: 'far' },
      });
    }
    // 中心側 threshold(threshold1 = nearThreshold)も roomId を中心に紐付け
    addCell(cellMap, nearThreshold, {
      meta: { corridorId, roomId: centerRoom.id, side: 'near' },
    });
  }

  // (3) 全構造化セルの 6 隣接で未登録のセルを wall で囲む
  addWallRing(cellMap);

  // プレイヤー初期位置
  //   初期フロア: centerRoom.center (= (0, 0))、facing = 0
  //   フロア遷移: 階段の「開口部側」= opposite(enterHeading) 方向隣接タイルに spawn。
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
