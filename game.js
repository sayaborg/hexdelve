import { CONFIG, LOCAL_MOVE_LABELS } from './config.js';
import { Hex, cloneHex, HEADING_LABELS, EDGE_DIRECTIONS, getNeighbor, oppositeHeading } from './hex.js';
import { allWorldCells, canStandAt, getFeature, setDoorState, setCurrentMapData } from './map.js';
import { createRng } from './rng.js';
import { generateCaveMap } from './map-family-cave.js';
import { generateNaturalCaveMap } from './map-family-cave-natural.js';
import { generateClassicRoomsMap } from './map-family-rooms-classic.js';
import { computePerception, bestFacingToward } from './perception.js';
import { planEnemyActions, updateEnemyAwareness } from './enemy-ai.js';
import { render } from './render.js';
import { bindControls, bindKeyboard } from './input.js';

const state = {
  config: CONFIG,
  allWorldCells,
  cloneHex,
  turn: 0,
  playerPos: new Hex(0, 0),
  previewFacing: 0,
  committedFacing: 0,
  visible: new Set(),
  nearAware: new Set(),
  explored: new Set(),
  playerHP: 8,
  playerMaxHP: 8,
  playerWt: 10,
  gameOver: false,
  enemies: [],
  currentMapId: CONFIG.defaultGeneratedMapId,
  currentMapName: '',
};

function getLogElement() {
  return document.getElementById('log');
}

function clearLog() {
  const log = getLogElement();
  if (log) {
    log.innerHTML = '';
  }
}

function pushLog(tag, message) {
  const log = getLogElement();
  if (!log) return;
  const line = document.createElement('div');
  line.className = 'log-entry';
  line.innerHTML = `<span class="tag">${tag}</span>${message}`;
  log.prepend(line);
}

function refreshVisibility() {
  const perception = computePerception(state.playerPos, state.committedFacing, CONFIG.player.perception);
  state.visible = perception.visible;
  state.nearAware = perception.nearAware;
  for (const key of state.visible) {
    state.explored.add(key);
  }
}

function commitFacing() {
  state.committedFacing = state.previewFacing;
}

function rotatePreview(delta) {
  if (state.gameOver) {
    return;
  }
  state.previewFacing = (state.previewFacing + delta + 6) % 6;
  pushLog('TURN', `仮向きを ${HEADING_LABELS[state.previewFacing]} に変更。まだターンは進まず、視界も更新されない。`);
  render(state);
}

function localMoveToWorldHeading(localMove) {
  // 新規則(heading 0=N、時計回り)では
  //   localMove 0=前     → facing + 0
  //             1=右前   → facing + 1
  //             2=右後   → facing + 2
  //             3=後     → facing + 3
  //             4=左後   → facing + 4
  //             5=左前   → facing + 5
  // LOCAL_MOVE_LABELS の順序と自然に一致する。
  return (state.previewFacing + localMove) % 6;
}

function removeDeadEnemies() {
  state.enemies = state.enemies.filter((enemy) => enemy.hp > 0);
}

function playerAttack(enemy, localMove) {
  enemy.hp -= 1;
  pushLog('ATK', `Turn ${state.turn}: ${LOCAL_MOVE_LABELS[localMove]} の敵 ${enemy.name} を攻撃。1 ダメージ。残HP ${Math.max(enemy.hp, 0)}。`);
  if (enemy.hp <= 0) {
    pushLog('KILL', `${enemy.name} を倒した。`);
    removeDeadEnemies();
  }
}

function enemyAttackPlayer(enemy) {
  enemy.facing = bestFacingToward(enemy.pos, state.playerPos);
  state.playerHP -= 1;
  pushLog('DMG', `敵 ${enemy.name} が攻撃。プレイヤーは 1 ダメージ。残HP ${Math.max(state.playerHP, 0)}。`);
  if (state.playerHP <= 0) {
    state.gameOver = true;
    pushLog('OVER', 'プレイヤーは倒れた。GAME OVER。');
  }
}

function livingEnemies() {
  return state.enemies.filter((enemy) => enemy.hp > 0);
}

function getStartOccupiedKeys() {
  const occupied = new Set();
  if (!state.gameOver && state.playerHP > 0) {
    occupied.add(state.playerPos.key());
  }
  for (const enemy of livingEnemies()) {
    occupied.add(enemy.pos.key());
  }
  return occupied;
}

