export function isLoopbackHostname(hostname) {
  const value = String(hostname || '').toLowerCase();
  return value === 'localhost' || value === '127.0.0.1' || value === '::1' || value === '[::1]';
}

export function isRemoteAccess(locationLike = globalThis.location) {
  return !isLoopbackHostname(locationLike?.hostname);
}

export function preferredRemoteCodec(videoElement) {
  const support = videoElement?.canPlayType?.('video/mp4; codecs="hvc1"');
  return support === 'probably' || support === 'maybe' ? 'hevc' : 'h264';
}

function matchMediaParts(videoUrl) {
  const pathname = new URL(videoUrl, 'http://localhost').pathname;
  const match = pathname.match(/^\/media\/matches\/([^/]+)\/([^/]+)$/);
  return match ? { recordingId: decodeURIComponent(match[1]), fileName: decodeURIComponent(match[2]) } : null;
}

export function remoteVideoApiUrl(videoUrl, codec = 'h264') {
  const parts = matchMediaParts(videoUrl);
  return parts
    ? `/api/remote-video/${encodeURIComponent(parts.recordingId)}/${encodeURIComponent(parts.fileName)}?codec=${codec === 'hevc' ? 'hevc' : 'h264'}`
    : null;
}

export function remoteVideoMediaUrl(videoUrl, codec = 'h264') {
  const parts = matchMediaParts(videoUrl);
  return parts
    ? `/media/remote-matches/${codec === 'hevc' ? 'hevc' : 'h264'}/${encodeURIComponent(parts.recordingId)}/${encodeURIComponent(parts.fileName)}`
    : null;
}
