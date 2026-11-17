import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

// Orchestrates the two build pipelines from the repo root. Done in Node rather than shell
// because each pipeline resolves its inputs relative to its own directory (opencommit's
// esbuild.config.js uses './src/cli.ts', './out'), and the POSIX-only syntax they used to be
// wrapped in does not run under Windows cmd.exe.
const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');

function run(script, cwd) {
  execFileSync(process.execPath, [path.resolve(cwd, script)], { cwd, stdio: 'inherit' });
}

const targets = {
  opencommit() {
    const dir = path.join(root, 'opencommit');
    fs.rmSync(path.join(dir, 'out'), { recursive: true, force: true });
    run('esbuild.config.js', dir);
  },
  commitslice() {
    run(path.join('scripts', 'build.js'), path.join(root, 'commitslice'));
  }
};

const requested = process.argv[2];
if (requested && !targets[requested]) {
  console.error(`Unknown build target '${requested}'. Expected: ${Object.keys(targets).join(', ')}`);
  process.exit(1);
}

for (const name of requested ? [requested] : Object.keys(targets)) {
  console.log(`building ${name}...`);
  targets[name]();
}
