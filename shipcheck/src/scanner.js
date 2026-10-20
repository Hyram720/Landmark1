// Static checks for the mistakes AI-built apps ship with most often.
// Input is a list of { path, text } files the customer submitted; nothing is executed or fetched.

const SKIP_DIRS = /(^|\/)(node_modules|\.git|\.next|dist|build|out|coverage|vendor|\.venv|__pycache__)\//;
const TEXT_EXT = /\.(js|jsx|ts|tsx|mjs|cjs|vue|svelte|astro|py|rb|go|php|java|json|ya?ml|toml|sql|rules|html|env|txt|md|sh|tf)$/i;
const CLIENT_PATH = /(^|\/)(src\/(app|pages|components|routes|lib|hooks)|app|pages|components|public|client|frontend)\//;
const isEnvFile = (p) => /(^|\/)\.env(\.[\w-]+)?$/.test(p) && !/\.(example|sample|template)$/.test(p);

export const shouldScan = (path) => !SKIP_DIRS.test(path) && (TEXT_EXT.test(path) || isEnvFile(path) || path === '.gitignore');

// Show just enough of a secret to recognise it. Full values never leave this function.
export const mask = (value) => `${value.slice(0, 6)}…${'•'.repeat(6)} (${value.length} chars)`;

const SECRET_PATTERNS = [
  { name: 'OpenAI API key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/g, provider: 'OpenAI' },
  { name: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{32,}\b/g, provider: 'Anthropic' },
  { name: 'Stripe live secret key', re: /\b(?:sk|rk)_live_[A-Za-z0-9]{20,}\b/g, provider: 'Stripe' },
  { name: 'AWS access key ID', re: /\bAKIA[0-9A-Z]{16}\b/g, provider: 'AWS' },
  { name: 'GitHub token', re: /\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{30,}\b/g, provider: 'GitHub' },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g, provider: 'Google Cloud' },
  { name: 'Resend API key', re: /\bre_[A-Za-z0-9]{8,}_[A-Za-z0-9]{16,}\b/g, provider: 'Resend' },
  { name: 'Slack token', re: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/g, provider: 'Slack' },
  { name: 'Private key', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, provider: 'your key pair' },
];

// Supabase keys are JWTs; only the service_role one is dangerous in the open.
const JWT = /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g;
function jwtRole(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')).role;
  } catch {
    return null;
  }
}

const lineOf = (text, index) => text.slice(0, index).split('\n').length;

