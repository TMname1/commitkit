import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

// Bundle the whole commitslice source tree into one minified ESM file under dist/.
// `@dqbd/tiktoken` is kept external: its default entry reads the WASM from disk via
// fs, which inlining would break. Node built-ins stay external automatically (platform node).
// esbuild preserves src/index.js's leading `#!/usr/bin/env node`, so no banner is added here.
const srcRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
// The bundle lands in this package's own dist/ folder (next to src/), and the published root
// manifest points bin/main/files at "commitslice/dist/commitslice.js".
const outfile = path.join(srcRoot, 'dist', 'commitslice.js');

fs.rmSync(path.join(srcRoot, 'dist'), { recursive: true, force: true });

await build({
  entryPoints: [path.join(srcRoot, 'src', 'index.js')],
  outfile,
  bundle: true,
  minify: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  external: ['@dqbd/tiktoken']
});

const kb = (fs.statSync(outfile).size / 1024).toFixed(1);
console.log(`commitslice: bundled src/ -> dist/commitslice.js (${kb} KB, minified, shebang + @dqbd/tiktoken external)`);
