# Billionaire Incubator · Resume Agent Demo v0

AI 简历 Agent 的最初版 demo：CV + JD → 解析 → JD 匹配 → 缺口检测 → 针对性追问（JD 问题最多 3 题）→ 选材排序 → bullet 改写与事实校验 → 定制简历 → 质量评估。

核心想法：不是"AI 帮你改简历"，而是先把经历变成结构化、可验证的「经历库」，再针对具体 JD 匹配、找缺口、追问、改写。**AI 只能扩展表达，不能扩展事实。**

> 想让你的 AI 助手（Claude Code / Codex 等）读懂项目：它们会自动读根目录的 [AGENTS.md](AGENTS.md)（Claude Code 通过 `CLAUDE.md` 引入），里面会让它接着读 [docs/给AI的项目说明.md](docs/给AI的项目说明.md) 和 `CHANGELOG.md`。

## 第一次在自己电脑上跑起来

### 1. 需要先安装

- **Node.js 20.9 或更新**（装好后在终端输入 `node -v` 能看到版本号）：https://nodejs.org 。运行 `tests/` 下的回归脚本需要 Node 24+。
- **git**：https://git-scm.com （或者用 GitHub Desktop 代替命令行：https://desktop.github.com ）

### 2. 把项目下载到本机

仓库是私有的，需要 Paxton 先邀请你为协作者，并且你已登录 GitHub。

```bash
git clone https://github.com/chrisguo777/billionaire-incubator.git
cd billionaire-incubator
```

### 3. 安装依赖并启动

```bash
npm install
npm run dev
```

浏览器打开 http://localhost:3000 ，点「解析并分析」。

### 4. 接入 Anthropic API

1. 把 `.env.example` 复制为项目根目录的 `.env.local`。
2. 设置 `LLM_PROVIDER=anthropic`、`LLM_MODE=live`，在 `ANTHROPIC_API_KEY=` 后填写自己的密钥。可选 `ANTHROPIC_MODEL` 覆盖现有默认模型。
3. 重启 `npm run dev -- --hostname 127.0.0.1`，刷新页面。未填写密钥时，页面显示「Anthropic API · 待配置密钥」；填写后显示「LIVE · Anthropic API」。

显式选择 Anthropic 但缺少密钥时会提示配置，不会静默返回 mock 数据。`LLM_MODE=mock` 可单独启用内置示例；未指定提供方且没有密钥时仍使用 mock。

注意：
- `.env.local` 已被 git 忽略；密钥只填写在本机配置中。
- 真实模型按 API 账户计费；本地代码规则、审阅和图表展示不调用模型。
- 页面状态只保存在浏览器里，刷新页面会丢失。

## 两种模式

- **MOCK**：内置示例逻辑，**不读你粘贴的内容**，永远返回同一份示例数据。
- **LIVE / Anthropic**：`LLM_PROVIDER=anthropic`，使用 Anthropic API key。可选 `ANTHROPIC_MODEL` 覆盖默认模型；`LLM_MODE=mock` 可强制使用内置示例。

## 开发规则：在自己的 branch 上做

`main` 分支受保护，**不能直接推送**，所有改动都通过自己的 branch 和 Pull Request 合并。

```bash
git checkout main
git pull
git checkout -b 你的名字/做什么      # 例如 ziyue/ats-rules
```

改完之后：

```bash
git add -A
git commit -m "简短说明你改了什么"
git push -u origin 你的名字/做什么
```

然后在 GitHub 页面点「Compare & pull request」发起合并请求，由 Paxton 看过再合并。用 GitHub Desktop 的话，对应操作是 Current Branch → New Branch，改完 Commit，再 Push / Create Pull Request。

不确定怎么做时，可以让你的 AI 助手帮你完成这些步骤，但提交和推送要由你明确下指令。

## 文档

| 文件 | 给谁看 | 内容 |
|---|---|---|
| `README.md` | 新成员 | 本文：项目是什么、怎么跑起来、怎么提交 |
| [AGENTS.md](AGENTS.md)（`CLAUDE.md` 只是引入它） | 所有 AI 助手 | 项目规则、常用命令、架构要点 |
| [CHANGELOG.md](CHANGELOG.md) | 所有人 | 每次合并了什么、验证到什么程度、已知问题和尚未实现的部分 |
| [docs/给AI的项目说明.md](docs/给AI的项目说明.md) | AI 助手（人也可以读） | 项目目标、团队、已拍板与未拍板的事项、代码地图 |
| [docs/功能规则.md](docs/功能规则.md) | 开发者 | 审阅、评分、排序、经历保留、补足三段经历等功能的详细行为 |
| [docs/workflow-v1.md](docs/workflow-v1.md) | 设计讨论 | workflow 逐步说明（设计草案） |
| [docs/schema-v1.md](docs/schema-v1.md) | 设计讨论 | 经历库 schema 合并草案（未经团队确认） |

代码结构见 `AGENTS.md` 的「架构要点」和 `docs/给AI的项目说明.md` 第 6 节；进度和已知问题见 `CHANGELOG.md`；尚未实现、还没拍板的功能见 `docs/给AI的项目说明.md` 的「未拍板」。
