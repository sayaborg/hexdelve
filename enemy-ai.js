import { DIRECTIONS, getNeighbor, hexDistance } from './hex.js';
import { isFloor } from './map.js';
import { bestFacingToward, computePerception } from './perception.js';

function stepToward(from, to) {
  let best = null;
  let bestDistance = Infinity;
  for (let direction = 0; direction < DIRECTIONS.length; direction += 1) {
    const next = getNeighbor(from, direction);
    if (!isFloor(next)) continue;
    const distance = hexDistance(next, to);
    if (distance < bestDistance) {
      best = { next, direction };
      bestDistance = distance;
    }
  }
  return best;
}

function choosePatrolStep(enemy, occupied) {
  const priority = [0, -1, 1, -2, 2, 3];
  for (const delta of priority) {
    const direction = (enemy.facing + delta + 6) % 6;
    const candidate = getNeighbor(enemy.pos, direction);
    if (!isFloor(candidate)) continue;
    if (occupied.has(candidate.key())) continue;
    return { next: candidate, direction };
  }
  return null;
}

function getNoticeResult(state, enemy) {
  const perception = computePerception(enemy.pos, enemy.facing, enemy.profile ?? 'watcher');
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

export function planEnemyActions(state) {
  const occupied = new Set(state.enemies.filter((enemy) => enemy.hp > 0).map((enemy) => enemy.pos.key()));

  return state.enemies.map((enemy) => {
    if (enemy.hp <= 0) return null;

    if (hexDistance(enemy.pos, state.playerPos) === 1) {
      return { enemyId: enemy.id, type: 'attack' };
    }

    if (enemy.mode === 'patrol') {
      const move = choosePatrolStep(enemy, occupied);
      if (!move) {
        return { enemyId: enemy.id, type: 'wait' };
      }
      return {
        enemyId: enemy.id,
        type: 'move',
        target: move.next,
        facing: move.direction,
      };
    }

    if ((enemy.mode === 'chase' || enemy.mode === 'investigate') && enemy.lastSeenPlayerPos) {
      const move = stepToward(enemy.pos, enemy.lastSeenPlayerPos);
      if (!move) {
        return { enemyId: enemy.id, type: 'wait' };
      }
      return {
        enemyId: enemy.id,
        type: 'move',
        target: move.next,
        facing: move.direction,
      };
    }

    if (enemy.mode === 'return') {
      if (enemy.pos.equals(enemy.homePos)) {
        return { enemyId: enemy.id, type: 'wait', facing: enemy.homeFacing ?? enemy.facing };
      }
      const move = stepToward(enemy.pos, enemy.homePos);
      if (!move) {
        return { enemyId: enemy.id, type: 'wait' };
      }
      return {
        enemyId: enemy.id,
        type: 'move',
        target: move.next,
        facing: move.direction,
      };
    }

    return { enemyId: enemy.id, type: 'wait' };
  });
}

export function executeEnemyActions(state, plans, hooks) {
  const occupied = new Set(state.enemies.filter((enemy) => enemy.hp > 0).map((enemy) => enemy.pos.key()));

  for (const plan of plans) {
    if (!plan) continue;
    const enemy = state.enemies.find((entry) => entry.id === plan.enemyId);
    if (!enemy || enemy.hp <= 0) continue;

    occupied.delete(enemy.pos.key());

    if (typeof plan.facing === 'number') {
      enemy.facing = plan.facing;
    }

    if (plan.type !== 'move' || !plan.target) {
      occupied.add(enemy.pos.key());
      continue;
    }

    const targetKey = plan.target.key();
    if (state.playerPos.equals(plan.target)) {
      enemy.facing = bestFacingToward(enemy.pos, state.playerPos);
      hooks.enemyAttackPlayer(enemy);
      occupied.add(enemy.pos.key());
      continue;
    }

    if (!isFloor(plan.target) || occupied.has(targetKey)) {
      occupied.add(enemy.pos.key());
      continue;
    }

    enemy.pos = plan.target;
    occupied.add(enemy.pos.key());
  }
}

export function updateEnemyAwareness(state, hooks) {
  for (const enemy of state.enemies) {
    if (enemy.hp <= 0) continue;

    const previousMode = enemy.mode;
    const notice = getNoticeResult(state, enemy);

    if (notice.visible || notice.nearAware) {
      enemy.lastSeenPlayerPos = state.cloneHex(state.playerPos);
      enemy.facing = bestFacingToward(enemy.pos, state.playerPos);
      enemy.mode = 'chase';
      if (previousMode !== 'chase') {
        const source = notice.visible ? '視認' : '近接知覚';
        hooks.pushLog('AI', `敵 ${enemy.name} が${source}でプレイヤーを発見。${modeLabel(previousMode)} → 追跡。`);
      }
      continue;
    }

    if (previousMode === 'chase') {
      enemy.mode = 'investigate';
      hooks.pushLog('AI', `敵 ${enemy.name} はプレイヤーを見失った。追跡 → 見失い地点確認。`);
      continue;
    }

    if (previousMode === 'investigate' && enemy.lastSeenPlayerPos && enemy.pos.equals(enemy.lastSeenPlayerPos)) {
      enemy.mode = 'return';
      hooks.pushLog('AI', `敵 ${enemy.name} は見失い地点を確認。見失い地点確認 → 帰投。`);
      continue;
    }

    if (previousMode === 'return' && enemy.pos.equals(enemy.homePos)) {
      enemy.mode = 'patrol';
      enemy.lastSeenPlayerPos = null;
      enemy.facing = enemy.homeFacing ?? enemy.facing;
      hooks.pushLog('AI', `敵 ${enemy.name} は持ち場へ戻った。帰投 → 巡回。`);
    }
  }
}
