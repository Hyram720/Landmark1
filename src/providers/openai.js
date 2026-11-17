// OpenAI image edits. Used only when IMAGE_PROVIDER=openai (the default).
import fs from 'node:fs';
import path from 'node:path';
import config from '../config.js';

export async function editWithOpenAI({ photoPath, mimeType, prompt, fetchImpl = fetch }) {
  const form = new FormData();
  form.append('model', config.image.model);
  form.append('prompt', prompt);
  form.append('size', '1024x1536');
  form.append('quality', 'high');
  form.append('n', '1');
  form.append('image', new Blob([fs.readFileSync(photoPath)], { type: mimeType }), path.basename(photoPath));

  const res = await fetchImpl('https://api.openai.com/v1/images/edits', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.image.openaiKey}` },
    body: form,
  });
  const body = await res.json();
  if (!res.ok) {
    const code = body.error?.code ? `${body.error.code}: ` : '';
    throw new Error(`OpenAI: ${code}${body.error?.message || res.status}`);
  }
  return Buffer.from(body.data[0].b64_json, 'base64');
}

// Text-to-image for demo subject photos. Not the customer portrait path.
export async function generateOpenAIPhoto(prompt, fetchImpl = fetch) {
  const res = await fetchImpl('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.image.openaiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.image.model, prompt, size: '1024x1536', quality: 'high', n: 1 }),
  });
  const body = await res.json();
  if (!res.ok) {
    const code = body.error?.code ? `${body.error.code}: ` : '';
    throw new Error(`OpenAI: ${code}${body.error?.message || res.status}`);
  }
  return Buffer.from(body.data[0].b64_json, 'base64');
}
