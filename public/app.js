const elements = {
  recordingList: document.getElementById('recording-list'), recordingCount: document.getElementById('recording-count'),
  empty: document.getElementById('empty-state'), recordingView: document.getElementById('recording-view'), reviewView: document.getElementById('review-view'),
  selectedTitle: document.getElementById('selected-title'), selectedStatus: document.getElementById('selected-status'), selectedProgress: document.getElementById('selected-progress'),
  error: document.getElementById('recording-error'), matchList: document.getElementById('match-list'), video: document.getElementById('match-video'),
  matchTitle: document.getElementById('match-title'), eventList: document.getElementById('event-list'), eventCount: document.getElementById('event-count'),
  currentTime: document.getElementById('current-time'), duration: document.getElementById('duration'), seek: document.getElementById('seek'),
  timelineProgress: document.getElementById('timeline-progress'), timelineMarkers: document.getElementById('timeline-markers'),
  chartGrid: document.getElementById('chart-grid'), chartSeries: document.getElementById('chart-series'), chartEvents: document.getElementById('chart-events'), chartCursor: document.getElementById('chart-cursor'),
  capabilityList: document.getElementById('capability-list'), chartHit: document.getElementById('chart-hit'),
};

const labels = { queued:'待機中', probing:'確認中', splitting:'分割中', analyzing:'分析中', ready:'分析済み', error:'失敗' };
let recordings = [];
let selectedId = null;
let currentAnalysis = null;

