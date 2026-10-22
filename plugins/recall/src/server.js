#!/usr/bin/env node
// Shared Recall server: one memory + task board for Claude, ChatGPT, Grok and Claude Code.
//
//   RECALL_TOKEN=<long random secret> PORT=8787 node src/server.js
//
// Every route except /health needs a key, either as the first path segment
// (https://host/<key>/mcp — for apps that can't send headers) or as
// "Authorization: Bearer <key>".
//   RECALL_TOKEN         the owner key: everything, including the dashboard.
//   RECALL_AGENT_TOKENS  optional per-assistant keys, comma separated:
//                        "claude=<key>,chatgpt=<key>,grok:read=<key>". A request with an
//                        assistant key is signed as that assistant whatever it claims, and
//                        ":read" keys can only call reading tools. Assistant keys reach /mcp
//                        (and /hook unless read-only), never the dashboard.
//   POST /mcp    MCP Streamable HTTP endpoint (JSON responses)
//   POST /hook   records from Claude Code hooks (see hook.js)
//   GET  /       dashboard (open https://host/<token>/ in a browser)
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { realpathSync } from 'node:fs';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { processRecord } from './core.js';
import { Store } from './db.js';
import { handle } from './rpc.js';
import { aiSummary } from './summarize.js';
import { log } from './util.js';
import { viewerPost, viewerRoute } from './viewer.js';

const MAX_BODY = 2 * 1024 * 1024;

