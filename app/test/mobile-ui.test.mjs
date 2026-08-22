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
  for (const id of ['result-heading', 'result-outcome', 'result-stage', 'result-rule', 'result-kd', 'result-allies', 'result-enemies']) {
    assert.match(index, new RegExp(`id="${id}"`));
  }
  assert.match(index, /id="screen-context"/);
  assert.doesNotMatch(index, /id="result-specials"|id="result-duration"/);
  assert.doesNotMatch(index, /video-heading-meta|video-heading-chip/);
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
  for (const id of ['stage-options', 'rule-options', 'outcome-options', 'self-weapon-options', 'opponent-weapon-options', 'ally-composition-options', 'enemy-composition-options']) {
    assert.match(search, new RegExp(`id="${id}"`));
  }
  assert.match(searchScript, /setAttribute\('aria-pressed'/);
  assert.match(searchScript, /filterMatchRecords\(state\.records, state\.selections\)/);
  assert.match(search, /id="filter-dialog"/);
  assert.match(search, /data-filter-open="selfWeapons"/);
  assert.match(search, /data-filter-open="opponentWeapons"/);
  assert.match(search, /data-filter-open="allyCompositions"/);
  assert.match(search, /data-filter-open="enemyCompositions"/);
  assert.doesNotMatch(search, /id="filter-option-query"/);
  assert.match(search, /id="weapon-type-tabs"/);
  assert.match(search, /class="direct-filter direct-stage-filter"/);
  assert.match(search, /class="icon-options stage-options direct-stage-options"/);
  assert.match(search, /<span>検索項目<\/span>/);
  assert.doesNotMatch(search, /ステージ・ルール・勝敗は直接選択/);
  assert.doesNotMatch(search, /data-filter-open="(?:stages|rules|outcomes)"/);
  assert.doesNotMatch(search, /<i>0[1-7]<\/i>/);
  assert.doesNotMatch(search, /（(?:OR|AND)）/);
  assert.doesNotMatch(search, /search-intro/);
  assert.match(searchScript, /showModal\(\)/);
  assert.match(searchScript, /renderWeaponTypeTabs/);
  assert.match(searchScript, /weaponTypeForName/);
  assert.match(searchScript, /const COMPOSITION_LIMIT = 4/);
  assert.match(searchScript, /selected\.size >= COMPOSITION_LIMIT/);
  assert.match(searchScript, /option\.disabled = isComposition/);
  assert.match(searchScript, /rosterRow\('味方', record\.allyWeapons, self\)/);
  assert.match(searchScript, /stats\.append\(outcome, node\('span'/);
  assert.doesNotMatch(searchScript, /media\.append\(outcome\)/);
  assert.match(searchScript, /weapons\.map\(weapon => weaponMini\(weapon\)\)/);
  assert.match(searchScript, /if \(filter\.single\)/);
  assert.match(searchScript, /const cancel = selected\.has\(value\)/);
  assert.match(searchScript, /function syncFilterSelection\(filter\)/);
  assert.match(searchScript, /syncFilterSelection\(filter\)/);
  assert.match(searchScript, /const resultCardCache = new Map\(\)/);
  assert.match(searchScript, /records\.map\(cachedResultCard\)/);
  assert.match(searchScript, /const RULE_ORDER = \['ナワバリ', 'エリア', 'ヤグラ', 'ホコ', 'アサリ'\]/);
  assert.match(searchScript, /enableHorizontalWheelScroll\(byId\('stage-options'\)\)/);
  assert.match(searchScript, /requestIdleCallback/);
  assert.ok(
    searchScript.indexOf("fetch('/api/analytics',") < searchScript.indexOf("fetch('/api/analytics/weapons',"),
    'ブキ画像カタログは試合データの初期表示後に読み込む',
  );
  assert.doesNotMatch(searchScript, /direct-all-option/);
  assert.doesNotMatch(searchScript, /`試合 \$\{matchLabel\}`/);
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
  assert.match(appScript, /function renderMatchResult\(\)/);
  assert.match(appScript, /loadReviewWeaponIcons/);
  assert.match(appScript, /elements\.screenTitle\.textContent/);
  assert.match(appScript, /elements\.screenTitle\.textContent=active\?'試合レビュー':'録画ライブラリ'/);
  assert.doesNotMatch(appScript, /resultSpecials|resultDuration/);
  assert.doesNotMatch(appScript, /videoHeadingMeta|動画：試合|ブキ：/);
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
  assert.match(styles, /\.app-header \{ position:sticky; top:0; z-index:80; height:56px; min-height:56px;/);
  assert.match(styles, /\.mobile-review-nav \{ position:sticky;[^}]*top:56px;/);
  assert.match(styles, /\.is-review \.video-panel \{ order:1/);
  assert.match(styles, /\.result-map-panel \{ display:grid/);
  assert.match(styles, /\.result-weapon\.is-self/);
  assert.match(styles, /\.result-weapon-list \{ grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.doesNotMatch(styles, /\.result-weapon-list \{ grid-template-columns:1fr; \}/);
  assert.match(styles, /grid-template-columns:repeat\(4,1fr\)/);
  assert.doesNotMatch(styles, /\.video-heading-chip/);
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
  assert.match(searchStyles, /\.weapon-mini \.option-image \{ width:36px; height:36px;/);
  assert.match(searchStyles, /\.weapon-mini\.is-self \.option-image/);
  assert.doesNotMatch(searchStyles, /\.weapon-mini>span:last-child/);
  assert.match(searchStyles, /\.direct-stage-options \.option-label \{ font-size:11px; \}/);
  assert.match(searchStyles, /\.direct-rule-options \{ grid-template-columns:repeat\(3,minmax\(0,1fr\)\); \}/);
  assert.match(searchStyles, /\.direct-rule-options \.option-label \{ font-size:12px; \}/);
  assert.match(searchStyles, /env\(safe-area-inset-bottom\)/);
});
