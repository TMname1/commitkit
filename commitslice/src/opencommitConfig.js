import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DEFAULTS = {
  OCO_AI_PROVIDER: 'ollama',
  OCO_MODEL: 'qwen2.5-coder:7b',
  OCO_API_URL: 'http://localhost:11434',
  OCO_TOKENS_MAX_INPUT: '4096',
  OCO_TOKENS_MAX_OUTPUT: '500',
  OCO_REASONING_MAX_TOKENS: '1000',
  OCO_GITPUSH: 'true'
};

// oco subtracts this adjustment and the prompt/output budgets from OCO_TOKENS_MAX_INPUT before
// it decides whether a diff is small enough for one generation; commitslice mirrors that to size a
// category so oco will not internally chunk it. See opencommit/src/generateCommitMessageFromGitDiff.ts.
const ADJUSTMENT_FACTOR = 20;
const DEFAULT_PROMPT_RESERVE = 800;

// commitslice reuses opencommit's own config (~/.opencommit, flat KEY=VALUE) so the
// local model used here stays identical to the one oco uses. No new config surface.
export function readOcoConfig() {
  const file = path.join(os.homedir(), '.opencommit');
  const cfg = { ...DEFAULTS };
  try {
    const raw = fs.readFileSync(file, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (m) cfg[m[1]] = m[2].trim();
    }
  } catch {
    // Missing config: fall back to opencommit's ollama defaults.
  }
  return cfg;
}

export function ollamaEndpoint(cfg = readOcoConfig()) {
  const base = (cfg.OCO_API_URL || DEFAULTS.OCO_API_URL).replace(/\/+$/, '');
  return { base, model: cfg.OCO_MODEL || DEFAULTS.OCO_MODEL, provider: cfg.OCO_AI_PROVIDER || DEFAULTS.OCO_AI_PROVIDER };
}

// The prescreen step writes a few commit messages itself, so it needs a language. oco accepts
// Chinese aliases (see opencommit/src/i18n) plus 17 others; only Chinese variants get Chinese
// wording, everything else falls back to English rather than shipping 18 hardcoded phrasings.
export function messageLang(cfg = readOcoConfig()) {
  const v = String(cfg.OCO_LANGUAGE || '').trim().toLowerCase();
  const zh = ['中文', '简体', '繁體', '繁体', '简体中文', '繁體中文', '簡體中文', '正體中文'];
  return /^zh([-_]|$)/.test(v) || zh.includes(v) ? 'zh' : 'en';
}

function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// Mirrors oco's reasoning-model detection so the output reservation matches what oco would budget.
function isReasoning(cfg) {
  if (typeof cfg.OCO_REASONING === 'boolean') return cfg.OCO_REASONING;
  const flag = String(cfg.OCO_REASONING ?? '').toLowerCase();
  if (flag === 'true') return true;
  if (flag === 'false') return false;
  return /^(o[1-9]|gpt-5)/.test(cfg.OCO_MODEL || DEFAULTS.OCO_MODEL);
}

// Token ceiling per commit so a single category stays within oco's own input budget and
// oco does not chunk the diff itself: OCO_TOKENS_MAX_INPUT − adjustment − prompt − output.
export function commitTokenBudget(cfg = readOcoConfig(), { promptReserve = DEFAULT_PROMPT_RESERVE } = {}) {
  const maxInput = toPositiveInt(cfg.OCO_TOKENS_MAX_INPUT, toPositiveInt(DEFAULTS.OCO_TOKENS_MAX_INPUT, 4096));
  const maxOutput = isReasoning(cfg)
    ? toPositiveInt(cfg.OCO_REASONING_MAX_TOKENS, toPositiveInt(DEFAULTS.OCO_REASONING_MAX_TOKENS, 1000))
    : toPositiveInt(cfg.OCO_TOKENS_MAX_OUTPUT, toPositiveInt(DEFAULTS.OCO_TOKENS_MAX_OUTPUT, 500));
  const budget = maxInput - ADJUSTMENT_FACTOR - promptReserve - maxOutput;
  return Math.max(256, budget);
}
