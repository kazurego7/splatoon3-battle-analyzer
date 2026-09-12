export const APP_MOUNT = '/sba';

export function appBase(locationLike = globalThis.location) {
  const pathname = locationLike?.pathname || '';
  return pathname === APP_MOUNT || pathname.startsWith(`${APP_MOUNT}/`) ? APP_MOUNT : '';
}

export function stripAppBase(value) {
  if (typeof value !== 'string') return value;
  return value === APP_MOUNT ? '/' : value.startsWith(`${APP_MOUNT}/`) ? value.slice(APP_MOUNT.length) : value;
}

export function appUrl(value, base = appBase()) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return value;
  const pathname = stripAppBase(value);
  return base + pathname;
}

// Rebase only application URLs in response data, never filesystem paths or prose.
export function appDataUrl(value, base = appBase()) {
  return typeof value === 'string' && /^\/(?:sba\/)?(?:api|media|assets|icons)\//.test(value) ? appUrl(value, base) : value;
}

export function appFetch(value, options) { return globalThis.fetch(appUrl(value), options); }

export function mountedHtml(html, base) {
  return html.replace(/\b(href|src|action)=(['"])(\/(?!\/)[^'"]*)\2/g, (_, attribute, quote, value) => `${attribute}=${quote}${appUrl(value, base)}${quote}`);
}
