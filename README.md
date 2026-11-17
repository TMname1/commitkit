# commitkit · `@tmname1/commitslice`

一个包，两个命令：把一大堆未提交的改动智能拆分成多条规范的 Conventional Commit。

| 命令 | 作用 |
| --- | --- |
| `commitslice` | **拆分器**：决定"哪些文件归为一条 commit"。流程是路径级预筛（lock/生成物按元数据分组、不走模型）→ 逐文件摘要 → 按 Conventional 类型 + 模块 scope 分类 → 每个 `(类型, scope)` 桶 `git add` 后调用 `oco` 生成 message。默认直接 apply，`--dry-run` 只预览。详见 [commitslice/README.md](commitslice/README.md)。 |
| `oco` / `opencommit` | **文案生成器**：vendored 的上游 [OpenCommit](opencommit/)，负责实际生成 commit message。commitslice 的文案语言、格式、Emoji、scope、Provider 全部沿用它的配置（`~/.opencommit`）。 详见 [opencommit/README.md](opencommit/README.md)。|

---

## 如何使用

### 方式一：npx / 全局安装（发布版，任意目录可用）

```bash
npm i -g @tmname1/commitslice   # 全局安装，之后任何目录直接敲 commitslice / oco
npx @tmname1/commitslice        # 免安装，一次性运行（任意目录）
```

> ⚠️ **不要写裸 `npx commitslice`**——不带 scope 会命中 npm 上另一个同名第三方包（"Track your git commits automatically"）。

### 方式二：本地源码（先 build，再用 commitslice）

不想用发布版、而是直接跑本地仓库时，在**仓库根**先构建一次：

```bash
cd D:/commitkit
npm run setup        # = npm install + npm run build，产出两个入口的构建产物
```

`build` 会生成两个产物：`opencommit/out/cli.cjs`（含 wasm）和 `commitslice/dist/commitslice.js`。装好后仓库内的入口是根脚本包装器（不碰 registry，最安全）：

```bash
npm run commitslice -- --dry-run                          # 预览 commitkit 自己的改动分组
npm run commitslice -- --repo /path/to/你的仓库 --dry-run  # 预览别的仓库
npm run commitslice --                                    # 默认 apply：逐批 reset→add→oco
npm run oco -- config describe                            # 等价于 oco config describe
```

> 两种入口的差别：`npm run commitslice` 跑源码 `commitslice/src/index.js`（改完即生效）；`npx commitslice`（仅在仓库根安全）跑构建产物 `commitslice/dist/commitslice.js`（改完源码要先 `npm run build`）。

想让 `commitslice` / `oco` 在**任意目录**直接敲命令名（可选），在仓库根再跑一次：

```bash
npm link    # 一份清单，一次 link 同时链出 commitslice / oco / opencommit 三个命令
```

---

## 配置 oco（commitslice 复用它）

commitslice **不新增任何文案配置**——语言、格式、Emoji、scope、Provider 全由 `oco` 决定，存放在 `~/.opencommit`（仓库内 `.env` 优先级更高），改一次即对 commitslice 与 `oco` 同时生效。

```bash
oco config describe                       # 列出全部配置项与可选值
oco config set OCO_LANGUAGE=zh_CN OCO_EMOJI=false
oco setup                                 # 交互式向导，自动拉取 provider 可用模型

# 本地 Ollama（commitslice 默认场景，无需 API Key）
oco config set OCO_AI_PROVIDER=ollama OCO_MODEL=llama3:8b OCO_API_URL=http://localhost:11434/api/chat
# OpenAI 兼容（默认 provider）
oco config set OCO_API_KEY=<your_api_key> OCO_MODEL=gpt-4o-mini
```

未 link 时，把上面的 `oco ...` 换成 `npm run oco -- ...`、`npx oco ...`（仅仓库根）或 `node opencommit/out/cli.cjs ...`。

> commitslice 自身的摘要/分类直接复用 `OCO_AI_PROVIDER` / `OCO_MODEL` / `OCO_API_URL`，与 oco 走同一模型；并从安装位置向上查找**同包内**的 `opencommit/out/cli.cjs`，因此**不装任何全局包也能正常 apply**。
>
> 完整配置项与所有 provider：[opencommit/README.md](opencommit/README.md)（vendored 上游文档，其中的包名/安装命令属于上游项目，不代表本包的发布方式）· commitslice 侧的调用与 token 预算：[commitslice/README.md](commitslice/README.md)。

## 前置条件

- Node.js ≥ 20（用到内置 `fetch`）。
- 目标仓库是 git 仓库，且已有一次提交（存在 `HEAD`）。
- 本地模型（Ollama）在跑并完成上面 oco 配置；模型不可达时 commitslice 不报错，自动降级为规则分类，仍可预览。
