# Billionaire Incubator · Resume Agent Demo v0

AI 简历 Agent 的最初版 demo：CV + JD → 解析 → JD 匹配 → 缺口检测 → 针对性追问（JD 问题最多 3 题，经历不足时另行补充）→ 选材排序 → bullet 改写与事实校验 → 定制简历。

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

### 4. 接入 Anthropic API

1. 把 `.env.example` 复制为项目根目录的 `.env.local`。
2. 设置 `LLM_PROVIDER=anthropic`、`LLM_MODE=live`，在 `ANTHROPIC_API_KEY=` 后填写自己的密钥。可选 `ANTHROPIC_MODEL` 覆盖现有默认模型。
3. 重启 `npm run dev -- --hostname 127.0.0.1`，刷新页面。未填写密钥时，页面显示「Anthropic API · 待配置密钥」；填写后显示「LIVE · Anthropic API」。

显式选择 Anthropic 但缺少密钥时会提示配置，不会静默返回 mock 数据。`LLM_MODE=mock` 可单独启用内置示例；未指定提供方且没有密钥时仍使用 mock。

注意：
- `.env.local` 已被 git 忽略；密钥只填写在本机配置中。
- 真实模型按 API 账户计费；本地代码规则、审阅和图表展示不调用模型。
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
- **LIVE / Anthropic**：`LLM_PROVIDER=anthropic`，使用 Anthropic API key。可选 `ANTHROPIC_MODEL` 覆盖默认模型；`LLM_MODE=mock` 可强制使用内置示例。

## 代码结构

| 文件 | 作用 |
|---|---|
| `lib/schema.ts` | 经历库类型与各步骤的 Zod 输出 schema（见 `docs/schema-v1.md`） |
| `lib/pipeline.ts` | 各步骤逻辑：AI 步骤（解析、JD 分析、匹配、提问、抽取、改写）和代码规则步骤（缺口检测、选问题、排序、事实校验） |
| `lib/resume-doc.ts` | 简历的结构化表示；Markdown 和网页预览 / PDF 用的 HTML 都从这里生成 |
| `lib/resume-docx.ts` | 把简历生成 Word（.docx），在浏览器里运行 |
| `lib/llm.ts` | Anthropic API 调用、结构化输出与 live/mock 模式选择 |
| `lib/mock.ts` | 无 Key 时的内置示例逻辑 |
| `lib/language.ts` | 语言规则：识别简历目标语言、检查非目标语言内容、按语言给出章节标题 |
| `lib/experience-target.ts` / `lib/experience-discovery.ts` | 三段经历目标、补充追问与回答抽取；确认没有其他经历后允许按现有数量继续 |
| `app/api/step/route.ts` | 无状态 API，状态由前端持有 |
| `app/api/resume/route.ts` | PDF / Word（.docx）/ TXT 上传并提取文字（≤10MB）；PDF 用 unpdf，Word 用 mammoth，TXT 支持 UTF-8、带 BOM 的 UTF-16 和 GB18030，结果填回文本框供检查 |
| `app/api/pdf/route.ts` | 原上传接口的兼容入口 |
| `app/page.tsx` | 单页演示界面（每一步标注由「AI 模型」「代码规则」还是「你」完成） |

## 已实现的关键规则

- 简历只使用「已确认」的事实；对话里得到的数字先标「待确认」，需用户点确认。
- 缺口状态由代码规则判断（Covered / Weak / Unknown / True Gap），不让 AI 拍板；用户回答"没有"优先于 AI 的匹配结果。
- 改写后的每条 bullet 必须标注来源事实，且其中的数字必须出现在所引用的已确认事实里，否则被拦截。
- 每条审阅项对应原简历的完整 bullet，保留分句和换行续写；原句单独保存，不从拆分后的事实片段拼回。相同经历中的重复原句和同一来源的重复建议只出现一次。
- 审阅区只显示文本实际变化或追问新增的建议；与原句相同、仅换行或多余空格不同的条目自动保留，隐藏其审阅卡片和操作按钮，也不计入「已接受」。大小写、标点和措辞变化仍可审阅。筛选不删除缓存中的原句，不改变其他条目的稳定 id。
- 未操作、撤回选择、或仅保存编辑时保留原句；只有「接受这条」且校验通过才替换。「排除这条」删除整条。追问补充的新增建议需接受后才加入；被拦截的改写回退原句。
- 不同原句的改写或编辑发生重复时，保留对应原句并提示重新编辑，不会因去重而丢掉原始内容。复制和质量评估使用当前预览中的原句与已接受改写。

不调用模型的回归检查：`node tests/api-provider.cjs`、`node tests/bullet-review.cjs`、`node tests/resume-order.cjs`、`node tests/evaluation/validation.cjs`（Node 24+）。旧页面结果需重新点一次「生成简历」补齐完整原句，保留追问记录；刷新页面会丢失当前会话。