export function scanFiles(files) {
  const findings = [];
  const add = (f) => findings.push(f);
  const paths = new Set(files.map((f) => f.path));
  const gitignore = files.find((f) => f.path === '.gitignore')?.text ?? null;

  for (const { path, text } of files) {
    const clientSide = CLIENT_PATH.test(path) || /^\s*['"]use client['"]/.test(text);
    const isDoc = /\.(md|txt)$/i.test(path); // docs still get the secret checks, not the code checks

    for (const p of SECRET_PATTERNS) {
      for (const m of text.matchAll(p.re)) {
        if (/x{6,}|your[_-]?key|example|placeholder|\.\.\./i.test(m[0])) continue;
        add({
          rule: 'hardcoded-secret',
          severity: 'critical',
          title: `${p.name} committed in code`,
          file: path,
          line: lineOf(text, m.index),
          evidence: mask(m[0]),
          why: `Anyone who sees this repo (or your shipped bundle) can use your ${p.provider} account and run up your bill.`,
          fix: `Rotate this key in ${p.provider} now. Then move it to an environment variable that is only read on the server.`,
        });
      }
    }

    for (const m of text.matchAll(JWT)) {
      if (jwtRole(m[0]) !== 'service_role') continue;
      add({
        rule: 'supabase-service-role',
        severity: 'critical',
        title: 'Supabase service_role key in code',
        file: path,
        line: lineOf(text, m.index),
        evidence: mask(m[0]),
        why: 'The service_role key bypasses every Row Level Security policy. Whoever has it can read and delete your whole database.',
        fix: 'Reset the key in Supabase (Settings > API), keep it only in server-side env vars, and use the anon key in the browser.',
      });
    }

    // Env var names that sound secret but are exposed to the browser by the framework's prefix.
    for (const m of text.matchAll(/\b(NEXT_PUBLIC_|VITE_|REACT_APP_|EXPO_PUBLIC_|PUBLIC_)([A-Z0-9_]*(SECRET|SERVICE_ROLE|PRIVATE|OPENAI|ANTHROPIC|STRIPE_SK)[A-Z0-9_]*)/g)) {
      add({
        rule: 'public-env-secret',
        severity: 'high',
        title: `Secret exposed to the browser via ${m[1]}${m[2]}`,
        file: path,
        line: lineOf(text, m.index),
        evidence: `${m[1]}${m[2]}`,
        why: `Variables starting with ${m[1]} are bundled into the JavaScript every visitor downloads.`,
        fix: `Rename it without the ${m[1]} prefix and call the API from a server route or edge function instead of the browser.`,
      });
    }

    if (clientSide && /new\s+(OpenAI|Anthropic)\s*\(/.test(text) && /dangerouslyAllowBrowser\s*:\s*true/.test(text)) {
      add({
        rule: 'llm-in-browser',
        severity: 'high',
        title: 'AI API called directly from the browser',
        file: path,
        line: lineOf(text, text.search(/dangerouslyAllowBrowser/)),
        evidence: 'dangerouslyAllowBrowser: true',
        why: 'Your API key ships to every visitor, who can copy it and use it for anything.',
        fix: 'Move the AI call into a server route and have the browser call that route.',
      });
    }

    if (path.endsWith('.sql')) {
      for (const m of text.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?public"?\.)?"?(\w+)"?/gi)) {
        const table = m[1];
        const rls = new RegExp(`alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:"?public"?\\.)?"?${table}"?\\s+enable\\s+row\\s+level\\s+security`, 'i');
        const enabledAnywhere = files.some((f) => f.path.endsWith('.sql') && rls.test(f.text));
        if (!enabledAnywhere) {
          add({
            rule: 'supabase-no-rls',
            severity: 'critical',
            title: `Table "${table}" has no Row Level Security`,
            file: path,
            line: lineOf(text, m.index),
            evidence: m[0].trim(),
            why: 'In Supabase, a table without RLS can be read and written by anyone who has your public anon key, and that key is in your frontend.',
            fix: `Run: alter table public.${table} enable row level security; then add policies so users only touch their own rows.`,
          });
        }
      }
      for (const m of text.matchAll(/create\s+policy[\s\S]{0,300}?using\s*\(\s*true\s*\)/gi)) {
        add({
          rule: 'supabase-open-policy',
          severity: 'high',
          title: 'RLS policy allows everyone (using (true))',
          file: path,
          line: lineOf(text, m.index),
          evidence: 'using (true)',
          why: 'A policy of "true" turns RLS back off for that action.',
          fix: 'Scope the policy to the signed-in user, e.g. using (auth.uid() = user_id).',
        });
      }
    }

    if (/firestore\.rules$|storage\.rules$|database\.rules\.json$/.test(path) && /allow\s+(read|write|read,\s*write)\s*(:\s*if\s+true|;)|"\.(read|write)"\s*:\s*true/.test(text)) {
      add({
        rule: 'firebase-open-rules',
        severity: 'critical',
        title: 'Firebase rules allow anyone to read or write',
        file: path,
        line: lineOf(text, text.search(/allow|"\.(read|write)"/)),
        evidence: 'allow … if true',
        why: 'Open rules mean any visitor can dump or wipe your database.',
        fix: 'Require auth and ownership, e.g. allow read, write: if request.auth != null && request.auth.uid == userId;',
      });
    }

    if (!isDoc && /stripe/i.test(text) && /webhook/i.test(text) && /checkout\.session\.completed|payment_intent\.succeeded/.test(text) && !/constructEvent|verifyWebhook|stripe-signature|webhooks\.verify/i.test(text)) {
      add({
        rule: 'stripe-webhook-unverified',
        severity: 'high',
        title: 'Stripe webhook does not verify its signature',
        file: path,
        line: lineOf(text, text.search(/checkout\.session\.completed|payment_intent\.succeeded/)),
        evidence: 'no stripe.webhooks.constructEvent call',
        why: 'Anyone can POST a fake "payment succeeded" event and get your product for free.',
        fix: 'Verify every event with stripe.webhooks.constructEvent(rawBody, signatureHeader, STRIPE_WEBHOOK_SECRET).',
      });
    }

    if (!isDoc && /origin\s*:\s*['"]\*['"]|Access-Control-Allow-Origin['"]?\s*[,:]\s*['"]\*/.test(text) && /credentials\s*:\s*true|Allow-Credentials['"]?\s*[,:]\s*['"]?true/.test(text)) {
      add({
        rule: 'cors-wildcard-credentials',
        severity: 'medium',
        title: 'CORS allows any website with credentials',
        file: path,
        line: lineOf(text, text.search(/origin\s*:|Access-Control-Allow-Origin/)),
        evidence: "origin: '*' + credentials",
        why: 'Other sites may be able to make logged-in requests on behalf of your users.',
        fix: 'List your own domains explicitly instead of "*".',
      });
    }

    if (/\.(jsx|tsx|vue|svelte)$/.test(path) && /dangerouslySetInnerHTML|v-html=|\{@html/.test(text)) {
      add({
        rule: 'raw-html',
        severity: 'low',
        title: 'Raw HTML rendered into the page',
        file: path,
        line: lineOf(text, text.search(/dangerouslySetInnerHTML|v-html=|\{@html/)),
        evidence: 'dangerouslySetInnerHTML / v-html',
        why: 'If any of that HTML comes from users or an AI model, it can run scripts in your visitors\' browsers (XSS).',
        fix: 'Render plain text, or sanitize with DOMPurify before inserting HTML.',
      });
    }
  }

  // Repo-level checks.
  for (const { path } of files.filter((f) => isEnvFile(f.path))) {
    add({
      rule: 'env-committed',
      severity: 'critical',
      title: `${path} is committed to the repo`,
      file: path,
      line: 1,
      evidence: path,
      why: '.env files hold your real keys. Once pushed, they live in git history forever.',
      fix: 'Rotate every key in it, delete the file from the repo, add .env* to .gitignore, and use your host\'s env var settings.',
    });
  }
  if (!gitignore || !/^\s*\.env/m.test(gitignore)) {
    add({
      rule: 'gitignore-env',
      severity: 'low',
      title: '.gitignore does not exclude .env files',
      file: '.gitignore',
      line: 1,
      evidence: gitignore === null ? 'no .gitignore' : '.env not listed',
      why: 'One "git add ." away from publishing your secrets.',
      fix: 'Add these lines to .gitignore: .env and .env*.local',
    });
  }
  if (paths.has('package.json') && !['package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock'].some((l) => paths.has(l))) {
    add({
      rule: 'no-lockfile',
      severity: 'low',
      title: 'No dependency lockfile',
      file: 'package.json',
      line: 1,
      evidence: 'package.json without a lockfile',
      why: 'Every deploy may install different, untested package versions.',
      fix: 'Run npm install and commit package-lock.json.',
    });
  }

  const order = { critical: 0, high: 1, medium: 2, low: 3 };
  findings.sort((a, b) => order[a.severity] - order[b.severity] || a.file.localeCompare(b.file));
  return findings;
}

export function summarize(findings) {
  const s = { total: findings.length, critical: 0, high: 0, medium: 0, low: 0 };
  for (const f of findings) s[f.severity]++;
  // 100 = clean. Criticals dominate so one leaked key can't hide behind a pile of passes.
  s.score = Math.max(0, 100 - s.critical * 25 - s.high * 10 - s.medium * 4 - s.low * 1);
  return s;
}

// A prompt the customer pastes into their AI coding tool to apply the fix.
export function fixPrompt(f) {
  return `Security fix needed in ${f.file} (around line ${f.line}).\n\nProblem: ${f.title}. ${f.why}\n\nPlease: ${f.fix}\n\nKeep behaviour the same otherwise, don't print any secret values, and tell me if anything needs to be done outside the code (like rotating a key in a dashboard).`;
}
