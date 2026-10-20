// Free public data sources, normalized into one item shape.
//  - GamerPower: free-to-keep game giveaways across Epic, Steam, GOG, itch.io, mobile, console, VR.
//  - CheapShark: price drops across Steam, GOG, Humble, Fanatical, GMG and more, with Steam review scores.
// Both are free APIs that ask for attribution; the page and emails credit them.
import config from './config.js';

const UA = { 'User-Agent': `${config.brandName}/1.0 (+${config.baseUrl})` };

async function getJson(url) {
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}`);
  return res.json();
}

// Which subscriber platform choice each GamerPower platform label belongs to.
const PLATFORM_GROUPS = [
  ['mobile', /android|ios/i],
  ['console', /playstation|ps4|ps5|xbox|switch|nintendo/i],
  ['vr', /\bvr\b|oculus|rift|quest/i],
  ['pc', /pc|steam|epic|gog|itch|drm-free|ubisoft|origin|ea app|battle\.net|stove|indiegala/i],
];

export function platformGroups(platforms) {
  const groups = new Set();
  for (const label of String(platforms).split(',')) {
    const match = PLATFORM_GROUPS.find(([, re]) => re.test(label));
    if (match) groups.add(match[0]);
  }
  return [...groups];
}

const money = (s) => {
  const n = Number(String(s).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};

const toIso = (s) => (s && s !== 'N/A' ? new Date(`${s.replace(' ', 'T')}Z`).toISOString() : null);

export function normalizeGiveaway(g) {
  // "Agent A (Epic Games) Giveaway" -> title "Agent A", store "Epic Games"
  const store = g.title.match(/\(([^)]+)\)\s*(?:Key\s*)?Giveaway\s*$/i)?.[1] || null;
  const title = g.title.replace(/\s*\([^)]+\)\s*(?:Key\s*)?Giveaway\s*$/i, '').replace(/\s*Giveaway\s*$/i, '').trim();
  return {
    id: `gp-${g.id}`,
    kind: 'free',
    title,
    store,
    platforms: platformGroups(g.platforms),
    platformLabel: g.platforms,
    worth: money(g.worth),
    publishedAt: toIso(g.published_date),
    endsAt: toIso(g.end_date),
    active: String(g.status).toLowerCase() === 'active',
    // Some "free" keys need loyalty points or an account grind; we still list them, but lower and labelled.
    catch: /requires? \d+ \w+ points|\bARP\b|points? to claim/i.test(g.description) ? 'Needs reward points to claim' : null,
    popularity: Number(g.users) || 0,
    url: g.open_giveaway_url,
    image: g.thumbnail || null,
    about: String(g.description || '').split(/(?<=[.!?])\s/).slice(0, 2).join(' '),
  };
}

export function normalizeDeal(d, storeNames = {}) {
  return {
    id: `cs-${d.gameID}`,
    kind: 'deal',
    gameId: d.gameID,
    title: d.title,
    store: storeNames[d.storeID] || `Store ${d.storeID}`,
    platforms: ['pc'],
    price: Number(d.salePrice),
    normalPrice: Number(d.normalPrice),
    savings: Math.round(Number(d.savings)),
    rating: Number(d.steamRatingPercent) || 0,
    ratingText: d.steamRatingText || null,
    ratingCount: Number(d.steamRatingCount) || 0,
    metacritic: Number(d.metacriticScore) || null,
    dealRating: Number(d.dealRating) || 0,
    // CheapShark asks that deals link through its redirect.
    url: `https://www.cheapshark.com/redirect?dealID=${d.dealID}`,
    image: d.thumb || null,
  };
}

// Fallback names for the most common CheapShark store ids, used if /stores is unreachable.
const KNOWN_STORES = { 1: 'Steam', 2: 'GamersGate', 3: 'GreenManGaming', 7: 'GOG', 8: 'EA', 11: 'Humble Store', 13: 'Ubisoft', 15: 'Fanatical', 21: 'WinGameStore', 23: 'GameBillet', 25: 'Epic Games Store', 27: 'Gamesplanet', 29: '2Game', 30: 'IndieGala', 31: 'Blizzard', 35: 'DreamGame' };

export async function fetchAll() {
  // SOURCES_FIXTURES=dir reads giveaways.json + deals.json from disk instead (local dev and tests).
  if (process.env.SOURCES_FIXTURES) {
    const { readFileSync } = await import('node:fs');
    const read = (f) => JSON.parse(readFileSync(`${process.env.SOURCES_FIXTURES}/${f}`, 'utf8'));
    return { free: read('giveaways.json').map(normalizeGiveaway), deals: read('deals.json').map((d) => normalizeDeal(d, KNOWN_STORES)) };
  }
  const [giveaways, deals, stores] = await Promise.all([
    getJson('https://www.gamerpower.com/api/giveaways?type=game&sort-by=date'),
    getJson('https://www.cheapshark.com/api/1.0/deals?sortBy=Deal%20Rating&steamRating=80&pageSize=60&onSale=1'),
    getJson('https://www.cheapshark.com/api/1.0/stores').catch(() => null),
  ]);
  const storeNames = stores
    ? Object.fromEntries(stores.map((s) => [s.storeID, s.storeName]))
    : KNOWN_STORES;
  return {
    free: giveaways.map(normalizeGiveaway),
    deals: deals.map((d) => normalizeDeal(d, storeNames)),
  };
}
