import { mountNotificationSettings } from './notifications.js';
import { isRemoteHost } from './media-access.js';
import { appUrl } from './app-path.js';
const screen = document.body.dataset.screen || '';

if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1', '::1'].includes(location.hostname))) {
  window.addEventListener('load', () => navigator.serviceWorker.register(appUrl('/sw.js'), { scope: appUrl('/') }).catch(() => {}));
}

const items = [
  { id: 'recordings', href: './index.html', icon: '▣', label: '録画ライブラリ', description: '録画と試合を確認' },
  { id: 'search', href: './search.html', icon: '⌕', label: '試合検索', description: '条件から試合を探す' },
  { id: 'analytics', href: './analytics.html', icon: '⌁', label: '分析ダッシュボード', description: '複数試合を集計' },
  { id: 'cloud', href: './cloud.html', icon: '▶', label: 'クラウド動画', description: '外出先の再生・転送状況' },
];

const toggle = document.querySelector('[data-navigation-toggle]');

if (toggle) {
  const overlay = document.createElement('div');
  overlay.className = 'app-navigation-overlay';
  overlay.hidden = true;
  const drawer = document.createElement('nav');
  drawer.id = 'app-navigation';
  drawer.className = 'app-navigation-drawer';
  drawer.setAttribute('aria-label', 'メインナビゲーション');
  const heading = document.createElement('header');
  heading.innerHTML = '<div><small>SPLATOON 3</small><strong>Battle Review</strong></div><button type="button" aria-label="メニューを閉じる">×</button>';
  const links = document.createElement('div');
  links.className = 'app-navigation-links';
  for (const item of items) {
    const link = document.createElement('a');
    link.href = item.href;
    link.classList.toggle('active', item.id === screen);
    if (item.id === screen) link.setAttribute('aria-current', 'page');
    link.innerHTML = `<i>${item.icon}</i><span><strong>${item.label}</strong><small>${item.description}</small></span>`;
    links.append(link);
  }
  if (screen === 'recordings' && !isRemoteHost()) {
    const action = document.createElement('button');
    action.type = 'button';
    action.className = 'app-navigation-action';
    action.innerHTML = '<i>＋</i><span><strong>録画を追加</strong><small>録画フォルダを開く</small></span>';
    action.addEventListener('click', () => document.getElementById('open-recordings-folder-button')?.click());
    links.append(action);
  }
  mountNotificationSettings(links);
  drawer.append(heading, links);
  overlay.append(drawer);
  document.body.append(overlay);

  const close = () => {
    overlay.classList.remove('is-open');
    toggle.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('navigation-open');
    setTimeout(() => { if (!overlay.classList.contains('is-open')) overlay.hidden = true; }, 180);
  };
  const open = () => {
    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add('is-open'));
    toggle.setAttribute('aria-expanded', 'true');
    document.body.classList.add('navigation-open');
    heading.querySelector('button').focus();
  };
  toggle.setAttribute('aria-controls', drawer.id);
  toggle.setAttribute('aria-expanded', 'false');
  toggle.addEventListener('click', () => overlay.classList.contains('is-open') ? close() : open());
  heading.querySelector('button').addEventListener('click', close);
  overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && overlay.classList.contains('is-open')) close(); });
}
