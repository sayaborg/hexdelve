import { CONFIG } from './config.js';
import {
  DIRECTION_ANGLES_DEG,
  DIRECTION_LABELS,
  DIRECTIONS,
  Hex,
  hexDistance,
  hexToPixel,
  polygonCorners,
} from './hex.js';
import { getTile, isFloor } from './map.js';

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

function drawEnemyFacing(ctx, centerX, centerY, facingDirection) {
  drawFacingArrow(ctx, centerX, centerY, DIRECTION_ANGLES_DEG[facingDirection], '#ffe3e3', 12);
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

function drawDebugLine(ctx, x1, y1, x2, y2, color, width = 1) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function drawDebugDot(ctx, x, y, radius, fill, stroke = null) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function drawDebugHexFill(ctx, centerX, centerY, size, fill, stroke = null) {
  const corners = polygonCorners(centerX, centerY, size);
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < corners.length; i += 1) {
    ctx.lineTo(corners[i].x, corners[i].y);
  }
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

const SIDE_CORNERS_BY_DIR = {
  0: [0, 1],
  1: [5, 0],
  2: [4, 5],
  3: [3, 4],
  4: [2, 3],
  5: [1, 2],
};

function getSideSegmentPoints(centerX, centerY, size, dir) {
  const corners = polygonCorners(centerX, centerY, size);
  const [aIndex, bIndex] = SIDE_CORNERS_BY_DIR[dir];
  return [corners[aIndex], corners[bIndex]];
}

function getSideMidpoint(centerX, centerY, size, dir) {
  const [a, b] = getSideSegmentPoints(centerX, centerY, size, dir);
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  };
}

