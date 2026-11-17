import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const here = path.dirname(url.fileURLToPath(import.meta.url));

function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

// Resolve the opencommit (oco) CLI entry shipped inside this same package.
// From the bundle (`<pkg>/dist/`) the package root is one level up; from `src/` in this repo it is
// two levels up, and both cases fall out of walking up until `<dir>/opencommit/out/cli.cjs` exists.
// The walk is anchored at this module's own location, never at the target repository's cwd.
export function resolveOcoCli() {
  let dir = here;
  for (let i = 0; i < 8; i++) {
    const cand = path.join(dir, 'opencommit', 'out', 'cli.cjs');
    if (isFile(cand)) return cand;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
