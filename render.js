import { CONFIG } from './config.js';
import {
  HEADING_ANGLES_DEG,
  HEADING_LABELS,
  getNeighbor,
  hexDistance,
  hexToPixel,
  isInsideWorld,
  polygonCorners,
} from './hex.js';
import { getFeature, getRuntimeCell, getVisualCellAt } from './map.js';
import { getSpriteAsset } from './asset-loader.js';

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
// v1-0b.1(CHANGELOG フェーズ 51): main は PNG 経路 + programmatic フォールバック、
//                                   sub は完全 programmatic に分離。
// ==============================================================================
//
// 構造(論点 C 合意 2026-04-24):
//   spriteKey = { kind, state, variant, rotation }
//     kind:     'room' | 'corridor' | 'threshold' | 'wall' | 'door' | 'stairs' | 'void'
//     state:    door: 'closed'|'open'|'locked'、stairs: 'up'|'down'(verticalMode)、他は null
//     variant:  0..3(visualsByKey に焼き込み済み、座標決定的)
//     rotation: 0..5(同上)
//
// drawer 辞書は v1-0b.1 で 2 系統に分離:
//   SPRITE_DRAWERS_PROG: 全 programmatic(副画面 + PNG 未配置時のフォールバック)
//   SPRITE_DRAWERS_PNG:  主画面用、PNG が無ければ Prog にフォールバック
//
// mode 表現:
//   - PROG drawer: SPRITE_PALETTES[mode] でパレット切替(従来通り)
//   - PNG drawer:  visible は PNG そのまま、near/known は ctx.filter で post-effect
// ==============================================================================

// PNG 描画スケール:アセットは 128×111 px(頂点間 128 = 2×size、辺間 111 ≈ √3×size、size=64)。
// drawImage 時の dst サイズは tileRadius を size とみなして比例縮小する。
const SQRT3 = Math.sqrt(3);

// near/known mode の post-effect。PNG drawer のみで適用。
// 数値は v1-0b.3 で実機チューニング予定。
const MODE_FILTERS = {
  visible: null,
  near: 'blur(1.5px) brightness(0.92) saturate(0.85)',
  known: 'brightness(0.42) saturate(0.55)',
};

// タイル色のバリアント補正(輝度調整)。
// v1-0a 初回は ±5% で控えめにしたが、実機で見えなさすぎたため ±15% に強化。
// v1-0b の PNG 差し替えで本格的なバリアント表現になるため、それまでの暫定値。
function shiftColorByVariant(hexColor, variant) {
  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);
  const factor = [0.85, 0.93, 1.08, 1.18][variant] ?? 1;
  const cr = Math.max(0, Math.min(255, Math.round(r * factor)));
  const cg = Math.max(0, Math.min(255, Math.round(g * factor)));
  const cb = Math.max(0, Math.min(255, Math.round(b * factor)));
  return `rgb(${cr},${cg},${cb})`;
}

