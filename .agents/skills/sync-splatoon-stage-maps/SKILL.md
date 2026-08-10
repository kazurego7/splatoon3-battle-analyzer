---
name: sync-splatoon-stage-maps
description: Acquire, update, and validate Splatoon 3 stage overview images used by this repository. Use when asked to fetch stage maps, refresh stage images, check whether rule-specific maps are current, repair wrong or old map assets, audit missing or duplicate stage images, or update the stage-map source manifest.
---

# Sync Splatoon Stage Maps

Use `scripts/sync_stage_maps.py` as the deterministic source of truth. Keep completed assets under `assets/stage-maps/images/` for local use only. Never commit downloaded images, temporary files, or audit-only files.

## Workflow

1. Resolve the repository root from the skill directory. Confirm `assets/stage-maps/map_urls.csv` exists and tell the user that downloaded images are third-party material kept outside Git.
2. If local images already exist, run a local check before network access:

   ```powershell
   python .agents/skills/sync-splatoon-stage-maps/scripts/sync_stage_maps.py check
   ```

3. To refresh known stages from their source pages, run:

   ```powershell
   python .agents/skills/sync-splatoon-stage-maps/scripts/sync_stage_maps.py sync
   ```

   Add `--discover` only when the source index may contain a newly added stage. Discovery makes substantially more requests.

4. Review the summary printed by the script and inspect `git diff -- assets/stage-maps`. Finished `.webp` files must remain ignored; only documentation or manifests may appear in Git.
5. Run `check` again. Do not report success when a manifest file is missing, an image is not a valid WebP, its hash differs from the manifest, or duplicate image content exists.

## Selection rules

- Treat each stage and each of `ナワバリ`, `エリア`, `ヤグラ`, `ホコ`, `アサリ` independently.
- Prefer the greatest semantic version embedded in the source filename, including forms such as `ver.8.0.0`, `ver8`, and `ver2-0-0`. Treat an unversioned image as version zero.
- Exclude diagrams whose names contain route/change annotations such as `ルート`, `変更点`, `カンモン`, `ゴール`, `旧`, or `改修前`.
- Preserve the stable local filename `<ステージ名>_<ルール名>.webp`; record the original source name and URL in `map_urls.csv`.
- Download into a temporary directory and validate all responses before replacing completed files.
- Keep declared source omissions in `missing_rules.csv`; do not manufacture images for missing combinations.
- Before finishing, run `git check-ignore assets/stage-maps/images/<one-image>.webp` and confirm the image is ignored.

If Wiki markup changes and the script finds no candidates, stop without replacing existing images, preserve the evidence in the command output, and update the parser rather than guessing URLs.
