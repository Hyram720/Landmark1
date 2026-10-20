// npm run issue            -> build (or show) this week's issue and print a summary
// npm run issue -- --force -> rebuild it from fresh data
import { buildIssue, isoWeek } from './issue.js';

const issue = await buildIssue(isoWeek(), { force: process.argv.includes('--force') });
console.log(`${issue.week} (copy by ${issue.copy.source})\n${issue.copy.headline}\n${issue.copy.intro}\n`);
for (const i of issue.free) console.log(`FREE  ${i.title} [${i.store || i.platformLabel}]${issue.copy.blurbs[i.id] ? ` - ${issue.copy.blurbs[i.id]}` : ''}`);
for (const d of issue.deals) console.log(`DEAL  ${d.title} $${d.price} (-${d.savings}%) [${d.store}]${issue.copy.blurbs[d.id] ? ` - ${issue.copy.blurbs[d.id]}` : ''}`);
