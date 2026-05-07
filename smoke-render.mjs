// smoke-render.mjs — v1-0b.1 PNG スプライトインフラ層の自己検証。
// 実行: `node smoke-render.mjs`
//
// 目的:
//   - PNG が 1 枚も配置されていない状態で preloadAllSprites() が reject せず resolve(A,B)
//   - getSpriteAsset() が欠損時に null を返すこと(B)
//   - getAssetStats() の戻り値構造が preloadAllSprites の戻り値と一致(C)
//   - 一部の PNG が成功した状態で preloadAllSprites() の ok カウントと
//     getSpriteAsset() の非 null 返却が連動すること(D、フェーズ 53.5 で追加)
//   - v1-0b.1.7(フェーズ 59): variant 数の動的検出(連番途切れまでロード)
//
// browser API(Image)を Node 上で stub する。stub の挙動はモジュールレベルの
// `imageMode` 変数で切り替え可能。
//   'all-fail'         : 全リクエストを 404 相当(onerror)で resolve
//   'rooms-only-2var'  : URL に '/rooms_floor_0' or '/rooms_floor_1' を含むものだけ onload(動的検出のテスト)
//
// 主画面の実描画は canvas 2D context が必要なため本テストでは検証しない。

// ----- Image stub -----

let imageMode = 'all-fail';

