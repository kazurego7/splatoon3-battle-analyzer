import { resolveOutcomeLabel } from './outcome.js';
import { deathAnalysisControlState, deathAnalysisEndpoint, deathReportDigest, deathSeekTime, matchAnalysisBadge } from './death-analysis-ui.js';
import { killDeathFromAnalysis } from './player-stats-ui.js';
import { isRemoteAccess, preferredRemoteCodec, remoteVideoApiUrl } from './media-access.js';
import { stageMapAssetUrl } from './stage-map-ui.js';
import { patternReportModels } from './report-player.js';

const byId = id => document.getElementById(id);
const elements = {
  recordingList:byId('recording-list'), recordingCount:byId('recording-count'), empty:byId('empty-state'), recordingView:byId('recording-view'), reviewView:byId('review-view'),
  selectedTitle:byId('selected-title'), selectedStatus:byId('selected-status'), selectedProgress:byId('selected-progress'), error:byId('recording-error'), matchList:byId('match-list'),
  video:byId('match-video'), videoPanel:document.querySelector('.video-panel'), videoExpandButton:byId('video-expand-button'), mobileVideoExpandButton:byId('mobile-video-expand-button'), mobileDeathListButton:byId('mobile-death-list-button'), mobileDeathListCloseButton:byId('mobile-death-list-close-button'), videoCollapseButton:byId('video-collapse-button'), videoReviewControls:byId('video-review-controls'), videoNetworkStatus:byId('video-network-status'), videoNetworkStatusText:byId('video-network-status-text'), matchTitle:byId('match-title'), eventList:byId('event-list'), expandedDeathList:byId('expanded-death-list'), deathReportDigest:byId('death-report-digest'), deathAiButton:byId('death-ai-button'), deathAiStatus:byId('death-ai-status'), deathReportButton:byId('death-report-button'), currentTime:byId('current-time'), duration:byId('duration'), seek:byId('seek'),
  timelineProgress:byId('timeline-progress'), deathMarkers:byId('death-markers'), mobilePlaybackButton:byId('mobile-playback-button'), mobileSkipBackButton:byId('mobile-skip-back-button'), mobileSkipForwardButton:byId('mobile-skip-forward-button'), videoExpandTransition:byId('video-expand-transition'),
  analysisChart:byId('analysis-chart'), chartAdvantage:byId('chart-advantage'), chartGrid:byId('chart-grid'), chartCountSeries:byId('chart-count-series'), chartDeaths:byId('chart-deaths'), chartCursor:byId('chart-cursor'), chartHover:byId('chart-hover'), chartHit:byId('chart-hit'),
  capabilityList:byId('capability-list'), stageMapImage:byId('stage-map-image'), mapPlaceholder:byId('map-placeholder'), mapSourceStatus:byId('map-source-status'), mapOverlay:byId('map-overlay'), strongPositionLayer:byId('strong-position-layer'),
  strongEditButton:byId('strong-edit-button'), strongEditPanel:byId('strong-edit-panel'), strongEditInstruction:byId('strong-edit-instruction'), strongTitleInput:byId('strong-title-input'), strongTipsInput:byId('strong-tips-input'), strongPositionList:byId('strong-position-list'), strongPositionCount:byId('strong-position-count'), strongFormTitle:byId('strong-form-title'), strongFormContext:byId('strong-form-context'), strongNewButton:byId('strong-new-button'), strongPositionButton:byId('strong-position-button'), strongTargetButton:byId('strong-target-button'), strongAddButton:byId('strong-add-button'),
  positionSaveStatus:byId('position-save-status'),
  mapEditorModal:byId('map-editor-modal'), mapEditorModalTitle:byId('map-editor-modal-title'), mapEditorModalContext:byId('map-editor-modal-context'), mapEditorModalClose:byId('map-editor-modal-close'), editorStageMapImage:byId('editor-stage-map-image'), editorMapOverlay:byId('editor-map-overlay'), editorStrongPositionLayer:byId('editor-strong-position-layer'), modalSaveStatus:byId('modal-save-status'),
  screenTitle:byId('screen-title'), screenContext:byId('screen-context'), evidencePanel:document.querySelector('.evidence-panel'), mobileAnalysisReport:byId('mobile-analysis-report'), resultOutcome:byId('result-outcome'), resultStage:byId('result-stage'), resultRule:byId('result-rule'), resultKd:byId('result-kd'), resultAllies:byId('result-allies'), resultEnemies:byId('result-enemies'),
};

const labels = { queued:'待機中', probing:'確認中', splitting:'分割中', analyzing:'分析中', ready:'分析済み', error:'失敗' };
const chartHeight = 250;
let chartBounds = { width:1000, left:34, right:978, countTop:31, countBottom:176, labelY:203, hoverTop:218 };
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
let reviewWeaponIcons = null;
const remoteAccess = isRemoteAccess();
const remoteCodec = preferredRemoteCodec(elements.video);
let videoLoadGeneration = 0;
let currentPlaybackUrl = null;
let expandedControlsTimer = null;
let reviewOrientationTimer = null;
let reviewOrientationRecoveryUntil = 0;
let mobileTapTimer = null;
let lastMobileTapAt = 0;
let lastMobileTapSide = 0;
let chartSeekPointerId = null;
let mobileVideoScrub = null;
let suppressNextVideoClick = false;
const landscapeOrientation = window.matchMedia('(orientation: landscape)');

