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
import { bindControls, bindKeyboard, bindMainCanvasGestures } from './input.js';

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
  playerHP: CONFIG.player.hp,
  playerMaxHP: CONFIG.player.maxHp,
  playerWt: CONFIG.player.wt,
  gameOver: false,
  enemies: [],
  currentMapId: CONFIG.defaultGeneratedMapId,
  currentMapName: '',
  currentSeed: null,
  // v1-0a(NEXT_STEPS §2.1): debug overlay トグル。
  //   F3 でトグル。OFF 時は internal channel の log / enemy_status_box の視界外情報を隠す。
  //   S1 時点ではフラグのみ追加、実際の出し分けは S3(log)/S4(enemy_status_box)/S5(render)で反映。
  debugOverlay: false,
};

function getLogElement() {
  return document.getElementById('log');
}

// v1-0a(NEXT_STEPS §2.1、論点 A 合意 2026-04-24): 構造化 log entry 設計。
//   entry = { turn, category, tag, source: { kind, channel, fidelity }, text, structured? }
//   channel = 'vision' | 'internal'(v2+ で 'audition', 'presence' 等追加)
//   fidelity = 'certain' のみ v1-0a で使用(省略時デフォルト、v2+ で 'partial' 等追加)
//   通常表示 = vision のみ、debug overlay ON で internal も表示。
//
// 実装: logEntries 配列(newest-first、上限 300)を module-level で保持。
// push 時は可視性を判定して DOM に prepend(軽量)、
// debug overlay トグル時は全再構築。
const LOG_ENTRY_LIMIT = 300;
const logEntries = [];

function isEntryVisible(entry) {
  return entry.source.channel !== 'internal' || state.debugOverlay;
}

function appendEntryDom(entry, { prepend = true } = {}) {
  const log = getLogElement();
  if (!log) return;
  if (!isEntryVisible(entry)) return;
  const line = document.createElement('div');
  line.className = `log-entry log-${entry.source.channel}`;
  line.innerHTML = `<span class="tag">${entry.tag}</span>${entry.text}`;
  if (prepend) log.prepend(line);
  else log.appendChild(line);
}

function rebuildLogDom() {
  const log = getLogElement();
  if (!log) return;
  log.innerHTML = '';
  // logEntries は newest-first。DOM 上も上から newest に並べる → 配列順に appendChild。
  for (const entry of logEntries) {
    appendEntryDom(entry, { prepend: false });
  }
}

function clearLog() {
  logEntries.length = 0;
  const log = getLogElement();
  if (log) log.innerHTML = '';
}

function pushLogEntry(entry) {
  const normalized = {
    turn: entry.turn ?? state.turn,
    category: entry.category,
    tag: entry.tag,
    source: {
      kind: entry.source?.kind ?? 'system',
      channel: entry.source?.channel ?? 'vision',
      fidelity: entry.source?.fidelity ?? 'certain',
    },
    text: entry.text,
    structured: entry.structured ?? null,
  };
  logEntries.unshift(normalized);
  if (logEntries.length > LOG_ENTRY_LIMIT) logEntries.length = LOG_ENTRY_LIMIT;
  appendEntryDom(normalized, { prepend: true });
}

// 書きやすさのための薄いラッパ。kind のデフォルトは呼び出し文脈で決定。
function logVision(category, tag, text, { structured = null, kind = 'player_action' } = {}) {
  pushLogEntry({ category, tag, source: { kind, channel: 'vision' }, text, structured });
}

function logInternal(category, tag, text, { structured = null, kind = 'system' } = {}) {
  pushLogEntry({ category, tag, source: { kind, channel: 'internal' }, text, structured });
}

