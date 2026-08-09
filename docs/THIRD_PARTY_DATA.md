# Third-party data

`src/weapon-catalog.json` は [Leanny/splat3](https://github.com/Leanny/splat3) の `WeaponInfoMain.json` と `images/weapon_flat` から、対戦用ブキの日本語名と照合用の縮小特徴量だけを生成したものです。アプリ実行時に外部通信は行いません。

更新時は参照リポジトリを別途取得し、次を実行します。

```powershell
npm run sync:weapons -- <Leanny/splat3 のローカルパス>
```

生成物には元のPNG画像を収録せず、32×20の照合特徴だけを保持します。
