#!/usr/bin/env node
import { extractChanges } from './extract.js';
import { summarizeFiles } from './summarize.js';
import { classify } from './classify.js';
import { resolveOcoCli } from './resolveOco.js';
import { ollamaInfo, pingOllama } from './ollama.js';
import { readOcoConfig, commitTokenBudget, messageLang } from './opencommitConfig.js';
import { resetIndex, stagePaths, runOco, ocoCommand, headSubject, commitMessage } from './plan.js';
import { noiseGroups } from './prescreen.js';
import { readPackageVersion } from './util.js';

const HELP = `commitslice — 把大 diff 智能拆分成多条 Conventional Commit(默认直接 apply)

路径级预筛(lock/生成物/产物/快照:不读内容、不走模型,按元数据分组后直接用固定 message 提交) → 提取其余每文件 diff 特征 → 本地模型逐文件摘要 → 按 Conventional 类型 + 模块 scope 分类 → 每个(类型,scope)桶在 token 预算内细分 → 按桶暂存 → 调用 opencommit(oco) 生成 commit message。
除预筛组的固定 message 外,commit message 的语言/格式/规范全部沿用 oco 自身配置;预筛 message 的语言跟随 oco 的 OCO_LANGUAGE(非中文回退英文)。

用法:
  commitslice [选项]

选项:
  --repo <path>            目标仓库路径(可选,默认当前工作目录;只在跨目录调用时才需要)
  --dry-run                只预览分组和将执行的命令,不做任何 git add / oco 调用(默认直接 apply)
  --no-llm                 跳过本地模型,仅用规则分类(feat/fix/docs/... )
  --no-prescreen           关闭路径级预筛:lock/生成物也照常读 diff、走模型摘要与分类
  --max-tokens-per-commit <n>  单条 commit 的 diff token 上限;超过则把该分类打回模型细分。默认按 oco 预算推导(OCO_TOKENS_MAX_INPUT − prompt − output)
  --max-resplit-rounds <n> 单个分类被打回细分的最大轮数(默认 2)
  --prompt-reserve <n>     预算推导时为 oco prompt 预留的 token 数(默认 800;仅在不显式指定 --max-tokens-per-commit 时生效)
  --concurrency <n>        逐文件摘要并发数(默认 4)
  --max-summaries <n>      最多对前 n 个文件调模型摘要(默认全部)
  -h, --help               显示帮助
  --version                显示版本

退出码: 0 正常,1 出错`;

function parseArgs(argv) {
  const opts = {
    repo: process.cwd(),
    dryRun: false,
    noLlm: false,
    prescreen: true,
    maxTokensPerCommit: undefined,
    maxResplitRounds: 2,
    promptReserve: undefined,
    concurrency: 4,
    maxSummaries: Infinity
  };
  const num = (v, name) => {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`--${name} 需要一个数字`);
    return n;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case '--dry-run': opts.dryRun = true; break;
      case '--no-llm': opts.noLlm = true; break;
      case '--no-prescreen': opts.prescreen = false; break;
      case '-h': case '--help': return { ...opts, help: true };
      case '--version': return { ...opts, version: true };
      case '--repo': opts.repo = next(); break;
      case '--max-tokens-per-commit': opts.maxTokensPerCommit = num(next(), 'max-tokens-per-commit'); break;
      case '--max-resplit-rounds': opts.maxResplitRounds = num(next(), 'max-resplit-rounds'); break;
      case '--prompt-reserve': opts.promptReserve = num(next(), 'prompt-reserve'); break;
      case '--concurrency': opts.concurrency = num(next(), 'concurrency'); break;
      case '--max-summaries': opts.maxSummaries = num(next(), 'max-summaries'); break;
      default: throw new Error(`未知参数: ${a}`);
    }
  }
  return opts;
}

function line(ch = '─', n = 72) {
  return ch.repeat(n);
}

// A staged batch must include rename/copy source paths, otherwise `git add` of only the
// new path records the added half and leaves the deletion of the old path unstaged.
function collectStagePaths(commitObj) {
  const set = new Set(commitObj.files);
  for (const f of commitObj.fileObjs || []) if (f.from) set.add(f.from);
  return [...set];
}

