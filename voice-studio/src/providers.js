// Speech engines. Each provider turns text into audio bytes.
// To add another engine later, add an entry with the same shape.

const OPENAI_VOICES = [
  'alloy', 'ash', 'ballad', 'coral', 'echo', 'fable',
  'nova', 'onyx', 'sage', 'shimmer', 'verse',
];

export const providers = {
  openai: {
    label: 'OpenAI voices (studio quality)',
    voices: OPENAI_VOICES,
    supportsInstructions: true,
    maxChars: 4000, // API limit is 4096 per request; longer text is chunked
    mime: 'audio/mpeg',
    ext: 'mp3',
    available: () => Boolean(process.env.OPENAI_API_KEY),
    async synthesize(text, { voice = 'alloy', speed = 1, instructions = '' } = {}) {
      const model = process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts';
      const body = {
        model,
        voice: OPENAI_VOICES.includes(voice) ? voice : 'alloy',
        input: text,
        response_format: 'mp3',
        speed: clamp(Number(speed) || 1, 0.25, 4),
      };
      if (instructions && model.startsWith('gpt-')) body.instructions = instructions;
      const res = await fetch('https://api.openai.com/v1/audio/speech', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`OpenAI speech request failed (${res.status}): ${detail.slice(0, 300)}`);
      }
      return Buffer.from(await res.arrayBuffer());
    },
  },

  // Test engine: makes a soft tone whose length matches the text.
  // Lets you try every screen without an API key or spending money.
  mock: {
    label: 'Test tones (no key needed)',
    voices: ['low', 'mid', 'high'],
    supportsInstructions: false,
    maxChars: Infinity,
    mime: 'audio/wav',
    ext: 'wav',
    available: () => true,
    async synthesize(text, { voice = 'mid', speed = 1 } = {}) {
      const words = Math.max(1, text.trim().split(/\s+/).length);
      const seconds = Math.min(120, (words * 0.32) / (Number(speed) || 1));
      const freq = { low: 180, mid: 260, high: 380 }[voice] || 260;
      return toneWav(seconds, freq);
    },
  },
};

export function getProvider(name) {
  return providers[name] || null;
}

export function defaultProviderName() {
  const wanted = process.env.TTS_PROVIDER;
  if (wanted && providers[wanted]?.available()) return wanted;
  if (providers.openai.available()) return 'openai';
  return 'mock';
}

// Split long text at sentence boundaries so each piece fits the engine's limit.
export function chunkText(text, maxChars) {
  const clean = text.replace(/\r/g, '').trim();
  if (clean.length <= maxChars) return [clean];
  const sentences = clean.match(/[^.!?\n]+[.!?]*[\s"”’)]*|\n+/g) || [clean];
  const chunks = [];
  let current = '';
  for (const s of sentences) {
    if ((current + s).length > maxChars && current) {
      chunks.push(current.trim());
      current = '';
    }
    if (s.length > maxChars) {
      for (let i = 0; i < s.length; i += maxChars) chunks.push(s.slice(i, i + maxChars).trim());
    } else {
      current += s;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.filter(Boolean);
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function toneWav(seconds, freq) {
  const rate = 22050;
  const n = Math.floor(seconds * rate);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const syllable = 0.5 + 0.5 * Math.sin(2 * Math.PI * 3 * t); // speech-like pulsing
    const fade = Math.min(1, t * 20, (seconds - t) * 20);
    const v = Math.sin(2 * Math.PI * freq * t) * syllable * fade * 0.25;
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  return buf;
}
