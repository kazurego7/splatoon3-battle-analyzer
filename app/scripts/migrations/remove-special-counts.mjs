import fs from 'node:fs/promises';
import path from 'node:path';
import { DATA_ROOT } from '../../src/paths.mjs';

const roots = [
  path.join(DATA_ROOT, 'app'),
  path.join(DATA_ROOT, 'tmp'),
  path.join(DATA_ROOT, 'work'),
];

function removeSpecialCounts(value) {
  if (!value || typeof value !== 'object') return 0;
  let removed = 0;
  if (!Array.isArray(value)) {
    for (const key of ['specials', 'specialCount']) {
      if (Object.hasOwn(value, key)) {
        delete value[key];
        removed += 1;
      }
    }
  }
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    removed += removeSpecialCounts(child);
  }
  return removed;
}

async function jsonFiles(root) {
  const files = [];
  let entries;
  try { entries = await fs.readdir(root, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return files; throw error; }
  for (const entry of entries) {
    // This is a downloaded third-party reference dataset, not application data.
    if (entry.isDirectory() && entry.name === 'external-splat3-source') continue;
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await jsonFiles(target));
    else if (entry.isFile() && entry.name.endsWith('.json')) files.push(target);
  }
  return files;
}

let changedFiles = 0;
let removedFields = 0;
for (const root of roots) {
  for (const file of await jsonFiles(root)) {
    let value;
    try { value = JSON.parse(await fs.readFile(file, 'utf8')); }
    catch (error) { if (error instanceof SyntaxError) continue; throw error; }
    const removed = removeSpecialCounts(value);
    if (!removed) continue;
    const temporary = `${file}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
    await fs.rename(temporary, file);
    changedFiles += 1;
    removedFields += removed;
  }
}

console.log(JSON.stringify({ changedFiles, removedFields }));
