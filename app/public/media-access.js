export function isLoopbackHostname(hostname) {
  const value = String(hostname || '').toLowerCase();
  return value === 'localhost' || value === '127.0.0.1' || value === '::1' || value === '[::1]';
}

export function videoSourcePreference() {
  try {
    const preference = globalThis.localStorage?.getItem('video-source');
    if (['auto', 'local', 'cloud'].includes(preference)) return preference;
  } catch {}
  return 'auto';
}

export function isRemoteAccess(locationLike = globalThis.location) {
  const preference = videoSourcePreference();
  if (preference === 'local') return false;
  if (preference === 'cloud') return true;
  return isRemoteHost(locationLike);
}

// Image delivery follows the same local/remote choice as video playback.
export function imageSourceUrl(url, size, remote = isRemoteAccess()) {
  if (!url || !remote) return url;
  return `${url}${url.includes('?') ? '&' : '?'}size=${encodeURIComponent(size)}`;
}

export function isRemoteHost(locationLike = globalThis.location) {
  const hostname = String(locationLike?.hostname || '').toLowerCase();
  const octets = hostname.split('.').map(Number);
  const privateIpv4 = octets.length === 4 && octets.every(n => Number.isInteger(n) && n >= 0 && n <= 255)
    && (octets[0] === 10 || (octets[0] === 192 && octets[1] === 168) || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31));
  return !(isLoopbackHostname(hostname) || privateIpv4 || hostname.endsWith('.local'));
}

export function cloudStatusText(state) {
  if (state?.status === 'paused') return 'R2転送を一時停止中';
  if (state?.message) return state.message;
  return ({ setup: 'クラウドの接続設定待ち', queued: 'クラウド転送待ち', preparing: 'クラウド用動画を準備中', uploading: 'クラウドへ転送中', verifying: 'クラウドの再生を確認中', capacity: 'クラウドの容量上限に達しました', ready: 'クラウドで再生可能', error: 'クラウド転送の再試行待ち', blocked: 'クラウドの設定を確認してください' })[state?.status] || 'クラウド転送待ち';
}

export function recordingDisplayState(recording) {
  const source = { ...recording, status: recording.localStatus ?? recording.status,
    phase: recording.localPhase ?? recording.phase, progress: recording.localProgress ?? recording.progress,
    matches: (recording.matches || []).map(match => ({ ...match, status: match.localStatus ?? match.status })) };
  const display = playbackRecording(source, true);
  return { status: display.status, phase: display.phase, progress: display.progress };
}

export function playbackRecording(recording, remote) {
  if (!remote) return recording;
  const matches = (recording.matches || []).map(match => ({ ...match, localStatus: match.status,
    status: match.status === 'ready' && match.cloud?.status !== 'ready' && !(recording.live && match.videoManifest?.fragments?.length) ? 'cloud-pending' : match.status }));
  const pending = matches.filter(match => match.localStatus === 'ready' && match.status !== 'ready');
  if (!pending.length) return { ...recording, matches };
  const readyCount = matches.filter(match => match.status === 'ready').length;
  return { ...recording, matches, localStatus: recording.status, localPhase: recording.phase, localProgress: recording.progress,
    status: recording.status === 'ready' ? 'cloud-pending' : recording.status,
    phase: `${readyCount}/${matches.length}試合がリモート再生可能・${cloudStatusText(pending[0].cloud)}`,
    progress: Math.min(recording.progress || 0, matches.length ? readyCount / matches.length : 0) };
}
