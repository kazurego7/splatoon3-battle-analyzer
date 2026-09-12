import { appUrl, stripAppBase } from './app-path.js';
// Retain the native player and its DOM events, with optional match-relative seeking.
// A fresh redirect renews an expired R2 URL without putting video bytes through the PC.
export function mediaController(element, { offset = 0, controls } = {}) {
  if (controls !== undefined) element.controls = controls;
  let source = '', lastRenewed = 0, generation = 0, resume = false, renewCleanup;
  const cloud = () => stripAppBase(source).startsWith('/api/cloud/') && source.includes('/play');
  function renew() {
    if (!cloud() || Date.now() - lastRenewed < 60000) return;
    const time = element.currentTime, wasPlaying = resume || !element.paused, current = generation;
    renewCleanup?.(); lastRenewed = Date.now();
    const restore = () => { renewCleanup?.(); if (current !== generation) return; element.currentTime = time; if (wasPlaying) element.play().catch(() => {}); };
    renewCleanup = () => { element.removeEventListener('loadedmetadata', restore); renewCleanup = null; };
    element.addEventListener('loadedmetadata', restore);
    element.src = `${source}${source.includes('?') ? '&' : '?'}renew=${lastRenewed}`; element.load();
  }
  element.addEventListener('playing', () => { resume = true; });
  element.addEventListener('pause', () => { if (!element.error) resume = false; });
  element.addEventListener('error', renew);
  element.addEventListener('play', () => { if (Date.now() - lastRenewed > 23 * 3600000) renew(); });
  return new Proxy(element, {
    get(target, key) {
      if (key === 'currentTime' && offset) return Math.max(0, target.currentTime - offset);
      if (key === 'removeAttribute') return name => { if (name === 'src') { generation++; source = ''; renewCleanup?.(); } target.removeAttribute(name); };
      const value = Reflect.get(target, key, target); return typeof value === 'function' ? value.bind(target) : value;
    },
    set(target, key, value) {
      if (key === 'src') { generation++; source = appUrl(String(value)); value = source; lastRenewed = Date.now(); resume = false; renewCleanup?.(); }
      return Reflect.set(target, key, key === 'currentTime' && offset ? Number(value) + offset : value, target);
    },
  });
}
