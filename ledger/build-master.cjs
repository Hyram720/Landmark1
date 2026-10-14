// Builds ledger/dist/ledger-master.html: the whole staff app in one file, no login, no server.
// Data is saved in the browser that opens it. Run: npm run ledger:master
const fs = require('fs');
const path = require('path');
const dir = __dirname;
const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
const out = html
  .replace('<link rel="stylesheet" href="css/app.css">', () => `<style>\n${fs.readFileSync(path.join(dir, 'css/app.css'), 'utf8')}\n</style>`)
  .replace(/<script src="(js\/[\w-]+\.js)"><\/script>/g, (m, src) => `<script>\n${fs.readFileSync(path.join(dir, src), 'utf8').replace(/<\/script/gi, '<\\/script')}\n</script>`)
  .replace('<title>Ledger Credit Workspace</title>', '<title>Ledger Master File</title>')
  .replace('<div class="side-foot">', '<div class="side-foot"><b style="color:#e2e8f0">Master file</b> — no login. Export backups from Settings.<br><br>');
if (/src="js\/|href="css\//.test(out)) throw new Error('Unbundled asset left in master file');
fs.mkdirSync(path.join(dir, 'dist'), { recursive: true });
fs.writeFileSync(path.join(dir, 'dist', 'ledger-master.html'), out);
console.log('Wrote ledger/dist/ledger-master.html', Math.round(out.length / 1024) + ' KB');
