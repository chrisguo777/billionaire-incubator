# 给 AI 助手的项目说明

> 读者：加入项目的成员的 AI 助手（Claude Code、Codex 等）。请先读完本文，再动手。
> 最后更新：2026-11-02（合并 #6、#7、#9、#11、#12 之后）。以仓库里的文件为准；本文与代码不一致时，以代码为准，并告诉用户。
> **开始工作前先 `git pull` 拿最新 main，再读 `CHANGELOG.md` 最上面一段**：里面写了最近合并了什么、怎么验证的、还有哪些已知问题。

## 1. 项目是什么

四人团队（C = Christine，S = Shera，J = Jade，Paxton）在做一个**求职简历 Agent**。

核心想法：**不是"AI 帮你改简历"，而是先把用户脑子里零散的经历变成结构化、可验证的"经历库"，再针对具体 JD 做匹配、找缺口、追问，最后改写。AI 只能扩展表达，不能扩展事实。**

要解决的痛点（来自 Week2 会议和 5 份用户问卷）：不知道一段经历算什么能力；不知道该突出什么；团队项目说不清个人贡献；AI 会编数字、写得泛；不清楚岗位到底要什么。

### 证据强度（请诚实对待）

- 用户问卷只有 **5 份**，渠道主要是微信/同学圈，只能当假设来源，不能当结论。
- 竞品调研是 AI 整理的，厂商数据未核实，团队尚未亲手跑过 Huntr/Rezi。
- 不要把这些当作已验证的结论写进任何材料。

## 2. 团队与角色

- **Paxton**：Product Architecture + Prototype（最终 workflow、经历库 schema、可运行 demo）。
- 另三位成员（C、S、J）。Week2 任务里的「成员 A / B / C」与这三位怎么对应，**文档里没写清，不要自行假设**，请问用户。
  - 成员 A：ATS / Hiring Pipeline → 产出 ATS-friendly 简历生成规则 v1
  - 成员 B：Resume Benchmark → 产出 Resume Quality Rubric v1 + 中英文优秀简历
  - 成员 C：Competitor + Interview Design → 产出 Huntr/Rezi 实跑记录 + 追问框架（JD 要求 → 缺失证据 → 问题）
- 团队资料在 Google Drive 的「Billionaire Incubator」文件夹（会议纪要、Week2/问题概述.md、Shera 的产品框架、Christine 的开发逻辑图解、竞品调研、问卷记录等）。读取前先告诉用户要读哪个文件。

## 3. 流程（Paxton 的 workflow 方案，暂定，可灵活修改）

Paxton 的方案只是其中一种；C 和 S 的设计与它不完全一样。团队约定：开发过程中保持灵活，看哪种效果好再定。每步请用**名字**称呼，不要只用编号。

上传 CV → 简历解析 → 建初始经历库 → 输入目标 JD → JD 分析 → JD 与经历匹配 → 缺口检测（Covered / Weak / Unknown / True Gap）→ 针对性追问 → 更新经历库 →（追问后回到匹配，形成回环）→ 经历选择与排序 → Bullet 改写 → 生成定制简历。

经历库建一次，之后每个新 JD 从「输入目标 JD」开始循环。详细的输入/处理/输出见 `docs/workflow-v1.md`。

### 设计原则

1. **控制流由代码决定，AI 只做理解和生成。** v0 里没有任何一步让模型自己决定下一步（是 workflow，不是自主 agent）。
2. **简历只能用"已确认"的事实。** 缺口状态由代码规则判断，不让 AI 拍板。

## 4. 各步骤里，谁做什么

| 步骤 | AI 做 | 代码规则做 |
|---|---|---|
| 简历解析 | 把文字拆成经历 → 卡片 → 格子，并把每张卡片对应到完整的原句 | 分配 id；切分原句（`extractOriginalBullets`）；CV 内容一律标"已确认"、出处 cv_parse；用 Zod 校验格式 |
| JD 分析 | 把 JD 拆成带优先级的要求 | — |
| JD 与经历匹配 | 为每条要求找证据，必须引用事实 id | `detectGaps`：丢弃不存在的 id，只认"已确认"的证据 |
| 缺口检测 | — | 先看用户是否答过"没有"（→ True Gap）；有"我的动作"且卡片有已确认成果 → Covered；有证据但不满足 → Weak；否则 Unknown |
| 针对性追问 | 措辞成一句简短的问话（提示词要求 ≤3 句、约 80 字，不保证）；把回答整理成事实 | `pickGap`：只挑 Weak/Unknown 且没问过的，按优先级排，Weak 先于 Unknown；JD 问题最多 3 题；成果仍标"待确认"。「不足三段经历时另行补充追问」已实现但暂时关闭（`lib/experience-target.ts` 里 `TARGET_EXPERIENCES = 0`，见 CHANGELOG） |
| 经历排序与保留 | — | `rankCards` 按已确认的匹配证据加权排序，全部经历默认保留；证据不足只作提示（证据情况分三档：已有匹配证据 / 证据不足 / 暂无匹配证据），用户勾选决定保留哪些经历；顺序由用户选「JD 匹配度」或「经历时间」（`lib/resume-order.ts`） |
| Bullet 改写 | 对每条原句给一条改写建议（保持原语言，不需要改就保留原文），并标注来源 id；追问新增的内容另给新 bullet | `checkBullet`：无来源、引用未确认事实、出现来源里没有的数字，该条被拦截；用户未操作时简历保留原句，点「接受这条」才替换，「排除」才删除整条 |
| 生成简历 | — | `assembleResume`：先生成结构化的 `ResumeDoc`，Markdown、网页预览、PDF（浏览器打印）、Word 都从它生成，内容一致 |

