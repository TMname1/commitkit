import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

// The package manifest is the single source of truth for the version. Its depth differs between
// running from commitslice/src (repo) and from the bundled dist/commitslice.js (installed), so
// walk up to the nearest manifest instead of hardcoding a relative path.
export function readPackageVersion(fromDir = path.dirname(url.fileURLToPath(import.meta.url))) {
  let dir = fromDir;
  for (let i = 0; i < 8; i++) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
      if (typeof pkg.version === 'string') return pkg.version;
    } catch {}
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return 'unknown';
}

export function parseJsonLoose(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {}
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      return JSON.parse(text.slice(start, end + 1));
    } catch {}
  }
  return null;
}

export async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const size = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: size }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await fn(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

export function truncate(value, max) {
  if (value == null) return '';
  const s = String(value);
  return s.length > max ? s.slice(0, max) : s;
}
