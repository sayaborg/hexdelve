// v1-0b.1(NEXT_STEPS §2.1、CHANGELOG フェーズ 51):
// PNG スプライトのプリロードとキャッシュを担当。
//
// 設計原則:
//   - PNG が無くても動く(programmatic フォールバックを render 側に保持)
//   - 段階的投入を許容(kind ごとに揃わなくても OK、足りない asset は null を返す)
//   - 主画面のみが消費(副画面は完全 programmatic、本モジュールを参照しない)
//   - サイズは 512×443 px(頂点間 × 辺間、size=256、flat-top hex)。
//     v1-0b.1.6(フェーズ 58)で 256×222 から 2 倍に拡大。
//     iOS Pro 高解像度(DPR=3)でも物理ピクセルとほぼ 1:1、PC(DPR=1)では大幅縮小。
//     drawImage は dw = tileRadius * 2、dh = tileRadius * √3 の比率で行うため、
//     PNG 解像度の変更にコード変更は不要(比率ベース描画)。
//   - hex 外側は透明(下地の canvas 背景色を透かす)。
//
// アセット配置: assets/sprites/ ディレクトリ
//   命名規則:
//     {kind}_{variant}.png       (variant = 0, 1, 2, ...、連番)
//     {kind}_{state}.png         (state は kind ごとに異なる)
//   例:
//     rooms_floor_0.png 〜 rooms_floor_3.png(variant ベース)
//     rooms_door_closed.png / rooms_door_open.png(door は 2 state)
//     rooms_door_lock_locked.png / rooms_door_lock_closed.png / rooms_door_lock_open.png(door_lock は 3 state)
//     rooms_stairs_up.png / rooms_stairs_down.png(stairs は 2 state、family ごとに別 PNG)
//
// v1-0b.1.7(フェーズ 59): variant 数を **動的検出** 方式に変更。
//   variant ベース kind は SPRITE_MANIFEST に枚数を書かず、{kind}_0.png から連番で
//   ロード試行し、最初に 404 になった番号で打ち切り。実投入数 = ロード成功した枚数。
//   これにより:
//     - 1 枚も無ければ 0 件として扱い、programmatic フォールバックに完全に委ねる
//     - 2 枚あれば 2 variant として動作、3 枚なら 3 variant
//     - PNG 配置時に SPRITE_MANIFEST の数値を手で更新する作業が不要
//   状態ベース kind(door / stairs)は固定 state リスト、従来通り。

// 安全装置:variant 連番の探索打ち切り上限。
const MAX_PROBE_VARIANTS = 16;

// kind 体系(v1-0b.1.9 / フェーズ 61 で全 kind に family prefix + door 分離):
//
// rooms family(古典 NetHack 部屋 + 通路、door / corridor / threshold を持つ):
//   - rooms_floor / rooms_wall: 部屋内床 / 壁
//   - rooms_corridor / rooms_threshold: 通路 / 出入口
//   - rooms_door: lock 機構なしのドア(closed / open、誰でも操作可)
//   - rooms_door_lock: lock 機構付きドア(locked / closed / open、鍵保持者のみ操作可)
//     ※ v1-0b.1.9 時点では生成されない(鍵 item 未実装、v1 で復活予定)
//   - rooms_stairs: 階段(up / down)
//
// tunnel family(蛇行通路型洞窟、洞窟そのものが通路なので corridor / threshold / door を持たない):
//   - tunnel_floor / tunnel_wall
//   - tunnel_stairs
//
// cavern family(自然洞窟、同様):
//   - cavern_floor / cavern_wall
//   - cavern_stairs
//
// 共通 fallback:
//   - floor / wall: family 不明時の generic fallback(動的検出のみ、通常は 0 件)
//   - void: PNG 不要(programmatic のみ)
//
// SPRITE_MANIFEST 形式:
//   - variantBased: true → 連番プローブ式、ファイル数から動的に variantCount 確定
//   - states: [...] → 固定 state リスト、ファイル数固定
const SPRITE_MANIFEST = {
  // rooms family
  rooms_floor:        { variantBased: true },
  rooms_wall:         { variantBased: true },
  rooms_corridor:     { variantBased: true },
  rooms_threshold:    { variantBased: true },
  rooms_door:         { states: ['closed', 'open'] },
  rooms_door_lock:    { states: ['locked', 'closed', 'open'] },
  rooms_stairs:       { states: ['up', 'down'] },
  // tunnel family
  tunnel_floor:       { variantBased: true },
  tunnel_wall:        { variantBased: true },
  tunnel_stairs:      { states: ['up', 'down'] },
  // cavern family
  cavern_floor:       { variantBased: true },
  cavern_wall:        { variantBased: true },
  cavern_stairs:      { states: ['up', 'down'] },
  // generic fallback(動的検出、family 不明時に使う想定。通常は 0 件)
  floor:              { variantBased: true },
  wall:               { variantBased: true },
};

const ASSET_BASE_PATH = './assets/sprites/';

// asset cache: key → HTMLImageElement(成功した分のみ保持)
// キーは spriteAssetKey で生成。404 だったエントリは登録しない(getSpriteAsset で null を返す)。
const assetCache = new Map();

// kind ごとの実ロード variant 数(動的検出結果)。
// 0 = 1 枚も無し → programmatic フォールバック。
// >0 = ロード成功枚数(連番 0..n-1)、modulo マッピングで使う。
const loadedVariantCounts = new Map();

