# splatoon3-battle-analyzer App

キャプチャーボードの長時間録画を置くと、試合区間の検出、試合単位の動画分割、基礎解析、一覧表示までをローカルで自動実行するWebアプリです。ソースコードはプロジェクト全体のGitリポジトリで管理し、動画や生成物は一つ上の `data/` に分離しています。

## 起動

必要なものは Node.js 22 以上とFFmpegです。FFmpegは環境変数 `FFMPEG_PATH` で実行ファイルを指定します。手元の `../tools/runtime/video-split/` に配置した場合は自動検出しますが、実行環境はGitHubリポジトリに含まれません。AIデス分析を使う場合は、npm依存関係として導入されるCodex CLIへChatGPTアカウントでログインします。

```powershell
cd app
npx codex login
npm start
```

ブラウザで <http://127.0.0.1:4310> を開きます。起動中に `../data/raw/` へ MP4 などを置くと、5秒以内に処理が始まります。

## 処理の流れ

1. 録画を一覧へ登録する
2. 映像・音声・コーデックを確認する
3. 2秒間隔の映像特徴とルール表示から試合区間を検出する
4. 詳細リザルトまで含め、入力と同じ映像コーデックで一時領域へ全試合を再エンコードする
5. 全クリップの映像・音声を確認してから完成領域へ入れ替える
6. 試合終了後の左上に表示される `WIN!` / `LOSE...` を複数フレームで確認し、勝敗を判定する
7. リザルトの自分行または個人戦績画面から、追加料金のないローカルOCRでデス数を読み、本人HUD枠と復活UIの候補をその件数へ照合する。リザルトがなければデス分析を生成しない
8. 必要に応じて分析画面のボタンから、認証済みのCodex CLIで各デスの6時点をシーケンス分析し、試合内で繰り返す失敗パターンを抽出する。`CODEX_DEATH_ANALYSIS=true` の場合は初回解析時にも自動実行する
9. 一覧を「分析済み」にし、各試合を開けるようにする

状態は `待機中 → 確認中 → 分割中 → 分析中 → 分析済み` と表示されます。失敗時はエラー内容と再分析ボタンを表示します。

## コマンド

```powershell
# 特定の録画を手動で再分析
npm run analyze -- "2026-08-08 15-20-32.mp4"

# 区間検出だけを調査
npm run inspect -- "..\data\raw\2026-08-08 15-20-32.mp4"

# 分割済み1試合のデス検出を確認
npm run inspect:deaths -- "..\data\matches\<recording-id>\match-01.mp4" 342

# 敵味方の生存人数検出を確認
npm run inspect:counts -- "..\data\matches\<recording-id>\match-01.mp4" 342

# リザルトからの本人HUD枠特定を確認
npm run inspect:identity -- "..\data\matches\<recording-id>\match-01.mp4"

# 確認済みラベルからペナルティ数字モデルを再生成
npm run calibrate:game-penalty

# 未学習時刻のラベル一致・短い値往復・マップ表示時変化を検証
npm run validate:game-penalty

# 人が確認した勝敗ラベルと終了後のWIN/LOSE発表判定を照合
npm run validate:outcomes -- "..\data\raw\<recording>.mp4" "..\data\work\<recording-id>\manifest.json"

# 構文・ユニットテスト
npm run check
npm test
npm run check:public
```

ペナルティ教師ラベルは `config/game-penalty-calibration-observations.json`、未学習時刻の検証ラベルは `config/game-penalty-validation-observations.json` に保存します。各観測は `[試合内秒数, 自軍ペナルティ, 相手ペナルティ]` で、表示されていない側は `null` です。確認用の切り抜きとコンタクトシートは `../data/work/penalty-training-review/` と `../data/work/penalty-validation-review/` にあります。

勝敗の確認済みラベルは `config/outcome-validation-observations.json` に保存します。録画や勝敗発表画像はGitへ含めず、検証コマンドへローカル録画と区間マニフェストを渡します。

環境変数:

