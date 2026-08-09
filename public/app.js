const byId = id => document.getElementById(id);
const elements = {
  recordingList:byId('recording-list'), recordingCount:byId('recording-count'), empty:byId('empty-state'), recordingView:byId('recording-view'), reviewView:byId('review-view'),
  selectedTitle:byId('selected-title'), selectedStatus:byId('selected-status'), selectedProgress:byId('selected-progress'), error:byId('recording-error'), matchList:byId('match-list'),
  video:byId('match-video'), matchTitle:byId('match-title'), eventList:byId('event-list'), eventCount:byId('event-count'), currentTime:byId('current-time'), duration:byId('duration'), seek:byId('seek'),
  timelineProgress:byId('timeline-progress'), timelineMarkers:byId('timeline-markers'), deathMarkers:byId('death-markers'), playerCountStatus:byId('player-count-status'), gameCountStatus:byId('game-count-status'),
  chartAdvantage:byId('chart-advantage'), chartGrid:byId('chart-grid'), chartCountSeries:byId('chart-count-series'), chartSeries:byId('chart-series'), chartEvents:byId('chart-events'), chartCursor:byId('chart-cursor'), chartHit:byId('chart-hit'),
  capabilityList:byId('capability-list'), stageMapImage:byId('stage-map-image'), mapPlaceholder:byId('map-placeholder'), mapSourceStatus:byId('map-source-status'), mapClock:byId('map-clock'), routeLayer:byId('route-layer'), entityLayer:byId('entity-layer'), playerLayer:byId('player-layer'),
  videoDetections:byId('video-detections'), perceptionState:byId('perception-state'), menuButton:byId('menu-button'), menuScrim:byId('menu-scrim'),
};

const labels = { queued:'待機中', probing:'確認中', splitting:'分割中', analyzing:'分析中', ready:'分析済み', error:'失敗' };
const chartBounds = { left:34, right:978, countTop:25, countBottom:110, labelY:140 };
let recordings = [];
let selectedId = null;
let currentAnalysis = null;

