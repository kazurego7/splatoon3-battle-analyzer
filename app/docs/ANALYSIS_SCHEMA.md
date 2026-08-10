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
  - `type: death` には `title`、`situation`、`cause` を保存する
  - AIシーケンス分析済みのデスは、`sequence`、`turningPoint`、`patternTags` も持つ
  - `sequence[]` はデス時刻に対する `offset`、局面 `phase`、画面上の事実 `observation`、解釈 `interpretation` を持つ
  - AI分析が成功した場合、`analysisSource` は `codex-vision-sequence`、保存済み結果の再利用時は `codex-vision-sequence-cache`
  - AI分析が利用できない場合も、人数状況と映像内の敵候補から作るローカル説明へフォールバックする
- `deathAnalysis`: 試合単位のAIデス分析。未実行時は `null`
  - `overallSummary`: 試合内のデス全体の要約
  - `sequences`: `events` へ反映したデスごとのシーケンス分析
  - `patterns[]`: 2件以上のデスで共通する `trigger` → `repeatedAction` → `consequence`
  - `patterns[].deathIds`: パターンの根拠となるデスID。最低2件
  - `patterns[].reviewFocus`: 映像を見返す際の具体的な注目点
  - `patterns[].clips[]`: パターン動画で順番に再生する根拠範囲。動画を切り抜かず、デス時刻に対する `startOffset` / `endOffset` として保持する
  - 1パターン内で同じデスに複数範囲を持てる。各 `deathIds` には最低1範囲が必要
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
- `outcome`: 試合終了後の勝敗発表から読み取った勝敗
  - `value`: `win` または `lose`
  - `time`: 試合クリップ内で最も確度の高い発表を確認した秒
  - `confidence`: 左上タイトルの形状と複数フレームの一致から算出した0〜1の確度
  - `observations`: 同じ勝敗発表を確認できたフレーム数。2回以上の一致を必須とする
  - `source`: `post-match-announcement-local-vision`
  - 発表を検出できない場合だけ、一覧画面は最後のゲームカウント比較へフォールバックする
- `gameFlow.playerCounts[]`: 1秒ごとの自軍・相手の生存人数と人数差
  - `teamAlive` / `enemyAlive`: 0〜4人の生存人数
  - `difference`: `teamAlive - enemyAlive`
  - `source`: その秒を直接読めた `observed`、または直近観測を最大5秒保持した `held`
  - `confidence`: HUDの観測継続性から算出した0〜1の確度
- `gameFlow.gameCounts[]`: 0.5秒間隔のゲームカウント観測時系列。瞬間的な大量得点は未観測の中間値を補間せず、その観測時点で反映する
  - `teamCount` / `enemyCount`: 画面上部から読んだ自軍・相手カウント
  - `teamPenalty` / `enemyPenalty`: カウント下の `+N` から読んだ自軍・相手ペナルティ。非表示時は0
  - `teamSource` / `enemySource`: カウントを直接観測した `observed`、短時間保持した `held`、または補間した `inferred`
  - `teamPenaltySource` / `enemyPenaltySource`: ペナルティの同じ観測区分
- `stageMap`: 映像内で実際に開かれたマップ画面
  - `imageUrl`: `assets/stage-maps` で確認済みのステージ素材。未照合時のみ観測フレーム
  - `observedImageUrl`: 照合根拠となった映像内マップ画面
  - `observedAt`: 試合動画内の観測秒
  - `source`: 現在は `observed-video-map-screen`
- `capabilities`: 各解析機能の実装・精度段階

- `validation.deaths`: リザルトのデス数と検出件数の照合結果
  - `expected`: リザルトから読み取った自分のデス数
  - `observed`: 分析へ採用したデス数
  - `candidates`: HUD・復活UIが生成した照合前の候補数
  - `resultTime`: 試合クリップ内のリザルト確認秒
  - `source`: 外部AIを使わない `result-screen-local-ocr`
  - リザルトがない場合、または候補がリザルト件数に満たない場合、部分的なデス分析は公開しない

- `spatial.observations`: マップを開いた直後に映像から確認できた位置アンカー
  - `source: observed-map-self-marker` は、自分専用形状を映像から確定できた場合だけ保存する
  - マップ上の円はスティックで移動できるスーパージャンプ用カーソルのため、自分位置には使わない
  - 現在の基準録画では自分専用マーカーを確定できておらず、`spatial.observations` と `playerRoute` は空
- `playerRoute`: 観測アンカーと、その間を結ぶ低確度の推定動線
  - `source: observed` は直接観測、`inferred-between-observations` は観測点間の推定
- `spatial.predictions`: 過去2観測の移動方向を用いた6秒以内の予測。実位置とは別表示する
- `spatial.entityTracks`: マップ画面で直接確認できた味方マーカーの時系列
  - 左下の本人パネルから自軍色を推定し、同色の円環と内部形状を検出した後、上・左・右の味方パネルから伸びる点線との接続を確認する
  - `source: observed-map-panel-connected-ally` は、点線がマーカー付近まで続くことで裏付けた味方位置
  - `source: observed-map-selected-ally-cursor` は、側面パネルのピンク選択枠とジャンプ用カーソルを同時に観測した味方位置。向きは生成しない
  - マーカー周囲の小さな矢印はD-padの味方割当表示であり、移動方向として使わない
  - 複数回同じ座標に現れるスタート地点などの静的アイコンは除外
  - 名前を確定できないため、別時点は近傍対応の匿名トラックとして保持
- 味方の予測動線は、同一マップ表示中の複数時刻から実移動を観測できるまで生成しない
- `spatial.predictions` の `source: predicted-from-video-candidate-and-self-route-heading`: 動画内の敵候補を、自分の同時刻の推定位置と移動方向へ接続した低確度予測
  - 画面内の左右位置を90度の仮定視野角へ変換し、矩形の高さを距離の大まかな手掛かりとして使う
  - 20秒以内にマップで観測した向きがあればそれを優先し、なければ自分の移動方向でカメラ向きを近似する
  - どちらも実際のカメラ姿勢ではないため、点ではなく時間とともに広がる不確実範囲として表示
  - `evidence.limitation` に近似条件を保持し、敵の観測座標とは扱わない
- `spatial.threatZones`: 自分のデス直後10秒以内にマップで確認した位置を根拠とする敵脅威範囲
  - 敵の正確な位置・方向は断定せず、`type: uncertainty-zone` として時間とともに広がる範囲を保存
  - `evidence` にデス時刻、位置観測時刻、その時間差を保持
  - 映像内で敵を直接検出した観測ではないため、常に `predicted` として表示
- `detections`: デス説明と空間予測に使う内部の知覚候補。動画上へは表示しない
  - `kind: death-camera-focus-candidate` は、本人デスと復活UIで確認したデスカメラ区間
  - 矩形は敵個体の境界ではなくカメラの注目範囲なので、敵の確定位置として扱わない
  - `kind: enemy-color-motion-candidate` は、自分のデス前4秒以内に相手色・形状・フレーム間の動きが連続した領域
  - 0.5秒間隔の2フレーム以上で近い位置に続くことを必須とする
  - 相手インクを人物と誤認する可能性があるため、敵の確定観測やステージ上の正確な座標には使わない
  - ブキを画像から特定できていない場合は `weapon: null` のまま保持し、名称を作らない

現在の解析JSONはバージョン26です。未知の値を作らないことを優先し、取得できない項目は `not-yet-available`、確定できない項目は `candidate-only` とします。位置や動線を追加するときも、映像・マップで知覚できた `observed`、事後的に補間した `inferred`、その時点から先を見積もった `predicted` を分離して保存します。
