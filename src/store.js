// Tiny JSON-file order store. One file per order under DATA_DIR/orders.
// Good enough for hundreds of orders a day; swap for Postgres when volume demands it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import config from './config.js';

const ordersDir = path.join(config.dataDir, 'orders');
export const uploadsDir = path.join(config.dataDir, 'uploads');
export const outputDir = path.join(config.dataDir, 'output');
for (const dir of [ordersDir, uploadsDir, outputDir]) fs.mkdirSync(dir, { recursive: true });

// Order ids double as the customer's private access token, so they must be unguessable.
export function newOrderId() {
  return crypto.randomBytes(16).toString('hex');
}

const fileFor = (id) => {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('invalid order id');
  return path.join(ordersDir, `${id}.json`);
};

export function getOrder(id) {
  try {
    return JSON.parse(fs.readFileSync(fileFor(id), 'utf8'));
  } catch {
    return null;
  }
}

export function saveOrder(order) {
  order.updatedAt = new Date().toISOString();
  const file = fileFor(order.id);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(order, null, 2));
  fs.renameSync(`${file}.tmp`, file);
  return order;
}

export function updateOrder(id, patch) {
  const order = getOrder(id);
  if (!order) throw new Error(`order ${id} not found`);
  return saveOrder({ ...order, ...patch });
}

export function listOrders() {
  return fs
    .readdirSync(ordersDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => getOrder(f.slice(0, -5)))
    .filter(Boolean)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
