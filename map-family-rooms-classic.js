import { Hex, isInsideWorld } from './hex.js';
import { allWorldCells, buildFloorSetFromTiles, createDefaultTile } from './map.js';

function hexDistance(a, b) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  const ds = (-a.q - a.r) - (-b.q - b.r);
  return Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds));
}

const HEX_DIRS = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

function initVoidTiles(radius) {
  const tiles = new Map();
  for (const cell of allWorldCells) {
    if (!isInsideWorld(cell, radius)) continue;
    tiles.set(cell.key(), createDefaultTile(cell.q, cell.r));
  }
  return tiles;
}

function randomWorldCell(radius, rng) {
  while (true) {
    const q = rng.int(-radius, radius);
    const r = rng.int(-radius, radius);
    const cell = new Hex(q, r);
    if (isInsideWorld(cell, radius)) return cell;
  }
}

function makeRoomLimits(baseRadius, jitter, rng) {
  const clampMin = 1;
  return {
    xPos: Math.max(clampMin, baseRadius + rng.int(-jitter, jitter)),
    xNeg: Math.max(clampMin, baseRadius + rng.int(-jitter, jitter)),
    yPos: Math.max(clampMin, baseRadius + rng.int(-jitter, jitter)),
    yNeg: Math.max(clampMin, baseRadius + rng.int(-jitter, jitter)),
    zPos: Math.max(clampMin, baseRadius + rng.int(-jitter, jitter)),
    zNeg: Math.max(clampMin, baseRadius + rng.int(-jitter, jitter)),
  };
}

function buildIrregularHexRoomCells(center, limits) {
  const cells = [];
  const maxRange = Math.max(
    limits.xPos,
    limits.xNeg,
    limits.yPos,
    limits.yNeg,
    limits.zPos,
    limits.zNeg
  );

  for (let dq = -maxRange; dq <= maxRange; dq += 1) {
    for (let dr = -maxRange; dr <= maxRange; dr += 1) {
      const ds = -dq - dr;
      if (dq > limits.xPos) continue;
      if (dq < -limits.xNeg) continue;
      if (dr > limits.yPos) continue;
      if (dr < -limits.yNeg) continue;
      if (ds > limits.zPos) continue;
      if (ds < -limits.zNeg) continue;
      cells.push(new Hex(center.q + dq, center.r + dr));
    }
  }

  return cells;
}

function expandCells(cells, padding) {
  const visited = new Set(cells.map((c) => c.key()));
  let frontier = [...cells];

  for (let step = 0; step < padding; step += 1) {
    const next = [];
    for (const cell of frontier) {
      for (const dir of HEX_DIRS) {
        const neighbor = new Hex(cell.q + dir.q, cell.r + dir.r);
        const key = neighbor.key();
        if (visited.has(key)) continue;
        visited.add(key);
        next.push(neighbor);
      }
    }
    frontier = next;
  }

  return visited;
}

function canPlaceRoom(cells, forbidden, radius) {
  for (const cell of cells) {
    if (!isInsideWorld(cell, radius)) return false;
    if (forbidden.has(cell.key())) return false;
  }
  return true;
}

function paintRoomToTiles(tiles, room) {
  const vertexDirByKey = new Map((room.vertexDoors ?? []).map((door) => [door.cell.key(), door.dir]));
  const edgeKeys = new Set((room.edgeCells ?? []).map((c) => c.key()));

  for (const cell of room.cells) {
    const tile = tiles.get(cell.key());
    if (!tile) continue;
    tile.type = 'floor';
    tile.regionType = 'room';
    tile.roomId = room.id;
    tile.boundaryRole = 'interior';
    tile.vertexDir = null;
    if (edgeKeys.has(cell.key())) tile.boundaryRole = 'edge';
    if (vertexDirByKey.has(cell.key())) {
      tile.boundaryRole = 'vertex';
      tile.vertexDir = vertexDirByKey.get(cell.key());
    }
  }
}

function markSelectedDoorTiles(tiles, selectedDoors) {
  for (const entry of selectedDoors) {
    for (const door of [entry.doorA, entry.doorB]) {
      const tile = tiles.get(door.cell.key());
      if (!tile) continue;
      tile.boundaryRole = 'door';
    }
  }
}