function buildMoveCandidates(playerPlan, enemyPlans) {
  const candidates = [];
  const startOccupied = getStartOccupiedKeys();

  if (!state.gameOver && playerPlan.type === 'move' && playerPlan.target) {
    const targetKey = playerPlan.target.key();
    if (!startOccupied.has(targetKey) && canStandAt(playerPlan.target)) {
      candidates.push({
        actorType: 'player',
        actorId: 'player',
        name: 'player',
        wt: state.playerWt,
        target: playerPlan.target,
        localMove: playerPlan.localMove,
      });
    }
  }

  for (const plan of enemyPlans) {
    if (!plan || plan.type !== 'move' || !plan.target) continue;
    const enemy = state.enemies.find((entry) => entry.id === plan.enemyId) || null;
    if (!enemy || enemy.hp <= 0) continue;
    const targetKey = plan.target.key();
    if (startOccupied.has(targetKey) || !canStandAt(plan.target)) continue;
    candidates.push({
      actorType: 'enemy',
      actorId: enemy.id,
      name: enemy.name,
      wt: enemy.wt,
      target: plan.target,
      facing: plan.facing,
    });
  }

  return candidates;
}

function resolveMovePhase(playerPlan, enemyPlans) {
  for (const plan of enemyPlans) {
    if (!plan) continue;
    const enemy = state.enemies.find((entry) => entry.id === plan.enemyId) || null;
    if (!enemy || enemy.hp <= 0) continue;
    if (typeof plan.facing === 'number') {
      enemy.facing = plan.facing;
    }
  }

  const candidates = buildMoveCandidates(playerPlan, enemyPlans);
  const byTarget = new Map();
  for (const candidate of candidates) {
    const key = candidate.target.key();
    if (!byTarget.has(key)) {
      byTarget.set(key, []);
    }
    byTarget.get(key).push(candidate);
  }

  const winners = new Map();
  const contestedLosers = new Set();

  for (const [targetKey, group] of byTarget.entries()) {
    if (group.length === 1) {
      winners.set(group[0].actorId, group[0]);
      continue;
    }

    let bestWt = Infinity;
    for (const entry of group) {
      if (entry.wt < bestWt) {
        bestWt = entry.wt;
      }
    }
    const bestEntries = group.filter((entry) => entry.wt === bestWt);
    if (bestEntries.length === 1) {
      winners.set(bestEntries[0].actorId, bestEntries[0]);
      for (const entry of group) {
        if (entry.actorId !== bestEntries[0].actorId) {
          contestedLosers.add(entry.actorId);
        }
      }
      continue;
    }

    for (const entry of group) {
      contestedLosers.add(entry.actorId);
    }
    const labels = group.map((entry) => `${entry.actorType === 'player' ? 'P' : entry.actorId}(wt:${entry.wt})`).join(' / ');
    pushLog('CLASH', `同一空きマス q:${group[0].target.q} r:${group[0].target.r} への進入競合。${labels} は同wtのため全員足踏み。`);
  }

  if (playerPlan.type === 'move' && playerPlan.target) {
    const winner = winners.get('player');
    if (winner) {
      state.playerPos = winner.target;
      pushLog('MOVE', `Turn ${state.turn}: ${LOCAL_MOVE_LABELS[playerPlan.localMove]} へ移動し、q:${state.playerPos.q} r:${state.playerPos.r} に到達。`);
    } else if (contestedLosers.has('player')) {
      pushLog('CLASH', `Turn ${state.turn}: ${LOCAL_MOVE_LABELS[playerPlan.localMove]} への進入は空きマス競合で敗北。player(wt:${state.playerWt}) は足踏み。`);
    }
  }

  for (const enemy of state.enemies) {
    if (enemy.hp <= 0) continue;
    const winner = winners.get(enemy.id);
    if (winner) {
      enemy.pos = winner.target;
    }
  }
}

function resolveAttackPhase(playerPlan, enemyPlans) {
  if (playerPlan.type === 'attack' && playerPlan.enemyId) {
    const enemy = state.enemies.find((entry) => entry.id === playerPlan.enemyId) || null;
    if (enemy && enemy.hp > 0) {
      playerAttack(enemy, playerPlan.localMove);
    }
  }

  for (const plan of enemyPlans) {
    if (!plan || plan.type !== 'attack') continue;
    const enemy = state.enemies.find((entry) => entry.id === plan.enemyId) || null;
    if (!enemy || enemy.hp <= 0 || state.gameOver) continue;
    enemyAttackPlayer(enemy);
  }
}

function finishTurn(playerPlan, enemyPlans) {
  resolveAttackPhase(playerPlan, enemyPlans);

  if (!state.gameOver) {
    resolveMovePhase(playerPlan, enemyPlans);
  }

  refreshVisibility();
  updateEnemyAwareness(state, { pushLog });
  render(state);
}

