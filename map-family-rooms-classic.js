import { CONFIG } from './config.js';
import { EDGE_DIRECTIONS, Hex, hexDistance, isInsideWorld } from './hex.js';
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

function chooseEnemies(rooms, cellMap, startRoomCenter, rng) {
  // 仕様(SPEC §11.3): 3〜5 体、プレイヤー初期位置から hexDistance >= 5。
  // wt は watcher の wtRange から乱数で決定、以降個体固定。
  const count = rng.int(3, 5);
  const watcherKind = CONFIG.enemyKinds.watcher;
  const [wtMin, wtMax] = watcherKind.wtRange;

  const reserved = new Set([startRoomCenter.key()]);
  const candidates = collectRoomFloorCells(cellMap, rooms, reserved);

  const ranked = candidates
    .map((cell) => ({ cell, dist: hexDistance(new Hex(cell.q, cell.r), startRoomCenter) }))
    .filter((entry) => entry.dist >= 5)
    .sort((a, b) => b.dist - a.dist);

  const enemies = [];
  const used = new Set();
  for (const entry of rng.shuffle(ranked)) {
    if (enemies.length >= count) break;
    const key = `${entry.cell.q},${entry.cell.r}`;
    if (used.has(key)) continue;
    used.add(key);
    const facing = chooseFacingToward(new Hex(entry.cell.q, entry.cell.r), startRoomCenter);
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

// ---- 生成本体 ----

export function generateClassicRoomsMap({ radius = CONFIG.worldRadius, rng = null, params = {} } = {}) {
  const localRng = rng ?? createRng(params.seed ?? 20260419);
  const cellMap = new Map();
  const roomCount = localRng.chance(0.5) ? 3 : 4;
  const centerRoom = { id: 'r1', center: new Hex(0, 0), radius: 2 };
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

  const cells = Array.from(cellMap.values());
  const enemies = chooseEnemies(rooms, cellMap, centerRoom.center, localRng);

  return {
    radius,
    cells,
    playerStart: { q: centerRoom.center.q, r: centerRoom.center.r, facing: 0 },
    enemies,
    meta: {
      family: 'rooms_classic',
      radius,
      floorCount: cells.filter((cell) => cell.support === 'stable').length,
      roomCount,
      params: { seed: localRng.seed, ...params },
    },
  };
}
