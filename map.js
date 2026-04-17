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

export function buildWorldFromFixedDefinition(definition) {
  return {
    floor: buildFloorSetFromCells(definition.floorCells),
  };
}

let currentMapData = { floor: new Set() };

export function setCurrentMapData(mapData) {
  currentMapData = mapData;
}

export function getCurrentMapData() {
  return currentMapData;
}

export function keyToHex(key) {
  const [q, r] = key.split(',').map(Number);
  return new Hex(q, r);
}

export function isFloor(hex) {
  return currentMapData.floor.has(hex.key());
}

export function isOpaque(hex) {
  return !isFloor(hex);
}
