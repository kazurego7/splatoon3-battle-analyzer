# Battle Review App

キャプチャーボードの長時間録画を置くと、試合区間の検出、試合単位の動画分割、基礎解析、一覧表示までをローカルで自動実行するWebアプリです。`app/` は独立したGitリポジトリで、動画や生成物は一つ上の `data/` に分離しています。

## 起動

必要なものは Node.js 22 以上です。FFmpeg は通常 `../tools/runtime/video-split/` の同梱版を自動検出します。

```powershell
cd app
npm start
```

ブラウザで <http://127.0.0.1:4310> を開きます。起動中に `../data/raw/` へ MP4 などを置くと、5秒以内に処理が始まります。

## 処理の流れ

1. 録画を一覧へ登録する
2. 映像・音声・コーデックを確認する
3. 2秒間隔の映像特徴とルール表示から試合区間を検出する
4. 入力と同じ映像コーデックで一時領域へ全試合を再エンコードする
5. 全クリップの映像・音声を確認してから完成領域へ入れ替える
6. サムネイル、画面変化、本人HUD枠、自分のデス、生存人数、ゲームカウント、観測マップ、分析候補を生成する
7. 一覧を「分析済み」にし、各試合を開けるようにする

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

# 構文・ユニットテスト
npm run check
npm test
```

環境変数:

- `PORT`: HTTPポート。既定値は `4310`
- `AUTO_PROCESS=false`: 自動キュー処理を止め、既存結果の確認だけを行う
- `FFMPEG_PATH`: 使用するFFmpeg実行ファイルを明示する

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

実装済みなのは、自動試合分割、実動画再生、リザルトからの本人HUD枠特定、自分のデス検出、敵味方の生存人数と人数差、ゲームカウント、映像内マップ画面の抽出、分析ポイント、動画・シークバー・グラフ・マップの同期です。本人HUD枠は固定座標で決めず、リザルトの自分行に表示されたブキ画像を4つの自軍HUDアイコンへ照合します。映像内の敵味方検出、ブキ名、自分の試合全体の動線、知覚情報からの予想動線はまだ解析データを生成できないため、観測できていない位置を画面へ作らない方針です。モックは `../mock/` に参照用として保存しています。
