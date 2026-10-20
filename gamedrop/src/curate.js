// Picks what's actually worth a reader's time. Pure functions so the rules are testable.
const DAY = 86400_000;

const key = (title) => title.toLowerCase().replace(/[^a-z0-9]/g, '');

export function pickFreeGames(items, now = Date.now(), limit = 8) {
  const live = items.filter((g) => g.active && (!g.endsAt || Date.parse(g.endsAt) > now));
  const score = (g) => {
    const fresh = g.publishedAt && now - Date.parse(g.publishedAt) < 8 * DAY ? 1000 : 0;
    const endingSoon = g.endsAt && Date.parse(g.endsAt) - now < 4 * DAY ? 200 : 0;
    const catchPenalty = g.catch ? -1500 : 0;
    return fresh + endingSoon + catchPenalty + (g.worth || 0) * 10 + Math.log10(g.popularity + 1);
  };
  return live.sort((a, b) => score(b) - score(a)).slice(0, limit);
}

export function pickDeals(items, { exclude = [], limit = 10 } = {}) {
  const skip = new Set(exclude.map(key));
  const best = new Map();
  for (const d of items) {
    // Well reviewed by enough people, and a real discount.
    if (d.rating < 80 || d.ratingCount < 500 || d.savings < 50) continue;
    if (skip.has(key(d.title))) continue; // already in the free section
    const prev = best.get(d.gameId);
    if (!prev || d.price < prev.price) best.set(d.gameId, d);
  }
  return [...best.values()]
    .sort((a, b) => b.dealRating - a.dealRating || b.rating - a.rating)
    .slice(0, limit);
}

export function curate({ free, deals }, now = Date.now()) {
  const freePicks = pickFreeGames(free, now);
  // A deal at $0 is a giveaway by another name; keep it once, in the free section.
  return { free: freePicks, deals: pickDeals(deals, { exclude: freePicks.map((g) => g.title) }) };
}

export const DEFAULT_PREFS = { platforms: ['pc', 'mobile', 'console', 'vr'], maxPrice: 60 };
export const PLATFORM_LABELS = { pc: 'PC', mobile: 'Mobile', console: 'Console', vr: 'VR' };

export function cleanPrefs(input = {}) {
  const platforms = (Array.isArray(input.platforms) ? input.platforms : [input.platforms])
    .filter((p) => PLATFORM_LABELS[p]);
  const maxPrice = Math.min(200, Math.max(0, Number(input.maxPrice ?? DEFAULT_PREFS.maxPrice) || 0));
  return { platforms: platforms.length ? [...new Set(platforms)] : DEFAULT_PREFS.platforms, maxPrice };
}

// Each subscriber sees the same issue filtered to their platforms and budget.
export function personalize(issue, prefs) {
  const p = cleanPrefs(prefs);
  return {
    free: issue.free.filter((g) => g.platforms.some((x) => p.platforms.includes(x))),
    deals: p.platforms.includes('pc') ? issue.deals.filter((d) => d.price <= p.maxPrice) : [],
  };
}
