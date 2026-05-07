# Sprite Assets

このディレクトリに PNG スプライトを配置すると、`asset-loader.js` のプリロードで
自動的に読み込まれ、主画面の描画が programmatic から PNG に切り替わる。

## PNG 仕様

- **サイズ**: 512 × 443 px(頂点間 × 辺間、size=256、flat-top hex)
  - v1-0b.1.6(フェーズ 58)で 256 × 222 から 2 倍に拡大
  - iOS Pro 高解像度(DPR=3)でも物理ピクセルとほぼ 1:1
  - PC(DPR=1)では大幅に縮小されるが、bilinear interpolation で綺麗に表示される
  - 比率は `2 : √3`(= 512 : 443.4)を維持。round して 443 px で統一
- **形状**: flat-top hexagon、頂点が上下、辺が左右、edge 0 = N(上)
- **背景**: hex 外側は完全に **透明**(`alpha = 0`)
  - hex の外接矩形(512×443)に PNG キャンバスを取り、内側の hex 形だけ不透明、外側は透明
  - これにより下地の canvas 背景色や、shadow / blur が自然に透ける
- **影は焼き込まない**: `render.js` の shadow pass が別途付与する
- **正射投影上面視**: 床は上から見下ろした構図、壁・ドアも上面視で z=+h

## 命名規則(v1-0b.1.9 / フェーズ 61)

全 kind に **family prefix** を付ける形式に統一。family は **rooms / tunnel / cavern**
の 3 系統。各 family が独自の絵柄セットを持つ。door は lock 機構ありなしで kind 自体を分離
(`rooms_door` / `rooms_door_lock`)。

### rooms family(古典 NetHack 部屋 + 通路、合計 23 枚)

| kind | ファイル名 | 数 | 説明 |
|---|---|---|---|
| rooms_floor | `rooms_floor_0.png` 〜 `rooms_floor_3.png` | 4 | 部屋の床 |
| rooms_wall | `rooms_wall_0.png` 〜 `rooms_wall_3.png` | 4 | 部屋の壁 |
| rooms_corridor | `rooms_corridor_0.png` 〜 `rooms_corridor_3.png` | 4 | 通路 |
| rooms_threshold | `rooms_threshold_0.png` 〜 `rooms_threshold_3.png` | 4 | 部屋の出入口 |
| rooms_door | `rooms_door_closed.png`, `rooms_door_open.png` | 2 | lock 機構なしのドア(誰でも開閉可) |
| rooms_door_lock | `rooms_door_lock_locked.png`, `rooms_door_lock_closed.png`, `rooms_door_lock_open.png` | 3 | lock 機構付きドア(鍵保持者のみ操作可) |
| rooms_stairs | `rooms_stairs_up.png`, `rooms_stairs_down.png` | 2 | 階段 |

### tunnel family(蛇行通路型洞窟、合計 10 枚)

洞窟そのものが通路なので corridor / threshold / door は持たない。

| kind | ファイル名 | 数 | 説明 |
|---|---|---|---|
| tunnel_floor | `tunnel_floor_0.png` 〜 `tunnel_floor_3.png` | 4 | 蛇行通路の床 |
| tunnel_wall | `tunnel_wall_0.png` 〜 `tunnel_wall_3.png` | 4 | 蛇行通路の壁(掘削岩) |
| tunnel_stairs | `tunnel_stairs_up.png`, `tunnel_stairs_down.png` | 2 | 階段 |

### cavern family(自然洞窟、合計 10 枚)

cavern も洞窟そのものが通路なので corridor / threshold / door は持たない。

| kind | ファイル名 | 数 | 説明 |
|---|---|---|---|
| cavern_floor | `cavern_floor_0.png` 〜 `cavern_floor_3.png` | 4 | 自然洞窟の床 |
| cavern_wall | `cavern_wall_0.png` 〜 `cavern_wall_3.png` | 4 | 自然洞窟の壁(風化岩) |
| cavern_stairs | `cavern_stairs_up.png`, `cavern_stairs_down.png` | 2 | 階段 |

### generic fallback(任意、PNG 投入は通常不要)

| kind | ファイル名 | 数 | 説明 |
|---|---|---|---|
| floor | `floor_0.png` 〜 | 0〜4 | family 不明時の generic 床(通常は programmatic で十分) |
| wall | `wall_0.png` 〜 | 0〜4 | family 不明時の generic 壁(同上) |

### 共通

| kind | 説明 |
|---|---|
| void | PNG 不要(programmatic、世界外側) |

**v1-0b.2 期間中の投入対象: 40 枚**(rooms 20 + tunnel 10 + cavern 10)。`rooms_door_lock` の 3 枚は鍵 item 実装後の v1 で追加するため、現時点では作成不要。

**将来最大: 43 枚**(door_lock 復活時)。generic floor / wall を別途用意する場合は最大 51 枚(通常運用では programmatic で十分なので作成不要)。

## 段階的投入(動的 variant 検出)

v1-0b.1.7(フェーズ 59)で **動的 variant 検出** に変更。各 variant ベース kind は
`{kind}_0.png` から連番でロード試行し、最初に 404 になった番号で打ち切る。

つまり:
- `rooms_floor_0.png` だけ配置 → variantCount = 1 で動作(modulo で全 hash が 0 番に集約)
- `rooms_floor_0.png` と `rooms_floor_1.png` を配置 → variantCount = 2 で動作
- 4 枚揃えれば 4 variant フル稼働
- 1 枚も無い kind → programmatic フォールバックに完全に委ねる

`asset-loader.js` の `SPRITE_MANIFEST` を手動で書き換える必要は無い。
**ファイル数だけで variant 数が決まる**。

