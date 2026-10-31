# Billionaire Incubator · Resume Agent Demo v0

AI 简历 Agent 的最初版 demo：CV + JD → 解析 → JD 匹配 → 缺口检测 → 针对性追问（最多 3 题）→ 选材排序 → bullet 改写与事实校验 → 定制简历。

核心想法：不是"AI 帮你改简历"，而是先把经历变成结构化、可验证的「经历库」，再针对具体 JD 匹配、找缺口、追问、改写。**AI 只能扩展表达，不能扩展事实。**

> 想让你的 AI 助手（Claude Code / Codex 等）读懂项目：先让它读 [docs/给AI的项目说明.md](docs/给AI的项目说明.md)。

## 第一次在自己电脑上跑起来

### 1. 需要先安装

- **Node.js 20.9 或更新**（装好后在终端输入 `node -v` 能看到版本号）：https://nodejs.org
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

### 4. （可选）接入真实模型

默认没有 key 时是 **MOCK 模式**：只认识页面里预填的示例，用来演示流程。想用你自己的 CV 和 JD，需要 Anthropic API key：

1. 把 `.env.example` 复制一份，命名为 `.env.local`（放在项目根目录）。
2. 在 `.env.local` 里写 `ANTHROPIC_API_KEY=你的key`（不加引号）。
3. **停掉**正在运行的 `npm run dev`（Ctrl+C），再重新运行。页面标题旁显示 **LIVE** 就生效了。

注意：
- **`.env.local` 不会被提交到 git，不要把 key 贴到聊天、截图、代码或 GitHub 上。**
- 真实模型每跑一遍大约十几次调用，按量计费。
- 页面状态只保存在浏览器里，刷新页面会丢失。

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

## 两种模式

- **MOCK**：内置示例逻辑，**不读你粘贴的内容**，永远返回同一份示例数据。
- **LIVE**：调用 Anthropic API。可选 `ANTHROPIC_MODEL` 覆盖默认模型（默认 `claude-opus-5-5`）；`LLM_MODE=mock` 强制 mock。

## 代码结构

| 文件 | 作用 |
|---|---|
| `lib/schema.ts` | 经历库类型与各步骤的 Zod 输出 schema（见 `docs/schema-v1.md`） |
| `lib/pipeline.ts` | 各步骤逻辑：AI 步骤（解析、JD 分析、匹配、提问、抽取、改写）和代码规则步骤（缺口检测、选问题、排序、事实校验） |
| `lib/llm.ts` | 结构化输出调用（Anthropic SDK + Zod），live/mock 切换 |
| `lib/mock.ts` | 无 Key 时的内置示例逻辑 |
| `lib/resume-doc.ts` | 简历的结构化表示；Markdown 和网页预览 / PDF 用的 HTML 都从这里生成 |
| `lib/resume-docx.ts` | 把简历生成 Word（.docx），在浏览器里运行 |
| `lib/standards.ts` | 简历规范检查（动作动词开头、不用第一人称、长度、量化、篇幅、JD 关键词等），纯代码规则 |
| `app/api/step/route.ts` | 无状态 API，状态由前端持有 |
| `app/api/resume/route.ts` | PDF / Word（.docx）/ TXT 上传并提取文字（≤10MB）；PDF 用 unpdf，Word 用 mammoth，TXT 支持 UTF-8、带 BOM 的 UTF-16 和 GB18030，结果填回文本框供检查 |
| `app/api/pdf/route.ts` | 原上传接口的兼容入口 |
| `app/page.tsx` | 单页演示界面（每一步标注由「AI 模型」「代码规则」还是「你」完成） |

## 已实现的关键规则

- 简历只使用「已确认」的事实；对话里得到的数字先标「待确认」，需用户点确认。
- 缺口状态由代码规则判断（Covered / Weak / Unknown / True Gap），不让 AI 拍板；用户回答"没有"优先于 AI 的匹配结果。
- 改写后的每条 bullet 必须标注来源事实，且其中的数字必须出现在所引用的已确认事实里，否则被拦截。

## 文档

- [docs/给AI的项目说明.md](docs/给AI的项目说明.md)：项目全貌、进度、已拍板/未拍板、已知问题
- [docs/workflow-v1.md](docs/workflow-v1.md)：workflow 逐步说明
- [docs/schema-v1.md](docs/schema-v1.md)：经历库 schema 合并草案（未经团队确认）
- [docs/项目进度汇总.md](docs/项目进度汇总.md)：Google Drive 文档汇总与各作者文档的出入

## 尚未实现

扫描件/图片版 PDF 的 OCR（目前只支持可复制文字的 PDF）、联系方式、数据库持久化（状态只在浏览器里）、语言选择、拖拽组装、追问停止条件的最终方案。