## 5. 经历库 schema

- 合并草案见 `docs/schema-v1.md`：整合了 Paxton（问题概述）、Shera（产品框架·经历卡片）、Christine（开发逻辑图解·schema + 7 张表）三份设计。**尚未经 C、S 确认。**
- 结构：经历归属（affiliation）→ 卡片（card）→ 格子（field）；每个事实带状态（user_confirmed / ai_inferred / missing）和出处。个人行动与团队行动分开存。
- **文档与代码不一致**：`schema-v1.md` 里有 `decisions`、`collaboration`、`takeaways` 三个格子和 `source_message_ids`，`lib/schema.ts` 里还没有。以代码为准，并在改动前先问用户。

## 6. 代码地图与当前进度

技术栈：Next.js + TypeScript + Zod + Anthropic SDK。运行方式见 `README.md`。

- `lib/pipeline.ts`：各步骤逻辑；`lib/schema.ts`：类型与 Zod schema；`lib/llm.ts`：模型调用与 live/mock 切换；`lib/mock.ts`：无 key 时的假数据；`app/api/step/route.ts`：无状态 API，按 step 分发（parse / jd / analyze / question / answer / evaluate / review / finish）；`app/api/resume/route.ts`：上传 PDF / Word / TXT 并提取文字；`app/page.tsx`：单页界面（已标注每步由 AI / 代码规则 / 用户完成）。
- 其他模块：`lib/original-bullets.ts` 切分并保存原简历的完整 bullet；`lib/review.ts`、`lib/review-types.ts` 逐条审阅（接受 / 编辑 / 排除）后重新校验并组装简历；`lib/resume-order.ts`、`lib/resume-selection.ts` 经历排序方式与保留选择；`lib/resume-doc.ts`、`lib/resume-docx.ts` 结构化简历到预览 / PDF / Word；`lib/evaluation.ts`、`lib/evaluation-schema.ts` 简历质量评估（六个维度，引用由代码核验）；`lib/experience-target.ts`、`lib/experience-discovery.ts` 「补足三段经历」追问（目前关闭）；`lib/language.ts` 语言规则：识别简历目标语言、检查非目标语言内容、按语言给出章节标题。
- 语言：**沟通语言**由用户在第 1 节选（中文 / English），只决定追问用什么语言；**简历目标语言**在解析时根据上传简历自动识别，存在经历库的 `resume_language` 字段，用户可在第 2 节修改。回答抽取成事实、改写 bullet、最终简历章节标题都统一用目标语言；最终简历里不是目标语言的内容由代码列为警告（英文简历出现任何汉字；中文简历出现以英文为主的整句）。回归测试：`tests/language.cjs`。
- `tests/`：回归脚本，没有测试框架，手动运行，例如 `node tests/bullet-review.cjs`（需要 Node 24+；不调用付费 API，`tests/evaluation/` 里的重复评估脚本除外）。`tests/experience-discovery.cjs` 断言三段经历的行为，在该功能关闭期间会失败。
- **mock 模式不读用户输入**，只返回内置示例。想用真实 CV 和 JD 必须用 live（需要 `ANTHROPIC_API_KEY`）。
- live 模式已用真实 key 跑过：解析、匹配、追问、改写、逐条审阅、排序、预览与导出已手动走通（2026-11-02，Paxton 的会话）；评估在 2026-10-25 走通。样本只有 1–2 份简历，稳定性尚未系统验证。

### 已拍板

- CV 里解析出来的内容算"用户已确认"。
- 对话里得到的数字先标"待确认"，用户点确认才能进简历；简历只用已确认事实。
- 缺口状态由代码规则判断；v0 不让模型自己决定下一步。
- demo 阶段 JD 针对性追问最多 3 题。「不足三段经历时另行补充追问」已实现但暂时关闭，是否重开见下方「未拍板」。

