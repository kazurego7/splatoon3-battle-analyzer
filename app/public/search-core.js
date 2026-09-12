import { appUrl } from './app-path.js';
export const RULE_ICONS = Object.freeze({
  ナワバリ: '▧', エリア: '◆', ヤグラ: '♜', ホコ: '➜', アサリ: '◉',
});

export const RULE_ICON_FILES = Object.freeze({
  ナワバリ: 'turf.png', エリア: 'zones.png', ヤグラ: 'tower.png', ホコ: 'rainmaker.png', アサリ: 'clams.png',
});

export const OUTCOME_LABELS = Object.freeze({ win: 'WIN', lose: 'LOSE' });

export const WEAPON_TYPE_ORDER = Object.freeze([
  'シューター', 'ローラー', 'チャージャー', 'ブラスター', 'スロッシャー', 'スピナー',
  'フデ', 'マニューバー', 'シェルター', 'ストリンガー', 'ワイパー',
]);

const unique = values => [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right, 'ja'));

export function recordSelfWeapon(record) {
  return typeof record?.selfWeapon === 'string' ? record.selfWeapon : record?.selfWeapon?.name || null;
}

export function searchDimensions(records, weaponCatalog = []) {
  return {
    stages: unique(records.map(record => record.stage)),
    rules: unique([...records.map(record => record.rule), ...Object.keys(RULE_ICON_FILES)]),
    outcomes: Object.keys(OUTCOME_LABELS),
    selfWeapons: unique([...records.map(recordSelfWeapon), ...weaponCatalog]),
    opponentWeapons: unique([...records.flatMap(record => record.enemyWeapons || []), ...weaponCatalog]),
    allyCompositions: unique([...records.flatMap(record => record.allyWeapons || []), ...weaponCatalog]),
    enemyCompositions: unique([...records.flatMap(record => record.enemyWeapons || []), ...weaponCatalog]),
  };
}

function selectedMatch(selected, values) {
  if (!selected?.size) return true;
  return values.some(value => selected.has(value));
}

export function normalizedWeaponName(name) {
  return String(name || '').replace(/[・.\s]/g, '').replace(/14式竹筒銃甲/, '竹');
}

export function weaponCatalogEntry(name, catalog = []) {
  const exact = catalog.find(item => item.name === name);
  if (exact) return exact;
  const normalized = normalizedWeaponName(name);
  const candidates = catalog.filter(item => {
    const candidate = normalizedWeaponName(item.name);
    return candidate.includes(normalized) || normalized.includes(candidate);
  });
  return candidates.length === 1 ? candidates[0] : null;
}

export function weaponTypeForName(name, catalog = []) {
  return weaponCatalogEntry(name, catalog)?.type || 'その他';
}

export function weaponTypeTabs(names, catalog = []) {
  const types = new Set(names.map(name => weaponTypeForName(name, catalog)));
  return [...WEAPON_TYPE_ORDER.filter(type => types.has(type)), ...(types.has('その他') ? ['その他'] : [])];
}

function selectedWeaponMatch(selected, values) {
  if (!selected?.size) return true;
  const selectedNames = new Set([...selected].map(normalizedWeaponName));
  return values.some(value => selectedNames.has(normalizedWeaponName(value)));
}

function selectedWeaponCompositionMatch(selected, values) {
  if (!selected?.size) return true;
  const available = new Set(values.map(normalizedWeaponName));
  return [...selected].every(value => available.has(normalizedWeaponName(value)));
}

export function filterMatchRecords(records, selections = {}) {
  return [...records].filter(record => (
    selectedMatch(selections.stages, [record.stage])
    && selectedMatch(selections.rules, [record.rule])
    && selectedMatch(selections.outcomes, [record.outcome])
    && selectedWeaponMatch(selections.selfWeapons, [recordSelfWeapon(record)])
    && selectedWeaponMatch(selections.opponentWeapons, record.enemyWeapons || [])
    && selectedWeaponCompositionMatch(selections.allyCompositions, record.allyWeapons || [])
    && selectedWeaponCompositionMatch(selections.enemyCompositions, record.enemyWeapons || [])
  )).sort((left, right) => String(right.recordedAt || '').localeCompare(String(left.recordedAt || '')));
}

export function matchReviewUrl(record) {
  if (!record?.recordingId || record.matchNumber == null) return null;
  return `./?recording=${encodeURIComponent(record.recordingId)}&match=${encodeURIComponent(record.matchNumber)}`;
}

export function stageIconUrl(stage) {
  return stage ? appUrl(`/assets/stage-maps/${encodeURIComponent(`${stage}_エリア.webp`)}`) : null;
}

export function ruleIconUrl(rule) {
  return RULE_ICON_FILES[rule] ? appUrl(`/assets/rule-icons/${RULE_ICON_FILES[rule]}`) : null;
}
