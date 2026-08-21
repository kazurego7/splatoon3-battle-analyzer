import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../src/store.mjs';

test('restores a corrupt state file from the last valid backup', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'battle-review-store-'));
  const stateFile = path.join(directory, 'state.json');
  try {
    const store = new Store({ stateFile });
    await store.load();
    await store.upsert({ id: 'recording-1', matches: [] });
    await store.patch('recording-1', { status: 'ready' });
    await fs.writeFile(stateFile, Buffer.alloc(256));

    const recovered = new Store({ stateFile });
    await recovered.load();
    assert.equal(recovered.get('recording-1').id, 'recording-1');
    const restoredFile = JSON.parse(await fs.readFile(stateFile, 'utf8'));
    assert.equal(restoredFile.recordings[0].id, 'recording-1');
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
