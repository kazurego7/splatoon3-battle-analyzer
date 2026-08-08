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
- `gameFlow.playerCounts[]`: 1秒ごとの自軍・相手の生存人数と人数差
  - `teamAlive` / `enemyAlive`: 0〜4人の生存人数
  - `difference`: `teamAlive - enemyAlive`
  - `source`: その秒を直接読めた `observed`、または直近観測を最大5秒保持した `held`
  - `confidence`: HUDの観測継続性から算出した0〜1の確度
- `capabilities`: 各解析機能の実装・精度段階

未知の値を作らないことを優先し、取得できない項目は `not-yet-available`、確定できない項目は `candidate-only` とします。将来、デス・カウント・位置推定を追加するときも、観測値と推定値の根拠を分離して保存します。
