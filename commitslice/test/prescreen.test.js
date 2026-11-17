import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prescreen, noiseGroups } from '../src/prescreen.js';

function mkFile(p, code = 'M', extra = {}) {
  return { path: p, code, status: code === 'A' ? 'Added' : 'Modified', dir: p.split('/').slice(0, -1).join('/') || '.', ...extra };
}

test('dependency locks of every common ecosystem are prescreened with their ecosystem', () => {
  const cases = {
    'package-lock.json': 'node',
    'app/yarn.lock': 'node',
    'pnpm-lock.yaml': 'node',
    'npm-shrinkwrap.json': 'node',
    'bun.lockb': 'bun',
    'deno.lock': 'deno',
    'Cargo.lock': 'rust',
    'go.sum': 'go',
    'poetry.lock': 'python',
    'Pipfile.lock': 'python',
    'uv.lock': 'python',
    'Gemfile.lock': 'ruby',
    'composer.lock': 'php',
    'pubspec.lock': 'dart',
    'Podfile.lock': 'swift',
    'packages.lock.json': 'dotnet',
    'mix.lock': 'elixir',
    'renv.lock': 'r'
  };
  for (const [p, ecosystem] of Object.entries(cases)) {
    assert.deepEqual(prescreen(p), { category: 'lock', ecosystem }, p);
  }
});

test('unlisted lock file names still land in the lock category', () => {
  assert.equal(prescreen('gradle/dependency-locks/execution.lib.def.lockfile').category, 'lock');
  assert.equal(prescreen('services/app/some.lock').category, 'lock');
});

test('manifests and hand-written files are never prescreened', () => {
  const keep = [
    'package.json', 'apps/web/package.json', 'go.mod', 'Cargo.toml', 'pyproject.toml',
    'requirements.txt', 'Gemfile', 'composer.json', 'pubspec.yaml', 'Podfile', 'build.gradle',
    'pom.xml', 'Package.swift', 'setup.py', 'deno.json', 'mix.exs', 'MyApp.csproj',
    'src/index.js', 'src/auth.ts', 'README.md', '.github/workflows/ci.yml', 'Dockerfile',
    'src/main.py', 'internal/handler/handler.go'
  ];
  for (const p of keep) {
    assert.equal(prescreen(p), null, `${p} must stay in the model pipeline`);
  }
});

test('build artifacts, generated code and snapshots are prescreened', () => {
  const noise = {
    'dist/app.js': 'artifact',
    'build/index.cjs': 'artifact',
    'node_modules/left-pad/index.js': 'artifact',
    'static/vendor/moment.js': 'artifact',
    'assets/app.min.js': 'artifact',
    'assets/app.css.map': 'artifact',
    '.next/build-manifest.json': 'artifact',
    'coverage/lcov.info': 'artifact',
    'src/__pycache__/module.pyc': 'artifact',
    'libs/commons.jar': 'artifact',
    'api.pb.go': 'generated',
    'clients/user_pb2.py': 'generated',
    'types/__generated__/schema.ts': 'generated',
    'lib/model.freezed.dart': 'generated',
    'Forms/Login.designer.cs': 'generated',
    'app/wire_gen.go': 'generated',
    '__snapshots__/profile.js.snap': 'snapshot',
    'test/renderer.snap': 'snapshot'
  };
  for (const [p, category] of Object.entries(noise)) {
    assert.equal(prescreen(p)?.category, category, p);
  }
});

test('noise files group per ecosystem and category, one commit each', () => {
  const files = [
    mkFile('package-lock.json'),
    mkFile('yarn.lock'),
    mkFile('Cargo.lock'),
    mkFile('__snapshots__/a.js.snap')
  ];
  for (const f of files) f.noise = prescreen(f.path);

  const groups = noiseGroups(files, { lang: 'en' });
  assert.equal(groups.length, 3, 'node locks, rust lock, snapshots stay separate');
  const types = groups.map((g) => g.type);
  assert.deepEqual(types.sort(), ['chore', 'chore', 'test']);
  assert.equal(groups.find((g) => g.category === 'lock' && g.files.length === 2).subject, 'chore(deps): update Node lock files');
  assert.equal(groups.find((g) => g.category === 'snapshot').subject, 'test: update test snapshots');
  for (const g of groups) {
    assert.equal(g.fixed, true);
    assert.match(g.body, /^- /m, 'body lists the files');
  }
});

test('fixed messages follow the configured language and fall back to English', () => {
  const f = mkFile('pnpm-lock.yaml');
  f.noise = prescreen(f.path);
  const zh = noiseGroups([f], { lang: 'zh' })[0];
  const en = noiseGroups([f], { lang: 'en' })[0];
  assert.equal(zh.subject, 'chore(deps): 更新 Node 依赖锁文件');
  assert.match(zh.body, /均为工具生成的依赖锁文件/);
  assert.equal(en.subject, 'chore(deps): update Node lock files');
});

test('a group of deletions reads as a removal, not an update', () => {
  const f = mkFile('go.sum', 'D');
  f.noise = prescreen(f.path);
  assert.equal(noiseGroups([f], { lang: 'en' })[0].subject, 'chore(deps): remove Go lock files');
  assert.equal(noiseGroups([f], { lang: 'zh' })[0].subject, 'chore(deps): 删除 Go 依赖锁文件');
});
