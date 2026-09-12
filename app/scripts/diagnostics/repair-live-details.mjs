import { Store } from '../../src/store.mjs';
import { LiveDetailService } from '../../src/live-detail-service.mjs';

const query = process.argv.slice(2).join(' ').trim();
if (!query) throw new Error('録画IDまたはファイル名を指定してください');
const store = new Store();
await store.load();
const recording = store.list().find(item => item.id === query || item.fileName === query);
if (!recording) throw new Error('録画が見つかりません');
const service = new LiveDetailService({ list: () => [recording] });
await service.tick();
console.log('自動補完処理が終了しました。詳細は解析JSONのdetailEnrichmentに記録されています。');
