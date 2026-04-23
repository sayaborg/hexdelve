import { CONFIG } from './config.js';
import { EDGE_DIRECTIONS, getNeighbor, hexDistance } from './hex.js';
import { canStandAt, getFeature } from './map.js';
import { bestFacingToward, computePerception } from './perception.js';

// v0 設計判断 D1/D2/D3(CHANGELOG フェーズ 34):
//   - AI investigate は到達後 3〜5 ターンの探索フェーズを持つ
//   - AI 経路探索失敗が 10 ターン続いたら強制 patrol 復帰
//   - patrol / investigate のランダム歩行は Math.random() を使用(シード再現性非要求)
const INVESTIGATE_MIN_TURNS = 3;
const INVESTIGATE_MAX_TURNS = 5;
const STUCK_FALLBACK_LIMIT = 10;

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pickRandom(array) {
  if (!array.length) return null;
  return array[Math.floor(Math.random() * array.length)];
}

// AI profile を参照して、階段を避ける敵かどうか判定(SPEC §9.4、AI profile は GLOSSARY §3)。
// v0 default_ai は avoidsStairs=true なので、全敵が階段タイルに進入しない。
function shouldAvoidStairs(enemy) {
  return !!CONFIG.aiProfiles[enemy.ai]?.avoidsStairs;
}

function isStairsTile(hex) {
  return getFeature(hex)?.kind === 'stairs';
}

function stepToward(from, to, enemy) {
  const avoidStairs = shouldAvoidStairs(enemy);
  let best = null;
  let bestDistance = Infinity;
  for (let heading = 0; heading < EDGE_DIRECTIONS.length; heading += 1) {
    const next = getNeighbor(from, heading);
    if (!canStandAt(next)) continue;
    if (avoidStairs && isStairsTile(next)) continue;
    const distance = hexDistance(next, to);
    if (distance < bestDistance) {
      best = { next, heading };
      bestDistance = distance;
    }
  }
  return best;
}

// walkable かつ他主体に占有されておらず、avoidsStairs 時は階段でない隣接タイルを列挙。
// patrol / investigate 探索中のランダム歩行で共用する。
function collectWanderCandidates(enemy, occupied) {
  const avoidStairs = shouldAvoidStairs(enemy);
  const candidates = [];
  for (let heading = 0; heading < EDGE_DIRECTIONS.length; heading += 1) {
    const candidate = getNeighbor(enemy.pos, heading);
    if (!canStandAt(candidate)) continue;
    if (avoidStairs && isStairsTile(candidate)) continue;
    if (occupied.has(candidate.key())) continue;
    candidates.push({ next: candidate, heading });
  }
  return candidates;
}

// patrol: ランダムな隣接タイルへ移動(SPEC §9.4)。候補がなければ null。
function choosePatrolStep(enemy, occupied) {
  return pickRandom(collectWanderCandidates(enemy, occupied));
}

function getNoticeResult(state, enemy) {
  const perception = computePerception(enemy.pos, enemy.facing, enemy.perception);
  const playerKey = state.playerPos.key();
  return {
    visible: perception.visible.has(playerKey),
    nearAware: perception.nearAware.has(playerKey),
  };
}

function modeLabel(mode) {
  return {
    patrol: '巡回',
    chase: '追跡',
    investigate: '見失い地点確認',
    return: '帰投',
  }[mode] ?? mode;
}

// plan 結果のヘルパ。stuckCount の管理もここで行う。
function makeMovePlan(enemy, move) {
  enemy.stuckCount = 0;
  return { enemyId: enemy.id, type: 'move', target: move.next, facing: move.heading };
}

function makeWaitPlan(enemy, extra = {}) {
  enemy.stuckCount = (enemy.stuckCount ?? 0) + 1;
  return { enemyId: enemy.id, type: 'wait', ...extra };
}

export function planEnemyActions(state) {
  const occupied = new Set(state.enemies.filter((enemy) => enemy.hp > 0).map((enemy) => enemy.pos.key()));

  return state.enemies.map((enemy) => {
    if (enemy.hp <= 0) return null;

    // 隣接攻撃は stuckCount 管理の対象外(攻撃は「進展」扱い)
    if (hexDistance(enemy.pos, state.playerPos) === 1) {
      enemy.stuckCount = 0;
      return { enemyId: enemy.id, type: 'attack' };
    }

    if (enemy.mode === 'patrol') {
      const move = choosePatrolStep(enemy, occupied);
      if (!move) return makeWaitPlan(enemy);
      return makeMovePlan(enemy, move);
    }

    if (enemy.mode === 'chase' && enemy.lastSeenPlayerPos) {
      const move = stepToward(enemy.pos, enemy.lastSeenPlayerPos, enemy);
      if (!move) return makeWaitPlan(enemy);
      return makeMovePlan(enemy, move);
    }

    if (enemy.mode === 'investigate') {
      // investigateTurnsLeft が null なら未到達、lastSeenPlayerPos へ向かう。
      // 到達判定は updateEnemyAwareness 側で行い、そこで investigateTurnsLeft をセットする。
      // カウンタが走っている間はランダム歩行で周辺を探索、update で毎ターン -1。
      if (enemy.investigateTurnsLeft == null && enemy.lastSeenPlayerPos) {
        const move = stepToward(enemy.pos, enemy.lastSeenPlayerPos, enemy);
        if (!move) return makeWaitPlan(enemy);
        return makeMovePlan(enemy, move);
      }
      const move = choosePatrolStep(enemy, occupied);
      if (!move) return makeWaitPlan(enemy);
      return makeMovePlan(enemy, move);
    }

    if (enemy.mode === 'return') {
      if (enemy.pos.equals(enemy.homePos)) {
        enemy.stuckCount = 0;
        return { enemyId: enemy.id, type: 'wait', facing: enemy.homeFacing ?? enemy.facing };
      }
      const move = stepToward(enemy.pos, enemy.homePos, enemy);
      if (!move) return makeWaitPlan(enemy);
      return makeMovePlan(enemy, move);
    }

    return makeWaitPlan(enemy);
  });
}

