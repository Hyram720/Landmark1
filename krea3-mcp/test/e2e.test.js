// End-to-end test: fake Krea/Higgsfield/Kie APIs + the real MCP server over stdio and HTTP.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const calls = [];
let mock, base, tmp;

function startMock() {
  const jobs = new Map();
  let n = 0;
  return http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const raw = Buffer.concat(chunks);
    const url = new URL(req.url, 'http://x');
    const send = (code, obj) => res.writeHead(code, { 'Content-Type': 'application/json' }).end(JSON.stringify(obj));
    const ct = req.headers['content-type'] || '';
    const body = ct.includes('json') && raw.length ? JSON.parse(raw) : null;
    calls.push({ method: req.method, path: url.pathname, query: url.search, auth: req.headers.authorization, body });

    if (url.pathname.startsWith('/out/')) return res.writeHead(200, { 'Content-Type': 'image/png' }).end(PNG);
    // Krea
    if (url.pathname === '/assets') return send(200, { image_url: `${base}/asset/${++n}.png` });
    if (url.pathname.startsWith('/generate/')) {
      if (req.headers.authorization !== 'Bearer krea-key') return send(401, { error: 'Unauthorized' });
      if (body.resolution === '8K') return send(422, { error: 'Validation failed', details: [{ field: 'resolution' }] });
      const id = `k${++n}`;
      jobs.set(id, 0);
      return send(200, { job_id: id, status: 'queued' });
    }
    if (url.pathname.startsWith('/jobs/')) {
      const id = url.pathname.split('/').pop();
      const seen = jobs.get(id) ?? 0;
      jobs.set(id, seen + 1);
      return seen < 1 ? send(200, { job_id: id, status: 'processing' }) : send(200, { job_id: id, status: 'completed', result: { urls: [`${base}/out/${id}.png`] } });
    }
    // Higgsfield
    if (url.pathname === '/files/generate-upload-url') return send(200, { upload_url: `${base}/put/1`, public_url: `${base}/hf-file/1.png`, upload_headers: { 'Content-Type': body.content_type } });
    if (url.pathname.startsWith('/put/')) return res.writeHead(200).end();
    if (url.pathname.startsWith('/requests/')) {
      const id = url.pathname.split('/')[2];
      const video = id.startsWith('hv');
      return send(200, video ? { status: 'completed', request_id: id, video: { url: `${base}/video/${id}.mp4` } } : { status: 'completed', request_id: id, images: [{ url: `${base}/out/${id}.png` }] });
    }
    if (url.pathname === '/api/v1/jobs/createTask') return send(200, { code: 200, msg: 'success', data: { taskId: `kie_${++n}` } });
    if (url.pathname === '/api/v1/jobs/recordInfo') {
      const id = url.searchParams.get('taskId');
      return send(200, { code: 200, data: { taskId: id, state: 'success', resultJson: JSON.stringify({ resultUrls: [`${base}/out/${id}.png`] }) } });
    }
    if (req.method === 'POST' && req.headers.authorization?.startsWith('Key ')) {
      const video = url.pathname.includes('video');
      return send(200, { status: 'queued', request_id: `${video ? 'hv' : 'hi'}${++n}` });
    }
    send(404, { error: 'no route ' + url.pathname });
  });
}

const env = () => ({
  ...process.env,
  KREA_API_KEY: 'krea-key',
  KREA_API_BASE: base,
  HIGGSFIELD_API_KEY_ID: 'id',
  HIGGSFIELD_API_KEY_SECRET: 'secret',
  HIGGSFIELD_API_BASE: base,
  KIE_API_KEY: 'kie-key',
  KIE_API_BASE: base,
});
const text = (r) => JSON.parse(r.content[0].text);

let client;
before(async () => {
  mock = startMock();
  await new Promise((r) => mock.listen(0, r));
  base = `http://127.0.0.1:${mock.address().port}`;
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'krea3-'));
  fs.writeFileSync(path.join(tmp, 'dog.png'), PNG);
  client = new Client({ name: 'test', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['src/index.js'], env: env() }));
});
after(async () => {
  await client?.close();
  mock?.close();
});