function countRoomSideLengths(center, cells, limits) {
  const counts = [0, 0, 0, 0, 0, 0];

  for (const cell of cells) {
    const dq = cell.q - center.q;
    const dr = cell.r - center.r;
    const ds = -dq - dr;
    if (dq === limits.xPos) counts[0] += 1;
    if (dr === limits.yPos) counts[1] += 1;
    if (ds === limits.zPos) counts[2] += 1;
    if (dq === -limits.xNeg) counts[3] += 1;
    if (dr === -limits.yNeg) counts[4] += 1;
    if (ds === -limits.zNeg) counts[5] += 1;
  }

  return counts;
}

function buildRoomBoundaryMetadata(room) {
  const { center, limits } = room;
  const vertexDoors = [
    { roomId: room.id, kind: 'vertex', dir: 0, cell: new Hex(center.q + limits.xPos, center.r + (limits.zNeg - limits.xPos)) },
    { roomId: room.id, kind: 'vertex', dir: 1, cell: new Hex(center.q + limits.xPos, center.r - limits.yNeg) },
    { roomId: room.id, kind: 'vertex', dir: 2, cell: new Hex(center.q + (limits.yNeg - limits.zPos), center.r - limits.yNeg) },
    { roomId: room.id, kind: 'vertex', dir: 3, cell: new Hex(center.q - limits.xNeg, center.r + (limits.xNeg - limits.zPos)) },
    { roomId: room.id, kind: 'vertex', dir: 4, cell: new Hex(center.q - limits.xNeg, center.r + limits.yPos) },
    { roomId: room.id, kind: 'vertex', dir: 5, cell: new Hex(center.q + (limits.zNeg - limits.yPos), center.r + limits.yPos) },
  ];

  for (const door of vertexDoors) {
    const delta = HEX_DIRS[door.dir];
    door.outside = new Hex(door.cell.q + delta.q, door.cell.r + delta.r);
  }

  const cellSet = new Set(room.cells.map((c) => c.key()));
  const vertexDoorsFiltered = vertexDoors.filter((d) => cellSet.has(d.cell.key()));
  const vertexKeySet = new Set(vertexDoorsFiltered.map((d) => d.cell.key()));
  const boundaryCells = [];
  const edgeCells = [];

  for (const cell of room.cells) {
    let isBoundary = false;
    for (const dir of HEX_DIRS) {
      const n = new Hex(cell.q + dir.q, cell.r + dir.r);
      if (!cellSet.has(n.key())) {
        isBoundary = true;
        break;
      }
    }
    if (!isBoundary) continue;
    boundaryCells.push(cell);
    if (!vertexKeySet.has(cell.key())) {
      edgeCells.push(cell);
    }
  }

  return {
    vertexDoors: vertexDoorsFiltered,
    vertexCells: vertexDoorsFiltered.map((d) => d.cell),
    boundaryCells,
    edgeCells,
  };
}

function buildRoomConnectionCandidates(rooms) {
  const candidates = [];

  for (let i = 0; i < rooms.length; i += 1) {
    for (let j = i + 1; j < rooms.length; j += 1) {
      const roomA = rooms[i];
      const roomB = rooms[j];
      const dist = hexDistance(roomA.center, roomB.center);

      candidates.push({
        id: `c${candidates.length}`,
        roomAId: roomA.id,
        roomBId: roomB.id,
        centerDistance: dist,
      });
    }
  }

  candidates.sort((a, b) => a.centerDistance - b.centerDistance);
  return candidates;
}

function buildMstConnections(rooms, candidates) {
  const parent = new Map();

  function find(x) {
    let root = x;
    while (parent.get(root) !== root) {
      root = parent.get(root);
    }
    while (parent.get(x) !== x) {
      const next = parent.get(x);
      parent.set(x, root);
      x = next;
    }
    return root;
  }

  function unite(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return false;
    parent.set(rb, ra);
    return true;
  }

  for (const room of rooms) {
    parent.set(room.id, room.id);
  }

  const selected = [];
  for (const candidate of candidates) {
    if (unite(candidate.roomAId, candidate.roomBId)) {
      selected.push({ ...candidate, kind: 'main' });
      if (selected.length >= rooms.length - 1) break;
    }
  }

  return selected;
}

