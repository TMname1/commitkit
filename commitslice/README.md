# @tmname1/commitslice

把一大堆未提交的改动,智能拆分成多条规范的 Conventional Commit。

做法:**路径级预筛**(lock/生成物/产物/快照:不读文件内容、不走模型,按元数据分组后用固定 message 直接提交) → 提取其余每文件的 diff 特征 → 用本地模型(Ollama)逐文件生成一句话摘要 → 用本地模型按 Conventional 类型(`feat/fix/docs/...`)分类,并按路径派生模块 scope(`apps/api`→`api`、`src/<模块>`→`<模块>`) → 每个(类型,scope)桶若 token 超预算则打回模型细分成更小的同桶子组 → 每个(子)桶 `git add` 后调用 [`opencommit`(oco)](../opencommit) 生成 commit message。

> 除预筛组的固定 message 外,commitslice **不撰写 commit 文案正文**,也不新增 message 相关配置。它只决定「哪些文件归为一条 commit」,并按 `(类型, scope)` 把每条的类别与模块作为上下文提示(`-c`)交给 oco;文案的语言、格式、Emoji、Provider 仍全部由 oco 自己的配置(`~/.opencommit`)决定。
>
> **为什么要预筛**:`package-lock.json` 这类文件体积大、纯机器生成,读它几 MB 的 diff 再让模型摘要,既慢又烧 token,还得不到任何有效语义。预筛只看路径,一次 `git diff` 都不发。反例是 `package.json`/`go.mod`/`Cargo.toml` 这类**清单(manifest)**:文件很小,而且写了「依赖为什么变」,所以照常读、照常走模型。

---

## 发布后安装(推荐)

包已发布为 scoped 名 `@tmname1/commitslice`,npm registry 上无同名冲突,从**任意目录**都能安全使用。一个包同时提供三个命令名(bin):`commitslice`、`oco`、`opencommit`——不再需要另外安装 opencommit,装完直接敲:

```bash
npm i -g @tmname1/commitslice     # 全局安装,之后任何目录直接 commitslice
npx @tmname1/commitslice           # 免安装,一次性运行(任意目录)
```

> ⚠️ 在**仓库目录之外**不要写裸 `npx commitslice`——不带 scope 会命中 npm 上另一个**完全无关**的同名第三方包("Track your git commits automatically")。始终用 `@tmname1/commitslice`。（在 `D:/commitkit` 仓库根内是例外：npx 会先命中本项目自己的 `bin`，见下文。）

