# Analysis Data

## 録画状態

`data/app/state.json` は録画ごとの処理状態を保持します。主なフィールドは次の通りです。

| フィールド | 内容 |
| --- | --- |
| `id` | ファイル名とサイズから作る安定ID |
| `status` | `queued`, `probing`, `splitting`, `analyzing`, `ready`, `error` |
| `phase` | 画面へ表示する日本語の処理段階 |
| `progress` | 0〜1の進捗 |
| `media` | 長さ、映像・音声コーデック、解像度、FPS |
| `matches` | 検出した試合区間と生成物URL |

## 試合解析JSON

`data/app/analysis/<recording-id>/match-NN.json` は1試合分の解析結果です。

- `source.start` / `source.end`: 元録画上の試合区間（秒）
- `media.duration`: 分割動画の長さ（秒）
- `events`: 分析候補の時刻、説明、確度、根拠
- `series[].motion`: 連続フレームの画面変化量
- `series[].hud`: HUDらしさのスコア
- `gameFlow.deaths.self`: 自分のデス開始秒と、次に生存表示を確認するまでの秒数
  - 上部HUDの本人ブキ枠と、右下の「復活まであとX秒」UIの初出時刻をデスごとに照合
  - `events[].evidence.timing` に `hudDetectedAt`、`respawnUiDetectedAt`、実測差の `respawnUiDelay` を保存
  - 上部HUDを確認できない区間では、復活UIの初出を `respawn-ui-fallback` としてデス時刻に採用
  - 復活UIは通常色・エナジースタンド色を区別して検出
- `playerIdentity`: リザルトの自分行とブキ画像をHUDへ照合した結果
  - `hudSlot`: 自軍HUDの左から何番目か（0始まり）
  - `method`: 同じ試合のリザルトを使った `result-row-weapon-match`、または直前試合から引き継いだ `carried-result-weapon-match`
  - `confidence`: リザルトのブキ形状とHUDアイコンの照合確度
- `gameFlow.playerCounts[]`: 1秒ごとの自軍・相手の生存人数と人数差
  - `teamAlive` / `enemyAlive`: 0〜4人の生存人数
  - `difference`: `teamAlive - enemyAlive`
  - `source`: その秒を直接読めた `observed`、または直近観測を最大5秒保持した `held`
  - `confidence`: HUDの観測継続性から算出した0〜1の確度
- `gameFlow.gameCounts[]`: ゲームカウントの観測時系列
  - `teamCount` / `enemyCount`: 画面上部から読んだ自軍・相手カウント
  - `source`: 直接観測した `observed`、または短時間の補間値
- `stageMap`: 映像内で実際に開かれたマップ画面
  - `imageUrl`: `assets/stage-maps` で確認済みのステージ素材。未照合時のみ観測フレーム
  - `observedImageUrl`: 照合根拠となった映像内マップ画面
  - `observedAt`: 試合動画内の観測秒
  - `source`: 現在は `observed-video-map-screen`
- `capabilities`: 各解析機能の実装・精度段階

- `validation.deaths`: リザルトのデス数と検出件数の照合結果

- `spatial.observations`: マップを開いた直後に映像から確認できた位置アンカー
  - `source: observed-map-cursor` はマップ描画が安定した最初のカーソルから得た自分の位置候補
  - 画面座標、マップ判定スコア、カーソル判定スコアを `evidence` に保持
- `playerRoute`: 観測アンカーと、その間を結ぶ低確度の推定動線
  - `source: observed` は直接観測、`inferred-between-observations` は観測点間の推定
- `spatial.predictions`: 過去2観測の移動方向を用いた6秒以内の予測。実位置とは別表示する
- `spatial.entityTracks`: マップ画面で直接確認できた味方マーカーの時系列
  - 青い円環、内部のブキ形状、白い向き三角形を組み合わせて検出
  - 複数回同じ座標に現れるスタート地点などの静的アイコンは除外
  - 名前を確定できないため、別時点は近傍対応の匿名トラックとして保持
- `spatial.predictions` の `source: predicted-from-map-facing-direction`: 観測した向き三角形から6秒だけ延長した味方予測

現在の解析JSONはバージョン9です。未知の値を作らないことを優先し、取得できない項目は `not-yet-available`、確定できない項目は `candidate-only` とします。位置や動線を追加するときも、映像・マップで知覚できた `observed`、事後的に補間した `inferred`、その時点から先を見積もった `predicted` を分離して保存します。
