// v1-0a(NEXT_STEPS §2.1): 入力系の束ね。
//   - bindControls: 固定ボタン(回頭、待機、移動)とマップ UI
//   - bindMainCanvasGestures: 主画面のタップ/スワイプ(7 ゾーン判定 + 角度差回頭)
//   - bindKeyboard: キーボード(矢印回頭、QWEASD 移動、Z 待機、F3 debug)

export function bindControls(handlers) {
  document.getElementById('rotateLeftBtn').addEventListener('click', () => handlers.rotatePreview(-1));
  document.getElementById('rotateRightBtn').addEventListener('click', () => handlers.rotatePreview(1));

  // 待機ボタン(下段 hex-pad など、複数あり得るため data-wait-btn で捕捉)
  document.querySelectorAll('[data-wait-btn]').forEach((button) => {
    button.addEventListener('click', handlers.waitAction);
  });

  // 移動ボタン(下段 hex-pad、data-local-move=0..5)
  document.querySelectorAll('[data-local-move]').forEach((button) => {
    button.addEventListener('click', () => {
      handlers.tryMove(Number(button.dataset.localMove));
    });
  });

  // マップ選択 UI
  const mapSelect = document.getElementById('mapSelect');
  const resetMapBtn = document.getElementById('resetMapBtn');

  if (mapSelect) {
    mapSelect.addEventListener('change', (event) => {
      handlers.onSelectMap?.(event.target.value);
    });
  }
  if (resetMapBtn) {
    resetMapBtn.addEventListener('click', () => {
      handlers.onResetMap?.();
    });
  }
}

// ==============================================================================
// v1-0a(S8+S9 統合、NEXT_STEPS §2.1): 主画面 canvas のジェスチャ処理
// ==============================================================================
//
// タップ:主画面を HEX 6 方向 + 中心の 7 分割、タップ位置で移動/待機を決定。
//   主画面はヘディングアップ表示 → 画面上が「前」= localMove 0、右上が「右前」= 1 …。
//   HEADING_ANGLES_DEG と画面座標の規則が自然に一致する。
//
// スワイプ:画面中心を軸にしたポインタ角度差を facing ステップに換算。
//   ドラッグ中はリアルタイムに preview facing を更新(silent = log 出さない)、
//   pointerup で最終値を log に 1 回出して確定。
//
// 判別:pointerdown からの移動量が TAP_THRESHOLD_PX 未満ならタップ、それ以上ならスワイプ。
// ==============================================================================

const TAP_THRESHOLD_PX = 12;        // この距離未満ならタップ扱い
const CENTER_ZONE_RATIO = 0.14;     // 主画面短辺に対する待機ゾーン半径の比
const CENTER_DEADZONE_PX = 14;      // 画面中心近傍は角度不安定のため無視
const ZONE_ANGLES_DEG = [-90, -30, 30, 90, 150, -150];

function localMoveFromScreenAngle(angleDeg) {
  // localMove n の画面上角度 = HEADING_ANGLES_DEG[n]。
  // 画面上(-90°)= 前、右上(-30°)= 右前、右下(30°)= 右後、
  // 画面下(90°)= 後、左下(150°)= 左後、左上(-150°)= 左前。
  let bestLocalMove = 0;
  let bestDiff = Infinity;
  for (let lm = 0; lm < 6; lm += 1) {
    let diff = Math.abs(angleDeg - ZONE_ANGLES_DEG[lm]);
    if (diff > 180) diff = 360 - diff;
    if (diff < bestDiff) {
      bestDiff = diff;
      bestLocalMove = lm;
    }
  }
  return bestLocalMove;
}

