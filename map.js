import { CONFIG } from './config.js';
import { Hex, generateHexDisk } from './hex.js';
import { compileMap, rebuildRuntimeCell } from './map-compile.js';
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

export function getFeature(hex) {
  return getRuntimeCell(hex)?.feature ?? null;
}

// SPEC §7.2, §7.3:
//   canStandAt(hex)                → 方向非依存。effective support が blocked 以外で true
//   canStandAt(hex, fromHeading)   → 方向依存。階段は fromHeading == enterHeading の時だけ true
// v0 では canEnter / canEndTurn を兼ねる(v1 で unstable 導入時に分割)。
export function canStandAt(hex, fromHeading) {
  const runtime = getRuntimeCell(hex);
  if (!runtime || !runtime.canStandAtHere) return false;

  if (fromHeading !== undefined && runtime.feature?.kind === 'stairs') {
    return fromHeading === runtime.feature.params?.enterHeading;
  }
  return true;
}

export function blocksSightH(hex) {
  return getRuntimeCell(hex)?.blocksSightH ?? true;
}

export function blocksSightD(hex) {
  // SPEC §3.2: v0 では常に true を返す。
  return getRuntimeCell(hex)?.blocksSightD ?? true;
}

// SPEC §2.3, §15.1: feature state 変化時の差分更新。
// 呼び出し側は source の feature.state を書き換えた後にこれを呼ぶ。
export function refreshRuntimeCell(hex) {
  return rebuildRuntimeCell(currentMapData, hex);
}

// 便利 API: ドア開閉を 1 関数で。source feature state を書き換え、差分更新する。
export function setDoorState(hex, newState) {
  const source = getSourceCell(currentMapData.sourceMap, hex);
  if (!source || source.feature?.kind !== 'door') return false;
  source.feature.state = newState;
  rebuildRuntimeCell(currentMapData, hex);
  return true;
}