class StubImage {
  constructor() {
    this.onload = null;
    this.onerror = null;
  }
  set src(url) {
    queueMicrotask(() => {
      let success = false;
      if (typeof url === 'string') {
        if (imageMode === 'rooms-only-2var') {
          // rooms_floor_0.png と rooms_floor_1.png のみ成功(動的検出で variantCount=2 になることを確認)
          success = /\/rooms_floor_0\.png$/.test(url) || /\/rooms_floor_1\.png$/.test(url);
        }
      }
      if (success) {
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
  assert(preloadResult.ok === 0,
    `全 404 状態で ok 数は 0(got ${preloadResult.ok})`);
  // 動的検出方式(v1-0b.1.9 / フェーズ 61): variant ベース 10 種(rooms_floor/wall/corridor/threshold +
  // tunnel_floor/wall + cavern_floor/wall + 共通 floor/wall fallback)それぞれ 1 回 404 = 10 回。
  // state ベースは rooms_door (2) + rooms_door_lock (3) + rooms_stairs (2) + tunnel_stairs (2) +
  // cavern_stairs (2) = 11 file probes。合計 21 回の試行(全部 404)。
  assert(preloadResult.total === 21,
    `動的検出: 全 kind が 1 枚も無いとき total は variant 10 + state 11 = 21(got ${preloadResult.total})`);
  // byKind が Map で返ること
  assert(preloadResult.byKind instanceof Map,
    `戻り値に byKind: Map が存在(debug 用)`);
}
console.log();

// Test B: getSpriteAsset は欠損時に null を返す
console.log('--- B. getSpriteAsset null behavior (all-fail mode) ---');
assert(getSpriteAsset('rooms_floor', null, 0) === null,
  'getSpriteAsset(rooms_floor, null, 0) は null(404 後、loadedVariantCounts[rooms_floor] = 0)');
assert(getSpriteAsset('corridor', null, 1) === null,
  'getSpriteAsset(corridor, null, 1) は null');
assert(getSpriteAsset('rooms_door', 'closed', 0) === null,
  'getSpriteAsset(rooms_door, closed, 0) は null');
assert(getSpriteAsset('rooms_door', 'open', 0) === null,
  'getSpriteAsset(rooms_door, open, 0) は null');
assert(getSpriteAsset('rooms_door_lock', 'locked', 0) === null,
  'getSpriteAsset(rooms_door_lock, locked, 0) は null');
assert(getSpriteAsset('rooms_stairs', 'up', 0) === null,
  'getSpriteAsset(rooms_stairs, up, 0) は null');
assert(getSpriteAsset('rooms_stairs', 'down', 0) === null,
  'getSpriteAsset(rooms_stairs, down, 0) は null');
assert(getSpriteAsset('nonexistent_kind', null, 0) === null,
  'getSpriteAsset で未知 kind は null(SPRITE_MANIFEST 未登録)');
assert(getSpriteAsset('rooms_floor', null, 99) === null,
  'getSpriteAsset で範囲外 variant は loaded=0 なので null');
console.log();

// Test C: getAssetStats と preloadAllSprites の戻り値構造一致
console.log('--- C. getAssetStats vs preloadAllSprites 用語統一 ---');
const stats = getAssetStats();
assert(typeof stats.total === 'number', 'getAssetStats に total フィールド');
assert(typeof stats.ok === 'number', 'getAssetStats に ok フィールド({total, ok} 構造)');
// v1-0b.1.7 から getAssetStats は「キャッシュに登録された成功エントリ数」を返す(全 404 時は 0)
assert(stats.total === 0, `getAssetStats.total === 0(全 404、got ${stats.total})`);
assert(stats.ok === 0, `getAssetStats.ok === 0 全 404 後(got ${stats.ok})`);
console.log();

// Test D: PNG 一部成功経路 + 動的 variant 検出(フェーズ 53.5 追加、フェーズ 59 で動的化対応)
// stub を 'rooms-only-2var' にして rooms_floor_0.png と rooms_floor_1.png だけ成功させる。
// 動的検出が「連番 0,1 まで成功 → 2 で 404 → variantCount=2 で打ち切り」を検証。
console.log('--- D. PNG 部分成功経路 + 動的 variant 検出(rooms-only-2var mode) ---');
imageMode = 'rooms-only-2var';
const partialResult = await preloadAllSprites();

// 成功数:room_0, room_1 の 2 枚のみ
assert(partialResult.ok === 2,
  `rooms_floor の 2 variant のみ成功 → ok === 2(got ${partialResult.ok})`);

// byKind で room=2 が確認できる
assert(partialResult.byKind.get('rooms_floor') === 2,
  `byKind.get('rooms_floor') === 2(動的検出で 2 variant 確定、got ${partialResult.byKind.get('rooms_floor')})`);
// 他の variant ベース kind は 0
assert(partialResult.byKind.get('rooms_wall') === 0,
  `byKind.get('rooms_wall') === 0(全 404)`);
assert(partialResult.byKind.get('rooms_corridor') === 0,
  `byKind.get('rooms_corridor') === 0(全 404)`);

// room の variant 0, 1 は非 null
assert(getSpriteAsset('rooms_floor', null, 0) !== null,
  'getSpriteAsset(rooms_floor, null, 0) は非 null');
assert(getSpriteAsset('rooms_floor', null, 1) !== null,
  'getSpriteAsset(rooms_floor, null, 1) は非 null');

// modulo 確認: variant 99 → 99 % 2 = 1 → 非 null(room_1 を引く)
assert(getSpriteAsset('rooms_floor', null, 99) !== null,
  'getSpriteAsset(rooms_floor, null, 99) は modulo(99 % 2 = 1)で variant 1 を引いて非 null');
// modulo 確認: variant 4 → 4 % 2 = 0 → 非 null(room_0 を引く)
assert(getSpriteAsset('rooms_floor', null, 4) !== null,
  'getSpriteAsset(rooms_floor, null, 4) は modulo(4 % 2 = 0)で variant 0 を引いて非 null');

// room 以外は引き続き null
assert(getSpriteAsset('corridor', null, 0) === null,
  'getSpriteAsset(corridor, null, 0) は null(loaded=0)');
assert(getSpriteAsset('wall', null, 0) === null,
  'getSpriteAsset(wall, null, 0) は null');
assert(getSpriteAsset('rooms_door', 'closed', 0) === null,
  'getSpriteAsset(rooms_door, closed, 0) は null');
assert(getSpriteAsset('rooms_stairs', 'up', 0) === null,
  'getSpriteAsset(rooms_stairs, up, 0) は null');

// 戻り値が後続の drawImage 経路に渡せる object であること
const roomAsset = getSpriteAsset('rooms_floor', null, 0);
assert(typeof roomAsset === 'object' && roomAsset !== null,
  'roomAsset は object(SPRITE_DRAWERS_PNG の drawSpriteImage で ctx.drawImage に渡せる前提)');

// getAssetStats も同じ部分成功状態を反映する
const stats2 = getAssetStats();
assert(stats2.total === 2, `getAssetStats.total === 2(成功分のみ、got ${stats2.total})`);
assert(stats2.ok === 2, `getAssetStats.ok === 2(got ${stats2.ok})`);
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
