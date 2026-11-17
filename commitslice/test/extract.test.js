import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { extractChanges } from '../src/extract.js';

function git(cwd, ...args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

function lockJson(entries) {
  const packages = {};
  for (let i = 0; i < entries; i++) packages[`node_modules/pkg-${i}`] = { version: `1.0.${i}` };
  return `${JSON.stringify({ lockfileVersion: 3, packages }, null, 2)}\n`;
}

function makeRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'commitslice-extract-'));
  git(dir, 'init', '-q');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'test');
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"demo","dependencies":{"left-pad":"1.0.0"}}\n');
  fs.writeFileSync(path.join(dir, 'package-lock.json'), lockJson(5));
  fs.writeFileSync(path.join(dir, 'src.js'), 'export const a = 1;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'baseline');

  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"demo","dependencies":{"left-pad":"2.0.0"}}\n');
  fs.writeFileSync(path.join(dir, 'package-lock.json'), lockJson(400));
  fs.writeFileSync(path.join(dir, 'src.js'), 'export const a = 2;\nexport const b = 3;\n');
  fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), lockJson(300));
  return dir;
}

function byPath(files, p) {
  return files.find((f) => f.path.replace(/\\/g, '/') === p);
}

test('prescreened files are typed from the path alone, with no content read', () => {
  const repo = makeRepo();
  try {
    const { files } = extractChanges(repo);
    const lock = byPath(files, 'package-lock.json');
    const manifest = byPath(files, 'package.json');
    const source = byPath(files, 'src.js');
    const newLock = byPath(files, 'pnpm-lock.yaml');

    assert.deepEqual(lock.noise, { category: 'lock', ecosystem: 'node' });
    assert.equal(lock.snippet, '', 'lock diff is never loaded');
    assert.deepEqual(lock.symbols, [], 'no -U0 diff call for lock files');
    assert.equal(lock.diffTokens, 0, 'no tokenizer pass over the lock diff');
    assert.ok(lock.add > 0, 'numstat sizing still works without reading the patch');

    assert.equal(manifest.noise, null, 'manifest keeps its content: it explains why deps moved');
    assert.ok(manifest.snippet.length > 0);
    assert.ok(source.snippet.length > 0);

    assert.deepEqual(newLock.noise, { category: 'lock', ecosystem: 'node' });
    assert.equal(newLock.untracked, true);
    assert.equal(newLock.snippet, '', 'untracked lock file is not read from disk either');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('--no-prescreen restores the old behaviour: everything is read and summarized', () => {
  const repo = makeRepo();
  try {
    const { files } = extractChanges(repo, { prescreen: false });
    const lock = byPath(files, 'package-lock.json');
    assert.equal(lock.noise, null);
    assert.ok(lock.snippet.length > 0);
    assert.ok(lock.diffTokens > 0);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
