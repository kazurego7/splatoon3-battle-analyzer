import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const publicRoot = new URL('../public/', import.meta.url);

test('試合動画の拡大画面にPC用グラフ・デス一覧と縮小操作がある', async () => {
  const [html, script, styles] = await Promise.all([
    fs.readFile(new URL('index.html', publicRoot), 'utf8'),
    fs.readFile(new URL('app.js', publicRoot), 'utf8'),
    fs.readFile(new URL('styles.css', publicRoot), 'utf8'),
  ]);

  for (const id of ['video-expand-button', 'video-review-controls', 'video-collapse-button', 'mobile-skip-back-button', 'mobile-playback-button', 'mobile-skip-forward-button', 'expanded-death-list']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const id of ['mobile-video-expand-button', 'mobile-death-list-button', 'mobile-death-list-close-button']) assert.match(html,new RegExp(`id="${id}"`));
  assert.match(html, /maximum-scale=1, user-scalable=no/);
  assert.match(html, /class="video-shell"[\s\S]*id="mobile-video-expand-button"[\s\S]*class="mobile-playback-controls"/);
  assert.match(html, /class="expanded-bottom-hotspot"/);
  assert.match(html, /class="expanded-death-hotspot"/);
  assert.match(html, /class="expanded-death-panel" aria-label="デス一覧"/);
  assert.doesNotMatch(html, /id="game-count-status"|id="player-count-status"/);
  assert.doesNotMatch(html, /<button id="video-expand-button"[^>]*>[\s\S]*?\b拡大\b[\s\S]*?<\/button>/);
  assert.doesNotMatch(html, /<button id="video-collapse-button"[^>]*>[\s\S]*?\b縮小\b[\s\S]*?<\/button>/);
  assert.match(html, /class="death-digest-help"[^>]*aria-describedby="death-digest-help-tooltip"/);
  assert.match(html, /class="death-digest-help-tooltip" role="tooltip"/);
  assert.match(html, /data-review-tab="death"[^>]*><span>◈<\/span>分析<\/button>/);
  assert.match(html, /id="mobile-analysis-report"[^>]*aria-label="俯瞰レポート"/);
  assert.doesNotMatch(html.match(/<aside class="expanded-death-panel"[\s\S]*?<\/aside>/)?.[0] ?? '', /death-report-digest|レポートダイジェスト/);

  assert.match(script, /function expandVideo\(\)/);
  assert.match(script, /function expandVideoFromButton\(\)/);
  assert.match(script, /is-preparing-video-expand/);
  assert.match(script, /function collapseVideo\(\)/);
  assert.match(script, /requestFullscreen/);
  assert.match(script, /function syncChartViewport\(\)/);
  assert.match(script, /rect\.width\/rect\.height\*chartHeight/);
  assert.match(script, /chartBounds\.left\/chartBounds\.width/);
  assert.match(script, /setPointerCapture\?\.\(event\.pointerId\)/);
  assert.match(script, /chartSeekPointerId===event\.pointerId/);
  assert.match(script, /function handleExpandedVideoPointerMove\(event\)/);
  assert.match(script, /function setMobileReviewTab\(tab='video'\)/);
  assert.match(script, /setMobileReviewTab\(button\.dataset\.reviewTab\)/);
  assert.match(script, /mobile-death-list-open/);
  assert.match(script, /selectDeathEvent[\s\S]*classList\.remove\('mobile-death-list-open'\)/);
  assert.match(script, /function renderMobileAnalysisReport\(\)/);
  assert.match(script, /patternReportModels\(currentAnalysis\)/);
  assert.match(script, /mobile-report-clip[\s\S]*setMobileReviewTab\('video'\)/);
  assert.match(script, /mobile-report-video-shell/);
  assert.match(script, /reportVideo\.currentTime=clip\.start/);
  assert.match(script, /reportVideo\.currentTime>=activeClip\.end/);
  assert.doesNotMatch(script, /mobile-report-active-clip/);
  assert.match(script, /left:width\*\.034,right:width\*\.978/);
  assert.match(script, /overlayCountLabels\?chartBounds\.left\+6:chartBounds\.left-8/);
  assert.match(script, /elements\.chartLabels\.append\(label\)/);
  assert.match(html, /id="chart-count-series"[\s\S]*id="chart-deaths"[\s\S]*id="chart-labels" pointer-events="none"[\s\S]*id="chart-hit"/);
  assert.match(script, /countTop:mobile\?38:34,countBottom:mobile\?218:176,labelY:mobile\?243:203,hoverTop:mobile\?0:218/);
  assert.match(script, /labelHeight=largeMobileLabel\?28:24,labelY=largeMobileLabel\?19:16/);
  assert.doesNotMatch(script, /chartBounds\.left\/1000/);
  assert.match(script, /expandedDeathList\.replaceChildren/);
  assert.match(script, /deathSeekTime\(event,-8,currentAnalysis\.media\.duration\)/);
  assert.match(script, /doubleTap=now-lastMobileTapAt<320/);
  assert.match(script, /seekBySeconds\(side\*10\)/);
  assert.match(script, /mobileSkipBackButton\.addEventListener/);
  assert.match(script, /mobileSkipForwardButton\.addEventListener/);
  assert.match(script, /matchMedia\('\(orientation: landscape\)'\)/);
  assert.match(script, /function syncExpandedVideoToOrientation\(\)/);
  assert.match(script, /landscapeOrientation\.matches\)await expandVideo\(\)/);
  assert.match(script, /if\(elements\.videoPanel\.classList\.contains\('is-expanded'\)\)await collapseVideo\(\)/);
  assert.match(script, /function settleReviewLayoutAfterOrientation\(\)/);
  assert.match(script, /renderMatchResult\(\);void elements\.resultAllies\.offsetWidth/);
  assert.match(script, /reviewOrientationRecoveryUntil=performance\.now\(\)\+1600/);
  assert.match(script, /visualViewport\?\.addEventListener\('resize',handleReviewViewportResize\)/);
  assert.doesNotMatch(script, /screen\.orientation\?\.lock/);
  assert.match(styles, /\.video-panel\.is-expanded \.expanded-bottom-hotspot:hover \+ \.video-review-controls/);
  assert.match(styles, /\.video-panel\.is-expanded \.expanded-death-hotspot:hover \+ \.expanded-death-panel/);
  assert.match(styles, /\.video-panel\.is-expanded #analysis-chart \{ width:100%; height:min\(29vh,320px\); max-height:none; \}/);
});

