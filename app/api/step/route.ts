import { isResumeSortMode, orderResumeCards } from "@/lib/resume-order";
import { selectResumeCards } from "@/lib/resume-selection";
import { toUserFacingError } from "@/lib/errors";
import { discoveryState, experienceQuestion, needsExperienceDiscovery, TARGET_EXPERIENCES } from "@/lib/experience-target";
import { applyDiscoveryAnswer } from "@/lib/experience-discovery";
import { NextResponse } from "next/server";
import { EVALUATION_VERSION } from "@/lib/evaluation-schema";
import { evaluateResume } from "@/lib/evaluation";
import { reviewResume } from "@/lib/review";
import { getMode, getModelName, getProvider, isProviderConfigured } from "@/lib/llm";
import { isLang } from "@/lib/language";
import {
  analyzeJD,
  applyAnswer,
  askQuestion,
  ensureOriginalBullets,
  detectGaps,
  matchExperience,
  parseCV,
  pickGap,
  rankCards,
  rewriteBullets,
} from "@/lib/pipeline";
import type { Asked, ExperienceDB, Gap, JDAnalysis } from "@/lib/schema";

export const maxDuration = 120;
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ mode: getMode(), provider: getProvider(), model: getModelName(), configured: isProviderConfigured(), evaluationVersion: EVALUATION_VERSION });
}

const isBlank = (text: unknown) => typeof text !== "string" || !text.trim();

async function analyze(db: ExperienceDB, jd: JDAnalysis, asked: Asked) {
  const matches = await matchExperience(db, jd);
  return { matches, gaps: detectGaps(db, jd, matches, asked) };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const mode = getMode();
    const sortMode = body.sortMode ?? "relevance";
    if (!isResumeSortMode(sortMode)) return NextResponse.json({ error: "排序方式无效，请选择 JD 匹配度或经历时间" }, { status: 400 });
    switch (body.step) {
      case "parse": {
        if (isBlank(body.cv)) return NextResponse.json({ error: "简历内容为空，请先上传或粘贴简历文字" }, { status: 400 });
        return NextResponse.json({ mode, db: await parseCV(body.cv) });
      }
      case "jd": {
        if (isBlank(body.jd)) return NextResponse.json({ error: "JD 内容为空，请先粘贴岗位描述，或用岗位链接读取" }, { status: 400 });
        return NextResponse.json({ mode, jd: await analyzeJD(body.jd) });
      }
      case "analyze": {
        return NextResponse.json({ mode, ...(await analyze(body.db, body.jd, body.asked ?? {})) });
      }
      case "question": {
        const discovery = discoveryState(body.discovery);
        const extraQuestion = experienceQuestion(body.db, body.jd, discovery, body.selectedCardIds);
        if (extraQuestion) return NextResponse.json({ mode, kind: "experience", question: extraQuestion });
        if (body.regularQuestionCount >= 3) return NextResponse.json({ mode, done: true });
        const gaps: Gap[] = body.gaps;
        const jd: JDAnalysis = body.jd;
        const gap = pickGap(gaps, jd, body.asked ?? {});
        if (!gap) return NextResponse.json({ mode, done: true });
        const requirement = jd.requirements.find((r) => r.id === gap.requirement_id)!;
        const question = await askQuestion(body.db, gap, requirement, body.history ?? [], isLang(body.chatLanguage) ? body.chatLanguage : "zh");
        return NextResponse.json({ mode, kind: "gap", gap, requirement, question });
      }
      case "answer": {
        if (body.kind === "experience") {
          const applied = await applyDiscoveryAnswer(body.db, body.jd, discoveryState(body.discovery), body.question, body.answer, body.history ?? []);
          const { matches, gaps } = await analyze(applied.db, body.jd, body.asked ?? {});
          return NextResponse.json({ mode, ...applied, asked: body.asked ?? {}, matches, gaps });
        }
        const jd: JDAnalysis = body.jd;
        const requirement = jd.requirements.find((r) => r.id === body.gap.requirement_id)!;
        const applied = await applyAnswer(body.db, body.gap, requirement, body.question, body.answer, body.asked ?? {});
        const { matches, gaps } = await analyze(applied.db, jd, applied.asked);
        return NextResponse.json({ mode, ...applied, matches, gaps });
      }
      case "evaluate": {
        const current = reviewResume(body.db, body.jd, body.gaps, body.rewritten, body.choices ?? {}, sortMode, body.selectedCardIds);
        if (!current.resume.experienceBulletCount) {
          return NextResponse.json({ error: "当前简历没有经历描述，请先保留原句或接受新增建议，再进行质量评估" }, { status: 400 });
        }
        if (current.resume.experienceCount < TARGET_EXPERIENCES && !discoveryState(body.discovery).exhausted) {
          return NextResponse.json({ error: "当前简历不足三段经历，请先补充相关经历或接受新增描述；确实没有其他经历时，可在追问中确认后继续。" }, { status: 400 });
        }
        if (typeof body.cv !== "string" || !body.cv.trim()) {
          return NextResponse.json({ error: "缺少原简历，无法进行前后对比" }, { status: 400 });
        }
        return NextResponse.json({ evaluation: await evaluateResume(body.cv, current.resume.markdown, body.db, body.jd) });
      }
      case "review": {
        return NextResponse.json({ mode, ...reviewResume(body.db, body.jd, body.gaps, body.rewritten, body.choices ?? {}, sortMode, body.selectedCardIds) });
      }
      case "finish": {
        const db: ExperienceDB = await ensureOriginalBullets(body.db, body.cv);
        const jd: JDAnalysis = body.jd;
        const gaps: Gap[] = body.gaps;
        const candidates = rankCards(db, jd, gaps);
        selectResumeCards(candidates, body.selectedCardIds);
        if (needsExperienceDiscovery(db, discoveryState(body.discovery), body.selectedCardIds)) {
          return NextResponse.json({ error: "当前保留的经历不足三段，请先完成补充经历追问；确实没有其他经历时可按现有数量继续。", code: "EXPERIENCE_DISCOVERY_REQUIRED" }, { status: 409 });
        }
        const ranked = orderResumeCards(candidates, db, sortMode, candidates);
        const rewritten = await rewriteBullets(
          db,
          jd,
          ranked.map((r) => r.card_id),
        );
        const current = reviewResume(db, jd, gaps, rewritten, body.choices ?? {}, sortMode, body.selectedCardIds);
        // Cache suggestions for every candidate so reselecting a card needs no model call.
        return NextResponse.json({ mode, db, ...current, allRewritten: orderResumeCards(rewritten, db, sortMode, ranked) });
      }
      default:
        return NextResponse.json({ error: `unknown step: ${body.step}` }, { status: 400 });
    }
  } catch (err) {
    console.error("[api/step] step failed:", err);
    const { status, message } = toUserFacingError(err);
    return NextResponse.json({ error: message }, { status });
  }
}
