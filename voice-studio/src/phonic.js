// Phonic-1 live voice agents (speech-to-speech).
// The browser talks to Phonic directly over a WebSocket; this server only
// mints short-lived session tokens so your PHONIC_API_KEY never reaches the browser.
// Protocol follows Phonic's docs and their MIT-licensed phonic-web-demo.

export const PHONIC_VOICES = [
  ['sabrina', 'Sabrina', 'Female', 'Cheerful, expressive, polished'],
  ['grant', 'Grant', 'Male', 'Chill, casual, friendly'],
  ['shelby', 'Shelby', 'Female', 'Southern accent; friendly, reassuring'],
  ['landon', 'Landon', 'Male', 'Confident, firm, deep'],
  ['mason', 'Mason', 'Male', 'Casual, patient, mellow'],
  ['virginia', 'Virginia', 'Female', 'Approachable, empathetic, friendly'],
  ['eleanor', 'Eleanor', 'Female', 'Grounded, patient, reassuring'],
  ['gabrielle', 'Gabrielle', 'Female', 'Calm, reassuring, velvety'],
  ['paula', 'Paula', 'Female', 'Approachable, grounded, smooth'],
  ['nolan', 'Nolan', 'Male', 'Confident, direct, professional'],
  ['phillip', 'Phillip', 'Male', 'Empathetic, professional, friendly'],
  ['jackson', 'Jackson', 'Male', 'Gravelly, confident, chill'],
  ['gina', 'Gina', 'Female', 'Bright, cheerful, smooth'],
  ['kourtney', 'Kourtney', 'Female', 'Clear, friendly, upbeat'],
  ['alice', 'Alice', 'Female', 'Peaceful, mellow, approachable'],
  ['michelle', 'Michelle', 'Female', 'Deep, serious, measured'],
  ['joon', 'Joon', 'Male', 'Grounded, approachable, patient'],
  ['tomoya', 'Tomoya', 'Male', 'Steady, gravelly, patient'],
  ['henri', 'Henri', 'Male', 'Deliberate, firm, flat'],
  ['mei', 'Mei', 'Female', 'Clear, patient, upbeat'],
  ['hana', 'Hana', 'Female', 'Calm, light, smooth'],
  ['stella', 'Stella', 'Female', 'Bright, clear, high-pitched'],
  ['roberto', 'Roberto', 'Male', 'Mexican Spanish accent; casual, suave'],
  ['eduardo', 'Eduardo', 'Male', 'Slight Mexican Spanish accent; patient'],
  ['valeria', 'Valeria', 'Female', 'Slight Colombian accent; cheerful'],
  ['juliana', 'Juliana', 'Female', 'Slight Brazilian accent; calm, smooth'],
  ['daniela', 'Daniela', 'Female', 'Brazilian accent; bright, precise'],
  ['eloise', 'Eloise', 'Female', 'British accent; bright, polished'],
  ['amelia', 'Amelia', 'Female', 'British accent; cultured, professional'],
  ['william', 'William', 'Male', 'British accent; confident, brisk'],
  ['mia', 'Mia', 'Female', 'Australian accent; chill, friendly'],
  ['derek', 'Derek', 'Male', 'Australian accent; confident, deep'],
  ['karin', 'Karin', 'Female', 'South African accent; direct, friendly'],
  ['jerome', 'Jerome', 'Male', 'French accent; cheerful, expressive'],
  ['kaspar', 'Kaspar', 'Male', 'Slight German accent; reassuring, chill'],
  ['karoline', 'Karoline', 'Female', 'German accent; crisp, direct'],
  ['hikari', 'Hikari', 'Female', 'Japanese accent; upbeat, soft-spoken'],
  ['divya', 'Divya', 'Female', 'Indian accent; cheerful, precise'],
  ['sandeep', 'Sandeep', 'Male', 'Strong Indian accent; serious'],
].map(([id, name, gender, style]) => ({ id, name, gender, style }));