- `PORT`: HTTPポート。既定値は `4310`
- `AUTO_PROCESS=false`: 自動キュー処理を止め、既存結果の確認だけを行う
- `FFMPEG_PATH`: 使用するFFmpeg実行ファイルを明示する
- `CODEX_DEATH_ANALYSIS=true`: 初回解析時にもAIシーケンス分析を自動実行する（既定は画面からの手動実行のみ）
- `CODEX_DEATH_MODEL`: デス分析に使うOpenAIモデルを明示する（未指定時はCLIの既定値）
- `CODEX_DEATH_TIMEOUT_MS`: Codex 1バッチのタイムアウト（既定は180000ミリ秒）
- `CODEX_DEATH_ANALYSIS_REFRESH=true`: 同じ動画・デス時刻の保存済みCodex結果も再生成する

リザルトのデス数読取は常にローカルで完結し、CodexやOpenAI APIを呼びません。AIシーケンス分析は、画面で実行した場合、または `CODEX_DEATH_ANALYSIS=true` を明示した場合だけ、Codex CLIへ **ChatGPTアカウントでログインしている場合に限って** 実行します。`npx codex login status` で状態を確認できます。親プロセスに `OPENAI_API_KEY` が設定されていても解析プロセスへ渡さないため、OpenAI APIの従量課金へ自動で切り替わることはありません。ChatGPTプランの利用上限へ達した自動分析は、ローカル判定結果へフォールバックします。画面からの実行時はエラー理由を表示します。

## データ配置

- 入力録画: `../data/raw/`
- 分割動画: `../data/matches/<recording-id>/`
- 状態: `../data/app/state.json`
- 解析JSON: `../data/app/analysis/<recording-id>/`
- サムネイル: `../data/app/thumbnails/<recording-id>/`
- 一時ファイル・検出キャッシュ: `../data/work/<recording-id>/`

データ形式は [ANALYSIS_SCHEMA.md](./docs/ANALYSIS_SCHEMA.md)、体験全体の方針は [PRODUCT_BRIEF.md](./docs/PRODUCT_BRIEF.md) を参照してください。

`scripts/diagnostics/` は実装済み解析の確認用、`scripts/experiments/` は未完成機能の検証用です。アプリの通常利用では直接実行する必要はありません。

## 現在の解析範囲

ブキ名照合にはGit管理外の `src/weapon-catalog.json`、クリーンなステージ表示にはGit管理外の `../assets/stage-maps/images/` が必要です。未導入でもアプリは起動し、該当する任意機能だけが無効になります。第三者データの扱いは [`docs/THIRD_PARTY_DATA.md`](docs/THIRD_PARTY_DATA.md) を確認してください。

実装済みなのは、自動試合分割、実動画再生、リザルトからの本人HUD枠特定と自分のブキ名照合、上部HUDと右下の復活カウントUIを使ったデス時刻照合、デス前8秒から直後までのAIシーケンス分析と反復パターン抽出、敵味方の生存人数と人数差、ゲームカウント、映像内マップ画面の抽出、`../assets/stage-maps/` のステージ素材表示、動画・シークバー・グラフ・マップの同期、味方位置の観測です。本人HUD枠は固定座標で決めず、リザルトの自分行に表示されたブキ画像を4つの自軍HUDアイコンへ照合します。自分のブキ名は同じリザルト画像を173種の日本語辞書へ照合し、確度不足の候補は画面に出しません。マップ画面は左上の閉じるボタンまで照合し、通常戦闘のHUDを除外します。自軍色は左下の本人パネルから試合ごとに推定し、味方は上・左・右のプレイヤーパネルから伸びる点線との接続まで確認できたマーカーだけを採用します。マップ上の円はスティックで動かせるジャンプ用カーソルなので自分位置には使わず、側面パネルがピンク枠なら選択中の味方位置として扱います。味方マーカー周囲の小さな矢印はD-padの割当表示であり進行方向ではないため、そこから予測動線は生成しません。自分専用マーカーは未検出のため、現時点では自分の動線を生成しません。デス時刻は両UIの早い検出を採用し、上部HUDが隠れている場合は復活UIの初出へフォールバックします。デス直前の相手色・形状・動きはデス説明とマップ予測の内部根拠に限り、動画上へ敵候補枠は表示しません。敵味方の確定検出、敵のブキ名、実カメラ姿勢による正確な座標対応は未完成のため、観測と予測を分離する方針です。モックは `../mock/` に参照用として保存しています。
