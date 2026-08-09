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
  - `weapon`: リザルトの自分行にあるブキ画像を173種の照合辞書へ比較した結果
    - `status`: その試合のリザルトから直接識別した `identified-from-result-icon`、録画内の一致で補強した `confirmed-by-recording-consistency`、前試合から引き継いだ `inferred-from-previous-result`、または画面へ出さない `candidate-only`
    - `name` / `id`: 日本語ブキ名と辞書ID
    - `candidates`: 上位候補と画像距離。確度不足時にも検証根拠として保持
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
  - `source: observed-map-self-marker-under-cursor` は、ピンクの選択カーソルと青いチームマーカーが34px以内で重なった場面から得た自分位置候補
  - カーソル単体は自分位置として採用しない。重なったマーカーの座標・向き、画面座標、両者の距離を `evidence` に保持
  - カーソルが味方へ移動している可能性は残るため、`evidence.limitation` と確度を保持する
- `playerRoute`: 観測アンカーと、その間を結ぶ低確度の推定動線
  - `source: observed` は直接観測、`inferred-between-observations` は観測点間の推定
- `spatial.predictions`: 過去2観測の移動方向を用いた6秒以内の予測。実位置とは別表示する
- `spatial.entityTracks`: マップ画面で直接確認できた味方マーカーの時系列
  - 青い円環、内部のブキ形状、白い向き三角形を組み合わせて検出
  - 複数回同じ座標に現れるスタート地点などの静的アイコンは除外
  - 名前を確定できないため、別時点は近傍対応の匿名トラックとして保持
- `spatial.predictions` の `source: predicted-from-map-facing-direction`: 観測した向き三角形から6秒だけ延長した味方予測
- `spatial.predictions` の `source: predicted-from-video-candidate-and-self-route-heading`: 動画内の敵候補を、自分の同時刻の推定位置と移動方向へ接続した低確度予測
  - 画面内の左右位置を90度の仮定視野角へ変換し、矩形の高さを距離の大まかな手掛かりとして使う
  - 20秒以内にマップで観測した向きがあればそれを優先し、なければ自分の移動方向でカメラ向きを近似する
  - どちらも実際のカメラ姿勢ではないため、点ではなく時間とともに広がる不確実範囲として表示
  - `evidence.limitation` に近似条件を保持し、敵の観測座標とは扱わない
- `spatial.threatZones`: 自分のデス直後10秒以内にマップで確認した位置を根拠とする敵脅威範囲
  - 敵の正確な位置・方向は断定せず、`type: uncertainty-zone` として時間とともに広がる範囲を保存
  - `evidence` にデス時刻、位置観測時刻、その時間差を保持
  - 映像内で敵を直接検出した観測ではないため、常に `predicted` として表示
- `detections`: 動画オーバーレイ用の知覚候補
  - `kind: death-camera-focus-candidate` は、本人デスと復活UIで確認したデスカメラ区間
  - 矩形は敵個体の境界ではなくカメラの注目範囲なので、破線と「敵候補｜デスカメラ」で表示
  - `kind: enemy-color-motion-candidate` は、自分のデス前4秒以内に相手色・形状・フレーム間の動きが連続した領域
  - 0.5秒間隔の2フレーム以上で近い位置に続くことを必須とし、破線と「敵候補｜色・動き」で表示する
  - 相手インクを人物と誤認する可能性があるため、敵の確定観測やステージ上の正確な座標には使わない
  - ブキを画像から特定できていない場合は `weapon: null` のまま保持し、名称を作らない

現在の解析JSONはバージョン15です。未知の値を作らないことを優先し、取得できない項目は `not-yet-available`、確定できない項目は `candidate-only` とします。位置や動線を追加するときも、映像・マップで知覚できた `observed`、事後的に補間した `inferred`、その時点から先を見積もった `predicted` を分離して保存します。
