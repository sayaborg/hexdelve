import { Hex } from './hex.js';

function defaultSightH(support) {
  return support === 'blocked' ? 'block' : 'pass';
}

function defaultSightD(_support) {
  // v0 では sightD は常に block として運用(SPEC §3.2, §7.2)
  return 'block';
}

export function createSourceMap({ radius, cells, meta = {} }) {
  const cellsByKey = new Map();
  for (const cell of cells) {
    const hex = new Hex(cell.q, cell.r);
    const support = cell.support ?? 'stable';
    cellsByKey.set(hex.key(), {
      q: cell.q,
      r: cell.r,
      support,
      sightH: cell.sightH ?? defaultSightH(support),
      sightD: cell.sightD ?? defaultSightD(support),
      structureKind: cell.structureKind ?? null,
      feature: cell.feature ?? null,
      meta: cell.meta ?? {},
    });
  }
  return { radius, meta, cellsByKey };
}

export function getSourceCell(sourceMap, hex) {
  return sourceMap.cellsByKey.get(hex.key()) ?? null;
}
