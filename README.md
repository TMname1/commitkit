# commitkit · `@tmname1/commitslice`

把大 diff 智能拆分成多条 Conventional Commit。一个包，两个命令：

| 命令 | 说明 |
| --- | --- |
| `commitslice` | 拆分工具（[commitslice/](commitslice/README.md)）：路径级预筛 → 逐文件摘要 → 按 Conventional 类型 + 模块 scope 分类 → 分批 `git add` 后调用 `oco` 生成 commit message。默认直接 apply，`--dry-run` 只预览。 |
| `oco` / `opencommit` | 文案生成器（[opencommit/](opencommit)）：vendored 的上游 OpenCommit，负责实际生成 commit message；commitslice 的文案语言/格式/Emoji/scope/Provider 全部沿用它的配置（`~/.opencommit`）。 |

两者过去是两个 npm 包（`@tmname1/commitslice` + `@tmname1/opencommit`），现已合并为**单个包 `@tmname1/commitslice`**，一次 `npm publish` 同时发布两个命令。opencommit 仍是内部实现，没有对外 JS API——commitslice 按路径 `spawn` 它。

```bash
npm i -g @tmname1/commitslice   # 全局安装，之后任何目录直接敲 commitslice / oco
npx @tmname1/commitslice        # 免安装，一次性运行
```

> ⚠️ 不要写 `npx commitslice`——不带 scope 会命中 npm 上另一个**完全无关**的同名第三方包（"Track your git commits automatically"）。始终带 `@tmname1/`。

装过旧包的用户只需换包名，配置不用动：

```bash
npm rm -g @tmname1/opencommit   # 旧包已并入本包，不再单独发布
npm i -g @tmname1/commitslice
```

## 源码布局

| 目录 | 内容 |
| --- | --- |
| [`commitslice/`](commitslice/README.md) | 拆分器源码（plain ESM）→ 构建产物 `commitslice/dist/commitslice.js` |
| [`opencommit/`](opencommit) | vendored 上游 OpenCommit 源码（TypeScript）→ 构建产物 `opencommit/out/cli.cjs` + `out/tiktoken_bg.wasm` |
| `scripts/` | 根构建/测试编排（Node 实现，跨平台） |

仓库只有一个 `package.json`，不再是 npm workspaces；上面两个目录是包内的源码组织，不是子包。

快速开始（详情见 [commitslice/README.md](commitslice/README.md)）：

```bash
npm run setup                        # 根目录一键安装 + 构建两个入口的产物
npm run commitslice -- --dry-run     # 预览将要生成的 commit 分组
npm run commitslice --               # 默认 apply：逐批 reset→add→oco
```

> ✅ 仓库根目录下 `npm run commitslice -- ...`、`npx commitslice`、`npx oco` 三种写法**都是安全的**：`npx` 会先检查**当前项目自己的 `bin`**（npm 11 的 `libnpmexec` 在触网前做这一步），命中后直接跑本仓库产物，不会去 registry 下载同名第三方包。两者行为略有差别——`npm run commitslice` 跑的是 `commitslice/src/index.js`（改完源码立刻生效），`npx commitslice` 跑的是构建产物 `commitslice/dist/commitslice.js`（需要先 `npm run build`）。
>
> ⚠️ 一旦**离开本仓库目录**，裸 `npx commitslice` 就会命中 npm 上同名的第三方包，请务必带上 scope：`npx @tmname1/commitslice`。

架构、命令与安全说明见 [QODER.md](QODER.md)。

## oco 如何配置

commitslice **不新增任何文案配置**——语言、格式、Emoji、scope、Provider 全部由 vendored 的 `oco`（[opencommit/](opencommit)）决定。配置存放在全局文件 `~/.opencommit`，仓库内 `.env` 优先级更高；改一次即对 commitslice 与 `oco` 同时生效。

**不需要额外安装任何 opencommit 包**：`npm run setup` 后，以下本地入口都等价于 `oco ...`——

```bash
# 方式 A：根脚本包装器（推荐，永不触网）
cd D:/commitkit && npm run oco -- config set OCO_LANGUAGE=zh_CN

# 方式 A'：在仓库根直接 npx（同样命中本包，因为 npx 优先解析当前项目的 bin）
cd D:/commitkit && npx oco config set OCO_LANGUAGE=zh_CN

# 方式 B：直接跑 vendored 的 CLI 产物（最稳，任何目录都可用绝对路径）
node D:/commitkit/opencommit/out/cli.cjs config set OCO_LANGUAGE=zh_CN

# 方式 C：先 npm link，之后任何目录直接敲命令名
cd D:/commitkit && npm link && oco config set OCO_LANGUAGE=zh_CN
```

> 下面示例统一写作 `oco ...`，实际执行时请替换为 `npm run oco -- ...`、`npx oco ...`（仅限仓库根）、`node opencommit/out/cli.cjs ...`，或先 `npm link`。只有 link 过之后才能**在任意目录直接敲 `oco`**：本包只有一份清单，`npm link` 一次即同时链出 `commitslice`、`oco`、`opencommit` 三个命令（见文末）。

### 查看与设置

```bash
oco config describe                 # 列出全部配置项与可选值
oco config describe OCO_MODEL       # 只看某一项的合法取值
oco config set OCO_LANGUAGE=zh_CN OCO_EMOJI=false
oco setup                           # 交互式向导，自动拉取 provider 的可用模型
```

### 先选 Provider（决定走云端还是本地）

