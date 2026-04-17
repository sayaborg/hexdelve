import { CONFIG, LOCAL_MOVE_LABELS } from './config.js';
import { Hex, cloneHex, DIRECTION_LABELS, getNeighbor } from './hex.js';
import { allWorldCells, buildWorldFromFixedDefinition, isFloor, setCurrentMapData } from './map.js';
import { FIXED_MAPS, getFixedMapById } from './fixed-maps.js';
import { createRng } from './rng.js';
import { generateCaveMap } from './map-family-cave.js';
import { generateNaturalCaveMap } from './map-family-cave-natural.js';
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
  previewFacing: 2,
  committedFacing: 2,
  visible: new Set(),
  nearAware: new Set(),
  explored: new Set(),
  playerHP: 8,
  playerMaxHP: 8,
  playerWt: 10,
  gameOver: false,
  enemies: [],
  currentMapId: CONFIG.defaultGeneratedMapId ?? CONFIG.defaultFixedMapId,
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
  const perception = computePerception(state.playerPos, state.committedFacing, 'player');
  state.visible = perception.visible;
  state.nearAware = perception.nearAware;
  for (const key of state.visible) {
    state.explored.add(key);
  }
  for (const key of state.nearAware) {
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
  pushLog('TURN', `仮向きを ${DIRECTION_LABELS[state.previewFacing]} に変更。まだターンは進まず、視界も更新されない。`);
  render(state);
}

