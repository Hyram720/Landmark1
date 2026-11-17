// Provider selection, Qwen edit instructions, health reporting, and a mocked edit through the upscaler.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'portrait-qwen-'));
process.env.DATA_DIR = tmp;
process.env.ENHANCE_IMAGES = 'true';
delete process.env.OPENAI_API_KEY;
delete process.env.HF_TOKEN;
delete process.env.QWEN_ENDPOINT_URL;
delete process.env.QWEN_ENDPOINT_TOKEN;
delete process.env.QWEN_HF_URL;
delete process.env.IMAGE_PROVIDER;

const { editorFor } = await import('../src/providers/image.js');
const { editWithQwen } = await import('../src/providers/qwen.js');
const configMod = await import('../src/config.js');
const config = configMod.default;
const { STYLES, qwenInstruction } = configMod;
const { paintPortrait } = await import('../src/generate.js');
const { runHealthcheck } = await import('../src/healthcheck.js');
const { MASTER } = await import('../src/enhance.js');

function blockOpenAiKey() {
  const previous = Object.getOwnPropertyDescriptor(config.image, 'openaiKey');
  let reads = 0;
  Object.defineProperty(config.image, 'openaiKey', {
    configurable: true,
    get() {
      reads += 1;
      throw new Error('OPENAI_API_KEY read');
    },
  });
  return {
    reads: () => reads,
    restore() {
      if (previous) Object.defineProperty(config.image, 'openaiKey', previous);
    },
  };
}

test('IMAGE_PROVIDER defaults to openai and selects openai, qwen, or mock', () => {
  delete process.env.IMAGE_PROVIDER;
  assert.equal(config.image.provider, 'openai');
  assert.equal(editorFor('openai').name, 'editWithOpenAI');
  assert.equal(editorFor('qwen').name, 'editWithQwen');
  assert.equal(editorFor('mock').name, 'editWithMock');
  assert.equal(editorFor().name, 'editWithOpenAI');
  assert.throws(() => editorFor('other'), /unknown image provider/);
});

test('every style has a Qwen edit instruction that keeps the pet and names no artist', () => {
  const artists = [/van gogh/i, /picasso/i, /monet/i, /rembrandt/i, /warhol/i, /banksy/i, /kahlo/i, /basquiat/i];
  for (const [key, style] of Object.entries(STYLES)) {
    const text = qwenInstruction(style, 2);
    assert.match(text, /exact animal/i, key);
    assert.match(text, /breed/i, key);
    assert.match(text, /Variation 2/, key);
    assert.equal(artists.some((re) => re.test(text)), false, `${key} names an artist`);
    assert.equal(/openai/i.test(style.edit || ''), false);
  }
  assert.match(qwenInstruction(STYLES.admiral, 1), /naval/i);
  assert.match(qwenInstruction(STYLES.royal, 1), /crown/i);
});

test('a mocked Qwen edit is upscaled to the 300 DPI master', async () => {
  const png = await sharp({ create: { width: 16, height: 24, channels: 3, background: '#c08040' } }).png().toBuffer();
  const photo = path.join(tmp, 'pet.png');
  fs.writeFileSync(photo, png);
  process.env.IMAGE_PROVIDER = 'qwen';
  process.env.QWEN_BACKEND = 'http';
  process.env.QWEN_ENDPOINT_URL = 'http://qwen.test/edit';
  delete process.env.QWEN_ENDPOINT_TOKEN;
  const gate = blockOpenAiKey();
  let requested;
  try {
    const out = await paintPortrait({
      photoPath: photo,
      mimeType: 'image/png',
      style: 'royal',
      variant: 3,
      fetchImpl: async (url, init) => {
        requested = { url, init };
        return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
      },
    });
    assert.equal(gate.reads(), 0);
    assert.equal(requested.url, 'http://qwen.test/edit');
    const body = JSON.parse(requested.init.body);
    assert.match(body.prompt, /exact animal/i);
    assert.match(body.prompt, /crown/i);
    assert.equal(body.image.length > 20, true);
    assert.equal(requested.init.headers?.Authorization, undefined);
    const meta = await sharp(out).metadata();
    assert.equal(meta.width, MASTER.width);
    assert.equal(meta.height, MASTER.height);
    assert.equal(meta.density, 300);
    assert.equal(meta.format, 'png');
  } finally {
    gate.restore();
  }
});

