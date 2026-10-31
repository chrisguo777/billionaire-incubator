import { z } from "zod";

export const EVALUATION_VERSION = "2026-10-30.1";

export const DIMENSIONS = {
  relevance: "岗位匹配", contribution: "个人贡献", methods: "方法与工具",
  outcomes: "成果与证据", clarity: "表达清晰度", faithfulness: "事实一致性",
} as const;
const Evidence = z.object({ source: z.enum(["before", "after", "confirmed", "jd"]), quote: z.string() });
const Assessment = z.object({ score: z.number().int().min(0).max(3).nullable(), reason: z.string(), evidence: z.array(Evidence) });
export const EvaluationSchema = z.object({
  summary: z.string(),
  dimensions: z.array(z.object({
    id: z.enum(["relevance", "contribution", "methods", "outcomes", "clarity", "faithfulness"]),
    before: Assessment, after: Assessment, missing: z.array(z.string()), suggestion: z.string(),
  })),
  fact_risks: z.array(z.object({ quote: z.string(), reason: z.string(), source_ids: z.array(z.string()) })),
  next_actions: z.array(z.string()),
});
export type Evaluation = z.infer<typeof EvaluationSchema>;
export type EvaluationReport = Evaluation & { version: string; mode: "live" | "mock"; warnings: string[] };