// variant/rotation の programmatic 表現:rotation 方向に目印ドット 1 個。
// v1-0a 初回は tileRadius*0.08 で見えなかったため tileRadius*0.16 に拡大。
// v1-0b の PNG 差し替えで廃止予定(PNG 自体にバリアント模様が入るため)。
function drawVariantDot(ctx, cx, cy, tileRadius, rotation, color) {
  if (tileRadius < 6) return;
  const angleDeg = HEADING_ANGLES_DEG[rotation];
  const angleRad = (angleDeg * Math.PI) / 180;
  const rr = tileRadius * 0.42;
  const x = cx + Math.cos(angleRad) * rr;
  const y = cy + Math.sin(angleRad) * rr;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(2, tileRadius * 0.16), 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

// 状態色(visible / near / known の 3 モード × kind × 属性)。v0 の getSemanticPalette を移植。
// dot 色は tile fill から視認できるよう、各段階で明るめに設定(v1-0a 実機確認調整後)。
const SPRITE_PALETTES = {
  visible: {
    room:       { fill: CONFIG.colors.floorVisible,  stroke: CONFIG.colors.floorVisibleStroke, dot: '#6a9bbb' },
    corridor:   { fill: '#25516c',                   stroke: '#3c6f90',                        dot: '#78b5d8' },
    threshold:  { fill: '#436177',                   stroke: '#6a8ba3',                        dot: '#9cc6dc' },
    wall:       { fill: CONFIG.colors.wallVisible,   stroke: CONFIG.colors.wallVisibleStroke,  dot: '#8eb3c8' },
    doorClosed: { fill: '#6a5531',                   stroke: '#b59554' },
    doorLocked: { fill: '#7a2f3a',                   stroke: '#c55763' },
    doorOpen:   { fill: '#2f6a5a',                   stroke: '#61a890' },
    stairs:     { fill: '#4e4b75',                   stroke: '#a5a2d8' },
  },
  near: {
    room:       { fill: CONFIG.colors.floorNear,     stroke: CONFIG.colors.floorNearStroke,    dot: '#716c9b' },
    corridor:   { fill: '#353357',                   stroke: '#55537b',                        dot: '#7e7ba9' },
    threshold:  { fill: '#4a5165',                   stroke: '#727a92',                        dot: '#99a2c2' },
    wall:       { fill: CONFIG.colors.wallNear,      stroke: CONFIG.colors.wallNearStroke,     dot: '#8e85a9' },
    doorClosed: { fill: '#62513b',                   stroke: '#8f7756' },
    doorLocked: { fill: '#6a3138',                   stroke: '#a04753' },
    doorOpen:   { fill: '#31584e',                   stroke: '#4d8274' },
    stairs:     { fill: '#403c5e',                   stroke: '#7b78b0' },
  },
  known: {
    room:       { fill: CONFIG.colors.floorKnown,    stroke: CONFIG.colors.floorKnownStroke,   dot: '#4a637c' },
    corridor:   { fill: '#1d3040',                   stroke: '#33495d',                        dot: '#4f7591' },
    threshold:  { fill: '#2a3a47',                   stroke: '#445563',                        dot: '#5e7488' },
    wall:       { fill: CONFIG.colors.wallKnown,     stroke: CONFIG.colors.wallKnownStroke,    dot: '#5b7084' },
    doorClosed: { fill: '#544633',                   stroke: '#7b6a50' },
    doorLocked: { fill: '#522a31',                   stroke: '#7a4048' },
    doorOpen:   { fill: '#25483f',                   stroke: '#416a5f' },
    stairs:     { fill: '#322f4a',                   stroke: '#5b5888' },
  },
};

function drawRoomSpriteProg(ctx, cx, cy, tileRadius, spriteKey, mode) {
  const palette = SPRITE_PALETTES[mode].room;
  const fill = shiftColorByVariant(palette.fill, spriteKey.variant);
  drawHex(ctx, cx, cy, tileRadius - 1, fill, palette.stroke);
  drawVariantDot(ctx, cx, cy, tileRadius, spriteKey.rotation, palette.dot);
}

function drawCorridorSpriteProg(ctx, cx, cy, tileRadius, spriteKey, mode) {
  const palette = SPRITE_PALETTES[mode].corridor;
  const fill = shiftColorByVariant(palette.fill, spriteKey.variant);
  drawHex(ctx, cx, cy, tileRadius - 1, fill, palette.stroke);
  drawVariantDot(ctx, cx, cy, tileRadius, spriteKey.rotation, palette.dot);
}

function drawThresholdSpriteProg(ctx, cx, cy, tileRadius, spriteKey, mode) {
  const palette = SPRITE_PALETTES[mode].threshold;
  const fill = shiftColorByVariant(palette.fill, spriteKey.variant);
  drawHex(ctx, cx, cy, tileRadius - 1, fill, palette.stroke);
  drawVariantDot(ctx, cx, cy, tileRadius, spriteKey.rotation, palette.dot);
}

function drawWallSpriteProg(ctx, cx, cy, tileRadius, spriteKey, mode) {
  const palette = SPRITE_PALETTES[mode].wall;
  const fill = shiftColorByVariant(palette.fill, spriteKey.variant);
  drawHex(ctx, cx, cy, tileRadius - 1, fill, palette.stroke);
  drawVariantDot(ctx, cx, cy, tileRadius, spriteKey.rotation, palette.dot);
}

// v1-0a(S6): shadeColor - 色の明度を +/- amount で補正。closed/locked ドアの側面陰影用。
function shadeColor(hexOrRgb, amount) {
  // hex (#rrggbb) または rgb(r,g,b) を受け付ける
  let r, g, b;
  if (hexOrRgb.startsWith('#')) {
    r = parseInt(hexOrRgb.slice(1, 3), 16);
    g = parseInt(hexOrRgb.slice(3, 5), 16);
    b = parseInt(hexOrRgb.slice(5, 7), 16);
  } else {
    const m = hexOrRgb.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (!m) return hexOrRgb;
    r = parseInt(m[1], 10);
    g = parseInt(m[2], 10);
    b = parseInt(m[3], 10);
  }
  const factor = 1 + amount;
  const cr = Math.max(0, Math.min(255, Math.round(r * factor)));
  const cg = Math.max(0, Math.min(255, Math.round(g * factor)));
  const cb = Math.max(0, Math.min(255, Math.round(b * factor)));
  return `rgb(${cr},${cg},${cb})`;
}

// v1-0a(S6): 鍵穴アイコン。locked ドアの中心に描画。
// 上部の円 + 下部の縦棒(テーパー状)の 2 パーツ構成、金色系。
function drawKeyholeIcon(ctx, cx, cy, tileRadius) {
  const r = Math.max(2, tileRadius * 0.14);
  const color = '#f0c040';
  const stroke = '#2a1a00';

  // 上部の円(鍵穴の穴)
  ctx.beginPath();
  ctx.arc(cx, cy - r * 0.3, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = Math.max(1, r * 0.25);
  ctx.fill();
  ctx.stroke();

  // 下部の縦棒(鍵差し込み口)
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * 0.3);
  ctx.lineTo(cx, cy + r * 1.6);
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineWidth = r * 0.9;
  ctx.stroke();
  // 縁取り
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * 0.3);
  ctx.lineTo(cx, cy + r * 1.6);
  ctx.strokeStyle = stroke;
  ctx.lineWidth = Math.max(1, r * 0.2);
  ctx.stroke();
}

