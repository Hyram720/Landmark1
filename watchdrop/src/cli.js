// npm run issue            -> build (or show) this week's issue and print a summary
// npm run issue -- --force -> rebuild it from fresh data
import { buildIssue, isoWeek } from './issue.js';

const issue = await buildIssue(isoWeek(), { force: process.argv.includes('--force') });
console.log(`${issue.week} (copy by ${issue.copy.source})\n${issue.copy.headline}\n${issue.copy.intro}\n`);
for (const key of ['new', 'leaving', 'free']) {
  for (const i of issue[key]) console.log(`${key.toUpperCase().padEnd(8)}${i.title} (${i.year}, ${i.rating}/100) [${i.services.map((s) => s.name).join(', ')}]${issue.copy.blurbs[i.id] ? ` - ${issue.copy.blurbs[i.id]}` : ''}`);
}
