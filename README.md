# Billionaire Incubator · Resume Agent

An AI resume assistant that tailors a resume to a specific job without inventing anything. Its rule is simple: **the AI may improve how your experience is worded, but it may not add facts you never stated.**

## The problem

Most AI resume tools take a resume and a job description and return a rewrite. They often add numbers, tools or responsibilities the candidate never mentioned, and the candidate is the one who gets caught in the interview. Students also struggle with a step before writing: they cannot tell what a past project shows about their skills, or what they personally did in a team project.

## How it works

The app is a fixed workflow, not an autonomous agent. The code decides every step; the model only reads and writes text.

1. **Parse the resume** into an experience database. Each experience becomes a card, and each card holds facts in fields such as personal actions, team actions, tools, scale and outcomes. Every fact gets an ID, a status (confirmed, pending or missing) and a source.
2. **Analyze the job description** into separate requirements, each with a priority.
3. **Match and find gaps.** For each requirement the model must cite the fact IDs that support it. Code rules, not the model, then mark the requirement as Covered, Weak, Unknown or True Gap.
4. **Ask targeted questions.** Code picks the most valuable gap and the model words a short question, up to three per job. Answers become new facts; any number from the conversation stays "pending" until the user confirms it.
5. **Rewrite bullets.** Each suggested bullet must list the facts it relies on. A code check blocks bullets with no source, bullets citing unconfirmed facts, and numbers that do not appear in the cited facts. The user accepts, edits or rejects each bullet; untouched bullets keep the original wording.
6. **Export and evaluate.** The resume is previewed in the browser and exported to Word or PDF. A separate model call scores the original and the revised resume on six dimensions, and code checks that every quote it uses exists in the text.

## Tech stack

- Next.js 16, React 19, TypeScript
- Model access behind one function: Claude through the official Anthropic SDK (the default, `claude-opus-5-5`), or any provider with an OpenAI-compatible API (OpenAI, DeepSeek, Doubao, Gemini and others) through the `openai` SDK. Every call returns structured output validated with Zod, and invalid output is retried
- Stateless backend: all state lives in the browser
- Word export with `docx`; resume upload from PDF (`unpdf`), Word (`mammoth`) and plain text

## Current limitations

This is a working prototype, tested on a small number of resumes.

- The fact check covers sources, confirmation status and numbers. It does not yet catch an inflated role or scope that adds no new number.
- Facts extracted from the resume are not yet verified word for word against the original text, and users cannot edit or delete an extracted fact.
- Output quality has no human-rated baseline yet; the six-dimension score comes from the model.
- Prompts were tuned on Claude. Other models can be connected, but their output quality has not been evaluated.
- The interface is in Chinese; the resume itself can be generated in English or Chinese.
- Progress is kept only in the current browser tab: it survives a refresh but is cleared when the tab closes. There are no accounts, and the experience database cannot be reused across sessions yet.

The full, numbered list of known issues is kept in [CHANGELOG.md](CHANGELOG.md).

## Team and contributions

Built by a team of four between September and November 2026. Members are listed alphabetically by first name, with the pull requests behind each piece of work. See [CHANGELOG.md](CHANGELOG.md) for details of every merge.

- **Christine** ([@christineyang567](https://github.com/christineyang567))
  - Resume header (name and contact details), bold job titles, one-page layout by default, and clean printing without browser headers ([#16](https://github.com/chrisguo777/billionaire-incubator/pull/16))
  - Development logic diagram behind the experience database: the affiliation → card → field structure, the "basis" field for outcomes, and per-field confirmation status ([docs/schema-v1.md](docs/schema-v1.md))
  - Privacy mode with placeholder Word export ([#10](https://github.com/chrisguo777/billionaire-incubator/pull/10), submitted, not merged)
  - Testing feedback: questions asking for education already on the resume, and one experience split into several
- **Paxton** ([@chrisguo777](https://github.com/chrisguo777))
  - Started the project; product architecture and the first working prototype (parsing, job analysis, matching, gap rules, questions, rewriting and the fact check)
  - Workflow design and the merged experience-database schema ([docs/workflow-v1.md](docs/workflow-v1.md), [docs/schema-v1.md](docs/schema-v1.md))
  - Reading a full job description from a posting link, and company name autocomplete ([#18](https://github.com/chrisguo777/billionaire-incubator/pull/18))
  - Integrated resume preview, PDF / Word export and shorter interview questions ([#12](https://github.com/chrisguo777/billionaire-incubator/pull/12))
  - Retry on invalid structured output and clear error messages ([#22](https://github.com/chrisguo777/billionaire-incubator/pull/22))
  - Code review and merging, CHANGELOG and documentation ([#4](https://github.com/chrisguo777/billionaire-incubator/pull/4), [#11](https://github.com/chrisguo777/billionaire-incubator/pull/11), [#13](https://github.com/chrisguo777/billionaire-incubator/pull/13), [#14](https://github.com/chrisguo777/billionaire-incubator/pull/14), [#19](https://github.com/chrisguo777/billionaire-incubator/pull/19)–[#21](https://github.com/chrisguo777/billionaire-incubator/pull/21), [#23](https://github.com/chrisguo777/billionaire-incubator/pull/23), [#24](https://github.com/chrisguo777/billionaire-incubator/pull/24))
- **Shera** ([@sheraduan729-cloud](https://github.com/sheraduan729-cloud))
  - Word / TXT resume upload, bullet-by-bullet review, evidence-based six-dimension quality evaluation and a repeat-evaluation script ([#3](https://github.com/chrisguo777/billionaire-incubator/pull/3))
  - Sorting the resume by job relevance or by date ([#6](https://github.com/chrisguo777/billionaire-incubator/pull/6))
  - Keeping every original bullet whole, keeping the original when a rewrite is not accepted, and removing duplicates within an experience ([#7](https://github.com/chrisguo777/billionaire-incubator/pull/7))
  - Letting users choose which experiences to keep, and follow-up questions when fewer than three remain ([#9](https://github.com/chrisguo777/billionaire-incubator/pull/9))
  - Weighted score rings, reviewing only bullets that actually changed, and API configuration status ([#15](https://github.com/chrisguo777/billionaire-incubator/pull/15))
  - Product framework and experience-card design: experience types, and personal actions stored apart from team actions ([docs/schema-v1.md](docs/schema-v1.md))
  - A round of systematic testing in November 2026 that logged 10 issues, each with steps to reproduce and acceptance criteria
- **Ziyue** ([@Ziyue1296](https://github.com/Ziyue1296))
  - Education in parsing and in the generated resume ([#2](https://github.com/chrisguo777/billionaire-incubator/pull/2))
  - Separate settings for the conversation language and the resume language, and a fix for Chinese text appearing in English resumes ([#17](https://github.com/chrisguo777/billionaire-incubator/pull/17))
  - First implementation of resume preview, PDF / Word export and shorter interview questions ([#5](https://github.com/chrisguo777/billionaire-incubator/pull/5); these three parts were merged through #12)

## License

Released under the [MIT License](LICENSE).
