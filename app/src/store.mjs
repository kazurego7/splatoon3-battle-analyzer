import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { APP_DATA_ROOT, STATE_FILE } from './paths.mjs';

const EMPTY_STATE = { version: 1, recordings: [] };

export class Store extends EventEmitter {
  constructor({ stateFile = STATE_FILE } = {}) {
    super();
    this.stateFile = stateFile;
    this.backupFile = `${stateFile}.backup`;
    this.state = structuredClone(EMPTY_STATE);
    this.writeChain = Promise.resolve();
  }

  async load() {
    await fs.mkdir(path.dirname(this.stateFile), { recursive: true });
    try {
      this.state = await this.readState(this.stateFile);
    } catch (error) {
      if (error.code === 'ENOENT') {
        await this.save();
      } else {
        try {
          this.state = await this.readState(this.backupFile);
          await this.save();
        } catch (backupError) {
          const failure = new Error(`録画一覧の状態ファイルが破損し、バックアップからも復旧できませんでした: ${error.message}`);
          failure.cause = backupError;
          throw failure;
        }
      }
    }
    return this.state;
  }

  async readState(file) {
    const state = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!state || state.version !== 1 || !Array.isArray(state.recordings)) throw new Error('状態ファイルの形式が不正です');
    return state;
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
      const temporary = `${this.stateFile}.${process.pid}.${Date.now()}.tmp`;
      const handle = await fs.open(temporary, 'w');
      try {
        await handle.writeFile(`${JSON.stringify(this.state, null, 2)}\n`, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      try {
        await this.readState(this.stateFile);
        await fs.copyFile(this.stateFile, this.backupFile);
      } catch (error) {
        if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) {
          await fs.rm(temporary, { force: true });
          throw error;
        }
      }
      await fs.rename(temporary, this.stateFile);
    });
    return this.writeChain;
  }
}
