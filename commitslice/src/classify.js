import { chat } from './ollama.js';
import { parseJsonLoose } from './util.js';
import { deriveScope } from './scope.js';

export const CONVENTIONAL_TYPES = ['feat', 'fix', 'refactor', 'docs', 'style', 'test', 'chore', 'perf', 'build', 'ci'];

const SYSTEM = '你是 git 变更归类助手。只输出 JSON,不要任何多余文字。';

function fileLine(f) {
  return `${f.path} | ${f.status} | ${f.type} | ${f.dir} | ${f.summary || '(无摘要)'}`;
}

// Rule fallback used when the model is unavailable or drops files: matches the agreed
// "先按 Conventional 类型粗分".
function fallbackType(f) {
  const p = f.path.toLowerCase();
  const ext = f.ext;
  if (ext === '.md' || ext === '.mdx' || ext === '.rst' || ext === '.txt' || p.includes('docs/')) return 'docs';
  if (/(^|\/)(test|tests|spec|__tests__)(\/|$)/.test(p) || /\.(test|spec)\.[a-z]+$/.test(p)) return 'test';
  if (/(^|\/)(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|cargo\.lock|go\.(mod|sum)|pom\.xml)$/.test(p) ||
      /(^|\/|\.)(dockerfile|makefile|\.gitignore|\.envrc)/.test(p) || p.includes('.github/') || ext === '.toml' || ext === '.ini') {
    return 'chore';
  }
  if (f.code[0] === 'D') return 'chore';
  if (f.code[0] === 'A' || f.code[0] === 'R' || f.code[0] === 'C') return 'feat';
  return 'fix';
}

