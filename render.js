import { CONFIG } from './config.js';
import {
  HEADING_ANGLES_DEG,
  HEADING_LABELS,
  hexDistance,
  hexToPixel,
  polygonCorners,
} from './hex.js';
import { getFeature, getVisualCellAt } from './map.js';

function drawHex(ctx, centerX, centerY, size, fillStyle, strokeStyle) {
  const corners = polygonCorners(centerX, centerY, size);
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < corners.length; i += 1) {
    ctx.lineTo(corners[i].x, corners[i].y);
  }
  ctx.closePath();
  ctx.fillStyle = fillStyle;
  ctx.fill();
  ctx.strokeStyle = strokeStyle;
  ctx.lineWidth = 1;
  ctx.stroke();
}

function drawLabel(ctx, x, y, text, color, fontSize = 11) {
  ctx.fillStyle = color;
  ctx.font = `${fontSize}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

// ==============================================================================
// v1-0a(NEXT_STEPS §2.1): タイル天面スプライトシステム(Layer 1)
// ==============================================================================
//
// 構造(論点 C 合意 2026-04-24):
//   spriteKey = { kind, state, variant, rotation }
//     kind:     'room' | 'corridor' | 'threshold' | 'wall' | 'door' | 'stairs' | 'void'
//     state:    door: 'closed'|'open'|'locked'、stairs: 'up'|'down'(verticalMode)、他は null
//     variant:  0..3(visualsByKey に焼き込み済み、座標決定的)
//     rotation: 0..5(同上)
//
// drawer 辞書 SPRITE_DRAWERS に kind → 描画関数をマッピング。
// v1-0a は programmatic 描画(論点 B 合意:弱く表現)。
// v1-0b で drawer を PNG 描画に差し替え予定。
// ==============================================================================

// タイル色のバリアント補正(輝度微調整、±5% 以内)。
function shiftColorByVariant(hexColor, variant) {
  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);
  const factor = [0.95, 0.98, 1.02, 1.05][variant] ?? 1;
  const cr = Math.max(0, Math.min(255, Math.round(r * factor)));
  const cg = Math.max(0, Math.min(255, Math.round(g * factor)));
  const cb = Math.max(0, Math.min(255, Math.round(b * factor)));
  return `rgb(${cr},${cg},${cb})`;
}

// variant/rotation の programmatic 表現(弱め):タイル中心から rotation 方向に小ドット 1 個。
// tileRadius が小さすぎる場合(副画面)は省略。
function drawVariantDot(ctx, cx, cy, tileRadius, rotation, color) {
  if (tileRadius < 6) return;
  const angleDeg = HEADING_ANGLES_DEG[rotation];
  const angleRad = (angleDeg * Math.PI) / 180;
  const rr = tileRadius * 0.45;
  const x = cx + Math.cos(angleRad) * rr;
  const y = cy + Math.sin(angleRad) * rr;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(1, tileRadius * 0.08), 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

// 状態色(visible / near / known の 3 モード × kind × 属性)。v0 の getSemanticPalette を移植。
const SPRITE_PALETTES = {
  visible: {
    room:       { fill: CONFIG.colors.floorVisible,  stroke: CONFIG.colors.floorVisibleStroke, dot: '#3d5f78' },
    corridor:   { fill: '#25516c',                   stroke: '#3c6f90',                        dot: '#4b7d9e' },
    threshold:  { fill: '#436177',                   stroke: '#6a8ba3',                        dot: '#7aa1b8' },
    wall:       { fill: CONFIG.colors.wallVisible,   stroke: CONFIG.colors.wallVisibleStroke,  dot: '#5e7a8d' },
    doorClosed: { fill: '#6a5531',                   stroke: '#b59554' },
    doorLocked: { fill: '#7a2f3a',                   stroke: '#c55763' },
    doorOpen:   { fill: '#2f6a5a',                   stroke: '#61a890' },
    stairs:     { fill: '#4e4b75',                   stroke: '#a5a2d8' },
  },
  near: {
    room:       { fill: CONFIG.colors.floorNear,     stroke: CONFIG.colors.floorNearStroke,    dot: '#403d5e' },
    corridor:   { fill: '#353357',                   stroke: '#55537b',                        dot: '#4d4b75' },
    threshold:  { fill: '#4a5165',                   stroke: '#727a92',                        dot: '#656c82' },
    wall:       { fill: CONFIG.colors.wallNear,      stroke: CONFIG.colors.wallNearStroke,     dot: '#625a78' },
    doorClosed: { fill: '#62513b',                   stroke: '#8f7756' },
    doorLocked: { fill: '#6a3138',                   stroke: '#a04753' },
    doorOpen:   { fill: '#31584e',                   stroke: '#4d8274' },
    stairs:     { fill: '#403c5e',                   stroke: '#7b78b0' },
  },
  known: {
    room:       { fill: CONFIG.colors.floorKnown,    stroke: CONFIG.colors.floorKnownStroke,   dot: '#283544' },
    corridor:   { fill: '#1d3040',                   stroke: '#33495d',                        dot: '#2a4356' },
    threshold:  { fill: '#2a3a47',                   stroke: '#445563',                        dot: '#3b4c5a' },
    wall:       { fill: CONFIG.colors.wallKnown,     stroke: CONFIG.colors.wallKnownStroke,    dot: '#394754' },
    doorClosed: { fill: '#544633',                   stroke: '#7b6a50' },
    doorLocked: { fill: '#522a31',                   stroke: '#7a4048' },
    doorOpen:   { fill: '#25483f',                   stroke: '#416a5f' },
    stairs:     { fill: '#322f4a',                   stroke: '#5b5888' },
  },
};

function drawRoomSprite(ctx, cx, cy, tileRadius, spriteKey, mode) {
  const palette = SPRITE_PALETTES[mode].room;
  const fill = shiftColorByVariant(palette.fill, spriteKey.variant);
  drawHex(ctx, cx, cy, tileRadius - 1, fill, palette.stroke);
  drawVariantDot(ctx, cx, cy, tileRadius, spriteKey.rotation, palette.dot);
}

function drawCorridorSprite(ctx, cx, cy, tileRadius, spriteKey, mode) {
  const palette = SPRITE_PALETTES[mode].corridor;
  const fill = shiftColorByVariant(palette.fill, spriteKey.variant);
  drawHex(ctx, cx, cy, tileRadius - 1, fill, palette.stroke);
  drawVariantDot(ctx, cx, cy, tileRadius, spriteKey.rotation, palette.dot);
}

function drawThresholdSprite(ctx, cx, cy, tileRadius, spriteKey, mode) {
  const palette = SPRITE_PALETTES[mode].threshold;
  const fill = shiftColorByVariant(palette.fill, spriteKey.variant);
  drawHex(ctx, cx, cy, tileRadius - 1, fill, palette.stroke);
  drawVariantDot(ctx, cx, cy, tileRadius, spriteKey.rotation, palette.dot);
}

function drawWallSprite(ctx, cx, cy, tileRadius, spriteKey, mode) {
  const palette = SPRITE_PALETTES[mode].wall;
  const fill = shiftColorByVariant(palette.fill, spriteKey.variant);
  drawHex(ctx, cx, cy, tileRadius - 1, fill, palette.stroke);
  drawVariantDot(ctx, cx, cy, tileRadius, spriteKey.rotation, palette.dot);
}

// S5 暫定: v0 互換の「色分け + D/L ラベル」を維持。
// S6 でモデル A 六角柱ドア描画に置き換える。
function drawDoorSprite(ctx, cx, cy, tileRadius, spriteKey, mode) {
  const keyMap = { closed: 'doorClosed', locked: 'doorLocked', open: 'doorOpen' };
  const paletteKey = keyMap[spriteKey.state] ?? 'doorClosed';
  const palette = SPRITE_PALETTES[mode][paletteKey];
  drawHex(ctx, cx, cy, tileRadius - 1, palette.fill, palette.stroke);
  if (tileRadius >= 10 && mode === 'visible') {
    let label = null;
    if (spriteKey.state === 'closed') label = 'D';
    else if (spriteKey.state === 'locked') label = 'L';
    if (label) {
      drawLabel(ctx, cx, cy - 5, label, CONFIG.colors.text, Math.max(9, Math.floor(tileRadius * 0.42)));
    }
  }
}

function drawStairsSprite(ctx, cx, cy, tileRadius, spriteKey, mode) {
  const palette = SPRITE_PALETTES[mode].stairs;
  drawHex(ctx, cx, cy, tileRadius - 1, palette.fill, palette.stroke);
  if (tileRadius >= 8) {
    const label = spriteKey.state === 'up' ? '↑' : '↓';
    const color = mode === 'visible' ? CONFIG.colors.text : CONFIG.colors.muted;
    drawLabel(ctx, cx, cy - 5, label, color, Math.max(9, Math.floor(tileRadius * 0.42)));
  }
}

function drawVoidSprite(ctx, cx, cy, tileRadius, spriteKey, mode) {
  // 世界外側の暗タイル。wall パレットを使用。
  const palette = SPRITE_PALETTES[mode].wall;
  drawHex(ctx, cx, cy, tileRadius - 1, palette.fill, palette.stroke);
}

const SPRITE_DRAWERS = {
  room:      drawRoomSprite,
  corridor:  drawCorridorSprite,
  threshold: drawThresholdSprite,
  wall:      drawWallSprite,
  door:      drawDoorSprite,
  stairs:    drawStairsSprite,
  void:      drawVoidSprite,
};

// ==============================================================================
// Layer 1/2/3 の公開インターフェース
// ==============================================================================

// getTileSprite(cell) → { kind, state, variant, rotation }
// visualsByKey の baseToken + runtime.feature.state を合成。
function getTileSprite(cell) {
  const visual = getVisualCellAt(cell);
  if (!visual) {
    return { kind: 'void', state: null, variant: 0, rotation: 0 };
  }
  const feature = getFeature(cell);
  let state = null;
  if (feature?.kind === 'door') {
    state = feature.state;
  } else if (feature?.kind === 'stairs') {
    state = feature.params?.verticalMode ?? null;
  }
  return {
    kind: visual.baseToken,
    state,
    variant: visual.variant ?? 0,
    rotation: visual.rotation ?? 0,
  };
}

// getTileRotation(cell) → degrees
// タイル単位の個別回転(world 全体回転とは独立)。
// v1-0a 時点では常に 0(stairs の個別回転は S7 で実装)。variant/rotation の弱い反映は
// drawer 内で直接扱う。
function getTileRotation(cell) {
  return 0;
}

// featureOverlay(cell) → descriptor | null
// Layer 2(タイル上 feature オーバーレイ)。v1 未使用、schema 確立のみ。
// v1-1 以降で trap / trapdoor のシンボルオーバーレイ用に稼働。
function featureOverlay(cell) {
  return null;
}

// Layer 1: タイル天面スプライトの描画。
// 呼び出し側で world 回転を適用済みの座標で呼ぶ。
function drawCellLayer1(ctx, cell, drawHexCoord, tileRadius, originX, originY, state) {
  const pixel = hexToPixel(drawHexCoord, tileRadius, originX, originY);
  const key = cell.key();
  const isKnown = state.explored.has(key);

  if (!isKnown) {
    drawHex(ctx, pixel.x, pixel.y, tileRadius - 1, CONFIG.colors.unknown, CONFIG.colors.unknownStroke);
    return;
  }

  const isVisible = state.visible.has(key);
  const isNearAware = state.nearAware.has(key);
  const mode = isVisible ? 'visible' : (isNearAware ? 'near' : 'known');

  const sprite = getTileSprite(cell);
  const drawer = SPRITE_DRAWERS[sprite.kind] ?? SPRITE_DRAWERS.void;

  // タイル個別回転(v1-0a は常に 0)。S7 で stairs 用に活用。
  const tileRotDeg = getTileRotation(cell);
  if (tileRotDeg !== 0) {
    ctx.save();
    ctx.translate(pixel.x, pixel.y);
    ctx.rotate((tileRotDeg * Math.PI) / 180);
    drawer(ctx, 0, 0, tileRadius, sprite, mode);
    ctx.restore();
  } else {
    drawer(ctx, pixel.x, pixel.y, tileRadius, sprite, mode);
  }
}

// Layer 2: タイル上 feature オーバーレイ。v1-0a 時点では何もしない(schema 確立のみ)。
function drawCellLayer2(ctx, cell, drawHexCoord, tileRadius, originX, originY, state) {
  const descriptor = featureOverlay(cell);
  if (!descriptor) return;
  // v1-1 以降で trap / trapdoor の描画を追加
}

// Layer 3 の一部として、プレイヤーマーカーを描画。
// 主画面では world 回転の外で、キャンバス中心に描く(プレイヤーは常に中心に居るため)。
// 副画面ではプレイヤー座標の pixel 位置に描く。
function drawPlayerMarker(ctx, cx, cy, tileRadius) {
  ctx.beginPath();
  ctx.arc(cx, cy, Math.max(3, tileRadius * 0.45), 0, Math.PI * 2);
  ctx.fillStyle = CONFIG.colors.player;
  ctx.strokeStyle = '#c99f2f';
  ctx.lineWidth = Math.max(1, tileRadius * 0.07);
  ctx.fill();
  ctx.stroke();
}

// ==============================================================================


function drawFacingArrow(ctx, centerX, centerY, angleDeg, color, length) {
  const angleRad = (angleDeg * Math.PI) / 180;
  const tipX = centerX + Math.cos(angleRad) * length;
  const tipY = centerY + Math.sin(angleRad) * length;
  const leftX = centerX + Math.cos(angleRad + 2.5) * (length * 0.38);
  const leftY = centerY + Math.sin(angleRad + 2.5) * (length * 0.38);
  const rightX = centerX + Math.cos(angleRad - 2.5) * (length * 0.38);
  const rightY = centerY + Math.sin(angleRad - 2.5) * (length * 0.38);

  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(leftX, leftY);
  ctx.lineTo(rightX, rightY);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function drawEnemyMarker(ctx, centerX, centerY, visibleMode) {
  const size = visibleMode === 'visible' ? 7 : 5;
  const color = visibleMode === 'visible' ? CONFIG.colors.enemyVisible : CONFIG.colors.enemyNear;
  ctx.beginPath();
  ctx.arc(centerX, centerY, size, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = '#2a0f12';
  ctx.lineWidth = 1.2;
  ctx.stroke();
}

function drawEnemyFacing(ctx, centerX, centerY, facing) {
  drawFacingArrow(ctx, centerX, centerY, HEADING_ANGLES_DEG[facing], '#ffe3e3', 12);
}

// 階段の進入口辺(enterHeading)と出口辺(exitHeading)を強調描画する。
// SPEC §8.6 + 設計判断 D6(CHANGELOG フェーズ 34):
//   - 中央アイコンは verticalMode(↑/↓)、辺マークは進入/出口の向き情報
//   - 通過型(enterHeading == exitHeading、v0 標準)は同一辺を「通過辺」として太線強調
//   - 非通過型(v1+ 想定)は enter 辺=緑、exit 辺=黄で色分け
//   - visible タイルのみに描画(known / nearAware では中央アイコンだけ、方向情報は再確認が必要)
//
// 辺の描画: edge N の両端は polygonCorners の index (N+4)%6 と (N+5)%6。
//   edge 0 (N) mid = (0, -√3/2) で画面上向き、この規則は GLOSSARY §1 と一致。
function drawStairsEdges(ctx, cell, drawHexCoord, tileRadius, originX, originY, state) {
  const feature = getFeature(cell);
  if (feature?.kind !== 'stairs') return;
  if (!state.visible.has(cell.key())) return;

  const enterHeading = feature.params?.enterHeading;
  const exitHeading = feature.params?.exitHeading;
  if (typeof enterHeading !== 'number' || typeof exitHeading !== 'number') return;

  const pixel = hexToPixel(drawHexCoord, tileRadius, originX, originY);
  const corners = polygonCorners(pixel.x, pixel.y, tileRadius - 1);
  const lineWidth = Math.max(3, tileRadius * 0.18);

  const drawEdge = (edgeIndex, color) => {
    const a = corners[(edgeIndex + 4) % 6];
    const b = corners[(edgeIndex + 5) % 6];
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.stroke();
  };

  if (enterHeading === exitHeading) {
    // 通過型: 進入口と出口が同一辺。プレイヤーはこの辺を通って「階段に入る」
    // 「昇降する(= 元の進行方向で出る)」の両方を実行する。
    drawEdge(enterHeading, CONFIG.colors.preview);  // 緑(視野軸と同系統)
  } else {
    // 非通過型(v1+): enter = 緑、exit = 黄
    drawEdge(enterHeading, CONFIG.colors.preview);
    drawEdge(exitHeading, CONFIG.colors.player);
  }
}


function aiModeBadge(mode) {
  return {
    patrol: '巡',
    chase: '追',
    investigate: '確',
    return: '帰',
  }[mode] ?? '?';
}

function drawEnemyStateBadge(ctx, centerX, centerY, mode, visibleMode) {
  const text = aiModeBadge(mode);
  const width = 18;
  const height = 14;
  const badgeX = centerX - width / 2;
  const badgeY = centerY - 22;
  ctx.fillStyle = visibleMode === 'visible' ? 'rgba(20,20,24,0.88)' : 'rgba(40,40,44,0.82)';
  ctx.strokeStyle = '#cfd3da';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(badgeX, badgeY, width, height, 4);
  ctx.fill();
  ctx.stroke();
  drawLabel(ctx, centerX, badgeY + height / 2 + 0.5, text, '#f5f7fa', 9);
}

function drawEntityOverlay(ctx, cell, drawHexCoord, tileRadius, originX, originY, state) {
  const enemy = state.enemies.find((e) => e.pos.equals(cell));
  if (!enemy) {
    return;
  }

  const key = cell.key();
  const mode = state.visible.has(key) ? 'visible' : (state.nearAware.has(key) ? 'near' : null);
  if (!mode) {
    return;
  }

  const pixel = hexToPixel(drawHexCoord, tileRadius, originX, originY);
  drawEnemyMarker(ctx, pixel.x, pixel.y, mode);
  drawEnemyStateBadge(ctx, pixel.x, pixel.y, enemy.mode, mode);
  if (mode === 'visible') {
    drawEnemyFacing(ctx, pixel.x, pixel.y, enemy.facing);
    drawLabel(ctx, pixel.x, pixel.y + 14, `${enemy.hp}`, CONFIG.colors.text, 10);
  }
}

export function updateStatusBox(state) {
  const box = document.getElementById('statusBox');
  box.innerHTML = `
    <div class="status-row"><span>Turn</span><strong>${state.turn}</strong></div>
    <div class="status-row"><span>HP</span><strong>${state.playerHP} / ${state.playerMaxHP}</strong></div>
    <div class="status-row"><span>Player wt</span><strong>${state.playerWt}</strong></div>
    <div class="status-row"><span>Map</span><strong>${state.currentMapName ?? state.currentMapId ?? '-'}</strong></div>
    <div class="status-row"><span>Player q / r</span><strong>q:${state.playerPos.q} r:${state.playerPos.r}</strong></div>
    <div class="status-row"><span>仮向き</span><strong>${HEADING_LABELS[state.previewFacing]}</strong></div>
    <div class="status-row"><span>視界基準 / 確定向き</span><strong>${HEADING_LABELS[state.committedFacing]}</strong></div>
    <div class="status-row"><span>可視セル数</span><strong>${state.visible.size}</strong></div>
    <div class="status-row"><span>近接知覚セル数</span><strong>${state.nearAware.size}</strong></div>
    <div class="status-row"><span>既知セル数</span><strong>${state.explored.size}</strong></div>
    <div class="status-row"><span>残敵数</span><strong>${state.enemies.length}</strong></div>
    <div class="status-row"><span>状態</span><strong>${state.gameOver ? 'GAME OVER' : '進行中'}</strong></div>
  `;
}

// v1-0a(NEXT_STEPS §2.1): enemy_status_box 本番仕様。
//   通常時: visible に含まれる敵のみ、名前 / HP / 距離を表示(知覚軸経由のみ露出原則)。
//   debug overlay ON 時: 全敵の全情報(id, mode, pos, facing, HP, wt, homePos, lastSeenPos)を表示。
//
// nearAware のみで捉えている敵(FOV 外の隣接敵等)は通常時に表示しない。v0 では全敵公開だったが、
// v1 原則「知覚軸経由のみ露出」(PRINCIPLES §8)に合わせて情報量を絞る。将来的に「気配:N 体」等を
// 追加する余地あり(v1 設計内での拡張)。
export function updateEnemyStatusBox(state) {
  const box = document.getElementById('enemyStatusBox');
  if (!box) return;

  if (state.enemies.length === 0) {
    box.innerHTML = '<div class="small">敵は全滅。</div>';
    return;
  }

  if (state.debugOverlay) {
    // debug 全情報(v0 互換の開発者向け出力)
    box.innerHTML = `<div class="small">敵ステータス(debug overlay: 全公開)</div>` + state.enemies.map((enemy) => `
      <div class="enemy-row">
        <div class="enemy-title"><span>${enemy.id} ${enemy.name}</span><span>${enemy.mode}</span></div>
        <div class="status-row"><span>位置</span><strong>q:${enemy.pos.q} r:${enemy.pos.r}</strong></div>
        <div class="status-row"><span>向き</span><strong>${HEADING_LABELS[enemy.facing]}</strong></div>
        <div class="status-row"><span>HP</span><strong>${enemy.hp} / ${enemy.maxHp}</strong></div>
        <div class="status-row"><span>wt</span><strong>${enemy.wt}</strong></div>
        <div class="status-row"><span>帰投先</span><strong>q:${enemy.homePos.q} r:${enemy.homePos.r}</strong></div>
        <div class="status-row"><span>最終発見地点</span><strong>${enemy.lastSeenPlayerPos ? `q:${enemy.lastSeenPlayerPos.q} r:${enemy.lastSeenPlayerPos.r}` : '-'}</strong></div>
      </div>
    `).join('');
    return;
  }

  // 通常表示: visible のみ、名前 / HP / 距離。
  const visibleEnemies = state.enemies.filter((enemy) => state.visible.has(enemy.pos.key()));

  if (visibleEnemies.length === 0) {
    box.innerHTML = '<div class="small">視界内に敵はいない。</div>';
    return;
  }

  box.innerHTML = `<div class="small">視界内の敵(${visibleEnemies.length}体)</div>` + visibleEnemies.map((enemy) => {
    const dist = hexDistance(enemy.pos, state.playerPos);
    return `
      <div class="enemy-row">
        <div class="enemy-title"><span>${enemy.name}</span><span>距離 ${dist}</span></div>
        <div class="status-row"><span>HP</span><strong>${enemy.hp} / ${enemy.maxHp}</strong></div>
      </div>
    `;
  }).join('');
}

export function renderMain(state) {
  const canvas = document.getElementById('mainCanvas');
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const originX = width / 2;
  const originY = height / 2;
  const rotationDeg = -90 - HEADING_ANGLES_DEG[state.previewFacing];
  const tileRadius = CONFIG.main.tileRadius;
  const cells = state.allWorldCells.filter((cell) => hexDistance(cell, state.playerPos) <= CONFIG.main.localRadius);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = CONFIG.colors.background;
  ctx.fillRect(0, 0, width, height);

  // world 回転をかけて Layer 1/2/3 を描画(プレイヤー基準のヘディングアップ)
  ctx.save();
  ctx.translate(originX, originY);
  ctx.rotate((rotationDeg * Math.PI) / 180);
  ctx.translate(-originX, -originY);

  // Layer 1: タイル天面スプライト
  for (const cell of cells) {
    const drawHexCoord = cell.subtract(state.playerPos);
    drawCellLayer1(ctx, cell, drawHexCoord, tileRadius, originX, originY, state);
  }

  // stairs の通過辺強調(v1-0a では Layer 1 の補助。S7 で階段回転が動いたら再検討)
  for (const cell of cells) {
    const drawHexCoord = cell.subtract(state.playerPos);
    drawStairsEdges(ctx, cell, drawHexCoord, tileRadius, originX, originY, state);
  }

  // Layer 2: タイル上 feature オーバーレイ(v1 未使用、schema 確立のみ)
  for (const cell of cells) {
    const drawHexCoord = cell.subtract(state.playerPos);
    drawCellLayer2(ctx, cell, drawHexCoord, tileRadius, originX, originY, state);
  }

  // Layer 3: 敵
  for (const cell of cells) {
    const drawHexCoord = cell.subtract(state.playerPos);
    drawEntityOverlay(ctx, cell, drawHexCoord, tileRadius, originX, originY, state);
  }

  ctx.restore();

  // Layer 3 続き: プレイヤーマーカー。主画面ではプレイヤーは常にキャンバス中心、
  // world 回転の影響を受けずに常に正面向き。
  drawPlayerMarker(ctx, originX, originY, tileRadius);

  // UI overlay: 向き矢印(preview/committed)、中央ラベル
  drawFacingArrow(ctx, originX, originY, -90, CONFIG.colors.preview, 46);
  drawFacingArrow(ctx, originX, originY, -90, CONFIG.colors.committed, 28);
  drawLabel(ctx, originX, originY + 58, '主画面中央 = プレイヤー位置', CONFIG.colors.muted, 12);
}

// v1-0a(NEXT_STEPS §2.1): 副画面の worldRadius 境界描画。
// world は radius=R の hex disk。その外接六角形を、6 コーナータイル
// (R,0) (R,-R) (0,-R) (-R,0) (-R,R) (0,R) の中心からさらに外向きに
// tileRadius 分押し出した 6 点を結んで描く。副画面で「ここから外はワールド外」を
// 視覚的に示す。主画面では描かない(プレイヤー周辺のみ描画のため)。
function drawWorldBoundary(ctx, tileRadius, originX, originY, radius) {
  const cornerHexes = [
    { q:  radius, r:  0       },
    { q:  radius, r: -radius  },
    { q:  0,      r: -radius  },
    { q: -radius, r:  0       },
    { q: -radius, r:  radius  },
    { q:  0,      r:  radius  },
  ];
  const points = cornerHexes.map((hex) => {
    const center = hexToPixel(hex, tileRadius, originX, originY);
    const dx = center.x - originX;
    const dy = center.y - originY;
    const len = Math.hypot(dx, dy);
    if (len === 0) return { x: center.x, y: center.y };
    const k = (len + tileRadius) / len;
    return { x: originX + dx * k, y: originY + dy * k };
  });

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.closePath();
  ctx.strokeStyle = CONFIG.colors.worldBoundary;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

export function renderSub(state) {
  const canvas = document.getElementById('subCanvas');
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const originX = width / 2;
  const originY = height / 2;
  const tileRadius = CONFIG.sub.tileRadius;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = CONFIG.colors.background;
  ctx.fillRect(0, 0, width, height);

  // Layer 1
  for (const cell of state.allWorldCells) {
    drawCellLayer1(ctx, cell, cell, tileRadius, originX, originY, state);
  }

  // stairs edges
  for (const cell of state.allWorldCells) {
    drawStairsEdges(ctx, cell, cell, tileRadius, originX, originY, state);
  }

  // Layer 2(v1 未使用)
  for (const cell of state.allWorldCells) {
    drawCellLayer2(ctx, cell, cell, tileRadius, originX, originY, state);
  }

  // Layer 3: 敵
  for (const cell of state.allWorldCells) {
    drawEntityOverlay(ctx, cell, cell, tileRadius, originX, originY, state);
  }

  // worldRadius 境界(Layer 3 の後、UI overlay 前)
  drawWorldBoundary(ctx, tileRadius, originX, originY, state.config.worldRadius);

  // Layer 3 続き: プレイヤーマーカー + 向き矢印 + ラベル
  const playerPixel = hexToPixel(state.playerPos, tileRadius, originX, originY);
  drawPlayerMarker(ctx, playerPixel.x, playerPixel.y, tileRadius);
  drawFacingArrow(ctx, playerPixel.x, playerPixel.y, HEADING_ANGLES_DEG[state.committedFacing], CONFIG.colors.committed, tileRadius * 2.2);
  drawFacingArrow(ctx, playerPixel.x, playerPixel.y, HEADING_ANGLES_DEG[state.previewFacing], CONFIG.colors.preview, tileRadius * 1.4);
  drawLabel(ctx, playerPixel.x, playerPixel.y + tileRadius * 2.3, 'player', CONFIG.colors.muted, Math.min(11, tileRadius + 3));
}

export function render(state) {
  updateStatusBox(state);
  updateEnemyStatusBox(state);
  renderMain(state);
  renderSub(state);
}