### 未拍板

- 追问的最终停止条件；是否把 schema 合并稿与团队确认的节奏；demo 的最终受众和演示程度。
- 挖掘阶段看不看 JD（Paxton：JD 驱动；Christine：先通用挖掘，再按 JD 补挖）。
- "Agent"在我们这里具体指什么。
- 「补足三段经历」追问是否保留、何时重开（目前 `TARGET_EXPERIENCES = 0`）；它的话术和「不足三段时拒绝评估」的门槛没有团队确认。
- Ziyue 的 #5 里没带入的三项（同一段经历内 bullet 按重要程度排序、规范检查表 `lib/standards.ts`、改写提示词）是否需要，以及如何与「保留原句」兼容（这三项只在 #5 分支里，没有合并）；Christine 的 #10（隐私模式与占位 Word 导出）暂缓。
- 拖拽组装、数据库持久化：都推后。（中英双语：沟通语言与简历目标语言分开设置，见 `lib/language.ts`）（PDF / Word 导出已实现，见 `lib/resume-doc.ts`、`lib/resume-docx.ts`）

### 已知问题（请不要假装它们不存在）

1. **追问可能重复**：JD 分析可能把相近的要求拆成两条（如"做仪表盘"和"用 Tableau"）。已让提问步骤看到之前的问答，但这只是提示词约束，不保证。
2. **"已覆盖"的标准偏松**：只要有"我的动作"且同一张卡片上有任何已确认的成果即可，成果不要求有数字，也不要求与这条要求相关。
3. **事实校验只查数字**：AI 把"参与"改成"主导"、把团队动作写成个人动作，目前拦不住；中文数字既会误拦（事实写「一页半」，模型写成 1.5 会被拦），也会漏查（bullet 里的「三倍」不检查）。
4. **对话里的文字类事实直接标"已确认"**，只有数字类成果标"待确认"。
5. 匹配步骤有 AI 波动：同一份数据两次匹配可能引用不同的事实。
6. `workflow-v1.md` 写的"解析不合格自动重试"，代码里没有实现，校验失败就是报错。
7. 导出的简历没有姓名和联系方式抬头（教育经历已加入：CV 解析时单独存进 `education`，生成简历时照搬原文放在 EXPERIENCE 之前，不经过 AI 改写；暂不参与 JD 匹配）；上传支持可复制文字的 PDF、Word（.docx）和 TXT，扫描件不支持；状态只存在浏览器里，刷新即丢失。
8. 其他已知问题（改写稿与原句相同、原句粘着下一段经历的标题等）见 `CHANGELOG.md` 最新一段的「已知问题」，那里最新、最完整。

## 7. 协作规则

- 用中文回复，写得详细、自成一体。提到流程的某一步或某个字段时，**带上名字和一句话解释**，不要只写"步骤 8 → 9 → 6"这类编号。
- 做选择时给选项和推荐，说明取舍；用户拍板后再改文件。
- 描述模糊、方向未定、范围不清时，先追问再动手（一次 3–5 个问题）。用户明确下指令时直接做。（`CLAUDE.md` 里有 Paxton 个人的详细版本。）
- **不要替团队其他人做决定**；涉及 C、S、J 的设计，只做对比和建议。
- 没有用户明确要求，**不要 commit、不要 push、不要装额外依赖**。
- **分支规则**：`main` 受保护，不能直接推送。每个成员在自己的 branch 上开发（命名 `名字/做什么`，如 `ziyue/ats-rules`），用户要求推送时只推自己的 branch，再通过 Pull Request 合并，由 Paxton 审阅。开始改动前先确认当前不在 `main` 上。具体命令见 `README.md`。
- 开始工作前先 `git pull` 拿最新 main，并读 `CHANGELOG.md` 最上面一段；依赖有变化时要 `npm install`。
- PR 合并后，由 Paxton 在 `CHANGELOG.md` 最上面加一段（日期、PR 编号、新增、修复、验证、已知问题）。
- 永远不要把 API key 写进代码、文档、聊天或提交；key 只放在 `.env.local`（已被 git 忽略）。
- 前端和产品细节（拖拽等）先放一放，以 workflow 和数据结构为主。

## 8. 其他说明

- `docs/new-session-prompt.md` 是 Paxton 写给自己 AI 助手的开场稿，里面的"我"指 Paxton，**不是**给其他成员的指令。
- `docs/项目进度汇总.md` 汇总了 Drive 全部文档，以及各作者文档之间的出入，可以作为背景阅读。
