import { formatReportTime, nearestClipIndex, nextClipIndex, patternReportModels } from './report-player.js';

const byId = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const analysisUrl = params.get('analysis') || '';
const videoUrl = params.get('video') || '';
const reportTitle = params.get('title') || '試合分析';

function validLocalUrl(value, prefix) {
  return value.startsWith(prefix) && !value.includes('\\') && !value.includes('..');
}

function node(name, className, text) {
  const element = document.createElement(name);
  if (className) element.className = className;
  if (text != null) element.textContent = text;
  return element;
}

function flowItem(label, value, tone) {
  const item = node('div', `pattern-flow-item ${tone}`);
  item.append(node('span', '', label), node('p', '', value));
  return item;
}

function createPatternPlayer(pattern, analysis, sourceUrl) {
  const duration = Number(analysis.media?.duration) || 1;
  const clips = pattern.resolvedClips;
  const card = node('article', 'pattern-report-card');
  const heading = node('header', 'pattern-report-heading');
  const titleGroup = node('div');
  titleGroup.append(node('p', 'eyebrow', `PATTERN ${String(pattern.reportIndex).padStart(2, '0')}`), node('h2', '', pattern.title));
  heading.append(titleGroup, node('span', 'pattern-evidence-count', `根拠 ${clips.length}シーン`));

  const content = node('div', 'pattern-report-content');
  const copy = node('section', 'pattern-report-copy');
  copy.append(node('p', 'pattern-summary', pattern.summary));
  const flow = node('div', 'pattern-flow');
  flow.append(flowItem('きっかけ', pattern.trigger, 'trigger'), flowItem('繰り返した行動', pattern.repeatedAction, 'action'), flowItem('結果', pattern.consequence, 'consequence'));
  const focus = node('div', 'pattern-review-focus');
  focus.append(node('strong', '', '映像で確認するポイント'), node('p', '', pattern.reviewFocus));
  copy.append(flow, focus);

  const player = node('section', 'report-player');
  const playerTop = node('div', 'report-player-top');
  const modes = node('div', 'report-mode-switch');
  const clipMode = node('button', 'active', 'クリップループ'); clipMode.type = 'button';
  const normalMode = node('button', '', '通常再生'); normalMode.type = 'button';
  modes.append(clipMode, normalMode);
  const clipState = node('span', 'report-clip-state', clips.length ? `1 / ${clips.length}` : '範囲なし');
  playerTop.append(modes, clipState);

  const videoShell = node('div', 'report-video-shell');
  const video = document.createElement('video'); video.preload = 'metadata'; video.playsInline = true; video.src = sourceUrl;
  const fade = node('div', 'report-video-fade');
  const activeLabel = node('div', 'report-active-clip');
  videoShell.append(video, fade, activeLabel);

  const controls = node('div', 'report-player-controls');
  const play = node('button', 'report-play', '▶ 再生'); play.type = 'button';
  const time = node('span', 'report-time', `00:00 / ${formatReportTime(duration)}`);
  const mute = node('button', 'report-mute', '音声オン'); mute.type = 'button';
  controls.append(play, time, mute);

  const timeline = node('div', 'report-timeline');
  const progress = node('span', 'report-timeline-progress');
  const ranges = node('div', 'report-clip-ranges');
  const seek = document.createElement('input'); seek.type = 'range'; seek.min = '0'; seek.max = String(duration); seek.step = '0.1'; seek.value = '0'; seek.setAttribute('aria-label', `${pattern.title}の再生位置`);
  clips.forEach((clip, index) => {
    const marker = node('button', 'report-clip-range'); marker.type = 'button'; marker.dataset.clipIndex = String(index); marker.title = `${clip.label} ${formatReportTime(clip.start)}–${formatReportTime(clip.end)}`;
    marker.style.left = `${clip.start / duration * 100}%`; marker.style.width = `${Math.max(.8, (clip.end - clip.start) / duration * 100)}%`;
    ranges.append(marker);
  });
  timeline.append(progress, ranges, seek);

  const clipList = node('div', 'report-clip-list');
  clips.forEach((clip, index) => {
    const button = node('button', 'report-clip-button'); button.type = 'button'; button.dataset.clipIndex = String(index);
    button.append(node('strong', '', clip.label), node('span', '', `${formatReportTime(clip.start)}–${formatReportTime(clip.end)}`), node('small', '', clip.reason));
    clipList.append(button);
  });
  player.append(playerTop, videoShell, controls, timeline, clipList);
  content.append(copy, player); card.append(heading, content);

  let mode = clips.length ? 'clips' : 'normal';
  let activeIndex = clips.length ? 0 : -1;
  let switching = false;

  const updateActiveUi = () => {
    [...ranges.children].forEach((marker, index) => marker.classList.toggle('active', index === activeIndex));
    [...clipList.children].forEach((button, index) => button.classList.toggle('active', index === activeIndex));
    const clip = clips[activeIndex];
    activeLabel.textContent = clip ? `${clip.label}｜${formatReportTime(clip.start)}–${formatReportTime(clip.end)}` : '通常再生';
    clipState.textContent = clip ? `${activeIndex + 1} / ${clips.length}` : '通常再生';
  };
  const activateClip = (index, { autoplay = !video.paused, fadeTransition = true } = {}) => {
    if (!clips.length || switching) return;
    activeIndex = (index + clips.length) % clips.length; updateActiveUi();
    const move = () => { video.currentTime = clips[activeIndex].start; if (autoplay) video.play().catch(() => {}); };
    if (!fadeTransition) { move(); return; }
    switching = true; videoShell.classList.add('switching');
    setTimeout(() => { move(); setTimeout(() => { videoShell.classList.remove('switching'); switching = false; }, 180); }, 180);
  };
  const setMode = next => {
    mode = next; clipMode.classList.toggle('active', mode === 'clips'); normalMode.classList.toggle('active', mode === 'normal');
    if (mode === 'clips') activateClip(nearestClipIndex(clips, video.currentTime), { autoplay: !video.paused });
    else { activeIndex = -1; updateActiveUi(); }
  };

  clipMode.disabled = !clips.length;
  clipMode.addEventListener('click', () => setMode('clips'));
  normalMode.addEventListener('click', () => setMode('normal'));
  play.addEventListener('click', () => video.paused ? video.play().catch(() => {}) : video.pause());
  video.addEventListener('click', () => video.paused ? video.play().catch(() => {}) : video.pause());
  mute.addEventListener('click', () => { video.muted = !video.muted; mute.textContent = video.muted ? 'ミュート中' : '音声オン'; });
  [...clipList.children, ...ranges.children].forEach(button => button.addEventListener('click', () => {
    const index = Number(button.dataset.clipIndex); if (mode === 'clips') activateClip(index); else { activeIndex = index; updateActiveUi(); video.currentTime = clips[index].start; }
  }));
  seek.addEventListener('input', () => {
    const requested = Number(seek.value);
    if (mode === 'clips') activateClip(nearestClipIndex(clips, requested), { autoplay: false, fadeTransition: false });
    else video.currentTime = requested;
  });
  video.addEventListener('loadedmetadata', () => { if (mode === 'clips') activateClip(0, { autoplay: false, fadeTransition: false }); });
  video.addEventListener('play', () => { play.textContent = '❚❚ 一時停止'; });
  video.addEventListener('pause', () => { play.textContent = '▶ 再生'; });
  video.addEventListener('timeupdate', () => {
    const current = video.currentTime || 0; seek.value = String(current); progress.style.width = `${current / duration * 100}%`; time.textContent = `${formatReportTime(current)} / ${formatReportTime(duration)}`;
    if (mode === 'clips' && activeIndex >= 0 && !switching && current >= clips[activeIndex].end - .05) activateClip(nextClipIndex(activeIndex, clips.length), { autoplay: !video.paused });
  });
  updateActiveUi();
  return card;
}

async function loadReport() {
  byId('report-title').textContent = reportTitle;
  const validVideo = validLocalUrl(videoUrl, '/media/matches/') || validLocalUrl(videoUrl, '/media/remote-matches/');
  if (!validLocalUrl(analysisUrl, '/api/analysis/') || !validVideo) throw new Error('分析データのURLが不正です');
  const response = await fetch(analysisUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error('分析データを読み込めませんでした');
  const analysis = await response.json(), patterns = patternReportModels(analysis);
  byId('report-summary').textContent = analysis.deathAnalysis?.overallSummary || 'AIによる全体分析はまだ実行されていません。';
  byId('report-meta').textContent = `${patterns.length}パターン・デス ${(analysis.events || []).filter(event => event.type === 'death').length}件`;
  if (!patterns.length) { byId('report-empty').hidden = false; return; }
  byId('pattern-reports').replaceChildren(...patterns.map(pattern => createPatternPlayer(pattern, analysis, videoUrl)));
}

loadReport().catch(error => { byId('report-summary').textContent = error.message; byId('report-empty').hidden = false; });