function tryMove(localMove) {
  if (state.gameOver) {
    return;
  }

  const enemyPlans = planEnemyActions(state);
  const heading = localMoveToWorldHeading(localMove);
  const target = getNeighbor(state.playerPos, heading);
  let playerPlan = { type: 'wait' };

  if (!state.config || !state.config.worldRadius) {
    throw new Error('config not attached to state');
  }

  // 階段上にいる場合の方向別挙動(SPEC §7.4, §9.7):
  //   heading == exitHeading          → pre-exit 発動 = フロア遷移
  //   heading == opposite(enterHeading) → 通常の引き返し(下の通常移動ロジックへ)
  //   その他                           → 壁扱い(通過型階段の「支援されない方向」)
  const currentFeature = getFeature(state.playerPos);
  if (currentFeature?.kind === 'stairs') {
    const stairsParams = currentFeature.params;
    if (heading === stairsParams.exitHeading) {
      // pre-exit: 攻撃・移動フェーズをスキップして即フロア遷移。
      // 意思決定時点の敵 plan は新フロアには持ち越さない(仕様上 enemies は全破棄)。
      commitFacing();
      state.turn += 1;
      pushLog('STAIRS', `Turn ${state.turn}: ${stairsParams.verticalMode === 'up' ? '上り' : '下り'}階段を使用。`);
      transitionFloor();
      return;
    }
    if (heading !== oppositeHeading(stairsParams.enterHeading)) {
      // 階段は通過型。enterHeading (= exitHeading) と opposite(enterHeading) の 2 方向以外は壁扱い。
      commitFacing();
      state.turn += 1;
      pushLog('WALL', `Turn ${state.turn}: 階段上から ${LOCAL_MOVE_LABELS[localMove]} 方向へは動けない。`);
      finishTurn(playerPlan, enemyPlans);
      return;
    }
    // opposite(enterHeading) 方向は通常の移動として処理(下に流れる)
  }

  const outside = Math.max(Math.abs(target.q), Math.abs(target.r), Math.abs(-target.q - target.r)) > state.config.worldRadius;
  if (outside) {
    commitFacing();
    state.turn += 1;
    pushLog('EDGE', `Turn ${state.turn}: ${LOCAL_MOVE_LABELS[localMove]} へ移動を試みたが、世界外のため進めない。`);
    finishTurn(playerPlan, enemyPlans);
    return;
  }

  const enemy = state.enemies.find((e) => e.pos.equals(target)) || null;
  if (enemy) {
    commitFacing();
    state.turn += 1;
    playerPlan = { type: 'attack', enemyId: enemy.id, localMove };
    finishTurn(playerPlan, enemyPlans);
    return;
  }

  // pre-enter アクション(SPEC §5, §9.6, TURN_RULES §4.4):
  //   target が effective=blocked かつ feature=door の場合、feature state により挙動分岐。
  //   closed → open に変更して 1 ターン消費、プレイヤー位置不変。
  //   locked → ログのみ出してターン消費なし(v0 では解錠手段がないため親切仕様)。
  const targetFeature = getFeature(target);
  if (!canStandAt(target, heading) && targetFeature?.kind === 'door') {
    if (targetFeature.state === 'closed') {
      commitFacing();
      state.turn += 1;
      setDoorState(target, 'open');
      pushLog('DOOR', `Turn ${state.turn}: ${LOCAL_MOVE_LABELS[localMove]} のドアを開けた。`);
      finishTurn(playerPlan, enemyPlans);
      return;
    }
    if (targetFeature.state === 'locked') {
      commitFacing();
      // ターン消費なし。仮向きを確定向きに反映するだけ。
      pushLog('DOOR', `${LOCAL_MOVE_LABELS[localMove]} のドアには鍵がかかっている。`);
      render(state);
      return;
    }
  }

  if (!canStandAt(target, heading)) {
    commitFacing();
    state.turn += 1;
    pushLog('WALL', `Turn ${state.turn}: ${LOCAL_MOVE_LABELS[localMove]} へ移動を試みたが、q:${target.q} r:${target.r} は壁。`);
    finishTurn(playerPlan, enemyPlans);
    return;
  }

  commitFacing();
  state.turn += 1;
  playerPlan = { type: 'move', target, localMove };
  finishTurn(playerPlan, enemyPlans);
}

