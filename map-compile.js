// SPEC §2.3 / §6:
// resolve は source cell + feature state から effective 値を求める pure function。
// 近傍情報を参照しない。タイル単位で完結する。
//
// v0 で扱う feature:
//   - door: state='closed' | 'locked' → effective を blocked / block に降格(§6.2)
//          state='open' → 基底そのまま
//   - stairs: state='normal' のみ、基底そのまま(方向制約は canStandAt で扱う、§6.3)
export function resolve(sourceCell) {
  const baseSupport = sourceCell.support;
  const baseSightH = sourceCell.sightH;
  const baseSightD = sourceCell.sightD;
  const feature = sourceCell.feature;

  if (feature?.kind === 'door') {
    if (feature.state === 'closed' || feature.state === 'locked') {
      return {
        support: 'blocked',
        sightH: 'block',
        sightD: 'block',
      };
    }
    // open は基底のまま
  }

  return {
    support: baseSupport,
    sightH: baseSightH,
    sightD: baseSightD,
  };
}

// runtimeCell の構築(1 セル分)。resolve を適用し、Query 用に正規化したフィールド名で返す。
// フィールド名は canStandAtHere(関数 canStandAt と区別、GLOSSARY §5)。
function buildRuntimeCell(sourceCell) {
  const effective = resolve(sourceCell);
  return {
    canStandAtHere: effective.support !== 'blocked',
    blocksSightH: effective.sightH === 'block',
    blocksSightD: effective.sightD === 'block',
    feature: sourceCell.feature ?? null,
    structureKind: sourceCell.structureKind ?? null,
  };
}

// visualsByKey 向け baseToken は state 非依存(SPEC §7.1, §15.8)。
// 見た目の state 差(closed/open/locked、up/down 等)は render が runtime.feature から読み取る。
function buildBaseToken(sourceCell) {
  if (!sourceCell) return 'void';
  if (sourceCell.feature?.kind === 'door') return 'door';
  if (sourceCell.feature?.kind === 'stairs') return 'stairs';
  if (sourceCell.structureKind === 'threshold') return 'threshold';
  if (sourceCell.structureKind === 'corridor') return 'corridor';
  if (sourceCell.structureKind === 'cave') return 'room';  // v0 は cave も通常床扱いで描画
  if (sourceCell.support === 'stable') return 'room';
  return 'wall';
}

function buildVisualCell(sourceCell) {
  return {
    baseToken: buildBaseToken(sourceCell),
    structureKind: sourceCell.structureKind ?? null,
    feature: sourceCell.feature ?? null,
  };
}

export function compileMap(sourceMap) {
  const runtimeByKey = new Map();
  const visualsByKey = new Map();

  for (const [key, sourceCell] of sourceMap.cellsByKey.entries()) {
    runtimeByKey.set(key, buildRuntimeCell(sourceCell));
    visualsByKey.set(key, buildVisualCell(sourceCell));
  }

  return {
    radius: sourceMap.radius,
    meta: sourceMap.meta,
    sourceMap,
    runtimeByKey,
    visualsByKey,
  };
}

// 差分更新(SPEC §2.3, §15.1):
// feature state が変化した時、該当タイル 1 つだけを再 resolve する。
// 近傍タイルは影響を受けない(resolve は近傍非参照の pure function のため)。
// visualsByKey は state 非依存のため、ここでは触らない。
export function rebuildRuntimeCell(mapData, hex) {
  const key = hex.key();
  const sourceCell = mapData.sourceMap.cellsByKey.get(key);
  if (!sourceCell) return null;
  const runtime = buildRuntimeCell(sourceCell);
  mapData.runtimeByKey.set(key, runtime);
  return runtime;
}