function drawDebugSideSegment(ctx, centerX, centerY, size, dir, color, width = 2) {
  const [a, b] = getSideSegmentPoints(centerX, centerY, size, dir);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

function drawRoomBoundaryOverlayForCell(ctx, cell, drawHexCoord, tileRadius, originX, originY, state) {
  const tile = state.tiles.get(cell.key());
  if (!tile || tile.regionType !== 'room' || !tile.roomId) return;

  const center = hexToPixel(drawHexCoord, tileRadius, originX, originY);
  for (let dir = 0; dir < 6; dir += 1) {
    const delta = DIRECTIONS[dir];
    const neighbor = state.tiles.get(new Hex(cell.q + delta.q, cell.r + delta.r).key());
    if (neighbor?.regionType === 'room' && neighbor?.roomId === tile.roomId) continue;
    drawDebugSideSegment(ctx, center.x, center.y, tileRadius, dir, 'rgba(90,210,255,0.96)', Math.max(1.5, tileRadius * 0.16));
  }

  if (typeof tile.vertexDir === 'number') {
    const marker = getSideMidpoint(center.x, center.y, tileRadius, tile.vertexDir);
    const isDoor = tile.boundaryRole === 'door';
    drawDebugDot(
      ctx,
      marker.x,
      marker.y,
      isDoor ? Math.max(2.6, tileRadius * 0.22) : Math.max(2.1, tileRadius * 0.18),
      isDoor ? 'rgba(255,88,88,0.98)' : 'rgba(255,196,96,0.98)',
      isDoor ? 'rgba(120,20,20,0.98)' : 'rgba(110,78,18,0.98)'
    );
  }
}

function drawRoomsClassicDebugOverlay(ctx, state, tileRadius, originX, originY) {
  const debug = state.currentMapDebug ?? {};
  const rooms = debug.rooms ?? [];
  const connections = debug.connections ?? [];
  const selectedDoors = debug.selectedDoors ?? [];

  if (!rooms.length) return;

  const roomById = new Map(rooms.map((room) => [room.id, room]));

  for (const connection of connections) {
    const roomA = roomById.get(connection.roomAId);
    const roomB = roomById.get(connection.roomBId);
    if (!roomA || !roomB) continue;

    const a = hexToPixel(roomA.center, tileRadius, originX, originY);
    const b = hexToPixel(roomB.center, tileRadius, originX, originY);
    drawDebugLine(ctx, a.x, a.y, b.x, b.y, 'rgba(120,190,255,0.55)', 1.2);
  }

  for (const room of rooms) {
    const point = hexToPixel(room.center, tileRadius, originX, originY);
    const isStart = room.id === debug.startRoomId;
    drawDebugDot(
      ctx,
      point.x,
      point.y,
      isStart ? Math.max(4, tileRadius * 0.5) : Math.max(3, tileRadius * 0.38),
      isStart ? 'rgba(255,220,120,0.95)' : 'rgba(120,220,255,0.9)',
      '#0f141a'
    );
    drawLabel(ctx, point.x, point.y - Math.max(9, tileRadius * 1.2), room.id, '#d6edf8', Math.max(8, Math.min(11, tileRadius + 2)));
  }

  for (const entry of selectedDoors) {
    const a = hexToPixel(entry.doorA.cell, tileRadius, originX, originY);
    const b = hexToPixel(entry.doorB.cell, tileRadius, originX, originY);
    drawDebugDot(ctx, a.x, a.y, Math.max(2.5, tileRadius * 0.28), 'rgba(255,120,120,0.95)', '#260a0a');
    drawDebugDot(ctx, b.x, b.y, Math.max(2.5, tileRadius * 0.28), 'rgba(255,120,120,0.95)', '#260a0a');
    drawDebugLine(ctx, a.x, a.y, b.x, b.y, 'rgba(255,120,120,0.45)', 1);
  }
}

function getCellPaint(cell, state) {
  const key = cell.key();
  const isVisible = state.visible.has(key);
  const isNearAware = state.nearAware.has(key);
  const isKnown = state.explored.has(key);
  const floor = isFloor(cell);
  const tile = getTile(cell);
  const isCorridor = tile?.regionType === 'corridor';
  const boundaryRole = tile?.boundaryRole ?? null;

  const corridorVisibleFill = '#6fe7d8';
  const corridorVisibleStroke = '#2aa999';
  const corridorNearFill = '#9beee4';
  const corridorNearStroke = '#54bfb1';
  const corridorKnownFill = '#bdf5ee';
  const corridorKnownStroke = '#7cd6ca';

  const roomRole = null;

  if (!isKnown) {
    return { fill: CONFIG.colors.unknown, stroke: CONFIG.colors.unknownStroke, label: null, labelColor: CONFIG.colors.muted };
  }
  if (isVisible) {
    return {
      fill: floor
        ? (isCorridor ? corridorVisibleFill : roomRole?.visibleFill ?? CONFIG.colors.floorVisible)
        : CONFIG.colors.wallVisible,
      stroke: floor
        ? (isCorridor ? corridorVisibleStroke : roomRole?.visibleStroke ?? CONFIG.colors.floorVisibleStroke)
        : CONFIG.colors.wallVisibleStroke,
      label: floor ? `q:${cell.q} r:${cell.r}` : null,
      labelColor: CONFIG.colors.text,
    };
  }
  if (isNearAware) {
    return {
      fill: floor
        ? (isCorridor ? corridorNearFill : roomRole?.nearFill ?? CONFIG.colors.floorNear)
        : CONFIG.colors.wallNear,
      stroke: floor
        ? (isCorridor ? corridorNearStroke : roomRole?.nearStroke ?? CONFIG.colors.floorNearStroke)
        : CONFIG.colors.wallNearStroke,
      label: null,
      labelColor: CONFIG.colors.muted,
    };
  }
  return {
    fill: floor
      ? (isCorridor ? corridorKnownFill : roomRole?.knownFill ?? CONFIG.colors.floorKnown)
      : CONFIG.colors.wallKnown,
    stroke: floor
      ? (isCorridor ? corridorKnownStroke : roomRole?.knownStroke ?? CONFIG.colors.floorKnownStroke)
      : CONFIG.colors.wallKnownStroke,
    label: null,
    labelColor: CONFIG.colors.muted,
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
    <div class="status-row"><span>仮向き</span><strong>${DIRECTION_LABELS[state.previewFacing]}</strong></div>
    <div class="status-row"><span>視界基準 / 確定向き</span><strong>${DIRECTION_LABELS[state.committedFacing]}</strong></div>
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
      <div class="status-row"><span>向き</span><strong>${DIRECTION_LABELS[enemy.facing]}</strong></div>
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
  const rotationDeg = -90 - DIRECTION_ANGLES_DEG[state.previewFacing];
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

  if (state.currentMapMeta?.family === 'rooms_classic') {
    for (const cell of cells) {
      const drawHexCoord = cell.subtract(state.playerPos);
      drawRoomBoundaryOverlayForCell(ctx, cell, drawHexCoord, CONFIG.main.tileRadius, originX, originY, state);
    }
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

function computeSubTileRadius(state, width, height) {
  const padding = 12;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  for (const cell of state.allWorldCells) {
    const pixel = hexToPixel(cell, 1, 0, 0);
    if (pixel.x < minX) minX = pixel.x;
    if (pixel.x > maxX) maxX = pixel.x;
    if (pixel.y < minY) minY = pixel.y;
    if (pixel.y > maxY) maxY = pixel.y;
  }

  const widthUnits = (maxX - minX) + 2.2;
  const heightUnits = (maxY - minY) + 1.9;
  const fitted = Math.min((width - padding * 2) / widthUnits, (height - padding * 2) / heightUnits);
  return Math.max(1.6, Math.min(CONFIG.sub.tileRadius, fitted));
}

export function renderSub(state) {
  const canvas = document.getElementById('subCanvas');
  const ctx = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const originX = width / 2;
  const originY = height / 2;
  const tileRadius = computeSubTileRadius(state, width, height);

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = CONFIG.colors.background;
  ctx.fillRect(0, 0, width, height);

  for (const cell of state.allWorldCells) {
    drawCellBase(ctx, cell, cell, tileRadius, originX, originY, 8, state);
  }

  if (state.currentMapMeta?.family === 'rooms_classic') {
    for (const cell of state.allWorldCells) {
      drawRoomBoundaryOverlayForCell(ctx, cell, cell, tileRadius, originX, originY, state);
    }
  }

  for (const cell of state.allWorldCells) {
    drawEntityOverlay(ctx, cell, cell, tileRadius, originX, originY, state);
  }

  const playerPixel = hexToPixel(state.playerPos, tileRadius, originX, originY);
  drawFacingArrow(ctx, playerPixel.x, playerPixel.y, DIRECTION_ANGLES_DEG[state.committedFacing], CONFIG.colors.committed, Math.max(8, tileRadius * 2.2));
  drawFacingArrow(ctx, playerPixel.x, playerPixel.y, DIRECTION_ANGLES_DEG[state.previewFacing], CONFIG.colors.preview, Math.max(5, tileRadius * 1.4));
  drawLabel(ctx, playerPixel.x, playerPixel.y + Math.max(10, tileRadius * 2.3), 'player', CONFIG.colors.muted, Math.max(8, Math.min(11, tileRadius + 3)));

  if (state.currentMapMeta?.family === 'rooms_classic') {
    drawRoomsClassicDebugOverlay(ctx, state, tileRadius, originX, originY);
  }
}

export function render(state) {
  updateStatusBox(state);
  updateEnemyStatusBox(state);
  renderMain(state);
  renderSub(state);
}