test('lists all tools, prompts and the presets resource', async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  for (const t of ['krea3_edit', 'generate_image', 'compare_providers', 'animate_image', 'pet_portrait', 'product_mockup', 'ad_format_pack', 'krea3_batch', 'get_job', 'upload_image', 'estimate_cost', 'list_providers']) {
    assert.ok(names.includes(t), `missing ${t}`);
  }
  assert.equal((await client.listPrompts()).prompts.length, 3);
  const res = await client.readResource({ uri: 'krea3://presets' });
  assert.ok(JSON.parse(res.contents[0].text).pet_styles.royal);
});

test('krea3_edit uploads a local file, polls, returns url + inline image, saves locally', async () => {
  const r = await client.callTool({
    name: 'krea3_edit',
    arguments: { prompt: 'Give the dog a party hat, keeping everything else the same', image_paths: [path.join(tmp, 'dog.png')], regional_edit: true, save_dir: path.join(tmp, 'out') },
  });
  assert.ok(!r.isError, JSON.stringify(r.content));
  const out = text(r);
  assert.equal(out.status, 'completed');
  assert.match(out.urls[0], /\/out\/k\d+\.png$/);
  assert.equal(out.estimated_usd_min, 0.08);
  assert.equal(r.content[1].type, 'image');
  assert.equal(fs.readdirSync(path.join(tmp, 'out')).length, 1);
  const sent = calls.filter((c) => c.path === '/generate/image/krea/krea-3').pop().body;
  assert.equal(sent.regional_edit, true);
  assert.equal(sent.resolution, '2K');
  assert.match(sent.image_urls[0], /\/asset\//);
});

test('krea3_edit validates input before spending money', async () => {
  const r = await client.callTool({ name: 'krea3_edit', arguments: { prompt: 'x', thinking_mode: 'ultra' } });
  assert.ok(r.isError);
  assert.match(r.content[0].text, /ultra needs/);
});

test('Krea API errors are surfaced, not thrown', async () => {
  const r = await client.callTool({ name: 'generate_image', arguments: { provider: 'krea', prompt: 'x', extra: { resolution: '8K' } } });
  assert.ok(r.isError);
  assert.match(text(r).error, /422/);
});

test('generate_image routes to Higgsfield and Kie with their own request shapes', async () => {
  const h = text(await client.callTool({ name: 'generate_image', arguments: { provider: 'higgsfield', prompt: 'edit it', image_urls: ['https://e.com/a.png'], resolution: '1K' } }));
  assert.equal(h.status, 'completed');
  const hCall = calls.find((c) => c.path === '/alibaba/qwen-image-3/edit');
  assert.equal(hCall.auth, 'Key id:secret');
  assert.deepEqual(hCall.body, { prompt: 'edit it', image_urls: ['https://e.com/a.png'], resolution: '1k' });

  const k = text(await client.callTool({ name: 'generate_image', arguments: { provider: 'kie', prompt: 'poster', aspect_ratio: '2:3' } }));
  assert.equal(k.status, 'completed');
  const kCall = calls.find((c) => c.path === '/api/v1/jobs/createTask');
  assert.equal(kCall.auth, 'Bearer kie-key');
  assert.equal(kCall.body.model, 'nano-banana-pro');
  assert.equal(kCall.body.input.aspect_ratio, '2:3');
});

test('compare_providers runs all three in parallel', async () => {
  const r = text(await client.callTool({ name: 'compare_providers', arguments: { prompt: 'royal dog', image_paths: [path.join(tmp, 'dog.png')] } }));
  assert.deepEqual(r.results.map((x) => x.provider), ['krea', 'higgsfield', 'kie']);
  assert.ok(r.results.every((x) => x.status === 'completed'));
  // Kie has no upload API: it reuses the Krea-hosted URL.
  const kieBody = calls.filter((c) => c.path === '/api/v1/jobs/createTask').pop().body;
  assert.match(kieBody.input.image_input[0], /\/asset\//);
});

test('pet_portrait makes N variants; product_mockup one per color; ad pack one per format', async () => {
  const p = text(await client.callTool({ name: 'pet_portrait', arguments: { style: 'royal', image_urls: ['https://e.com/dog.jpg'], variants: 3 } }));
  assert.equal(p.results.length, 3);
  assert.equal(p.style, 'The Royal');
  const body = calls.filter((c) => c.path.startsWith('/generate/')).pop().body;
  assert.equal(body.aspect_ratio, '2:3');
  assert.equal(body.thinking_mode, 'high');
  assert.match(body.prompt, /Keep the exact same animal/);

  const m = text(await client.callTool({ name: 'product_mockup', arguments: { product: 'tshirt', image_urls: ['https://e.com/art.png'], colors: ['washed sage', 'heather gray'] } }));
  assert.deepEqual(m.results.map((x) => x.label), ['tshirt-washed sage', 'tshirt-heather gray']);

  const a = text(await client.callTool({ name: 'ad_format_pack', arguments: { image_urls: ['https://e.com/hero.png'], formats: ['instagram_story', 'pinterest_pin'] } }));
  assert.equal(a.results.length, 2);
});

test('animate_image submits to Higgsfield video and returns the mp4', async () => {
  const r = text(await client.callTool({ name: 'animate_image', arguments: { prompt: 'slow push-in', image_urls: ['https://e.com/p.png'], duration: 5 } }));
  assert.match(r.urls[0], /\.mp4$/);
  const call = calls.find((c) => c.path === '/kling-video/o3/image-reference');
  assert.deepEqual(call.body, { prompt: 'slow push-in', image_urls: ['https://e.com/p.png'], duration: 5 });
});

test('wait_seconds=0 returns a job id that get_job can finish', async () => {
  const s = text(await client.callTool({ name: 'krea3_edit', arguments: { prompt: 'a red mug', wait_seconds: 0 } }));
  assert.equal(s.status, 'submitted');
  const g = text(await client.callTool({ name: 'get_job', arguments: { provider: 'krea', job_id: s.job_id, wait_seconds: 20, show_image: false } }));
  assert.equal(g.status, 'completed');
});

test('estimate_cost matches the published Krea price table', async () => {
  const one = text(await client.callTool({ name: 'estimate_cost', arguments: { resolution: '2K', thinking_mode: 'high', references_1k: 2, count: 4 } }));
  assert.equal(one.estimated_usd, 0.12); // 0.06 + 2*0.02 + 0.02
  assert.equal(one.estimated_total_usd, 0.48);
  const ultra = text(await client.callTool({ name: 'estimate_cost', arguments: { thinking_mode: 'ultra', references_1k: 5 } }));
  assert.equal(ultra.estimated_usd, 0.56); // 0.06 + 4*0.07 + 0.02 + 0.20
});

test('HTTP transport: requires the token, hides local-file options', async () => {
  const port = 18000 + Math.floor(Math.random() * 1000);
  const proc = spawn(process.execPath, ['src/index.js', '--http'], { env: { ...env(), PORT: String(port), MCP_AUTH_TOKEN: 'sekret' }, stdio: ['ignore', 'ignore', 'pipe'] });
  await new Promise((r) => proc.stderr.once('data', r));
  try {
    const denied = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(denied.status, 401);

    const c = new Client({ name: 'http-test', version: '1' });
    await c.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp/sekret`)));
    const { tools } = await c.listTools();
    const edit = tools.find((t) => t.name === 'krea3_edit');
    assert.ok(!('image_paths' in edit.inputSchema.properties));
    assert.ok(!('save_dir' in edit.inputSchema.properties));
    const r = text(await c.callTool({ name: 'krea3_edit', arguments: { prompt: 'a red mug', show_image: false } }));
    assert.equal(r.status, 'completed');
    await c.close();

    // Header forms: "Bearer <token>" and the raw token (xAI's `authorization` field).
    for (const auth of ['Bearer sekret', 'sekret']) {
      const hc = new Client({ name: 'hdr', version: '1' });
      await hc.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), { requestInit: { headers: { Authorization: auth } } }));
      assert.ok((await hc.listTools()).tools.length >= 12);
      await hc.close();
    }
    const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
    assert.equal(health.providers.kie.configured, true);
  } finally {
    proc.kill();
  }
});