// enemy-ai.js に渡す hook。AI 状態遷移は常に internal / ai_state / certain 固定。
function logAiTransition(text, structured = null) {
  pushLogEntry({
    category: 'ai',
    tag: 'AI',
    source: { kind: 'ai_state', channel: 'internal' },
    text,
    structured,
  });
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
  logInternal('rotation', 'TURN', `仮向きを ${HEADING_LABELS[state.previewFacing]} に変更。まだターンは進まず、視界も更新されない。`, { kind: 'player_action' });
  render(state);
}

// v1-0a(S8+S9): スワイプ回頭用の絶対値セッタ。ドラッグ中の多数回更新で log を汚さないよう
// { silent: true } オプションで log 抑制可能。final 確定は commitSwipeFacing で 1 回だけ log。
function setPreviewFacing(newFacing, { silent = false } = {}) {
  if (state.gameOver) return;
  const normalized = ((newFacing % 6) + 6) % 6;
  if (state.previewFacing === normalized) return;
  state.previewFacing = normalized;
  if (!silent) {
    logInternal('rotation', 'TURN', `仮向きを ${HEADING_LABELS[state.previewFacing]} に変更。まだターンは進まず、視界も更新されない。`, { kind: 'player_action' });
  }
  render(state);
}

function getCurrentPreviewFacing() {
  return state.previewFacing;
}

// v1-0a(S8+S9): スワイプ終了時の確定 log。pointermove 中の silent 更新を 1 回に集約。
function commitSwipeFacing() {
  if (state.gameOver) return;
  logInternal('rotation', 'TURN', `仮向きを ${HEADING_LABELS[state.previewFacing]} に変更(スワイプ)。まだターンは進まず、視界も更新されない。`, { kind: 'player_action' });
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
  // ダメージは CONFIG.player.damage 参照(v0 は固定 1、SPEC §9.8)。
  enemy.hp -= CONFIG.player.damage;
  logVision('combat', 'ATK', `Turn ${state.turn}: ${LOCAL_MOVE_LABELS[localMove]} の敵 ${enemy.name} を攻撃。${CONFIG.player.damage} ダメージ。残HP ${Math.max(enemy.hp, 0)}。`);
  if (enemy.hp <= 0) {
    logVision('combat', 'KILL', `${enemy.name} を倒した。`);
    // 除去は resolveAttackPhase 終了後に一括(相打ち原則のため、
    // ここで除去すると同ターンの後続敵攻撃で find が null を返してしまう)。
  }
}

