# v1-0b.1 完全パッケージ

PNG スプライトインフラ層実装。**ソース一式を含む drop-in 置き換え可能なパッケージ**。

## 適用方法

このディレクトリの内容を repo のルート直下に配置すれば、そのままブラウザで `index.html` を開いて動作する(static file serve のみで OK、ビルド不要)。

`assets/sprites/` 内に PNG が無いため programmatic フォールバックで描画されるが、機能リグレッションなしで v1-0a 同等の見た目を維持する。アセット投入は v1-0b.2 で実施。

ドキュメント側(CHANGELOG.md / STATUS.md / NEXT_STEPS.md)の更新分は `docs/snippets/` 内のスニペットを既存ドキュメントに手動マージすること。

## ファイル構成

### ソースコード(ルート直下)

#### v1-0b.1 で改修したファイル(2)
- `render.js` — drawer 2 系統に分離、shadow pass、mode filter 追加
- `game.js` — bootstrap で `preloadAllSprites()` 非同期呼び出し追加

#### v1-0b.1 で新規追加したファイル(1)
- `asset-loader.js` — `SPRITE_MANIFEST` + プリロード + cache + getter

#### v1-0a から変更なし(13)
- `config.js`, `enemy-ai.js`, `hex.js`, `input.js`, `map.js`, `map-compile.js`, `map-source.js`, `perception.js`, `rng.js`
- `map-family-cave.js`, `map-family-cave-natural.js`, `map-family-rooms-classic.js`
- `index.html`, `style.css`

### アセットディレクトリ(`assets/sprites/`)

- `README.md` — 命名規則・PNG 仕様・kind 別ガイド
- `.gitkeep` — 空ディレクトリの commit 用
- (PNG ファイルは v1-0b.2 で投入予定)

### 差分ファイル(`diffs/`、レビュー用)

- `render.js.diff` — unified diff(v1-0a → v1-0b.1)、220 行
- `game.js.diff` — unified diff、16 行

### ドキュメント追記スニペット(`docs/snippets/`、手動マージ用)

- `CHANGELOG_phase49_snippet.md` — フェーズ 49 の完全記述
- `STATUS_snippet.md` — 進行状況・次の作業
- `NEXT_STEPS_snippet.md` — v1-0b.2 / v1-0b.3 の計画

## 動作確認(本パッケージ作成時に実施済)

- 全 15 JS ファイル `node --check` で syntax OK
- 全 import-export 整合性チェック OK(asset-loader.js → render.js / game.js の新規 import 3 つすべて解決)
- shadow trapezoid 幾何検証済(面積比 0.208、4 頂点が hex 内に正確に内接)

## 主な設計判断(v1-0b.1)

| # | 項目 | 判断 |
|---|------|------|
| ① | アセット方針 | C(AI 生成 + repo commit) |
| ② | 解像度 | 128 × 111 px、size=64、flat-top hex、主画面のみ PNG |
| ③ | 影方向 | world-south 固定、PNG には焼き込まず別パス |
| ④ | mode 表現 | visible のみ PNG、near/known は `ctx.filter` |
| ⑤ | z=+h 判定 | `canStandAtHere=false` または `closed`/`locked` ドア |

## 次の作業

- **v1-0b.2**: AI 生成スプライト 21 枚を `assets/sprites/` に配置、kind 順に投入
- **v1-0b.3**: shadow alpha / 形状の最終調整、`ctx.filter` 数値チューニング、HiDPI 検証、必要なら offscreen canvas キャッシュ実装
