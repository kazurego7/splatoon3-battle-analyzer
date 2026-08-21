function count(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

export function formatKillDeath(kills, deaths) {
  const killCount = count(kills);
  const deathCount = count(deaths);
  if (killCount == null && deathCount == null) return 'K/D 未取得';
  return `K ${killCount ?? '—'} / D ${deathCount ?? '—'}`;
}

export function killDeathFromAnalysis(analysis) {
  return formatKillDeath(
    analysis?.playerStats?.kills,
    analysis?.playerStats?.deaths ?? analysis?.validation?.deaths?.expected,
  );
}
