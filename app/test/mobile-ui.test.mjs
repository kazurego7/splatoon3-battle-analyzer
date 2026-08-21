import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const root = new URL('../public/', import.meta.url);

test('主要画面が共通ハンバーガーナビゲーションと画面名を持つ', async () => {
  const [index, appScript, analytics, analyticsScript, search, searchScript, navigation] = await Promise.all([
    fs.readFile(new URL('index.html', root), 'utf8'),
    fs.readFile(new URL('app.js', root), 'utf8'),
    fs.readFile(new URL('analytics.html', root), 'utf8'),
    fs.readFile(new URL('analytics.js', root), 'utf8'),
    fs.readFile(new URL('search.html', root), 'utf8'),
    fs.readFile(new URL('search.js', root), 'utf8'),
    fs.readFile(new URL('navigation.js', root), 'utf8'),
  ]);
  assert.match(index, /viewport-fit=cover/);
  assert.match(analytics, /viewport-fit=cover/);
  assert.match(search, /viewport-fit=cover/);
  assert.match(index, /class="mobile-review-nav"/);
  assert.match(analytics, /id="dashboard-grid"/);
  assert.match(analytics, /id="dashboard-select"/);
  assert.match(analytics, /id="toggle-dashboard-edit"/);
  assert.match(analytics, /id="cancel-dashboard-edit"/);
  assert.match(analytics, /id="question-dialog"/);
  assert.ok(
    analytics.indexOf('<header class="dashboard-header">') < analytics.indexOf('<aside class="dashboard-sidebar"'),
    'ダッシュボードヘッダーはサイドバーより前のページ共通位置に置く',
  );
  assert.doesNotMatch(analytics, /dashboard-brand|ANALYSIS TOOLS|ダッシュボード設定/);
  for (const page of [index, analytics, search]) {
    assert.match(page, /data-navigation-toggle/);
    assert.match(page, /navigation\.js/);
  }
  assert.match(index, /録画ライブラリ/);
  assert.match(search, /<h1>試合検索<\/h1>/);
  assert.match(analytics, /分析ダッシュボード/);
  assert.match(navigation, /録画ライブラリ/);
  assert.match(navigation, /試合検索/);
  assert.match(navigation, /分析ダッシュボード/);
  for (const id of ['stage-options', 'rule-options', 'self-weapon-options', 'opponent-weapon-options']) {
    assert.match(search, new RegExp(`id="${id}"`));
  }
  assert.match(searchScript, /setAttribute\('aria-pressed'/);
  assert.match(searchScript, /filterMatchRecords\(state\.records, state\.selections\)/);
  assert.match(search, /id="filter-dialog"/);
  assert.match(search, /data-filter-open="stages"/);
  assert.doesNotMatch(search, /search-intro/);
  assert.match(searchScript, /showModal\(\)/);
  assert.match(search, /id="weapon-type-tabs"/);
  assert.match(searchScript, /renderWeaponTypeTabs/);
  assert.match(searchScript, /dataset\.weaponType/);
  assert.match(searchScript, /weaponMini\(self, true\)/);
  assert.doesNotMatch(searchScript, /slice\(0, 2\)/);
  assert.doesNotMatch(analytics, /質問/);
  assert.match(analytics, /グラフ・表を追加/);
  for (const direction of ['northwest', 'north', 'northeast', 'west', 'east', 'southwest', 'south', 'southeast']) {
    assert.match(analyticsScript, new RegExp(`resizeHandle\\(card, article, '${direction}'`));
  }
  assert.match(analyticsScript, /setDashboardEditMode/);
  assert.match(analyticsScript, /function cancelDashboardEdit\(\)/);
  assert.match(analyticsScript, /state\.dashboards = structuredClone\(snapshot\.dashboards\)/);
  assert.match(analyticsScript, /byId\('cancel-dashboard-edit'\)\.addEventListener\('click', cancelDashboardEdit\)/);
  assert.match(analyticsScript, /beginCardMove/);
  assert.match(analyticsScript, /moveDashboardCard\(startCards, card\.id, layout\)/);
  assert.match(analyticsScript, /applyCardLayout\(article, currentMove\.previewLayout \|\| layout\)/);
  assert.match(analyticsScript, /item\.classList\.toggle\('is-drag-target'/);
  assert.match(analyticsScript, /article\.addEventListener\('pointerdown', event => beginCardMove\(event, card, article\)\)/);
  assert.doesNotMatch(analyticsScript, /card-move-handle/);
  assert.match(analyticsScript, /syncDashboardCardLayouts/);
  assert.match(analyticsScript, /resizeDashboardCard\(startCards, card\.id, direction, columns, rows\)/);
  assert.doesNotMatch(analyticsScript, /compactDashboardLayout|packDashboardCardsLeft/);
  assert.doesNotMatch(index, /review-back-button|分析一覧に戻る/);
  assert.doesNotMatch(appScript, /reviewBackButton|backToAnalysisList/);
  assert.match(appScript, /history\.pushState\(\{review:true\}/);
  assert.match(appScript, /addEventListener\('popstate'/);
  for (const page of [index, analytics, search]) assert.match(page, /class="brand"/);
});

test('ダッシュボードはスマホで1列になり、検索画面は縦スクロールできる', async () => {
  const [styles, analyticsStyles, searchStyles] = await Promise.all([
    fs.readFile(new URL('styles.css', root), 'utf8'),
    fs.readFile(new URL('analytics.css', root), 'utf8'),
    fs.readFile(new URL('search.css', root), 'utf8'),
  ]);
  assert.match(styles, /@media \(max-width:700px\)/);
  assert.match(styles, /env\(safe-area-inset-bottom\)/);
  assert.match(styles, /\.is-review \.video-panel \{ order:1/);
  assert.match(analyticsStyles, /@media \(max-width:860px\)/);
  assert.match(analyticsStyles, /grid-template-rows:70px minmax\(0,1fr\)/);
  assert.match(analyticsStyles, /\.dashboard-header .*grid-column:1\/-1/);
  assert.match(analyticsStyles, /\.dashboard-sidebar .*inset:70px auto 0 0/);
  assert.match(analyticsStyles, /\.dashboard-card.*grid-column:1\/-1/);
  assert.match(analyticsStyles, /\.card-resize-handle \{ display:none/);
  assert.match(analyticsStyles, /\.dashboard-edit-mode \.dashboard-grid/);
  assert.match(analyticsStyles, /body:not\(\.dashboard-edit-mode\) \.edit-only/);
  assert.match(analyticsStyles, /env\(safe-area-inset-bottom\)/);
  assert.match(searchStyles, /\.icon-option\[aria-pressed="true"\]/);
  assert.match(searchStyles, /body\.search-page.*overflow-y:auto!important/);
  assert.match(searchStyles, /\.filter-dialog/);
  assert.match(searchStyles, /\.filter-launchers/);
  assert.match(searchStyles, /\.weapon-type-tabs/);
  assert.match(searchStyles, /env\(safe-area-inset-bottom\)/);
});