function formatTime(value) { const seconds = Math.max(0, Math.round(Number(value)||0)); return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`; }
function formatSize(value) { return value >= 1e9 ? `${(value/1e9).toFixed(1)} GB` : `${(value/1e6).toFixed(0)} MB`; }

function recordingCard(recording) {
  const button = document.createElement('button'); button.type='button'; button.className=`recording-card${recording.id===selectedId?' is-selected':''}`;
  const top=document.createElement('div'); top.className='recording-card-top'; const title=document.createElement('strong'); title.textContent=recording.fileName;
  const badge=document.createElement('span'); badge.className=`status-badge ${recording.status}`; badge.textContent=labels[recording.status]||recording.status; top.append(title,badge);
  const detail=document.createElement('p'); detail.textContent=`${recording.phase}・${formatSize(recording.size)}${recording.matches?.length?`・${recording.matches.length}試合`:''}`;
  const track=document.createElement('div'); track.className='progress-track'; const fill=document.createElement('span'); fill.style.width=`${Math.round((recording.progress||0)*100)}%`; track.append(fill);
  button.append(top,detail,track); button.addEventListener('click',()=>selectRecording(recording.id)); return button;
}

function renderRecordings() {
  elements.recordingCount.textContent=`${recordings.length}件`; elements.recordingList.replaceChildren(...recordings.map(recordingCard));
  if (!selectedId && recordings.length) selectedId=(recordings.find(item=>item.status==='ready')||recordings[0]).id;
  if (selectedId && !currentAnalysis) renderSelected();
  elements.empty.hidden=recordings.length>0;
}

function selectRecording(id) { selectedId=id; currentAnalysis=null; elements.reviewView.hidden=true; renderRecordings(); renderSelected(); }

function matchCard(recording, match) {
  const card=document.createElement('article'); card.className='match-card'; const image=document.createElement('img'); image.alt=`試合${match.number}のサムネイル`; if(match.thumbnailUrl) image.src=match.thumbnailUrl;
  const body=document.createElement('div'); body.className='match-card-body'; const top=document.createElement('div'); top.className='match-card-top'; const title=document.createElement('h3'); title.textContent=`試合 ${String(match.number).padStart(2,'0')}`; const badge=document.createElement('span'); badge.className=`status-badge ${match.status==='ready'?'ready':''}`; badge.textContent=match.status==='ready'?'分析済み':'処理中'; top.append(title,badge);
  const detail=document.createElement('p'); detail.textContent=`${formatTime(match.duration)}・分析候補 ${match.eventCount||0}件`;
  const open=document.createElement('button'); open.type='button'; open.disabled=match.status!=='ready'; open.textContent=match.status==='ready'?'振り返りを開く':'分析を待っています'; open.addEventListener('click',()=>openMatch(recording,match));
  body.append(top,detail,open); card.append(image,body); return card;
}

function renderSelected() {
  const recording=recordings.find(item=>item.id===selectedId); if(!recording) return;
  elements.recordingView.hidden=false; elements.selectedTitle.textContent=recording.fileName; elements.selectedStatus.textContent=recording.phase; elements.selectedProgress.textContent=`${Math.round((recording.progress||0)*100)}%`;
  elements.error.hidden=!recording.error; elements.error.textContent=recording.error||''; elements.matchList.replaceChildren(...(recording.matches||[]).map(match=>matchCard(recording,match)));
  if(recording.status==='error') { const retry=document.createElement('button'); retry.type='button'; retry.textContent='再分析する'; retry.addEventListener('click',async()=>{await fetch(`/api/recordings/${encodeURIComponent(recording.id)}/retry`,{method:'POST'}); await refresh();}); elements.error.append(document.createElement('br'),retry); }
}

function pathFromSeries(series,key,maxValue) { if(!series.length)return''; return series.map((item,index)=>`${index?'L':'M'} ${(item.time/currentAnalysis.media.duration)*1000} ${205-(Math.min(maxValue,item[key])/maxValue)*175}`).join(' '); }

function renderChart() {
  const duration=currentAnalysis.media.duration; elements.chartGrid.innerHTML=''; for(let i=0;i<=4;i++){const y=30+i*43.75; const line=document.createElementNS('http://www.w3.org/2000/svg','line'); line.setAttribute('x1','0');line.setAttribute('x2','1000');line.setAttribute('y1',y);line.setAttribute('y2',y);line.setAttribute('class','chart-grid');elements.chartGrid.append(line);}
  for(let i=0;i<=6;i++){const x=i/6*1000;const text=document.createElementNS('http://www.w3.org/2000/svg','text');text.setAttribute('x',x);text.setAttribute('y','226');text.setAttribute('text-anchor',i===0?'start':i===6?'end':'middle');text.setAttribute('class','chart-text');text.textContent=formatTime(duration*i/6);elements.chartGrid.append(text);}
  const maxMotion=Math.max(20,...currentAnalysis.series.map(item=>item.motion)); const motion=document.createElementNS('http://www.w3.org/2000/svg','path');motion.setAttribute('d',pathFromSeries(currentAnalysis.series,'motion',maxMotion));motion.setAttribute('class','chart-motion'); const hud=document.createElementNS('http://www.w3.org/2000/svg','path');hud.setAttribute('d',pathFromSeries(currentAnalysis.series,'hud',1));hud.setAttribute('class','chart-hud');elements.chartSeries.replaceChildren(motion,hud);
  elements.chartEvents.innerHTML=''; currentAnalysis.events.forEach(event=>{const x=event.time/duration*1000;const line=document.createElementNS('http://www.w3.org/2000/svg','line');line.setAttribute('x1',x);line.setAttribute('x2',x);line.setAttribute('y1','24');line.setAttribute('y2','205');line.setAttribute('class','chart-event');elements.chartEvents.append(line);});
}

function renderEvents() { elements.eventCount.textContent=`${currentAnalysis.events.length}件`; elements.eventList.replaceChildren(...currentAnalysis.events.map(event=>{const button=document.createElement('button');button.type='button';button.className='event-item';const time=document.createElement('span');time.className='event-time';time.textContent=formatTime(event.time);const copy=document.createElement('span');copy.className='event-copy';const title=document.createElement('strong');title.textContent=event.title;const detail=document.createElement('span');detail.textContent=`${event.detail}・確度 ${Math.round(event.confidence*100)}%`;copy.append(title,detail);button.append(time,copy);button.addEventListener('click',()=>{elements.video.currentTime=Math.max(0,event.time-4);});return button;})); }

function renderCapabilities() { const names={segmentation:'試合分割',sceneAnalysis:'画面変化',deaths:'デス判定',playerRoute:'プレイヤー動線',gameCountOcr:'ゲームカウント'}; elements.capabilityList.replaceChildren(...Object.entries(currentAnalysis.capabilities).map(([key,value])=>{const row=document.createElement('div');row.className='capability';const name=document.createElement('strong');name.textContent=names[key]||key;const state=document.createElement('span');const available=!value.includes('not-yet');state.className=available?(value.includes('candidate')?'limited':'available'):'limited';state.textContent=available?(value.includes('candidate')?'候補検出':'利用可能'):'未対応';row.append(name,state);return row;})); }

async function openMatch(recording,match) { currentAnalysis=await (await fetch(match.analysisUrl)).json(); elements.recordingView.hidden=true;elements.reviewView.hidden=false;elements.matchTitle.textContent=`${recording.fileName} / 試合 ${String(match.number).padStart(2,'0')}`;elements.video.src=match.videoUrl;elements.seek.max=currentAnalysis.media.duration;elements.duration.textContent=formatTime(currentAnalysis.media.duration);elements.timelineMarkers.replaceChildren(...currentAnalysis.events.map(event=>{const marker=document.createElement('span');marker.className='timeline-marker';marker.style.left=`${event.time/currentAnalysis.media.duration*100}%`;return marker;}));renderChart();renderEvents();renderCapabilities();updatePlaybackUi(); }

function updatePlaybackUi(){if(!currentAnalysis)return;const time=elements.video.currentTime||0;const ratio=Math.max(0,Math.min(1,time/currentAnalysis.media.duration));elements.currentTime.textContent=formatTime(time);elements.seek.value=time;elements.timelineProgress.style.width=`${ratio*100}%`;elements.chartCursor.innerHTML='';const line=document.createElementNS('http://www.w3.org/2000/svg','line');line.setAttribute('x1',ratio*1000);line.setAttribute('x2',ratio*1000);line.setAttribute('y1','24');line.setAttribute('y2','205');line.setAttribute('class','chart-cursor');elements.chartCursor.append(line);}

async function refresh(){try{recordings=await(await fetch('/api/recordings')).json();renderRecordings();}catch(error){console.error(error);}}
elements.video.addEventListener('timeupdate',updatePlaybackUi);elements.seek.addEventListener('input',()=>{elements.video.currentTime=Number(elements.seek.value);updatePlaybackUi();});elements.chartHit.addEventListener('pointerdown',event=>{if(!currentAnalysis)return;const bounds=event.currentTarget.closest('svg').getBoundingClientRect();elements.video.currentTime=Math.max(0,Math.min(1,(event.clientX-bounds.left)/bounds.width))*currentAnalysis.media.duration;updatePlaybackUi();});
document.getElementById('back-to-matches').addEventListener('click',()=>{currentAnalysis=null;elements.video.pause();elements.video.removeAttribute('src');elements.reviewView.hidden=true;renderSelected();});document.getElementById('scan-button').addEventListener('click',async()=>{await fetch('/api/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});await refresh();});
await refresh();setInterval(refresh,2000);
