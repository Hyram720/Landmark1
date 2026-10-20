// Streaming Availability API (movieofthenight.com): what's new, leaving and free on each service.
// Requests are counted per month and refused past the budget, so the free plan is never exceeded.
import fs from 'node:fs';
import path from 'node:path';
import config from './config.js';

const DAY = 86400;
const usageFile = path.join(config.dataDir, 'api-usage.json');
const servicesFile = path.join(config.dataDir, 'services.json');

const month = () => new Date().toISOString().slice(0, 7);
function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function apiUsage() {
  const u = readJson(usageFile, {});
  return { month: month(), used: u[month()] || 0, budget: config.streaming.monthlyBudget };
}

function countRequest() {
  const u = readJson(usageFile, {});
  u[month()] = (u[month()] || 0) + 1;
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(usageFile, JSON.stringify(u));
}

async function apiGet(endpoint, params = {}) {
  const { apiKey, viaRapidApi, monthlyBudget } = config.streaming;
  if (!apiKey) throw new Error('STREAMING_API_KEY is not set');
  if (apiUsage().used >= monthlyBudget) throw new Error(`Monthly API budget of ${monthlyBudget} requests reached`);
  const base = viaRapidApi ? 'https://streaming-availability.p.rapidapi.com' : 'https://api.movieofthenight.com/v4';
  const url = `${base}${endpoint}?${new URLSearchParams(params)}`;
  const headers = viaRapidApi
    ? { 'X-RapidAPI-Key': apiKey, 'X-RapidAPI-Host': 'streaming-availability.p.rapidapi.com' }
    : { 'X-API-Key': apiKey };
  countRequest();
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`Streaming API ${endpoint} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// Shown on the signup form before the first successful /countries call (or without a key).
export const DEFAULT_SERVICES = [
  { id: 'netflix', name: 'Netflix', subscription: true, free: false },
  { id: 'prime', name: 'Prime Video', subscription: true, free: false },
  { id: 'disney', name: 'Disney+', subscription: true, free: false },
  { id: 'hbo', name: 'HBO Max', subscription: true, free: false },
  { id: 'hulu', name: 'Hulu', subscription: true, free: false },
  { id: 'peacock', name: 'Peacock', subscription: true, free: false },
  { id: 'paramount', name: 'Paramount+', subscription: true, free: false },
  { id: 'apple', name: 'Apple TV', subscription: true, free: false },
];

// The country's services, refreshed weekly. Service ids come from the API, never guessed.
export async function getServices({ refresh = false } = {}) {
  const cached = readJson(servicesFile, null);
  const fresh = cached && Date.now() - cached.fetchedAt < 7 * DAY * 1000;
  if (cached && fresh && !refresh) return cached.services;
  if (process.env.SOURCES_FIXTURES) return readJson(path.join(process.env.SOURCES_FIXTURES, 'services.json'), DEFAULT_SERVICES);
  if (!config.streaming.apiKey) return cached?.services || DEFAULT_SERVICES;
  try {
    const country = await apiGet(`/countries/${config.streaming.country}`, { output_language: 'en' });
    const services = country.services.map((s) => ({
      id: s.id,
      name: s.name,
      subscription: Boolean(s.streamingOptionTypes?.subscription),
      free: Boolean(s.streamingOptionTypes?.free),
    }));
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(servicesFile, JSON.stringify({ fetchedAt: Date.now(), services }));
    return services;
  } catch (err) {
    console.error('[services]', err.message);
    return cached?.services || DEFAULT_SERVICES;
  }
}

async function fetchChanges(params, maxPages) {
  const merged = { changes: [], shows: {} };
  let cursor;
  for (let page = 0; page < maxPages; page++) {
    const r = await apiGet('/changes', { ...params, ...(cursor && { cursor }) });
    merged.changes.push(...r.changes);
    Object.assign(merged.shows, r.shows);
    if (!r.hasMore) break;
    cursor = r.nextCursor;
  }
  return merged;
}

const poster = (show) =>
  show.imageSet?.horizontalPoster?.w480 || show.imageSet?.horizontalBackdrop?.w480 || show.imageSet?.verticalPoster?.w360 || null;

// One item per show; a title new on two services lists both.
export function normalizeChanges(result, kind) {
  const items = new Map();
  for (const c of result.changes) {
    if (c.itemType !== 'show') continue;
    const show = result.shows[c.showId];
    if (!show) continue;
    const entry = { id: c.service.id, name: c.service.name, link: c.link || show.streamingOptions?.[config.streaming.country]?.find((o) => o.service.id === c.service.id)?.link || null, date: c.timestamp ? new Date(c.timestamp * 1000).toISOString() : null };
    if (!entry.link) continue;
    const existing = items.get(show.id);
    if (existing) {
      if (!existing.services.some((s) => s.id === entry.id)) existing.services.push(entry);
      continue;
    }
    items.set(show.id, {
      id: `${kind}-${show.id}`,
      kind,
      showId: show.id,
      title: show.title,
      showType: show.showType === 'series' ? 'series' : 'movie',
      year: show.releaseYear || show.firstAirYear || null,
      genres: (show.genres || []).map((g) => g.name).slice(0, 3),
      rating: Number(show.rating) || 0,
      overview: String(show.overview || '').split(/(?<=[.!?])\s/).slice(0, 2).join(' '),
      image: poster(show),
      services: [entry],
    });
  }
  return [...items.values()];
}

export async function fetchAll(now = Date.now()) {
  if (process.env.SOURCES_FIXTURES) {
    const read = (f) => readJson(path.join(process.env.SOURCES_FIXTURES, f), { changes: [], shows: {} });
    return { new: normalizeChanges(read('new.json'), 'new'), leaving: normalizeChanges(read('leaving.json'), 'leaving'), free: normalizeChanges(read('free.json'), 'free') };
  }
  const services = await getServices();
  const t = Math.floor(now / 1000);
  // Up to 32 catalogs per request; subscription services for new/leaving, free tiers for the free section.
  const subs = services.filter((s) => s.subscription).slice(0, 32).map((s) => `${s.id}.subscription`).join(',');
  const frees = services.filter((s) => s.free).slice(0, 32).map((s) => `${s.id}.free`).join(',');
  const base = { country: config.streaming.country, item_type: 'show', output_language: 'en', order_direction: 'desc' };
  const [added, leaving, free] = await Promise.all([
    fetchChanges({ ...base, change_type: 'new', catalogs: subs, from: t - 7 * DAY, to: t }, 6),
    fetchChanges({ ...base, change_type: 'expiring', catalogs: subs, from: t, to: t + 14 * DAY, order_direction: 'asc' }, 4),
    frees ? fetchChanges({ ...base, change_type: 'new', catalogs: frees, from: t - 14 * DAY, to: t }, 4) : { changes: [], shows: {} },
  ]);
  return { new: normalizeChanges(added, 'new'), leaving: normalizeChanges(leaving, 'leaving'), free: normalizeChanges(free, 'free') };
}