// v1-0a(S6): 六角柱の側面描画。
// 天面六角の南3辺(edge 0→1=SE斜辺、1→2=底辺、2→3=SW斜辺)に対応する台形を、
// 下に lift 分だけ下げた底辺と繋いで描画する。
// polygonCorners の角度規則(0°=右、60°刻み時計回り、y 軸下向き)と整合。
function drawHexPillarSide(ctx, cx, cy, size, lift, fillColor, strokeColor) {
  const top = polygonCorners(cx, cy, size);
  const bottom = polygonCorners(cx, cy + lift, size);

  // 南 3 辺:corner 0→1 (SE)、1→2 (S)、2→3 (SW)
  for (let i = 0; i < 3; i += 1) {
    const p0 = top[i];
    const p1 = top[(i + 1) % 6];
    const q0 = bottom[i];
    const q1 = bottom[(i + 1) % 6];

    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.lineTo(q1.x, q1.y);
    ctx.lineTo(q0.x, q0.y);
    ctx.closePath();
    ctx.fillStyle = fillColor;
    ctx.fill();
    if (strokeColor) {
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

// v1-0a(S6): モデル A 六角柱ドア(NEXT_STEPS §2.1、CHANGELOG フェーズ 40 D31)。
//   - open   : Z=0、床と同じ高さのフラット塗り(v0 互換の緑系)
//   - closed : Z+h で立った六角柱(下地 threshold + 南3辺の側面 + 天面)
//   - locked : closed と同じ柱 + 中心に鍵穴アイコン
// 影の方向は世界座標の南固定(world 回転の内側で描画、world と一緒に回る=
//  「太陽が南中」表現)。世界が回っても影は常に世界の南側に落ちる。
function drawDoorSpriteProg(ctx, cx, cy, tileRadius, spriteKey, mode) {
  // open: フラット塗りのみ(床同化)
  if (spriteKey.state === 'open') {
    const palette = SPRITE_PALETTES[mode].doorOpen;
    drawHex(ctx, cx, cy, tileRadius - 1, palette.fill, palette.stroke);
    return;
  }

  // closed / locked: 六角柱描画
  const paletteKey = spriteKey.state === 'locked' ? 'doorLocked' : 'doorClosed';
  const palette = SPRITE_PALETTES[mode][paletteKey];

  // Layer 1: 下地(タイルの足元、threshold の床色)
  const ground = SPRITE_PALETTES[mode].threshold;
  drawHex(ctx, cx, cy, tileRadius - 1, ground.fill, ground.stroke);

  // Layer 2: 柱の南 3 辺側面(下に lift 分だけ降りる台形を 3 枚)
  // 側面色は天面色 -40% 暗く、縁は側面色と同じでエッジを目立たせない
  const lift = Math.max(3, tileRadius * 0.30);
  const sideColor = shadeColor(palette.fill, -0.40);
  drawHexPillarSide(ctx, cx, cy, tileRadius - 1, lift, sideColor, sideColor);

  // Layer 3: 天面(元位置、通常色、柱の上面)
  drawHex(ctx, cx, cy, tileRadius - 1, palette.fill, palette.stroke);

  // locked: 中心に鍵穴アイコン(visible モードで tileRadius 十分な時のみ)
  if (spriteKey.state === 'locked' && mode === 'visible' && tileRadius >= 10) {
    drawKeyholeIcon(ctx, cx, cy, tileRadius);
  }
}

function drawStairsSpriteProg(ctx, cx, cy, tileRadius, spriteKey, mode) {
  const palette = SPRITE_PALETTES[mode].stairs;
  drawHex(ctx, cx, cy, tileRadius - 1, palette.fill, palette.stroke);
  if (tileRadius >= 8) {
    const label = spriteKey.state === 'up' ? '↑' : '↓';
    const color = mode === 'visible' ? CONFIG.colors.text : CONFIG.colors.muted;
    drawLabel(ctx, cx, cy - 5, label, color, Math.max(9, Math.floor(tileRadius * 0.42)));
  }
}

function drawVoidSpriteProg(ctx, cx, cy, tileRadius, spriteKey, mode) {
  // 世界外側の暗タイル。wall パレットを使用。
  const palette = SPRITE_PALETTES[mode].wall;
  drawHex(ctx, cx, cy, tileRadius - 1, palette.fill, palette.stroke);
}

const SPRITE_DRAWERS_PROG = {
  room:      drawRoomSpriteProg,
  corridor:  drawCorridorSpriteProg,
  threshold: drawThresholdSpriteProg,
  wall:      drawWallSpriteProg,
  door:      drawDoorSpriteProg,
  stairs:    drawStairsSpriteProg,
  void:      drawVoidSpriteProg,
};

// ==============================================================================
// v1-0b.1: PNG drawer 群(主画面用)
// ==============================================================================
//
// アセットがあれば PNG を drawImage、無ければ programmatic にフォールバック。
// near/known mode は ctx.filter で post-effect(blur / brightness / saturate)。
// ==============================================================================

// PNG を hex タイル位置に描画。アセットは 128×111(size=64)、tileRadius を新 size として
// 比例縮小して drawImage する。rotation は 60° × index で個別回転。
// ctx.filter は呼び出し側で save/restore して適用する。
function drawSpriteImage(ctx, img, cx, cy, tileRadius, rotationIndex) {
  const dw = tileRadius * 2;
  const dh = tileRadius * SQRT3;

  if (rotationIndex && rotationIndex !== 0) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((rotationIndex * 60 * Math.PI) / 180);
    ctx.drawImage(img, -dw / 2, -dh / 2, dw, dh);
    ctx.restore();
  } else {
    ctx.drawImage(img, cx - dw / 2, cy - dh / 2, dw, dh);
  }
}

// PNG drawer の共通実装。アセットがあれば PNG、無ければ programmatic にフォールバック。
// useTileRotation=true(stairs)なら、PNG 自体の個別 rotation は 0 にし、タイル単位回転は
// drawCellLayer1 側の getTileRotation で適用させる(二重回転防止)。
function makePngDrawer(kind, getStateForKey, useTileRotation, progDrawer) {
  return (ctx, cx, cy, tileRadius, spriteKey, mode) => {
    const state = getStateForKey ? getStateForKey(spriteKey) : null;
    const variant = spriteKey.variant ?? 0;
    const asset = getSpriteAsset(kind, state, variant);

    if (!asset) {
      progDrawer(ctx, cx, cy, tileRadius, spriteKey, mode);
      return;
    }

    const filter = MODE_FILTERS[mode];
    const rotationIndex = useTileRotation ? 0 : (spriteKey.rotation ?? 0);

    if (filter) {
      ctx.save();
      ctx.filter = filter;
      drawSpriteImage(ctx, asset, cx, cy, tileRadius, rotationIndex);
      ctx.restore();
    } else {
      drawSpriteImage(ctx, asset, cx, cy, tileRadius, rotationIndex);
    }
  };
}

const drawRoomSpritePng = makePngDrawer('room', null, false, drawRoomSpriteProg);
const drawCorridorSpritePng = makePngDrawer('corridor', null, false, drawCorridorSpriteProg);
const drawThresholdSpritePng = makePngDrawer('threshold', null, false, drawThresholdSpriteProg);
const drawWallSpritePng = makePngDrawer('wall', null, false, drawWallSpriteProg);
const drawDoorSpritePng = makePngDrawer('door', (key) => key.state ?? 'closed', false, drawDoorSpriteProg);
const drawStairsSpritePng = makePngDrawer('stairs', (key) => key.state ?? 'down', true, drawStairsSpriteProg);

const SPRITE_DRAWERS_PNG = {
  room:      drawRoomSpritePng,
  corridor:  drawCorridorSpritePng,
  threshold: drawThresholdSpritePng,
  wall:      drawWallSpritePng,
  door:      drawDoorSpritePng,
  stairs:    drawStairsSpritePng,
  void:      drawVoidSpriteProg,  // void は PNG 不要、programmatic 維持
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
// v1-0a(S7): 階段タイルは enterHeading 方向が画面上向き(-90°)になるよう回転。
//   「enterHeading が画面上」= 世界座標で enterHeading 方向のディテールが画面の上を向く。
//   世界回転と合成されるので、プレイヤーから見ると「階段の進行方向」が明示される。
//   v1-0b の PNG 差し替え時、階段スプライトの段々/矢印が正しい向きで描画される。
// 他のタイルは 0(個別回転なし)。
function getTileRotation(cell) {
  const feature = getFeature(cell);
  if (feature?.kind === 'stairs') {
    const enterHeading = feature.params?.enterHeading ?? 0;
    // PNG / programmatic スプライトの基準方向は「画面上向き」(-90°)。
    // enterHeading 方向に基準方向を回す回転角:
    //   HEADING_ANGLES_DEG[h] - (-90) = HEADING_ANGLES_DEG[h] + 90
    // 旧式 `-90 - HEADING_ANGLES_DEG[h]` は対称軸(N/S)では偶然一致するが、
    // 対角 4 方向(NE/SE/SW/NW)で鏡像方向に回る bug があり、
    // CHANGELOG フェーズ 51 修正版でフェーズ 52 にて訂正。
    return HEADING_ANGLES_DEG[enterHeading] + 90;
  }
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
// v1-0b.1: drawers 引数で drawer set を切り替え(主画面 = PNG 経路、副画面 = Prog)。
function drawCellLayer1(ctx, cell, drawHexCoord, tileRadius, originX, originY, state, drawers) {
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
  const drawer = drawers[sprite.kind] ?? drawers.void;

  // タイル個別回転(v1-0a S7:stairs は enterHeading 方向が画面上を向くよう回転、
  // それ以外のタイルは 0 を返す)。CHANGELOG フェーズ 50 でコメント更新。
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

// ==============================================================================
// v1-0b.1: shadow pass(NEXT_STEPS §2.1、CHANGELOG フェーズ 51)
// ==============================================================================
//
// 「内部環境なので影はない」が物理的に正しいが、立体感のため疑似ドロップシャドウを
// 落とす。物理モデル:
//
//   - z=+h ブロック(hex)はそれ自身と同形状の hex 影を落とす
//   - 影 = source hex を SHADOW_CONFIG の (angle, length) で平行移動した polygon
//   - 移動先で 3 枚の隣接タイルに跨る形で見える(angle / length の値による)
//   - 各 recipient タイルは自身の hex で clip して shifted source hex の断片を描画
//
// SHADOW_CONFIG パラメータ:
//   angleDeg     - 影の方向。N=0°、E=90°、時計回り(画面座標と同じ規則)
//   lengthRatio  - 影の長さ。タイル直径(2 × tileRadius)を 1 とする
//   alpha        - 影の不透明度
//
// 例: angleDeg=0, lengthRatio=0.25 → 北方向に直径 25% 分の変位。
//     z=+h ブロックの影が北側 3 タイル(N / NE / NW)に薄く跨る。
//
// 描画順:
//   Layer 1(タイル天面) → shadow pass → stairs edges → Layer 2 → Layer 3
//
// 主画面のみ実行(副画面は構造表示のため shadow pass を持たない)。
// world 回転の内側で呼ばれるため、影方向は「世界座標の絶対方向」固定
// (副画面ノースアップ規則と整合、player heading によらない)。
//
// 拡張点:
//   getTileHeight(cell) を v1+ で柱・障害物・unstable など追加した時の単一フック点とする。
// ==============================================================================

const SHADOW_CONFIG = {
  angleDeg: 0,        // N=0、時計回り
  lengthRatio: 0.25,  // タイル直径(2 × tileRadius)に対する比率
  alpha: 0.32,
};

function getTileHeight(cell) {
  const runtime = getRuntimeCell(cell);
  if (!runtime) {
    // rooms_classic 等で構造化セル外(= void)。描画時 drawVoidSpriteProg が
    // wall パレットで塗っており、視覚上は wall と同等のため z=+h として扱う。
    // これがないと rooms_classic family で部屋外周の壁が影を落とさなくなる。
    return 1;
  }
  // 壁(blocked support): 物理的に立っている → z=+h
  if (!runtime.canStandAtHere) return 1;
  // closed / locked ドア: 柱として立っている → z=+h
  const feature = runtime.feature;
  if (feature?.kind === 'door' && (feature.state === 'closed' || feature.state === 'locked')) {
    return 1;
  }
  // open ドア・階段・床は z=0
  return 0;
}

// SHADOW_CONFIG.angleDeg / lengthRatio を pixel 変位ベクトル (dx, dy) に変換。
// 画面座標系では +x = 東、+y = 南なので、N(angle=0)は -y 方向。
function computeShadowOffset(tileRadius) {
  const angleRad = (SHADOW_CONFIG.angleDeg * Math.PI) / 180;
  const lengthPx = SHADOW_CONFIG.lengthRatio * 2 * tileRadius;
  return {
    dx: lengthPx * Math.sin(angleRad),
    dy: -lengthPx * Math.cos(angleRad),
  };
}

function pathHexAt(ctx, cx, cy, size) {
  const corners = polygonCorners(cx, cy, size);
  ctx.beginPath();
  ctx.moveTo(corners[0].x, corners[0].y);
  for (let i = 1; i < 6; i += 1) {
    ctx.lineTo(corners[i].x, corners[i].y);
  }
  ctx.closePath();
}

// shadow pass: 各 z=+h source タイルから shifted hex 影を生成し、6 隣接の各 recipient で
// clip して描画する。recipient と source の両方が explored、recipient は z=0 が必要。
// world 回転の内側で呼ばれる(影方向は世界座標で絶対固定)。
function drawShadowPass(ctx, cells, tileRadius, originX, originY, state) {
  const { dx, dy } = computeShadowOffset(tileRadius);
  if (dx === 0 && dy === 0) return;  // length 0 = 影なし
  const worldRadius = state.config.worldRadius;
  const hexSize = tileRadius - 1;  // drawHex と揃える(stroke 用 1px ギャップ)

  // pixel 位置を pre-compute(同じ cell を source / recipient で 2 度引く可能性があるため)
  const pixelByKey = new Map();
  for (const cell of cells) {
    const drawHexCoord = cell.subtract(state.playerPos);
    pixelByKey.set(cell.key(), hexToPixel(drawHexCoord, tileRadius, originX, originY));
  }

  const fillStyle = `rgba(0, 0, 0, ${SHADOW_CONFIG.alpha})`;

  for (const sourceCell of cells) {
    const sourceKey = sourceCell.key();
    if (!state.explored.has(sourceKey)) continue;
    if (getTileHeight(sourceCell) === 0) continue;  // source は z=+h のみ

    const sourcePixel = pixelByKey.get(sourceKey);
    const shadowCx = sourcePixel.x + dx;
    const shadowCy = sourcePixel.y + dy;

    // 6 隣接を全て見て、recipient 該当なら shifted hex を recipient hex で clip して描画。
    // 影方向に応じて 3 枚に重なる(残り 3 枚は shifted hex が届かないため空 fill = no-op)。
    for (let h = 0; h < 6; h += 1) {
      const recipient = getNeighbor(sourceCell, h);
      if (!isInsideWorld(recipient, worldRadius)) continue;
      const recipientKey = recipient.key();
      if (!state.explored.has(recipientKey)) continue;
      if (getTileHeight(recipient) > 0) continue;  // recipient は z=0 のみ

      const recipientPixel = pixelByKey.get(recipientKey);
      if (!recipientPixel) continue;  // localRadius 外(= 描画されない)→ skip

      ctx.save();
      pathHexAt(ctx, recipientPixel.x, recipientPixel.y, hexSize);
      ctx.clip();
      pathHexAt(ctx, shadowCx, shadowCy, hexSize);
      ctx.fillStyle = fillStyle;
      ctx.fill();
      ctx.restore();
    }
  }
}

// ==============================================================================

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
  // AI 状態バッジ・facing・HP は visible 時のみ表示。
  // nearAware は「気配で存在のみ知覚」(PRINCIPLES §8 知覚原理)で、
  // AI の内部状態(巡 / 追 / 確 / 帰)が漏れるのは知覚軸違反(CHANGELOG フェーズ 50)。
  if (mode === 'visible') {
    drawEnemyStateBadge(ctx, pixel.x, pixel.y, enemy.mode, mode);
    drawEnemyFacing(ctx, pixel.x, pixel.y, enemy.facing);
    drawLabel(ctx, pixel.x, pixel.y + 14, `${enemy.hp}`, CONFIG.colors.text, 10);
  }
}

export function updateStatusBox(state) {
  const box = document.getElementById('statusBox');
  // 残敵数は知覚原理(PRINCIPLES §8)上のメタ情報。debug overlay 時のみ表示する
  // (CHANGELOG フェーズ 50)。enemy_status_box の通常モード表示と方針を統一。
  const debugRows = state.debugOverlay
    ? `<div class="status-row"><span>残敵数(debug)</span><strong>${state.enemies.length}</strong></div>`
    : '';
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
    ${debugRows}
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

  // Layer 1: タイル天面スプライト(主画面 = PNG 経路 + Prog フォールバック)
  for (const cell of cells) {
    const drawHexCoord = cell.subtract(state.playerPos);
    drawCellLayer1(ctx, cell, drawHexCoord, tileRadius, originX, originY, state, SPRITE_DRAWERS_PNG);
  }

  // v1-0b.1: Layer 1.5: shadow pass(主画面のみ、world 回転内側 = 影は世界座標固定)
  drawShadowPass(ctx, cells, tileRadius, originX, originY, state);

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

  // Layer 1(副画面は完全 programmatic、shadow pass なし = 構造表示のため)
  for (const cell of state.allWorldCells) {
    drawCellLayer1(ctx, cell, cell, tileRadius, originX, originY, state, SPRITE_DRAWERS_PROG);
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
