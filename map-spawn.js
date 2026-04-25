// 敵 spawn 配置の共通ヘルパ(SPEC §11.3、CHANGELOG フェーズ 49)。
//
// 各 map family の generator から呼ばれ、敵同士距離 6 制約を段階的緩和つきで
// 適用する。各 family の固有ロジック(候補列挙、shuffle、距離降順 sort 等)
// は呼び出し側に閉じる。本ヘルパは「順序が確定した候補列から N 体を距離制約で
// 選ぶ」ことだけに責任を持つ。

import { Hex, hexDistance } from './hex.js';

// 与えられた候補列から、敵同士距離 minDistance 以上を満たす順で count 体まで採用する。
// 候補が尽きたら(または count 達成したら)その時点の chosen を返す。
function pickWithMinDistance(orderedCandidates, count, minDistance) {
  const chosen = [];
  for (const cand of orderedCandidates) {
    const pos = new Hex(cand.q, cand.r);
    const tooClose = chosen.some((c) => hexDistance(pos, new Hex(c.q, c.r)) < minDistance);
    if (tooClose) continue;
    chosen.push(cand);
    if (chosen.length >= count) return chosen;
  }
  return chosen;
}

// SPEC §11.3 の敵 spawn 距離制約を、段階的緩和つきで適用する。
//
// 規約:
//   - 初期は敵同士の最小距離 6 を要求(SPEC §11.3)
//   - count 体に届かなかった場合、距離制約を 5, 4, 3, 2, 1 と緩めて再試行
//   - count 体取れた最大の minDistance で確定する(品質優先)
//   - 距離 1 まで緩めても count 体取れない極端な seed では、それまでに最も多く取れた
//     結果を返す(下限 3 体を満たさない場合がありうるが、v0 の通常 map では発生しない想定)
//
// orderedCandidates: { q, r, ... } の配列。優先順に並んでいることを呼び出し側が保証する
//                    (rng.shuffle 結果、距離降順 sort 後、など)。同じ並びが retry 全段階で
//                    使われるため、seed 再現性が保たれる
// count: 目標体数(3〜5、各 family の rng で決定)
//
// 返り値: 選ばれた候補オブジェクトの配列(orderedCandidates の要素参照を含む)
export function selectEnemiesWithMinDistanceRelaxation(orderedCandidates, count) {
  let best = [];
  for (let minDistance = 6; minDistance >= 1; minDistance -= 1) {
    const chosen = pickWithMinDistance(orderedCandidates, count, minDistance);
    if (chosen.length >= count) return chosen;
    if (chosen.length > best.length) best = chosen;
  }
  return best;
}
