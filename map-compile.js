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

  // v1-0b.1.9(フェーズ 61.1): door / door_lock 両方に同じロジックを適用。
  // door_lock は v1-0b では生成されないが、コード経路を完備しておく(v1 で鍵 item と
  // 同時に生成復活時、resolve / getTileSprite が即座に動作することを保証)。
  // 鍵保持判定や「鍵を持っているなら closed の door_lock を開けられる」等の細かい挙動は
  // v1 で入力処理側で扱う(resolve は物理的な「閉まっていれば通れない」だけを表現)。
  if (feature?.kind === 'door' || feature?.kind === 'door_lock') {
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
//
// v1-0b.1.6(フェーズ 58): family 別タイルセット対応。
// v1-0b.1.8(フェーズ 60): 命名整流 — family は rooms / tunnel / cavern、structureKind は
//   'floor' / 'wall' / 'corridor' / 'threshold' に統一。
// v1-0b.1.9(フェーズ 61): 全 kind に family prefix 適用。door は lock 機構ありなしで
//   feature.kind を 'door' / 'door_lock' に分離。corridor / threshold / door / stairs も
//   {family}_xxx 形式で family ごとに別タイルとして扱う(family 不明時は generic fallback)。
function buildBaseToken(sourceCell) {
  if (!sourceCell) return 'void';
  const family = sourceCell.meta?.family ?? null;
  const fp = family ? `${family}_` : '';  // family prefix(family 不明時は空 = generic kind)

  // feature ベース(door / door_lock / stairs)
  if (sourceCell.feature?.kind === 'door')      return `${fp}door`;
  if (sourceCell.feature?.kind === 'door_lock') return `${fp}door_lock`;
  if (sourceCell.feature?.kind === 'stairs')    return `${fp}stairs`;

  // structureKind ベース(threshold / corridor / floor / wall)
  if (sourceCell.structureKind === 'threshold') return `${fp}threshold`;
  if (sourceCell.structureKind === 'corridor')  return `${fp}corridor`;
  if (sourceCell.structureKind === 'floor' || sourceCell.support === 'stable') {
    return `${fp}floor`;
  }
  if (sourceCell.structureKind === 'wall' || sourceCell.support === 'blocked') {
    return `${fp}wall`;
  }
  return 'void';
}

// v1-0a(NEXT_STEPS §2.1): (q, r) ベースの決定的 hash。
// 同じ座標は常に同じ値を返す(seed 非依存、map 生成の再実行で値が動かない)。
// variant(4 種)/ rotation(6 方向)の派生値算出に使用。
function hashQR(q, r, salt) {
  let h = (q * 73856093) ^ (r * 19349663) ^ salt;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

function buildVisualCell(sourceCell) {
  return {
    baseToken: buildBaseToken(sourceCell),
    structureKind: sourceCell.structureKind ?? null,
    feature: sourceCell.feature ?? null,
    // v1-0a: タイル描画バリエーション(4 種)× 回転(6 方向)の派生値。
    //   - source 依存、feature.state 非依存(描画側で state を合成)
    //   - programmatic 描画では弱く反映(論点 B 合意)、v1-0b の PNG 差し替えで本格稼働
    variant: hashQR(sourceCell.q, sourceCell.r, 0x9e3779b9) & 3,
    rotation: hashQR(sourceCell.q, sourceCell.r, 0x85ebca6b) % 6,
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
