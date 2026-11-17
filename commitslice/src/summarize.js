import { chat } from './ollama.js';
import { mapPool, truncate } from './util.js';

const SYSTEM = '你是 git diff 分析助手。用一句简洁中文说明这个文件本次改动的意图。只输出这一句话,不要解释、不要前缀、不要引号。';

function buildUserPrompt(file) {
  return [
    `文件: ${file.path}`,
    `状态: ${file.status}${file.from ? `(原 ${file.from})` : ''}`,
    `类型: ${file.type}`,
    `目录: ${file.dir}`,
    `增删: +${file.add}/-${file.del}`,
    file.symbols.length ? `函数/类: ${file.symbols.join(', ')}` : '',
    file.snippet ? `改动片段:\n${truncate(file.snippet, 900)}` : ''
  ]
    .filter(Boolean)
    .join('\n');
}

async function summarizeOne(file, { timeoutMs }) {
  if (file.binary) return '二进制文件变更';
  try {
    const text = await chat(
      [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: buildUserPrompt(file) }
      ],
      { timeoutMs }
    );
    const line = (text || '').trim().split('\n').find((l) => l.trim());
    return line ? line.trim() : null;
  } catch {
    return null;
  }
}

// Adds a `summary` to every file. LLM failures degrade to null (rule-based fallback in
// classify() takes over), so the pipeline never hard-stops on a model hiccup.
export async function summarizeFiles(files, { concurrency = 4, timeoutMs = 20000, limit = Infinity } = {}) {
  const targets = files.slice(0, limit);
  const summaries = await mapPool(targets, concurrency, (f) => summarizeOne(f, { timeoutMs }));
  const byPath = new Map(targets.map((f, i) => [f.path, summaries[i]]));
  for (const f of files) f.summary = byPath.has(f.path) ? byPath.get(f.path) : null;
  return files;
}
