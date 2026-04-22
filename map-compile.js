function buildBaseToken(sourceCell) {
  if (!sourceCell) return 'void';
  if (sourceCell.feature?.kind === 'door') {
    return sourceCell.feature.state === 'open' ? 'door-open' : 'door-closed';
  }
  if (sourceCell.structureKind === 'threshold') return 'threshold';
  if (sourceCell.structureKind === 'corridor') return 'corridor';
  if (sourceCell.support === 'stable') return 'room';
  return 'wall';
}

export function compileMap(sourceMap) {
  const runtimeByKey = new Map();
  const visualsByKey = new Map();

  for (const [key, sourceCell] of sourceMap.cellsByKey.entries()) {
    const isClosedDoor = sourceCell.feature?.kind === 'door' && sourceCell.feature.state === 'closed';
    const supportStable = sourceCell.support === 'stable';
    const canStand = supportStable && !isClosedDoor;
    const blocksSightH = !supportStable || isClosedDoor;
    const blocksSightD = blocksSightH;

    runtimeByKey.set(key, {
      canStand,
      blocksSightH,
      blocksSightD,
      feature: sourceCell.feature ?? null,
      structureKind: sourceCell.structureKind ?? null,
    });
    visualsByKey.set(key, {
      baseToken: buildBaseToken(sourceCell),
      structureKind: sourceCell.structureKind ?? null,
      feature: sourceCell.feature ?? null,
    });
  }

  return {
    radius: sourceMap.radius,
    meta: sourceMap.meta,
    sourceMap,
    runtimeByKey,
    visualsByKey,
  };
}
