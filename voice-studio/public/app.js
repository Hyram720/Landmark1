/* Sun Voice Studio — front end (no build step) */
const $ = (s) => document.querySelector(s);
const S = { config: null, profiles: [] };

// ---------------- storage helpers (never fatal) ----------------
const store = {
  get(k, d = null) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } },
};

// ---------------- API ----------------
async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  const key = store.get('apiKey');
  if (key) headers['x-api-key'] = key;
  if (opts.body && typeof opts.body !== 'string') { headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(opts.body); }
  const res = await fetch(path, { ...opts, headers });
  if (res.status === 401) {
    const k = prompt('This studio is protected. Enter the VOICE_API_KEY:');
    if (k) { store.set('apiKey', k); return api(path, opts); }
  }
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { msg = (await res.json()).error || msg; } catch {}
    throw new Error(msg);
  }
  return res.headers.get('content-type')?.includes('json') ? res.json() : res;
}

async function tts(text, extra = {}) {
  return api('/api/tts', { method: 'POST', body: { text, json: 1, ...extra } });
}

function setStatus(el, msg, isError = false) {
  el.textContent = msg;
  el.classList.toggle('error', isError);
}

// ---------------- tabs ----------------
document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
function showTab(name) {
  document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  document.querySelectorAll('.panel').forEach((p) => { p.hidden = p.id !== `tab-${name}`; });
  store.set('tab', name);
}

// ---------------- boot ----------------
(async function boot() {
  try {
    S.config = await api('/api/config');
    S.profiles = await api('/api/profiles');
  } catch (e) {
    $('#engine').textContent = 'Server not reachable: ' + e.message;
    $('#engine').classList.add('warn');
    return;
  }
  const eng = S.config.defaultProvider;
  const engEl = $('#engine');
  if (eng === 'mock') {
    engEl.textContent = 'Test mode: add OPENAI_API_KEY to .env for real voices';
    engEl.classList.add('warn');
  } else {
    engEl.textContent = 'Engine: ' + S.config.providers[eng].label;
  }
  renderProfileSelects();
  renderProfileList();
  renderBotDocs();
  loadHistory();
  initReaderEngines();
  restoreReader();
  showTab(store.get('tab', 'speak'));
})();

function profileOptions(sel, selected) {
  sel.innerHTML = S.profiles.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  if (selected && S.profiles.some((p) => p.id === selected)) sel.value = selected;
}
function renderProfileSelects() {
  profileOptions($('#speak-profile'), store.get('speakProfile'));
  profileOptions($('#narr-default'), store.get('narrProfile', 'narrator'));
  if (S.config) initReaderEngines();
}

// ---------------- SPEAK ----------------
const speakText = $('#speak-text');
speakText.value = store.get('speakDraft', '');
const updateCount = () => { $('#speak-count').textContent = `${speakText.value.length.toLocaleString()} characters`; };
updateCount();
speakText.addEventListener('input', () => { updateCount(); store.set('speakDraft', speakText.value); });
$('#speak-profile').addEventListener('change', (e) => store.set('speakProfile', e.target.value));
$('#speak-speed').addEventListener('input', (e) => { $('#speak-speed-val').textContent = Number(e.target.value).toFixed(2) + '×'; e.target.dataset.touched = '1'; });

$('#speak-go').addEventListener('click', async () => {
  const text = speakText.value.trim();
  const status = $('#speak-status');
  if (!text) return setStatus(status, 'Type something first.', true);
  const btn = $('#speak-go');
  btn.disabled = true;
  setStatus(status, text.length > 4000 ? 'Generating long audio, this can take a minute…' : 'Generating…');
  try {
    const extra = { profile: $('#speak-profile').value, source: 'speak' };
    if ($('#speak-speed').dataset.touched) extra.speed = $('#speak-speed').value;
    if ($('#speak-style').value.trim()) extra.instructions = $('#speak-style').value.trim();
    const r = await tts(text, extra);
    const audio = $('#speak-audio');
    audio.src = r.url; audio.hidden = false; audio.play().catch(() => {});
    const dl = $('#speak-download');
    dl.href = r.url; dl.download = `speech-${Date.now()}.${r.url.split('.').pop()}`; dl.hidden = false;
    setStatus(status, r.cached ? 'Ready (reused saved audio, no cost).' : 'Ready.');
    loadHistory();
  } catch (e) {
    setStatus(status, e.message, true);
  } finally { btn.disabled = false; }
});