// フロア遷移(SPEC §9.9, §12.5): 旧 state を破棄して対応階段契約で新フロアを生成。
// HP は引き継ぎ、turn は継続、explored / visible / nearAware / enemies はリセット。
function transitionFloor() {
  const oldStairs = getFeature(state.playerPos);
  if (oldStairs?.kind !== 'stairs') {
    throw new Error('transitionFloor called off stairs');
  }
  const oldExitHeading = oldStairs.params.exitHeading;
  const oldVerticalMode = oldStairs.params.verticalMode;

  // 対応階段契約(SPEC §9.9、物理モデル):
  //   旧フロアでプレイヤーは exitHeading 方向に階段を通過して出た。
  //   新フロアでは、プレイヤーが出てきた方向 = opposite(旧 exitHeading) が
  //   新階段の「入口側」になる。よって新 enterHeading = opposite(旧 exitHeading)。
  //   通過型なので新 exitHeading = 新 enterHeading。
  //   新 verticalMode は物理的に反対(up ↔ down)。
  const newEnterHeading = oppositeHeading(oldExitHeading);
  const newVerticalMode = oldVerticalMode === 'up' ? 'down' : 'up';

  const stairsConstraint = {
    q: state.playerPos.q,
    r: state.playerPos.r,
    enterHeading: newEnterHeading,
    verticalMode: newVerticalMode,
  };

  // 新 seed(疑似乱数)で新マップ生成。同じプリセット(family, params)だが seed は変える。
  const newSeed = Math.floor(Math.random() * 1_000_000_000) + state.turn;
  const newRng = createRng(newSeed);
  const newMap = generateMapFromPreset(state.currentMapId, stairsConstraint, newRng);
  setCurrentMapData(newMap);

  // プレイヤー再配置(generator が返した playerStart に従う)
  state.playerPos = new Hex(newMap.playerStart.q, newMap.playerStart.r);
  state.committedFacing = newMap.playerStart.facing ?? oldExitHeading;
  state.previewFacing = state.committedFacing;

  // 状態リセット(HP / maxHP / turn は引き継ぎ)
  state.enemies = buildEnemiesFromEntries(newMap.enemies);
  state.visible = new Set();
  state.nearAware = new Set();
  state.explored = new Set();

  refreshVisibility();
  updateEnemyAwareness(state, { pushLog });
  render(state);
  pushLog('FLOOR', `新フロア生成。階段(${stairsConstraint.q},${stairsConstraint.r})の verticalMode=${newVerticalMode}、enterHeading=${newEnterHeading}。`);
}

function waitAction() {
  if (state.gameOver) {
    return;
  }
  const enemyPlans = planEnemyActions(state);
  commitFacing();
  state.turn += 1;
  pushLog('WAIT', `Turn ${state.turn}: 待機。確定向きは ${HEADING_LABELS[state.committedFacing]}。`);
  finishTurn({ type: 'wait' }, enemyPlans);
}

function buildEnemiesFromEntries(entries = []) {
  return entries.map((entry, index) => {
    const kindId = entry.kind ?? 'watcher';
    const kindDef = CONFIG.enemyKinds[kindId];
    if (!kindDef) {
      throw new Error(`Unknown enemyKind: ${kindId}`);
    }
    return {
      id: entry.id ?? `e${index + 1}`,
      kind: kindId,
      name: entry.name ?? kindDef.name,
      pos: new Hex(entry.q, entry.r),
      homePos: new Hex(entry.q, entry.r),
      facing: entry.facing ?? 0,
      homeFacing: entry.facing ?? 0,
      hp: entry.hp ?? kindDef.hp,
      maxHp: entry.maxHp ?? kindDef.hp,
      wt: entry.wt ?? kindDef.wtRange[0],
      perception: kindDef.perception,
      ai: kindDef.ai,
      damage: kindDef.damage,
      mode: 'patrol',
      lastSeenPlayerPos: null,
    };
  });
}


function getGeneratedPreset(mapId = null) {
  const generatedMaps = state.config.generatedMaps ?? {};
  const resolvedId = mapId ?? state.config.defaultGeneratedMapId;
  return generatedMaps[resolvedId] ?? generatedMaps[state.config.defaultGeneratedMapId] ?? null;
}

function generateMapByFamily(family, { radius, rng, params = {}, stairsConstraint = null }) {
  if (family === 'cave_natural') {
    return generateNaturalCaveMap({ radius, rng, params, stairsConstraint });
  }
  if (family === 'rooms_classic') {
    return generateClassicRoomsMap({ radius, rng, params, stairsConstraint });
  }
  return generateCaveMap({ radius, rng, params, stairsConstraint });
}

