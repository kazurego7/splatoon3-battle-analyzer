import { resolveOutcomeLabel } from './outcome.js';
import { deathAnalysisControlState, deathAnalysisEndpoint, deathReportDigest, deathSeekTime, matchAnalysisBadge } from './death-analysis-ui.js';
import { killDeathFromAnalysis } from './player-stats-ui.js';

const byId = id => document.getElementById(id);
const elements = {
  recordingList:byId('recording-list'), recordingCount:byId('recording-count'), empty:byId('empty-state'), recordingView:byId('recording-view'), reviewView:byId('review-view'),
  selectedTitle:byId('selected-title'), selectedStatus:byId('selected-status'), selectedProgress:byId('selected-progress'), error:byId('recording-error'), matchList:byId('match-list'),
  video:byId('match-video'), matchTitle:byId('match-title'), eventList:byId('event-list'), deathReportDigest:byId('death-report-digest'), deathAiButton:byId('death-ai-button'), deathAiStatus:byId('death-ai-status'), deathReportButton:byId('death-report-button'), currentTime:byId('current-time'), duration:byId('duration'), seek:byId('seek'),
  timelineProgress:byId('timeline-progress'), deathMarkers:byId('death-markers'), playerCountStatus:byId('player-count-status'), gameCountStatus:byId('game-count-status'),
  chartAdvantage:byId('chart-advantage'), chartGrid:byId('chart-grid'), chartCountSeries:byId('chart-count-series'), chartDeaths:byId('chart-deaths'), chartCursor:byId('chart-cursor'), chartHover:byId('chart-hover'), chartHit:byId('chart-hit'),
  capabilityList:byId('capability-list'), stageMapImage:byId('stage-map-image'), mapPlaceholder:byId('map-placeholder'), mapSourceStatus:byId('map-source-status'), mapClock:byId('map-clock'), routeLayer:byId('route-layer'), entityLayer:byId('entity-layer'), playerLayer:byId('player-layer'), mapOverlay:byId('map-overlay'), strongPositionLayer:byId('strong-position-layer'),
  strongEditButton:byId('strong-edit-button'), strongEditPanel:byId('strong-edit-panel'), strongEditInstruction:byId('strong-edit-instruction'), strongTitleInput:byId('strong-title-input'), strongTipsInput:byId('strong-tips-input'), strongPositionList:byId('strong-position-list'), strongPositionCount:byId('strong-position-count'), strongFormTitle:byId('strong-form-title'), strongFormContext:byId('strong-form-context'), strongNewButton:byId('strong-new-button'), strongPositionButton:byId('strong-position-button'), strongTargetButton:byId('strong-target-button'), strongAddButton:byId('strong-add-button'),
  positionSaveStatus:byId('position-save-status'),
  mapEditorModal:byId('map-editor-modal'), mapEditorModalTitle:byId('map-editor-modal-title'), mapEditorModalContext:byId('map-editor-modal-context'), mapEditorModalClose:byId('map-editor-modal-close'), editorStageMapImage:byId('editor-stage-map-image'), editorMapOverlay:byId('editor-map-overlay'), editorStrongPositionLayer:byId('editor-strong-position-layer'), modalSaveStatus:byId('modal-save-status'),
  videoHeadingMeta:byId('video-heading-meta'), screenTitle:byId('screen-title'),
};

const labels = { queued:'待機中', probing:'確認中', splitting:'分割中', analyzing:'分析中', ready:'分析済み', error:'失敗' };
const chartBounds = { left:34, right:978, countTop:31, countBottom:176, labelY:203, hoverTop:218 };
let recordings = [];
let selectedId = null;
let currentAnalysis = null;
let savedPositionPlan = { strongPositions:[], briefings:[] };
let currentPositionPlan = { strongPositions:[], briefings:[] };
let mapEditMode = null;
let draftStrongSpot = null;
let draftStrongIndex = null;
let selectedDeathKey = null;
let currentRecording = null;
let currentMatch = null;
const matchMetadataCache = new Map();
const deathAnalysisJobs = new Map();
const deathAnalysisErrors = new Map();

