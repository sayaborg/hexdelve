import { CONFIG } from './config.js';
import { EDGE_DIRECTIONS, Hex, hexDistance, isInsideWorld, oppositeHeading } from './hex.js';
import { createRng } from './rng.js';

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
  // 仕様(SPEC §11.3): 3〜5 体、プレイヤー初期位置から hexDistance >= 5。
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

  const enemies = [];
  const used = new Set();
  for (const entry of rng.shuffle(ranked)) {
    if (enemies.length >= count) break;
    const key = `${entry.cell.q},${entry.cell.r}`;
    if (used.has(key)) continue;
    used.add(key);
    const facing = chooseFacingToward(new Hex(entry.cell.q, entry.cell.r), startCenter);
    enemies.push({
      id: `e${enemies.length + 1}`,
      kind: 'watcher',
      q: entry.cell.q,
      r: entry.cell.r,
      facing,
      wt: rng.int(wtMin, wtMax),
    });
  }
  return enemies;
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
