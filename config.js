export const CONFIG = {
  worldRadius: 40,
  defaultGeneratedMapId: 'generated_rooms',
  generatedMaps: {
    generated_tunnel: {
      label: 'Generated / Tunnel',
      family: 'tunnel',
      seed: 20260415,
      params: {
        floorRate: 0.36,
        loopiness: 0.14,
        chokeDensity: 0.30,
      },
    },
    generated_cavern: {
      label: 'Generated / Cavern',
      family: 'cavern',
      seed: 20260418,
      params: {
        fillProb: 0.49,
        smoothPasses: 5,
        loopOpenings: 2,
        minFloorCount: 300,
      },
    },
    generated_rooms: {
      label: 'Generated / Rooms',
      family: 'rooms',
      seed: 20260419,
      params: {},
    },
  },
  losEpsilon: 0.05,
  losSampleStep: 0.04,

  // GLOSSARY §3: perception profile。命名規則 *_perception。
  // v2 用 4 フィールド(requiresLight 等)は schema として用意、v0 では未使用。
  perceptionProfiles: {
    player_perception: {
      visionRadius: 7,
      fovHalfAngleDeg: 60,
      adjacentAwareRadius: 1,
      requiresLight: false,
      darkvisionRadius: 0,
      emitsLightRadius: 0,
      detectsLitTargets: true,
    },
    watcher_perception: {
      visionRadius: 7,
      fovHalfAngleDeg: 60,
      adjacentAwareRadius: 1,
      requiresLight: false,
      darkvisionRadius: 0,
      emitsLightRadius: 0,
      detectsLitTargets: true,
    },
    // sentry_perception は v1+ で door_guard 導入時に有効化(ROADMAP Part 1 §6.1)。
  },

  // GLOSSARY §3: AI profile。命名規則 *_ai。
  aiProfiles: {
    default_ai: {
      avoidsStairs: true,
    },
  },

  // GLOSSARY §2: enemyKind。v0 は watcher のみ。
  enemyKinds: {
    watcher: {
      name: 'Watcher',
      hp: 3,
      wtRange: [8, 13],
      perception: 'watcher_perception',
      ai: 'default_ai',
      damage: 1,
    },
    // door_guard は v1+ で追加(ROADMAP Part 1 §6.1)。
  },

  // プレイヤー定数(SPEC §11.1)。
  player: {
    hp: 8,
    maxHp: 8,
    wt: 10,
    damage: 1,
    perception: 'player_perception',
  },

  main: {
    tileRadius: 24,
    localRadius: 7,
  },
  sub: {
    // v1-0a(NEXT_STEPS §2.1): 副画面は worldRadius 全体を表示するため tileRadius=4 固定。
    // v0 の 9 から変更(9 では world 全体が副画面に入りきらなかった)。
    tileRadius: 4,
  },
  colors: {
    background: '#0e141a',
    unknown: '#06080b',
    unknownStroke: '#11161c',
    wallVisible: '#3b4b5d',
    wallVisibleStroke: '#536679',
    floorVisible: '#1f394f',
    floorVisibleStroke: '#35546f',
    wallKnown: '#26313c',
    wallKnownStroke: '#394754',
    floorKnown: '#182430',
    floorKnownStroke: '#273744',
    wallNear: '#4d465f',
    wallNearStroke: '#6a6381',
    floorNear: '#2a2940',
    floorNearStroke: '#4b4965',
    player: '#ffd166',
    enemyVisible: '#ff6b6b',
    enemyNear: '#cc7a7a',
    committed: '#ff7b72',
    preview: '#9be564',
    text: '#dbe7f3',
    muted: '#8ca0b3',
    // v1-0a(NEXT_STEPS §2.1): 副画面の worldRadius 境界線色。
    // 落ち着いたブルーグレーで、タイル色と干渉せず視認できる明度を選定。
    worldBoundary: '#5b7a95',
  },
};

// v1-0b.1.2(フェーズ 54、A-2): 描画チューニング値の集約。
// shadow pass / blur 量など、実機で要調整の数値を一箇所に置く。
// CSS の blur は --main-blur 経由(bootstrap で setProperty で書き出し)。
export const RENDER_TUNING = {
  shadow: {
    // shadow pass(z=+h ブロックの hex 投影)
    // angleDeg: 影の方向。N=0°、E=90°、時計回り(画面座標と同じ規則)
    // lengthRatio: タイル直径(2 × tileRadius)に対する変位長
    // alpha: 影の不透明度
    angleDeg: 0,
    lengthRatio: 0.25,
    alpha: 0.32,
  },
  blur: {
    // 主画面 BG canvas の CSS filter blur 量(px)。
    // bootstrap で document.documentElement.style.setProperty('--main-blur', `${value}px`) と書き出す。
    // PC(DPR=1)と iOS(DPR=2〜3)で見え方が異なるため、最終チューニングは v1-0b.3。
    mainBgPx: 2,
  },
};

export const LOCAL_MOVE_LABELS = ['前', '右前', '右後', '後', '左後', '左前'];
