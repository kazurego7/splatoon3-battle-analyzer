import { Pipeline } from './pipeline.mjs';
import { Store } from './store.mjs';

const store = new Store();
await store.load();
const pipeline = new Pipeline(store);
await pipeline.start({ autoProcess: false });

const fileName = process.argv.slice(2).join(' ');
await pipeline.scan({ enqueue: false });
const target = fileName ? store.list().find(item => item.fileName === fileName) : store.list()[0];
if (!target) throw new Error('解析対象の録画がありません');
pipeline.enqueue(target.id, true);
while (pipeline.processing || pipeline.queue.length) await new Promise(resolve => setTimeout(resolve, 1000));
const result = store.get(target.id);
console.log(JSON.stringify(result, null, 2));
if (result.status !== 'ready') process.exitCode = 1;
