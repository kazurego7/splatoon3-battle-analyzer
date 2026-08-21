export function positiveConcurrency(value, fallback = 2, maximum = 4) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(maximum, parsed);
}

export async function mapWithConcurrency(items, concurrency, mapper) {
  if (!Array.isArray(items) || !items.length) return [];
  const limit = Math.min(items.length, positiveConcurrency(concurrency));
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}
