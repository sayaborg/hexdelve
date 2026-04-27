// smoke-render.mjs — v1-0b.1 PNG スプライトインフラ層の自己検証。
// 実行: `node smoke-render.mjs`
//
// 目的:
//   - SPRITE_MANIFEST が 21 アセット相当を網羅していることを確認(A)
//   - PNG が 1 枚も配置されていない状態で preloadAllSprites() が reject せず resolve(A,B)
//   - getSpriteAsset() が欠損時に null を返すこと(B)
//   - getAssetStats() の戻り値構造が preloadAllSprites の戻り値と一致(C)
//   - 一部の PNG が成功した状態で preloadAllSprites() の ok カウントと
//     getSpriteAsset() の非 null 返却が連動すること(D、フェーズ 53.5 で追加)
//
// browser API(Image)を Node 上で stub する。stub の挙動はモジュールレベルの
// `imageMode` 変数で切り替え可能。
//   'all-fail'    : 全リクエストを 404 相当(onerror)で resolve させる
//   'rooms-only'  : URL に 'room_' を含むものだけ onload、他は onerror
//
// 主画面の実描画は canvas 2D context が必要なため本テストでは検証しない
// (SPRITE_DRAWERS_PNG / drawSpriteImage は internal だが、その前段の
// asset-loader 出力を検証することで「drawImage 経路に入る前提」までは保証する)。

// ----- Image stub -----

let imageMode = 'all-fail';

class StubImage {
  constructor() {
    this.onload = null;
    this.onerror = null;
  }
  set src(url) {
    queueMicrotask(() => {
      const success =
        imageMode === 'rooms-only' && typeof url === 'string' && /\/room_/.test(url);
      if (success) {
        // onload ハンドラには「画像っぽい」オブジェクトとして this を渡す。
        // asset-loader の loadImage は img オブジェクトをそのまま cache に入れるため、
        // truthy であれば後段の getSpriteAsset() が非 null を返す。
        if (this.onload) this.onload();
      } else {
        if (this.onerror) this.onerror();
      }
    });
  }
}

globalThis.Image = StubImage;

// ----- assertion ヘルパ(動的カウント) -----

let assertionsRun = 0;
let failures = 0;
function assert(cond, msg) {
  assertionsRun += 1;
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
console.log('--- A. preloadAllSprites with no assets (all-fail mode) ---');
imageMode = 'all-fail';
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
console.log('--- B. getSpriteAsset null behavior (all-fail mode) ---');
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

// Test D: PNG 一部成功経路(フェーズ 53.5 で追加)
// stub の挙動を URL 判定型に切り替え、room の 4 variant だけ onload、他は onerror。
// 同じ assetCache を再書き込み(preloadAllSprites は毎回全 manifest を set し直す実装)。
console.log('--- D. PNG 部分成功経路(rooms-only mode) ---');
imageMode = 'rooms-only';
const partialResult = await preloadAllSprites();
assert(partialResult.total === 21, `total === 21 維持(got ${partialResult.total})`);
assert(partialResult.ok === 4,
  `room の 4 variant のみ成功 → ok === 4(got ${partialResult.ok})`);

// room は全 variant が非 null になる
assert(getSpriteAsset('room', null, 0) !== null,
  'getSpriteAsset(room, null, 0) は非 null(rooms-only 成功)');
assert(getSpriteAsset('room', null, 1) !== null,
  'getSpriteAsset(room, null, 1) は非 null');
assert(getSpriteAsset('room', null, 2) !== null,
  'getSpriteAsset(room, null, 2) は非 null');
assert(getSpriteAsset('room', null, 3) !== null,
  'getSpriteAsset(room, null, 3) は非 null');

// modulo 確認: variant 99 → 99 % 4 = 3 → 非 null
assert(getSpriteAsset('room', null, 99) !== null,
  'getSpriteAsset(room, null, 99) は modulo で variant 3 を引いて非 null');

// room 以外は引き続き null(他の kind の URL は room_ を含まないため)
assert(getSpriteAsset('corridor', null, 0) === null,
  'getSpriteAsset(corridor, null, 0) は null(rooms-only モードで room 以外は失敗)');
assert(getSpriteAsset('wall', null, 0) === null,
  'getSpriteAsset(wall, null, 0) は null');
assert(getSpriteAsset('door', 'closed', 0) === null,
  'getSpriteAsset(door, closed, 0) は null');
assert(getSpriteAsset('stairs', 'up', 0) === null,
  'getSpriteAsset(stairs, up, 0) は null');

// 戻り値が後続の drawImage 経路に渡せる object であること(non-null かつ truthy)
const roomAsset = getSpriteAsset('room', null, 0);
assert(typeof roomAsset === 'object' && roomAsset !== null,
  'roomAsset は object(SPRITE_DRAWERS_PNG の drawSpriteImage で ctx.drawImage に渡せる前提)');

// getAssetStats も同じ部分成功状態を反映する
const stats2 = getAssetStats();
assert(stats2.total === 21, `getAssetStats.total === 21(got ${stats2.total})`);
assert(stats2.ok === 4, `getAssetStats.ok === 4 部分成功後(got ${stats2.ok})`);
console.log();

// ----- Summary -----

console.log('=== Summary ===');
console.log(`Assertions: ${assertionsRun}, Failures: ${failures}`);
if (failures === 0) {
  console.log('All v1-0b.1 PNG infra tests PASSED');
  process.exit(0);
} else {
  console.log(`${failures} test(s) FAILED`);
  process.exit(1);
}