function addExtraLoopConnections(baseConnections, candidates, rng, extraLoopCount = 2) {
  const used = new Set(
    baseConnections.map((c) => {
      const a = c.roomAId < c.roomBId ? c.roomAId : c.roomBId;
      const b = c.roomAId < c.roomBId ? c.roomBId : c.roomAId;
      return `${a}|${b}`;
    })
  );

  const rest = candidates.filter((c) => {
    const a = c.roomAId < c.roomBId ? c.roomAId : c.roomBId;
    const b = c.roomAId < c.roomBId ? c.roomBId : c.roomAId;
    return !used.has(`${a}|${b}`);
  });

  const shuffled = rng.shuffle(rest);
  const loops = shuffled.slice(0, extraLoopCount).map((c) => ({ ...c, kind: 'loop' }));
  return [...baseConnections, ...loops];
}

function pickNearestVertexDoorPair(roomA, roomB) {
  let best = null;

  for (const doorA of roomA.vertexDoors) {
    for (const doorB of roomB.vertexDoors) {
      const dist = hexDistance(doorA.outside, doorB.outside);
      if (!best || dist < best.distance) {
        best = { distance: dist, doorA, doorB };
      }
    }
  }

  return best;
}

function assignDoorsToConnections(rooms, connections) {
  const roomById = new Map(rooms.map((r) => [r.id, r]));
  const selectedDoors = [];

  for (const connection of connections) {
    const roomA = roomById.get(connection.roomAId);
    const roomB = roomById.get(connection.roomBId);
    if (!roomA || !roomB) continue;

    const pair = pickNearestVertexDoorPair(roomA, roomB);
    if (!pair) continue;

    connection.doorA = pair.doorA;
    connection.doorB = pair.doorB;

    selectedDoors.push({
      connectionId: connection.id,
      roomAId: connection.roomAId,
      roomBId: connection.roomBId,
      doorA: pair.doorA,
      doorB: pair.doorB,
      distance: pair.distance,
    });
  }

  return selectedDoors;
}

function pickStartRoom(rooms) {
  if (rooms.length === 0) return null;

  let best = rooms[0];
  let bestDist = hexDistance(best.center, new Hex(0, 0));

  for (const room of rooms) {
    const dist = hexDistance(room.center, new Hex(0, 0));
    if (dist < bestDist) {
      best = room;
      bestDist = dist;
    }
  }

  return best;
}

function isCorridorStepAllowed(hex, tiles, allowedRoomIds) {
  const tile = tiles.get(hex.key());
  if (!tile) return false;

  if (tile.type === 'void') return true;
  if (tile.regionType === 'corridor') return true;

  if (tile.regionType === 'room') {
    return allowedRoomIds.has(tile.roomId);
  }

  return false;
}

function buildGreedyStepCandidates(current, goal) {
  const currentDist = hexDistance(current, goal);
  const out = [];

  for (let dir = 0; dir < HEX_DIRS.length; dir += 1) {
    const d = HEX_DIRS[dir];
    const next = new Hex(current.q + d.q, current.r + d.r);
    const dist = hexDistance(next, goal);

    if (dist < currentDist) {
      out.push({ hex: next, dir, dist });
    }
  }

  return out;
}

function angularDirDelta(a, b) {
  if (a == null || b == null) return 0;
  const raw = Math.abs(a - b);
  return Math.min(raw, 6 - raw);
}

function sortStepCandidates(candidates, prevDir, variant = 'straight_first') {
  const items = [...candidates];

  items.sort((a, b) => {
    if (a.dist !== b.dist) return a.dist - b.dist;

    const da = angularDirDelta(a.dir, prevDir);
    const db = angularDirDelta(b.dir, prevDir);

    if (variant === 'straight_first') {
      if (da !== db) return da - db;
      return a.dir - b.dir;
    }

    if (variant === 'left_bias') {
      if (da !== db) return da - db;
      return a.dir - b.dir;
    }

    if (variant === 'right_bias') {
      if (da !== db) return da - db;
      return b.dir - a.dir;
    }

    return a.dir - b.dir;
  });

  return items;
}

