import { CONFIG } from './config.js';
import {
  HEADING_ANGLES_DEG,
  HEADING_LABELS,
  hexDistance,
  hexToPixel,
  polygonCorners,
} from './hex.js';
import { canStandAt, getFeature, getSourceCellAt } from './map.js';

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

function getSemanticPalette(sourceCell, feature, canStand, mode) {
  const palettes = {
    visible: {
      room: { fill: CONFIG.colors.floorVisible, stroke: CONFIG.colors.floorVisibleStroke },
      corridor: { fill: '#25516c', stroke: '#3c6f90' },
      threshold: { fill: '#436177', stroke: '#6a8ba3' },
      wall: { fill: CONFIG.colors.wallVisible, stroke: CONFIG.colors.wallVisibleStroke },
      doorClosed: { fill: '#6a5531', stroke: '#b59554' },
      doorLocked: { fill: '#7a2f3a', stroke: '#c55763' },
      doorOpen: { fill: '#2f6a5a', stroke: '#61a890' },
      stairs: { fill: '#4e4b75', stroke: '#a5a2d8' },
    },
    near: {
      room: { fill: CONFIG.colors.floorNear, stroke: CONFIG.colors.floorNearStroke },
      corridor: { fill: '#353357', stroke: '#55537b' },
      threshold: { fill: '#4a5165', stroke: '#727a92' },
      wall: { fill: CONFIG.colors.wallNear, stroke: CONFIG.colors.wallNearStroke },
      doorClosed: { fill: '#62513b', stroke: '#8f7756' },
      doorLocked: { fill: '#6a3138', stroke: '#a04753' },
      doorOpen: { fill: '#31584e', stroke: '#4d8274' },
      stairs: { fill: '#403c5e', stroke: '#7b78b0' },
    },
    known: {
      room: { fill: CONFIG.colors.floorKnown, stroke: CONFIG.colors.floorKnownStroke },
      corridor: { fill: '#1d3040', stroke: '#33495d' },
      threshold: { fill: '#2a3a47', stroke: '#445563' },
      wall: { fill: CONFIG.colors.wallKnown, stroke: CONFIG.colors.wallKnownStroke },
      doorClosed: { fill: '#544633', stroke: '#7b6a50' },
      doorLocked: { fill: '#522a31', stroke: '#7a4048' },
      doorOpen: { fill: '#25483f', stroke: '#416a5f' },
      stairs: { fill: '#322f4a', stroke: '#5b5888' },
    },
  };

  const palette = palettes[mode];
  if (feature?.kind === 'door') {
    if (feature.state === 'open') return palette.doorOpen;
    if (feature.state === 'locked') return palette.doorLocked;
    return palette.doorClosed;
  }
  if (feature?.kind === 'stairs') {
    return palette.stairs;
  }
  if (!sourceCell || !canStand) return palette.wall;
  if (sourceCell.structureKind === 'corridor') return palette.corridor;
  if (sourceCell.structureKind === 'threshold') return palette.threshold;
  return palette.room;
}

function doorLabelFor(feature) {
  if (feature?.kind !== 'door') return null;
  if (feature.state === 'open') return null;
  if (feature.state === 'locked') return 'L';
  return 'D';
}

function stairsLabelFor(feature) {
  if (feature?.kind !== 'stairs') return null;
  return feature.params?.verticalMode === 'up' ? '↑' : '↓';
}

function getCellPaint(cell, state) {
  const key = cell.key();
  const isVisible = state.visible.has(key);
  const isNearAware = state.nearAware.has(key);
  const isKnown = state.explored.has(key);
  const canStand = canStandAt(cell);
  const sourceCell = getSourceCellAt(cell);
  const feature = getFeature(cell);

  if (!isKnown) {
    return { fill: CONFIG.colors.unknown, stroke: CONFIG.colors.unknownStroke, label: null, labelColor: CONFIG.colors.muted };
  }

  const mode = isVisible ? 'visible' : (isNearAware ? 'near' : 'known');
  const palette = getSemanticPalette(sourceCell, feature, canStand, mode);
  // 階段ラベルは known/near でも出す(一度見たら記憶)、door ラベルは visible のみ。
  const stairsLabel = stairsLabelFor(feature);
  const doorLabel = isVisible ? doorLabelFor(feature) : null;
  const label = stairsLabel ?? doorLabel;
  const labelColor = mode === 'visible' ? CONFIG.colors.text : CONFIG.colors.muted;
  return {
    fill: palette.fill,
    stroke: palette.stroke,
    label,
    labelColor,
  };
}

function drawCellBase(ctx, cell, drawHexCoord, tileRadius, originX, originY, labelSize, state) {
  const pixel = hexToPixel(drawHexCoord, tileRadius, originX, originY);
  const paint = getCellPaint(cell, state);
  let fill = paint.fill;
  let stroke = paint.stroke;

  if (cell.equals(state.playerPos)) {
    fill = CONFIG.colors.player;
    stroke = '#c99f2f';
  }

  drawHex(ctx, pixel.x, pixel.y, tileRadius - 1, fill, stroke);
  if (paint.label) {
    drawLabel(ctx, pixel.x, pixel.y - 5, paint.label, paint.labelColor, labelSize);
  }
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

export function updateEnemyStatusBox(state) {
  const box = document.getElementById('enemyStatusBox');
  if (state.enemies.length === 0) {
    box.innerHTML = '<div class="small">敵は全滅。</div>';
    return;
  }

  box.innerHTML = `<div class="small">敵ステータス（試用向けに全公開）</div>` + state.enemies.map((enemy) => `
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
}

export function renderMain(state) {
  const canvas = document.getElementById('mainCanvas');
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const originX = width / 2;
  const originY = height / 2;
  const rotationDeg = -90 - HEADING_ANGLES_DEG[state.previewFacing];
  const cells = state.allWorldCells.filter((cell) => hexDistance(cell, state.playerPos) <= CONFIG.main.localRadius);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = CONFIG.colors.background;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.translate(originX, originY);
  ctx.rotate((rotationDeg * Math.PI) / 180);
  ctx.translate(-originX, -originY);

  for (const cell of cells) {
    const drawHexCoord = cell.subtract(state.playerPos);
    drawCellBase(ctx, cell, drawHexCoord, CONFIG.main.tileRadius, originX, originY, 10, state);
  }

  for (const cell of cells) {
    const drawHexCoord = cell.subtract(state.playerPos);
    drawEntityOverlay(ctx, cell, drawHexCoord, CONFIG.main.tileRadius, originX, originY, state);
  }

  ctx.restore();
  drawFacingArrow(ctx, originX, originY, -90, CONFIG.colors.preview, 46);
  drawFacingArrow(ctx, originX, originY, -90, CONFIG.colors.committed, 28);
  drawLabel(ctx, originX, originY + 58, '主画面中央 = プレイヤー位置', CONFIG.colors.muted, 12);
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

  for (const cell of state.allWorldCells) {
    drawCellBase(ctx, cell, cell, tileRadius, originX, originY, 8, state);
  }

  for (const cell of state.allWorldCells) {
    drawEntityOverlay(ctx, cell, cell, tileRadius, originX, originY, state);
  }

  const playerPixel = hexToPixel(state.playerPos, tileRadius, originX, originY);
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
