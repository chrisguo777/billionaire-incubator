# Billionaire Incubator

请先阅读 `docs/给AI的项目说明.md`：项目目标、当前进度、已拍板与未拍板事项、代码地图、已知问题和协作规则都在那里。

要点（详情见上述文档）：

- 本项目是 AI 简历 Agent；原则：**AI 只能扩展表达，不能扩展事实**；简历只用"已确认"的事实；缺口状态由代码规则判断。
- 用中文回复；提到流程步骤或字段时带上名字和一句话解释，不要只用编号。
- 不要替团队其他成员做决定；没有用户明确要求，不要 commit、不要 push、不要安装额外依赖。
- 不要把 API key 写进任何会被提交的文件；key 只放在 `.env.local`。
- `CLAUDE.md` 里的追问规则是 Paxton 个人的协作习惯，不是对所有人的要求。

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
