import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

// Two test runners coexist in this package: commitslice uses the built-in node:test, opencommit
// uses jest. The opencommit suites must run with opencommit/ as cwd, because test/e2e/utils.ts
// resolves the CLI under test as `process.cwd()/out/cli.cjs`.
const root = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
const ocoDir = path.join(root, 'opencommit');
const jestBin = path.join(root, 'node_modules', 'jest', 'bin', 'jest.js');

function execNode(args, { cwd = root, env = {}, command = '' } = {}) {
  console.log(`\n> ${command || args.join(' ')}`);
  execFileSync(process.execPath, args, {
    cwd,
    stdio: 'inherit',
    env: { ...process.env, ...env }
  });
}

const tasks = {
  commitslice() {
    const dir = path.join(root, 'commitslice', 'test');
    const files = fs
      .readdirSync(dir)
      .filter((name) => name.endsWith('.test.js'))
      .sort()
      .map((name) => path.join('commitslice', 'test', name));
    execNode(['--test', ...files], { command: `node --test (${files.length} files)` });
  },
  oco() {
    execNode([jestBin, 'test/unit'], {
      cwd: ocoDir,
      env: { NODE_OPTIONS: '--experimental-vm-modules --no-warnings' },
      command: 'jest test/unit'
    });
  },
  'oco-e2e'() {
    // e2e drives the built CLI, so it must be rebuilt from the current source first.
    execNode([path.join(root, 'scripts', 'build.js'), 'opencommit'], {
      command: 'npm run build:opencommit'
    });
    const skipVersionCheck = { OCO_TEST_SKIP_VERSION_CHECK: 'true' };
    const jestEnv = { ...skipVersionCheck, NODE_OPTIONS: '--experimental-vm-modules --no-warnings' };
    execNode([jestBin, 'test/e2e/smoke.test.ts'], {
      cwd: ocoDir,
      env: jestEnv,
      command: 'jest test/e2e/smoke.test.ts'
    });
    execNode(
      [
        jestBin,
        'test/e2e/cliBehavior.test.ts',
        'test/e2e/anthropicBehavior.test.ts',
        'test/e2e/geminiBehavior.test.ts',
        'test/e2e/gitPush.test.ts',
        'test/e2e/oneFile.test.ts',
        'test/e2e/noChanges.test.ts'
      ],
      { cwd: ocoDir, env: jestEnv, command: 'jest test/e2e (core)' }
    );
    execFileSync('sh', [path.join('test', 'e2e', 'setup.sh')], { cwd: ocoDir, stdio: 'inherit' });
    execNode([jestBin, 'test/e2e/prompt-module'], {
      cwd: ocoDir,
      env: jestEnv,
      command: 'jest test/e2e/prompt-module'
    });
  }
};

const requested = process.argv[2];

if (requested && !tasks[requested]) {
  console.error(`Unknown test target '${requested}'. Expected: ${Object.keys(tasks).join(', ')}`);
  process.exit(1);
}

for (const name of requested ? [requested] : ['commitslice', 'oco']) {
  tasks[name]();
}