function carveCorridorCellsBetween(startHex, goalHex, { tiles, allowedRoomIds, variant }) {
  const path = [startHex];
  const visited = new Set([startHex.key()]);
  let current = startHex;
  let prevDir = null;

  const maxSteps = hexDistance(startHex, goalHex) + 24;

  for (let step = 0; step < maxSteps; step += 1) {
    if (current.key() === goalHex.key()) {
      return path;
    }

    let candidates = buildGreedyStepCandidates(current, goalHex);

    candidates = candidates.filter((c) => {
      if (visited.has(c.hex.key())) return false;
      return isCorridorStepAllowed(c.hex, tiles, allowedRoomIds);
    });

    if (candidates.length === 0) {
      return null;
    }

    const sorted = sortStepCandidates(candidates, prevDir, variant);
    const picked = sorted[0];

    path.push(picked.hex);
    visited.add(picked.hex.key());
    current = picked.hex;
    prevDir = picked.dir;
  }

  return null;
}

function buildStraightDoorStub(door, length) {
  const delta = HEX_DIRS[door.dir];
  const cells = [];
  let current = door.cell;
  for (let i = 0; i < length; i += 1) {
    current = new Hex(current.q + delta.q, current.r + delta.r);
    cells.push(current);
  }
  return cells;
}

function allCellsAllowed(cells, tiles, allowedRoomIds) {
  return cells.every((cell) => isCorridorStepAllowed(cell, tiles, allowedRoomIds));
}

function appendUniqueCells(target, cells) {
  const seen = new Set(target.map((c) => c.key()));
  for (const cell of cells) {
    if (seen.has(cell.key())) continue;
    target.push(cell);
    seen.add(cell.key());
  }
}

function tryBuildConnectionCorridor(connection, tiles) {
  if (!connection.doorA || !connection.doorB) {
    return {
      success: false,
      corridorId: connection.id,
      cells: [],
      variant: null,
    };
  }

  const allowedRoomIds = new Set([connection.roomAId, connection.roomBId]);
  const stubLength = connection.stubLength ?? 2;
  const stubA = buildStraightDoorStub(connection.doorA, stubLength);
  const stubB = buildStraightDoorStub(connection.doorB, stubLength);

  if (!allCellsAllowed(stubA, tiles, allowedRoomIds) || !allCellsAllowed(stubB, tiles, allowedRoomIds)) {
    return {
      success: false,
      corridorId: connection.id,
      cells: [],
      variant: null,
    };
  }

  const startHex = stubA[stubA.length - 1];
  const goalHex = stubB[stubB.length - 1];
  const variants = ['straight_first', 'left_bias', 'right_bias'];

  for (const variant of variants) {
    const midPath = carveCorridorCellsBetween(startHex, goalHex, {
      tiles,
      allowedRoomIds,
      variant,
    });

    if (!midPath || midPath.length === 0) continue;

    const cells = [];
    appendUniqueCells(cells, stubA);
    appendUniqueCells(cells, midPath.slice(1));
    appendUniqueCells(cells, [...stubB].reverse().slice(1));

    return {
      success: true,
      corridorId: connection.id,
      cells,
      variant,
      stubLength,
    };
  }

  return {
    success: false,
    corridorId: connection.id,
    cells: [],
    variant: null,
  };
}

function paintCorridorToTiles(tiles, corridorCells, corridorId) {
  for (const cell of corridorCells) {
    const tile = tiles.get(cell.key());
    if (!tile) continue;

    if (tile.regionType === 'room') {
      continue;
    }

    tile.type = 'floor';
    tile.regionType = 'corridor';
    tile.corridorId = corridorId;
  }
}

function carveAllConnectionCorridors(tiles, connections) {
  const corridors = [];
  const failedConnections = [];

  for (const connection of connections) {
    const result = tryBuildConnectionCorridor(connection, tiles);
    corridors.push(result);

    if (result.success) {
      paintCorridorToTiles(tiles, result.cells, connection.id);
    } else {
      failedConnections.push(connection.id);
    }
  }

  return { corridors, failedConnections };
}