```bash
# 本地 Ollama —— commitslice 默认场景，无需 API Key，摘要/分类与 oco 命中同一模型
oco config set OCO_AI_PROVIDER=ollama \
               OCO_MODEL=llama3:8b \
               OCO_API_URL=http://localhost:11434/api/chat

# OpenAI 兼容（默认 provider）
oco config set OCO_API_KEY=<your_api_key>
oco config set OCO_MODEL=gpt-4o-mini

# 其它 provider：azure / anthropic / llamacpp / ollama / orcarouter / requesty / uberllm ...
# 完整清单与端点示例见 opencommit/README.md
oco config set OCO_AI_PROVIDER=anthropic OCO_API_KEY=<your_anthropic_key>

# 走代理时
oco config set OCO_PROXY=http://127.0.0.1:7890
```

### 影响最终 commit 文案的常用开关

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `OCO_LANGUAGE` | `en` | 文案语言，如 `zh_CN`；commitslice 的**预筛组固定 message** 语言也跟随它 |
| `OCO_PROMPT_MODULE` | `CONVENTIONAL_COMMIT` | prompt 模板（conventional / emoji / one-commit …） |
| `OCO_EMOJI` | `true` | 是否在标题前加 Emoji |
| `OCO_EMOJI_FULL_SPEC` | `false` | 输出完整的 emoji 规范说明 |
| `OCO_DESCRIPTION` | `true` | 是否生成正文 body |
| `OCO_ONE_LINE_COMMIT` | `false` | 强制单行 commit，不写 body |
| `OCO_WHY` | `false` | 追加一句「why」说明 |
| `OCO_GITPUSH` | – | oco 生成后是否自动 push；commitslice apply 时会在子进程环境变量里临时置 `false`，**不会真 push、也不改你的全局配置** |

### 影响 commitslice 自身行为的

| 变量 | commitslice 如何使用 |
| --- | --- |
| `OCO_AI_PROVIDER` / `OCO_MODEL` / `OCO_API_URL` | 「逐文件摘要」与「按 Conventional 类型分类」直接复用这三项，与 oco 走同一模型、口径一致 |
| `OCO_TOKENS_MAX_INPUT` / `OCO_TOKENS_MAX_OUTPUT` | 用来推导**单条 commit 的 token 预算**；超预算的分类会被打回模型细分，避免 oco 自己再截断 diff |

### 与 commitslice 的协作要点

- commitslice 只决定「哪些文件归为一条 commit」，具体文案完全交给 `oco -y [-c <类别说明>]` 生成。
- `oco -c` 传入的是「类别说明」上下文（如"本次仅提交 docs 类改动(docs), 共 2 个文件"），不覆盖上述任何配置。
- commitslice 从自己的安装位置向上查找**同包内**的 `opencommit/out/cli.cjs`，开发态与安装态走同一条逻辑，因此**不装任何全局包也能正常 apply**。
- 想让 `oco` / `commitslice` 在任意目录直接可用（可选、非必需）：在仓库根跑一次 `npm link`。

> 更多 provider 与全部配置项：[opencommit/README.md](opencommit/README.md)（vendored 上游文档，其中的包名与安装命令属于上游项目，不代表本包的发布方式）· commitslice 侧的调用与预算推导：[commitslice/README.md](commitslice/README.md)。

## GitHub Action 不在 npm 包里

`opencommit/action.yml` 指向 `opencommit/out/github-action.cjs`。`npm run build` 会在本地生成该产物，但发布白名单（根 `package.json` 的 `files`）**刻意不含**它——Action 只能从源码仓库引用，不能从 npm 安装使用。这与合并前一致：旧的 `@tmname1/opencommit` 也用 `.npmignore` 排除了同一个文件。

## npm audit 现状

根 `package.json` 的 `overrides` 现在作用于**整棵依赖树**（合并前 opencommit 那份只在自己的 workspace 内生效）：

| 包 | override | 公告 / 来源 |
| --- | --- | --- |
| `minimatch` | `^11.0.1` | GHSA-g3hv-75wg-m249（DoS） |
| `glob` | `^14.0.2` | GHSA-3g3m-2fjr-6pw4（AbortSignal 绕过） |
| `ajv` | `^8.17.1` | 合并自原 opencommit overrides |
| `whatwg-url` | `^14.0.0` | 合并自原 opencommit overrides |
| `js-yaml`（限定 `@istanbuljs/load-nyc-config` 下） | `^4.3.2` | 合并自原 opencommit overrides |
| `content-type`（限定 `@octokit/request` 下） | `^2.1.0` | 合并自原 opencommit overrides |

`npm audit` 现在剩 8 条（6 low + 2 high），均**有意保留**，不要跑 `npm audit fix --force`：

- **6 low（deepmerge）**：GHSA-gcqx-w48m-w2h4 在 4.x 至今无 patched 版本，`--force` 路径要把整棵 `jest` 降到 25.1.0，破坏现有 jest 30 配置。仅 dev/test 工具链，commitslice 运行时不可被外部触发。
- **2 high（zod）**：GHSA-mrhx-c7xc-m3w5 修复在 zod ≥ 4.6.6，但 `openai@4.104` SDK 类型契约锁 zod 3，强升 4.x 会编译失败。等 openai 升级到适配 zod 4 的版本再处理。

校验命令：`npm audit --audit-level=critical` 应静默；改动 overrides 后须 `rm package-lock.json && rm -rf node_modules && npm install`，否则 npm 复用 lockfile 不会重新解析。
