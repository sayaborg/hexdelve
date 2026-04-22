import { Hex } from './hex.js';

export function createSourceMap({ radius, cells, meta = {} }) {
  const cellsByKey = new Map();
  for (const cell of cells) {
    const hex = new Hex(cell.q, cell.r);
    cellsByKey.set(hex.key(), {
      q: cell.q,
      r: cell.r,
      support: cell.support ?? 'stable',
      structureKind: cell.structureKind ?? 'room',
      feature: cell.feature ?? null,
      meta: cell.meta ?? {},
    });
  }
  return { radius, meta, cellsByKey };
}

export function getSourceCell(sourceMap, hex) {
  return sourceMap.cellsByKey.get(hex.key()) ?? null;
}