function enemyAttackPlayer(enemy) {
  // 敵のダメージは敵 kind の damage 参照(watcher = 1)。
  const damage = CONFIG.enemyKinds[enemy.kind]?.damage ?? 1;
  enemy.facing = bestFacingToward(enemy.pos, state.playerPos);
  state.playerHP -= damage;
  logVision('combat', 'DMG', `敵 ${enemy.name} が攻撃。プレイヤーは ${damage} ダメージ。残HP ${Math.max(state.playerHP, 0)}。`, { kind: 'enemy_action' });
  // gameOver 判定は resolveAttackPhase の最後に一括(相打ち原則のため、
  // ここで gameOver を立てると後続の敵攻撃がスキップされてしまう)。
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
    // プレイヤー関与なしの敵同士 CLASH は主ログに出さない。
    // プレイヤーの壁ログなど他の情報と混在して混乱するため(ログ 1 ターン複数行の整理)。
    const hasPlayer = group.some((entry) => entry.actorType === 'player');
    if (hasPlayer) {
      const labels = group.map((entry) => `${entry.actorType === 'player' ? 'P' : entry.actorId}(wt:${entry.wt})`).join(' / ');
      logVision('movement', 'CLASH', `同一空きマス q:${group[0].target.q} r:${group[0].target.r} への進入競合。${labels} は同wtのため全員足踏み。`);
    }
  }

  if (playerPlan.type === 'move' && playerPlan.target) {
    const winner = winners.get('player');
    if (winner) {
      state.playerPos = winner.target;
      logVision('movement', 'MOVE', `Turn ${state.turn}: ${LOCAL_MOVE_LABELS[playerPlan.localMove]} へ移動し、q:${state.playerPos.q} r:${state.playerPos.r} に到達。`);
    } else if (contestedLosers.has('player')) {
      logVision('movement', 'CLASH', `Turn ${state.turn}: ${LOCAL_MOVE_LABELS[playerPlan.localMove]} への進入は空きマス競合で敗北。player(wt:${state.playerWt}) は足踏み。`);
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
  // 相打ち原則(SPEC §9.8, TURN_RULES §3.6):
  //   意思決定時点で plan された攻撃は、主体がそのターン内で死亡しても全て発動する。
  //   HP ≤ 0 や gameOver のチェックは攻撃フェーズ中は行わない。

  // プレイヤー攻撃
  if (playerPlan.type === 'attack' && playerPlan.enemyId) {
    const enemy = state.enemies.find((entry) => entry.id === playerPlan.enemyId) || null;
    if (enemy) {
      playerAttack(enemy, playerPlan.localMove);
    }
  }

  // 敵攻撃(意思決定時点で plan を持っていた敵全員が発動)
  for (const plan of enemyPlans) {
    if (!plan || plan.type !== 'attack') continue;
    const enemy = state.enemies.find((entry) => entry.id === plan.enemyId) || null;
    if (!enemy) continue;
    enemyAttackPlayer(enemy);
  }

  // 全攻撃解決後に死亡処理を一括で(SPEC §9.8, TURN_RULES §3.5)。
  // 敵除去は移動フェーズ前に行うため、除去タイルは空きマスとして扱われる。
  removeDeadEnemies();

  // プレイヤー死亡判定
  if (state.playerHP <= 0 && !state.gameOver) {
    state.gameOver = true;
    logVision('system', 'OVER', 'プレイヤーは倒れた。GAME OVER。', { kind: 'system' });
  }
}

function finishTurn(playerPlan, enemyPlans) {
  resolveAttackPhase(playerPlan, enemyPlans);

  if (!state.gameOver) {
    resolveMovePhase(playerPlan, enemyPlans);
  }

  refreshVisibility();
  updateEnemyAwareness(state, { aiTransition: logAiTransition });
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
      // pre-exit: 意思決定時点の敵攻撃を先に解決(相打ち原則)。
      // フロア遷移後は敵が全て破棄されるため、遷移前に攻撃処理を済ませる必要がある。
      commitFacing();
      state.turn += 1;
      logVision('interact', 'STAIRS', `Turn ${state.turn}: ${stairsParams.verticalMode === 'up' ? '上り' : '下り'}階段を使用。`);
      resolveAttackPhase({ type: 'wait' }, enemyPlans);
      if (state.gameOver) {
        render(state);
      } else {
        transitionFloor();
      }
      return;
    }
    if (heading !== oppositeHeading(stairsParams.enterHeading)) {
      // 階段は通過型。enterHeading (= exitHeading) と opposite(enterHeading) の 2 方向以外は壁扱い。
      commitFacing();
      state.turn += 1;
      logVision('movement', 'WALL', `Turn ${state.turn}: 階段上から ${LOCAL_MOVE_LABELS[localMove]} 方向へは動けない。`);
      finishTurn(playerPlan, enemyPlans);
      return;
    }
    // opposite(enterHeading) 方向は通常の移動として処理(下に流れる)
  }

  const outside = Math.max(Math.abs(target.q), Math.abs(target.r), Math.abs(-target.q - target.r)) > state.config.worldRadius;
  if (outside) {
    commitFacing();
    state.turn += 1;
    logVision('movement', 'EDGE', `Turn ${state.turn}: ${LOCAL_MOVE_LABELS[localMove]} へ移動を試みたが、世界外のため進めない。`);
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
      logVision('interact', 'DOOR', `Turn ${state.turn}: ${LOCAL_MOVE_LABELS[localMove]} のドアを開けた。`);
      finishTurn(playerPlan, enemyPlans);
      return;
    }
    if (targetFeature.state === 'locked') {
      commitFacing();
      // ターン消費なし。仮向きを確定向きに反映するだけ。
      logVision('interact', 'DOOR', `${LOCAL_MOVE_LABELS[localMove]} のドアには鍵がかかっている。`);
      render(state);
      return;
    }
  }

  if (!canStandAt(target, heading)) {
    commitFacing();
    state.turn += 1;
    logVision('movement', 'WALL', `Turn ${state.turn}: ${LOCAL_MOVE_LABELS[localMove]} へ移動を試みたが、q:${target.q} r:${target.r} は壁。`);
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
  const newSeed = (Math.floor(Math.random() * 1_000_000_000) + state.turn) >>> 0;
  const newMap = generateMapFromPreset(state.currentMapId, stairsConstraint, newSeed);
  setCurrentMapData(newMap);
  state.currentSeed = newSeed;
  state.currentMapName = buildGeneratedMapLabel(state.currentMapId, newSeed);

  // プレイヤー再配置(位置は generator が返した playerStart、facing は遷移前の値を保持)
  state.playerPos = new Hex(newMap.playerStart.q, newMap.playerStart.r);
  // committedFacing は遷移前の値をそのまま保持(SPEC §9.9、フェーズ 37 改訂)。
  //   階段通過で顔の向きは変わらない = 後退で階段を通過した場合も facing は後ろ向きのまま。
  //   generator.playerStart.facing は初期フロア(新規ラン開始)用の値なので、遷移時は無視する。
  // previewFacing は committedFacing と同値にリセット(未確定仮向きをクリア)。
  state.previewFacing = state.committedFacing;

  // 状態リセット(HP / maxHP / turn は引き継ぎ)
  state.enemies = buildEnemiesFromEntries(newMap.enemies);
  state.visible = new Set();
  state.nearAware = new Set();
  state.explored = new Set();
  // 通過してきた階段は既知扱いで explored に追加(SPEC §9.9)。
  // そうしないと、プレイヤー背後の階段が未知=真っ黒で描画され、
  // 「階段がない」ようにユーザーに見えてしまう。
  state.explored.add(`${stairsConstraint.q},${stairsConstraint.r}`);

  refreshVisibility();
  updateEnemyAwareness(state, { aiTransition: logAiTransition });
  render(state);
  logInternal('system', 'FLOOR', `新フロア生成。階段(${stairsConstraint.q},${stairsConstraint.r})の verticalMode=${newVerticalMode}、enterHeading=${newEnterHeading}。`);
}

