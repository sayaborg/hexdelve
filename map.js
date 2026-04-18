import { CONFIG } from './config.js';
import { Hex, generateHexDisk, isInsideWorld } from './hex.js';

export const allWorldCells = generateHexDisk(CONFIG.worldRadius);

function normalizeCell(cell) {
  return Array.isArray(cell) ? new Hex(cell[0], cell[1]) : cell;
}

export function buildFloorSetFromCells(cells) {
  const floor = new Set();
  for (const raw of cells) {
    const cell = normalizeCell(raw);
    if (isInsideWorld(cell, CONFIG.worldRadius)) {
      floor.add(cell.key());
    }
  }
  return floor;
}

export function createDefaultTile(q, r) {
  return {
    q,
    r,
    type: 'void',
    regionType: null,
    roomId: null,
    corridorId: null,
    sideTypes: ['wall', 'wall', 'wall', 'wall', 'wall', 'wall'],
  };
}

export function buildTilesFromFloorSet(floorSet) {
  const tiles = new Map();
  for (const cell of allWorldCells) {
    const key = cell.key();
    const tile = createDefaultTile(cell.q, cell.r);
    if (floorSet.has(key)) {
      tile.type = 'floor';
    }
    tiles.set(key, tile);
  }
  return tiles;
}

export function buildFloorSetFromTiles(tiles) {
  const floor = new Set();
  for (const [key, tile] of tiles.entries()) {
    if (tile.type === 'floor') {
      floor.add(key);
    }
  }
  return floor;
}

export function buildWorldFromFixedDefinition(definition) {
  const floor = buildFloorSetFromCells(definition.floorCells);
  return {
    floor,
    tiles: buildTilesFromFloorSet(floor),
  };
}

let currentMapData = { floor: new Set(), tiles: new Map() };

export function setCurrentMapData(mapData) {
  const next = { ...mapData };

  if (!next.tiles) {
    next.tiles = buildTilesFromFloorSet(next.floor ?? new Set());
  }
  if (!next.floor) {
    next.floor = buildFloorSetFromTiles(next.tiles);
  }

  currentMapData = next;
}

export function getCurrentMapData() {
  return currentMapData;
}

export function keyToHex(key) {
  const [q, r] = key.split(',').map(Number);
  return new Hex(q, r);
}

export function getTile(hex) {
  return currentMapData.tiles?.get(hex.key()) ?? null;
}

export function isFloor(hex) {
  const tile = getTile(hex);
  if (tile) return tile.type === 'floor';
  return currentMapData.floor.has(hex.key());
}

export function isOpaque(hex) {
  return !isFloor(hex);
}