function formatTime(value) { const seconds=Math.max(0,Math.round(Number(value)||0)); return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`; }
function formatSize(value) { return value>=1e9?`${(value/1e9).toFixed(1)} GB`:`${(value/1e6).toFixed(0)} MB`; }
function svgElement(name,attributes={}) { const element=document.createElementNS('http://www.w3.org/2000/svg',name); Object.entries(attributes).forEach(([key,value])=>element.setAttribute(key,value)); return element; }
function setReviewMode(active) { document.body.classList.toggle('is-review',active); if(!active) closeMenu(); }
function closeMenu() { document.body.classList.remove('menu-open'); elements.menuButton.setAttribute('aria-expanded','false'); }

function recordingCard(recording) {
  const button=document.createElement('button'); button.type='button'; button.className=`recording-card${recording.id===selectedId?' is-selected':''}`;
  const top=document.createElement('div'); top.className='recording-card-top'; const title=document.createElement('strong'); title.textContent=recording.fileName;
  const badge=document.createElement('span'); badge.className=`status-badge ${recording.status}`; badge.textContent=labels[recording.status]||recording.status; top.append(title,badge);
  const detail=document.createElement('p'); detail.textContent=`${recording.phase}・${formatSize(recording.size)}${recording.matches?.length?`・${recording.matches.length}試合`:''}`;
  const track=document.createElement('div'); track.className='progress-track'; const fill=document.createElement('span'); fill.style.width=`${Math.round((recording.progress||0)*100)}%`; track.append(fill);
  button.append(top,detail,track); button.addEventListener('click',()=>selectRecording(recording.id)); return button;
}

function renderRecordings() {
  if(!selectedId&&recordings.length) selectedId=(recordings.find(item=>item.status==='ready')||recordings[0]).id;
  elements.recordingCount.textContent=`${recordings.length}件`; elements.recordingList.replaceChildren(...recordings.map(recordingCard));
  if(selectedId&&!currentAnalysis) renderSelected(); elements.empty.hidden=recordings.length>0;
}

function selectRecording(id) { selectedId=id; currentAnalysis=null; elements.video.pause(); elements.video.removeAttribute('src'); elements.reviewView.hidden=true; setReviewMode(false); renderRecordings(); renderSelected(); }

function matchCard(recording,match) {
  const card=document.createElement('article'); card.className='match-card'; const image=document.createElement('img'); image.alt=`試合${match.number}のサムネイル`; if(match.thumbnailUrl) image.src=match.thumbnailUrl;
  const body=document.createElement('div'); body.className='match-card-body'; const top=document.createElement('div'); top.className='match-card-top'; const title=document.createElement('h3'); title.textContent=`試合 ${String(match.number).padStart(2,'0')}`;
  const badge=document.createElement('span'); badge.className=`status-badge ${match.status==='ready'?'ready':''}`; badge.textContent=match.status==='ready'?'分析済み':'処理中'; top.append(title,badge);
  const detail=document.createElement('p'); detail.textContent=`${formatTime(match.duration)}・分析候補 ${match.eventCount||0}件`;
  const open=document.createElement('button'); open.type='button'; open.disabled=match.status!=='ready'; open.textContent=match.status==='ready'?'振り返りを開く':'分析を待っています'; open.addEventListener('click',()=>openMatch(recording,match));
  body.append(top,detail,open); card.append(image,body); return card;
}

function renderSelected() {
  const recording=recordings.find(item=>item.id===selectedId); if(!recording)return;
  elements.recordingView.hidden=false; elements.selectedTitle.textContent=recording.fileName; elements.selectedStatus.textContent=recording.phase; elements.selectedProgress.textContent=`${Math.round((recording.progress||0)*100)}%`;
  elements.error.hidden=!recording.error; elements.error.textContent=recording.error||''; elements.matchList.replaceChildren(...(recording.matches||[]).map(match=>matchCard(recording,match)));
  if(recording.status==='error'){const retry=document.createElement('button');retry.type='button';retry.textContent='再分析する';retry.addEventListener('click',async()=>{await fetch(`/api/recordings/${encodeURIComponent(recording.id)}/retry`,{method:'POST'});await refresh();});elements.error.append(document.createElement('br'),retry);}
}

function chartX(time) { return chartBounds.left+(time/currentAnalysis.media.duration)*(chartBounds.right-chartBounds.left); }
function gameY(count) { return chartBounds.countTop+((100-Math.max(0,Math.min(100,count)))/100)*(chartBounds.countBottom-chartBounds.countTop); }
function stepPath(points,key,yScale) { if(!points.length)return'';let path=`M ${chartX(points[0].time)} ${yScale(points[0][key])}`;for(let index=1;index<points.length;index+=1){const item=points[index];path+=` H ${chartX(item.time)} V ${yScale(item[key])}`;}return path; }
function stateAt(points,time,maxAge=2) { let result=null;for(const item of points){if(item.time>time+.5)break;result=item;}return result&&time-result.time<=maxAge?result:null; }
function playerCountAt(time) { return stateAt(currentAnalysis?.gameFlow?.playerCounts||[],time,1.5); }
function gameCountAt(time) { return stateAt(currentAnalysis?.gameFlow?.gameCounts||[],time,3); }

function addChartLabel(text,x,y,anchor='end',className='chart-text') { const label=svgElement('text',{x,y,'text-anchor':anchor,class:className});label.textContent=text;elements.chartGrid.append(label); }
function renderChart() {
  const duration=currentAnalysis.media.duration; const alive=currentAnalysis.gameFlow?.playerCounts||[]; const game=currentAnalysis.gameFlow?.gameCounts||[];
  elements.chartAdvantage.innerHTML=''; alive.forEach((item,index)=>{const end=alive[index+1]?.time??duration;if(end<=item.time)return;const difference=Math.max(-4,Math.min(4,item.difference||0)),strength=difference===0?.035:(.1+Math.abs(difference)*.11)*(item.source==='held'?.55:1);elements.chartAdvantage.append(svgElement('rect',{x:chartX(item.time),y:chartBounds.countTop,width:Math.max(0,chartX(end)-chartX(item.time)),height:chartBounds.countBottom-chartBounds.countTop,'fill-opacity':Number(strength.toFixed(3)),class:`chart-advantage ${difference>0?'positive':difference<0?'negative':'even'}`}));});
  elements.chartGrid.innerHTML='';
  [100,75,50,25,0].forEach(count=>{const y=gameY(count);elements.chartGrid.append(svgElement('line',{x1:chartBounds.left,x2:chartBounds.right,y1:y,y2:y,class:'chart-grid'}));addChartLabel(count,chartBounds.left-8,y+5);});
  addChartLabel('カウント（背景＝人数差）',chartBounds.left,18,'start','chart-text axis-title');
  for(let index=0;index<=6;index+=1){const time=duration*index/6;addChartLabel(formatTime(time),chartX(time),chartBounds.labelY,index===0?'start':index===6?'end':'middle');}
  elements.chartCountSeries.replaceChildren(svgElement('path',{d:stepPath(game,'teamCount',gameY),class:'chart-count-team'}),svgElement('path',{d:stepPath(game,'enemyCount',gameY),class:'chart-count-enemy'}));
  elements.chartSeries.innerHTML='';
  elements.chartEvents.innerHTML='';currentAnalysis.events.filter(event=>event.type!=='death').forEach(event=>{const x=chartX(event.time);elements.chartEvents.append(svgElement('line',{x1:x,x2:x,y1:chartBounds.countTop,y2:chartBounds.countBottom,class:'chart-event'}));});
}

function spatialPoint(point) { return Array.isArray(point)?{time:point[0],values:point.slice(1),source:point.source||null,confidence:point.confidence??null}:{time:point.time,values:[point.x,point.y],source:point.source||null,confidence:point.confidence??null}; }
function interpolate(points,time) { if(!points?.length)return null;const normalized=points.map(spatialPoint);if(time<=normalized[0].time)return normalized[0].values;if(time>=normalized.at(-1).time)return normalized.at(-1).values;const index=normalized.findIndex(point=>point.time>=time);const left=normalized[index-1],right=normalized[index],ratio=(time-left.time)/(right.time-left.time);return left.values.map((value,i)=>typeof value==='number'&&typeof right.values[i]==='number'?value+(right.values[i]-value)*ratio:value); }

function renderMapBase() {
  const map=currentAnalysis.stageMap;
  elements.routeLayer.innerHTML=''; elements.entityLayer.innerHTML=''; elements.playerLayer.innerHTML='';
  if(map?.imageUrl){elements.stageMapImage.src=map.imageUrl;elements.stageMapImage.hidden=false;elements.mapPlaceholder.hidden=true;elements.mapSourceStatus.textContent=map.stage?`${map.stage}｜${map.rule}`:`映像 ${formatTime(map.observedAt)} で観測`;}else{elements.stageMapImage.hidden=true;elements.mapPlaceholder.hidden=false;elements.mapSourceStatus.textContent='マップ未検出';}
  const route=currentAnalysis.route||currentAnalysis.playerRoute||[];
  route.slice(0,-1).forEach((point,index)=>{const next=route[index+1],source=point.source||next.source||'';const line=svgElement('line',{x1:point[1]??point.x,y1:point[2]??point.y,x2:next[1]??next.x,y2:next[2]??next.y,class:`route-segment ${source==='observed'?'observed':'inferred'}`});line.dataset.time=point[0]??point.time;elements.routeLayer.append(line);});
  for(const observation of currentAnalysis.spatial?.observations||[]){const marker=svgElement('circle',{cx:observation.x,cy:observation.y,r:11,class:'route-observation'});marker.dataset.time=observation.time;elements.routeLayer.append(marker);}
}

function renderVideoDetections(time) {
  const detections=(currentAnalysis.detections||[]).filter(item=>time>=item.frames?.[0]?.[0]&&time<=item.frames?.at(-1)?.[0]); elements.videoDetections.innerHTML='';
  detections.forEach(item=>{const values=interpolate(item.frames,time);if(!values)return;const [x,y,width,height]=values;const normalized=x<=1&&y<=1;const px=normalized?x*1920:x,py=normalized?y*1080:y,pw=normalized?width*1920:width,ph=normalized?height*1080:height;const group=svgElement('g');const candidate=item.kind?.endsWith('-candidate');group.append(svgElement('rect',{x:px,y:py,width:pw,height:ph,rx:8,class:`detection-box ${item.team} ${candidate?'candidate':''}`}));const text=item.kind==='death-camera-focus-candidate'?'敵候補｜デスカメラ':item.kind==='enemy-color-motion-candidate'?'敵候補｜色・動き':`${item.team==='enemy'?'敵':'味方'}｜${item.weapon||'ブキ未特定'}`;group.append(svgElement('rect',{x:px,y:Math.max(0,py-38),width:Math.max(170,text.length*28),height:38,rx:6,class:'detection-label-bg'}));const label=svgElement('text',{x:px+10,y:Math.max(27,py-11),class:'detection-label'});label.textContent=text;group.append(label);elements.videoDetections.append(group);});
  elements.perceptionState.textContent=detections.length?detections.some(item=>item.kind==='enemy-color-motion-candidate')?'映像の色と動きから敵候補を予測':detections.some(item=>item.kind==='death-camera-focus-candidate')?'デスカメラで敵候補を確認':`映像で敵味方 ${detections.length}件を観測`:'映像内の認識情報のみ表示';
}

function renderSpatialState(time) {
  const route=currentAnalysis.route||currentAnalysis.playerRoute||[]; [...elements.routeLayer.children].forEach(item=>{const distance=Math.abs(Number(item.dataset.time)-time);item.style.opacity=distance<=12?.95:distance<=35?.32:.08;});
  elements.entityLayer.innerHTML='';elements.playerLayer.innerHTML='';const firstTime=route.length?(route[0][0]??route[0].time):null,lastTime=route.length?(route.at(-1)[0]??route.at(-1).time):null;const player=firstTime!=null&&time>=firstTime&&time<=lastTime?interpolate(route,time):null;if(player){const state=[...route].reverse().find(point=>(point[0]??point.time)<=time)||route[0];elements.playerLayer.append(svgElement('circle',{cx:player[0],cy:player[1],r:17,class:`map-player ${(state.source||'observed')==='observed'?'observed':'inferred'}`}));}
  const active=(currentAnalysis.detections||[]).filter(item=>time>=item.frames?.[0]?.[0]&&time<=item.frames?.at(-1)?.[0]);active.forEach(item=>{const values=interpolate(item.frames,time);if(!values||values.length<6)return;const x=values[4],y=values[5];elements.entityLayer.append(svgElement('circle',{cx:x,cy:y,r:18,class:`map-observed ${item.team}`}));});
  const predictions=(currentAnalysis.spatial?.predictions||[]).filter(item=>time>=item.observedAt&&time<=item.expiresAt);for(const prediction of predictions){const points=prediction.frames.filter(frame=>frame.time>=time-.5).map(frame=>`${frame.x},${frame.y}`).join(' ');if(points)elements.entityLayer.append(svgElement('polyline',{points,class:`map-prediction ${prediction.team}`}));}
  for(const track of currentAnalysis.spatial?.entityTracks||[]){const observation=[...track.frames].reverse().find(frame=>frame.time<=time+.5&&time-frame.time<=1.5);if(observation)elements.entityLayer.append(svgElement('circle',{cx:observation.x,cy:observation.y,r:18,class:`map-observed ${track.team}`}));}
  for(const prediction of predictions.filter(item=>item.team!=='self')){const position=interpolate(prediction.frames,time);if(!position)continue;if(prediction.team==='enemy'){const frame=[...prediction.frames].reverse().find(item=>item.time<=time)||prediction.frames[0];elements.entityLayer.prepend(svgElement('circle',{cx:position[0],cy:position[1],r:frame.radius||85,class:'map-sight-zone enemy'}));}elements.entityLayer.append(svgElement('circle',{cx:position[0],cy:position[1],r:15,class:`map-predicted-position ${prediction.team}`}));}
  for(const zone of (currentAnalysis.spatial?.threatZones||[]).filter(item=>time>=item.observedAt&&time<=item.expiresAt)){const frame=[...zone.frames].reverse().find(item=>item.time<=time)||zone.frames[0];elements.entityLayer.prepend(svgElement('circle',{cx:frame.x,cy:frame.y,r:frame.radius,class:'map-threat-zone enemy'}));}
  elements.mapClock.textContent=formatTime(time);renderVideoDetections(time);
}

function renderEvents() { elements.eventCount.textContent=`${currentAnalysis.events.length}件`;elements.eventList.replaceChildren(...currentAnalysis.events.map(event=>{const button=document.createElement('button');button.type='button';button.className=`event-item ${event.type}`;const time=document.createElement('span');time.className='event-time';time.textContent=formatTime(event.time);const copy=document.createElement('span');copy.className='event-copy';const title=document.createElement('strong');title.textContent=event.title;const detail=document.createElement('span');detail.textContent=`${event.detail}・確度 ${Math.round(event.confidence*100)}%`;copy.append(title,detail);button.append(time,copy);button.addEventListener('click',()=>{elements.video.currentTime=Math.max(0,event.time-(event.type==='death'?8:4));updatePlaybackUi();});return button;})); }
function renderCapabilities() { const names={segmentation:'試合分割',sceneAnalysis:'画面変化',deaths:'本人デス判定',playerWeapon:'自分のブキ',playerCounts:'生存人数',playerRoute:'プレイヤー動線',mapAllies:'味方位置・予測',enemyThreats:'敵の脅威範囲予測',enemyRoutes:'敵候補の予測動線',videoEnemies:'映像内の敵候補',gameCountOcr:'ゲームカウント',stageMap:'ステージマップ'};elements.capabilityList.replaceChildren(...Object.entries(currentAnalysis.capabilities||{}).map(([key,value])=>{const row=document.createElement('div');row.className='capability';const name=document.createElement('strong');name.textContent=names[key]||key;const state=document.createElement('span');const unavailable=value.includes('not-yet')||value.startsWith('unavailable');state.className=unavailable?'limited':'available';state.textContent=unavailable?'未対応':'利用可能';row.append(name,state);return row;})); }

async function openMatch(recording,match) {
  currentAnalysis=await(await fetch(match.analysisUrl)).json();elements.recordingView.hidden=true;elements.reviewView.hidden=false;setReviewMode(true);closeMenu();elements.matchTitle.textContent=`${recording.fileName} / 試合 ${String(match.number).padStart(2,'0')}`;const selfWeapon=currentAnalysis.playerIdentity?.weapon;byId('video-heading').textContent=`バトル映像｜試合 ${String(match.number).padStart(2,'0')}${selfWeapon?.status!=='candidate-only'&&selfWeapon?.name?`｜自分 ${selfWeapon.name}`:''}`;elements.video.src=match.videoUrl;elements.seek.max=currentAnalysis.media.duration;elements.duration.textContent=formatTime(currentAnalysis.media.duration);
  elements.timelineMarkers.replaceChildren(...currentAnalysis.events.filter(event=>event.type!=='death').map(event=>{const marker=document.createElement('span');marker.className=`timeline-marker ${event.type}`;marker.style.left=`${event.time/currentAnalysis.media.duration*100}%`;return marker;}));
  elements.deathMarkers.replaceChildren(...currentAnalysis.events.filter(event=>event.type==='death').map(event=>{const marker=document.createElement('span');marker.className='death-track-marker';marker.style.left=`${event.time/currentAnalysis.media.duration*100}%`;return marker;}));
  renderChart();renderMapBase();renderEvents();renderCapabilities();updatePlaybackUi();
}

function updatePlaybackUi() {
  if(!currentAnalysis)return;const time=elements.video.currentTime||0,ratio=Math.max(0,Math.min(1,time/currentAnalysis.media.duration));elements.currentTime.textContent=formatTime(time);elements.seek.value=time;elements.timelineProgress.style.width=`${ratio*100}%`;
  const alive=playerCountAt(time);if(alive){const difference=alive.difference>0?`${alive.difference}枚有利`:alive.difference<0?`${Math.abs(alive.difference)}枚不利`:'五分';elements.playerCountStatus.textContent=`人数差 ${difference}`;}else elements.playerCountStatus.textContent='人数差 —';
  const game=gameCountAt(time);elements.gameCountStatus.textContent=game?`カウント 自軍 ${game.teamCount} / 相手 ${game.enemyCount}`:'カウント —';elements.chartCursor.replaceChildren(svgElement('line',{x1:chartX(time),x2:chartX(time),y1:chartBounds.countTop,y2:chartBounds.countBottom,class:'chart-cursor'}));renderSpatialState(time);
}

async function refresh(){try{recordings=await(await fetch('/api/recordings')).json();renderRecordings();}catch(error){console.error(error);}}
function toggleVideoPlayback(){if(elements.video.paused)elements.video.play().catch(console.error);else elements.video.pause();}
elements.video.addEventListener('click',toggleVideoPlayback);elements.video.addEventListener('keydown',event=>{if(event.code==='Space'){event.preventDefault();toggleVideoPlayback();}});elements.video.addEventListener('timeupdate',updatePlaybackUi);elements.seek.addEventListener('input',()=>{elements.video.currentTime=Number(elements.seek.value);updatePlaybackUi();});
elements.chartHit.addEventListener('pointerdown',event=>{if(!currentAnalysis)return;const bounds=event.currentTarget.closest('svg').getBoundingClientRect(),plotLeft=bounds.left+bounds.width*(chartBounds.left/1000),plotWidth=bounds.width*((chartBounds.right-chartBounds.left)/1000);elements.video.currentTime=Math.max(0,Math.min(1,(event.clientX-plotLeft)/plotWidth))*currentAnalysis.media.duration;updatePlaybackUi();});
byId('back-to-matches').addEventListener('click',()=>{currentAnalysis=null;elements.video.pause();elements.video.removeAttribute('src');elements.reviewView.hidden=true;setReviewMode(false);renderSelected();});
byId('scan-button').addEventListener('click',async()=>{await fetch('/api/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});await refresh();});
elements.menuButton.addEventListener('click',()=>{const open=document.body.classList.toggle('menu-open');elements.menuButton.setAttribute('aria-expanded',String(open));});elements.menuScrim.addEventListener('click',closeMenu);
await refresh();setInterval(refresh,2000);
