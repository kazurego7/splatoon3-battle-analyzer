import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { stageMapAssetUrl } from '../public/stage-map-ui.js';

test('ルール別の俯瞰ステージ画像を常に使用する', () => {
  assert.equal(
    decodeURIComponent(stageMapAssetUrl({
      stage: 'スメーシーワールド',
      rule: 'ヤグラ',
      imageUrl: '/media/thumbnails/death-frame.jpg',
    })),
    '/assets/stage-maps/スメーシーワールド_ヤグラ.webp',
  );
  assert.equal(stageMapAssetUrl({ stage: '', rule: 'ヤグラ' }), null);
});

test('ステージマップUIに旧位置追跡の残骸を置かない', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const css = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  for (const legacy of ['map-clock', 'route-layer', 'entity-layer', 'player-layer']) {
    assert.equal(html.includes(legacy), false);
    assert.equal(app.includes(legacy), false);
  }
  assert.equal(html.includes('SPATIAL REVIEW'), false);
  for (const legacy of ['.map-clock', '.route-segment', '.map-player', '.map-observed', '.map-prediction', '.map-threat-zone']) {
    assert.equal(css.includes(legacy), false);
  }
  assert.match(html, /<div class="map-legend"><span><i class="strong"><\/i>有利なポジション<\/span><\/div>/u);
});
