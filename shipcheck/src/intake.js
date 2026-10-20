// Turns what the customer submitted (a .zip or their public GitHub repo) into { path, text } files.
// Archives are read in memory and never extracted to disk, so hostile paths can't escape.
import AdmZip from 'adm-zip';
import config from './config.js';
import { shouldScan } from './scanner.js';

const GITHUB_URL = /^https:\/\/github\.com\/([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/;

export function parseGithubUrl(url) {
  const m = String(url || '').trim().match(GITHUB_URL);
  return m ? { owner: m[1], repo: m[2] } : null;
}

// Downloads a public repo's default branch as a zip, stopping at the size limit.
export async function fetchGithubZip({ owner, repo }) {
  const res = await fetch(`https://codeload.github.com/${owner}/${repo}/zip/HEAD`);
  if (res.status === 404) throw new Error('Repo not found. It must be public, or upload a .zip instead.');
  if (!res.ok) throw new Error(`GitHub download failed (${res.status})`);
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > config.limits.archiveBytes) throw new Error('Repo is too large. Upload a .zip without node_modules or build folders.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function filesFromZip(buffer) {
  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new Error('That file is not a valid .zip archive.');
  }
  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  if (!entries.length) throw new Error('The archive is empty.');

  // GitHub zips (and most "compress folder" zips) wrap everything in one top folder; strip it.
  const names = entries.map((e) => e.entryName.replace(/\\/g, '/'));
  const top = names[0].split('/')[0];
  const wrapped = names.every((n) => n.startsWith(`${top}/`));

  const files = [];
  for (const [i, entry] of entries.entries()) {
    const path = wrapped ? names[i].slice(top.length + 1) : names[i];
    if (!shouldScan(path) || entry.header.size > config.limits.fileBytes) continue;
    if (files.length >= config.limits.files) break;
    const text = entry.getData().toString('utf8');
    if (text.includes('\u0000')) continue; // binary
    files.push({ path, text });
  }
  return files;
}
