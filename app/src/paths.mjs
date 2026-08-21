import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PROJECT_ROOT = path.resolve(APP_ROOT, '..');
export const PUBLIC_ROOT = path.join(APP_ROOT, 'public');
export const DATA_ROOT = process.env.SPLATOON_DATA_ROOT
  ? path.resolve(process.env.SPLATOON_DATA_ROOT)
  : path.join(PROJECT_ROOT, 'data');
export const RAW_ROOT = path.join(DATA_ROOT, 'raw');
export const MATCH_ROOT = path.join(DATA_ROOT, 'matches');
export const APP_DATA_ROOT = path.join(DATA_ROOT, 'app');
export const ANALYSIS_ROOT = path.join(APP_DATA_ROOT, 'analysis');
export const THUMBNAIL_ROOT = path.join(APP_DATA_ROOT, 'thumbnails');
export const WORK_ROOT = path.join(DATA_ROOT, 'work');
export const STATE_FILE = path.join(APP_DATA_ROOT, 'state.json');
export const POSITION_PLANS_FILE = path.join(APP_DATA_ROOT, 'position-plans.json');
export const ANALYTICS_ROOT = path.join(APP_DATA_ROOT, 'analytics');
export const ANALYTICS_STATE_FILE = path.join(ANALYTICS_ROOT, 'matches.json');
export const STAGE_MAP_ROOT = path.join(PROJECT_ROOT, 'assets', 'stage-maps', 'images');
export const FFMPEG_PATH = process.env.FFMPEG_PATH || path.join(
  PROJECT_ROOT,
  'tools',
  'runtime',
  'video-split',
  'imageio_ffmpeg',
  'binaries',
  'ffmpeg-win-x86_64-v7.1.exe',
);
