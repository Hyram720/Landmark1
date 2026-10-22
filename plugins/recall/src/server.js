#!/usr/bin/env node
// Shared Recall server: one memory + task board for Claude, ChatGPT, Grok and Claude Code.
//
//   RECALL_TOKEN=<long random secret> PORT=8787 node src/server.js
//
// Every route except /health needs the token, either as the first path segment
// (https://host/<token>/mcp — for apps that can't send headers) or as
// "Authorization: Bearer <token>".
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

// Splits the token off the path and checks it. Returns the route, or null when unauthorized.
export function authorize(req, url, token) {
  const parts = url.pathname.split('/');
  if (parts[1] && sameSecret(decodeURIComponent(parts[1]), token)) {
    return { route: `/${parts.slice(2).join('/')}`, viaPath: true };
  }
  const header = req.headers.authorization ?? '';
  const bearer = header.toLowerCase().startsWith('bearer ') ? header.slice(7).trim() : '';
  if (bearer && sameSecret(bearer, token)) return { route: url.pathname, viaPath: false };
  return null;
}

export function createServer({ token, store = new Store(), ai = process.env.RECALL_AI !== 'off' } = {}) {
  if (!token || token.length < 24) throw new Error('Set RECALL_TOKEN to a random secret of at least 24 characters.');

  const send = (res, status, body, headers = {}) => {
    const isJson = typeof body !== 'string';
    res.writeHead(status, { 'content-type': isJson ? 'application/json' : 'text/plain; charset=utf-8', ...headers });
    res.end(isJson ? JSON.stringify(body) : body);
  };

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'authorization, content-type, mcp-session-id, mcp-protocol-version, accept');
    res.setHeader('access-control-expose-headers', 'mcp-session-id');
    if (req.method === 'OPTIONS') return send(res, 204, '');
    if (url.pathname === '/health') return send(res, 200, { ok: true });

    const auth = authorize(req, url, token);
    if (!auth) return send(res, 401, { error: 'unauthorized' }, { 'www-authenticate': 'Bearer' });
    const { route } = auth;

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
        const replies = messages.map(m => handle(store, m)).filter(Boolean);
        const headers = messages.some(m => m?.method === 'initialize') ? { 'mcp-session-id': randomUUID() } : {};
        if (!replies.length) return send(res, 202, '', headers);
        return send(res, 200, Array.isArray(payload) ? replies : replies[0], headers);
      }

      if (route === '/hook' && req.method === 'POST') {
        const record = JSON.parse(await readBody(req));
        const output = processRecord(store, record, {
          onSessionEnd: sessionId => {
            if (ai) aiSummary(store, sessionId).catch(err => log('AI summary failed', err));
          },
        });
        return send(res, 200, { output });
      }

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
    createServer({ token: process.env.RECALL_TOKEN }).listen(port, host, () => {
      console.log(`Recall server listening on http://${host}:${port}`);
      console.log('MCP endpoint: <your-url>/<RECALL_TOKEN>/mcp · dashboard: <your-url>/<RECALL_TOKEN>/');
    });
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