不想用 npm 发布版,而是直接跑本地仓库源码 → 见下文 [一键构建 & 免发布运行](#一键构建--免发布运行)。

---

## 一键构建 & 免发布运行

在 **仓库根**(`D:/commitkit`)跑一次:

```bash
npm run setup
```

`setup` 干两件事:
1. `npm install` — 安装依赖,拉取构建工具 esbuild 与 `@dqbd/tiktoken`。注意 npm **不会**把本包自己的 `bin`（`commitslice`、`oco`、`opencommit`）软链进 `node_modules/.bin`（只给依赖包建软链），所以仓库内的入口是下面第 2 节的 `npm run commitslice --` / `npm run oco --` 或 `npx`，全局命令名则需要 `npm link`。
2. `npm run build` — 跑根 [scripts/build.js](../scripts/build.js),构建**两个入口点**:
   - `opencommit`:`npm run build:opencommit` → 从当前 `src/` 重新生成 `opencommit/out/cli.cjs`(+ `out/github-action.cjs` + `out/tiktoken_bg.wasm`)。**这也就把你之前疑问里的「陈旧 `out/`」刷新成和 `src/` 同步的最新版**。
   - `commitslice`:`npm run build:commitslice` → 跑 [scripts/build.js](scripts/build.js),用 esbuild 把全部 `src/*.js` 打包压缩成 `commitslice/` 内的单文件 `commitslice/dist/commitslice.js`(即 `package.json` 里 `bin.commitslice` 指向的路径;`@dqbd/tiktoken` 保持 external、从磁盘加载 WASM;首行保留 `#!/usr/bin/env node` shebang)。

完成后,仓库内的入口是根脚本包装器(不碰 registry,最安全)。注意默认对**当前工作目录**的仓库动手,所以跨仓库要显式 `--repo`,预览要显式 `--dry-run`:

```bash
cd D:/commitkit
npm run commitslice -- --dry-run                        # 预览 commitkit 自己的改动
npm run commitslice -- --repo /path/to/你的仓库 --dry-run   # 预览别的仓库
npm run oco -- config describe                          # 等价于 oco config describe
```

> ℹ️ **关于 `npx commitslice` / `npx oco`**
>
> npm 上存在一个**同名但完全无关**的第三方包 `commitslice`（"Track your git commits automatically"，命令是 `config/init/status/sync/features`），所以不带 scope 的命令名有歧义风险。
>
> **在仓库根（`D:/commitkit`）不会踩到它**：`npx` 在触网之前会先检查**当前项目自己 `package.json` 的 `bin`**（npm 11 `libnpmexec` 的 `hasPkgBin` 预检查），命中就直接跑本仓库的产物，不下载、不弹确认。已实测 `npx commitslice --version` → `commitslice v1.0.0`、`npx oco --version` → `1.0.0`。
>
> **离开仓库目录后**，本地 `bin` 不再命中，裸 `npx commitslice` 会下载那个第三方包。此时请用下面四种之一：
> 1. **发布版**：`npx @tmname1/commitslice` 或 `npm i -g @tmname1/commitslice` — 见上文「发布后安装」一节。
> 2. **绝对路径**：`node D:/commitkit/commitslice/dist/commitslice.js`（未构建时可用 `node D:/commitkit/commitslice/src/index.js`）。
> 3. 先 `npm link`，之后全局命令名直接 `commitslice` / `oco`。
> 4. 回到仓库根，用 `npm run commitslice -- ...` / `npm run oco -- ...`。
>
> 顺带一提两种入口的差别：`npm run commitslice` 跑源码 `commitslice/src/index.js`（改完即生效），`npx commitslice` 跑构建产物 `commitslice/dist/commitslice.js`（改完源码要先 `npm run build`）。

想让 `commitslice` / `oco` 这两个命令在任何目录都能直接敲，在仓库根再跑一次:

```bash
npm link          # 一份清单,一次 link 同时链出 commitslice / oco / opencommit 三个命令
```

之后,从任意 git 仓库目录里直接 `commitslice`、`oco` 即可,无需 `--repo`、无需 `npx`。

想单独重跑构建(不重装依赖),用:

```bash
npm run build                # 两个都构建
npm run build:opencommit     # 只重建 opencommit
npm run build:commitslice      # 只重新打包 commitslice → commitslice/dist/commitslice.js
```

---

## 前置条件

- **Node.js ≥ 20**(用到内置 `fetch`)。
- 目标仓库是 git 仓库,**且已有一次提交**(存在 `HEAD`)。新文件等是相对 `HEAD` 来识别的。
- **本地模型(Ollama)在跑**,且 `~/.opencommit` 里已配置好 oco(`OCO_AI_PROVIDER=ollama`、`OCO_MODEL=...`、`OCO_API_URL=http://localhost:11434`)。
  - 模型不可达时 commitslice 不会报错,自动降级为「规则分类」(见下文),仍可正常预览。
- 同包内存在 `opencommit/out/cli.cjs`(本仓库/本 npm 包已自带,开箱可用)。

---

## 运行

在目标仓库目录下,直接运行(默认对当前目录操作):

```bash
node D:/commitkit/commitslice/src/index.js
```

或全局 link 后用命令名:

```bash
commitslice
oco -y
```

需要从其他目录指定目标仓库时,再加 `--repo`:

```bash
commitslice --repo /path/to/你的仓库
```

> 再次提醒:**不要在仓库目录之外直接 `npx commitslice`** — 那样会命中 npm 上同名的第三方包,而不是本仓库;在 `D:/commitkit` 里则安全(npx 优先命中本项目的 `bin`)。详见上文 [一键构建 & 免发布运行](#一键构建--免发布运行) 中的说明.

> 是否安装都行:commitslice 从自己的安装位置向上查找同包内的 `opencommit/out/cli.cjs`,开发态与安装态是同一条逻辑。

---

## 快速上手

**第 1 步:先 dry-run 预览(安全,不动暂存区/历史)**

```bash
cd /path/to/你的仓库
commitslice --dry-run
```

**第 2 步:确认分组无误后,真正提交(默认行为)**

```bash
commitslice
```

apply(默认行为)会对每一批执行:`git reset` → `git add <该批文件>` → `oco -y`,逐条生成 commit。加 `--dry-run` 只预览、不执行。

---

## 示例输出(dry-run)

```
commitslice  ·  dry-run 预览
仓库:        /path/to/你的仓库
变更文件:    6
预筛短路:    1 个(lock/生成物/产物/快照,未读内容、不走模型)
本地模型:    ollama · qwen2.5-coder:7b  (http://localhost:11434)
oco message: 语言=zh_CN · 模块=conventional-commit(全部由 oco 配置决定)
引用 oco:    D:\commitkit\opencommit\out\cli.cjs
→ 按 Conventional 类型 + 模块 scope 分类…
   方式: 本地模型 · 单条预算: ~2776 tok · 分组: chore×1, docs×1, feat(api)×2, feat(client)×2, fix(api)×1

将生成的 commit(预筛组在前,其余按 (类型,scope) 桶在 token 预算内已打回细分):
[1] chore  ·  1 个文件  ·  预筛(固定 message)
      package-lock.json
      → git add 1 个路径 → git commit -m "chore(deps): 更新 Node 依赖锁文件"(不经 oco)
[2] docs  ·  1 个文件  ·  ~58 tok
      README.md
      → node .../opencommit/out/cli.cjs -y -c "本次仅提交 docs 类改动,共 1 个文件"
[3] feat(api)  ·  2 个文件  ·  ~410 tok
      apps/api/src/forge/job-store.ts
      apps/api/src/forge/runner-client.ts
      → node .../opencommit/out/cli.cjs -y -c "本次仅提交 feat(api) 类改动,共 2 个文件"
[4] feat(client)  ·  2 个文件  ·  ~620 tok
      apps/client/components/ForgeImport/ForgeImportModal.vue
      apps/client/composables/forge/useForgeJob.ts
      → node .../opencommit/out/cli.cjs -y -c "本次仅提交 feat(client) 类改动,共 2 个文件"
[5] fix(api)  ·  1 个文件  ·  ~90 tok
      apps/api/src/course-pack/course-pack.service.ts
      → node .../opencommit/out/cli.cjs -y -c "本次仅提交 fix(api) 类改动,共 1 个文件"
...
注意事项:
  ! OCO_GITPUSH=true:去掉 --dry-run 真正执行时,commitslice 会在每次 oco 调用时临时禁用 push。
dry-run:未做任何 git add / commit / oco 调用。去掉 --dry-run 即真正提交。
```

> 同一个 `feat` 类型里,`apps/api` 与 `apps/client` 的改动分别归入 `feat(api)` 与 `feat(client)`;api 的 `fix` 单独成 `fix(api)`——符合 Conventional「一条 commit 一个 type」规范,同时按模块归类。根级文件(如 `README.md`)无模块归属,scope 为空,文案由 oco 自行决定。

---

## 命令行参数

| 参数 | 说明 | 默认 |
| --- | --- | --- |
| `--repo <path>` | 目标仓库路径 | 当前目录 |
| `--dry-run` | 只预览分组和将执行的命令,不做任何 `git add` / `oco` 调用 | 关(默认直接 apply) |
| `--no-llm` | 不调模型,仅用规则分类 | 关 |
| `--no-prescreen` | 关闭路径级预筛:lock/生成物/产物/快照也照常读 diff、走模型摘要与分类 | 关(即预筛默认开启) |
| `--max-tokens-per-commit <n>` | 单条 commit 的 diff token 上限;超过则把该分类打回模型细分 | 按 oco 预算推导(`OCO_TOKENS_MAX_INPUT − prompt − output`) |
| `--max-resplit-rounds <n>` | 单个分类被打回细分的最大轮数 | 2 |
| `--prompt-reserve <n>` | 预算推导时为 oco prompt 预留的 token 数(仅未显式指定 `--max-tokens-per-commit` 时生效) | 800 |
| `--concurrency <n>` | 逐文件摘要并发数 | 4 |
| `--max-summaries <n>` | 最多对前 n 个文件调模型摘要 | 全部 |
| `-h`, `--help` | 显示帮助 | — |
| `--version` | 显示版本 | — |

退出码:`0` 正常,`1` 出错。

---

## 工作原理

1. **路径级预筛**(`src/prescreen.js`,在任何内容读取之前):只按路径判定四类无信息量文件——依赖锁 `lock`、构建产物 `artifact`、生成代码 `generated`、测试快照 `snapshot`,并识别其生态(Node/Rust/Go/Python/Ruby/PHP/Flutter/Swift/.NET/Elixir/JVM…)。命中的文件**不读内容**(不调 `git diff`、不 `readFileSync`),按「类别 × 生态」分成若干组,每组直接用固定 message 提交,完全不进模型。清单文件(`package.json`/`go.mod`/`Cargo.toml`/`pyproject.toml`/`requirements.txt`/`Podfile`/`build.gradle` …)不在其列。用 `--no-prescreen` 可关掉这一步。
2. **提取特征**(`git diff HEAD`):`--numstat` 增删行、`--name-status -M -C` 改动类型/重命名、`-U0` 的 `@@` hunk 头近似函数名(v1 简化 symbol,不做 AST)、扩展名→文件类型、目录;并处理**未跟踪新文件**与**二进制文件**。
3. **逐文件摘要**:把每个文件的特征(+少量 diff)交给 Ollama `/api/chat`,产出一句话变更意图。并发+超时,失败自动跳过。
4. **分类(类型 × 模块 scope)**:把全部文件的清单(每文件一行轻量元数据,体积小,可一次全量喂入)交给 Ollama,按 Conventional 类型聚类返回 JSON;解析失败/漏分的文件用规则兜底。**scope 不走模型**,由 [src/scope.js](src/scope.js) 按路径确定性派生:`apps`/`packages`/`libs`/`src` 等包装目录取其后的第二段(`apps/api`→`api`、`src/<模块>`→`<模块>`),普通顶层目录取第一段(`scripts/x.sh`→`scripts`),根级文件与单段 `src/<file>` 取空。最终按 `(类型, scope)` 成桶,**一个桶 = 一条 commit**;`commitContext` 把桶的 scope 稳定透传给 `oco -c`,使 message 的 `<type>(<scope>)` 规整而非 oco 猜测。
5. **token 预算细分**:每个 `(类型, scope)` 桶用与 oco 相同的 `@dqbd/tiktoken` cl100k_base 统计全部文件 diff 的 token 数;若超过单条预算,把该桶的文件清单**打回模型要求细分成更小的同桶子组**(最多 `--max-resplit-rounds` 轮),直到每个子组达标(细分只按 token,类型与 scope 不变,并倾向把同目录文件聚拢)。单文件自身超限、无模型、或模型不再细分时,**保留为整条交给 oco 自身 token 拆块**(不截断、不丢文件)。预算 = `OCO_TOKENS_MAX_INPUT − 调整因子 − prompt 预留 − OCO_TOKENS_MAX_OUTPUT`,与 oco 内部 `MAX_REQUEST_TOKENS` 对齐,避免 oco 再截断。
6. **逐批提交**:预筛组排在最前,`git reset` → `git add` 该批 → `git commit -m` 固定 message(**不调 oco**,否则 oco 会把这些巨型 diff 重新读一遍);其余每批 `git reset` → `git add` → `oco -y` 生成并 commit。

### 预筛覆盖范围

判定只看路径(规则在 `src/prescreen.js`),命中后按「类别 × 生态」成组,一个组 = 一条 commit。

| 类别 | commit type | 典型文件 |
| --- | --- | --- |
| `lock` 依赖锁 | `chore(deps)` | `package-lock.json`、`yarn.lock`、`pnpm-lock.yaml`、`npm-shrinkwrap.json`、`bun.lock(b)`、`deno.lock`、`Cargo.lock`、`go.sum`、`poetry.lock`、`Pipfile.lock`、`uv.lock`、`Gemfile.lock`、`composer.lock`、`pubspec.lock`、`Podfile.lock`、`Package.resolved`、`packages.lock.json`、`mix.lock`、`renv.lock`,以及任意 `*.lock` / `*.lockfile` / `*.lock.yaml` |
| `artifact` 构建产物 | `chore` | `dist/`、`build/`、`out/`、`.next/`、`node_modules/`、`vendor/`、`coverage/`、`target/`、`__pycache__/`、`*.egg-info/`,以及 `*.min.js` / `*.min.css` / `*.map` / `*.pyc` / `*.class` / `*.jar` / `*.dll` / `*.wasm` 等 |
| `generated` 生成代码 | `chore` | `*.pb.go`、`*_pb2.py`、`*.generated.ts`、`*_generated.go`、`*.freezed.dart`、`*.designer.cs`、`wire_gen.go`,以及 `__generated__/`、`generated/` 目录下文件 |
| `snapshot` 测试快照 | `test` | `__snapshots__/*.snap`、`*.snap`、`*.snapshot` |

**刻意不预筛**:`package.json`、`go.mod`、`Cargo.toml`、`pyproject.toml`、`requirements.txt`、`Gemfile`、`composer.json`、`Podfile`、`build.gradle`、`pom.xml`、`Package.swift` 等清单文件,以及一切手写源码/文档——它们小,且携带「为什么改」的信息。

---

## 它如何调用 opencommit(oco)

- commitslice 与 vendored 的 opencommit 现在是**同一个 npm 包**(`@tmname1/commitslice`),没有包间依赖。运行时由 [src/resolveOco.js](src/resolveOco.js) 从自身安装位置向上查找同包内的 `opencommit/out/cli.cjs`,再用 `node ... -y [-c <类别说明>]` 调用它。
- 传给 `oco -c` 的「类别说明」只是给 oco 的额外上下文;最终文案完全由 oco 按 `~/.opencommit` 生成。
- commitslice 自己的「摘要/分类」走 Ollama,且**复用 `~/.opencommit` 里的 `OCO_MODEL`/`OCO_API_URL`**,与 oco 命中同一个本地模型,口径统一。

---

## 配置说明

commitslice **没有自己的配置文件**,也不新增 message 相关开关。它只读取 oco 的 `~/.opencommit`:

- 影响 commitslice 自身(模型调用):`OCO_AI_PROVIDER`、`OCO_MODEL`、`OCO_API_URL`。
- 影响最终文案(由 oco 决定的部分,例如):`OCO_LANGUAGE`、`OCO_PROMPT_MODULE`、`OCO_ONE_LINE_COMMIT`、`OCO_EMOJI`、`OCO_DESCRIPTION` 等。
- `OCO_LANGUAGE` 还决定**预筛组固定 message** 的语言:解析为中文简繁别名(`zh_CN`/`简体中文`/`繁體中文`…)时输出中文,其余一律英文。这是 commitslice 唯一自己写的文案。

想改文案风格,请用 `oco config set ...`,不要在本工具里加参数。

---

## 安全与边界

- **默认 apply**:直接 `git add` / `oco` 逐条提交;预览请用 `--dry-run`,它不做任何 `git add` / `oco` 调用、不改历史。
- **不会自动 push**:即使 `OCO_GITPUSH=true`,apply 也会在每次调用 oco 的进程里用环境变量临时置为 `false`,且不修改你的全局配置。
- **重命名原子化**:某批含重命名时,会连同其来源路径一起 `git add`,避免出现「只加了新文件、没删旧文件」的重复。
- **需要 `HEAD`**:仓库还没有任何提交时,commitslice 会提示你先建一次基线提交。
- **预筛组照常走 Git hooks**:固定 message 用普通 `git commit` 提交,不加 `--no-verify`,你的 commit-msg / pre-commit 校验依旧生效。
- **预筛不丢内容**:被预筛的文件只是「不喂模型」,仍然完整 `git add` 并提交;想恢复旧行为(全读、全走模型)用 `--no-prescreen`。
- **降级**:Ollama 不可达 / 模型返回不规范时,分类回退到规则(`.md`/docs→docs、test/spec→test、依赖/配置→chore、新增→feat、修改→fix)。

---

## 常见问题

- **运行 `npx commitslice` 却看到 `Track your git commits automatically` / `config/init/status/sync/features` 这些命令** — 你命中的是 npm 上同名的**第三方包**,不是本仓库. 本仓库的 commitslice 命令组是 `--dry-run / --repo / --no-llm / --max-tokens-per-commit` 等. 解决办法(优先顺序):发布版请用 `npx @tmname1/commitslice`;本地开发时,在仓库根运行 `npx commitslice`,或改用 `node D:/commitkit/commitslice/src/index.js`,或 `npm link` 后直接 `commitslice`.
- **「未找到 opencommit 的 oco CLI」**:apply(默认模式)时报此错,说明 `opencommit/out/cli.cjs` 不存在——它是 git-ignored 的构建产物。在仓库根跑 `npm run build`(或一次 `npm run setup`)即可。从 npm 安装的版本不会出现这个问题,该产物已随包发布。
- **「仓库还没有任何提交」**:先 `git commit` 一次基线,再运行 commitslice。
- **摘要很慢**:文件很多时可调大 `--concurrency`,或先用 `--max-summaries <n>` 抽样,或 `--no-llm` 走规则。
- **`package-lock.json` 被单独提成一条 `chore(deps)`**:这是预筛的预期行为——它的 diff 动辄几万 token,读完也无法 summarize 出意图。若你确实想让它和 `package.json` 一起由 oco 生成一条 commit,加 `--no-prescreen`。
- **预筛把某个文件误判成生成物**:说明 `src/prescreen.js` 的规则表需要补(例如某个仓库把源码放在 `build/` 目录)。临时用 `--no-prescreen` 绕过,并反馈具体路径。
- **想把所有改动合成一条**:本工具的目的就是拆分;若只要单条提交,直接用 `oco` 即可。
- **改提交风格(中文/英文、是否一行、Emoji 等)**:用 `oco config set`,commitslice 不接管这些。
