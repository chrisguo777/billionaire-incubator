# Experience Schema v1（三版合并草案）

来源：Paxton（问题概述）、Shera（产品框架·经历卡片）、Christine（开发逻辑图解·schema + 7 张表）。仅为讨论稿，未经团队确认。

## 1. 取舍对照

| 设计点 | Paxton | Shera | Christine | v1 采用 |
|---|---|---|---|---|
| 层级 | 单层 Experience | 单层卡片 | affiliation → card → field 三层 | **Christine 三层**（一家公司下多个项目，简历按公司分组天然对应） |
| 经历类型枚举 | type（未列值） | 实习/课程项目/个人项目/科研/社团/比赛/志愿 | 无 | **Shera 的枚举**，放在 affiliation 上 |
| 个人 vs 团队贡献 | individual_contribution | 个人行动 + 团队行动分开 | 只有"我的动作" | **Shera 分开存**（直接解决"团队项目说不清我做了什么"） |
| 成果 | outcome + metrics | 结果与数字 | outcomes{值,单位,口径,状态} | **Christine 的结构**（口径字段防止数字被编） |
| 确认状态 | evidence_status（已确认/未确认） | 确认状态（待确认） | 每个格子一个三态标签 | **Christine 格子级三态** |
| 原始依据 | raw_description | 原始问答依据 | messages 表 + 来源字段 | **Christine 的 source 指向 message**，保留 Paxton 的 raw_description（CV 解析原文） |
| 方法/工具/技能 | tools、methods、skills | 技能和工具 | tags | **Paxton 拆成 methods / tools / skills 三项**（JD 匹配时比一个 tags 好用） |
| 岗位标签/能力标签 | 无 | 有 | tags | **降为派生字段**（AI 推断，不当事实存；阶段二按 JD 现算更准） |
| 决策取舍/协作/规模/收获 | 无 | 无 | 挖掘框架 8 个价值点 | **Christine 的价值点作为 field 的 key**，挖掘进度由它判断 |
| 缺口（covered/weak/unknown/true gap） | 匹配层概念 | 匹配分数 | "还缺什么"不存，现算 | **不进 schema**，属于匹配层的运行时结果（Christine 的原则） |

## 2. 核心设计：每一个事实都是一条带状态的 Claim

```ts
import { z } from "zod";

export const FactStatus = z.enum(["user_confirmed", "ai_inferred", "missing"]);
export const FactSource = z.enum(["cv_parse", "dialogue", "user_edit"]);

// 一条事实 = 内容 + 状态 + 出处。AI 推断的内容在用户确认前不得出现在简历上。
const Fact = z.object({
  text: z.string(),
  status: FactStatus,
  source: FactSource,
  source_message_ids: z.array(z.string()).default([]),
});

export const Outcome = z.object({
  value: z.number().nullable(),          // 用户没给具体数字就是 null，AI 不许编
  unit: z.string().nullable(),           // %、人、小时 ...
  basis: z.string().nullable(),          // 口径：和什么比、怎么测的
  note: z.string(),                      // 口语描述，如"群里活跃度提升"
  status: FactStatus,
  source: FactSource,
  source_message_ids: z.array(z.string()).default([]),
});

export const Card = z.object({
  id: z.string(),
  affiliation_id: z.string(),
  name: z.string(),                       // 项目/工作名称
  my_role: z.string().nullable(),

  // 事实层：挖掘阶段产出，不看岗位
  context: z.array(Fact),                 // 背景与难点
  my_actions: z.array(Fact),              // 我具体做了什么
  team_actions: z.array(Fact),            // 团队/他人做了什么（用来切分个人贡献）
  decisions: z.array(Fact),               // 决策与取舍
  collaboration: z.array(Fact),           // 协作、说服、分歧
  methods: z.array(Fact),                 // 方法
  tools: z.array(Fact),                   // 工具
  skills: z.array(Fact),                  // 技能
  scale: z.array(Fact),                   // 人数/金额/周期/用户量
  outcomes: z.array(Outcome),             // 量化结果
  takeaways: z.array(Fact),               // 收获

  raw_description: z.string().nullable(), // CV 解析得到的原文，只读留档

  // 派生层：AI 推断，可随时重算，不作为事实
  derived: z.object({
    job_tags: z.array(z.string()),
    ability_tags: z.array(z.string()),
  }).partial(),
});

export const Affiliation = z.object({
  id: z.string(),
  user_id: z.string(),
  organization: z.string(),
  title: z.string().nullable(),
  type: z.enum(["intern", "course_project", "personal_project", "research", "club", "competition", "volunteer", "work", "other"]),
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),
  location: z.string().nullable(),
});
```

### 教育经历（v0 已实现，未经团队确认）

教育经历不拆成卡片，单独一张表 `education`，挂在经历库上：

```ts
export const Education = z.object({
  id: z.string(),
  school: z.string(),
  degree: z.string().nullable(),          // 学位，如 M.S.
  field: z.string().nullable(),           // 专业
  location: z.string().nullable(),
  start_date: z.string().nullable(),
  end_date: z.string().nullable(),        // 保留原文写法，如 "expected 2027"
  gpa: z.string().nullable(),             // 保留原文写法
  details: z.array(z.string()),           // 荣誉、相关课程、论文，逐条照搬 CV
});
```

来自 CV 解析，视为已确认；生成简历时照搬，不经过 AI 改写，也暂不参与 JD 匹配。

> 实现时 `Card` 里的各组 Fact 可以落成 `card_fields` 表的行（field_key + text + status + source），和 Christine 的 7 张表设计一致；上面的对象形状是给 LLM 抽取和 Zod 校验用的。

## 3. 数据表（沿用 Christine 的 7 张，字段按上面补齐）

`users` · `affiliations` · `cards` · `card_fields`（card_id, field_key, text/value/unit/basis, status, source, message_id） · `sessions` · `messages` · `edits`

阶段二再加：`jds`（存 JD 原文与解析结果，Shera 和设计书都提到要存）。

## 4. 一条规则

> 简历生成只能使用 `status = user_confirmed` 的 Fact / Outcome。`ai_inferred` 和 `missing` 只能触发追问，不能进入输出。

这是 Paxton 的 evidence_status、Shera 的"待确认"、Christine 的"数字只能由用户确认"三者共同的底线，合并后落到最小的一处。

## 5. 待团队确认

1. `outcomes` 里 `value` 为空但有 `note` 的情况（"提升了很多"），简历里是否允许只写定性描述？
2. `team_actions` 要不要进简历？现在只用于帮助 AI 切分个人贡献，不输出。
3. 中英双语：同一事实是否存两份表达？建议事实只存一份，表达层（阶段二）按语言生成。
4. `derived` 标签是否保留，还是阶段二完全现算。
