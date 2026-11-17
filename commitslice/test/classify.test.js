import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { classify } from '../src/classify.js';

function mkFile(p, tokens, extra = {}) {
  return {
    path: p,
    status: 'Modified',
    code: 'M',
    ext: path.extname(p).toLowerCase(),
    type: 'JavaScript',
    dir: path.posix.dirname(p),
    add: 10,
    del: 5,
    diffChars: tokens * 4,
    diffTokens: tokens,
    summary: `改动了 ${p}`,
    ...extra
  };
}

// All files land in one 'feat' group regardless of size. `initialClassify` mirrors askModel,
// which returns the array of groups directly.
const oneFeatGroup = (files) => async () => [{ type: 'feat', files: files.map((f) => f.path) }];

// Split any group into two halves; refuse when nothing left to split.
function halvingResplit(groupFiles) {
  if (groupFiles.length <= 1) return null;
  const mid = Math.ceil(groupFiles.length / 2);
  return [
    groupFiles.slice(0, mid).map((f) => f.path),
    groupFiles.slice(mid).map((f) => f.path)
  ];
}

function coverage(planned) {
  const seen = [];
  for (const c of planned) seen.push(...c.files);
  return seen;
}

test('oversized category is resplit until every batch is under budget, type preserved, no loss', async () => {
  const files = [mkFile('src/a.js', 700), mkFile('src/b.js', 700), mkFile('src/c.js', 700), mkFile('src/d.js', 700)];
  const result = await classify(files, {
    useModel: true,
    maxTokensPerCommit: 1000,
    maxResplitRounds: 2,
    initialClassify: oneFeatGroup(files),
    resplit: halvingResplit
  });

  assert.equal(new Set(coverage(result.planned)).size, 4, 'all files covered exactly once');
  assert.equal(result.planned.length, 4, 'each single file becomes its own batch');
  for (const c of result.planned) {
    assert.equal(c.type, 'feat', 'subdivision keeps the original type');
    assert.ok(c.estTokens <= 1000, `batch ${c.files} under budget (${c.estTokens})`);
    assert.equal(c.oversize, false);
  }
});

test('no-progress resplit (model returns one group) converges to a single oversize batch', async () => {
  const files = [mkFile('src/a.js', 700), mkFile('src/b.js', 700), mkFile('src/c.js', 700)];
  const singleResplit = (groupFiles) => [groupFiles.map((f) => f.path)];
  const result = await classify(files, {
    useModel: true,
    maxTokensPerCommit: 1000,
    maxResplitRounds: 2,
    initialClassify: oneFeatGroup(files),
    resplit: singleResplit
  });

  assert.equal(result.planned.length, 1);
  assert.equal(result.planned[0].oversize, true);
  assert.deepEqual([...result.planned[0].files].sort(), files.map((f) => f.path).sort());
});

test('single file over budget is committed whole and flagged oversize', async () => {
  const files = [mkFile('src/huge.js', 5000)];
  const result = await classify(files, {
    useModel: true,
    maxTokensPerCommit: 1000,
    maxResplitRounds: 2,
    initialClassify: oneFeatGroup(files),
    resplit: halvingResplit
  });

  assert.equal(result.planned.length, 1);
  assert.equal(result.planned[0].estTokens, 5000);
  assert.equal(result.planned[0].oversize, true);
});

test('invalid partition (dropped path) falls back to whole group, never loses files', async () => {
  const files = [mkFile('src/a.js', 700), mkFile('src/b.js', 700), mkFile('src/c.js', 700)];
  // Pretends the model invented/dropped paths: only returns 2 of the 3 files.
  const lossyResplit = (groupFiles) => (groupFiles.length >= 3 ? [groupFiles.slice(0, 2).map((f) => f.path)] : null);
  const result = await classify(files, {
    useModel: true,
    maxTokensPerCommit: 1000,
    maxResplitRounds: 2,
    initialClassify: oneFeatGroup(files),
    resplit: lossyResplit
  });

  assert.equal(result.planned.length, 1, 'invalid partition is rejected');
  assert.equal(result.planned[0].oversize, true);
  assert.equal(new Set(coverage(result.planned)).size, 3, 'all input files retained');
});

test('rounds exhausted leaves an oversize multi-file batch instead of byte-packing', async () => {
  const files = [mkFile('src/a.js', 700), mkFile('src/b.js', 700), mkFile('src/c.js', 700)];
  const result = await classify(files, {
    useModel: true,
    maxTokensPerCommit: 1000,
    maxResplitRounds: 1,
    initialClassify: oneFeatGroup(files),
    resplit: halvingResplit
  });

  const oversizeBatches = result.planned.filter((c) => c.oversize);
  assert.equal(oversizeBatches.length, 1);
  assert.ok(oversizeBatches[0].files.length >= 2, 'the terminal oversize batch is multi-file');
  assert.equal(new Set(coverage(result.planned)).size, 3);
});

test('no model: oversized category commits whole (oco backstop), no resplit attempted', async () => {
  const files = [mkFile('src/a.js', 700), mkFile('src/b.js', 700)];
  let resplitCalled = false;
  const result = await classify(files, {
    useModel: false,
    maxTokensPerCommit: 1000,
    maxResplitRounds: 2,
    resplit: () => {
      resplitCalled = true;
      return null;
    }
  });

  assert.equal(resplitCalled, false, 'rule-only mode never calls the model to resplit');
  assert.equal(result.planned.length, 1);
  assert.equal(result.planned[0].oversize, true);
  assert.equal(result.planned[0].type, 'fix', 'both modified .js files fall back to fix');
});

test('same type is split into one commit per scope, even under the token budget', async () => {
  const files = [
    mkFile('apps/api/src/forge/job-store.ts', 100),
    mkFile('apps/api/src/course-pack/course-pack.service.ts', 100),
    mkFile('apps/client/pages/course-pack/manage.vue', 100),
    mkFile('apps/client/composables/forge/useForgeJob.ts', 100)
  ];
  const result = await classify(files, {
    useModel: true,
    maxTokensPerCommit: 1000,
    maxResplitRounds: 2,
    initialClassify: oneFeatGroup(files),
    resplit: () => null
  });

  assert.equal(result.planned.length, 2, 'two scopes under one type → two commits');
  const byScope = Object.fromEntries(result.planned.map((c) => [c.scope, c]));
  assert.equal(byScope.api.type, 'feat');
  assert.deepEqual(
    [...byScope.api.files].sort(),
    ['apps/api/src/course-pack/course-pack.service.ts', 'apps/api/src/forge/job-store.ts']
  );
  assert.equal(byScope.client.type, 'feat');
  assert.deepEqual(
    [...byScope.client.files].sort(),
    ['apps/client/composables/forge/useForgeJob.ts', 'apps/client/pages/course-pack/manage.vue']
  );
});