## 评分可视化与总分

质量评估结果顶部用两个圆环并排显示原始／修改后加权总分（100 分制），下方六项指标分别用双层圆环展示（内环原始、外环修改后，每项满分 3 分），同时保留具体分数、分差与权重。每项可跳到原有评分理由和引用依据；无变化、下降和暂不评分都会如实展示。缺失评分使用虚线圆环，零分使用实线空环，两者不会混淆。移动端采用紧凑横排卡片。没有新增依赖或模型调用，计算方式和权重保持不变。

本版经用户确认的权重在 `lib/score-comparison.ts` 的 `SCORE_WEIGHTS`：岗位匹配 25%、个人贡献 15%、方法与工具 15%、成果与证据 15%、表达清晰度 10%、事实一致性 20%。这是产品配置，尚未经过人工样本校准。

总分 = Σ（维度分数 × 权重）÷ Σ（参与计算的权重）÷ 3 × 100，保留一位小数；分差使用两个已显示总分的差。只有前后都能评分、且权重大于零的维度参与两个总分，缺失维度同时从双方排除，并重新归一化权重。界面标明参与项数和未计入的维度，没有可比维度时不显示总分；不把缺失评分当成零分。事实风险继续独立展示。

修改简历或审阅选择后，旧评估及其图表一同失效，需重新评估。计算回归：`node tests/score-comparison.cjs`（不调用模型）。

## 文档

- [docs/给AI的项目说明.md](docs/给AI的项目说明.md)：项目全貌、进度、已拍板/未拍板、已知问题
- [docs/workflow-v1.md](docs/workflow-v1.md)：workflow 逐步说明
- [docs/schema-v1.md](docs/schema-v1.md)：经历库 schema 合并草案（未经团队确认）
- [docs/项目进度汇总.md](docs/项目进度汇总.md)：Google Drive 文档汇总与各作者文档的出入

## 尚未实现

扫描件/图片版 PDF 的 OCR（目前只支持可复制文字的 PDF）、联系方式、数据库持久化（状态只在浏览器里）、拖拽组装、追问停止条件的最终方案。

## 简历经历排序

生成简历时可选择「按 JD 匹配度」或「按经历时间」。默认按 JD 匹配度；时间模式为最近经历在前，正在进行的经历优先，其余先比较结束时间，再比较开始时间，未知日期放最后，同日期按 JD 得分排序。项目沿用所属经历日期；教育和技能章节保持原有顺序。是否保留由用户勾选决定，排序只调整展示顺序。

生成后切换排序保留已接受的 bullet、手动编辑和经历保留选择，不重新调用模型；审阅区、复制的 Markdown 和质量评估使用同一顺序。排序或保留选择变更会使已有质量评估失效。

## 证据提示与经历保留

全部经历默认保留，匹配得分为 0、证据不足或超过 4 段均不会自动落选。「经历排序与保留」显示已有匹配证据、证据不足或暂无匹配证据，并提供勾选框。取消勾选会移出最终简历；重新勾选恢复原来的编辑与接受选择，不调用模型。技能章节单独处理。

匹配证据的强弱只影响排序和提示。选择保留经历不会确认待确认成果，也不会自动接受追问新增的 bullet；新增描述仍需逐条接受后才写入简历。复制和质量评估均使用当前勾选与逐条审阅后的预览稿。

回归检查：`node tests/resume-selection.cjs`。

## 三段经历目标与补充追问

尽量保留至少三段有内容的经历，实习、课程小组作业、课程项目、个人项目和研究等都可以计入。技能列表、空卡片和重复的原简历内容不计为新增经历。

不足三段时优先进入「补充经历」追问，围绕 JD 提示用户回忆未写进简历的相关经历。这部分不占原有最多三题的 JD 追问名额。只回答「有」或只给一个项目名称时，先追问本人/团队具体做了什么，不创建空经历；已经记录过的经历只补充细节，不重复凑数。只说「没有实习」仍会继续询问课程或小组项目。

达到三段，或用户明确表示没有其他可补充经历后，结束补充追问。确实没有时允许按现有一两段生成，界面显示说明，不强制三段。取消勾选至不足三段时也会触发这一流程；可以恢复已有经历或确认按现有数量继续。

新经历中的描述仍需逐条接受，成果仍需确认。最终预览按真正有描述的经历计数，未接受的新增描述不会算进最终三段。补充后重新生成会保留已有接受和编辑记录。用户确认没有其他经历前，不足三段的预览会提示先接受/恢复描述；确认没有后可以按当前预览复制和评估。

不调用付费模型的回归检查：`node tests/experience-discovery.cjs`。