function angleFromCenter(clientX, clientY, cx, cy) {
  const dx = clientX - cx;
  const dy = clientY - cy;
  if (Math.hypot(dx, dy) < CENTER_DEADZONE_PX) return null;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

export function bindMainCanvasGestures(handlers) {
  const canvas = document.getElementById('mainCanvas');
  if (!canvas) return;

  let isPressed = false;
  let startClientX = 0;
  let startClientY = 0;
  let startFacing = 0;
  let startAngleDeg = null;
  let movedBeyondTapThreshold = false;

  const getCenter = () => {
    const rect = canvas.getBoundingClientRect();
    return {
      rect,
      cx: rect.left + rect.width / 2,
      cy: rect.top + rect.height / 2,
    };
  };

  // ------ 共通ハンドラ(touch / mouse から呼ばれる) ------

  const onStart = (clientX, clientY) => {
    isPressed = true;
    startClientX = clientX;
    startClientY = clientY;
    startFacing = handlers.getCurrentPreviewFacing?.() ?? 0;
    const center = getCenter();
    startAngleDeg = angleFromCenter(clientX, clientY, center.cx, center.cy);
    movedBeyondTapThreshold = false;
  };

  const onMove = (clientX, clientY) => {
    if (!isPressed) return;
    const dx = clientX - startClientX;
    const dy = clientY - startClientY;
    if (!movedBeyondTapThreshold && Math.hypot(dx, dy) >= TAP_THRESHOLD_PX) {
      movedBeyondTapThreshold = true;
    }
    if (!movedBeyondTapThreshold) return;

    // スワイプ:画面中心を軸にしたポインタの角度差で facing を決定。
    // 「指の回転方向 = 画面上の世界の回転方向」= プレイヤーは逆向きに回頭(地図アプリ的な直感)。
    const center = getCenter();
    const currentAngle = angleFromCenter(clientX, clientY, center.cx, center.cy);
    if (startAngleDeg === null || currentAngle === null) return;
    let delta = currentAngle - startAngleDeg;
    while (delta > 180) delta -= 360;
    while (delta < -180) delta += 360;
    const steps = -Math.round(delta / 60);  // 符号反転:指の動き ↔ プレイヤー回頭方向
    const newFacing = (startFacing + steps + 6000) % 6;
    handlers.setPreviewFacing?.(newFacing, { silent: true });
  };

  const onEnd = (clientX, clientY, { cancelled = false } = {}) => {
    if (!isPressed) return;
    isPressed = false;
    if (cancelled) return;

    if (movedBeyondTapThreshold) {
      handlers.commitSwipeFacing?.();
      return;
    }

    // タップ:画面中心からのベクトルで 7 ゾーン判定
    const center = getCenter();
    const dx = clientX - center.cx;
    const dy = clientY - center.cy;
    const dist = Math.hypot(dx, dy);
    const centerZoneRadius = Math.min(center.rect.width, center.rect.height) * CENTER_ZONE_RATIO;

    if (dist < centerZoneRadius) {
      handlers.waitAction?.();
      return;
    }
    const angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
    const localMove = localMoveFromScreenAngle(angleDeg);
    handlers.tryMove?.(localMove);
  };

  // ------ Touch events(モバイル)------
  // iOS Chrome 含む全モバイルブラウザで確実に動かすため pointer events は使わない。
  // touchmove は passive: false + preventDefault でブラウザのスクロールを抑制。

  canvas.addEventListener('touchstart', (event) => {
    if (event.touches.length !== 1) return;  // マルチタッチは無視(ピンチズーム等)
    event.preventDefault();
    const t = event.touches[0];
    onStart(t.clientX, t.clientY);
  }, { passive: false });

  canvas.addEventListener('touchmove', (event) => {
    if (event.touches.length !== 1) return;
    event.preventDefault();
    const t = event.touches[0];
    onMove(t.clientX, t.clientY);
  }, { passive: false });

  canvas.addEventListener('touchend', (event) => {
    const t = event.changedTouches[0];
    if (!t) return;
    onEnd(t.clientX, t.clientY);
  });

  canvas.addEventListener('touchcancel', (event) => {
    const t = event.changedTouches[0];
    onEnd(t?.clientX ?? 0, t?.clientY ?? 0, { cancelled: true });
  });

  // ------ Mouse events(PC)------
  // モバイルブラウザは touch 発火後に mousedown を発火しないのが一般的だが、
  // 念のため isPressed で二重起動を防ぐ(touch 中は mouse 側が無視される)。

  canvas.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    if (isPressed) return;
    onStart(event.clientX, event.clientY);
  });

  canvas.addEventListener('mousemove', (event) => {
    if (!isPressed) return;
    onMove(event.clientX, event.clientY);
  });

  canvas.addEventListener('mouseup', (event) => {
    if (!isPressed) return;
    onEnd(event.clientX, event.clientY);
  });

  canvas.addEventListener('mouseleave', () => {
    if (isPressed) {
      onEnd(0, 0, { cancelled: true });
    }
  });

  // CSS 側で canvas の touch-action を固定(JS 実行前でも効くように)。
  canvas.style.touchAction = 'none';
}

export function bindKeyboard(handlers) {
  window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      handlers.rotatePreview(-1);
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      handlers.rotatePreview(1);
      return;
    }
    // F3: debug overlay トグル(ゲームオーバー時も有効)
    if (event.key === 'F3') {
      event.preventDefault();
      handlers.toggleDebugOverlay?.();
      return;
    }
    // Z: 待機ショートカット(QWEASD 移動キーと同じ左手エリア)
    if (key === 'z') {
      event.preventDefault();
      handlers.waitAction?.();
      return;
    }
    const keyToLocalMove = { q: 5, w: 0, e: 1, a: 4, s: 3, d: 2 };
    if (key in keyToLocalMove) {
      event.preventDefault();
      handlers.tryMove(keyToLocalMove[key]);
    }
  });
}