function floodFillFloor(startHex, tiles) {
  const visited = new Set();
  const queue = [startHex];
  visited.add(startHex.key());

  while (queue.length > 0) {
    const current = queue.shift();

    for (const d of HEX_DIRS) {
      const next = new Hex(current.q + d.q, current.r + d.r);
      const tile = tiles.get(next.key());
      if (!tile) continue;
      if (tile.type !== 'floor') continue;
      if (visited.has(next.key())) continue;

      visited.add(next.key());
      queue.push(next);
    }
  }

  return visited;
}

function validateRoomConnectivity(rooms, tiles, startRoomId) {
  const startRoom = rooms.find((r) => r.id === startRoomId);

  if (!startRoom) {
    return {
      reachableRoomIds: [],
      unreachableRoomIds: rooms.map((r) => r.id),
    };
  }

  const reached = floodFillFloor(startRoom.center, tiles);
  const reachableRoomIds = [];
  const unreachableRoomIds = [];

  for (const room of rooms) {
    if (reached.has(room.center.key())) {
      reachableRoomIds.push(room.id);
    } else {
      unreachableRoomIds.push(room.id);
    }
  }

  return { reachableRoomIds, unreachableRoomIds };
}

export function generateRoomsClassicMap({ radius, rng, params = {} }) {
  const roomCount = params.roomCount ?? 14;
  const roomRadiusMin = params.roomRadiusMin ?? 2;
  const roomRadiusMax = params.roomRadiusMax ?? 4;
  const roomGap = params.roomGap ?? 2;
  const sideJitter = params.sideJitter ?? 1;
  const minSideLength = params.minSideLength ?? 3;
  const doorStubLength = params.doorStubLength ?? 2;

  const tiles = initVoidTiles(radius);
  const rooms = [];
  const forbidden = new Set();

  let tries = 0;
  const maxTries = roomCount * 40;

  while (rooms.length < roomCount && tries < maxTries) {
    tries += 1;

    const baseRadius = rng.int(roomRadiusMin, roomRadiusMax);
    const limits = makeRoomLimits(baseRadius, sideJitter, rng);
    const center = randomWorldCell(radius, rng);
    const cells = buildIrregularHexRoomCells(center, limits);
    const sideLengths = countRoomSideLengths(center, cells, limits);
    if (sideLengths.some((n) => n < minSideLength)) continue;
    if (!canPlaceRoom(cells, forbidden, radius)) continue;

    const room = {
      id: `r${rooms.length}`,
      center,
      baseRadius,
      limits,
      sideLengths,
      cells,
    };
    const boundaryMeta = buildRoomBoundaryMetadata(room);
    room.vertexDoors = boundaryMeta.vertexDoors;
    room.vertexCells = boundaryMeta.vertexCells;
    room.boundaryCells = boundaryMeta.boundaryCells;
    room.edgeCells = boundaryMeta.edgeCells;

    rooms.push(room);
    paintRoomToTiles(tiles, room);

    const padded = expandCells(cells, roomGap);
    for (const key of padded) {
      forbidden.add(key);
    }
  }

  const connectionCandidates = buildRoomConnectionCandidates(rooms);
  const mstConnections = buildMstConnections(rooms, connectionCandidates);
  const connections = addExtraLoopConnections(
    mstConnections,
    connectionCandidates,
    rng,
    params.extraLoopCount ?? 2
  );

  const selectedDoors = assignDoorsToConnections(rooms, connections);
  markSelectedDoorTiles(tiles, selectedDoors);
  for (const connection of connections) {
    connection.stubLength = doorStubLength;
  }
  const { corridors, failedConnections } = carveAllConnectionCorridors(tiles, connections);

  const startRoom = pickStartRoom(rooms);
  const connectivity = validateRoomConnectivity(rooms, tiles, startRoom?.id ?? null);

  const playerStart = startRoom
    ? { q: startRoom.center.q, r: startRoom.center.r, facing: 2 }
    : { q: 0, r: 0, facing: 2 };

  const floor = buildFloorSetFromTiles(tiles);

  return {
    floor,
    tiles,
    playerStart,
    enemies: [],
    meta: {
      family: 'rooms_classic',
      radius,
      floorCount: floor.size,
      params,
    },
    debug: {
      rooms,
      connectionCandidates,
      connections,
      selectedDoors,
      corridors,
      failedConnections,
      connectivity,
      startRoomId: startRoom?.id ?? null,
    },
  };
}