export function updateEnemyAwareness(state, hooks) {
  for (const enemy of state.enemies) {
    if (enemy.hp <= 0) continue;

    const previousMode = enemy.mode;
    const notice = getNoticeResult(state, enemy);

    // プレイヤーを知覚: どの state からでも chase へ遷移(stuckCount と investigateTurnsLeft をリセット)
    if (notice.visible || notice.nearAware) {
      enemy.lastSeenPlayerPos = state.cloneHex(state.playerPos);
      enemy.facing = bestFacingToward(enemy.pos, state.playerPos);
      enemy.mode = 'chase';
      enemy.investigateTurnsLeft = null;
      enemy.stuckCount = 0;
      if (previousMode !== 'chase') {
        const source = notice.visible ? '視認' : '近接知覚';
        hooks.pushLog('AI', `敵 ${enemy.name} が${source}でプレイヤーを発見。${modeLabel(previousMode)} → 追跡。`);
      }
      continue;
    }

    // stuckCount フォールバック(設計判断 D2、SPEC §9.4 経路失敗時の最大ターン数):
    //   10 ターン連続で移動できなかった場合、現 state を patrol に強制リセット。
    //   階段上のプレイヤーを avoidsStairs=true の敵が永遠に追ってしまう事態を防ぐ。
    if ((enemy.stuckCount ?? 0) >= STUCK_FALLBACK_LIMIT && previousMode !== 'patrol') {
      enemy.mode = 'patrol';
      enemy.lastSeenPlayerPos = null;
      enemy.investigateTurnsLeft = null;
      enemy.stuckCount = 0;
      enemy.facing = enemy.homeFacing ?? enemy.facing;
      hooks.pushLog('AI', `敵 ${enemy.name} は ${STUCK_FALLBACK_LIMIT} ターン動けず、${modeLabel(previousMode)} → 巡回へフォールバック。`);
      continue;
    }

    if (previousMode === 'chase') {
      enemy.mode = 'investigate';
      enemy.investigateTurnsLeft = null;
      hooks.pushLog('AI', `敵 ${enemy.name} はプレイヤーを見失った。追跡 → 見失い地点確認。`);
      continue;
    }

    if (previousMode === 'investigate') {
      // investigateTurnsLeft が null のまま到達 → 探索カウンタを起動(設計判断 D1)
      if (enemy.investigateTurnsLeft == null && enemy.lastSeenPlayerPos && enemy.pos.equals(enemy.lastSeenPlayerPos)) {
        enemy.investigateTurnsLeft = randomInt(INVESTIGATE_MIN_TURNS, INVESTIGATE_MAX_TURNS);
        hooks.pushLog('AI', `敵 ${enemy.name} は見失い地点に到達。周辺を ${enemy.investigateTurnsLeft} ターン探索。`);
        continue;
      }
      // カウンタ走行中: 毎ターン 1 減、0 以下で return 遷移
      if (enemy.investigateTurnsLeft != null) {
        enemy.investigateTurnsLeft -= 1;
        if (enemy.investigateTurnsLeft <= 0) {
          enemy.mode = 'return';
          enemy.investigateTurnsLeft = null;
          hooks.pushLog('AI', `敵 ${enemy.name} は探索を終えた。見失い地点確認 → 帰投。`);
        }
        continue;
      }
      // 未到達で lastSeenPlayerPos も失っている不正状態 → return へ
      if (!enemy.lastSeenPlayerPos) {
        enemy.mode = 'return';
        continue;
      }
    }

    if (previousMode === 'return' && enemy.pos.equals(enemy.homePos)) {
      enemy.mode = 'patrol';
      enemy.lastSeenPlayerPos = null;
      enemy.facing = enemy.homeFacing ?? enemy.facing;
      hooks.pushLog('AI', `敵 ${enemy.name} は持ち場へ戻った。帰投 → 巡回。`);
    }
  }
}
