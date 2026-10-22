// Client side of the shared server: set RECALL_REMOTE_URL and RECALL_TOKEN.

export function remoteConfig() {
  const url = process.env.RECALL_REMOTE_URL;
  if (!url) return null;
  return { url: url.replace(/\/+$/, ''), token: process.env.RECALL_TOKEN ?? '' };
}

export async function remoteFetch(path, body, timeoutMs = 10000) {
  const { url, token } = remoteConfig();
  const res = await fetch(`${url}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok && res.status !== 202) throw new Error(`recall server answered ${res.status} for ${path}`);
  return res;
}
