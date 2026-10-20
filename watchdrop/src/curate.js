// Picks what's actually worth a reader's time. Pure functions so the rules are testable.
// Ratings are the API's 0-100 aggregate score.
export const RULES = { newMin: 70, leavingMin: 65, freeMin: 65 };

const byRating = (a, b) => b.rating - a.rating;
const dateOf = (item) => Math.min(...item.services.map((s) => (s.date ? Date.parse(s.date) : Infinity)));

export function curate({ new: added, leaving, free }) {
  const newPicks = added.filter((i) => i.rating >= RULES.newMin).sort(byRating).slice(0, 12);
  // Soonest first: the point of this section is "watch it before it's gone".
  const leavingPicks = leaving
    .filter((i) => i.rating >= RULES.leavingMin)
    .sort((a, b) => dateOf(a) - dateOf(b) || byRating(a, b))
    .slice(0, 10);
  const seen = new Set(newPicks.map((i) => i.showId));
  const freePicks = free.filter((i) => i.rating >= RULES.freeMin && !seen.has(i.showId)).sort(byRating).slice(0, 8);
  return { new: newPicks, leaving: leavingPicks, free: freePicks };
}

export const TYPE_LABELS = { movie: 'Movies', series: 'Series' };
export const DEFAULT_PREFS = { services: ['netflix', 'prime', 'disney', 'hbo', 'hulu'], types: ['movie', 'series'], free: true };

// validIds: the service ids the API knows for this country; anything else is dropped.
export function cleanPrefs(input = {}, validIds = null) {
  const list = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]).map(String);
  const services = [...new Set(list(input.services))].filter((id) => /^[a-z0-9]{1,40}$/.test(id) && (!validIds || validIds.includes(id))).slice(0, 32);
  const types = [...new Set(list(input.types))].filter((t) => TYPE_LABELS[t]);
  // An unticked checkbox sends nothing, so HTML forms also send form=1 to mean "absent = off".
  const free = input.free === undefined ? (input.form ? false : DEFAULT_PREFS.free) : input.free === true || input.free === 'on' || input.free === 'true';
  return {
    services: services.length ? services : DEFAULT_PREFS.services.filter((id) => !validIds || validIds.includes(id)),
    types: types.length ? types : DEFAULT_PREFS.types,
    free,
  };
}

// Each subscriber sees only their services (and only the links for those services), their types,
// and the free section if they want it.
export function personalize(issue, prefs) {
  const p = cleanPrefs(prefs);
  const mine = (item) => {
    const services = item.services.filter((s) => p.services.includes(s.id));
    return services.length && p.types.includes(item.showType) ? { ...item, services } : null;
  };
  return {
    new: issue.new.map(mine).filter(Boolean),
    leaving: issue.leaving.map(mine).filter(Boolean),
    free: p.free ? issue.free.filter((i) => p.types.includes(i.showType)) : [],
  };
}