async function loadHistory() {
  try {
    const h = await api('/api/history');
    $('#history').innerHTML = h.slice(0, 25).map((x) => `
      <li><button data-play="${esc(x.url)}" aria-label="Play">▶</button>
      <span class="t" title="${esc(x.text)}">${esc(x.name || '')}: ${esc(x.text)}</span>
      <a href="${esc(x.url)}" download aria-label="Download">⬇</a></li>`).join('') || '<li class="muted">Nothing yet</li>';
  } catch {}
}
$('#history').addEventListener('click', (e) => {
  const u = e.target.closest('[data-play]')?.dataset.play;
  if (!u) return;
  const a = $('#speak-audio'); a.src = u; a.hidden = false; a.play().catch(() => {});
});

// ---------------- VOICES (profiles) ----------------
const pf = {
  id: $('#pf-id'), name: $('#pf-name'), provider: $('#pf-provider'), voice: $('#pf-voice'),
  speed: $('#pf-speed'), instructions: $('#pf-instructions'),
};
function renderProfileList(activeId) {
  $('#profile-list').innerHTML = S.profiles.map((p) => `
    <li data-id="${esc(p.id)}" class="${p.id === activeId ? 'active' : ''}">
      <div><b>${esc(p.name)}</b><div class="meta">${esc(p.provider)} · ${esc(p.voice)} · ${Number(p.speed).toFixed(2)}× · ID: ${esc(p.id)}</div></div>
    </li>`).join('');
}
function fillProviderSelect(selected) {
  const provs = S.config.providers;
  pf.provider.innerHTML = Object.entries(provs).map(([id, p]) =>
    `<option value="${id}" ${p.available ? '' : 'disabled'}>${esc(p.label)}${p.available ? '' : ' (needs key)'}</option>`).join('');
  pf.provider.value = selected && provs[selected] ? selected : S.config.defaultProvider;
  fillVoiceSelect();
}
function fillVoiceSelect(selected) {
  const p = S.config.providers[pf.provider.value];
  pf.voice.innerHTML = p.voices.map((v) => `<option>${esc(v)}</option>`).join('');
  if (selected) pf.voice.value = selected;
  pf.instructions.disabled = !p.supportsInstructions;
}
pf.provider.addEventListener('change', () => fillVoiceSelect());
pf.speed.addEventListener('input', () => { $('#pf-speed-val').textContent = Number(pf.speed.value).toFixed(2) + '×'; });

