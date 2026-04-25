// smoke-render.mjs — v1-0b.1 PNG スプライトインフラ層の自己検証。
// 実行: `node smoke-render.mjs`
//
// 目的:
//   - SPRITE_MANIFEST が 21 アセット相当を網羅していることを確認
//   - PNG が 1 枚も配置されていない状態で preloadAllSprites() が reject せず resolve すること
//   - getSpriteAsset() が欠損時に null を返すこと
//   - getAssetStats() の戻り値構造が preloadAllSprites の戻り値と一致していること
//
// browser API(Image)を Node 上で stub し、全リクエストを「404 相当」として
// onerror で resolve させる。これにより asset-loader の「PNG 不在 = null 返却」経路を
// シミュレートする。
//
// 主画面の実描画は canvas 2D context が必要なため本テストでは検証しない
// (browser での実機確認が必要)。

// ----- Image stub(Node 上で browser の HTMLImageElement を擬似) -----

class StubImage {
  constructor() {
    this.onload = null;
    this.onerror = null;
  }
  set src(_value) {
    // 全 URL を 404 扱い:src 設定後の microtask で onerror を発火
    queueMicrotask(() => {
      if (this.onerror) this.onerror();
    });
  }
}

globalThis.Image = StubImage;

// ----- assertion ヘルパ -----

let failures = 0;
function assert(cond, msg) {
  if (cond) {
    console.log('  PASS:', msg);
  } else {
    console.log('  FAIL:', msg);
    failures += 1;
  }
}

// ----- テスト本体 -----

const { preloadAllSprites, getSpriteAsset, getAssetStats } =
  await import('./asset-loader.js');

console.log('=== v1-0b.1 PNG infrastructure smoke ===');
console.log();

// Test A: preloadAllSprites は PNG 不在時に reject せず resolve すること
console.log('--- A. preloadAllSprites with no assets ---');
let preloadResult = null;
try {
  preloadResult = await preloadAllSprites();
  assert(true, 'preloadAllSprites resolves without rejection');
} catch (err) {
  assert(false, `preloadAllSprites should not reject, got: ${err?.message ?? err}`);
}

if (preloadResult) {
  assert(typeof preloadResult.total === 'number',
    `戻り値に total フィールドが存在`);
  assert(typeof preloadResult.ok === 'number',
    `戻り値に ok フィールドが存在`);
  assert(preloadResult.total === 21,
    `manifest 総数が 21(got ${preloadResult.total})。room/corridor/threshold/wall × 4 + door × 3 + stairs × 2 = 21`);
  assert(preloadResult.ok === 0,
    `全 404 状態で ok 数は 0(got ${preloadResult.ok})`);
}
console.log();

// Test B: getSpriteAsset は欠損時に null を返す
console.log('--- B. getSpriteAsset null behavior ---');
assert(getSpriteAsset('room', null, 0) === null,
  'getSpriteAsset(room, null, 0) は null(404 後)');
assert(getSpriteAsset('corridor', null, 1) === null,
  'getSpriteAsset(corridor, null, 1) は null');
assert(getSpriteAsset('door', 'closed', 0) === null,
  'getSpriteAsset(door, closed, 0) は null');
assert(getSpriteAsset('door', 'open', 0) === null,
  'getSpriteAsset(door, open, 0) は null');
assert(getSpriteAsset('door', 'locked', 0) === null,
  'getSpriteAsset(door, locked, 0) は null');
assert(getSpriteAsset('stairs', 'up', 0) === null,
  'getSpriteAsset(stairs, up, 0) は null');
assert(getSpriteAsset('stairs', 'down', 0) === null,
  'getSpriteAsset(stairs, down, 0) は null');
assert(getSpriteAsset('nonexistent_kind', null, 0) === null,
  'getSpriteAsset で未知 kind は null(SPRITE_MANIFEST 未登録)');
assert(getSpriteAsset('room', null, 99) === null,
  'getSpriteAsset で範囲外 variant は modulo されて参照(99 % 4 = 3 → null)');
console.log();

// Test C: getAssetStats と preloadAllSprites の戻り値構造一致
console.log('--- C. getAssetStats vs preloadAllSprites 用語統一 ---');
const stats = getAssetStats();
assert(typeof stats.total === 'number', 'getAssetStats に total フィールド');
assert(typeof stats.ok === 'number', 'getAssetStats に ok フィールド({total, ok} 構造)');
assert(stats.total === 21, `getAssetStats.total === 21(got ${stats.total})`);
assert(stats.ok === 0, `getAssetStats.ok === 0 全 404 後(got ${stats.ok})`);
assert(!('loaded' in stats),
  'getAssetStats に loaded フィールドが残っていない(用語統一)');
console.log();

// ----- Summary -----

console.log('=== Summary ===');
if (failures === 0) {
  console.log('All v1-0b.1 PNG infra tests PASSED');
  process.exit(0);
} else {
  console.log(`${failures} test(s) FAILED`);
  process.exit(1);
}