function localMoveToWorldDirection(localMove) {
  const offsets = [0, -1, -2, 3, 2, 1];
  return (state.previewFacing + offsets[localMove] + 6) % 6;
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
    if (!startOccupied.has(targetKey) && isFloor(playerPlan.target)) {
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
    if (startOccupied.has(targetKey) || !isFloor(plan.target)) continue;
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
  const direction = localMoveToWorldDirection(localMove);
  const target = getNeighbor(state.playerPos, direction);
  let playerPlan = { type: 'wait' };

  commitFacing();
  state.turn += 1;

  if (!state.config || !state.config.worldRadius) {
    throw new Error('config not attached to state');
  }

  const outside = Math.max(Math.abs(target.q), Math.abs(target.r), Math.abs(-target.q - target.r)) > state.config.worldRadius;
  if (outside) {
    pushLog('EDGE', `Turn ${state.turn}: ${LOCAL_MOVE_LABELS[localMove]} へ移動を試みたが、世界外のため進めない。`);
    finishTurn(playerPlan, enemyPlans);
    return;
  }

  const enemy = state.enemies.find((e) => e.pos.equals(target)) || null;
  if (enemy) {
    playerPlan = { type: 'attack', enemyId: enemy.id, localMove };
    finishTurn(playerPlan, enemyPlans);
    return;
  }

  if (!isFloor(target)) {
    pushLog('WALL', `Turn ${state.turn}: ${LOCAL_MOVE_LABELS[localMove]} へ移動を試みたが、q:${target.q} r:${target.r} は壁。`);
    finishTurn(playerPlan, enemyPlans);
    return;
  }

  playerPlan = { type: 'move', target, localMove };
  finishTurn(playerPlan, enemyPlans);
}

function waitAction() {
  if (state.gameOver) {
    return;
  }
  const enemyPlans = planEnemyActions(state);
  commitFacing();
  state.turn += 1;
  pushLog('WAIT', `Turn ${state.turn}: 待機。確定向きは ${DIRECTION_LABELS[state.committedFacing]}。`);
  finishTurn({ type: 'wait' }, enemyPlans);
}

function buildEnemiesFromEntries(entries = []) {
  return entries.map((enemy, index) => ({
    id: enemy.id ?? `e${index + 1}`,
    name: enemy.name ?? 'Watcher',
    pos: new Hex(enemy.q, enemy.r),
    homePos: new Hex(enemy.q, enemy.r),
    facing: enemy.facing ?? 2,
    homeFacing: enemy.facing ?? 2,
    hp: enemy.hp ?? 3,
    maxHp: enemy.maxHp ?? 3,
    wt: enemy.wt ?? 10,
    profile: enemy.profile ?? 'watcher',
    mode: 'patrol',
    lastSeenPlayerPos: null,
  }));
}

function buildEnemiesFromDefinition(definition) {
  return buildEnemiesFromEntries(definition.enemies);
}


function getGeneratedPreset(mapId = null) {
  const generatedMaps = state.config.generatedMaps ?? {};
  const resolvedId = mapId ?? state.config.defaultGeneratedMapId;
  return generatedMaps[resolvedId] ?? generatedMaps[state.config.defaultGeneratedMapId] ?? null;
}

function isGeneratedMapId(mapId) {
  return Boolean(getGeneratedPreset(mapId));
}

function generateMapFromPreset(mapId) {
  const preset = getGeneratedPreset(mapId);
  if (!preset) {
    throw new Error(`Unknown generated map preset: ${mapId}`);
  }
  const rng = createRng(preset.seed ?? 12345);
  if (preset.family === 'cave_natural') {
    return generateNaturalCaveMap({ radius: state.config.worldRadius, rng, params: preset.params ?? {} });
  }
  return generateCaveMap({ radius: state.config.worldRadius, rng, params: preset.params ?? {} });
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
    } else {
      const definition = getFixedMapById(state.currentMapId);
      mapMeta.textContent = definition.description ?? '';
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

  for (const map of FIXED_MAPS) {
    const option = document.createElement('option');
    option.value = map.id;
    option.textContent = map.name;
    mapSelect.appendChild(option);
  }
  updateMapUi();
}

function resetRunWithGeneratedMap(mapId = state.config.defaultGeneratedMapId, { keepLog = false } = {}) {
  const generated = generateMapFromPreset(mapId);
  const preset = getGeneratedPreset(mapId);

  setCurrentMapData({ floor: generated.floor });

  state.currentMapId = mapId;
  state.currentMapName = buildGeneratedMapLabel(mapId);
  state.playerPos = new Hex(generated.playerStart.q, generated.playerStart.r);
  state.previewFacing = generated.playerStart.facing ?? 2;
  state.committedFacing = generated.playerStart.facing ?? 2;
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

  pushLog('MAP', `${state.currentMapName} を生成。family ${generated.meta.family} / floor ${generated.meta.floorCount} / radius ${generated.meta.radius}。`);
  pushLog('GEN', `${JSON.stringify(preset?.params ?? generated.meta.params)}`);
  pushLog('KEY', '← / → で回頭、Q/W/E/A/S/D = 左前 / 前 / 右前 / 左後 / 後 / 右後。');
}

function resetRunWithFixedMap(mapId, { keepLog = false } = {}) {
  const definition = getFixedMapById(mapId);
  const world = buildWorldFromFixedDefinition(definition);
  setCurrentMapData(world);

  state.currentMapId = definition.id;
  state.currentMapName = definition.name;
  state.playerPos = new Hex(definition.playerStart.q, definition.playerStart.r);
  state.previewFacing = definition.playerStart.facing;
  state.committedFacing = definition.playerStart.facing;
  state.visible = new Set();
  state.nearAware = new Set();
  state.explored = new Set();
  state.playerHP = state.playerMaxHP;
  state.gameOver = false;
  state.turn = 0;
  state.enemies = buildEnemiesFromDefinition(definition);

  if (!keepLog) {
    clearLog();
  }

  refreshVisibility();
  updateEnemyAwareness(state, { pushLog });
  updateMapUi();
  render(state);

  pushLog('MAP', `${definition.name} をロード。${definition.description}`);
  pushLog('KEY', '← / → で回頭、Q/W/E/A/S/D = 左前 / 前 / 右前 / 左後 / 後 / 右後。');
}

function bootstrap() {
  bindControls({
    rotatePreview,
    tryMove,
    waitAction,
    onSelectMap: (mapId) => {
      if (isGeneratedMapId(mapId)) {
        resetRunWithGeneratedMap(mapId);
      } else {
        resetRunWithFixedMap(mapId);
      }
    },
    onResetMap: () => {
      if (isGeneratedMapId(state.currentMapId)) {
        resetRunWithGeneratedMap(state.currentMapId);
      } else {
        resetRunWithFixedMap(state.currentMapId);
      }
    },
  });
  bindKeyboard({ rotatePreview, tryMove });
  setupMapUi();
  if (CONFIG.defaultMapMode === 'generated') {
    resetRunWithGeneratedMap(CONFIG.defaultGeneratedMapId, { keepLog: true });
  } else {
    resetRunWithFixedMap(CONFIG.defaultFixedMapId, { keepLog: true });
  }
  pushLog('INIT', 'Split Prototype を初期化。固定マップと複数の生成Caveを切替可能。');
  pushLog('LOS', '中心→中心を基準にし、境界曖昧ケースは 3 本線のうち 1 本でも通れば可視。');
  pushLog('FOV', 'プレイヤーも敵も前方120度FOV + LOS + 近接知覚で認識する。');
  pushLog('RULE', '回頭はゼロターンで情報を増やさず、移動や待機で初めて視界更新が走る。');
  pushLog('DEBUG', '試用のため敵ステータスは右パネルへ全公開。');
}

bootstrap();
