import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('shows a preparing placeholder when a match has no thumbnail yet', async () => {
  const [app, search, styles] = await Promise.all([
    fs.readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../public/search.js', import.meta.url), 'utf8'),
    fs.readFile(new URL('../public/styles.css', import.meta.url), 'utf8'),
  ]);

  assert.match(app, /placeholder\.textContent='準備中'/u);
  assert.match(app, /placeholder\.hidden=Boolean\(match\.thumbnailUrl\)/u);
  assert.match(search, /'thumbnail-pending', '準備中'/u);
  assert.match(styles, /\.thumbnail-pending\[hidden\] \{ display:none; \}/u);
});