function formatTime(value) { const seconds=Math.max(0,Math.round(Number(value)||0)); return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`; }
function formatSize(value) { return value>=1e9?`${(value/1e9).toFixed(1)} GB`:`${(value/1e6).toFixed(0)} MB`; }
function wait(milliseconds) { return new Promise(resolve=>setTimeout(resolve,milliseconds)); }
function setVideoNetworkStatus(message=null,error=false) { if(!remoteAccess)return;elements.videoNetworkStatus.hidden=!message;elements.videoNetworkStatus.classList.toggle('error',error);elements.videoNetworkStatusText.textContent=message||''; }
function clearMatchVideo() { videoLoadGeneration+=1;currentPlaybackUrl=null;elements.video.pause();elements.video.removeAttribute('src');elements.video.removeAttribute('poster');elements.video.load();setVideoNetworkStatus(); }
async function loadMatchVideo(match) {
  const generation=++videoLoadGeneration;currentPlaybackUrl=null;elements.video.pause();elements.video.removeAttribute('src');elements.video.removeAttribute('poster');
  if(!remoteAccess){setVideoNetworkStatus();elements.video.preload='metadata';elements.video.src=match.videoUrl;currentPlaybackUrl=match.videoUrl;return;}
  elements.video.preload='none';if(match.thumbnailUrl)elements.video.poster=match.thumbnailUrl;setVideoNetworkStatus('ネットワーク用動画をこのPCで準備しています…');
  const endpoint=remoteVideoApiUrl(match.videoUrl,remoteCodec);if(!endpoint){setVideoNetworkStatus('動画URLを確認できませんでした。',true);return;}
  try{
    let response=await fetch(endpoint,{method:'POST'}),payload=await response.json();if(!response.ok)throw new Error(payload.error||payload.message||`HTTP ${response.status}`);
    while(payload.status==='preparing'||payload.status==='missing'){
      await wait(2000);if(generation!==videoLoadGeneration)return;
      response=await fetch(endpoint,{cache:'no-store'});payload=await response.json();if(!response.ok)throw new Error(payload.error||payload.message||`HTTP ${response.status}`);
    }
    if(generation!==videoLoadGeneration)return;if(payload.status!=='ready'||!payload.url)throw new Error(payload.message||'ネットワーク用動画を準備できませんでした');
    setVideoNetworkStatus('動画を読み込んでいます…');elements.video.preload='metadata';elements.video.src=payload.url;currentPlaybackUrl=payload.url;elements.video.load();
  }catch(error){if(generation===videoLoadGeneration)setVideoNetworkStatus(`動画を読み込めませんでした：${error.message}`,true);}
}
function clonePositionPlan(plan) { return JSON.parse(JSON.stringify(plan||{strongPositions:[],briefings:[]})); }
function svgElement(name,attributes={}) { const element=document.createElementNS('http://www.w3.org/2000/svg',name); Object.entries(attributes).forEach(([key,value])=>element.setAttribute(key,value)); return element; }
function setReviewMode(active,recording=null,match=null) { document.body.classList.toggle('is-review',active); elements.screenTitle.textContent=active?'試合レビュー':'録画ライブラリ';elements.screenContext.textContent=active&&recording&&match?`${recording.fileName} / 試合 ${String(match.number).padStart(2,'0')}`:'';elements.screenContext.hidden=!active; }
function setMobileReviewTab(tab='video') {
  elements.videoPanel.classList.remove('mobile-death-list-open');elements.mobileDeathListButton.setAttribute('aria-expanded','false');elements.reviewView.dataset.mobileTab=tab;document.querySelectorAll('[data-review-tab]').forEach(button=>{const active=button.dataset.reviewTab===tab;button.classList.toggle('is-active',active);button.setAttribute('aria-selected',String(active));});
  if(tab==='video')requestAnimationFrame(refreshChartLayout);
}
function showAnalysisList() { finishExpandedVideo();currentAnalysis=null;currentRecording=null;currentMatch=null;clearMatchVideo();elements.reviewView.hidden=true;setReviewMode(false);renderSelected(); }

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

function selectRecording(id) { selectedId=id; currentAnalysis=null; clearMatchVideo(); elements.reviewView.hidden=true; setReviewMode(false); renderRecordings(); renderSelected(); }

function matchCard(recording,match) {
  const ready=match.status==='ready',card=document.createElement('article');card.className=`match-card${ready?' is-clickable':''}`;card.tabIndex=ready?0:-1;card.setAttribute('role','button');card.setAttribute('aria-disabled',String(!ready));card.setAttribute('aria-label',`試合 ${String(match.number).padStart(2,'0')} の振り返りを開く`);
  const media=document.createElement('div');media.className='match-card-media';const image=document.createElement('img');image.alt=`試合${match.number}のサムネイル`;if(match.thumbnailUrl)image.src=match.thumbnailUrl;const preview=document.createElement('video');preview.className='match-card-preview';preview.muted=true;preview.loop=true;preview.playsInline=true;preview.preload='none';media.append(image,preview);
  const body=document.createElement('div'); body.className='match-card-body'; const top=document.createElement('div'); top.className='match-card-top'; const title=document.createElement('h3'); title.textContent=`試合 ${String(match.number).padStart(2,'0')}`;
  const badge=document.createElement('span'); const setBadge=analysis=>{const state=matchAnalysisBadge({ready,analysis});badge.className=`status-badge ${state.className}`.trim();badge.textContent=state.label;};setBadge();top.append(title,badge);
  const facts=document.createElement('div');facts.className='match-card-facts';facts.setAttribute('aria-live','polite');
  const setFacts=analysis=>{setBadge(analysis);const outcome=resolveOutcomeLabel(analysis),stage=analysis.stageMap?.stage||'ステージ未判定',rule=analysis.stageMap?.rule||'ルール未判定',weapon=analysis.playerIdentity?.weapon,weaponName=weapon?.status!=='candidate-only'&&weapon?.name?weapon.name:'ブキ未判定';facts.innerHTML='';const summaryRow=document.createElement('div');summaryRow.className='match-fact-row';[[outcome,'result'],[`${stage} / ${rule}`,'stage'],[killDeathFromAnalysis(analysis),'stats']].forEach(([text,className])=>{const item=document.createElement('span');item.className=`match-fact ${className}${text==='WIN'?' win':text==='LOSE'?' lose':''}`;item.textContent=text;summaryRow.append(item);});const weaponRow=document.createElement('div');weaponRow.className='match-fact-row weapon-row';const weaponItem=document.createElement('span');weaponItem.className='match-fact weapon';weaponItem.textContent=weaponName;weaponRow.append(weaponItem);facts.append(summaryRow,weaponRow);};
  const loadFacts=async()=>{if(!ready||!match.analysisUrl)return;try{let analysis=matchMetadataCache.get(match.analysisUrl);if(!analysis){analysis=await(await fetch(match.analysisUrl,{cache:'no-store'})).json();matchMetadataCache.set(match.analysisUrl,analysis);}setFacts(analysis);}catch(error){console.error(error);}};
  const stopPreview=()=>{preview.pause();preview.removeAttribute('src');preview.load();card.classList.remove('is-previewing');};
  const startPreview=()=>{if(remoteAccess||!ready||!match.videoUrl||preview.src)return;preview.src=match.videoUrl;preview.addEventListener('loadedmetadata',()=>{preview.currentTime=Math.min(8,Math.max(0,preview.duration-1));},{once:true});preview.play().then(()=>card.classList.add('is-previewing')).catch(()=>stopPreview());};
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

function syncChartViewport() {
  const rect=elements.analysisChart.getBoundingClientRect();
  const mobile=window.innerWidth<=700&&!elements.videoPanel.classList.contains('is-expanded'),fittedWidth=rect.width>0&&rect.height>0?rect.width/rect.height*chartHeight:1000,width=mobile?Math.max(360,Math.min(1000,fittedWidth)):Math.max(640,Math.min(2400,fittedWidth));chartBounds={width,left:width*.034,right:width*.978,countTop:mobile?38:34,countBottom:mobile?218:176,labelY:mobile?243:203,hoverTop:mobile?0:218};elements.analysisChart.setAttribute('viewBox',`0 0 ${width} ${chartHeight}`);elements.chartHit.setAttribute('x',chartBounds.left);elements.chartHit.setAttribute('width',chartBounds.right-chartBounds.left);
}
function refreshChartLayout() { syncChartViewport();if(!currentAnalysis)return;renderChart();updatePlaybackUi(); }

function addChartLabel(text,x,y,anchor='end',className='chart-text') { const label=svgElement('text',{x,y,'text-anchor':anchor,class:className});label.textContent=text;elements.chartGrid.append(label); }
function renderChart() {
  const duration=currentAnalysis.media.duration; const alive=currentAnalysis.gameFlow?.playerCounts||[]; const game=currentAnalysis.gameFlow?.gameCounts||[];const overlayCountLabels=window.innerWidth<=700&&!elements.videoPanel.classList.contains('is-expanded');
  elements.chartAdvantage.innerHTML=''; alive.forEach((item,index)=>{const end=alive[index+1]?.time??duration;if(end<=item.time)return;const difference=Math.max(-4,Math.min(4,item.difference||0)),strength=difference===0?.035:(.1+Math.abs(difference)*.11)*(item.source==='held'?.55:1);elements.chartAdvantage.append(svgElement('rect',{x:chartX(item.time),y:chartBounds.countTop,width:Math.max(0,chartX(end)-chartX(item.time)),height:chartBounds.countBottom-chartBounds.countTop,'fill-opacity':Number(strength.toFixed(3)),class:`chart-advantage ${difference>0?'positive':difference<0?'negative':'even'}`}));});
  elements.chartGrid.innerHTML='';
  [100,75,50,25,0].forEach(count=>{const y=gameY(count);elements.chartGrid.append(svgElement('line',{x1:chartBounds.left,x2:chartBounds.right,y1:y,y2:y,class:'chart-grid'}));addChartLabel(count,overlayCountLabels?chartBounds.left+6:chartBounds.left-8,y+5,overlayCountLabels?'start':'end',overlayCountLabels?'chart-text chart-count-label':'chart-text');});
  for(let index=0;index<=6;index+=1){const time=duration*index/6;addChartLabel(formatTime(time),chartX(time),chartBounds.labelY,index===0?'start':index===6?'end':'middle','chart-text chart-time-label');}
  elements.chartCountSeries.replaceChildren(
    svgElement('path',{d:penaltyPath(game,'teamCount','teamPenalty'),class:'chart-penalty-team'}),
    svgElement('path',{d:penaltyPath(game,'enemyCount','enemyPenalty'),class:'chart-penalty-enemy'}),
    svgElement('path',{d:stepPath(game,'teamCount',gameY),class:'chart-count-team'}),
    svgElement('path',{d:stepPath(game,'enemyCount',gameY),class:'chart-count-enemy'}),
  );
  elements.chartDeaths.replaceChildren(...currentAnalysis.events.filter(event=>event.type==='death').flatMap(event=>{const x=chartX(event.time);return [svgElement('line',{x1:x,x2:x,y1:chartBounds.countTop,y2:chartBounds.countBottom,class:'chart-death'}),svgElement('rect',{x:x-5,y:chartBounds.countTop-5,width:10,height:10,class:'chart-death-marker',transform:`rotate(45 ${x} ${chartBounds.countTop})`})];}));
}

function renderMapBase() {
  const map=currentAnalysis.stageMap;
  const imageUrl=stageMapAssetUrl(map);
  if(imageUrl){elements.stageMapImage.src=imageUrl;elements.stageMapImage.hidden=false;elements.mapPlaceholder.hidden=true;elements.mapSourceStatus.textContent=`${map.stage}｜${map.rule}`;}else{elements.stageMapImage.removeAttribute('src');elements.stageMapImage.hidden=true;elements.mapPlaceholder.hidden=false;elements.mapSourceStatus.textContent='ステージマップ未取得';}
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
  elements.mapEditorModalTitle.textContent=title;elements.mapEditorModalContext.textContent=`${currentAnalysis?.stageMap?.stage||''}｜${currentAnalysis?.stageMap?.rule||''}`;elements.editorStageMapImage.src=stageMapAssetUrl(currentAnalysis?.stageMap)||'';if(elements.editorStageMapImage.complete&&elements.editorStageMapImage.naturalWidth)elements.editorStageMapImage.parentElement.style.aspectRatio=`${elements.editorStageMapImage.naturalWidth}/${elements.editorStageMapImage.naturalHeight}`;elements.modalSaveStatus.textContent='';if(!elements.mapEditorModal.open)elements.mapEditorModal.showModal();
}

function closeMapEditors({restore=false}={}) {
  if(restore)currentPositionPlan=clonePositionPlan(savedPositionPlan);
  elements.strongEditPanel.hidden=true;mapEditMode=null;draftStrongSpot=null;draftStrongIndex=null;elements.strongTitleInput.value='';elements.strongTipsInput.value='';elements.editorMapOverlay.classList.remove('position-editing','strong-editing','picking-position','picking-target');if(elements.mapEditorModal.open)elements.mapEditorModal.close();updateStrongEditorControls();renderStrongPositions();
}

function deathTitle(event) { return event.title==='自分がデス'?'原因未分析のデス':event.title; }
function selectDeathEvent(event,key) {
  selectedDeathKey=key;
  [...elements.eventList.children,...elements.expandedDeathList.children].forEach(button=>{const active=button.dataset.deathKey===key;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
  elements.videoPanel.classList.remove('mobile-death-list-open');elements.mobileDeathListButton.setAttribute('aria-expanded','false');
  elements.video.currentTime=deathSeekTime(event,-8,currentAnalysis.media.duration);updatePlaybackUi();
}
function deathEventButton(event,key) {
  const button=document.createElement('button');button.type='button';button.className='event-item death';button.dataset.deathKey=key;button.title=`${formatTime(event.time)} ${deathTitle(event)}`;button.setAttribute('aria-pressed',String(key===selectedDeathKey));button.classList.toggle('active',key===selectedDeathKey);const time=document.createElement('span');time.className='event-time';time.textContent=formatTime(event.time);const title=document.createElement('strong');title.textContent=deathTitle(event);button.append(time,title);button.addEventListener('click',()=>selectDeathEvent(event,key));return button;
}
function renderEvents(preferredKey=null) {
  const deaths=currentAnalysis.events.filter(event=>event.type==='death'),keys=deaths.map((event,index)=>String(event.id||`${event.time}-${index}`));
  selectedDeathKey=preferredKey&&keys.includes(preferredKey)?preferredKey:null;
  elements.eventList.replaceChildren(...deaths.map((event,index)=>deathEventButton(event,keys[index])));
  elements.expandedDeathList.replaceChildren(...deaths.map((event,index)=>deathEventButton(event,keys[index])));
}
function reportNode(name,className,text) { const element=document.createElement(name);if(className)element.className=className;if(text!=null)element.textContent=text;return element; }
function mobileReportFlowItem(label,value,tone) { const item=reportNode('div',`mobile-report-flow-item ${tone}`);item.append(reportNode('span','',label),reportNode('p','',value||'該当情報なし'));return item; }
function renderMobileAnalysisReport() {
  const report=currentAnalysis?.deathAnalysis,patterns=report?patternReportModels(currentAnalysis):[],videoUrl=currentPlaybackUrl||currentMatch?.videoUrl||'';elements.mobileAnalysisReport.hidden=!report;elements.evidencePanel.classList.toggle('mobile-has-report',Boolean(report));elements.mobileAnalysisReport.replaceChildren();if(!report)return;
  const overview=reportNode('header','mobile-report-overview');const title=reportNode('div');title.append(reportNode('p','eyebrow','OVERVIEW REPORT'),reportNode('h3','','俯瞰レポート'));overview.append(title,reportNode('span','mobile-report-meta',`${patterns.length}パターン`),reportNode('p','mobile-report-summary',report.overallSummary||'全体要約はありません。'));elements.mobileAnalysisReport.append(overview);
  if(!patterns.length){elements.mobileAnalysisReport.append(reportNode('p','mobile-report-empty','この試合では、2回以上繰り返した失敗パターンは見つかりませんでした。'));return;}
  patterns.forEach((pattern,index)=>{const card=reportNode('details','mobile-pattern-report');card.open=index===0;const heading=reportNode('summary','mobile-pattern-heading');const headingCopy=reportNode('div');headingCopy.append(reportNode('span','',`PATTERN ${String(pattern.reportIndex).padStart(2,'0')}`),reportNode('strong','',pattern.title));heading.append(headingCopy,reportNode('small','',`根拠 ${pattern.resolvedClips.length}シーン`));const body=reportNode('div','mobile-pattern-body');body.append(reportNode('p','mobile-pattern-summary',pattern.summary));const flow=reportNode('div','mobile-report-flow');flow.append(mobileReportFlowItem('きっかけ',pattern.trigger,'trigger'),mobileReportFlowItem('繰り返した行動',pattern.repeatedAction,'action'),mobileReportFlowItem('結果',pattern.consequence,'consequence'));const focus=reportNode('section','mobile-report-focus');focus.append(reportNode('strong','','映像で確認するポイント'),reportNode('p','',pattern.reviewFocus));body.append(flow,focus);let reportVideo=null,activeClip=null,clipButtons=[];if(videoUrl&&pattern.resolvedClips.length){const videoShell=reportNode('div','mobile-report-video-shell');reportVideo=document.createElement('video');reportVideo.preload='metadata';reportVideo.playsInline=true;reportVideo.controls=true;reportVideo.src=videoUrl;videoShell.append(reportVideo);body.append(videoShell);reportVideo.addEventListener('timeupdate',()=>{if(activeClip&&reportVideo.currentTime>=activeClip.end-.05)reportVideo.currentTime=activeClip.start;});}if(pattern.resolvedClips.length){const clips=reportNode('div','mobile-report-clips');clips.append(reportNode('strong','','根拠シーン'));pattern.resolvedClips.forEach(clip=>{const button=reportNode('button','mobile-report-clip');button.type='button';button.append(reportNode('span','',clip.label),reportNode('small','',`${formatTime(clip.start)}–${formatTime(clip.end)}`));clipButtons.push(button);button.addEventListener('click',()=>{if(!reportVideo){elements.video.currentTime=clip.start;updatePlaybackUi();setMobileReviewTab('video');return;}activeClip=clip;clipButtons.forEach(item=>item.classList.toggle('active',item===button));reportVideo.currentTime=clip.start;reportVideo.play().catch(()=>{});});clips.append(button);});body.append(clips);}card.append(heading,body);elements.mobileAnalysisReport.append(card);});
}
function renderDeathAnalysisSummary() {
  const analysis=currentAnalysis?.deathAnalysis,deaths=currentAnalysis?.events?.filter(event=>event.type==='death')||[],analysisUrl=currentMatch?.analysisUrl||'',state=deathAnalysisControlState({analysis,deathCount:deaths.length,jobState:currentAnalysis?.deathAnalysisState,localError:deathAnalysisErrors.get(analysisUrl)});elements.deathAiButton.hidden=!state.showAnalyze;elements.deathAiButton.disabled=state.analyzeDisabled;elements.deathAiButton.textContent=state.analyzeLabel;elements.deathReportButton.hidden=!state.showReport;elements.deathReportButton.disabled=!state.showReport;elements.deathReportButton.title=state.showReport?'失敗パターンを別ウィンドウで開く':'';elements.deathAiStatus.hidden=!state.status;elements.deathAiStatus.classList.toggle('error',state.statusIsError);elements.deathAiStatus.textContent=state.status;
  elements.deathAiButton.closest('.death-report-digest').classList.toggle('awaiting-analysis',state.showAnalyze);
  elements.deathReportDigest.hidden=!analysis&&deaths.length>0;elements.deathReportDigest.textContent=analysis?deathReportDigest(currentAnalysis):deaths.length?'':'分析できるデスがありません。';
  renderMobileAnalysisReport();
}
function openDeathReport() { if(!currentMatch||!currentAnalysis?.deathAnalysis)return;if(remoteAccess&&!currentPlaybackUrl){elements.deathAiStatus.hidden=false;elements.deathAiStatus.classList.add('error');elements.deathAiStatus.textContent='ネットワーク用動画の準備完了後にレポートを開いてください。';return;}const query=new URLSearchParams({analysis:currentMatch.analysisUrl,video:currentPlaybackUrl||currentMatch.videoUrl,title:`${currentRecording.fileName} / 試合 ${String(currentMatch.number).padStart(2,'0')}`});const report=window.open(`/report.html?${query}`,'_blank');if(report)report.opener=null;else{elements.deathAiStatus.hidden=false;elements.deathAiStatus.classList.add('error');elements.deathAiStatus.textContent='ポップアップがブロックされました。ブラウザで許可してください。';} }
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
function renderCapabilities() { const names={segmentation:'試合分割',matchOutcome:'勝敗発表',deaths:'本人デス判定',deathExplanation:'デスの状況・原因',playerWeapon:'自分のブキ',playerCounts:'生存人数',gameCountOcr:'ゲームカウント',stageMap:'ステージマップ'};elements.capabilityList.replaceChildren(...Object.entries(currentAnalysis.capabilities||{}).filter(([key])=>key in names).map(([key,value])=>{const row=document.createElement('div');row.className='capability';const name=document.createElement('strong');name.textContent=names[key];const state=document.createElement('span');const unavailable=value.includes('not-yet')||value.startsWith('unavailable');state.className=unavailable?'limited':'available';state.textContent=unavailable?'未対応':'利用可能';row.append(name,state);return row;})); }

async function loadReviewWeaponIcons() {
  if(reviewWeaponIcons)return reviewWeaponIcons;
  try{const response=await fetch('/api/analytics/weapons',{cache:'no-store'}),payload=response.ok?await response.json():{weapons:[]};reviewWeaponIcons=new Map((payload.weapons||[]).map(weapon=>[weapon.name,weapon.iconUrl]));}
  catch{reviewWeaponIcons=new Map();}
  return reviewWeaponIcons;
}

function resultWeapon(name,isSelf=false) {
  const item=document.createElement('span');item.className=`result-weapon${isSelf?' is-self':''}`;item.title=isSelf?`自分：${name}`:name;item.setAttribute('aria-label',item.title);
  const icon=reviewWeaponIcons?.get(name);if(icon){const image=document.createElement('img');image.src=icon;image.alt='';item.append(image);}else{item.textContent='?';}
  const label=document.createElement('span');label.textContent=name;item.append(label);
  return item;
}

function renderMatchResult() {
  const outcome=resolveOutcomeLabel(currentAnalysis);elements.resultOutcome.textContent=outcome;elements.resultOutcome.className=`result-outcome ${outcome==='WIN'?'win':outcome==='LOSE'?'lose':'unknown'}`;
  elements.resultStage.textContent=currentAnalysis.stageMap?.stage||'ステージ未取得';elements.resultRule.textContent=currentAnalysis.stageMap?.rule||'ルール未取得';elements.resultKd.textContent=killDeathFromAnalysis(currentAnalysis).replace(/^K\/D\s*/, '');
  const roster=currentAnalysis.weaponRoster,selfWeapon=currentAnalysis.playerIdentity?.weapon,selfName=selfWeapon?.status!=='candidate-only'?selfWeapon?.name:null;
  const missing=()=>{const item=document.createElement('span');item.className='result-roster-missing';item.textContent='編成未取得';return item;};
  const allies=[];if(selfName)allies.push(resultWeapon(selfName,true));if(roster?.complete)allies.push(...(roster.allyWeapons||[]).map(name=>resultWeapon(name)));else allies.push(missing());
  elements.resultAllies.replaceChildren(...allies);elements.resultEnemies.replaceChildren(...(roster?.complete?(roster.enemyWeapons||[]).map(name=>resultWeapon(name)):[missing()]));
}

async function openMatch(recording,match) {
  closeMapEditors({restore:true});currentRecording=recording;currentMatch=match;currentAnalysis=matchMetadataCache.get(match.analysisUrl)||await(await fetch(match.analysisUrl,{cache:'no-store'})).json();matchMetadataCache.set(match.analysisUrl,currentAnalysis);await loadReviewWeaponIcons();selectedDeathKey=null;elements.recordingView.hidden=true;elements.reviewView.hidden=false;setReviewMode(true,recording,match);const reviewUrl=`/?recording=${encodeURIComponent(recording.id)}&match=${encodeURIComponent(match.number)}`;if(`${location.pathname}${location.search}`!==reviewUrl)history.pushState({review:true},'',reviewUrl);elements.matchTitle.textContent=`${recording.fileName} / 試合 ${String(match.number).padStart(2,'0')}`;renderMatchResult();void loadMatchVideo(match);elements.seek.max=currentAnalysis.media.duration;elements.duration.textContent=formatTime(currentAnalysis.media.duration);
  elements.deathMarkers.replaceChildren(...currentAnalysis.events.filter(event=>event.type==='death').map(event=>{const marker=document.createElement('span');marker.className='death-track-marker';marker.style.left=`${event.time/currentAnalysis.media.duration*100}%`;return marker;}));
  setMobileReviewTab('video');syncChartViewport();renderChart();renderMapBase();await loadPositionPlan();renderDeathAnalysisSummary();renderEvents();updatePlaybackUi();requestAnimationFrame(syncExpandedVideoToOrientation);if(['sequences','report'].includes(currentAnalysis.deathAnalysisState?.status))void monitorDeathAiAnalysis(match.analysisUrl);
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
  const alive=playerCountAt(time),difference=alive?(alive.difference>0?`${alive.difference}枚有利`:alive.difference<0?`${Math.abs(alive.difference)}枚不利`:'五分'):'—',game=gameCountAt(time),cursorX=chartX(time);
  syncMobilePlaybackButton();
  const largeMobileLabel=window.innerWidth<=700&&!elements.videoPanel.classList.contains('is-expanded'),labelWidth=largeMobileLabel?105:100,labelHeight=largeMobileLabel?28:24,labelY=largeMobileLabel?19:16,labelHalf=labelWidth/2,labelX=Math.max(chartBounds.left+labelHalf,Math.min(chartBounds.right-labelHalf,cursorX)),advantageClass=!game?'unknown':alive?(alive.difference>0?'positive':alive.difference<0?'negative':'even'):'unknown',cursorLine=svgElement('line',{x1:cursorX,x2:cursorX,y1:chartBounds.countTop,y2:chartBounds.countBottom,class:'chart-cursor'}),labelBg=svgElement('rect',{x:labelX-labelHalf,y:0,width:labelWidth,height:labelHeight,rx:8,class:`chart-cursor-label-bg ${advantageClass}`}),label=svgElement('text',{x:labelX,y:labelY,'text-anchor':'middle',class:'chart-cursor-label'});label.textContent=difference;elements.chartCursor.replaceChildren(cursorLine,labelBg,label);
}

function chartPointerState(event) {
  const svg=event.currentTarget.closest('svg'),bounds=svg.getBoundingClientRect(),plotLeft=bounds.left+bounds.width*(chartBounds.left/chartBounds.width),plotWidth=bounds.width*((chartBounds.right-chartBounds.left)/chartBounds.width),ratio=Math.max(0,Math.min(1,(event.clientX-plotLeft)/plotWidth)),time=ratio*currentAnalysis.media.duration;
  return { time, x:chartX(time) };
}
function renderChartHover(event) {
  if(!currentAnalysis)return;const {time,x}=chartPointerState(event),game=gameCountAt(time),alive=playerCountAt(time),mobile=window.innerWidth<=700&&!elements.videoPanel.classList.contains('is-expanded'),advantageClass=!game?'unknown':alive?(alive.difference>0?'positive':alive.difference<0?'negative':'even'):'unknown',boxWidth=mobile?Math.min(280,chartBounds.right-chartBounds.left):410,boxHeight=mobile?28:26,boxX=Math.max(chartBounds.left,Math.min(chartBounds.right-boxWidth,x-boxWidth/2)),line=svgElement('line',{x1:x,x2:x,y1:chartBounds.countTop,y2:chartBounds.countBottom,class:'chart-hover-line'}),background=svgElement('rect',{x:boxX,y:chartBounds.hoverTop,width:boxWidth,height:boxHeight,rx:8,class:`chart-hover-bg ${advantageClass}`}),label=svgElement('text',{x:boxX+boxWidth/2,y:chartBounds.hoverTop+(mobile?19:17),'text-anchor':'middle',class:'chart-hover-text'});
  label.textContent=game?`${formatTime(time)}｜味方 ${game.teamCount}（+${game.teamPenalty||0}）｜相手 ${game.enemyCount}（+${game.enemyPenalty||0}）`:`${formatTime(time)}｜カウントデータなし`;elements.chartHover.replaceChildren(line,background,label);
}
function seekChartFromPointer(event) {
  if(!currentAnalysis)return;elements.video.currentTime=chartPointerState(event).time;updatePlaybackUi();renderChartHover(event);
}
function finishChartSeek(event) {
  if(chartSeekPointerId!==event.pointerId)return;try{elements.chartHit.releasePointerCapture?.(event.pointerId);}catch{}chartSeekPointerId=null;
  if(event.pointerType!=='mouse')elements.chartHover.replaceChildren();
}

async function refresh(){try{const nextRecordings=await(await fetch('/api/recordings')).json(),changed=JSON.stringify(nextRecordings)!==JSON.stringify(recordings);recordings=nextRecordings;if(changed)renderRecordings();}catch(error){console.error(error);}}
function toggleVideoPlayback(){if(elements.video.paused)elements.video.play().catch(console.error);else elements.video.pause();}
function seekBySeconds(seconds){if(!currentAnalysis)return;elements.video.currentTime=Math.max(0,Math.min(currentAnalysis.media.duration,(elements.video.currentTime||0)+seconds));updatePlaybackUi();}
function syncMobilePlaybackButton(){const playing=!elements.video.paused&&!elements.video.ended;elements.mobilePlaybackButton.dataset.playing=String(playing);elements.mobilePlaybackButton.setAttribute('aria-label',playing?'一時停止':'再生');}
function isMobileVideoExperience(){return window.matchMedia('(max-width: 700px), (pointer: coarse)').matches;}
function settleReviewLayoutAfterOrientation() {
  clearTimeout(reviewOrientationTimer);reviewOrientationTimer=setTimeout(()=>{
    if(!currentAnalysis||elements.reviewView.hidden||elements.videoPanel.classList.contains('is-expanded'))return;
    renderMatchResult();void elements.resultAllies.offsetWidth;requestAnimationFrame(refreshChartLayout);
  },220);
}
async function syncExpandedVideoToOrientation(){
  if(!currentAnalysis||elements.reviewView.hidden||!isMobileVideoExperience())return;
  if(landscapeOrientation.matches)await expandVideo();else{
    reviewOrientationRecoveryUntil=performance.now()+1600;
    if(elements.videoPanel.classList.contains('is-expanded'))await collapseVideo();
    settleReviewLayoutAfterOrientation();
  }
}
function setExpandedControlsVisible(visible,{autoHide=false}={}) {
  clearTimeout(expandedControlsTimer);expandedControlsTimer=null;elements.videoPanel.classList.toggle('expanded-controls-visible',visible);
  if(visible&&autoHide)expandedControlsTimer=setTimeout(()=>elements.videoPanel.classList.remove('expanded-controls-visible'),3200);
}
function finishExpandedVideo() {
  clearTimeout(expandedControlsTimer);clearTimeout(mobileTapTimer);expandedControlsTimer=null;mobileTapTimer=null;lastMobileTapAt=0;lastMobileTapSide=0;elements.videoPanel.classList.remove('is-expanded','is-mobile-expanded','expanded-controls-visible');document.body.classList.remove('is-video-expanded');elements.videoExpandButton.setAttribute('aria-expanded','false');elements.mobileVideoExpandButton.setAttribute('aria-expanded','false');
  requestAnimationFrame(refreshChartLayout);
}
async function expandVideo() {
  if(!currentAnalysis||elements.videoPanel.classList.contains('is-expanded'))return;const mobile=isMobileVideoExperience();elements.videoPanel.classList.remove('mobile-death-list-open');elements.videoPanel.classList.add('is-expanded');elements.videoPanel.classList.toggle('is-mobile-expanded',mobile);document.body.classList.add('is-video-expanded');elements.videoExpandButton.setAttribute('aria-expanded','true');elements.mobileVideoExpandButton.setAttribute('aria-expanded','true');setExpandedControlsVisible(mobile,{autoHide:mobile});
  try{if(!mobile&&!document.fullscreenElement&&elements.videoPanel.requestFullscreen)await elements.videoPanel.requestFullscreen({navigationUI:'hide'});}catch{}
  requestAnimationFrame(refreshChartLayout);
}
async function expandVideoFromButton() {
  if(!currentAnalysis||elements.videoPanel.classList.contains('is-expanded')||elements.videoExpandButton.disabled)return;
  if(isMobileVideoExperience()){
    elements.videoExpandButton.disabled=true;elements.videoExpandTransition.setAttribute('aria-hidden','false');document.body.classList.add('is-preparing-video-expand');
    await wait(700);
    document.body.classList.remove('is-preparing-video-expand');elements.videoExpandTransition.setAttribute('aria-hidden','true');elements.videoExpandButton.disabled=false;
  }
  await expandVideo();
}
async function collapseVideo() {
  if(document.fullscreenElement===elements.videoPanel){try{await document.exitFullscreen();}catch{}}finishExpandedVideo();
}
function handleVideoClick(event) {
  if(suppressNextVideoClick){suppressNextVideoClick=false;event.preventDefault();return;}
  if(elements.videoPanel.classList.contains('is-expanded')&&elements.videoPanel.classList.contains('is-mobile-expanded')){
    const now=performance.now(),side=event.offsetX<elements.video.clientWidth/2?-1:1,doubleTap=now-lastMobileTapAt<320&&side===lastMobileTapSide;clearTimeout(mobileTapTimer);
    if(doubleTap){lastMobileTapAt=0;lastMobileTapSide=0;seekBySeconds(side*10);setExpandedControlsVisible(true,{autoHide:true});return;}
    lastMobileTapAt=now;lastMobileTapSide=side;mobileTapTimer=setTimeout(()=>{setExpandedControlsVisible(!elements.videoPanel.classList.contains('expanded-controls-visible'),{autoHide:true});lastMobileTapAt=0;lastMobileTapSide=0;},240);return;
  }
  toggleVideoPlayback();
}
function handleExpandedVideoPointerDown(event) {
  if(!currentAnalysis||!elements.videoPanel.classList.contains('is-mobile-expanded')||event.button!==0)return;
  mobileVideoScrub={pointerId:event.pointerId,startX:event.clientX,startTime:elements.video.currentTime||0,moved:false};try{elements.video.setPointerCapture?.(event.pointerId);}catch{}
}
function handleExpandedVideoPointerMove(event) {
  if(!mobileVideoScrub||mobileVideoScrub.pointerId!==event.pointerId)return;const deltaX=event.clientX-mobileVideoScrub.startX;if(!mobileVideoScrub.moved&&Math.abs(deltaX)<8)return;
  mobileVideoScrub.moved=true;event.preventDefault();elements.video.currentTime=Math.max(0,Math.min(currentAnalysis.media.duration,mobileVideoScrub.startTime+deltaX/Math.max(1,elements.video.clientWidth)*currentAnalysis.media.duration));updatePlaybackUi();setExpandedControlsVisible(true,{autoHide:true});
}
function finishExpandedVideoScrub(event) {
  if(!mobileVideoScrub||mobileVideoScrub.pointerId!==event.pointerId)return;const moved=mobileVideoScrub.moved;try{elements.video.releasePointerCapture?.(event.pointerId);}catch{}mobileVideoScrub=null;
  if(moved){suppressNextVideoClick=true;setTimeout(()=>{suppressNextVideoClick=false;},0);}
}
elements.videoExpandButton.addEventListener('click',expandVideoFromButton);elements.mobileVideoExpandButton.addEventListener('click',expandVideoFromButton);elements.videoCollapseButton.addEventListener('click',collapseVideo);
elements.mobileDeathListButton.addEventListener('click',()=>{const open=elements.videoPanel.classList.toggle('mobile-death-list-open');elements.mobileDeathListButton.setAttribute('aria-expanded',String(open));});elements.mobileDeathListCloseButton.addEventListener('click',()=>{elements.videoPanel.classList.remove('mobile-death-list-open');elements.mobileDeathListButton.setAttribute('aria-expanded','false');});
elements.mobileSkipBackButton.addEventListener('click',()=>{seekBySeconds(-10);setExpandedControlsVisible(true,{autoHide:true});});elements.mobilePlaybackButton.addEventListener('click',()=>{toggleVideoPlayback();setExpandedControlsVisible(true,{autoHide:true});});elements.mobileSkipForwardButton.addEventListener('click',()=>{seekBySeconds(10);setExpandedControlsVisible(true,{autoHide:true});});
document.addEventListener('fullscreenchange',()=>{if(elements.videoPanel.classList.contains('is-expanded')&&document.fullscreenElement!==elements.videoPanel)finishExpandedVideo();else if(elements.videoPanel.classList.contains('is-expanded'))requestAnimationFrame(refreshChartLayout);});
function handleReviewViewportResize(){
  if(!currentAnalysis||elements.reviewView.hidden)return;requestAnimationFrame(refreshChartLayout);
  if(!elements.videoPanel.classList.contains('is-expanded')&&performance.now()<reviewOrientationRecoveryUntil)settleReviewLayoutAfterOrientation();
}
window.addEventListener('resize',handleReviewViewportResize);window.visualViewport?.addEventListener('resize',handleReviewViewportResize);
if(landscapeOrientation.addEventListener)landscapeOrientation.addEventListener('change',syncExpandedVideoToOrientation);else landscapeOrientation.addListener(syncExpandedVideoToOrientation);
elements.video.addEventListener('pointerdown',handleExpandedVideoPointerDown);elements.video.addEventListener('pointermove',handleExpandedVideoPointerMove);elements.video.addEventListener('pointerup',finishExpandedVideoScrub);elements.video.addEventListener('pointercancel',finishExpandedVideoScrub);
elements.video.addEventListener('click',handleVideoClick);elements.video.addEventListener('dblclick',event=>event.preventDefault());elements.video.addEventListener('keydown',event=>{if(event.code==='Space'){event.preventDefault();toggleVideoPlayback();}});elements.video.addEventListener('timeupdate',updatePlaybackUi);elements.video.addEventListener('play',syncMobilePlaybackButton);elements.video.addEventListener('pause',syncMobilePlaybackButton);elements.video.addEventListener('ended',syncMobilePlaybackButton);elements.seek.addEventListener('input',()=>{elements.video.currentTime=Number(elements.seek.value);updatePlaybackUi();});
elements.video.addEventListener('loadeddata',()=>setVideoNetworkStatus());elements.video.addEventListener('playing',()=>setVideoNetworkStatus());elements.video.addEventListener('waiting',()=>{if(remoteAccess&&currentPlaybackUrl)setVideoNetworkStatus('通信中…');});elements.video.addEventListener('error',()=>{if(remoteAccess&&currentPlaybackUrl)setVideoNetworkStatus('動画の読み込みに失敗しました。再度試合を開いてください。',true);});
elements.deathAiButton.addEventListener('click',runDeathAiAnalysis);
elements.deathReportButton.addEventListener('click',openDeathReport);
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&elements.videoPanel.classList.contains('is-expanded')&&!document.fullscreenElement){void collapseVideo();return;}if((event.key!=='ArrowLeft'&&event.key!=='ArrowRight')||elements.reviewView.hidden||elements.mapEditorModal.open)return;const editingTarget=event.target instanceof HTMLElement&&event.target.matches('input:not(#seek),textarea,[contenteditable="true"]');if(editingTarget)return;event.preventDefault();seekBySeconds(event.key==='ArrowLeft'?-1:1);});
elements.chartHit.addEventListener('pointerdown',event=>{if(!currentAnalysis||event.button!==0)return;event.preventDefault();chartSeekPointerId=event.pointerId;try{elements.chartHit.setPointerCapture?.(event.pointerId);}catch{}seekChartFromPointer(event);});
elements.chartHit.addEventListener('pointermove',event=>{if(chartSeekPointerId===event.pointerId){event.preventDefault();seekChartFromPointer(event);}else if(event.pointerType==='mouse')renderChartHover(event);});
elements.chartHit.addEventListener('pointerup',finishChartSeek);elements.chartHit.addEventListener('pointercancel',finishChartSeek);elements.chartHit.addEventListener('pointerleave',()=>{if(chartSeekPointerId==null)elements.chartHover.replaceChildren();});
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
document.querySelectorAll('[data-review-target]').forEach(button=>button.addEventListener('click',()=>setMobileReviewTab(button.dataset.reviewTab)));
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