function formatTime(value) { const seconds=Math.max(0,Math.round(Number(value)||0)); return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`; }
function formatSize(value) { return value>=1e9?`${(value/1e9).toFixed(1)} GB`:`${(value/1e6).toFixed(0)} MB`; }
function clonePositionPlan(plan) { return JSON.parse(JSON.stringify(plan||{strongPositions:[],briefings:[]})); }
function svgElement(name,attributes={}) { const element=document.createElementNS('http://www.w3.org/2000/svg',name); Object.entries(attributes).forEach(([key,value])=>element.setAttribute(key,value)); return element; }
function setReviewMode(active) { document.body.classList.toggle('is-review',active); elements.screenTitle.textContent=active?'試合レビュー':'録画ライブラリ'; }
function showAnalysisList() { currentAnalysis=null;currentRecording=null;currentMatch=null;elements.video.pause();elements.video.removeAttribute('src');elements.reviewView.hidden=true;setReviewMode(false);renderSelected(); }

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
  const ready=match.status==='ready',card=document.createElement('article');card.className=`match-card${ready?' is-clickable':''}`;card.tabIndex=ready?0:-1;card.setAttribute('role','button');card.setAttribute('aria-disabled',String(!ready));card.setAttribute('aria-label',`試合 ${String(match.number).padStart(2,'0')} の振り返りを開く`);
  const media=document.createElement('div');media.className='match-card-media';const image=document.createElement('img');image.alt=`試合${match.number}のサムネイル`;if(match.thumbnailUrl)image.src=match.thumbnailUrl;const preview=document.createElement('video');preview.className='match-card-preview';preview.muted=true;preview.loop=true;preview.playsInline=true;preview.preload='none';media.append(image,preview);
  const body=document.createElement('div'); body.className='match-card-body'; const top=document.createElement('div'); top.className='match-card-top'; const title=document.createElement('h3'); title.textContent=`試合 ${String(match.number).padStart(2,'0')}`;
  const badge=document.createElement('span'); const setBadge=analysis=>{const state=matchAnalysisBadge({ready,analysis});badge.className=`status-badge ${state.className}`.trim();badge.textContent=state.label;};setBadge();top.append(title,badge);
  const facts=document.createElement('div');facts.className='match-card-facts';facts.setAttribute('aria-live','polite');
  const setFacts=analysis=>{setBadge(analysis);const outcome=resolveOutcomeLabel(analysis),stage=analysis.stageMap?.stage||'ステージ未判定',rule=analysis.stageMap?.rule||'ルール未判定',weapon=analysis.playerIdentity?.weapon,weaponName=weapon?.status!=='candidate-only'&&weapon?.name?weapon.name:'ブキ未判定';facts.innerHTML='';const summaryRow=document.createElement('div');summaryRow.className='match-fact-row';[[outcome,'result'],[`${stage} / ${rule}`,'stage'],[killDeathFromAnalysis(analysis),'stats']].forEach(([text,className])=>{const item=document.createElement('span');item.className=`match-fact ${className}${text==='WIN'?' win':text==='LOSE'?' lose':''}`;item.textContent=text;summaryRow.append(item);});const weaponRow=document.createElement('div');weaponRow.className='match-fact-row weapon-row';const weaponItem=document.createElement('span');weaponItem.className='match-fact weapon';weaponItem.textContent=weaponName;weaponRow.append(weaponItem);facts.append(summaryRow,weaponRow);};
  const loadFacts=async()=>{if(!ready||!match.analysisUrl)return;try{let analysis=matchMetadataCache.get(match.analysisUrl);if(!analysis){analysis=await(await fetch(match.analysisUrl,{cache:'no-store'})).json();matchMetadataCache.set(match.analysisUrl,analysis);}setFacts(analysis);}catch(error){console.error(error);}};
  const stopPreview=()=>{preview.pause();preview.removeAttribute('src');preview.load();card.classList.remove('is-previewing');};
  const startPreview=()=>{if(!ready||!match.videoUrl||preview.src)return;preview.src=match.videoUrl;preview.addEventListener('loadedmetadata',()=>{preview.currentTime=Math.min(8,Math.max(0,preview.duration-1));},{once:true});preview.play().then(()=>card.classList.add('is-previewing')).catch(()=>stopPreview());};
  const openReview=()=>{if(!ready)return;stopPreview();openMatch(recording,match);};
  card.addEventListener('pointerenter',startPreview);card.addEventListener('pointerleave',stopPreview);card.addEventListener('focus',startPreview);card.addEventListener('blur',stopPreview);card.addEventListener('click',openReview);card.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openReview();}});
  body.append(top,facts);card.append(media,body);loadFacts();return card;
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
function penaltyPath(points,countKey,penaltyKey) { let path='',active=false;for(const item of points){const penalty=Math.max(0,Number(item[penaltyKey])||0),stacked=Math.min(100,Math.max(0,Number(item[countKey])||0)+penalty),x=chartX(item.time);if(penalty>0){if(!active){path+=`${path?' ':''}M ${x} ${gameY(Number(item[countKey])||0)} V ${gameY(stacked)}`;active=true;}else path+=` H ${x} V ${gameY(stacked)}`;}else if(active){path+=` H ${x} V ${gameY(Number(item[countKey])||0)}`;active=false;}}return path; }
function stateAt(points,time,maxAge=2) { let result=null;for(const item of points){if(item.time>time+.5)break;result=item;}return result&&time-result.time<=maxAge?result:null; }
function playerCountAt(time) { return stateAt(currentAnalysis?.gameFlow?.playerCounts||[],time,1.5); }
function gameCountAt(time) { return stateAt(currentAnalysis?.gameFlow?.gameCounts||[],time,3); }

function addChartLabel(text,x,y,anchor='end',className='chart-text') { const label=svgElement('text',{x,y,'text-anchor':anchor,class:className});label.textContent=text;elements.chartGrid.append(label); }
function renderChart() {
  const duration=currentAnalysis.media.duration; const alive=currentAnalysis.gameFlow?.playerCounts||[]; const game=currentAnalysis.gameFlow?.gameCounts||[];
  elements.chartAdvantage.innerHTML=''; alive.forEach((item,index)=>{const end=alive[index+1]?.time??duration;if(end<=item.time)return;const difference=Math.max(-4,Math.min(4,item.difference||0)),strength=difference===0?.035:(.1+Math.abs(difference)*.11)*(item.source==='held'?.55:1);elements.chartAdvantage.append(svgElement('rect',{x:chartX(item.time),y:chartBounds.countTop,width:Math.max(0,chartX(end)-chartX(item.time)),height:chartBounds.countBottom-chartBounds.countTop,'fill-opacity':Number(strength.toFixed(3)),class:`chart-advantage ${difference>0?'positive':difference<0?'negative':'even'}`}));});
  elements.chartGrid.innerHTML='';
  [100,75,50,25,0].forEach(count=>{const y=gameY(count);elements.chartGrid.append(svgElement('line',{x1:chartBounds.left,x2:chartBounds.right,y1:y,y2:y,class:'chart-grid'}));addChartLabel(count,chartBounds.left-8,y+5);});
  for(let index=0;index<=6;index+=1){const time=duration*index/6;addChartLabel(formatTime(time),chartX(time),chartBounds.labelY,index===0?'start':index===6?'end':'middle');}
  elements.chartCountSeries.replaceChildren(
    svgElement('path',{d:penaltyPath(game,'teamCount','teamPenalty'),class:'chart-penalty-team'}),
    svgElement('path',{d:penaltyPath(game,'enemyCount','enemyPenalty'),class:'chart-penalty-enemy'}),
    svgElement('path',{d:stepPath(game,'teamCount',gameY),class:'chart-count-team'}),
    svgElement('path',{d:stepPath(game,'enemyCount',gameY),class:'chart-count-enemy'}),
  );
  elements.chartDeaths.replaceChildren(...currentAnalysis.events.filter(event=>event.type==='death').flatMap(event=>{const x=chartX(event.time);return [svgElement('line',{x1:x,x2:x,y1:chartBounds.countTop,y2:chartBounds.countBottom,class:'chart-death'}),svgElement('rect',{x:x-5,y:chartBounds.countTop-5,width:10,height:10,class:'chart-death-marker',transform:`rotate(45 ${x} ${chartBounds.countTop})`})];}));
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

function drawStrongPositions(layer,spots) {
  layer.innerHTML='';
  spots.forEach((spot,index)=>{
    const position=spot.position,target=spot.target;
    const group=svgElement('g',{class:`strong-position${spot.id==='draft'?' draft':''}`,tabindex:'0'});
    if(target){group.append(svgElement('line',{x1:position.x,y1:position.y,x2:target.x,y2:target.y,class:'strong-position-detail strong-shot-line'}));group.append(svgElement('circle',{cx:target.x,cy:target.y,r:22,class:'strong-position-detail strong-shot-target'}));}
    group.append(svgElement('circle',{cx:position.x,cy:position.y,r:42,class:'strong-position-hit'}));
    group.append(svgElement('circle',{cx:position.x,cy:position.y,r:22,class:'strong-position-anchor'}));
    const tooltipX=position.x>650?position.x-360:position.x+32,tooltipY=Math.max(20,Math.min(850,position.y-45));
    const foreign=svgElement('foreignObject',{x:tooltipX,y:tooltipY,width:330,height:130,class:'strong-position-detail strong-position-tooltip'});
    const tip=document.createElement('div');tip.className='strong-position-tip';const heading=document.createElement('strong');heading.textContent=spot.title||`有利なポジション ${index+1}`;const copy=document.createElement('p');copy.textContent=spot.tips||'Tips未入力';tip.append(heading,copy);foreign.append(tip);group.append(foreign);layer.append(group);
  });
}

function renderStrongPositions() {
  drawStrongPositions(elements.strongPositionLayer,currentPositionPlan.strongPositions||[]);
  const editorSpots=elements.strongEditPanel.hidden?[]:(currentPositionPlan.strongPositions||[]).filter((_,index)=>index!==draftStrongIndex);if(!elements.strongEditPanel.hidden&&draftStrongSpot?.position)editorSpots.push({...draftStrongSpot,id:'draft'});drawStrongPositions(elements.editorStrongPositionLayer,editorSpots);
}

function renderStrongPositionList() {
  elements.strongPositionCount.textContent=`${currentPositionPlan.strongPositions.length}件`;
  elements.strongPositionList.replaceChildren(...currentPositionPlan.strongPositions.map((spot,index)=>{const row=document.createElement('div');row.classList.toggle('active',index===draftStrongIndex);const text=document.createElement('button');text.type='button';text.className='map-editor-list-select';text.textContent=spot.title||`有利なポジション ${index+1}`;text.addEventListener('click',()=>selectStrongPosition(index));const remove=document.createElement('button');remove.type='button';remove.textContent='削除';remove.addEventListener('click',async()=>{const previous=clonePositionPlan(currentPositionPlan);remove.disabled=true;currentPositionPlan.strongPositions.splice(index,1);if(draftStrongIndex===index)clearStrongEditor();else if(draftStrongIndex>index)draftStrongIndex-=1;renderStrongPositionList();renderStrongPositions();if(!await savePositionPlan()){currentPositionPlan=previous;clearStrongEditor();renderStrongPositionList();renderStrongPositions();}});row.append(text,remove);return row;}));
}

function setStrongMapMode(mode,message) {
  mapEditMode=mode;const pickingPosition=mode==='strong-position',pickingTarget=mode==='strong-target';
  elements.strongPositionButton.classList.toggle('active',pickingPosition);elements.strongTargetButton.classList.toggle('active',pickingTarget);
  elements.strongEditPanel.classList.toggle('is-picking-position',pickingPosition);elements.strongEditPanel.classList.toggle('is-picking-target',pickingTarget);
  elements.editorMapOverlay.classList.toggle('picking-position',pickingPosition);elements.editorMapOverlay.classList.toggle('picking-target',pickingTarget);
  elements.editorMapOverlay.classList.toggle('position-editing',pickingPosition||pickingTarget);
  elements.strongEditInstruction.textContent=message;
}

function updateStrongEditorControls() {
  const editing=Boolean(draftStrongSpot);elements.strongTitleInput.disabled=!editing;elements.strongTipsInput.disabled=!editing;elements.strongPositionButton.disabled=!editing;elements.strongTargetButton.disabled=!draftStrongSpot?.position;elements.strongAddButton.disabled=!(draftStrongSpot?.position&&draftStrongSpot?.target);
  elements.strongFormTitle.textContent=draftStrongIndex===null?'ポジションを追加':'ポジションを編集';
  elements.strongFormContext.textContent=editing?(draftStrongIndex===null?'新しい有利ポジションを設定中':'登録内容を変更中'):'上の「新規作成」から開始';
  elements.strongAddButton.textContent=draftStrongIndex===null?'作成':'修正';
  elements.strongNewButton.disabled=editing&&draftStrongIndex===null;
}

function clearStrongEditor() {
  draftStrongSpot=null;draftStrongIndex=null;elements.strongTitleInput.value='';elements.strongTipsInput.value='';setStrongMapMode(null,'上の「新規作成」または登録済みの項目を選択してください');updateStrongEditorControls();renderStrongPositionList();renderStrongPositions();
}

function selectStrongPosition(index) {
  const spot=currentPositionPlan.strongPositions[index];if(!spot)return;draftStrongSpot=clonePositionPlan(spot);draftStrongIndex=index;elements.strongTitleInput.value=spot.title||'';elements.strongTipsInput.value=spot.tips||'';setStrongMapMode(null,'内容を編集できます。位置やターゲットを変える場合は下のボタンを選択してください');updateStrongEditorControls();renderStrongPositionList();renderStrongPositions();
}

function createStrongPosition() {
  draftStrongSpot={title:'',tips:'',position:null,target:null};draftStrongIndex=null;elements.strongTitleInput.value='';elements.strongTipsInput.value='';setStrongMapMode('strong-position','ステップ1｜マップ上の有利なポジションをクリック');updateStrongEditorControls();renderStrongPositionList();renderStrongPositions();elements.strongTitleInput.focus();
}

async function loadPositionPlan() {
  const stage=currentAnalysis?.stageMap?.stage,rule=currentAnalysis?.stageMap?.rule,available=Boolean(stage&&rule);
  elements.strongEditButton.disabled=!available;
  if(!available){savedPositionPlan={strongPositions:[],briefings:[]};currentPositionPlan=clonePositionPlan(savedPositionPlan);renderStrongPositions();return;}
  try{const response=await fetch(`/api/position-plan?stage=${encodeURIComponent(stage)}&rule=${encodeURIComponent(rule)}`,{cache:'no-store'});if(!response.ok)throw new Error('マップメモを読み込めませんでした');const data=await response.json();savedPositionPlan=data.plan||{strongPositions:[],briefings:[]};currentPositionPlan=clonePositionPlan(savedPositionPlan);}
  catch(error){console.error(error);savedPositionPlan={strongPositions:[],briefings:[]};currentPositionPlan=clonePositionPlan(savedPositionPlan);}
  renderStrongPositions();
}

async function savePositionPlan() {
  const stage=currentAnalysis?.stageMap?.stage,rule=currentAnalysis?.stageMap?.rule;if(!stage||!rule)return false;
  elements.positionSaveStatus.textContent='保存中…';elements.modalSaveStatus.textContent='保存中…';
  try{const response=await fetch('/api/position-plan',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({stage,rule,plan:currentPositionPlan})});if(!response.ok)throw new Error((await response.json()).error||'保存できませんでした');const data=await response.json();savedPositionPlan=data.plan;currentPositionPlan=clonePositionPlan(savedPositionPlan);elements.positionSaveStatus.textContent='保存しました';elements.modalSaveStatus.textContent='保存しました';renderStrongPositions();return true;}
  catch(error){elements.positionSaveStatus.textContent=error.message;elements.modalSaveStatus.textContent=error.message;return false;}
}

function openMapEditor(title) {
  elements.mapEditorModalTitle.textContent=title;elements.mapEditorModalContext.textContent=`${currentAnalysis?.stageMap?.stage||''}｜${currentAnalysis?.stageMap?.rule||''}`;elements.editorStageMapImage.src=currentAnalysis?.stageMap?.imageUrl||'';if(elements.editorStageMapImage.complete&&elements.editorStageMapImage.naturalWidth)elements.editorStageMapImage.parentElement.style.aspectRatio=`${elements.editorStageMapImage.naturalWidth}/${elements.editorStageMapImage.naturalHeight}`;elements.modalSaveStatus.textContent='';if(!elements.mapEditorModal.open)elements.mapEditorModal.showModal();
}

function closeMapEditors({restore=false}={}) {
  if(restore)currentPositionPlan=clonePositionPlan(savedPositionPlan);
  elements.strongEditPanel.hidden=true;mapEditMode=null;draftStrongSpot=null;draftStrongIndex=null;elements.strongTitleInput.value='';elements.strongTipsInput.value='';elements.editorMapOverlay.classList.remove('position-editing','strong-editing','picking-position','picking-target');if(elements.mapEditorModal.open)elements.mapEditorModal.close();updateStrongEditorControls();renderStrongPositions();
}

function renderSpatialState(time) {
  const route=currentAnalysis.route||currentAnalysis.playerRoute||[]; [...elements.routeLayer.children].forEach(item=>{const distance=Math.abs(Number(item.dataset.time)-time);item.style.opacity=distance<=12?.95:distance<=35?.32:.08;});
  elements.entityLayer.innerHTML='';elements.playerLayer.innerHTML='';const firstTime=route.length?(route[0][0]??route[0].time):null,lastTime=route.length?(route.at(-1)[0]??route.at(-1).time):null;const player=firstTime!=null&&time>=firstTime&&time<=lastTime?interpolate(route,time):null;if(player){const state=[...route].reverse().find(point=>(point[0]??point.time)<=time)||route[0];elements.playerLayer.append(svgElement('circle',{cx:player[0],cy:player[1],r:17,class:`map-player ${(state.source||'observed')==='observed'?'observed':'inferred'}`}));}
  const active=(currentAnalysis.detections||[]).filter(item=>time>=item.frames?.[0]?.[0]&&time<=item.frames?.at(-1)?.[0]);active.forEach(item=>{const values=interpolate(item.frames,time);if(!values||values.length<6)return;const x=values[4],y=values[5];elements.entityLayer.append(svgElement('circle',{cx:x,cy:y,r:18,class:`map-observed ${item.team}`}));});
  const predictions=(currentAnalysis.spatial?.predictions||[]).filter(item=>time>=item.observedAt&&time<=item.expiresAt);for(const prediction of predictions){const points=prediction.frames.filter(frame=>frame.time>=time-.5).map(frame=>`${frame.x},${frame.y}`).join(' ');if(points)elements.entityLayer.append(svgElement('polyline',{points,class:`map-prediction ${prediction.team}`}));}
  for(const track of currentAnalysis.spatial?.entityTracks||[]){const observation=[...track.frames].reverse().find(frame=>frame.time<=time+.5&&time-frame.time<=1.5);if(observation)elements.entityLayer.append(svgElement('circle',{cx:observation.x,cy:observation.y,r:18,class:`map-observed ${track.team}`}));}
  for(const prediction of predictions.filter(item=>item.team!=='self')){const position=interpolate(prediction.frames,time);if(!position)continue;if(prediction.team==='enemy'){const frame=[...prediction.frames].reverse().find(item=>item.time<=time)||prediction.frames[0];elements.entityLayer.prepend(svgElement('circle',{cx:position[0],cy:position[1],r:frame.radius||85,class:'map-sight-zone enemy'}));}elements.entityLayer.append(svgElement('circle',{cx:position[0],cy:position[1],r:15,class:`map-predicted-position ${prediction.team}`}));}
  for(const zone of (currentAnalysis.spatial?.threatZones||[]).filter(item=>time>=item.observedAt&&time<=item.expiresAt)){const frame=[...zone.frames].reverse().find(item=>item.time<=time)||zone.frames[0];elements.entityLayer.prepend(svgElement('circle',{cx:frame.x,cy:frame.y,r:frame.radius,class:'map-threat-zone enemy'}));}
  elements.mapClock.textContent=formatTime(time);
}

function deathTitle(event) { return event.title==='自分がデス'?'原因未分析のデス':event.title; }
function selectDeathEvent(event,key) {
  selectedDeathKey=key;
  [...elements.eventList.children].forEach(button=>{const active=button.dataset.deathKey===key;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
  elements.video.currentTime=deathSeekTime(event,-8,currentAnalysis.media.duration);updatePlaybackUi();
}
function renderEvents(preferredKey=null) {
  const deaths=currentAnalysis.events.filter(event=>event.type==='death'),keys=deaths.map((event,index)=>String(event.id||`${event.time}-${index}`));
  selectedDeathKey=preferredKey&&keys.includes(preferredKey)?preferredKey:null;
  elements.eventList.replaceChildren(...deaths.map((event,index)=>{const key=keys[index],button=document.createElement('button');button.type='button';button.className='event-item death';button.dataset.deathKey=key;button.title=`${formatTime(event.time)} ${deathTitle(event)}`;button.setAttribute('aria-pressed',String(key===selectedDeathKey));button.classList.toggle('active',key===selectedDeathKey);const time=document.createElement('span');time.className='event-time';time.textContent=formatTime(event.time);const title=document.createElement('strong');title.textContent=deathTitle(event);button.append(time,title);button.addEventListener('click',()=>selectDeathEvent(event,key));return button;}));
}
function renderDeathAnalysisSummary() {
  const analysis=currentAnalysis?.deathAnalysis,deaths=currentAnalysis?.events?.filter(event=>event.type==='death')||[],analysisUrl=currentMatch?.analysisUrl||'',state=deathAnalysisControlState({analysis,deathCount:deaths.length,jobState:currentAnalysis?.deathAnalysisState,localError:deathAnalysisErrors.get(analysisUrl)});elements.deathAiButton.hidden=!state.showAnalyze;elements.deathAiButton.disabled=state.analyzeDisabled;elements.deathAiButton.textContent=state.analyzeLabel;elements.deathReportButton.hidden=!state.showReport;elements.deathReportButton.disabled=!state.showReport;elements.deathReportButton.title=state.showReport?'失敗パターンを別ウィンドウで開く':'';elements.deathAiStatus.hidden=!state.status;elements.deathAiStatus.classList.toggle('error',state.statusIsError);elements.deathAiStatus.textContent=state.status;
  elements.deathAiButton.closest('.death-report-digest').classList.toggle('awaiting-analysis',state.showAnalyze);
  elements.deathReportDigest.textContent=deathReportDigest(currentAnalysis);
  if(!analysis&&!deaths.length)elements.deathReportDigest.textContent='分析できるデスがありません。';
}
function openDeathReport() { if(!currentMatch||!currentAnalysis?.deathAnalysis)return;const query=new URLSearchParams({analysis:currentMatch.analysisUrl,video:currentMatch.videoUrl,title:`${currentRecording.fileName} / 試合 ${String(currentMatch.number).padStart(2,'0')}`});const report=window.open(`/report.html?${query}`,'_blank');if(report)report.opener=null;else{elements.deathAiStatus.hidden=false;elements.deathAiStatus.classList.add('error');elements.deathAiStatus.textContent='ポップアップがブロックされました。ブラウザで許可してください。';} }
function applyDeathAnalysisPayload(analysisUrl,payload,preferredKey=selectedDeathKey) {
  if(!payload?.analysis)return;const analysis=payload.analysis;if(payload.state)analysis.deathAnalysisState=payload.state;matchMetadataCache.set(analysisUrl,analysis);
  if(payload.state?.status!=='error'&&payload.state?.status!=='interrupted')deathAnalysisErrors.delete(analysisUrl);
  if(currentMatch?.analysisUrl!==analysisUrl)return;currentAnalysis=analysis;renderEvents(selectedDeathKey||preferredKey);renderDeathAnalysisSummary();
}
function monitorDeathAiAnalysis(analysisUrl,preferredKey=selectedDeathKey) {
  if(deathAnalysisJobs.has(analysisUrl))return deathAnalysisJobs.get(analysisUrl).promise;const monitor={promise:null};deathAnalysisJobs.set(analysisUrl,monitor);
  monitor.promise=(async()=>{try{while(true){await new Promise(resolve=>setTimeout(resolve,1000));const response=await fetch(deathAnalysisEndpoint(analysisUrl),{cache:'no-store'}),payload=await response.json();if(!response.ok)throw new Error([payload.error,payload.guidance].filter(Boolean).join(' ')||`HTTP ${response.status}`);applyDeathAnalysisPayload(analysisUrl,payload,preferredKey);if(!['sequences','report'].includes(payload.state?.status))break;}}
    catch(error){deathAnalysisErrors.set(analysisUrl,error.message);if(currentMatch?.analysisUrl===analysisUrl)renderDeathAnalysisSummary();}
    finally{if(deathAnalysisJobs.get(analysisUrl)===monitor)deathAnalysisJobs.delete(analysisUrl);}})();return monitor.promise;
}
async function runDeathAiAnalysis() {
  if(!currentMatch||elements.deathAiButton.disabled)return;const analysisUrl=currentMatch.analysisUrl,previousKey=selectedDeathKey;deathAnalysisErrors.delete(analysisUrl);
  try{const response=await fetch(deathAnalysisEndpoint(analysisUrl),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refresh:false})}),payload=await response.json();if(!response.ok)throw new Error([payload.error,payload.guidance].filter(Boolean).join(' ')||`HTTP ${response.status}`);applyDeathAnalysisPayload(analysisUrl,payload,previousKey);void monitorDeathAiAnalysis(analysisUrl,previousKey);}
  catch(error){deathAnalysisErrors.set(analysisUrl,error.message);if(currentMatch?.analysisUrl===analysisUrl)renderDeathAnalysisSummary();}
}
function renderCapabilities() { const names={segmentation:'試合分割',matchOutcome:'勝敗発表',deaths:'本人デス判定',deathExplanation:'デスの状況・原因',playerWeapon:'自分のブキ',playerCounts:'生存人数',playerRoute:'プレイヤー動線',mapAllies:'味方位置・予測',enemyThreats:'相手の脅威範囲予測',enemyRoutes:'相手候補の予測動線',gameCountOcr:'ゲームカウント',stageMap:'ステージマップ'};elements.capabilityList.replaceChildren(...Object.entries(currentAnalysis.capabilities||{}).filter(([key])=>key in names).map(([key,value])=>{const row=document.createElement('div');row.className='capability';const name=document.createElement('strong');name.textContent=names[key];const state=document.createElement('span');const unavailable=value.includes('not-yet')||value.startsWith('unavailable');state.className=unavailable?'limited':'available';state.textContent=unavailable?'未対応':'利用可能';row.append(name,state);return row;})); }

async function openMatch(recording,match) {
  closeMapEditors({restore:true});currentRecording=recording;currentMatch=match;currentAnalysis=matchMetadataCache.get(match.analysisUrl)||await(await fetch(match.analysisUrl,{cache:'no-store'})).json();matchMetadataCache.set(match.analysisUrl,currentAnalysis);selectedDeathKey=null;elements.recordingView.hidden=true;elements.reviewView.hidden=false;setReviewMode(true);const reviewUrl=`/?recording=${encodeURIComponent(recording.id)}&match=${encodeURIComponent(match.number)}`;if(`${location.pathname}${location.search}`!==reviewUrl)history.pushState({review:true},'',reviewUrl);elements.matchTitle.textContent=`${recording.fileName} / 試合 ${String(match.number).padStart(2,'0')}`;const selfWeapon=currentAnalysis.playerIdentity?.weapon,videoHeading=byId('video-heading'),headingMain=document.createElement('span'),matchChip=document.createElement('span');headingMain.className='video-heading-main';headingMain.textContent='バトル映像';videoHeading.replaceChildren(headingMain);matchChip.className='video-heading-chip match';matchChip.textContent=`動画：試合 ${String(match.number).padStart(2,'0')}`;elements.videoHeadingMeta.replaceChildren(matchChip);if(selfWeapon?.status!=='candidate-only'&&selfWeapon?.name){const weaponChip=document.createElement('span');weaponChip.className='video-heading-chip weapon';weaponChip.textContent=`ブキ：${selfWeapon.name}`;elements.videoHeadingMeta.append(weaponChip);}elements.video.src=match.videoUrl;elements.seek.max=currentAnalysis.media.duration;elements.duration.textContent=formatTime(currentAnalysis.media.duration);
  elements.deathMarkers.replaceChildren(...currentAnalysis.events.filter(event=>event.type==='death').map(event=>{const marker=document.createElement('span');marker.className='death-track-marker';marker.style.left=`${event.time/currentAnalysis.media.duration*100}%`;return marker;}));
  renderChart();renderMapBase();await loadPositionPlan();renderDeathAnalysisSummary();renderEvents();updatePlaybackUi();if(['sequences','report'].includes(currentAnalysis.deathAnalysisState?.status))void monitorDeathAiAnalysis(match.analysisUrl);
}

async function syncReviewFromLocation() {
  const deepLink=new URLSearchParams(window.location.search),deepRecording=deepLink.get('recording'),deepMatch=Number(deepLink.get('match'));
  if(deepRecording&&Number.isInteger(deepMatch)){
    const recording=recordings.find(item=>item.id===deepRecording),match=recording?.matches?.find(item=>item.number===deepMatch&&item.status==='ready');
    if(recording&&match){if(currentRecording?.id===recording.id&&currentMatch?.number===match.number)return;selectedId=recording.id;renderRecordings();await openMatch(recording,match);return;}
  }
  if(currentAnalysis)showAnalysisList();
}

function updatePlaybackUi() {
  if(!currentAnalysis)return;const time=elements.video.currentTime||0,ratio=Math.max(0,Math.min(1,time/currentAnalysis.media.duration));elements.currentTime.textContent=formatTime(time);elements.seek.value=time;elements.timelineProgress.style.width=`${ratio*100}%`;
  const alive=playerCountAt(time),difference=alive?(alive.difference>0?`${alive.difference}枚有利`:alive.difference<0?`${Math.abs(alive.difference)}枚不利`:'五分'):'—',game=gameCountAt(time),cursorX=chartX(time),labelX=Math.max(84,Math.min(928,cursorX));
  elements.playerCountStatus.textContent=alive?`味方${alive.teamAlive}–相手${alive.enemyAlive}・${difference}`:'人数差 —';elements.gameCountStatus.textContent=game?`カウント 味方 ${game.teamCount}（+${game.teamPenalty||0}） / 相手 ${game.enemyCount}（+${game.enemyPenalty||0}）`:'カウント —';
  const advantageClass=!game?'unknown':alive?(alive.difference>0?'positive':alive.difference<0?'negative':'even'):'unknown',cursorLine=svgElement('line',{x1:cursorX,x2:cursorX,y1:chartBounds.countTop,y2:chartBounds.countBottom,class:'chart-cursor'}),labelBg=svgElement('rect',{x:labelX-50,y:0,width:100,height:24,rx:8,class:`chart-cursor-label-bg ${advantageClass}`}),label=svgElement('text',{x:labelX,y:16,'text-anchor':'middle',class:'chart-cursor-label'});label.textContent=difference;elements.chartCursor.replaceChildren(cursorLine,labelBg,label);renderSpatialState(time);
}

function chartPointerState(event) {
  const svg=event.currentTarget.closest('svg'),bounds=svg.getBoundingClientRect(),plotLeft=bounds.left+bounds.width*(chartBounds.left/1000),plotWidth=bounds.width*((chartBounds.right-chartBounds.left)/1000),ratio=Math.max(0,Math.min(1,(event.clientX-plotLeft)/plotWidth)),time=ratio*currentAnalysis.media.duration;
  return { time, x:chartX(time) };
}
function renderChartHover(event) {
  if(!currentAnalysis)return;const {time,x}=chartPointerState(event),game=gameCountAt(time),alive=playerCountAt(time),advantageClass=!game?'unknown':alive?(alive.difference>0?'positive':alive.difference<0?'negative':'even'):'unknown',boxWidth=410,boxX=Math.max(chartBounds.left,Math.min(chartBounds.right-boxWidth,x-boxWidth/2)),line=svgElement('line',{x1:x,x2:x,y1:chartBounds.countTop,y2:chartBounds.countBottom,class:'chart-hover-line'}),background=svgElement('rect',{x:boxX,y:chartBounds.hoverTop,width:boxWidth,height:26,rx:8,class:`chart-hover-bg ${advantageClass}`}),label=svgElement('text',{x:boxX+boxWidth/2,y:chartBounds.hoverTop+17,'text-anchor':'middle',class:'chart-hover-text'});
  label.textContent=game?`${formatTime(time)}｜味方 ${game.teamCount}（+${game.teamPenalty||0}）｜相手 ${game.enemyCount}（+${game.enemyPenalty||0}）`:`${formatTime(time)}｜カウントデータなし`;elements.chartHover.replaceChildren(line,background,label);
}

async function refresh(){try{const nextRecordings=await(await fetch('/api/recordings')).json(),changed=JSON.stringify(nextRecordings)!==JSON.stringify(recordings);recordings=nextRecordings;if(changed)renderRecordings();}catch(error){console.error(error);}}
function toggleVideoPlayback(){if(elements.video.paused)elements.video.play().catch(console.error);else elements.video.pause();}
function seekBySeconds(seconds){if(!currentAnalysis)return;elements.video.currentTime=Math.max(0,Math.min(currentAnalysis.media.duration,(elements.video.currentTime||0)+seconds));updatePlaybackUi();}
elements.video.addEventListener('click',toggleVideoPlayback);elements.video.addEventListener('keydown',event=>{if(event.code==='Space'){event.preventDefault();toggleVideoPlayback();}});elements.video.addEventListener('timeupdate',updatePlaybackUi);elements.seek.addEventListener('input',()=>{elements.video.currentTime=Number(elements.seek.value);updatePlaybackUi();});
elements.deathAiButton.addEventListener('click',runDeathAiAnalysis);
elements.deathReportButton.addEventListener('click',openDeathReport);
document.addEventListener('keydown',event=>{if((event.key!=='ArrowLeft'&&event.key!=='ArrowRight')||elements.reviewView.hidden||elements.mapEditorModal.open)return;const editingTarget=event.target instanceof HTMLElement&&event.target.matches('input:not(#seek),textarea,[contenteditable="true"]');if(editingTarget)return;event.preventDefault();seekBySeconds(event.key==='ArrowLeft'?-1:1);});
elements.chartHit.addEventListener('pointermove',renderChartHover);elements.chartHit.addEventListener('pointerleave',()=>{elements.chartHover.replaceChildren();});
elements.chartHit.addEventListener('pointerdown',event=>{if(!currentAnalysis)return;elements.video.currentTime=chartPointerState(event).time;updatePlaybackUi();});
elements.strongEditButton.addEventListener('click',()=>{closeMapEditors({restore:true});openMapEditor('有利なポジションを編集');elements.strongEditPanel.hidden=false;createStrongPosition();});
elements.strongNewButton.addEventListener('click',createStrongPosition);
elements.strongTitleInput.addEventListener('input',()=>{if(draftStrongSpot){draftStrongSpot.title=elements.strongTitleInput.value;renderStrongPositions();}});
elements.strongTipsInput.addEventListener('input',()=>{if(draftStrongSpot){draftStrongSpot.tips=elements.strongTipsInput.value;renderStrongPositions();}});
elements.strongPositionButton.addEventListener('click',()=>{if(!draftStrongSpot)return;setStrongMapMode('strong-position',draftStrongSpot.position?'ステップ1｜変更後のポジションをマップ上でクリック':'ステップ1｜マップ上の有利なポジションをクリック');});
elements.strongTargetButton.addEventListener('click',()=>{if(!draftStrongSpot?.position)return;setStrongMapMode('strong-target','ステップ2｜その位置から狙うターゲットをマップ上でクリック');});
elements.strongAddButton.addEventListener('click',async()=>{if(!draftStrongSpot?.position||!draftStrongSpot?.target)return;const previous=clonePositionPlan(currentPositionPlan),spot={...draftStrongSpot,id:draftStrongSpot.id&&draftStrongSpot.id!=='draft'?draftStrongSpot.id:`spot-${Date.now()}-${Math.random().toString(36).slice(2,7)}`,title:elements.strongTitleInput.value.trim(),tips:elements.strongTipsInput.value.trim()};if(draftStrongIndex==null)currentPositionPlan.strongPositions.push(spot);else currentPositionPlan.strongPositions.splice(draftStrongIndex,1,spot);elements.strongAddButton.disabled=true;if(!await savePositionPlan()){currentPositionPlan=previous;updateStrongEditorControls();renderStrongPositionList();renderStrongPositions();return;}clearStrongEditor();});
elements.editorMapOverlay.addEventListener('pointerdown',event=>{if(!mapEditMode)return;const bounds=elements.editorMapOverlay.getBoundingClientRect(),point={x:(event.clientX-bounds.left)/bounds.width*1000,y:(event.clientY-bounds.top)/bounds.height*1000};if(mapEditMode==='strong-position'&&draftStrongSpot){draftStrongSpot.position=point;draftStrongSpot.target=null;setStrongMapMode('strong-target','ステップ2｜位置を設定しました。次にターゲットをクリック');updateStrongEditorControls();}else if(mapEditMode==='strong-target'&&draftStrongSpot?.position){draftStrongSpot.target=point;setStrongMapMode('strong-target','ターゲットを設定しました。再クリックで調整、完了したら保存してください');updateStrongEditorControls();}renderStrongPositions();});
elements.editorStageMapImage.addEventListener('load',()=>{if(elements.editorStageMapImage.naturalWidth)elements.editorStageMapImage.parentElement.style.aspectRatio=`${elements.editorStageMapImage.naturalWidth}/${elements.editorStageMapImage.naturalHeight}`;});
elements.mapEditorModalClose.addEventListener('click',()=>closeMapEditors({restore:true}));
elements.mapEditorModal.addEventListener('cancel',event=>{event.preventDefault();closeMapEditors({restore:true});});
document.querySelectorAll('[data-review-target]').forEach(button=>button.addEventListener('click',()=>{
  const target=byId(button.dataset.reviewTarget)?.closest('.panel');
  target?.scrollIntoView({behavior:'smooth',block:'start'});
}));
byId('open-recordings-folder-button').addEventListener('click',async event=>{
  const button=event.currentTarget,status=byId('folder-open-status');
  button.disabled=true;status.hidden=true;status.textContent='';
  try{
    const response=await fetch('/api/open-recordings-folder',{method:'POST'});
    const result=await response.json();
    if(!response.ok)throw new Error(result.guidance||result.error||'録画フォルダを開けませんでした。');
  }catch(error){status.textContent=error.message||'録画フォルダを開けませんでした。エクスプローラーから data/raw を開いてください。';status.hidden=false;}
  finally{button.disabled=false;}
});
await refresh();
await syncReviewFromLocation();
window.addEventListener('popstate',()=>{void syncReviewFromLocation();});
setInterval(refresh,2000);
