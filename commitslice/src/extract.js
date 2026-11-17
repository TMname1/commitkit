import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { countTokens } from './token.js';
import { prescreen as prescreenPath } from './prescreen.js';

const EXT_TYPES = {
  '.ts': 'TypeScript', '.mts': 'TypeScript', '.cts': 'TypeScript', '.tsx': 'TypeScript (React)',
  '.js': 'JavaScript', '.mjs': 'JavaScript', '.cjs': 'JavaScript', '.jsx': 'JavaScript (React)',
  '.py': 'Python', '.go': 'Go', '.rs': 'Rust', '.java': 'Java', '.kt': 'Kotlin', '.kts': 'Kotlin',
  '.rb': 'Ruby', '.php': 'PHP', '.c': 'C', '.h': 'C header', '.cpp': 'C++', '.hpp': 'C++', '.cc': 'C++',
  '.cs': 'C#', '.swift': 'Swift', '.scala': 'Scala', '.sh': 'Shell', '.bash': 'Shell', '.zsh': 'Shell',
  '.ps1': 'PowerShell', '.vue': 'Vue', '.svelte': 'Svelte', '.html': 'HTML', '.css': 'CSS', '.scss': 'SCSS',
  '.less': 'LESS', '.sql': 'SQL', '.json': 'JSON', '.jsonc': 'JSON', '.yaml': 'YAML', '.yml': 'YAML',
  '.toml': 'TOML', '.ini': 'INI', '.md': 'Markdown', '.mdx': 'Markdown', '.rst': 'reStructuredText',
  '.txt': 'Text', '.xml': 'XML', '.proto': 'Protobuf', '.tf': 'Terraform'
};

function git(cwd, args, { tolerant = false } = {}) {
  try {
    return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch (err) {
    if (tolerant) return null;
    const detail = String(err.stderr || err.message || err).trim();
    throw new Error(`git ${args.join(' ')} failed: ${detail}`);
  }
}

function fileKind(p) {
  const ext = path.extname(p).toLowerCase();
  const base = path.basename(p).toLowerCase();
  if (EXT_TYPES[ext]) return EXT_TYPES[ext];
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) return 'Dockerfile';
  if (base === 'makefile') return 'Makefile';
  return ext ? ext.slice(1) : 'unknown';
}

function statusWord(code) {
  switch ((code || '?')[0]) {
    case 'A': return 'Added';
    case 'M': return 'Modified';
    case 'D': return 'Deleted';
    case 'R': return 'Renamed';
    case 'C': return 'Copied';
    case 'T': return 'TypeChanged';
    default: return code || 'Unknown';
  }
}

function parseNumstat(out) {
  const map = new Map();
  for (const line of (out || '').split('\n')) {
    if (!line.trim()) continue;
    const [a, d, ...rest] = line.split('\t');
    const binary = a === '-' && d === '-';
    map.set(rest.join('\t'), { add: binary ? 0 : parseInt(a, 10) || 0, del: binary ? 0 : parseInt(d, 10) || 0, binary });
  }
  return map;
}

function parseNameStatus(out) {
  const map = new Map();
  for (const line of (out || '').split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const code = parts[0];
    if (/^[RC]/.test(code)) map.set(parts[2], { code, from: parts[1] });
    else map.set(parts[1], { code, from: null });
  }
  return map;
}

function parsePorcelain(out) {
  const entries = [];
  const items = (out || '').split('\0').filter((x) => x.length > 0);
  for (let i = 0; i < items.length; i++) {
    const rec = items[i];
    const xy = rec.slice(0, 2);
    const file = rec.slice(3);
    if (/[RC]/.test(xy)) {
      i++;
      entries.push({ xy, to: file, from: items[i] });
    } else {
      entries.push({ xy, to: file, from: null });
    }
  }
  return entries;
}

