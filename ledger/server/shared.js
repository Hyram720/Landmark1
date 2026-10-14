// Loads the browser modules (law, partners, business, store) so the server applies the same rules.
import fs from 'node:fs';
import vm from 'node:vm';

const ctx = { console, Date, Math, JSON, Number, String, Object, Array, Set, Error, URLSearchParams };
ctx.globalThis = ctx;
vm.createContext(ctx);
for (const f of ['law.js', 'partners.js', 'business.js', 'metro2.js', 'store.js', 'aiprompts.js', 'sales.js', 'invoices.js']) {
  vm.runInContext(fs.readFileSync(new URL(`../js/${f}`, import.meta.url), 'utf8'), ctx, { filename: f });
}
export const { Law, Partners, Business, Metro2, Store, AIPrompts, Sales, Invoices } = ctx;
