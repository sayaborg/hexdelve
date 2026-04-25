# v1-0b.1 完全パッケージ

PNG スプライトインフラ層実装。**ソース一式を含む drop-in 置き換え可能なパッケージ**。

## 適用方法

このディレクトリの内容を repo のルート直下に配置すれば、そのままブラウザで `index.html` を開いて動作する(static file serve のみで OK、ビルド不要)。

`assets/sprites/` 内に PNG が無いため programmatic フォールバックで描画されるが、機能リグレッションなしで v1-0a 同等の見た目を維持する。**加えて壁から床への drop shadow が描画され、立体感が増す**。アセット投入は v1-0b.2 で実施。

ドキュメント側(CHANGELOG.md / STATUS.md / NEXT_STEPS.md)の更新分は `docs/snippets/` 内のスニペットを既存ドキュメントに手動マージすること。

## ファイル構成

### ソースコード(ルート直下)

#### v1-0b.1 で改修したファイル(2)
- `render.js` — drawer 2 系統に分離、shadow pass(hex 投影、角度・長さ可変)、mode filter 追加
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

- `render.js.diff` — unified diff(v1-0a → v1-0b.1)
- `game.js.diff` — unified diff

### ドキュメント追記スニペット(`docs/snippets/`、手動マージ用)

- `CHANGELOG_phase49_snippet.md` — フェーズ 49 の完全記述
- `STATUS_snippet.md` — 進行状況・次の作業
- `NEXT_STEPS_snippet.md` — v1-0b.2 / v1-0b.3 の計画

## 動作確認(本パッケージ作成時に実施済)

- 全 15 JS ファイル `node --check` で syntax OK
- 全 import-export 整合性チェック OK
- shadow projection の幾何検証済(angle=0°/length=0.25 で N(2)+NE(1)+NW(1) corner overlap = 3 タイル跨ぎ)

## Shadow パラメータ(render.js 内 SHADOW_CONFIG)

```js
const SHADOW_CONFIG = {
  angleDeg: 0,        // N=0、E=90、S=180、W=270(時計回り)
  lengthRatio: 0.25,  // タイル直径 (= 2 × tileRadius) を 1 とする
  alpha: 0.32,
};
```

物理モデル: **z=+h ブロック(hex)はそれ自身と同じ hex 形状の影を、SHADOW_CONFIG の方向と長さで平行移動した位置に落とす**。各 recipient タイルでは自身の hex で clip した shifted hex の断片が見える。
- angle が hex heading(0°/60°/120°/180°/240°/300°)に一致 → 3 タイル跨ぎ
- それ以外の angle → 2 タイル跨ぎ

## 主な設計判断(v1-0b.1)

| # | 項目 | 判断 |
|---|------|------|
| ① | アセット方針 | C(AI 生成 + repo commit) |
| ② | 解像度 | 128 × 111 px、size=64、flat-top hex、主画面のみ PNG |
| ③ | 影方向 | パラメータ化(angle / length)、デフォルト N=0°、長さ 0.25 |
| ④ | 影形状 | hex 投影(source hex を平行移動)、recipient hex で clip |
| ⑤ | mode 表現 | visible のみ PNG、near/known は `ctx.filter` |
| ⑥ | z=+h 判定 | `canStandAtHere=false` / `closed`・`locked` ドア / **runtime 上に存在しない void タイル**(rooms_classic で構造化セル外を wall として扱うため) |

## 次の作業

- **v1-0b.2**: AI 生成スプライト 21 枚を `assets/sprites/` に配置、kind 順に投入
- **v1-0b.3**: shadow `angleDeg` / `lengthRatio` / `alpha` の実機チューニング、`ctx.filter` 数値チューニング、HiDPI 検証、必要なら offscreen canvas キャッシュ実装