test('Hugging Face fal queue responses become image bytes without reading the OpenAI key', async () => {
  process.env.IMAGE_PROVIDER = 'qwen';
  process.env.QWEN_BACKEND = 'hf';
  process.env.QWEN_HF_PROVIDER = 'fal-ai';
  process.env.HF_TOKEN = 'hf_test_token';
  delete process.env.QWEN_HF_URL;
  const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#336699' } }).png().toBuffer();
  const gate = blockOpenAiKey();
  const calls = [];
  try {
    const buf = await editWithQwen({
      photo: png,
      mimeType: 'image/png',
      prompt: 'Edit this exact animal.',
      variant: 1,
      fetchImpl: async (url, init) => {
        calls.push({ url, auth: init.headers?.Authorization, method: init.method });
        if (calls.length === 1) {
          return Response.json({
            status: 'IN_QUEUE',
            request_id: 'req-1',
            response_url: 'https://queue.fal.run/fal-ai/qwen-image-edit-plus/requests/req-1',
          });
        }
        if (url.endsWith('/status?_subdomain=queue')) {
          return Response.json({ status: 'COMPLETED' });
        }
        if (url.includes('/requests/req-1')) {
          return Response.json({ images: [{ url: 'https://cdn.example/out.png' }] });
        }
        assert.equal(url, 'https://cdn.example/out.png');
        return new Response(png, { status: 200, headers: { 'content-type': 'image/png' } });
      },
    });
    assert.equal(gate.reads(), 0);
    assert.equal(Buffer.compare(buf, png), 0);
    assert.match(calls[0].url, /router\.huggingface\.co\/fal-ai\/fal-ai\/qwen-image-edit-plus/);
    assert.equal(calls[0].auth, 'Bearer hf_test_token');
    assert.equal(calls.some((c) => c.url === 'https://cdn.example/out.png' && !c.auth), true);
  } finally {
    gate.restore();
    delete process.env.HF_TOKEN;
  }
});

test('healthcheck reports the active provider and is not ok when credentials or credits are missing', async () => {
  process.env.IMAGE_PROVIDER = 'openai';
  process.env.OPENAI_API_KEY = 'sk-test-not-secret';
  process.env.IMAGE_MODEL = 'gpt-image-1';
  const urls = [];
  const exhausted = await runHealthcheck({
    fetchImpl: async (url) => {
      urls.push(url);
      if (url.includes('/v1/models')) return Response.json({ data: [] });
      return Response.json({ error: { code: 'credit_balance_exhausted', message: 'credit_balance_exhausted' } }, { status: 429 });
    },
  });
  assert.equal(exhausted.provider, 'openai');
  assert.equal(exhausted.ok, false);
  assert.match(exhausted.image, /credits out/);
  assert.match(exhausted.image, /credit_balance_exhausted/);
  assert.equal(urls.some((u) => u.includes('/images/generations')), true);
  assert.equal(urls.every((u) => !u.includes('/v1/models')), true);

  delete process.env.OPENAI_API_KEY;
  const missing = await runHealthcheck({ fetchImpl: async () => { throw new Error('should not fetch'); } });
  assert.equal(missing.ok, false);
  assert.match(missing.image, /not configured/);

  process.env.IMAGE_PROVIDER = 'qwen';
  process.env.QWEN_BACKEND = 'http';
  delete process.env.QWEN_ENDPOINT_URL;
  const gate = blockOpenAiKey();
  try {
    const qwenMissing = await runHealthcheck({ fetchImpl: async () => { throw new Error('should not fetch'); } });
    assert.equal(qwenMissing.provider, 'qwen');
    assert.equal(qwenMissing.ok, false);
    assert.match(qwenMissing.image, /not configured/);
    assert.equal(gate.reads(), 0);
  } finally {
    gate.restore();
  }

  process.env.QWEN_BACKEND = 'hf';
  process.env.QWEN_HF_PROVIDER = 'fal-ai';
  delete process.env.HF_TOKEN;
  const noToken = await runHealthcheck({ fetchImpl: async () => { throw new Error('should not fetch'); } });
  assert.equal(noToken.ok, false);
  assert.match(noToken.image, /not configured/);

  process.env.HF_TOKEN = 'hf_test_token';
  const unpaid = await runHealthcheck({
    fetchImpl: async () => Response.json({ error: 'You have exceeded your monthly included credits for Inference Providers.' }, { status: 402 }),
  });
  assert.equal(unpaid.provider, 'qwen');
  assert.equal(unpaid.ok, false);
  assert.match(unpaid.image, /credits out/);

  process.env.IMAGE_PROVIDER = 'openai';
  process.env.OPENAI_API_KEY = 'sk-test-not-secret';
  const funded = await runHealthcheck({
    fetchImpl: async () => Response.json({ error: { message: 'prompt is required' } }, { status: 400 }),
  });
  assert.equal(funded.ok, true);
  assert.equal(funded.image, 'ok');
});
