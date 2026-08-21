# ブキアイコン

録画上部HUDの味方・相手ブキを照合するため、[Splatoon3 攻略＆検証 Wiki の icon ページ](https://wikiwiki.jp/splatoon3mix/icon)からメインブキ画像を取得します。

```powershell
cd app
npm run sync:weapons
```

画像は `images/`、画像認識へ渡す番号付き一覧は `reference-sheets/`、取得元URLとハッシュは `manifest.json`、アプリ用カタログは `app/src/weapon-catalog.json` に生成されます。ダウンロード画像と生成物はGit管理外です。取得元の利用条件を確認したうえでローカル利用してください。