function generateMapFromPreset(mapId, stairsConstraint = null, rngOverride = null) {
  const preset = getGeneratedPreset(mapId);
  if (!preset) {
    throw new Error(`Unknown generated map preset: ${mapId}`);
  }
  const rng = rngOverride ?? createRng(preset.seed ?? 12345);
  const params = preset.family === 'rooms_classic'
    ? { seed: preset.seed ?? 12345, ...(preset.params ?? {}) }
    : (preset.params ?? {});
  return generateMapByFamily(preset.family, {
    radius: state.config.worldRadius,
    rng,
    params,
    stairsConstraint,
  });
}

function buildGeneratedMapLabel(mapId) {
  const preset = getGeneratedPreset(mapId);
  if (!preset) return 'Generated map';
  return `${preset.label} (seed:${preset.seed ?? 12345})`;
}

function updateMapUi() {
  const mapSelect = document.getElementById('mapSelect');
  const mapMeta = document.getElementById('mapMeta');
  if (mapSelect) {
    mapSelect.value = state.currentMapId;
  }
  if (mapMeta) {
    if (state.currentMapId === 'generated_cave_walk') {
      mapMeta.textContent = '歩行掘削型Cave。連結掘削 + 控えめなふくらみ + 軽いループ追加。';
    } else if (state.currentMapId === 'generated_cave_natural') {
      mapMeta.textContent = '自然洞窟寄りCave。Cellular Automata で塊を作り、最大連結成分のみ採用。';
    } else if (state.currentMapId === 'generated_rooms_classic') {
      mapMeta.textContent = 'semantic-v2 rooms family。room / corridor / threshold / door を持つ canonical classic rooms。';
    } else {
      mapMeta.textContent = '';
    }
  }
}

function setupMapUi() {
  const mapSelect = document.getElementById('mapSelect');
  if (!mapSelect) return;

  mapSelect.innerHTML = '';

  for (const mapId of Object.keys(state.config.generatedMaps ?? {})) {
    const option = document.createElement('option');
    option.value = mapId;
    option.textContent = buildGeneratedMapLabel(mapId);
    mapSelect.appendChild(option);
  }

  updateMapUi();
}

function resetRunWithGeneratedMap(mapId = state.config.defaultGeneratedMapId, { keepLog = false } = {}) {
  const generated = generateMapFromPreset(mapId);
  const preset = getGeneratedPreset(mapId);

  setCurrentMapData(generated);

  state.currentMapId = mapId;
  state.currentMapName = buildGeneratedMapLabel(mapId);
  state.playerPos = new Hex(generated.playerStart.q, generated.playerStart.r);
  state.previewFacing = generated.playerStart.facing ?? 0;
  state.committedFacing = generated.playerStart.facing ?? 0;
  state.visible = new Set();
  state.nearAware = new Set();
  state.explored = new Set();
  state.playerHP = state.playerMaxHP;
  state.gameOver = false;
  state.turn = 0;
  state.enemies = buildEnemiesFromEntries(generated.enemies);

  if (!keepLog) {
    clearLog();
  }

  refreshVisibility();
  updateEnemyAwareness(state, { pushLog });
  updateMapUi();
  render(state);

  const standableCount = generated.meta.floorCount ?? generated.floor?.size ?? generated.cells?.filter((cell) => cell.support === 'stable').length ?? 0;
  pushLog('MAP', `${state.currentMapName} を生成。family ${generated.meta.family} / standable ${standableCount} / radius ${generated.meta.radius}。`);
  pushLog('GEN', `${JSON.stringify(preset?.params ?? generated.meta.params)}`);
  pushLog('KEY', '← / → で回頭、Q/W/E/A/S/D = 左前 / 前 / 右前 / 左後 / 後 / 右後。');
}

function bootstrap() {
  bindControls({
    rotatePreview,
    tryMove,
    waitAction,
    onSelectMap: (mapId) => {
      resetRunWithGeneratedMap(mapId);
    },
    onResetMap: () => {
      resetRunWithGeneratedMap(state.currentMapId);
    },
  });
  bindKeyboard({ rotatePreview, tryMove });
  setupMapUi();
  resetRunWithGeneratedMap(CONFIG.defaultGeneratedMapId, { keepLog: true });
  pushLog('INIT', 'Split Prototype を初期化。生成マップ(rooms_classic / cave_walk / cave_natural)のみ利用可能。');
  pushLog('LOS', '中心→中心を基準にし、境界曖昧ケースは 3 本線のうち 1 本でも通れば可視。');
  pushLog('FOV', 'プレイヤーも敵も前方120度FOV + LOS + 近接知覚で認識する。');
  pushLog('RULE', '回頭はゼロターンで情報を増やさず、移動や待機で初めて視界更新が走る。');
  pushLog('DEBUG', '試用のため敵ステータスは右パネルへ全公開。');
}

bootstrap();
