// Ranking: Wilson lower bound on the success rate, with pseudo-counts so unknown codes start near a modest prior.

/** Lower bound of the Wilson score interval (z = 1.28, about 80% one-sided confidence). */
export function wilsonLowerBound(successes, tries, z = 1.28) {
  if (tries <= 0) return 0;
  const p = successes / tries;
  const z2 = z * z;
  const denom = 1 + z2 / tries;
  const centre = p + z2 / (2 * tries);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * tries)) / tries);
  return Math.max(0, (centre - margin) / denom);
}

/** Score used to order candidates: success estimate (with prior of 1 success in 4 tries) times a mild value weight. */
export function scoreCoupon(c) {
  const s = c.stats?.successes ?? 0;
  const t = c.stats?.tries ?? 0;
  return wilsonLowerBound(s + 1, t + 4);
}

export function rankCoupons(coupons) {
  return coupons
    .map((c) => ({ ...c, score: Number(scoreCoupon(c).toFixed(6)) }))
    .sort((a, b) => b.score - a.score || a.code.localeCompare(b.code));
}
