import { z } from "zod";

export const FactStatus = z.enum(["user_confirmed", "ai_inferred", "missing"]);
export type FactStatus = z.infer<typeof FactStatus>;
export type FactSource = "cv_parse" | "dialogue" | "user_edit";

export const FACT_FIELDS = [
  "context",
  "my_actions",
  "team_actions",
  "methods",
  "tools",
  "skills",
  "scale",
] as const;
export type FactField = (typeof FACT_FIELDS)[number];

export interface Fact {
  id: string;
  text: string;
  status: FactStatus;
  source: FactSource;
}

export interface Outcome {
  id: string;
  note: string;
  value: number | null;
  unit: string | null;
  basis: string | null;
  status: FactStatus;
  source: FactSource;
}

export type AffiliationType =
  | "intern"
  | "course_project"
  | "personal_project"
  | "research"
  | "club"
  | "competition"
  | "volunteer"
  | "work"
  | "teaching"
  | "skills_list"
  | "other";

export interface Affiliation {
  id: string;
  organization: string;
  title: string | null;
  type: AffiliationType;
  start_date: string | null;
  end_date: string | null;
}

export interface Card {
  id: string;
  affiliation_id: string;
  name: string;
  my_role: string | null;
  context: Fact[];
  my_actions: Fact[];
  team_actions: Fact[];
  methods: Fact[];
  tools: Fact[];
  skills: Fact[];
  scale: Fact[];
  outcomes: Outcome[];
  // Full CV bullets, kept separately from the fact fragments used for matching.
  original_bullets?: OriginalBullet[];
}

export interface OriginalBullet { id: string; text: string }

// 教育经历：单独存放，不拆成卡片。来自 CV 解析，视为用户已确认；只记录 CV 里写明的内容。
export interface Education {
  id: string;
  school: string;
  degree: string | null; // 学位，如 "M.S."、"B.A."
  field: string | null; // 专业，如 "Biostatistics"
  location: string | null;
  start_date: string | null;
  end_date: string | null; // 可以是 "expected 2027" 这类原文写法
  gpa: string | null; // 保留原文写法，如 "3.9/4.0"
  details: string[]; // 荣誉、相关课程、论文等，逐条照搬 CV
}

export interface ExperienceDB {
  affiliations: Affiliation[];
  cards: Card[];
  education: Education[];
  // 简历目标语言：解析时根据上传的简历自动识别，用户可以在页面上改。
  // 回答抽取、改写和最终简历都统一用这个语言；旧数据没有这个字段时按英文处理。
  resume_language?: "zh" | "en";
}

// ---------- LLM output schemas (Zod; ids are assigned by code afterwards) ----------

const OutcomeDraft = z.object({
  note: z.string(),
  value: z.number().nullable(),
  unit: z.string().nullable(),
  basis: z.string().nullable(),
});

export const ParsedCV = z.object({
  education: z.array(
    z.object({
      school: z.string(),
      degree: z.string().nullable(),
      field: z.string().nullable(),
      location: z.string().nullable(),
      start_date: z.string().nullable(),
      end_date: z.string().nullable(),
      gpa: z.string().nullable(),
      details: z.array(z.string()),
    }),
  ),
  affiliations: z.array(
    z.object({
      organization: z.string(),
      title: z.string().nullable(),
      type: z.enum([
        "intern",
        "course_project",
        "personal_project",
        "research",
        "club",
        "competition",
        "volunteer",
        "work",
        "teaching",
        "skills_list",
        "other",
      ]),
      start_date: z.string().nullable(),
      end_date: z.string().nullable(),
      cards: z.array(
        z.object({
          name: z.string(),
          my_role: z.string().nullable(),
          original_bullet_ids: z.array(z.string()),
          context: z.array(z.string()),
          my_actions: z.array(z.string()),
          team_actions: z.array(z.string()),
          methods: z.array(z.string()),
          tools: z.array(z.string()),
          skills: z.array(z.string()),
          scale: z.array(z.string()),
          outcomes: z.array(OutcomeDraft),
        }),
      ),
    }),
  ),
});
export type ParsedCV = z.infer<typeof ParsedCV>;

export const JDAnalysis = z.object({
  role_title: z.string(),
  domain: z.string(),
  seniority: z.string(),
  requirements: z.array(
    z.object({
      id: z.string(),
      text: z.string(),
      kind: z.enum(["must_have", "preferred", "responsibility"]),
      priority: z.enum(["high", "medium", "low"]),
      keywords: z.array(z.string()),
    }),
  ),
});
export type JDAnalysis = z.infer<typeof JDAnalysis>;
export type Requirement = JDAnalysis["requirements"][number];

export const MatchOutput = z.object({
  matches: z.array(
    z.object({
      requirement_id: z.string(),
      evidence_fact_ids: z.array(z.string()),
      related_card_ids: z.array(z.string()),
      note: z.string(),
    }),
  ),
});
export type MatchOutput = z.infer<typeof MatchOutput>;

export const QuestionOutput = z.object({ question: z.string() });

export const AnswerExtraction = z.object({
  has_experience: z.boolean(),
  target_card_id: z.string().nullable(),
  new_card_name: z.string().nullable(),
  new_facts: z.array(
    z.object({
      field: z.enum(FACT_FIELDS),
      text: z.string(),
    }),
  ),
  new_outcomes: z.array(OutcomeDraft),
});
export type AnswerExtraction = z.infer<typeof AnswerExtraction>;

export const RewriteOutput = z.object({
  cards: z.array(
    z.object({
      card_id: z.string(),
      bullets: z.array(
        z.object({
          original_bullet_id: z.string().nullable(),
          text: z.string(),
          source_ids: z.array(z.string()),
        }),
      ),
    }),
  ),
});
export type RewriteOutput = z.infer<typeof RewriteOutput>;

export const OriginalBulletMapping = z.object({
  cards: z.array(z.object({ card_id: z.string(), original_bullet_ids: z.array(z.string()) })),
});

// ---------- Derived (computed by code, never stored as fact) ----------

export type GapStatus = "covered" | "weak" | "unknown" | "true_gap";

export interface Gap {
  requirement_id: string;
  status: GapStatus;
  evidence_fact_ids: string[];
  related_card_ids: string[];
  reason: string;
}

export type Asked = Record<string, "answered" | "none">;