export const TURN_TAKING = ['eager', 'standard', 'relaxed', 'measured', 'patient', 'very_patient'];

export const DEFAULT_AGENTS = [
  {
    id: 'sun-receptionist',
    name: 'Sun Marketing Receptionist',
    voice_id: 'shelby',
    turn_taking: 'standard',
    welcome_message: "Hi, thanks for calling Sun Marketing! Who do I have the pleasure of speaking with today?",
    system_prompt: [
      'You are the friendly front-desk voice for Sun Marketing, a marketing agency.',
      'Greet callers warmly, find out their name, their business, and what they need help with',
      '(ads, social media, websites, SEO, or something else).',
      'Keep every reply short and natural, one or two sentences, like a real phone call.',
      'Never invent prices, guarantees, or appointment times. If asked, say a strategist will follow up',
      'and collect the best phone number or email to reach them.',
      'Before ending, repeat back their name and contact details to confirm.',
    ].join(' '),
  },
  {
    id: 'sales-closer',
    name: 'Sales Follow-up',
    voice_id: 'nolan',
    turn_taking: 'standard',
    welcome_message: "Hey there, this is the Sun Marketing team following up. Do you have two minutes?",
    system_prompt: [
      'You follow up with warm leads for Sun Marketing. Be confident, relaxed and genuinely curious.',
      'Ask what their biggest marketing headache is right now, listen, and reflect it back.',
      'Your goal is to book a free strategy call: ask what day and time generally works and collect',
      'their email. Do not pressure, do not make promises about results, keep replies brief.',
    ].join(' '),
  },
  {
    id: 'practice-partner',
    name: 'Practice Partner',
    voice_id: 'grant',
    turn_taking: 'relaxed',
    welcome_message: "Hey! What do you want to practice or talk through today?",
    system_prompt: 'You are a relaxed, encouraging conversation partner. Help the user rehearse sales calls, pitches, or just chat. Keep replies short and ask good follow-up questions.',
  },
];

export function phonicConfigured() {
  return Boolean(process.env.PHONIC_API_KEY);
}

export function phonicApiBase() {
  return (process.env.PHONIC_API_BASE || 'https://api.phonic.ai').replace(/\/$/, '');
}

export function phonicWsUrl() {
  return process.env.PHONIC_WS_URL || phonicApiBase().replace(/^http/, 'ws') + '/v1/sts/ws';
}

export async function createSessionToken(ttlSeconds = 600) {
  const res = await fetch(`${phonicApiBase()}/v1/auth/session_token`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.PHONIC_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ttl_seconds: ttlSeconds }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.session_token) {
    const msg = body?.error?.message || `Phonic refused the request (${res.status})`;
    throw Object.assign(new Error(msg), { status: res.status === 401 ? 401 : 502 });
  }
  return { sessionToken: body.session_token, expiresAt: body.expires_at, wsUrl: phonicWsUrl() };
}

// What the browser sends as its first WebSocket message.
export function agentToConfig(agent) {
  const cfg = {
    type: 'config',
    model: 'phonic-1',
    voice_id: agent.voice_id || 'sabrina',
    system_prompt: agent.system_prompt || 'You are a helpful voice assistant. Keep replies short.',
    input_format: 'pcm_44100',
    output_format: 'pcm_44100',
  };
  if (agent.welcome_message) cfg.welcome_message = agent.welcome_message;
  if (TURN_TAKING.includes(agent.turn_taking)) cfg.turn_taking = agent.turn_taking;
  return cfg;
}

export function cleanAgent(input = {}) {
  return {
    id: input.id,
    name: String(input.name || '').trim().slice(0, 80),
    voice_id: PHONIC_VOICES.some((v) => v.id === input.voice_id) ? input.voice_id : 'sabrina',
    turn_taking: TURN_TAKING.includes(input.turn_taking) ? input.turn_taking : 'standard',
    welcome_message: String(input.welcome_message || '').slice(0, 500),
    system_prompt: String(input.system_prompt || '').slice(0, 8000),
  };
}
