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
- `deathAnalysisState`: AI分析の段階公開と再開に使う状態
  - `status`: `idle`, `sequences`, `report`, `complete`, `error`, `interrupted`
  - `phase`: `sequences` はデス一覧生成、`report` は俯瞰レポート生成
  - `completedDeaths` / `totalDeaths`: デス一覧生成の進捗
  - `error` / `guidance` / `retryable`: Codexの返答に基づく原因、対処方法、再開可否
- `series[].motion`: 連続フレームの画面変化量
- `series[].hud`: HUDらしさのスコア
- `gameFlow.deaths.self`: 自分のデス開始秒と、次に生存表示を確認するまでの秒数
  - 上部HUDの本人ブキ枠と、右下の「復活まであとX秒」UIの初出時刻をデスごとに照合
  - 復活UIを時刻根拠にする場合は、教師データで校正した表示遅延を初出時刻から差し引き、実測初出と補正量を `events[].evidence.timing` に残す
  - `events[].evidence.timing` に `hudDetectedAt`、`respawnUiDetectedAt`、実測差の `respawnUiDelay` を保存
- `playerStats`: リザルト画面から取得した本人の `kills` / `deaths`。読み取れない値は `null`
  - 上部HUDを確認できない区間では、復活UIの初出を `respawn-ui-fallback` の根拠にし、校正済み表示遅延を差し引いた時刻を採用
  - 復活UIは通常色・エナジースタンド色を区別して検出
- `playerIdentity`: リザルトの自分行とブキ画像をHUDへ照合した結果
  - `hudSlot`: 自軍HUDの左から何番目か（0始まり）
  - `method`: 同じ試合の個人リザルトを使った `personal-result-weapon-match`、または同録画内の個人リザルトから引き継いだ `carried-personal-result-weapon-match`
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
  - `teamCount` / `enemyCount`: エリア・アサリではイカランプ直下の固定スコアカード、ヤグラ・ホコでは進行線上を移動する丸いマーカーから読んだ自軍・相手カウント
  - `teamPenalty` / `enemyPenalty`: エリア・アサリでカウント下の `+N` から読んだ自軍・相手ペナルティ。非表示時、および数値ペナルティ表示のないヤグラ・ホコでは0
  - `teamSource` / `enemySource`: カウントを直接観測した `observed`、短時間保持した `held`、または補間した `inferred`
  - `teamPenaltySource` / `enemyPenaltySource`: ペナルティの同じ観測区分
- `stageMap`: 判定済みのステージとルールに対応する俯瞰マップ
  - `imageUrl`: `assets/stage-maps` のルール別ステージ素材
  - `stage` / `rule`: 個人リザルトまたは試合開始カードから確定した名称
  - 戦闘映像やゲーム内マップ画面へはフォールバックしない
- `capabilities`: 各解析機能の実装・精度段階

- `validation.deaths`: リザルトのデス数と検出件数の照合結果
  - `expected`: リザルトから読み取った自分のデス数
  - `observed`: 分析へ採用したデス数
  - `candidates`: HUD・復活UIが生成した照合前の候補数
  - `resultTime`: 試合クリップ内のリザルト確認秒
  - `source`: 外部AIを使わない `result-screen-local-ocr`
  - リザルトがない場合、または候補がリザルト件数に満たない場合、部分的なデス分析は公開しない

- `weaponRoster`: GO後から最初のデス表示より前に、画面上部の味方4枠・相手4枠を2フレーム照合した編成
  - `openingTimes`: 実際に照合した試合クリップ内の秒数
  - タイマーだけでは開始と見なさず、8枠中7枠以上で色付きの編成背景を確認できる連続フレームから候補を選ぶ
  - `teamSlots` / `enemySlots`: 左から右の順番、候補名、信頼度、採用可否
  - `allyWeapons`: 自分のブキを1枠除いた味方3人分
  - `enemyWeapons`: 相手4人分
  - 個人リザルトで確定した自分のブキが味方4枠に存在しない結果は保存しない
  - 2フレームで一致しない枠や信頼度が基準未満の枠は名称を作らず、編成を部分取得として扱う

現在の解析JSONはバージョン28です。未知の値を作らないことを優先し、取得できない項目は `not-yet-available`、確定できない項目は `candidate-only` とします。位置や動線を追加するときも、映像・マップで知覚できた `observed`、事後的に補間した `inferred`、その時点から先を見積もった `predicted` を分離して保存します。

## 横断分析データ

`../data/app/analytics/matches.json` は、動画解析JSONとは別に更新する横断分析用ストアです。粒度は1試合1レコードです。

- `records[].automatic`: 試合解析から作った自動取得値。ステージ、ルール、勝敗、自分のブキ、デス数、試合時間、人数有利時間、カウント・ペナルティ、開始直後HUDのブキ編成を保持する
- `records[].overrides`: 画面で修正した値。自動取得値を消さず、表示・集計時だけ優先する
- `coverage`: ステージ、ルール、勝敗、自分のブキ、編成を取得できたかを項目別に示す
- `source.kind`: 常に `video-analysis`

横断分析ストアの更新は動画の分割・解析後に独立したバックグラウンド処理で行います。ブキ編成は解析時に確定済みの `weaponRoster` だけを取り込み、横断分析側で再推定しません。
