import { spawnSync } from 'node:child_process';

function run(repo, args, opts = {}) {
  const r = spawnSync('git', args, { cwd: repo, encoding: 'utf8', ...opts });
  if (r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${(r.stderr || r.stdout || '').trim()}`);
  }
  return (r.stdout || '').trim();
}

// Clear the index (keep the working tree) so each batch commits exactly its own files.
export function resetIndex(repo) {
  run(repo, ['reset', '--quiet']);
}

export function stagePaths(repo, files) {
  const paths = [...new Set(files.filter(Boolean))];
  if (!paths.length) return;
  run(repo, ['add', '-A', '--', ...paths]);
}

export function ocoCommand(ocoPath, context) {
  const c = context ? ` -c "${context.replace(/"/g, '\\"')}"` : '';
  return `node ${ocoPath} -y${c}`;
}

// Only used in apply mode (the default; skipped with --dry-run). Push is neutralized per run
// via env (OCO_GITPUSH=false) so the user's global ~/.opencommit is never mutated.
export function runOco(repo, ocoPath, context) {
  const args = ['-y'];
  if (context) args.push('-c', context);
  const r = spawnSync('node', [ocoPath, ...args], {
    cwd: repo,
    stdio: 'inherit',
    env: { ...process.env, OCO_GITPUSH: 'false' }
  });
  if (r.status !== 0) throw new Error(`oco 执行失败(exit ${r.status})`);
  return run(repo, ['rev-parse', 'HEAD']);
}

export function headSubject(repo) {
  try {
    return run(repo, ['log', '-1', '--pretty=%s']);
  } catch {
    return '';
  }
}

// Prescreened groups are committed here, not through oco: their message is fixed by the file
// metadata, and staging them for oco would make oco re-read exactly the huge diff the prescreen
// skipped. Hooks still run — no --no-verify.
export function commitMessage(repo, subject, body) {
  const args = ['commit', '-q', '-m', subject];
  if (body) args.push('-m', body);
  run(repo, args);
  return run(repo, ['rev-parse', 'HEAD']);
}
