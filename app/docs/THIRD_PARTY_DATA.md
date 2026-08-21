# Third-party data

`src/weapon-catalog.json` と `../assets/weapon-icons/images/` はGit管理しません。取得元の利用条件を確認してローカル生成する任意機能で、ファイルがなくてもアプリは起動し、ブキ名判定だけが無効になります。

生成スクリプトは [Splatoon3 攻略＆検証 Wiki の icon ページ](https://wikiwiki.jp/splatoon3mix/icon)からメインブキ画像・名称とルールアイコンを取得します。このリポジトリは取得画像や生成済みカタログを再配布しません。利用者自身が取得元の権利・利用条件を確認したうえで、次を実行してください。

```powershell
npm run sync:icons
```

取得画像は `../assets/weapon-icons/images/`、取得元URLとハッシュは `../assets/weapon-icons/manifest.json`、照合特徴は `src/weapon-catalog.json` に保存されます。すべて `.gitignore` によりコミット対象になりません。