function waitAction() {
  if (state.gameOver) {
    return;
  }
  const enemyPlans = planEnemyActions(state);
  commitFacing();
  state.turn += 1;
  logVision('movement', 'WAIT', `Turn ${state.turn}: 待機。確定向きは ${HEADING_LABELS[state.committedFacing]}。`);
  finishTurn({ type: 'wait' }, enemyPlans);
}

// v1-0a(NEXT_STEPS §2.1): debug overlay のトグル。
//   ゲームオーバー時もトグル可能(デバッグ用途)。
//   internal channel の log 表示切替のため、log の DOM を全再構築する。
function toggleDebugOverlay() {
  state.debugOverlay = !state.debugOverlay;
  logInternal('system', 'DEBUG', `debug overlay ${state.debugOverlay ? 'ON' : 'OFF'}。`);
  rebuildLogDom();
  render(state);
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
      // AI 状態追加フィールド(CHANGELOG フェーズ 34):
      //   investigateTurnsLeft: 見失い地点到達後の探索残ターン(null=未起動 or 未到達)
      //   stuckCount:           経路失敗・wait 連続カウンタ。10 で patrol フォールバック
      investigateTurnsLeft: null,
      stuckCount: 0,
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

// generateMapFromPreset:
//   mapId: マップ種別 ID
//   stairsConstraint: フロア遷移時のみ非 null。対応階段の配置制約。
//   seed: このマップを生成するための seed(v0 設計判断 D4: 初期は Date.now()、
//         URL ?seed=N で上書き、フロア遷移は Math.random 由来)
function generateMapFromPreset(mapId, stairsConstraint = null, seed) {
  const preset = getGeneratedPreset(mapId);
  if (!preset) {
    throw new Error(`Unknown generated map preset: ${mapId}`);
  }
  const resolvedSeed = seed >>> 0;
  const rng = createRng(resolvedSeed);
  const params = preset.family === 'rooms_classic'
    ? { seed: resolvedSeed, ...(preset.params ?? {}) }
    : (preset.params ?? {});
  return generateMapByFamily(preset.family, {
    radius: state.config.worldRadius,
    rng,
    params,
    stairsConstraint,
  });
}

function buildGeneratedMapLabel(mapId, seed) {
  const preset = getGeneratedPreset(mapId);
  if (!preset) return 'Generated map';
  const shownSeed = seed ?? state.currentSeed ?? preset.seed ?? 12345;
  return `${preset.label} (seed:${shownSeed})`;
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
      mapMeta.textContent = 'rooms_classic: room / corridor / threshold / door(closed/open/locked) / stairs を持つ古典型マップ。';
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

function resetRunWithGeneratedMap(mapId = state.config.defaultGeneratedMapId, { keepLog = false, seedOverride = null } = {}) {
  // v0 設計判断 D4(CHANGELOG フェーズ 34):
  //   初期 seed は Date.now() ベース。seedOverride を明示的に渡せば優先される。
  //   URL クエリ ?seed=N は bootstrap で解釈して seedOverride として流す。
  const seed = (seedOverride ?? Date.now()) >>> 0;
  const generated = generateMapFromPreset(mapId, null, seed);
  const preset = getGeneratedPreset(mapId);

  setCurrentMapData(generated);

  state.currentMapId = mapId;
  state.currentSeed = seed;
  state.currentMapName = buildGeneratedMapLabel(mapId, seed);
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
  updateEnemyAwareness(state, { aiTransition: logAiTransition });
  updateMapUi();
  render(state);

  const standableCount = generated.meta.floorCount ?? generated.floor?.size ?? generated.cells?.filter((cell) => cell.support === 'stable').length ?? 0;
  logInternal('system', 'MAP', `${state.currentMapName} を生成。family ${generated.meta.family} / standable ${standableCount} / radius ${generated.meta.radius}。`);
  logInternal('system', 'SEED', `seed = ${seed}(URL に ?seed=${seed} を付けて開くと同じマップを再現できる)`);
}

// URL クエリから seed を取得する。?seed=12345 形式、数値として解釈できなければ null。
function readUrlSeedParam() {
  try {
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('seed');
    if (raw == null) return null;
    const n = Number(raw);
    return Number.isFinite(n) ? (n >>> 0) : null;
  } catch {
    return null;
  }
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
  bindKeyboard({ rotatePreview, tryMove, waitAction, toggleDebugOverlay });
  bindMainCanvasGestures({
    tryMove,
    waitAction,
    getCurrentPreviewFacing,
    setPreviewFacing,
    commitSwipeFacing,
  });
  setupMapUi();

  const initialSeed = readUrlSeedParam();  // null なら resetRun 側で Date.now() 採用
  resetRunWithGeneratedMap(CONFIG.defaultGeneratedMapId, { keepLog: true, seedOverride: initialSeed });

  logInternal('system', 'INIT', `HEX 版 NetHack 風ローグライク v1-0a 初期化。主画面タップで 6 方向移動(中心=待機)、スワイプで回頭。キーボードは ← / → 回頭 / QWEASD 移動 / Z 待機 / F3 debug。`);
}

bootstrap();
