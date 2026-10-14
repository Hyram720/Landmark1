/*
 * Browser-direct Claude calls for the no-login master file (no server). The user's own Anthropic
 * API key is kept in this browser's localStorage only and is never included in backups.
 * Raw HTTP because the master file is a single static page with no build step for the SDK.
 */
(function (root) {
  'use strict';
  const KEY = 'ledger-anthropic-key';
  const MODEL = 'claude-opus-5-5';

  function getKey() { try { return root.localStorage.getItem(KEY) || ''; } catch (e) { return ''; } }
  function setKey(v) { try { if (v) root.localStorage.setItem(KEY, v); else root.localStorage.removeItem(KEY); } catch (e) { /* storage blocked */ } }

  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1]);
      r.onerror = () => reject(new Error('Could not read the file'));
      r.readAsDataURL(file);
    });
  }
  function fileToText(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error('Could not read the file'));
      r.readAsText(file);
    });
  }

  /** Builds the user content for a scan from a File or pasted text. Shared by server-less mode. */
  async function scanContent({ file, text }) {
    const P = root.AIPrompts;
    if (file && file.type === 'application/pdf') return [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: await fileToBase64(file) } }, { type: 'text', text: P.SCAN_PROMPT }];
    if (file && /^image\/(png|jpeg|webp|gif)$/.test(file.type)) return [{ type: 'image', source: { type: 'base64', media_type: file.type, data: await fileToBase64(file) } }, { type: 'text', text: P.SCAN_PROMPT }];
    const raw = file ? await fileToText(file) : String(text || '');
    const body = /<(table|div|td|html)\b/i.test(raw) ? P.htmlToText(raw) : raw;
    return `<credit_report>\n${body.slice(0, 600000)}\n</credit_report>\n\n${P.SCAN_PROMPT}`;
  }

  /** Streams a structured-output request and returns the parsed JSON. */
  async function structured({ content, schema, system, maxTokens }) {
    const key = getKey();
    if (!key) throw new Error('Add your Anthropic API key in Settings → AI in this browser');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'server-side-fallback-2026-07-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: MODEL, max_tokens: maxTokens || 64000, stream: true, fallbacks: 'default',
        output_config: { effort: 'medium', format: { type: 'json_schema', schema } },
        system, messages: [{ role: 'user', content }]
      })
    });
    if (!res.ok) {
      let msg = `AI request failed (${res.status})`;
      try { const j = await res.json(); if (j.error && j.error.message) msg = j.error.message; } catch (e) { /* not JSON */ }
      if (res.status === 401) msg = 'Your Anthropic API key was rejected. Check it in Settings.';
      if (res.status === 429) msg = 'The AI service is busy or your key hit its limit. Try again in a minute.';
      throw new Error(msg);
    }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '', text = '', stop = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const line = chunk.split('\n').find(l => l.startsWith('data:'));
        if (!line) continue;
        let ev;
        try { ev = JSON.parse(line.slice(5)); } catch (e) { continue; }
        if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') text += ev.delta.text;
        else if (ev.type === 'message_delta' && ev.delta) stop = ev.delta.stop_reason || stop;
        else if (ev.type === 'error') throw new Error((ev.error && ev.error.message) || 'AI stream error');
      }
    }
    if (stop === 'refusal') throw new Error('The AI declined this request.');
    if (stop === 'max_tokens') throw new Error('The report is too long to scan in one pass. Split it by bureau and scan each part.');
    return JSON.parse(text);
  }

  async function scan({ file, text }) {
    const P = root.AIPrompts;
    return structured({ content: await scanContent({ file, text }), schema: P.REPORT_SCHEMA, system: P.SCAN_SYSTEM });
  }

  root.AIDirect = { getKey, setKey, scan, structured, MODEL };
})(window);
