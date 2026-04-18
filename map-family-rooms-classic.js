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

function buildHexRoomCells(center, roomRadius) {
  const cells = [];
  for (let dq = -roomRadius; dq <= roomRadius; dq += 1) {
    for (let dr = -roomRadius; dr <= roomRadius; dr += 1) {
      const ds = -dq - dr;
      const dist = Math.max(Math.abs(dq), Math.abs(dr), Math.abs(ds));
      if (dist > roomRadius) continue;
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
  for (const cell of room.cells) {
    const tile = tiles.get(cell.key());
    if (!tile) continue;
    tile.type = 'floor';
    tile.regionType = 'room';
    tile.roomId = room.id;
  }
}

function buildRoomPerimeter(room) {
  const roomCellSet = new Set(room.cells.map((c) => c.key()));
  const perimeter = [];

  for (const cell of room.cells) {
    for (let dir = 0; dir < HEX_DIRS.length; dir += 1) {
      const delta = HEX_DIRS[dir];
      const outside = new Hex(cell.q + delta.q, cell.r + delta.r);
      if (roomCellSet.has(outside.key())) continue;
      perimeter.push({ roomId: room.id, cell, dir, outside });
    }
  }

  return perimeter;
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

function pickNearestDoorPair(roomA, roomB) {
  let best = null;

  for (const edgeA of roomA.perimeter) {
    for (const edgeB of roomB.perimeter) {
      const dist = hexDistance(edgeA.outside, edgeB.outside);
      if (!best || dist < best.distance) {
        best = { distance: dist, doorA: edgeA, doorB: edgeB };
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

    const pair = pickNearestDoorPair(roomA, roomB);
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

export function generateRoomsClassicMap({ radius, rng, params = {} }) {
  const roomCount = params.roomCount ?? 14;
  const roomRadiusMin = params.roomRadiusMin ?? 2;
  const roomRadiusMax = params.roomRadiusMax ?? 4;
  const roomGap = params.roomGap ?? 2;

  const tiles = initVoidTiles(radius);
  const rooms = [];
  const forbidden = new Set();

  let tries = 0;
  const maxTries = roomCount * 30;

  while (rooms.length < roomCount && tries < maxTries) {
    tries += 1;

    const roomRadius = rng.int(roomRadiusMin, roomRadiusMax);
    const center = randomWorldCell(radius, rng);
    const cells = buildHexRoomCells(center, roomRadius);
    if (!canPlaceRoom(cells, forbidden, radius)) continue;

    const room = { id: `r${rooms.length}`, center, radius: roomRadius, cells };
    rooms.push(room);
    paintRoomToTiles(tiles, room);

    const padded = expandCells(cells, roomGap);
    for (const key of padded) {
      forbidden.add(key);
    }
  }

  for (const room of rooms) {
    room.perimeter = buildRoomPerimeter(room);
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

  const startRoom = pickStartRoom(rooms);
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
      startRoomId: startRoom?.id ?? null,
    },
  };
}
