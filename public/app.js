const elements = {
  recordingList: document.getElementById('recording-list'), recordingCount: document.getElementById('recording-count'),
  empty: document.getElementById('empty-state'), recordingView: document.getElementById('recording-view'), reviewView: document.getElementById('review-view'),
  selectedTitle: document.getElementById('selected-title'), selectedStatus: document.getElementById('selected-status'), selectedProgress: document.getElementById('selected-progress'),
  error: document.getElementById('recording-error'), matchList: document.getElementById('match-list'), video: document.getElementById('match-video'),
  matchTitle: document.getElementById('match-title'), eventList: document.getElementById('event-list'), eventCount: document.getElementById('event-count'),
  currentTime: document.getElementById('current-time'), duration: document.getElementById('duration'), seek: document.getElementById('seek'),
  timelineProgress: document.getElementById('timeline-progress'), timelineMarkers: document.getElementById('timeline-markers'),
  deathMarkers: document.getElementById('death-markers'), playerCountStatus: document.getElementById('player-count-status'),
  chartAdvantage: document.getElementById('chart-advantage'), chartGrid: document.getElementById('chart-grid'), chartSeries: document.getElementById('chart-series'), chartEvents: document.getElementById('chart-events'), chartCursor: document.getElementById('chart-cursor'),
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

const chartBounds = { left:22, right:978, top:40, bottom:220 };
function chartX(time) { return chartBounds.left+(time/currentAnalysis.media.duration)*(chartBounds.right-chartBounds.left); }
function countY(count) { return chartBounds.bottom-(Math.max(0,Math.min(4,count))/4)*(chartBounds.bottom-chartBounds.top); }
function svgElement(name,attributes={}) { const element=document.createElementNS('http://www.w3.org/2000/svg',name); Object.entries(attributes).forEach(([key,value])=>element.setAttribute(key,value)); return element; }
function countStepPath(counts,key) { if(!counts.length)return''; let path=`M ${chartX(counts[0].time)} ${countY(counts[0][key])}`; for(let index=1;index<counts.length;index+=1){const item=counts[index];path+=` H ${chartX(item.time)} V ${countY(item[key])}`;} return path; }
function playerCountAt(time) { const counts=currentAnalysis?.gameFlow?.playerCounts||[]; let result=null; for(const item of counts){if(item.time>time+0.5)break;result=item;} return result&&time-result.time<=1.5?result:null; }

function renderChart() {
  const duration=currentAnalysis.media.duration;
  const counts=currentAnalysis.gameFlow?.playerCounts||[];
  elements.chartAdvantage.innerHTML='';
  counts.forEach((item,index)=>{const next=counts[index+1];const end=next?.time??duration;if(end<=item.time)return;const rect=svgElement('rect',{x:chartX(item.time),y:chartBounds.top,width:Math.max(0,chartX(end)-chartX(item.time)),height:chartBounds.bottom-chartBounds.top,class:`chart-advantage ${item.difference>0?'positive':item.difference<0?'negative':'even'} ${item.source==='held'?'held':''}`});elements.chartAdvantage.append(rect);});
  elements.chartGrid.innerHTML='';
  for(let count=0;count<=4;count+=1){const y=countY(count);elements.chartGrid.append(svgElement('line',{x1:chartBounds.left,x2:chartBounds.right,y1:y,y2:y,class:'chart-grid'}));const label=svgElement('text',{x:chartBounds.left-7,y:y+5,'text-anchor':'end',class:'chart-text count-label'});label.textContent=count;elements.chartGrid.append(label);}
  for(let i=0;i<=6;i+=1){const time=duration*i/6;const x=chartX(time);const text=svgElement('text',{x,y:278,'text-anchor':i===0?'start':i===6?'end':'middle',class:'chart-text'});text.textContent=formatTime(time);elements.chartGrid.append(text);}
  const team=svgElement('path',{d:countStepPath(counts,'teamAlive'),class:'chart-team'});const enemy=svgElement('path',{d:countStepPath(counts,'enemyAlive'),class:'chart-enemy'});elements.chartSeries.replaceChildren(team,enemy);
  elements.chartEvents.innerHTML=''; currentAnalysis.events.forEach(event=>{const x=chartX(event.time);const line=svgElement('line',{x1:x,x2:x,y1:chartBounds.top,y2:chartBounds.bottom,class:event.type==='death'?'chart-death':'chart-event'});elements.chartEvents.append(line);});
}

function renderEvents() { elements.eventCount.textContent=`${currentAnalysis.events.length}件`; elements.eventList.replaceChildren(...currentAnalysis.events.map(event=>{const button=document.createElement('button');button.type='button';button.className=`event-item ${event.type}`;const time=document.createElement('span');time.className='event-time';time.textContent=formatTime(event.time);const copy=document.createElement('span');copy.className='event-copy';const title=document.createElement('strong');title.textContent=event.title;const detail=document.createElement('span');detail.textContent=`${event.detail}・確度 ${Math.round(event.confidence*100)}%`;copy.append(title,detail);button.append(time,copy);button.addEventListener('click',()=>{elements.video.currentTime=Math.max(0,event.time-(event.type==='death'?8:4));});return button;})); }

function renderCapabilities() { const names={segmentation:'試合分割',sceneAnalysis:'画面変化',deaths:'デス判定',playerCounts:'生存人数',playerRoute:'プレイヤー動線',gameCountOcr:'ゲームカウント'}; elements.capabilityList.replaceChildren(...Object.entries(currentAnalysis.capabilities).map(([key,value])=>{const row=document.createElement('div');row.className='capability';const name=document.createElement('strong');name.textContent=names[key]||key;const state=document.createElement('span');const available=!value.includes('not-yet');state.className=available?(value.includes('candidate')?'limited':'available'):'limited';state.textContent=available?(value.includes('candidate')?'候補検出':'利用可能'):'未対応';row.append(name,state);return row;})); }

async function openMatch(recording,match) { currentAnalysis=await (await fetch(match.analysisUrl)).json(); elements.recordingView.hidden=true;elements.reviewView.hidden=false;elements.matchTitle.textContent=`${recording.fileName} / 試合 ${String(match.number).padStart(2,'0')}`;elements.video.src=match.videoUrl;elements.seek.max=currentAnalysis.media.duration;elements.duration.textContent=formatTime(currentAnalysis.media.duration);elements.timelineMarkers.replaceChildren(...currentAnalysis.events.filter(event=>event.type!=='death').map(event=>{const marker=document.createElement('span');marker.className=`timeline-marker ${event.type}`;marker.style.left=`${event.time/currentAnalysis.media.duration*100}%`;return marker;}));elements.deathMarkers.replaceChildren(...currentAnalysis.events.filter(event=>event.type==='death').map(event=>{const marker=document.createElement('span');marker.className='death-track-marker';marker.style.left=`${event.time/currentAnalysis.media.duration*100}%`;return marker;}));renderChart();renderEvents();renderCapabilities();updatePlaybackUi(); }

function updatePlaybackUi(){if(!currentAnalysis)return;const time=elements.video.currentTime||0;const ratio=Math.max(0,Math.min(1,time/currentAnalysis.media.duration));elements.currentTime.textContent=formatTime(time);elements.seek.value=time;elements.timelineProgress.style.width=`${ratio*100}%`;const count=playerCountAt(time);if(count){const difference=count.difference>0?`${count.difference}枚有利`:count.difference<0?`${Math.abs(count.difference)}枚不利`:'同数';elements.playerCountStatus.textContent=`自軍 ${count.teamAlive} / 相手 ${count.enemyAlive}・${difference}`;}else{elements.playerCountStatus.textContent='人数: —';}elements.chartCursor.replaceChildren(svgElement('line',{x1:chartX(time),x2:chartX(time),y1:chartBounds.top,y2:chartBounds.bottom,class:'chart-cursor'}));}

async function refresh(){try{recordings=await(await fetch('/api/recordings')).json();renderRecordings();}catch(error){console.error(error);}}
function toggleVideoPlayback(){if(elements.video.paused)elements.video.play().catch(console.error);else elements.video.pause();}
elements.video.addEventListener('click',toggleVideoPlayback);elements.video.addEventListener('keydown',event=>{if(event.code==='Space'){event.preventDefault();toggleVideoPlayback();}});
elements.video.addEventListener('timeupdate',updatePlaybackUi);elements.seek.addEventListener('input',()=>{elements.video.currentTime=Number(elements.seek.value);updatePlaybackUi();});elements.chartHit.addEventListener('pointerdown',event=>{if(!currentAnalysis)return;const bounds=event.currentTarget.closest('svg').getBoundingClientRect();const plotLeft=bounds.left+bounds.width*(chartBounds.left/1000);const plotWidth=bounds.width*((chartBounds.right-chartBounds.left)/1000);elements.video.currentTime=Math.max(0,Math.min(1,(event.clientX-plotLeft)/plotWidth))*currentAnalysis.media.duration;updatePlaybackUi();});
document.getElementById('back-to-matches').addEventListener('click',()=>{currentAnalysis=null;elements.video.pause();elements.video.removeAttribute('src');elements.reviewView.hidden=true;renderSelected();});document.getElementById('scan-button').addEventListener('click',async()=>{await fetch('/api/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});await refresh();});
await refresh();setInterval(refresh,2000);
