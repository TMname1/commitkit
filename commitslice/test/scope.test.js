import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveScope } from '../src/scope.js';

test('workspace markers resolve to the second segment (module)', () => {
  assert.equal(deriveScope('apps/api/src/forge/job-store.ts'), 'api');
  assert.equal(deriveScope('apps/client/pages/course-pack/manage.vue'), 'client');
  assert.equal(deriveScope('packages/foo/index.ts'), 'foo');
  assert.equal(deriveScope('libs/bar/baz.ts'), 'bar');
});

test('src wrapper resolves to the real module directory', () => {
  assert.equal(deriveScope('src/course-pack/course-pack.service.ts'), 'course-pack');
  assert.equal(deriveScope('src/forge/pipeline-runner.ts'), 'forge');
});

test('src with no module directory has no scope', () => {
  assert.equal(deriveScope('src/a.js'), '');
  assert.equal(deriveScope('src/index.ts'), '');
});

test('ordinary top-level directory is the scope', () => {
  assert.equal(deriveScope('scripts/build.js'), 'scripts');
  assert.equal(deriveScope('components/Button.vue'), 'components');
});

test('root-level files have no scope', () => {
  assert.equal(deriveScope('README.md'), '');
  assert.equal(deriveScope('package.json'), '');
});

test('workspace marker with only one segment falls back to no scope', () => {
  assert.equal(deriveScope('apps/foo.ts'), '');
});

test('windows-style separators are normalized', () => {
  assert.equal(deriveScope('apps\\api\\src\\forge\\x.ts'), 'api');
});
