import { CONFIG } from './config.js';
import { Hex, generateHexDisk } from './hex.js';
import { compileMap } from './map-compile.js';
import { createSourceMap, getSourceCell } from './map-source.js';

export const allWorldCells = generateHexDisk(CONFIG.worldRadius);

function compileRuntimeMap(mapData) {
  if (mapData?.runtimeByKey && mapData?.visualsByKey && mapData?.sourceMap) {
    return mapData;
  }

  if (mapData?.cells) {
    const sourceMap = createSourceMap({
      radius: mapData.radius ?? mapData.meta?.radius ?? CONFIG.worldRadius,
      cells: mapData.cells,
      meta: mapData.meta ?? {},
    });
    return compileMap(sourceMap);
  }

  // mapData が未指定 / 不正な場合は空マップ(全タイル blocked 相当)を返す。
  return compileMap(createSourceMap({
    radius: CONFIG.worldRadius,
    cells: [],
    meta: { family: 'empty' },
  }));
}

let currentMapData = compileRuntimeMap(null);

export function setCurrentMapData(mapData) {
  currentMapData = compileRuntimeMap(mapData);
}

export function getCurrentMapData() {
  return currentMapData;
}

export function keyToHex(key) {
  const [q, r] = key.split(',').map(Number);
  return new Hex(q, r);
}

export function getRuntimeCell(hex) {
  return currentMapData.runtimeByKey.get(hex.key()) ?? null;
}

export function getSourceCellAt(hex) {
  return getSourceCell(currentMapData.sourceMap, hex);
}

export function getVisualCellAt(hex) {
  return currentMapData.visualsByKey.get(hex.key()) ?? null;
}

export function canStandAt(hex) {
  return getRuntimeCell(hex)?.canStand ?? false;
}

export function blocksSightH(hex) {
  return getRuntimeCell(hex)?.blocksSightH ?? true;
}

export function blocksSightD(hex) {
  return getRuntimeCell(hex)?.blocksSightD ?? true;
}

export function getFeature(hex) {
  return getRuntimeCell(hex)?.feature ?? null;
}

export function isFloor(hex) {
  return canStandAt(hex);
}

export function isOpaque(hex) {
  return blocksSightH(hex);
}