function sameSecret(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('Body too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// "claude=<key>,grok:read=<key>" → [{ agent, readOnly, key }]
export function parseAgentTokens(spec = '') {
  return String(spec).split(',').map(s => s.trim()).filter(Boolean).map(entry => {
    const eq = entry.indexOf('=');
    if (eq < 1) throw new Error('RECALL_AGENT_TOKENS entries look like name=key or name:read=key.');
    const [name, mode] = entry.slice(0, eq).trim().toLowerCase().split(':');
    const key = entry.slice(eq + 1).trim();
    if (!/^[a-z0-9._-]{1,40}$/.test(name)) throw new Error(`Bad assistant name in RECALL_AGENT_TOKENS: ${name}`);
    if (key.length < 24) throw new Error(`The key for ${name} in RECALL_AGENT_TOKENS must be at least 24 characters.`);
    return { agent: name, readOnly: mode === 'read', key };
  });
}

// Finds which key a request carries. Returns { route, viaPath, owner, agent, readOnly }, or null.
export function authorize(req, url, keys) {
  const match = secret => keys.find(k => sameSecret(secret, k.key));
  const parts = url.pathname.split('/');
  let first = '';
  try {
    first = decodeURIComponent(parts[1] ?? '');
  } catch {
    // Not a key.
  }
  const inPath = first && match(first);
  if (inPath) return { ...inPath, route: `/${parts.slice(2).join('/')}`, viaPath: true };
  const header = req.headers.authorization ?? '';
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  const viaHeader = bearer && match(bearer);
  if (viaHeader) return { ...viaHeader, route: url.pathname, viaPath: false };
  return null;
}

export function createServer({ token, agentTokens = '', store = new Store(), ai = process.env.RECALL_AI !== 'off' } = {}) {
  if (!token || token.length < 24) throw new Error('Set RECALL_TOKEN to a random secret of at least 24 characters.');
  const keys = [{ owner: true, agent: null, readOnly: false, key: token }, ...parseAgentTokens(agentTokens).map(k => ({ owner: false, ...k }))];
  if (new Set(keys.map(k => k.key)).size !== keys.length) throw new Error('Every Recall key must be different.');

  const send = (res, status, body, headers = {}) => {
    const isJson = typeof body !== 'string';
    res.writeHead(status, { 'content-type': isJson ? 'application/json' : 'text/plain; charset=utf-8', ...headers });
    res.end(isJson ? JSON.stringify(body) : body);
  };

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const started = Date.now();
    let who = 'anonymous';
    let shownRoute = url.pathname;
    // One access line per request on stdout (Railway's log). Never includes a key.
    res.on('finish', () => {
      if (url.pathname !== '/health') console.log(`${req.method} ${shownRoute} ${res.statusCode} ${who} ${Date.now() - started}ms`);
    });
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'authorization, content-type, mcp-session-id, mcp-protocol-version, accept');
    res.setHeader('access-control-expose-headers', 'mcp-session-id');
    if (req.method === 'OPTIONS') return send(res, 204, '');
    if (url.pathname === '/health') {
      try {
        store.stats();
        return send(res, 200, { ok: true });
      } catch (err) {
        log('health check failed', err);
        return send(res, 503, { ok: false, error: 'database unavailable' });
      }
    }

    // OAuth discovery: Recall uses keys, not OAuth. Answer 404 so clients (ChatGPT, Claude)
    // connect without trying to start a sign-in flow.
    if (url.pathname.startsWith('/.well-known/') || url.pathname.includes('/.well-known/')) {
      shownRoute = '/.well-known/…'; // the rest of the path can carry a key
      return send(res, 404, { error: 'not found' });
    }

    shownRoute = '/<redacted>';
    const auth = authorize(req, url, keys);
    if (!auth) return send(res, 401, { error: 'unauthorized' }, { 'www-authenticate': 'Bearer' });
    const { route } = auth;
    shownRoute = route;
    who = auth.owner ? 'owner' : `${auth.agent}${auth.readOnly ? ':read' : ''}`;
    const forbidden = () => send(res, 403, { error: 'this key cannot use this route' });

    try {
      if (route === '/mcp') {
        if (req.method === 'GET') return send(res, 405, 'This server does not stream; POST JSON-RPC messages to it.', { allow: 'POST, DELETE' });
        if (req.method === 'DELETE') return send(res, 204, '');
        if (req.method !== 'POST') return send(res, 405, 'Method not allowed');
        let payload;
        try {
          payload = JSON.parse(await readBody(req));
        } catch (err) {
          if (err.status) throw err;
          return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
        }
        const messages = Array.isArray(payload) ? payload : [payload];
        const ctx = { agent: auth.agent, readOnly: auth.readOnly, audit: true };
        const replies = messages.map(m => handle(store, m, ctx)).filter(Boolean);
        const headers = messages.some(m => m?.method === 'initialize') ? { 'mcp-session-id': randomUUID() } : {};
        if (!replies.length) return send(res, 202, '', headers);
        return send(res, 200, Array.isArray(payload) ? replies : replies[0], headers);
      }

      if (route === '/hook' && req.method === 'POST') {
        if (auth.readOnly) return forbidden();
        const record = JSON.parse(await readBody(req));
        const output = processRecord(store, record, {
          onSessionEnd: sessionId => {
            if (ai) aiSummary(store, sessionId).catch(err => log('AI summary failed', err));
          },
        });
        return send(res, 200, { output });
      }

      // The dashboard and its API are for the owner only.
      if (!auth.owner) return forbidden();
      if (req.method === 'POST' && viewerPost(store, route, req, await readBody(req), res)) return;

      if (req.method === 'GET') {
        // The dashboard uses relative links, so it must be opened at "/<token>/".
        if (auth.viaPath && route === '/' && !url.pathname.endsWith('/')) {
          res.writeHead(301, { location: `${url.pathname}/` });
          return res.end();
        }
        if (viewerRoute(store, route, url, res)) return;
      }
      return send(res, 404, 'Not found');
    } catch (err) {
      log('server error', err);
      return send(res, err.status ?? 500, { error: err.status ? err.message : 'internal error' });
    }
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
if (isMain) {
  const port = Number(process.env.PORT) || 8787;
  const host = process.env.HOST || '0.0.0.0';
  try {
    const agentTokens = process.env.RECALL_AGENT_TOKENS ?? '';
    const server = createServer({ token: process.env.RECALL_TOKEN, agentTokens });
    server.listen(port, host, () => {
      const names = parseAgentTokens(agentTokens).map(k => `${k.agent}${k.readOnly ? ' (read-only)' : ''}`);
      console.log(`Recall server listening on http://${host}:${port}`);
      console.log(`Assistant keys: ${names.length ? names.join(', ') : 'none (owner key only)'}`);
      console.log('MCP endpoint: <your-url>/<key>/mcp · dashboard: <your-url>/<RECALL_TOKEN>/');
    });
    process.on('SIGTERM', () => server.close(() => process.exit(0)));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