test('スマホ拡大画面は横向きでタップ時にシークと縮小だけを表示する', async () => {
  const [html, script, styles] = await Promise.all([
    fs.readFile(new URL('index.html', publicRoot), 'utf8'),
    fs.readFile(new URL('app.js', publicRoot), 'utf8'),
    fs.readFile(new URL('styles.css', publicRoot), 'utf8'),
  ]);

  assert.match(script, /isMobileVideoExperience\(\)/);
  assert.match(script, /expanded-controls-visible/);
  assert.match(script, /if\(!mobile&&!document\.fullscreenElement/);
  assert.match(styles, /@media \(orientation:portrait\)/);
  assert.match(styles, /rotate\(90deg\)/);
  assert.match(styles, /is-mobile-expanded \.expanded-death-hotspot[^}]*display:none/);
  assert.match(styles, /is-mobile-expanded \.timeline-status \{ grid-column:1; grid-row:1/);
  assert.match(styles, /is-mobile-expanded \.mobile-playback-controls \{ position:absolute;[^}]*top:50%; left:50%;/);
  assert.match(styles, /expanded-controls-visible \.mobile-playback-controls \{ opacity:1;/);
  assert.match(styles, /mobile-playback-controls \{ position:absolute;[^}]*display:flex; align-items:center;/);
  assert.match(styles, /#mobile-playback-button \{ width:72px; height:72px;/);
  assert.match(styles, /is-mobile-expanded \.timeline-status strong \{ font-size:14px;/);
  assert.match(styles, /timeline-status #current-time \{ font-size:14px; line-height:1;/);
  assert.match(styles, /timeline-status #duration \{ font-size:10px; line-height:1;/);
  assert.match(styles, /video-panel:not\(\.is-expanded\) #analysis-chart \{ height:clamp\(116px,33vw,132px\);/);
  assert.match(styles, /#analysis-chart \{[^}]*user-select:none;[^}]*touch-action:none;/);
  assert.match(styles, /\.chart-count-label \{[^}]*paint-order:stroke;/);
  assert.match(styles, /\.mobile-review-nav \{ position:fixed;[^}]*bottom:0;/);
  assert.match(styles, /data-mobile-tab="video"\] \.video-panel \{ display:flex!important;/);
  assert.match(styles, /data-mobile-tab="death"\] #event-list \{ display:none; \}/);
  assert.match(styles, /\.mobile-analysis-report:not\(\[hidden\]\) \{ display:grid;/);
  assert.match(styles, /\.mobile-review-nav button > span \{ font-size:17px;/);
  assert.match(styles, /\.chart-cursor-label \{ font-size:14px;/);
  assert.match(styles, /\.chart-text \{ font-size:14px;/);
  assert.match(styles, /mobile-death-list-open \.expanded-death-panel/);
  assert.match(styles, /body\.is-review \{ height:100dvh; overflow:hidden; touch-action:pan-x pan-y; \}/);
  assert.match(styles, /\.mobile-video-expand-button \{ position:absolute;[^}]*right:8px; bottom:8px;/);
  assert.match(script, /width=fittedWidth/);
  assert.match(styles, /\.video-panel \.chart-legend \{ flex-wrap:wrap;[^}]*overflow:visible;/);
  assert.match(styles, /@media \(min-width:701px\) \{[\s\S]*\.mobile-death-list-button\.video-icon-button,[\s\S]*\.mobile-video-expand-button\.video-icon-button \{ display:none; \}/);
  assert.match(html, /preserveAspectRatio="xMidYMid meet"/);
  assert.match(styles, /is-mobile-expanded #analysis-chart[^}]*display:none/);
  assert.match(styles, /is-mobile-expanded \.chart-legend[^}]*display:none/);
  assert.match(styles, /is-mobile-expanded \.video-collapse-button/);
});

test('PWAはオンライン時に更新済み画面資産を優先する', async () => {
  const [html, worker] = await Promise.all([
    fs.readFile(new URL('index.html', publicRoot), 'utf8'),
    fs.readFile(new URL('sw.js', publicRoot), 'utf8'),
  ]);

  assert.match(html, /styles\.css\?v=\d+/);
  assert.match(html, /app\.js\?v=\d+/);
  assert.match(worker, /battle-review-shell-v3/);
  assert.match(worker, /fetch\(event\.request\)[\s\S]*cache\.put\(event\.request, response\.clone\(\)\)[\s\S]*catch\(\(\) => caches\.match\(event\.request\)\)/);
});
