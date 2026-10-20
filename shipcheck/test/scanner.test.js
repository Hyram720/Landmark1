import { test } from 'node:test';
import assert from 'node:assert/strict';
import AdmZip from 'adm-zip';
import { scanFiles, summarize, mask } from '../src/scanner.js';
import { filesFromZip, parseGithubUrl } from '../src/intake.js';

// Fake credentials are assembled at runtime so no secret-shaped string is ever committed.
const rand = (n) => Array.from({ length: n }, (_, i) => 'aB3dE5gH7jK9mN1pQ'[i % 17]).join('');
const fakeOpenAI = ['sk', 'proj', rand(40)].join('-');
const fakeStripe = ['sk', 'live', rand(28)].join('_');
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const serviceJwt = `${b64({ alg: 'HS256' })}.${b64({ role: 'service_role', iss: 'supabase' })}.${rand(30)}`;
const anonJwt = `${b64({ alg: 'HS256' })}.${b64({ role: 'anon', iss: 'supabase' })}.${rand(30)}`;

const vulnerableApp = [
  { path: 'package.json', text: '{"name":"demo"}' },
  { path: '.env', text: `OPENAI_API_KEY=${fakeOpenAI}\n` },
  { path: 'src/lib/ai.ts', text: `const client = new OpenAI({ apiKey: "${fakeOpenAI}", dangerouslyAllowBrowser: true });` },
  { path: 'src/lib/supabase.ts', text: `export const admin = createClient(url, "${serviceJwt}");\nexport const pub = createClient(url, "${anonJwt}");` },
  { path: 'src/components/Pay.tsx', text: 'const key = process.env.NEXT_PUBLIC_STRIPE_SECRET_KEY; <div dangerouslySetInnerHTML={{__html: x}} />' },
  { path: 'server/billing.js', text: `const stripe = Stripe("${fakeStripe}");\napp.post('/webhook', (req) => { if (req.body.type === 'checkout.session.completed') grant(); });` },
  { path: 'supabase/migrations/001.sql', text: 'create table public.profiles (id uuid);\ncreate table notes (id uuid);\nalter table notes enable row level security;\ncreate policy "all" on notes for select using (true);' },
  { path: 'firestore.rules', text: 'match /{doc=**} { allow read, write: if true; }' },
];

test('finds every planted problem', () => {
  const rules = new Set(scanFiles(vulnerableApp).map((f) => f.rule));
  for (const r of ['hardcoded-secret', 'supabase-service-role', 'public-env-secret', 'llm-in-browser', 'stripe-webhook-unverified',
    'supabase-no-rls', 'supabase-open-policy', 'firebase-open-rules', 'env-committed', 'gitignore-env', 'no-lockfile', 'raw-html']) {
    assert.ok(rules.has(r), `missing ${r}`);
  }
});

test('only flags tables that lack RLS, and ignores the anon key', () => {
  const f = scanFiles(vulnerableApp);
  assert.deepEqual(f.filter((x) => x.rule === 'supabase-no-rls').map((x) => x.evidence), ['create table public.profiles']);
  assert.equal(f.filter((x) => x.rule === 'supabase-service-role').length, 1);
});

test('never reveals a full secret', () => {
  const report = JSON.stringify(scanFiles(vulnerableApp));
  for (const s of [fakeOpenAI, fakeStripe, serviceJwt]) assert.ok(!report.includes(s));
  assert.match(mask(fakeOpenAI), /^sk-pro…/);
});

test('a clean project scores 100', () => {
  const clean = [
    { path: '.gitignore', text: 'node_modules\n.env*\n' },
    { path: 'package.json', text: '{}' },
    { path: 'package-lock.json', text: '{}' },
    { path: '.env.example', text: 'OPENAI_API_KEY=your-key-here' },
    { path: 'server/ai.js', text: 'const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });' },
    { path: 'server/hook.js', text: "stripe.webhooks.constructEvent(raw, sig, secret); if (e.type === 'checkout.session.completed') {}" },
  ];
  const findings = scanFiles(clean);
  assert.deepEqual(findings, []);
  assert.equal(summarize(findings).score, 100);
});

test('reads zips in memory, strips the wrapper folder and skips node_modules', () => {
  const zip = new AdmZip();
  zip.addFile('my-app-main/.gitignore', Buffer.from('.env\n'));
  zip.addFile('my-app-main/src/index.js', Buffer.from('console.log(1)'));
  zip.addFile('my-app-main/node_modules/x/index.js', Buffer.from('x'));
  const files = filesFromZip(zip.toBuffer());
  assert.deepEqual(files.map((f) => f.path).sort(), ['.gitignore', 'src/index.js']);
});

test('accepts only plain GitHub repo URLs', () => {
  assert.deepEqual(parseGithubUrl('https://github.com/me/app'), { owner: 'me', repo: 'app' });
  assert.deepEqual(parseGithubUrl('https://github.com/me/app.git'), { owner: 'me', repo: 'app' });
  assert.equal(parseGithubUrl('https://evil.com/me/app'), null);
  assert.equal(parseGithubUrl('https://github.com/me/app/../../x'), null);
});

test('docs and library defaults do not trigger code rules', () => {
  const lib = [
    { path: '.gitignore', text: '.env\n' },
    { path: 'README.md', text: "app.use(cors({ origin: '*', credentials: true }))" },
    { path: 'lib/index.js', text: "var defaults = { origin: '*' }; if (options.credentials === true) {}" },
  ];
  assert.deepEqual(scanFiles(lib).map((f) => f.rule), []);
});