function spriteAssetKey(kind, state, variant) {
  return `${kind}:${state ?? '-'}:${variant ?? 0}`;
}

function variantFileName(kind, variant) {
  return `${kind}_${variant}.png`;
}

function stateFileName(kind, state) {
  return `${kind}_${state}.png`;
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

// kind の variant 連番を 0 から順にロード試行する。最初に失敗した番号で打ち切り、
// 成功した枚数を返す。安全装置として MAX_PROBE_VARIANTS で上限を切る。
//
// 連番が途切れたかの判定は「失敗が出た時点で停止」。例:
//   room_0.png: ok, room_1.png: ok, room_2.png: 404 → variantCount = 2
// (room_2 がなくて room_3 だけある、というケースは検出しない。連番運用前提。)
async function probeVariantSequence(kind) {
  let count = 0;
  for (let variant = 0; variant < MAX_PROBE_VARIANTS; variant += 1) {
    const url = ASSET_BASE_PATH + variantFileName(kind, variant);
    const img = await loadImage(url);
    if (img === null) break;  // 連番途切れ → 打ち切り
    assetCache.set(spriteAssetKey(kind, null, variant), img);
    count += 1;
  }
  return count;
}

// 状態ベース kind の固定 state リストをロード。各 state ごとに 1 枚。
// 失敗は許容(個別の state が欠けても他の state は使える)。
async function loadStateAssets(kind, states) {
  const tasks = states.map(async (state) => {
    const url = ASSET_BASE_PATH + stateFileName(kind, state);
    const img = await loadImage(url);
    if (img !== null) {
      assetCache.set(spriteAssetKey(kind, state, 0), img);
    }
    return img !== null;
  });
  const results = await Promise.all(tasks);
  return results.filter(Boolean).length;
}

// 全アセットをプリロード。動的検出のため total / done の概念は単純な「ロード試行数」ではない:
//   variant ベース kind は MAX_PROBE_VARIANTS まで試行する可能性があるため、
//   total は「実際に成功 + 1 回の打ち切り 404」の合計の上界。
//   onProgress は粒度の参考値として呼ぶが、進捗バーには向かない。
//
// 戻り値:
//   - total: 試行された fetch 回数(成功 + 打ち切り 404 を含む)
//   - ok: 成功してキャッシュに入った枚数
//   - byKind: kind ごとの成功枚数(variant 数 / state 数)を Map で返す(debug 用)
export async function preloadAllSprites(onProgress = null) {
  loadedVariantCounts.clear();

  // kind ごとに並列で probe / load を走らせる
  const tasks = [];
  for (const [kind, def] of Object.entries(SPRITE_MANIFEST)) {
    if (def.variantBased) {
      tasks.push(
        probeVariantSequence(kind).then((count) => {
          loadedVariantCounts.set(kind, count);
          // 試行回数 = 成功数 + 打ち切り 404(MAX 到達時は 404 なし)
          const probed = count + (count < MAX_PROBE_VARIANTS ? 1 : 0);
          return { kind, ok: count, probed };
        }),
      );
    } else if (def.states) {
      tasks.push(
        loadStateAssets(kind, def.states).then((okCount) => {
          loadedVariantCounts.set(kind, okCount);  // state ベースも便宜的に記録
          return { kind, ok: okCount, probed: def.states.length };
        }),
      );
    }
  }

  const results = await Promise.all(tasks);
  const total = results.reduce((sum, r) => sum + r.probed, 0);
  const ok = results.reduce((sum, r) => sum + r.ok, 0);

  const byKind = new Map();
  for (const r of results) byKind.set(r.kind, r.ok);

  // 進捗 callback は最終結果でだけ呼ぶ(プローブ式は逐次粒度を作りにくい)
  onProgress?.(total, total, { byKind });

  return { total, ok, byKind };
}

// drawer から呼ぶ。指定 kind/state/variant の HTMLImageElement または null を返す。
//   - state ベース kind: state を見て直接 lookup(variant は無視)
//   - variant ベース kind: loadedVariantCounts[kind] が 0 なら null、>0 なら variant % count で modulo
export function getSpriteAsset(kind, state, variant) {
  const def = SPRITE_MANIFEST[kind];
  if (!def) return null;

  if (def.states) {
    return assetCache.get(spriteAssetKey(kind, state, 0)) ?? null;
  }

  // variant ベース
  const loaded = loadedVariantCounts.get(kind) ?? 0;
  if (loaded === 0) return null;  // 1 枚も無し → programmatic フォールバック
  const effectiveVariant = (variant ?? 0) % loaded;
  return assetCache.get(spriteAssetKey(kind, null, effectiveVariant)) ?? null;
}

// debug 用: キャッシュ状況の集計。preloadAllSprites の戻り値と用語を揃える({total, ok})。
//   total = キャッシュに登録されたエントリ数(全て成功分、404 は登録されない)
//   ok = total と同じ(404 を null で持たないため)
//   v1-0b.1.7 で挙動変更:旧方式は 404 も null で cache に入れていたが、
//   新方式では成功分のみ cache 登録するため total === ok となる。
export function getAssetStats() {
  const total = assetCache.size;
  return { total, ok: total };
}