function editProfile(p) {
  $('#profile-form-title').textContent = p ? `Edit: ${p.name}` : 'New voice';
  pf.id.value = p?.id || '';
  pf.name.value = p?.name || '';
  fillProviderSelect(p?.provider);
  fillVoiceSelect(p?.voice);
  pf.speed.value = p?.speed || 1;
  pf.speed.dispatchEvent(new Event('input'));
  pf.instructions.value = p?.instructions || '';
  $('#pf-delete').hidden = !p;
  setStatus($('#pf-status'), '');
  renderProfileList(p?.id);
}
$('#profile-list').addEventListener('click', (e) => {
  const id = e.target.closest('li')?.dataset.id;
  if (id) editProfile(S.profiles.find((p) => p.id === id));
});
$('#profile-new').addEventListener('click', () => editProfile(null));
const formData = () => ({
  id: pf.id.value || undefined, name: pf.name.value, provider: pf.provider.value,
  voice: pf.voice.value, speed: pf.speed.value, instructions: pf.instructions.value,
});
$('#profile-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const saved = await api('/api/profiles', { method: 'POST', body: formData() });
    S.profiles = await api('/api/profiles');
    renderProfileSelects(); renderBotDocs(); editProfile(saved);
    setStatus($('#pf-status'), `Saved. Bot ID: ${saved.id}`);
  } catch (err) { setStatus($('#pf-status'), err.message, true); }
});
$('#pf-test').addEventListener('click', async () => {
  const d = formData();
  setStatus($('#pf-status'), 'Generating sample…');
  try {
    const r = await tts($('#pf-sample').value || 'Hello there.', {
      provider: d.provider, voice: d.voice, speed: d.speed, instructions: d.instructions, source: 'voice-test',
    });
    const a = $('#pf-audio'); a.src = r.url; a.hidden = false; a.play().catch(() => {});
    setStatus($('#pf-status'), '');
  } catch (err) { setStatus($('#pf-status'), err.message, true); }
});
$('#pf-delete').addEventListener('click', async () => {
  const id = pf.id.value;
  const p = S.profiles.find((x) => x.id === id);
  if (!p || !confirm(`Delete the voice "${p.name}"? Bots using ID "${p.id}" will stop working.`)) return;
  await api(`/api/profiles/${encodeURIComponent(id)}`, { method: 'DELETE' });
  S.profiles = await api('/api/profiles');
  renderProfileSelects(); renderBotDocs(); editProfile(null);
});
// open the form ready for a new voice once config is loaded
const waitCfg = setInterval(() => { if (S.config) { clearInterval(waitCfg); editProfile(null); } }, 50);

// ---------------- BOT API docs ----------------
function renderBotDocs() {
  const o = location.origin;
  const id = S.profiles[0]?.id || 'support-bot';
  const keyNote = S.config?.keyRequired ? '&key=YOUR_KEY' : '';
  $('#api-get').textContent = `${o}/api/tts?profile=${id}&text=Hi!%20How%20can%20I%20help%20you%20today%3F${keyNote}`;
  $('#api-js').textContent =
`const res = await fetch('${o}/api/tts', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json'${S.config?.keyRequired ? ", 'x-api-key': 'YOUR_KEY'" : ''} },
  body: JSON.stringify({ profile: '${id}', text: botReply }),
});
const audio = new Audio(URL.createObjectURL(await res.blob()));
audio.play();`;
  $('#api-json').textContent =
`POST ${o}/api/tts
{ "profile": "${id}", "text": "Thanks for calling!", "json": 1 }

→ { "url": "/audio/3f9c….mp3", "cached": false, ... }`;
  $('#api-ids').innerHTML = S.profiles.map((p) => `<li><code>${esc(p.id)}</code>: ${esc(p.name)}</li>`).join('');
}

// ---------------- READER ----------------
const R = { title: '', paras: [], idx: 0, playing: false, token: 0, audio: new Audio(), urls: new Map() };
let browserVoices = [];

function initReaderEngines() {
  const sel = $('#reader-engine');
  const saved = store.get('readerEngine') || sel.value;
  browserVoices = ('speechSynthesis' in window) ? speechSynthesis.getVoices() : [];
  const studio = S.profiles.map((p) => `<option value="p:${esc(p.id)}">Studio: ${esc(p.name)}</option>`).join('');
  const local = browserVoices.map((v) => `<option value="b:${esc(v.voiceURI)}">Free: ${esc(v.name)}</option>`).join('');
  sel.innerHTML = `<optgroup label="Studio voices">${studio}</optgroup>` + (local ? `<optgroup label="Free computer voices (offline)">${local}</optgroup>` : '');
  const fallback = S.profiles.find((p) => p.id === 'book-reader') ? 'p:book-reader' : sel.options[0]?.value;
  sel.value = [...sel.options].some((o) => o.value === saved) ? saved : fallback;
}
if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = () => { if (S.config) initReaderEngines(); };
$('#reader-engine').addEventListener('change', (e) => { store.set('readerEngine', e.target.value); if (R.playing) speakPara(R.idx); });
$('#reader-speed').value = store.get('readerSpeed', '1');
$('#reader-speed').addEventListener('change', (e) => {
  store.set('readerSpeed', e.target.value);
  R.audio.playbackRate = Number(e.target.value);
  if (R.playing && $('#reader-engine').value.startsWith('b:')) speakPara(R.idx);
});

