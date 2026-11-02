#!/usr/bin/env node
// Krea 3 Studio MCP server.
//   stdio (Claude Desktop, Claude Code, Cursor, Codex):   node src/index.js
//   HTTP  (ChatGPT, Grok/xAI API, Claude.ai connectors): node src/index.js --http   (PORT, MCP_AUTH_TOKEN)
import http from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { providerStatus } from './providers/index.js';
import { createServer, VERSION } from './tools.js';

const useHttp = process.argv.includes('--http') || process.env.MCP_TRANSPORT === 'http';

if (!useHttp) {
  const server = createServer({ allowLocalFiles: true });
  await server.connect(new StdioServerTransport());
  console.error(`krea3-studio ${VERSION} ready on stdio. Providers: ${JSON.stringify(providerStatus())}`);
} else {
  const port = Number(process.env.PORT || 8787);
  const token = process.env.MCP_AUTH_TOKEN || '';
  if (!token) console.error('WARNING: MCP_AUTH_TOKEN is not set, so anyone with the URL can spend your credits.');

  const same = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  // Accepts "Authorization: Bearer <token>", "?key=<token>", or a secret path "/mcp/<token>"
  // (ChatGPT and Claude.ai connectors cannot always send custom headers).
  function authorized(req, url) {
    if (!token) return true;
    // Some clients send the raw token in Authorization, others prefix "Bearer ".
    const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const fromPath = url.pathname.startsWith('/mcp/') ? decodeURIComponent(url.pathname.slice(5)) : '';
    return [bearer, url.searchParams.get('key'), fromPath].some((t) => t && same(t, token));
  }

  async function readBody(req) {
    const chunks = [];
    let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > 60 * 1024 * 1024) throw Object.assign(new Error('Request body too large'), { status: 413 });
      chunks.push(c);
    }
    const raw = Buffer.concat(chunks).toString('utf8');
    return raw ? JSON.parse(raw) : undefined;
  }

  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Mcp-Session-Id, Mcp-Protocol-Version');
    res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
    if (req.method === 'OPTIONS') return res.writeHead(204).end();

    if (url.pathname === '/' || url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ name: 'krea3-studio', version: VERSION, mcp: '/mcp', providers: providerStatus() }));
    }
    if (url.pathname !== '/mcp' && !url.pathname.startsWith('/mcp/')) return res.writeHead(404).end('Not found');
    if (!authorized(req, url)) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Unauthorized' }, id: null }));
    }
    if (req.method !== 'POST') {
      // Stateless server: no standalone SSE stream or sessions to delete.
      res.writeHead(405, { Allow: 'POST', 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'Method not allowed' }, id: null }));
    }

    try {
      const body = await readBody(req);
      const server = createServer({ allowLocalFiles: false });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      res.on('close', () => {
        transport.close();
        server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(err.status || 400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32700, message: err.message }, id: null }));
      }
    }
  });

  httpServer.listen(port, () => {
    console.error(`krea3-studio ${VERSION} listening on http://localhost:${port}/mcp  Providers: ${JSON.stringify(providerStatus())}`);
  });
}