// v1 simplified symbol extraction: read the trailing context of "@@ ... @@ <context>"
// hunk headers. No AST parsing, matching the agreed "先做 v1 简化版".
function symbolsFromHunkHeaders(diffText) {
  const syms = [];
  const seen = new Set();
  for (const line of (diffText || '').split('\n')) {
    if (!line.startsWith('@@')) continue;
    const second = line.indexOf('@@', 2);
    if (second === -1) continue;
    const ctx = line.slice(second + 2).trim();
    if (!ctx) continue;
    const sym = ctx.replace(/\(.*\)\s*$/, '').trim() || ctx;
    if (!seen.has(sym)) {
      seen.add(sym);
      syms.push(sym);
    }
  }
  return syms;
}

export function extractChanges(repo = process.cwd(), { prescreen = true } = {}) {
  git(repo, ['rev-parse', '--show-toplevel']);
  if (git(repo, ['rev-parse', '--verify', 'HEAD'], { tolerant: true }) == null) {
    throw new Error('仓库还没有任何提交(无 HEAD)。先创建一次基线提交后再使用 commitslice。');
  }

  const numstat = parseNumstat(git(repo, ['diff', 'HEAD', '--numstat', '-M', '-C']));
  const nameStatus = parseNameStatus(git(repo, ['diff', 'HEAD', '--name-status', '-M', '-C']));
  const porcelain = parsePorcelain(git(repo, ['status', '--porcelain=v1', '-z', '--untracked-files=all']));

  const byPath = new Map();
  for (const [p, ns] of nameStatus) byPath.set(p, { path: p, from: ns.from, code: ns.code });

  const untracked = new Set();
  for (const e of porcelain) {
    if (e.xy === '??') {
      untracked.add(e.to);
      if (!byPath.has(e.to)) byPath.set(e.to, { path: e.to, from: null, code: 'A' });
    }
  }

  const files = [];
  for (const { path: p, from, code } of byPath.values()) {
    const ns = numstat.get(p) || {};
    let add = ns.add || 0;
    let del = ns.del || 0;
    let binary = ns.binary || false;
    let symbols = [];
    let snippet = '';
    let diffChars = 0;
    let diffTokens = 0;

    const noise = prescreen ? prescreenPath(p) : null;

    if (noise) {
      // Never read these: their diff is machine-written and can be megabytes, so both the
      // git/show call and the snippet are skipped. Size still comes from numstat above.
    } else if (untracked.has(p)) {
      try {
        const content = fs.readFileSync(path.join(repo, p), 'utf8');
        if (content.includes('\0')) {
          binary = true;
        } else {
          add = content.split(/\r?\n/).length;
          snippet = content.split('\n').slice(0, 40).join('\n');
          diffTokens = countTokens(content);
        }
        diffChars = content.length;
      } catch {
        // unreadable: leave defaults
      }
    } else if (code[0] === 'D') {
      const fullD = git(repo, ['diff', 'HEAD', '--', p], { tolerant: true }) || '';
      symbols = symbolsFromHunkHeaders(git(repo, ['diff', 'HEAD', '-U0', '--', p], { tolerant: true }));
      diffChars = add * 0 + del * 40;
      diffTokens = countTokens(fullD);
    } else if (!binary) {
      const full = git(repo, ['diff', 'HEAD', '--', p], { tolerant: true }) || '';
      symbols = symbolsFromHunkHeaders(git(repo, ['diff', 'HEAD', '-U0', '--', p], { tolerant: true }));
      diffChars = full.length;
      snippet = full.split('\n').slice(0, 60).join('\n');
      diffTokens = countTokens(full);
    }

    files.push({
      path: p,
      status: statusWord(code),
      code,
      from,
      untracked: untracked.has(p),
      add,
      del,
      binary,
      ext: path.extname(p).toLowerCase(),
      type: fileKind(p),
      dir: path.posix.dirname(p.split(path.sep).join('/')),
      noise,
      symbols,
      diffChars: Math.max(diffChars, (add + del) * 40),
      diffTokens,
      snippet: snippet.length > 1400 ? snippet.slice(0, 1400) : snippet
    });
  }

  return { repo, files };
}
