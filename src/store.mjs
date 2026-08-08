import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { APP_DATA_ROOT, STATE_FILE } from './paths.mjs';

const EMPTY_STATE = { version: 1, recordings: [] };

export class Store extends EventEmitter {
  constructor() {
    super();
    this.state = structuredClone(EMPTY_STATE);
    this.writeChain = Promise.resolve();
  }

  async load() {
    await fs.mkdir(APP_DATA_ROOT, { recursive: true });
    try {
      this.state = JSON.parse(await fs.readFile(STATE_FILE, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      await this.save();
    }
    return this.state;
  }

  list() {
    return structuredClone(this.state.recordings);
  }

  get(id) {
    return this.state.recordings.find(item => item.id === id) || null;
  }

  async upsert(recording) {
    const index = this.state.recordings.findIndex(item => item.id === recording.id);
    if (index >= 0) this.state.recordings[index] = recording;
    else this.state.recordings.unshift(recording);
    await this.save();
    this.emit('change', structuredClone(recording));
  }

  async patch(id, patch) {
    const current = this.get(id);
    if (!current) throw new Error(`Recording not found: ${id}`);
    Object.assign(current, patch, { updatedAt: new Date().toISOString() });
    await this.save();
    this.emit('change', structuredClone(current));
    return current;
  }

  async save() {
    this.writeChain = this.writeChain.then(async () => {
      const temporary = `${STATE_FILE}.tmp`;
      await fs.writeFile(temporary, `${JSON.stringify(this.state, null, 2)}\n`, 'utf8');
      await fs.rename(temporary, STATE_FILE);
    });
    return this.writeChain;
  }
}
