# Third-party data

`src/weapon-catalog.json` はGit管理しません。手元で利用条件を確認した第三者データから生成する任意機能で、ファイルがなくてもアプリは起動し、ブキ名判定だけが無効になります。

現在の生成スクリプトは [Leanny/splat3](https://github.com/Leanny/splat3) の `WeaponInfoMain.json` と `images/weapon_flat` を入力形式として想定しています。このリポジトリは元データ、元画像、生成済みカタログを再配布しません。利用者自身が取得元の権利・利用条件を確認したローカルコピーを用意した場合だけ、次を実行してください。

```powershell
npm run sync:weapons -- <Leanny/splat3 のローカルパス>
```

生成物は `src/weapon-catalog.json` に保存されますが、`.gitignore` によりコミット対象になりません。元のPNG画像は収録せず、32×20の照合特徴だけを保持します。
