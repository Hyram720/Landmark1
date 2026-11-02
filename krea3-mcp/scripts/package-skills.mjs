// Packages skills/ for each assistant:
//   dist/claude/<skill>.zip          upload in Claude.ai: Settings > Capabilities > Skills (or copy folders into ~/.claude/skills)
//   dist/instructions/all-skills.md  attach as a knowledge file in a ChatGPT GPT/Project or a Grok Project
//   dist/instructions/<skill>.md     single skill, frontmatter removed, for pasting into instructions
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const skillsDir = path.join(root, 'skills');
const out = path.join(root, 'dist');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'claude'), { recursive: true });
fs.mkdirSync(path.join(out, 'instructions'), { recursive: true });

const problems = [];
const combined = [
  '# Krea 3 Studio skills',
  '',
  'These instructions go with the "krea3-studio" MCP connector (tools such as krea3_edit, pet_portrait, product_mockup, ad_format_pack, compare_providers, animate_image). Follow the section that matches the request.',
  '',
];

for (const name of fs.readdirSync(skillsDir).sort()) {
  const file = path.join(skillsDir, name, 'SKILL.md');
  if (!fs.existsSync(file)) continue;
  const src = fs.readFileSync(file, 'utf8');
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(src);
  if (!m) {
    problems.push(`${name}: missing YAML frontmatter`);
    continue;
  }
  const meta = Object.fromEntries(m[1].split('\n').map((l) => [l.slice(0, l.indexOf(':')).trim(), l.slice(l.indexOf(':') + 1).trim()]));
  if (meta.name !== name) problems.push(`${name}: frontmatter name "${meta.name}" must match the folder name`);
  if (!/^[a-z0-9-]{1,64}$/.test(meta.name || '')) problems.push(`${name}: name must be lowercase letters, digits and hyphens (max 64)`);
  if (!meta.description || meta.description.length > 1024) problems.push(`${name}: description is required and must be at most 1024 characters`);

  const body = m[2].trim();
  fs.writeFileSync(path.join(out, 'instructions', `${name}.md`), `${body}\n`);
  combined.push(`<!-- skill: ${name} -->`, `> When to use: ${meta.description}`, '', body.replace(/^# /m, '## '), '', '---', '');
  execFileSync('zip', ['-qr', path.join(out, 'claude', `${name}.zip`), name], { cwd: skillsDir });
}

fs.writeFileSync(path.join(out, 'instructions', 'all-skills.md'), combined.join('\n'));
if (problems.length) {
  console.error(problems.join('\n'));
  process.exit(1);
}
const size = fs.statSync(path.join(out, 'instructions', 'all-skills.md')).size;
console.log(`Packaged ${fs.readdirSync(path.join(out, 'claude')).length} skills into dist/ (all-skills.md: ${size} bytes).`);
