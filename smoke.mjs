// SPEC 整合性 smoke test(CHANGELOG フェーズ 49 / 50)。
//
// 検査項目:
// (1) 敵 spawn 配置の SPEC §11.3 整合性(フェーズ 49 で追加)
//     絶対違反: 敵が 3 体未満、playerStart から hexDistance < 5 の敵
//     品質情報: 敵同士最小距離分布(段階的緩和の発生状況)
// (2) 初期階段の進入可能性(フェーズ 50 で追加)
//     絶対違反: opposite(enterHeading) 方向の隣接が床でない seed
//     (= プレイヤーがその床から階段に入れない、ゲーム進行不可)
//
// 全 family の全 seed が「絶対違反 0 件」であることを必須要件とする
// (CHANGELOG フェーズ 38.5 の宿題:巻き戻り検出スクリプト)。

import { generateCaveMap } from './map-family-cave.js';
import { generateNaturalCaveMap } from './map-family-cave-natural.js';
import { generateClassicRoomsMap } from './map-family-rooms-classic.js';
import { hexDistance, Hex, EDGE_DIRECTIONS, oppositeHeading } from './hex.js';
import { createRng } from './rng.js';

const SEED_RANGE = 200;

function inspectSpawn(label, gen, seedRange) {
  const stats = {
    countViolation: 0,
    playerDistViolation: 0,
    stairsUnreachable: 0,
    minDistanceHistogram: {},
  };
  const violations = [];

  for (let seed = 1; seed <= seedRange; seed++) {
    let map;
    try {
      const rng = createRng(seed);
      map = gen({ rng });
    } catch (e) {
      violations.push(`${label} seed=${seed} ERROR: ${e.message}`);
      stats.countViolation++;
      continue;
    }

    // (1) 敵 spawn 検査
    const enemies = map.enemies || [];
    if (enemies.length < 3) {
      violations.push(`${label} seed=${seed} enemies=${enemies.length} (< 3 体下限)`);
      stats.countViolation++;
    }
    const playerStart = map.playerStart;
    if (playerStart) {
      const origin = new Hex(playerStart.q, playerStart.r);
      for (const e of enemies) {
        const d = hexDistance(origin, new Hex(e.q, e.r));
        if (d < 5) {
          violations.push(`${label} seed=${seed} enemy at (${e.q},${e.r}) dist=${d} (player から < 5)`);
          stats.playerDistViolation++;
        }
      }
    }
    let minDist = Infinity;
    for (let i = 0; i < enemies.length; i++) {
      for (let j = i + 1; j < enemies.length; j++) {
        const d = hexDistance(new Hex(enemies[i].q, enemies[i].r), new Hex(enemies[j].q, enemies[j].r));
        if (d < minDist) minDist = d;
      }
    }
    if (minDist !== Infinity) {
      stats.minDistanceHistogram[minDist] = (stats.minDistanceHistogram[minDist] || 0) + 1;
    }

    // (2) 階段進入可能性検査(SPEC §4.3、CHANGELOG フェーズ 50)
    const stairs = (map.cells || []).find((c) => c.feature?.kind === 'stairs');
    if (stairs) {
      const enterHeading = stairs.feature.params.enterHeading;
      // プレイヤーが階段に入るには、opposite(enterHeading) 方向の隣接床から
      // enterHeading 方向に移動する必要がある。
      const offset = EDGE_DIRECTIONS[oppositeHeading(enterHeading)];
      const fromQ = stairs.q + offset.q;
      const fromR = stairs.r + offset.r;
      const fromCell = (map.cells || []).find((c) => c.q === fromQ && c.r === fromR);
      const fromIsFloor = fromCell && fromCell.support === 'stable' && !fromCell.feature;
      if (!fromIsFloor) {
        violations.push(`${label} seed=${seed} stairs (${stairs.q},${stairs.r}) enter=${enterHeading}, 進入元 (${fromQ},${fromR}) が床ではない`);
        stats.stairsUnreachable++;
      }
    }
  }

  console.log(`\n--- ${label} (seed 1..${seedRange}) ---`);
  console.log(`  絶対違反: 数下限=${stats.countViolation}, player 距離=${stats.playerDistViolation}, 階段進入不能=${stats.stairsUnreachable}`);
  const hist = Object.entries(stats.minDistanceHistogram)
    .sort(([a], [b]) => Number(b) - Number(a))
    .map(([d, count]) => `dist=${d}: ${count}`)
    .join(', ');
  console.log(`  敵同士最小距離分布: ${hist}`);
  for (const v of violations.slice(0, 10)) {
    console.log(`  ⚠️  ${v}`);
  }
  if (violations.length > 10) {
    console.log(`  ⚠️  ... 他 ${violations.length - 10} 件`);
  }

  return stats;
}

console.log('=== SPEC 整合性検査(seed 1..' + SEED_RANGE + ')===');
const total = {
  countViolation: 0,
  playerDistViolation: 0,
  stairsUnreachable: 0,
};
for (const [label, gen] of [
  ['rooms_classic', generateClassicRoomsMap],
  ['cave_walk    ', generateCaveMap],
  ['cave_natural ', generateNaturalCaveMap],
]) {
  const stats = inspectSpawn(label, gen, SEED_RANGE);
  total.countViolation += stats.countViolation;
  total.playerDistViolation += stats.playerDistViolation;
  total.stairsUnreachable += stats.stairsUnreachable;
}

console.log('\n=== 総合 ===');
console.log(`絶対違反合計: 数下限=${total.countViolation}, player 距離=${total.playerDistViolation}, 階段進入不能=${total.stairsUnreachable}`);
const totalViolations = total.countViolation + total.playerDistViolation + total.stairsUnreachable;
if (totalViolations === 0) {
  console.log('✅ SPEC 絶対要件は全 seed で充足');
  process.exit(0);
} else {
  console.log('❌ SPEC 絶対要件に違反する seed あり');
  process.exit(1);
}
