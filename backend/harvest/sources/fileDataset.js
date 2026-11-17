// Source adapter for a local dataset file in backend/data/datasets/ (JSON array or CSV with a header row).
// Use only data whose licence allows reuse. Expected columns: code, domain (or url), expiresAt, description.
//   { "type": "file", "name": "my-dataset", "source": "dataset", "enabled": true, "file": "coupons.csv", "fields": { ... } }

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapItem } from './jsonFeed.js';

export const DATASETS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/datasets');

/** Minimal CSV parser: commas, double-quoted fields, "" escapes, CRLF or LF. Returns objects keyed by the header row. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (ch === '"') quoted = false; else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  const [head, ...body] = rows;
  if (!head) return [];
  const keys = head.map((h) => h.trim());
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

export async function readFileDataset(cfg, { dir = DATASETS_DIR, readFile = fs.readFile } = {}) {
  const name = String(cfg.file || '');
  if (!/^[A-Za-z0-9._-]+\.(json|csv)$/.test(name)) throw new Error(`${cfg.name}: file must be a plain .json or .csv name inside backend/data/datasets/`);
  const text = await readFile(path.join(dir, name), 'utf8');
  const items = name.endsWith('.csv') ? parseCsv(text) : JSON.parse(text);
  if (!Array.isArray(items)) throw new Error(`${cfg.name}: the file must hold a list`);
  return items.map((it) => mapItem(it, cfg.fields));
}