state ベース kind(door / door_lock / stairs)は state リスト固定:
- `rooms_door` の `closed` / `open` のいずれかが欠けていても他 state は使える
- `rooms_door_lock` の `locked` / `closed` / `open` も同様
- `{family}_stairs` の `up` / `down` も同様

## 投入順序の例

例えば全 family で「まず 1 variant ずつ投入して全体感を確認」したい場合:

1. floor / wall の 1 variant ずつ:`rooms_floor_0.png`、`rooms_wall_0.png`、
   `tunnel_floor_0.png`、`tunnel_wall_0.png`、`cavern_floor_0.png`、`cavern_wall_0.png`(6 枚)
2. rooms 専用構造体:`rooms_corridor_0.png`、`rooms_threshold_0.png`(2 枚)
3. ドア:`rooms_door_closed.png`(1 枚、open 後でも可)
4. 階段:`rooms_stairs_down.png`、`tunnel_stairs_down.png`、`cavern_stairs_down.png`(3 枚)
5. ブラウザでリロード → 12 枚で全体感が確認できる
6. 各 kind の variant を増やしたい場合 `_1.png`、`_2.png`、`_3.png` を順次追加
7. 各追加時にブラウザリロードで反映、コード変更不要

## kind 別ガイド

### rooms_floor / rooms_wall
古典 NetHack 部屋の内部。整然とした石畳・タイル張り、煉瓦・切石の壁。
明るめ・落ち着いた色味。直線的なエッジ、規則的な目地。

### rooms_corridor
通路の床。rooms family の部屋同士をつなぐ。
floor よりやや暗く、線的な質感(石畳の長手方向など)。

### rooms_threshold
部屋の出入り口。floor と corridor の中間色味、または独自のアクセント。
ドアが置かれる場合の足元。

### rooms_door(lock 機構なし)
木製などの普通のドア。鍵穴は無い。誰でも開け閉めできる。
- closed: 木目・取っ手
- open: ドアが開いた状態(枠だけ見える、または平らな床)

### rooms_door_lock(lock 機構付き)
鍵穴付きの頑丈なドア。鍵を持つ者だけが locked と closed を切り替えられる。
v1-0b.1.9 時点では生成されない(鍵 item 未実装、v1 で復活予定)。
- locked: 鍵穴アイコン + 閉じた状態(普通の closed と区別できる視覚)
- closed: 鍵穴付きで閉じた状態(鍵を持っているなら開けられる)
- open: 鍵穴付きで開いた状態

### rooms_stairs
古典部屋の階段。`enterHeading` 方向が PNG 上の N に一致するよう描く。
- up: 上り階段(段が手前から奥に上がる構図、矢印 ↑)
- down: 下り階段(段が手前から奥に下がる構図、矢印 ↓)

### tunnel_floor / tunnel_wall
蛇行通路型洞窟(ランダムウォーク掘削で生成される)。
床は土や濡れた石、壁は掘削されたノミ跡が残る人工的な掘削感。

### tunnel_stairs
洞窟内の階段。岩を削った階段、または木組み。

### cavern_floor / cavern_wall
自然洞窟(セルラーオートマタで生成される)。
床は鍾乳洞のような滑らかさ、湿った岩肌、苔。
壁は風化した岩肌、苔・水滴・節理。

### cavern_stairs
自然洞窟の階段。岩の段、または鍾乳石を削ったような有機的形状。

## PNG 基準方向と回転規約

**全 PNG の基準方向は「画面上向き」(N、HEADING_ANGLES_DEG = -90°)に固定**。
言い換えると、PNG を素のまま(rotation=0)で描画したとき、PNG の上端が画面の上に来る向きで作る。

`render.js` 側の回転式は次の通り(CHANGELOG フェーズ 52 で訂正版):

```
tileRotDeg = HEADING_ANGLES_DEG[enterHeading] + 90
```

つまり、PNG 基準方向(-90°)を enterHeading 方向(`HEADING_ANGLES_DEG[h]`)に向ける差分が回転角。
canvas の `ctx.rotate(rad)` は時計回り正なので、+60° は CW 60° = ↑ → NE。

| enterHeading | 回転角 | 視覚上の方向(↑ が向く先) |
|---|---|---|
| 0 (N)  |    0° | ↑ |
| 1 (NE) |  +60° | ↗ |
| 2 (SE) | +120° | ↘ |
| 3 (S)  | +180° | ↓ |
| 4 (SW) | +240° | ↙ |
| 5 (NW) |  -60° | ↖ |

stairs PNG 制作時は、**PNG 自体に「進入方向 = 上」を表現**してください
(階段の段が下から上に上がる構図、矢印 ↑、など)。
`getTileRotation` が enterHeading 方向に物理的に回転させるため、
PNG 内に方向矢印を直接描いて問題ありません。

## 将来の family 候補

現状は地下系 3 family のみ実装。将来追加候補(命名規約参考):

| family | 内容 |
|---|---|
| `vault` | 神殿・遺跡型(対称配置 + 装飾、トラップ多め) |
| `maze` | 迷宮型(一筆書き) |
| `mines` | 採掘場(鉱脈 + 縦坑) |
| `catacomb` | 地下墓所(細長い通路 + 多数の小室) |
| `sewer` | 下水道(直交格子 + 水路) |
| `temple` | 神殿(規則的部屋 + 装飾) |
| `open_forest` | 屋外・森林 |
| `open_swamp` | 屋外・沼地 |

命名規約:
- 地下系は無 prefix(`vault`、`maze` 等)
- 屋外系は `open_` prefix(将来導入)
- サブバリエーションは別 family として独立(例: `rooms_v2` ではなく `vault` のような別名で)
- 各 family の構成 kind は generator 次第(door / corridor を持つかは各 family が決める)
