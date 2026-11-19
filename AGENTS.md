# Billionaire Incubator

AI 简历 Agent 项目，v1.0 由四人团队在 2026 年 9–11 月完成，每个人的贡献见 `README.md`。团队协作阶段已于 2026 年 11 月结束，本仓库是公开的 v1.0 版本。流程设计见 `docs/workflow-v1.md`，经历库 schema 草案见 `docs/schema-v1.md`。

本文件是所有 AI 助手（Claude Code、Codex 等）共用的项目说明；Claude Code 通过 `CLAUDE.md` 引入本文件。个人协作习惯放在自己电脑上的用户级配置里，不写进仓库。

## 开始前先读

1. `README.md`：项目是什么、怎么工作、当前局限和每个人的贡献。
2. `CHANGELOG.md` 最上面一段：最近合并了什么、验证到什么程度、还有哪些已知问题。

文档与代码不一致时以代码为准，并告诉用户。

开始工作前先 `git pull` 拿最新 main；依赖有变化时要 `npm install`。

## 要点

- 本项目是 AI 简历 Agent；原则：**AI 只能扩展表达，不能扩展事实**；简历只用"已确认"的事实；缺口状态由代码规则判断。
- 用中文回复；提到流程步骤或字段时带上名字和一句话解释，不要只用编号。
- 没有用户明确要求，不要 commit、不要 push、不要安装额外依赖。
- 不要把 API key 写进任何会被提交的文件；key 只放在 `.env.local`。不要读取 `.env.local` 的内容，需要确认配置时只看变量名，不显示值。

## 常用命令

```bash
npm install
npm run dev         # http://localhost:3000
npm run build
npm run typecheck   # tsc --noEmit；项目没有 lint，也没有测试框架
node tests/bullet-review.cjs   # tests/ 下的回归脚本逐个手动运行（需要 Node 24+）
```

- 模型配置写在 `.env.local`（模板见 `.env.example`），改完必须重启 `npm run dev`：
  - `.env.example` 默认带 `LLM_PROVIDER=anthropic`：照模板复制但没填 `ANTHROPIC_API_KEY` 时会报错提示，不会静默进入 mock。
  - 完全没有配置，或设置 `LLM_MODE=mock`（有 key 也生效），进入 **MOCK 模式**：不读用户输入，永远返回 `lib/mock.ts` 的示例数据。
  - 可选 `ANTHROPIC_MODEL`（默认 `claude-opus-5-5`）。目前只支持 Anthropic。
- `tests/` 下的脚本不调用付费 API，`tests/evaluation/` 里的重复评估脚本除外。`tests/experience-discovery.cjs` 在「补足三段经历」关闭期间会失败（CHANGELOG 已知问题 13），其余应通过。
- Next.js 版本较新，与训练数据可能不一致；写 Next 相关代码前先读 `node_modules/next/dist/docs/`。本文件末尾的 nextjs-agent-rules 块由 `next dev` 自动生成和维护，保留即可，不要手动改。
- 路径别名 `@/` 指向仓库根目录（如 `@/lib/pipeline`）。

## 架构要点

这是一个**固定流程的 workflow，不是自主 agent**：控制流在代码里，模型只负责理解和生成。需要同时读几个文件才能看清的部分：

- **无状态后端，状态在浏览器**：`app/api/step/route.ts` 是唯一业务入口，用 `body.step` 分发（`parse` / `jd` / `analyze` / `question` / `answer` / `finish` / `review` / `evaluate`）。每次请求都由 `app/page.tsx` 把完整的 `db`、`jd`、`gaps`、`asked`、`history` 等带上来，服务端不存任何东西，刷新页面即丢失。
- **其他接口**：`app/api/resume/route.ts` 上传 PDF / Word / TXT 并提取文字（`app/api/pdf/route.ts` 是旧的兼容入口）；`app/api/job/route.ts` 从岗位链接读取完整 JD；`app/api/company/route.ts` 公司名补全。
- **`lib/pipeline.ts` 把两类步骤放在一起**：AI 步骤（`parseCV`、`analyzeJD`、`matchExperience`、`askQuestion`、`applyAnswer`、`rewriteBullets`）和纯代码规则步骤（`detectGaps`、`pickGap`、`rankCards`、`checkBullet`、`assembleResume`）。缺口状态（Covered / Weak / Unknown / True Gap）、选哪个问题、卡片排序、bullet 事实校验都**必须留在代码里**，不要交给模型判断。
- **`lib/llm.ts` 的 `callStructured(schema, system, user, effort)`** 是所有 AI 调用的唯一出口：用 Zod schema 做结构化输出并校验；`getMode()` 决定 live / mock。除 `lib/pipeline.ts` 外，质量评估（`lib/evaluation.ts`）、补足经历追问（`lib/experience-discovery.ts`）和岗位页面提取（`lib/job-sources.ts`）也走它。输出不符合 schema、或可选参数 `check` 报错时自动重试，一共最多 3 次（#22）。新增 AI 步骤时，要在 `lib/mock.ts` 里补对应的 mock 分支，否则无 key 时会断。
- **`lib/schema.ts` 是类型与 Zod schema 的唯一来源**。经历库层级：affiliation → card → field，每个事实带状态（`user_confirmed` / `ai_inferred` / `missing`）和出处。`docs/schema-v1.md` 的合并草案比代码多几个字段，以代码为准，改 schema 前先问用户。
- **事实 id 贯穿全流程**：匹配和改写必须引用事实 id（`indexFacts` 建索引）；`detectGaps` 丢弃不存在的 id、只认"已确认"的证据；`checkBullet` 拦截无来源、引用未确认事实、或数字不在所引事实里的 bullet。这是"AI 只能扩展表达，不能扩展事实"的落点，改动这几处要格外谨慎。
- 对话里得到的数字类成果先标"待确认"，用户点确认后才能进简历；JD 针对性追问最多 3 题（前端 `app/page.tsx` 的 `MAX_QUESTIONS` 计数，后端 `question` 步骤里另写死了 `>= 3`，改上限时两处都要改）。
- 「补足三段经历」追问已实现但暂时关闭：`lib/experience-target.ts` 的 `TARGET_EXPERIENCES = 0`（原为 3）。这类追问不占 3 题名额；是否重开尚未决定。

## 分支与合并

- `main` 受保护，不能直接推送。改动在单独的分支上开发（命名 `名字/做什么`），通过 Pull Request 合并。开始改动前先确认当前不在 `main` 上。
- 每次合并后，在 `CHANGELOG.md` 最上面加一段，写清改了什么、验证到什么程度、还有哪些已知问题，并附上 PR 编号。
- 版本用 git 标签标记，团队完成的版本是 `v1.0`。

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