async function askModel(files, { timeoutMs }) {
  const user = [
    '把这些文件按 Conventional Commit 类型归类。',
    `type 只能是: ${CONVENTIONAL_TYPES.join(', ')}。`,
    '严格返回 JSON: {"groups":[{"type":"feat","files":["path1","path2"]}]}',
    '每个文件只能出现在一个 group;必须覆盖全部文件;files 用给定路径原文。',
    '',
    '文件列表:',
    files.map(fileLine).join('\n')
  ].join('\n');
  try {
    const text = await chat(
      [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
      { timeoutMs, json: true }
    );
    const parsed = parseJsonLoose(text);
    if (!parsed || !Array.isArray(parsed.groups)) return null;
    return parsed.groups;
  } catch {
    return null;
  }
}

// Ask the model to subdivide one oversized category into smaller sub-groups of the SAME type,
// so each sub-group stays under the per-commit token budget. Returns an array of file-path arrays
// (or null on failure). The category type never changes — only its file partition does.
async function askModelResplit(groupFiles, { type, budget, timeoutMs }) {
  const total = sumTokens(groupFiles);
  const user = [
    `以下文件当前同属 "${type}" 类,合计 diff 约 ${total} token,超过单条 commit 预算 ${budget} token。`,
    `请在 "${type}" 类型内把这些文件细分成 2 个或更多更小的组,使每组 token 之和尽量不超过 ${budget}。`,
    '只能使用给定路径原文;每个路径必须且只能出现一次;不要新增/改写/合并/删除路径。',
    '优先把同目录/同功能的文件聚在同一组,减少语义割裂。',
    '严格返回 JSON: {"groups":[{"files":["path1","path2"]},{"files":["path3"]}]}',
    '',
    '文件(路径 | 目录 | ~token | 摘要):',
    groupFiles.map((f) => `${f.path} | ${f.dir} | ~${f.diffTokens || 0} tok | ${f.summary || '(无摘要)'}`).join('\n')
  ].join('\n');
  try {
    const text = await chat(
      [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
      { timeoutMs, json: true }
    );
    const parsed = parseJsonLoose(text);
    if (!parsed || !Array.isArray(parsed.groups)) return null;
    return parsed.groups.map((g) => (Array.isArray(g?.files) ? g.files : [])).filter((list) => list.length);
  } catch {
    return null;
  }
}

function sumTokens(list) {
  return list.reduce((s, f) => s + (f.diffTokens || 0), 0);
}

// Convert the model's per-sub-group path lists into file-object lists and verify the partition is
// a faithful cover of the input (no dropped, duplicated, or invented paths). Any violation invalidates
// the subdivision so the caller falls back to committing the group whole (oco chunks it) instead of
// silently losing files.
function partitionToGroups(subPathLists, groupFiles) {
  const byPath = new Map(groupFiles.map((f) => [f.path, f]));
  const seen = new Set();
  const out = [];
  for (const list of subPathLists) {
    const batch = [];
    for (const p of list) {
      if (!byPath.has(p) || seen.has(p)) return null;
      seen.add(p);
      batch.push(byPath.get(p));
    }
    out.push(batch);
  }
  if (seen.size !== groupFiles.length) return null;
  return out;
}

function makeBatch(list) {
  return {
    files: list.map((f) => f.path),
    fileObjs: list,
    estTokens: sumTokens(list),
    oversize: false
  };
}

// Turn one category into the smallest set of same-type commit batches that respect the token
// budget. Oversized categories are bounced back to the model for finer subdivision (up to
// maxResplitRounds). A batch that still exceeds the budget — a single giant file, no model,
// rounds exhausted, or the model failing to make progress — is committed whole and flagged
// `oversize` so it is left to oco's own token chunking rather than truncated.
async function resolveBatches(groupFiles, { type, budget, round, maxRounds, useModel, timeoutMs, resplit }) {
  const finalize = (list) => {
    const batch = makeBatch(list);
    batch.oversize = batch.estTokens > budget;
    return [batch];
  };

  const total = sumTokens(groupFiles);
  if (total <= budget || groupFiles.length <= 1 || !useModel || round >= maxRounds) {
    return finalize(groupFiles);
  }

  const subPathLists = await resplit(groupFiles, { type, budget, timeoutMs });
  const partition = subPathLists ? partitionToGroups(subPathLists, groupFiles) : null;
  if (!partition || partition.length < 2) {
    // Model could not (or should not) split further: commit whole, let oco chunk.
    return finalize(groupFiles);
  }

  const batches = [];
  for (const sub of partition) {
    batches.push(...await resolveBatches(sub, { type, budget, round: round + 1, maxRounds, useModel, timeoutMs, resplit }));
  }
  return batches;
}

export async function classify(
  files,
  { useModel = true, timeoutMs = 30000, maxTokensPerCommit, maxResplitRounds = 2, initialClassify = askModel, resplit = askModelResplit } = {}
) {
  const budget = Number.isFinite(maxTokensPerCommit) ? maxTokensPerCommit : Infinity;
  const byPath = new Map(files.map((f) => [f.path, f]));
  const assigned = new Map();
  const groups = useModel ? await initialClassify(files, { timeoutMs }) : null;
  const llmUsed = Boolean(groups);

  if (groups) {
    for (const g of groups) {
      const raw = g?.type;
      const type = CONVENTIONAL_TYPES.includes(raw) ? raw : raw || 'chore';
      const list = Array.isArray(g?.files) ? g.files : [];
      for (const p of list) {
        if (byPath.has(p) && !assigned.has(p)) assigned.set(p, type);
      }
    }
  }

  const buckets = new Map();
  for (const f of files) {
    const type = assigned.get(f.path) || fallbackType(f);
    const scope = deriveScope(f.path);
    const key = `${type}\u0000${scope}`;
    if (!buckets.has(key)) buckets.set(key, { type, scope, files: [] });
    buckets.get(key).files.push(f);
  }

  const planned = [];
  for (const { type, scope, files: groupFiles } of buckets.values()) {
    const batches = await resolveBatches(groupFiles, {
      type,
      budget,
      round: 0,
      maxRounds: maxResplitRounds,
      useModel,
      timeoutMs,
      resplit
    });
    batches.forEach((batch, i) => planned.push({ type, scope, index: i, ...batch }));
  }
  planned.sort((a, b) => a.type.localeCompare(b.type) || a.scope.localeCompare(b.scope) || a.index - b.index);

  return {
    llmUsed,
    budget,
    groups: [...buckets.values()].map((b) => ({ type: b.type, scope: b.scope, count: b.files.length })),
    planned: planned.map(({ index, ...rest }) => ({ ...rest }))
  };
}