$('#reader-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  $('#reader-title').textContent = 'Opening…';
  try {
    const book = await parseFile(file);
    openBook(book.title || file.name.replace(/\.[^.]+$/, ''), book.paras);
  } catch (err) {
    $('#reader-title').textContent = 'Could not open file: ' + err.message;
  }
  e.target.value = '';
});
$('#reader-paste').addEventListener('click', () => $('#paste-dialog').showModal());
$('#paste-dialog').addEventListener('close', () => {
  if ($('#paste-dialog').returnValue !== 'ok') return;
  const body = $('#paste-body').value.trim();
  if (body) openBook($('#paste-title').value.trim() || 'Pasted text', textToParas(body));
  $('#paste-body').value = ''; $('#paste-title').value = '';
});

function openBook(title, paras) {
  stopReading();
  R.title = title;
  R.paras = paras.filter((p) => p.text.trim());
  R.urls.clear();
  R.idx = Math.min(store.get('pos:' + title, 0), Math.max(0, R.paras.length - 1));
  if (!store.set('reader:last', { title, paras: R.paras })) store.set('reader:last', null);
  renderBook();
}
function restoreReader() {
  const last = store.get('reader:last');
  if (last?.paras?.length) { R.title = last.title; R.paras = last.paras; R.idx = store.get('pos:' + last.title, 0); renderBook(); }
}
function renderBook() {
  $('#reader-title').textContent = R.title;
  $('#reader-title').classList.remove('muted');
  const art = $('#reader-text');
  art.innerHTML = R.paras.map((p, i) => p.heading ? `<h2 data-i="${i}">${esc(p.text)}</h2>` : `<p data-i="${i}">${esc(p.text)}</p>`).join('');
  highlight(false);
}
$('#reader-text').addEventListener('click', (e) => {
  const i = e.target.closest('[data-i]')?.dataset.i;
  if (i == null) return;
  R.idx = Number(i);
  if (R.playing) speakPara(R.idx); else { highlight(true); savePos(); }
});
function highlight(scroll) {
  document.querySelectorAll('#reader-text .now').forEach((n) => n.classList.remove('now'));
  const el = document.querySelector(`#reader-text [data-i="${R.idx}"]`);
  if (el) { el.classList.add('now'); if (scroll) el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  $('#reader-progress').max = Math.max(1, R.paras.length - 1);
  $('#reader-progress').value = R.idx;
  $('#reader-pos').textContent = R.paras.length ? `${Math.round((R.idx / Math.max(1, R.paras.length - 1)) * 100)}% · ${R.idx + 1} / ${R.paras.length}` : '';
}
const savePos = () => store.set('pos:' + R.title, R.idx);

$('#reader-play').addEventListener('click', () => {
  if (!R.paras.length) return;
  if (R.playing) stopReading(); else { R.playing = true; $('#reader-play').textContent = 'Pause'; speakPara(R.idx); }
});
$('#reader-next').addEventListener('click', () => step(1));
$('#reader-prev').addEventListener('click', () => step(-1));
function step(d) {
  R.idx = Math.min(R.paras.length - 1, Math.max(0, R.idx + d));
  if (R.playing) speakPara(R.idx); else { highlight(true); savePos(); }
}
function stopReading() {
  R.playing = false; R.token++;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  R.audio.pause();
  $('#reader-play').textContent = 'Play';
}
function advance(token) {
  if (token !== R.token || !R.playing) return;
  if (R.idx >= R.paras.length - 1) { stopReading(); return; }
  R.idx++; speakPara(R.idx);
}

async function speakPara(i) {
  const token = ++R.token;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  R.audio.pause();
  highlight(true); savePos();
  const engine = $('#reader-engine').value || '';
  const speed = Number($('#reader-speed').value);
  const text = R.paras[i].text;

  if (engine.startsWith('b:')) {
    // Free computer voice. Speak sentence by sentence (long utterances get cut off in some browsers).
    const voice = browserVoices.find((v) => v.voiceURI === engine.slice(2));
    const parts = sentenceChunks(text, 220);
    let n = 0;
    const next = () => {
      if (token !== R.token) return;
      if (n >= parts.length) return advance(token);
      const u = new SpeechSynthesisUtterance(parts[n++]);
      if (voice) u.voice = voice;
      u.rate = speed;
      u.onend = next;
      u.onerror = (ev) => { if (ev.error !== 'interrupted' && ev.error !== 'canceled') next(); };
      speechSynthesis.speak(u);
    };
    next();
    return;
  }

  // Studio voice: fetch audio for this paragraph and pre-load the next one.
  const profile = engine.slice(2);
  try {
    $('#reader-pos').textContent += ' · loading…';
    const url = await paraUrl(i, profile);
    if (token !== R.token) return;
    if (i + 1 < R.paras.length) paraUrl(i + 1, profile).catch(() => {});
    if (i + 2 < R.paras.length) paraUrl(i + 2, profile).catch(() => {});
    R.audio.src = url;
    R.audio.playbackRate = speed;
    R.audio.onended = () => advance(token);
    highlight(false);
    await R.audio.play();
  } catch (err) {
    if (token !== R.token) return;
    stopReading();
    $('#reader-pos').textContent = 'Error: ' + err.message;
  }
}
function paraUrl(i, profile) {
  const key = profile + '|' + i;
  if (!R.urls.has(key)) {
    const p = tts(R.paras[i].text, { profile, source: 'reader' }).then((r) => r.url);
    p.catch(() => R.urls.delete(key));
    R.urls.set(key, p);
  }
  return R.urls.get(key);
}

// ---- file parsing ----
async function parseFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (ext === 'epub') return parseEpub(file);
  if (ext === 'pdf') return parsePdf(file);
  const raw = await file.text();
  if (ext === 'html' || ext === 'htm') {
    const doc = new DOMParser().parseFromString(raw, 'text/html');
    return { title: doc.title, paras: htmlToParas(doc) };
  }
  return { paras: textToParas(raw.replace(/^#+\s*/gm, '')) };
}

function textToParas(text) {
  const blocks = text.replace(/\r/g, '').split(/\n\s*\n/);
  const out = [];
  for (const b of blocks) {
    const t = b.replace(/\s*\n\s*/g, ' ').trim();
    if (!t) continue;
    for (const piece of sentenceChunks(t, 1200)) out.push({ text: piece });
  }
  return out;
}

function htmlToParas(doc) {
  doc.querySelectorAll('script,style,nav,header,footer,aside').forEach((n) => n.remove());
  const SEL = 'h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,div,section,article,td';
  // only "leaf" blocks, so nested markup is never read twice
  const blocks = [...(doc.body?.querySelectorAll(SEL) || [])].filter((el) => !el.querySelector(SEL));
  const out = [];
  for (const el of blocks) {
    const t = el.textContent.replace(/\s+/g, ' ').trim();
    if (!t) continue;
    const heading = /^H[1-4]$/.test(el.tagName);
    if (heading) out.push({ text: t, heading: true });
    else for (const piece of sentenceChunks(t, 1200)) out.push({ text: piece });
  }
  if (!out.length && doc.body) return textToParas(doc.body.textContent);
  return out;
}

async function parseEpub(file) {
  if (!window.JSZip) throw new Error('EPUB support needs an internet connection the first time.');
  const zip = await JSZip.loadAsync(file);
  const container = await zip.file('META-INF/container.xml')?.async('string');
  const opfPath = container?.match(/full-path="([^"]+)"/)?.[1];
  if (!opfPath) throw new Error('This EPUB looks damaged.');
  const opf = new DOMParser().parseFromString(await zip.file(opfPath).async('string'), 'application/xml');
  const base = opfPath.includes('/') ? opfPath.replace(/[^/]+$/, '') : '';
  const manifest = {};
  opf.querySelectorAll('manifest > item').forEach((it) => { manifest[it.getAttribute('id')] = it.getAttribute('href'); });
  const title = opf.getElementsByTagName('dc:title')[0]?.textContent || '';
  const paras = [];
  for (const ref of opf.querySelectorAll('spine > itemref')) {
    const href = manifest[ref.getAttribute('idref')];
    if (!href) continue;
    const p = resolvePath(base, decodeURIComponent(href.split('#')[0]));
    const html = await zip.file(p)?.async('string');
    if (html) paras.push(...htmlToParas(new DOMParser().parseFromString(html, 'text/html')));
  }
  return { title, paras };
}
function resolvePath(base, rel) {
  const parts = (base + rel).split('/');
  const out = [];
  for (const s of parts) { if (s === '..') out.pop(); else if (s && s !== '.') out.push(s); }
  return out.join('/');
}

async function parsePdf(file) {
  if (!window.pdfjsLib) throw new Error('PDF support needs an internet connection the first time.');
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  const paras = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    let text = '';
    for (const it of content.items) text += it.str + (it.hasEOL ? '\n' : '');
    // re-join hyphenated words and wrapped lines
    text = text.replace(/-\n(?=[a-z])/g, '').replace(/\n(?!\n)/g, ' ').replace(/\s+/g, ' ').trim();
    if (text) for (const piece of sentenceChunks(text, 700)) paras.push({ text: piece });
  }
  if (!paras.length) throw new Error('No readable text found (this PDF may be scanned images).');
  return { title: (await pdf.getMetadata().catch(() => null))?.info?.Title || '', paras };
}

function sentenceChunks(text, max) {
  if (text.length <= max) return [text];
  const sentences = text.match(/[^.!?]+[.!?]+["”’)\]]*\s*|[^.!?]+$/g) || [text];
  const out = []; let cur = '';
  for (const s of sentences) {
    if ((cur + s).length > max && cur) { out.push(cur.trim()); cur = ''; }
    if (s.length > max) { for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max).trim()); }
    else cur += s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// ---------------- NARRATION ----------------
$('#narr-script').value = store.get('narrDraft', '');
$('#narr-script').addEventListener('input', (e) => store.set('narrDraft', e.target.value));
$('#narr-default').addEventListener('change', (e) => store.set('narrProfile', e.target.value));

function parseScript(script, defaultId) {
  const byName = new Map();
  S.profiles.forEach((p) => { byName.set(p.name.toLowerCase(), p); byName.set(p.id.toLowerCase(), p); });
  const segs = [];
  let pauseNext = false;
  for (const line of script.replace(/\r/g, '').split('\n')) {
    const t = line.trim();
    if (!t) { pauseNext = segs.length > 0; continue; }
    let profile = defaultId, text = t;
    const m = t.match(/^([^:]{1,40}):\s+(.+)$/);
    if (m && byName.has(m[1].trim().toLowerCase())) { profile = byName.get(m[1].trim().toLowerCase()).id; text = m[2]; }
    segs.push({ profile, text, longPause: pauseNext });
    pauseNext = false;
  }
  return segs;
}

$('#narr-go').addEventListener('click', async () => {
  const status = $('#narr-status');
  const segs = parseScript($('#narr-script').value, $('#narr-default').value);
  if (!segs.length) return setStatus(status, 'Write a script first.', true);
  const btn = $('#narr-go');
  btn.disabled = true;
  const list = $('#narr-lines');
  const nameOf = (id) => S.profiles.find((p) => p.id === id)?.name || id;
  list.innerHTML = segs.map((s, i) => `<li id="nl-${i}"><span class="who">${esc(nameOf(s.profile))}</span><span>${esc(s.text)}</span></li>`).join('');
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
    let done = 0, failed = false;
    setStatus(status, `Generating 0 / ${segs.length} lines…`);
    const buffers = await mapLimit(segs, 3, async (s, i) => {
      if (failed) throw new Error('stopped');
      const r = await tts(s.text, { profile: s.profile, source: 'narration' }).catch((e) => {
        failed = true;
        throw new Error(`Line ${i + 1} failed: ${e.message}`);
      });
      if (failed) throw new Error('stopped');
      const bytes = await (await fetch(r.url)).arrayBuffer();
      const buf = await ctx.decodeAudioData(bytes);
      document.getElementById(`nl-${i}`).firstElementChild.classList.add('ok');
      setStatus(status, `Generating ${++done} / ${segs.length} lines…`);
      return buf;
    });
    setStatus(status, 'Stitching audio and captions…');
    const gap = Number($('#narr-gap').value) / 1000;
    const { wav, cues } = stitch(buffers, segs, gap, ctx.sampleRate);
    ctx.close();
    const wavUrl = URL.createObjectURL(wav);
    const audio = $('#narr-audio'); audio.src = wavUrl; audio.hidden = false;
    const a1 = $('#narr-wav'); a1.href = wavUrl; a1.hidden = false;
    const a2 = $('#narr-srt'); a2.href = URL.createObjectURL(new Blob([toSrt(cues)], { type: 'text/plain' })); a2.hidden = false;
    const total = cues.length ? cues[cues.length - 1].end : 0;
    setStatus(status, `Done: ${fmtDur(total)} of narration, ${cues.length} captions.`);
  } catch (e) {
    setStatus(status, e.message, true);
  } finally { btn.disabled = false; }
});

function stitch(buffers, segs, gap, rate) {
  const lead = 0.25;
  let total = lead;
  buffers.forEach((b, i) => { total += b.duration + (i < buffers.length - 1 ? (segs[i + 1].longPause ? gap * 2.5 : gap) : 0.4); });
  const len = Math.ceil(total * rate);
  const out = new Float32Array(len);
  const cues = [];
  let t = lead;
  buffers.forEach((b, i) => {
    const start = Math.floor(t * rate);
    const chans = b.numberOfChannels;
    for (let c = 0; c < chans; c++) {
      const d = b.getChannelData(c);
      for (let k = 0; k < d.length && start + k < len; k++) out[start + k] += d[k] / chans;
    }
    // split long lines into readable captions, timed by length
    const pieces = captionPieces(segs[i].text);
    const chars = pieces.reduce((n, p) => n + p.length, 0);
    let ct = t;
    for (const p of pieces) {
      const dur = b.duration * (p.length / chars);
      cues.push({ start: ct, end: ct + dur, text: p });
      ct += dur;
    }
    t += b.duration + (i < buffers.length - 1 ? (segs[i + 1].longPause ? gap * 2.5 : gap) : 0);
  });
  return { wav: encodeWav(out, rate), cues };
}

function captionPieces(text, max = 84) {
  if (text.length <= max) return [text];
  const words = text.split(/\s+/);
  const out = []; let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max && cur) { out.push(cur); cur = w; }
    else cur = (cur + ' ' + w).trim();
    if (/[.!?;:]$/.test(w) && cur.length > max * 0.5) { out.push(cur); cur = ''; }
  }
  if (cur) out.push(cur);
  return out;
}

function encodeWav(samples, rate) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  w(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  w(36, 'data'); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

function toSrt(cues) {
  const ts = (s) => {
    const ms = Math.round(s * 1000);
    const p = (n, l = 2) => String(n).padStart(l, '0');
    return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
  };
  return cues.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join('\n');
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; results[i] = await fn(items[i], i); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// ---------------- utils ----------------
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function fmtDur(s) { const m = Math.floor(s / 60); return `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`; }
