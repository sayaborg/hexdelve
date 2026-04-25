// v1-0b.1(NEXT_STEPS §2.1、CHANGELOG フェーズ 49):
// PNG スプライトのプリロードとキャッシュを担当。
//
// 設計原則:
//   - PNG が無くても動く(programmatic フォールバックを render 側に保持)
//   - 段階的投入を許容(kind ごとに揃わなくても OK、足りない asset は null を返す)
//   - 主画面のみが消費(副画面は完全 programmatic、本モジュールを参照しない)
//   - サイズは 128×111 px(頂点間 × 辺間、size=64、flat-top hex)
//
// アセット配置: assets/sprites/ ディレクトリ
//   命名規則:
//     room_{variant}.png         (variant = 0..3)
//     corridor_{variant}.png
//     threshold_{variant}.png
//     wall_{variant}.png
//     door_{state}.png           (state = closed | open | locked)
//     stairs_{state}.png         (state = up | down)
//   void は単色のため programmatic 維持。
//
// variant が 1 種類しか用意されていない場合(初期投入時)、variantCount を 1 にして
// modulo で 0 番に集約する。完全 4 variant 投入時は variantCount を 4 にする。

const SPRITE_MANIFEST = {
  room:      { variantCount: 4, states: null },
  corridor:  { variantCount: 4, states: null },
  threshold: { variantCount: 4, states: null },
  wall:      { variantCount: 4, states: null },
  door:      { variantCount: 1, states: ['closed', 'open', 'locked'] },
  stairs:    { variantCount: 1, states: ['up', 'down'] },
};

const ASSET_BASE_PATH = './assets/sprites/';

// asset cache: key → HTMLImageElement | null(404 時は null を保持)
const assetCache = new Map();

function spriteAssetKey(kind, state, variant) {
  return `${kind}:${state ?? '-'}:${variant ?? 0}`;
}

function spriteFileName(kind, state, variant) {
  if (state) {
    return `${kind}_${state}.png`;
  }
  return `${kind}_${variant}.png`;
}

// 1 枚の画像を非同期に読み込む。失敗時は null で resolve(reject しない)。
function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

// 全アセットをプリロード。onProgress(done, total) を逐次呼ぶ(オプション)。
// 全 task が resolve されるまで待つ(404 もエラー扱いせず、cache に null が入るだけ)。
export async function preloadAllSprites(onProgress = null) {
  const tasks = [];

  for (const [kind, def] of Object.entries(SPRITE_MANIFEST)) {
    const states = def.states ?? [null];
    for (const state of states) {
      for (let variant = 0; variant < def.variantCount; variant += 1) {
        const key = spriteAssetKey(kind, state, variant);
        const url = ASSET_BASE_PATH + spriteFileName(kind, state, variant);
        tasks.push(
          loadImage(url).then((img) => {
            assetCache.set(key, img);
            return { key, ok: img !== null };
          }),
        );
      }
    }
  }

  const total = tasks.length;
  let done = 0;
  const wrappedTasks = tasks.map((task) =>
    task.then((result) => {
      done += 1;
      onProgress?.(done, total, result);
      return result;
    }),
  );

  const results = await Promise.all(wrappedTasks);
  const okCount = results.filter((r) => r.ok).length;
  return { total, ok: okCount };
}

// drawer から呼ぶ。指定 kind/state/variant の HTMLImageElement または null を返す。
// variant は manifest の variantCount で modulo されるため、unsafe な variant 値が
// 来ても OOB しない(compileMap の variant=0..3 がそのまま渡る前提)。
export function getSpriteAsset(kind, state, variant) {
  const def = SPRITE_MANIFEST[kind];
  if (!def) return null;
  const effectiveVariant = (variant ?? 0) % def.variantCount;
  return assetCache.get(spriteAssetKey(kind, state, effectiveVariant)) ?? null;
}

// debug 用: キャッシュ状況の集計
export function getAssetStats() {
  let total = 0;
  let loaded = 0;
  for (const [, img] of assetCache.entries()) {
    total += 1;
    if (img !== null) loaded += 1;
  }
  return { total, loaded };
}