// Each batch is one (type, scope) bucket, so the scope is stable and handed straight to oco.
// This is what keeps the final `<type>(<scope>)` header regular instead of guessed from the diff.
function commitContext(c) {
  const scope = c.scope ? `(${c.scope})` : '';
  return `本次仅提交 ${c.type}${scope} 类改动,共 ${c.files.length} 个文件`;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) { console.log(HELP); return 0; }
  if (opts.version) { console.log(`commitslice v${readPackageVersion()}`); return 0; }

  const ocoPath = resolveOcoCli();
  const cfg = readOcoConfig();
  const ep = ollamaInfo();

  let changes;
  try {
    changes = extractChanges(opts.repo, { prescreen: opts.prescreen });
  } catch (err) {
    console.error(`✗ 提取变更失败: ${err.message}`);
    return 1;
  }

  const { repo, files } = changes;
  const noiseFiles = files.filter((f) => f.noise);
  const codeFiles = files.filter((f) => !f.noise);
  const prescreened = noiseGroups(noiseFiles, { lang: messageLang(cfg) });
  console.log(line('━'));
  console.log(`commitslice  ·  ${opts.dryRun ? 'dry-run 预览' : 'APPLY 模式'}`);
  console.log(line('━'));
  console.log(`仓库:        ${repo}`);
  console.log(`变更文件:    ${files.length}`);
  if (noiseFiles.length) {
    console.log(`预筛短路:    ${noiseFiles.length} 个(lock/生成物/产物/快照,未读内容、不走模型)`);
  }
  console.log(`本地模型:    ${ep.provider} · ${ep.model}  (${ep.base})`);
  console.log(`oco message: 语言=${cfg.OCO_LANGUAGE || 'en'} · 模块=${cfg.OCO_PROMPT_MODULE || 'conventional-commit'}(全部由 oco 配置决定)`);
  console.log(`引用 oco:    ${ocoPath ?? '未找到(缺 opencommit/out/cli.cjs,请在仓库根 npm run build)'}`);

  const warnings = [];
  if (!opts.dryRun) {
    if (String(cfg.OCO_GITPUSH).toLowerCase() === 'true') {
      warnings.push('检测到 oco 配置 OCO_GITPUSH=true;本次执行已用环境变量强制关闭 push,不会影响你的全局配置。');
    }
  } else if (String(cfg.OCO_GITPUSH).toLowerCase() === 'true') {
    warnings.push('OCO_GITPUSH=true:去掉 --dry-run 真正执行时,commitslice 会在每次 oco 调用时临时禁用 push。');
  }
  const renames = files.filter((f) => f.code[0] === 'R' || f.code[0] === 'C');
  if (renames.length) warnings.push(`含 ${renames.length} 个重命名/复制,apply 时会把 from→to 一起暂存。`);
  const binaries = codeFiles.filter((f) => f.binary);
  if (binaries.length) warnings.push(`含 ${binaries.length} 个二进制文件,不参与模型摘要,按规则归类。`);

  if (!files.length) {
    console.log('\n工作区没有相对 HEAD 的改动,无需拆分。');
    return 0;
  }

  let llmAvailable = false;
  if (codeFiles.length && !opts.noLlm) {
    llmAvailable = await pingOllama();
    if (!llmAvailable) warnings.push('Ollama 不可达:已跳过模型摘要/分类,改用规则分类兜底。');
  }

  const maxTokensPerCommit = Number.isFinite(opts.maxTokensPerCommit)
    ? opts.maxTokensPerCommit
    : commitTokenBudget(cfg, Number.isFinite(opts.promptReserve) ? { promptReserve: opts.promptReserve } : {});

  let result = { llmUsed: false, groups: [], planned: [] };
  if (codeFiles.length) {
    if (llmAvailable) {
      process.stdout.write('\n→ 逐文件摘要中(本地模型)… ');
      await summarizeFiles(codeFiles, { concurrency: opts.concurrency, limit: opts.maxSummaries });
      const done = codeFiles.filter((f) => f.summary).length;
      console.log(`${done}/${codeFiles.length} 完成`);
    } else {
      for (const f of codeFiles) f.summary = null;
    }

    console.log('→ 按 Conventional 类型 + 模块 scope 分类…');
    result = await classify(codeFiles, {
      useModel: llmAvailable,
      maxTokensPerCommit,
      maxResplitRounds: opts.maxResplitRounds
    });
    console.log(`   方式: ${result.llmUsed ? '本地模型' : '规则兜底'} · 单条预算: ~${maxTokensPerCommit} tok · 分组: ${result.groups.map((g) => `${g.type}${g.scope ? `(${g.scope})` : ''}×${g.count}`).join(', ')}`);
  } else {
    console.log('\n本次变更全部命中预筛,无需模型摘要与分类。');
  }

  // Prescreened groups go first: the code commits then read as the whole story, without lock
  // churn mixed into their diffs.
  const batches = [...prescreened, ...result.planned];

  console.log('\n将生成的 commit(预筛组在前,其余按 (类型,scope) 桶在 token 预算内已打回细分):');
  batches.forEach((c, i) => {
    const staged = collectStagePaths(c);
    const size = c.fixed ? '  ·  预筛(固定 message)' : `  ·  ~${c.estTokens} tok`;
    console.log(line());
    console.log(`[${i + 1}] ${c.type}${c.scope ? `(${c.scope})` : ''}  ·  ${c.files.length} 个文件${size}${c.oversize ? '  ·  ⚠ 超预算,交由 oco 内部拆块' : ''}`);
    for (const p of c.files) console.log(`      ${p}`);
    if (c.fixed) {
      console.log(`      → git add ${staged.length} 个路径 → git commit -m "${c.subject}"(不经 oco)`);
    } else {
      const ctx = commitContext(c);
      console.log(opts.dryRun ? `      → ${ocoCommand(ocoPath ?? 'oco', ctx)}` : `      → git add ${staged.length} 个路径 → oco -y -c "${ctx}"`);
    }
  });

  if (warnings.length) {
    console.log(line('━'));
    console.log('注意事项:');
    for (const w of warnings) console.log(`  ! ${w}`);
  }

  if (opts.dryRun) {
    console.log(line('━'));
    console.log('dry-run:未做任何 git add / commit / oco 调用。去掉 --dry-run 即真正提交。');
    return 0;
  }

  if (!ocoPath && result.planned.length) {
    console.error('\n✗ 未找到 opencommit 的 oco CLI,无法 apply。请先在仓库根运行 `npm run build` 生成 opencommit/out/cli.cjs。');
    return 1;
  }

  console.log('\n→ APPLY:预筛组用固定 message 先提交,其余逐类别 reset→add→oco\n');
  for (let i = 0; i < batches.length; i++) {
    const c = batches[i];
    console.log(line('═'));
    console.log(`[${i + 1}/${batches.length}] ${c.type}${c.scope ? `(${c.scope})` : ''} · ${c.files.length} 个文件${c.fixed ? ' · 预筛固定 message' : ` · ~${c.estTokens} tok`}`);
    resetIndex(repo);
    stagePaths(repo, collectStagePaths(c));
    const sha = c.fixed ? commitMessage(repo, c.subject, c.body) : runOco(repo, ocoPath, commitContext(c));
    console.log(`  ✓ ${sha.slice(0, 8)}  ${headSubject(repo)}`);
  }
  resetIndex(repo);
  console.log(line('━'));
  console.log(`完成:生成 ${batches.length} 条 commit(其中 ${prescreened.length} 条为预筛固定 message)。工作区改动已全部进入历史(如未覆盖请以 git status 复核)。`);
  return 0;
}

main()
  .then((code) => process.exit(code ?? 0))
  .catch((err) => {
    console.error(`\n✗ ${err && err.stack ? err.stack : err}`);
    process.exit(1);
  });
