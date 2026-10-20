// Tiny JSON-file scan store. One file per scan under DATA_DIR/scans.
// Source code is never stored: only findings, with any secret values already masked.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import config from './config.js';

const scansDir = path.join(config.dataDir, 'scans');
fs.mkdirSync(scansDir, { recursive: true });

// Scan ids double as the customer's private report link, so they must be unguessable.
export function newScanId() {
  return crypto.randomBytes(16).toString('hex');
}

const fileFor = (id) => {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error('invalid scan id');
  return path.join(scansDir, `${id}.json`);
};

export function getScan(id) {
  try {
    return JSON.parse(fs.readFileSync(fileFor(id), 'utf8'));
  } catch {
    return null;
  }
}

export function saveScan(scan) {
  scan.updatedAt = new Date().toISOString();
  const file = fileFor(scan.id);
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(scan, null, 2));
  fs.renameSync(`${file}.tmp`, file);
  return scan;
}

export function updateScan(id, patch) {
  const scan = getScan(id);
  if (!scan) throw new Error(`scan ${id} not found`);
  return saveScan({ ...scan, ...patch });
}

export function listScans() {
  return fs
    .readdirSync(scansDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => getScan(f.slice(0, -5)))
    .filter(Boolean)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
