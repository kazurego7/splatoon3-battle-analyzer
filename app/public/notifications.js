import { appFetch, appUrl } from './app-path.js';

export function mountNotificationSettings(container) {
  const section=document.createElement('section');section.className='notification-settings';
  const button=document.createElement('button');button.type='button';button.className='app-navigation-action';button.textContent='分析完了の通知を有効にする';button.disabled=true;
  const status=document.createElement('p');status.setAttribute('role','status');status.textContent='この端末の通知設定を確認しています…';
  section.append(button,status);container.append(section);
  const ios=/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  if(ios&&!matchMedia('(display-mode: standalone)').matches&&!navigator.standalone){status.textContent='iPhone・iPadはSafariで「ホーム画面に追加」し、追加したアイコンから通知を有効にしてください。';return;}
  if(!globalThis.isSecureContext||!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window)){status.textContent='通知に対応したブラウザーで開いてください。スマホはTailscaleのHTTPSアドレスを使ってください。';return;}
  let registration,subscription,publicKey;
  const api=async(method,body)=>{const response=await appFetch('/api/notifications',{method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});if(!response.ok)throw new Error('通知設定を保存できませんでした。接続を確認して再試行してください。');};
  const render=()=>{button.textContent=subscription?'この端末の通知を停止する':'分析完了の通知を有効にする';status.textContent=subscription?'通知は有効です。AI分析の完了後にお知らせします。':'有効にすると、分析ページを閉じても完了を通知します。';};
  button.addEventListener('click',async()=>{
    button.disabled=true;
    try {
      if(subscription){await api('DELETE',{endpoint:subscription.endpoint});await subscription.unsubscribe();subscription=null;}
      else {
        const permission=await Notification.requestPermission();
        if(permission!=='granted')throw new Error('通知が許可されていません。端末やブラウザーの設定で、このアプリの通知を許可してください。');
        const bytes=Uint8Array.from(atob(publicKey.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
        const next=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});
        try{await api('POST',next.toJSON());subscription=next;}catch(error){await next.unsubscribe();throw error;}
      }
      render();
    }catch(error){status.textContent=error.message;}finally{button.disabled=false;}
  });
  void(async()=>{
    try {
      const response=await appFetch('/api/notifications',{cache:'no-store'});if(!response.ok)throw new Error('通知機能を読み込めませんでした。ページを開き直してください。');
      ({publicKey}=await response.json());
      registration=await navigator.serviceWorker.register(appUrl('/sw.js'),{scope:appUrl('/')});
      // Wait for this scope's worker, without relying on a root-scope registration.
      if(!registration.active)await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('通知の準備に時間がかかっています。ページを開き直してください。')),15000);const worker=registration.installing||registration.waiting;if(!worker){clearTimeout(timeout);resolve();return;}worker.addEventListener('statechange',()=>{if(worker.state==='activated'){clearTimeout(timeout);resolve();}});});
      subscription=await registration.pushManager.getSubscription();
      if(subscription)await api('POST',subscription.toJSON());
      render();button.disabled=false;
    }catch(error){status.textContent=error.message;}
  })();
}
