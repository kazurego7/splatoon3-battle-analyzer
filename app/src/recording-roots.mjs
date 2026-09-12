import fs from 'node:fs/promises';
import path from 'node:path';
import { RAW_ROOT } from './paths.mjs';

function iniValue(text, section, key) {
  const lines = String(text || '').split(/\r?\n/u);
  let current = '';
  for (const line of lines) {
    const heading = line.match(/^\[([^\]]+)\]\s*$/u);
    if (heading) { current = heading[1]; continue; }
    if (current !== section) continue;
    const entry = line.match(/^([^=]+)=(.*)$/u);
    if (entry && entry[1].trim() === key) return entry[2].trim().replace(/\\\\/gu, '\\');
  }
  return null;
}

export function obsRecordingRootFromProfile(text) {
  const mode = iniValue(text, 'Output', 'Mode');
  const value = mode === 'Advanced'
    ? iniValue(text, 'AdvOut', 'RecFilePath')
    : iniValue(text, 'SimpleOutput', 'FilePath');
  return value ? path.resolve(value) : null;
}

async function obsRecordingRoots() {
  const appData = process.env.APPDATA;
  if (!appData) return [];
  const profilesRoot = path.join(appData, 'obs-studio', 'basic', 'profiles');
  let profiles;
  try { profiles = await fs.readdir(profilesRoot, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  const roots = [];
  for (const profile of profiles.filter(entry => entry.isDirectory())) {
    try {
      const text = await fs.readFile(path.join(profilesRoot, profile.name, 'basic.ini'), 'utf8');
      const root = obsRecordingRootFromProfile(text);
      if (root) roots.push(root);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return roots;
}

export async function recordingSourceRoots() {
  const configured = [process.env.SPLATOON_RECORDING_ROOT, ...(process.env.SPLATOON_RECORDING_ROOTS || '').split(path.delimiter)]
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .map(value => path.resolve(value));
  const candidates = [RAW_ROOT, ...configured, ...await obsRecordingRoots()];
  const unique = new Map(candidates.map(root => [path.normalize(root).toLocaleLowerCase(), root]));
  const existing = [];
  for (const root of unique.values()) {
    if (root === RAW_ROOT) { existing.push(root); continue; }
    try { if ((await fs.stat(root)).isDirectory()) existing.push(root); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return existing;
}
