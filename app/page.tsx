"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LANG_LABEL, LANGS, type Lang } from "@/lib/language";
import { SORT_LABELS, orderResumeCards, type ResumeSortMode } from "@/lib/resume-order";
import { CARD_EVIDENCE_LABELS } from "@/lib/resume-selection";
import { countExperiences, needsExperienceDiscovery, TARGET_EXPERIENCES, type ExperienceDiscoveryState } from "@/lib/experience-target";
import { SAMPLE_CV, SAMPLE_JD } from "@/lib/sample";
import { DIMENSIONS, type EvaluationReport } from "@/lib/evaluation-schema";
import { bulletKey, type ReviewChoices } from "@/lib/review-types";
import { reviewableCards } from "@/lib/review-display";
import type { ReviewResult } from "@/lib/review";
import { FACT_FIELDS } from "@/lib/schema";
import type { Asked, ExperienceDB, Gap, GapStatus, JDAnalysis, Requirement } from "@/lib/schema";
import type { RankedCard, ResumeOutput, RewrittenCard } from "@/lib/pipeline";
import { docToHTML, fitResumeToOnePage, resumeFileName } from "@/lib/resume-doc";
import ExperienceReview, { ResumeDetailsReview } from "./components/experience-review";
import { repairOriginalBoundaries } from "@/lib/original-bullets";
import { confirmFacts, reviewFacts } from "@/lib/fact-review";
import { checkEducation, educationGap, isEducationQuestion, isEducationRequirement } from "@/lib/education-match";
import EducationNotice from "./components/education-notice";
import ScoreComparison from "./components/score-comparison";
import JobPicker from "./job-picker";

const MAX_QUESTIONS = 3; // 追问停止条件尚未最终确定，demo 先固定为 3 题

const GAP_LABEL: Record<GapStatus, string> = {
  covered: "已覆盖 Covered",
  weak: "证据偏弱 Weak",
  unknown: "未知 Unknown",
  true_gap: "真缺口 True Gap",
};
const STATUS_LABEL = { user_confirmed: "本人已确认", ai_inferred: "尚未核对", missing: "缺失" } as const;
const FIELD_LABEL: Record<string, string> = {
  context: "背景",
  my_actions: "我的动作",
  team_actions: "团队动作",
  methods: "方法",
  tools: "工具",
  skills: "技能",
  scale: "规模",
  outcomes: "结果",
};

interface Turn {
  kind?: "gap" | "experience";
  requirement?: Requirement;
  question: string;
  answer: string;
  has_experience: boolean;
  added_ids: string[];
  note?: string;
}
type Pending = { kind: "gap"; gap: Gap; requirement: Requirement; question: string }
  | { kind: "experience"; question: string };
interface FinishResult extends ReviewResult {
  db: ExperienceDB;
  ranked: RankedCard[];
  rewritten: RewrittenCard[];
  resume: ResumeOutput;
  allRewritten?: RewrittenCard[];
}

const SESSION_KEY = "resume-agent-session";
// Bump when the saved state's shape changes, so an old tab's data is ignored instead of breaking the page.
const SESSION_VERSION = 3;

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/step", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  // A timeout or proxy error page is HTML, not JSON; show a Chinese hint instead of a parse error.
  const data = await res.json().catch(() => null);
  if (!data) {
    throw new Error(res.ok
      ? "服务器返回的内容无法读取，请再试一次；已完成的步骤不会丢失。"
      : `服务器没有正常响应（${res.status}），可能是处理超时，请稍后再试；已完成的步骤不会丢失。`);
  }
  if (!res.ok) throw new Error(data.error ?? `请求失败（${res.status}），请再试一次`);
  return data as T;
}

// Marks who does the work in each step, so non-engineers can see where AI is used and where plain rules decide.
const WHO: Record<"ai" | "rule" | "user", string> = { ai: "AI 模型", rule: "代码规则", user: "你来做" };
function Who({ kinds }: { kinds: ("ai" | "rule" | "user")[] }) {
  return (
    <>
      {kinds.map((k, i) => (
        <span key={i} className={`who ${k}`}>{WHO[k]}</span>
      ))}
    </>
  );
}

export default function Page() {
  const [mode, setMode] = useState<"live" | "mock" | null>(null);
  const [provider, setProvider] = useState<"anthropic" | "openai-compatible" | "mock" | null>(null);
  const [modelName, setModelName] = useState<string | null>(null);
  const [providerConfigured, setProviderConfigured] = useState(true);
  const providerLabel = provider === "openai-compatible" ? `OpenAI 兼容接口${modelName ? ` · ${modelName}` : ""}` : `Anthropic API${modelName ? ` · ${modelName}` : ""}`;
  const [cv, setCv] = useState(SAMPLE_CV);
  const [jdText, setJdText] = useState(SAMPLE_JD);
  const [reviewPane, setReviewPane] = useState<"source" | "fields">("fields");
  const [newEntryDraft, setNewEntryDraft] = useState(false);
  const [reviewEditing, setReviewEditing] = useState(0);
  const [detailsConfirmed, setDetailsConfirmed] = useState(false);
  const [db, setDb] = useState<ExperienceDB | null>(null);
  const [jd, setJd] = useState<JDAnalysis | null>(null);
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [asked, setAsked] = useState<Asked>({});
  const [turns, setTurns] = useState<Turn[]>([]);
  const [roundStart, setRoundStart] = useState(0);
  const [pending, setPending] = useState<Pending | null>(null);
  const [interviewDone, setInterviewDone] = useState(false);
  const [answer, setAnswer] = useState("");
  const [chatLanguage, setChatLanguage] = useState<Lang>("zh");
  const [sortMode, setSortMode] = useState<ResumeSortMode>("relevance");
  const [selectedCardIds, setSelectedCardIds] = useState<string[] | null>(null);
  const [discovery, setDiscovery] = useState<ExperienceDiscoveryState>({ exhausted: false });
  const [regularSkipped, setRegularSkipped] = useState(false);
  const [result, setResult] = useState<FinishResult | null>(null);
  const [choices, setChoices] = useState<ReviewChoices>({});
  const [reviewed, setReviewed] = useState<ReviewResult | null>(null);
  const [evaluation, setEvaluation] = useState<{ signature: string; report: EvaluationReport } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadInfo, setUploadInfo] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/step").then((r) => r.json()).then((d) => { setMode(d.mode); setProvider(d.provider); setModelName(d.model ?? null); setProviderConfigured(d.configured !== false); }).catch(() => {});
  }, []);

  const newIds = useMemo(() => new Set(turns.flatMap((t) => t.added_ids)), [turns]);
  const cvEmpty = !cv.trim();
  const jdEmpty = !jdText.trim();
  const missingInput = cvEmpty && jdEmpty ? "请先填写简历和 JD" : cvEmpty ? "请先上传或粘贴简历" : jdEmpty ? "请先粘贴 JD" : null;
  // The CV and JD the current results were built from. Once either input changes, every result
  // below is out of date: actions on it are locked until the user re-analyzes or restores the text.
  const [analyzedInputs, setAnalyzedInputs] = useState<{ cv: string; jd: string } | null>(null);
  const inputsStale = !!db && !!analyzedInputs && (cv !== analyzedInputs.cv || jdText !== analyzedInputs.jd);
  const locked = !!busy || inputsStale;
  const educationChecks = useMemo(() => db && jd ? jd.requirements.flatMap((r) => {
    const check = checkEducation(r, db.education ?? []); return check ? [check] : [];
  }) : [], [db, jd]);
  const matchingGaps = useMemo(() => !db || !jd ? gaps : gaps.map((g) => {
    const r = jd.requirements.find((r) => r.id === g.requirement_id);
    return r ? educationGap(db, r) ?? g : g;
  }), [db, jd, gaps]);
  // Also retire a previously saved/generated education question without resetting
  // the user's reviewed DB, edits, accepted bullets or whole browser session.
  useEffect(() => {
    if (pending?.kind === "gap" && (isEducationRequirement(pending.requirement) || isEducationQuestion(pending.question))) {
      setPending(null); setAnswer(""); setInterviewDone(false);
    }
  }, [pending]);

  useEffect(() => {
    if (!db) return;
    try {
      const repaired = repairOriginalBoundaries(db);
      if (repaired !== db) {
        setDb(repaired); setResult(null); setReviewed(null); setEvaluation(null);
        setError("已修复原句中混入的下一段经历标题；核对与追问记录已保留，请重新生成简历。");
      }
    } catch (err) {
      setResult(null); setReviewed(null); setEvaluation(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [db]);

  async function guard<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(label);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function runAnalysis() {
    await guard("解析简历，准备核对…", async () => {
      setNewEntryDraft(false);
      setReviewEditing(0);
      setDetailsConfirmed(false);
      setJd(null);
      setDb(null);
      setGaps([]);
      setTurns([]);
      setRoundStart(0);
      setAsked({});
      setPending(null);
      setInterviewDone(false);
      setResult(null);
      setReviewed(null);
      setChoices({});
      setSelectedCardIds(null);
      setDiscovery({ exhausted: false });
      setRegularSkipped(false);
      setEditing(null);
      setEvaluation(null);
      // Inputs are locked while busy, so these are exactly the texts the results are built from.
      const inputs = { cv, jd: jdText };
      const p = await call<{ db: ExperienceDB }>({ step: "parse", cv: inputs.cv });
      setDb(p.db);
      setAnalyzedInputs(inputs);
    });
  }

  async function uploadResume(file: File) {
    await guard("提取简历文字…", async () => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/resume", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "简历上传失败");
      setCv(data.text);
      setUploadInfo(`已从 ${data.name} 提取文字${data.pages ? `（${data.pages} 页）` : ""}，请检查下方文本是否完整`);
    });
  }

  async function nextQuestion(
    currentDb: ExperienceDB,
    currentGaps: Gap[],
    currentAsked: Asked,
    count: number,
    history: { question: string; answer: string }[] = [],
    currentDiscovery = discovery,
    currentSelection = selectedCardIds,
    currentRoundStart = roundStart,
  ) {
    if (!jd) {
      setPending(null);
      setInterviewDone(true);
      return;
    }
    setInterviewDone(false);
    const q = await call<{ done?: boolean; kind?: "gap" | "experience"; question?: string; gap?: Gap; requirement?: Requirement }>({
      step: "question",
      db: currentDb,
      jd,
      gaps: currentGaps,
      asked: currentAsked,
      history,
      regularQuestionCount: count,
      roundStart: currentRoundStart,
      retryInterview: currentRoundStart > 0,
      chatLanguage,
      discovery: currentDiscovery,
      selectedCardIds: currentSelection ?? undefined,
    });
    if (q.kind === "experience" && q.question) {
      setPending({ kind: "experience", question: q.question });
    } else if (q.done || !q.gap) {
      setPending(null);
      setInterviewDone(true);
    } else {
      setPending({ kind: "gap", gap: q.gap, requirement: q.requirement!, question: q.question! });
    }
  }

  async function startInterview() {
    if (!db) return;
    await guard("生成第一个问题…", () => nextQuestion(db, gaps, asked, regularSkipped ? MAX_QUESTIONS : 0));
  }

  async function submitAnswer(answerOverride?: string) {
    const submittedAnswer = answerOverride ?? answer;
    if (!db || !jd || !pending || !submittedAnswer.trim()) return;
    await guard("整理你的回答、重新匹配…", async () => {
      const r = await call<{ db: ExperienceDB; asked: Asked; gaps: Gap[]; added_ids: string[]; has_experience: boolean; discovery?: ExperienceDiscoveryState; new_card_ids?: string[]; note?: string }>({
        step: "answer",
        db,
        jd,
        kind: pending.kind,
        gap: pending.kind === "gap" ? pending.gap : undefined,
        question: pending.question,
        answer: submittedAnswer,
        asked,
        discovery,
        history: turns,
      });
      const turn: Turn = {
        kind: pending.kind,
        requirement: pending.kind === "gap" ? pending.requirement : undefined,
        question: pending.question,
        answer: submittedAnswer,
        has_experience: r.has_experience,
        added_ids: r.added_ids,
        note: r.note,
      };
      const nextTurns = [...turns, turn];
      const nextDiscovery = r.discovery ?? discovery;
      const nextSelection = selectedCardIds === null ? null : [...new Set([...selectedCardIds, ...(r.new_card_ids ?? [])])];
      setTurns(nextTurns);
      setDiscovery(nextDiscovery);
      setSelectedCardIds(nextSelection);
      if (pending.kind === "experience" && r.added_ids.length) { setResult(null); setReviewed(null); }
      setPending(null);
      setDb(r.db);
      setAsked(r.asked);
      setGaps(r.gaps);
      setAnswer("");
      setBusy("生成下一条追问…");
      await nextQuestion(r.db, r.gaps, r.asked, regularSkipped ? MAX_QUESTIONS : nextTurns.slice(roundStart).filter((t) => t.kind !== "experience" && (!t.requirement || !isEducationRequirement(t.requirement))).length, nextTurns, nextDiscovery, nextSelection);
    });
  }

  async function retryNextQuestion() {
    if (!db || !jd || pending || interviewDone) return;
    await guard("生成下一条追问…", () => nextQuestion(db, gaps, asked, regularSkipped ? MAX_QUESTIONS : turns.slice(roundStart).filter((t) => t.kind !== "experience" && (!t.requirement || !isEducationRequirement(t.requirement))).length, turns));
  }

  async function restartInterview() {
    if (!db || !jd || pending) return;
    await guard("换一组针对性追问…", async () => {
      // Only reset the round limit. Keep answers, facts, explicit 'none' and exports.
      try {
        await nextQuestion(db, gaps, asked, 0, turns, discovery, selectedCardIds, turns.length);
      } catch (err) {
        setInterviewDone(true);
        throw err;
      }
      setRoundStart(turns.length);
      setRegularSkipped(false);
      setAnswer("");
    });
  }

  async function skipRegularQuestions() {
    if (!db || !jd) return;
    setRegularSkipped(true);
    setPending(null);
    await guard("检查是否需要补充经历…", () => nextQuestion(db, gaps, asked, MAX_QUESTIONS, turns));
  }

  async function continueWithCurrentExperiences() {
    if (!db || !jd) return;
    if (pending?.kind === "experience") { await submitAnswer("没有其他相关经历"); return; }
    const nextDiscovery = { exhausted: true, followUp: null };
    const nextTurns: Turn[] = [...turns, { kind: "experience", question: "是否还有其他可以保留的相关经历？", answer: "没有其他相关经历", has_experience: false, added_ids: [], note: "已确认没有其他可保留经历，按现有数量继续。" }];
    setDiscovery(nextDiscovery);
    setTurns(nextTurns);
    await guard("按现有经历继续…", () => nextQuestion(db, gaps, asked, MAX_QUESTIONS, nextTurns, nextDiscovery));
  }

  async function restoreExistingExperiences() {
    if (!db || !jd || !result) return;
    await guard("恢复已有经历…", async () => {
      const response = await call<ReviewResult>({ step: "review", db, jd, gaps, sortMode, rewritten: result.rewritten, choices });
      const restored = response.ranked.filter((r) => r.included).map((r) => r.card_id);
      setSelectedCardIds(restored);
      setReviewed(response);
      setPending(null);
      setAnswer("");
      await nextQuestion(db, gaps, asked, MAX_QUESTIONS, turns, discovery, restored);
    });
  }

  function reopenReview() {
    setReviewEditing(0); setError(null);
    setJd(null); setGaps([]); setResult(null); setReviewed(null); setChoices({});
    setEvaluation(null); setPending(null); setInterviewDone(false); setEditing(null); setAnswer("");
    setSelectedCardIds(null); setDetailsConfirmed(false);
  }

  function updateReviewedDB(next: ExperienceDB) {
    setDb(next); setDetailsConfirmed(false);
  }

  async function continueAfterReview() {
    if (!db || newEntryDraft || reviewEditing > 0 || !detailsConfirmed || reviewFacts(db).some((f) => f.status !== "user_confirmed") || inputsStale) return;
    await guard("根据核对后的经历库分析 JD 和匹配…", async () => {
      const j = await call<{ jd: JDAnalysis }>({ step: "jd", jd: jdText });
      const a = await call<{ gaps: Gap[] }>({ step: "analyze", db, jd: j.jd, asked });
      setJd(j.jd); setGaps(a.gaps);
    });
  }

  async function confirmInterviewFacts(ids: string[]) {
    if (!db || !jd || locked) return;
    const next = confirmFacts(db, ids);
    // Keep the interview, but discard generated material based on the older DB.
    setDb(next); setResult(null); setReviewed(null); setChoices({}); setEvaluation(null);
    const updated = await guard("用已确认的信息更新匹配…", async () => {
      const a = await call<{ gaps: Gap[] }>({ step: "analyze", db: next, jd, asked });
      setGaps(a.gaps);
      return true;
    });
    if (!updated) { setJd(null); setGaps([]); setDetailsConfirmed(false); }
  }

  async function finish() {
    if (!db || !jd) return;
    if (reviewFacts(db).some((f) => f.status !== "user_confirmed")) { setError("还有待确认信息，请在生成按钮上方逐条核对并确认后再生成。"); return; }
    if (needsExperienceDiscovery(db, discovery, selectedCardIds ?? undefined)) {
      await guard("准备补充经历追问…", () => nextQuestion(db, gaps, asked, MAX_QUESTIONS, turns));
      return;
    }
    await guard("选择经历、改写 bullet、检查事实…", async () => {
      const generated = await call<FinishResult>({ step: "finish", cv, db, jd, gaps, sortMode, selectedCardIds: selectedCardIds ?? undefined, discovery, choices });
      setDb(generated.db);
      setResult({ ...generated, rewritten: generated.allRewritten ?? generated.rewritten });
      setSelectedCardIds(generated.ranked.filter((r) => r.included).map((r) => r.card_id));
      setEditing(null);
      setReviewed(generated);
    });
  }

  async function reviewBullet(key: string, text: string, status: "accepted" | "excluded" | "pending") {
    if (!db || !jd || !result) return;
    await guard("更新审阅结果…", async () => {
      const next = { ...choices, [key]: { text, status } };
      const response = await call<ReviewResult>({
        step: "review", db, jd, gaps, sortMode, rewritten: result.rewritten, choices: next, selectedCardIds: selectedCardIds ?? undefined,
      });
      setChoices(next);
      setReviewed(response);
      setEditing(null);
    });
  }

  async function changeSortMode(next: ResumeSortMode) {
    if (!result || !db || !jd) { setSortMode(next); return; }
    await guard("更新简历排序…", async () => {
      const response = await call<ReviewResult>({
        step: "review", db, jd, gaps, sortMode: next, rewritten: result.rewritten, choices, selectedCardIds: selectedCardIds ?? undefined,
      });
      setSortMode(next);
      setReviewed(response);
    });
  }
  async function changeCardSelection(cardId: string, keep: boolean) {
    if (!result || !db || !jd) return;
    const current = selectedCardIds ?? (reviewed?.ranked ?? result.ranked).filter((r) => r.included).map((r) => r.card_id);
    const next = keep ? [...new Set([...current, cardId])] : current.filter((id) => id !== cardId);
    await guard("更新保留的经历…", async () => {
      const response = await call<ReviewResult>({ step: "review", db, jd, gaps, sortMode, rewritten: result.rewritten, choices, selectedCardIds: next });
      setSelectedCardIds(next);
      setReviewed(response);
      if (needsExperienceDiscovery(db, discovery, next)) {
        setPending(null);
        setAnswer("");
        await nextQuestion(db, gaps, asked, MAX_QUESTIONS, turns, discovery, next);
      }
    });
  }
  const ranked = reviewed?.ranked ?? result?.ranked ?? [];
  const orderedRanked = db ? orderResumeCards(ranked, db, sortMode, ranked) : [];
  const orderedRewritten = reviewed && db ? orderResumeCards(reviewed.rewritten, db, sortMode, ranked) : [];
  const reviewCards = db ? reviewableCards(db, orderedRewritten) : [];
  const reviewableBulletCount = reviewCards.reduce((count, card) => count + card.rows.length, 0);

  const sources = useMemo(() => {
    const index = new Map<string, { text: string; field: string; source: string; status: string; card: string }>();
    for (const card of db?.cards ?? []) {
      for (const field of FACT_FIELDS) for (const fact of card[field]) {
        index.set(fact.id, { ...fact, field: FIELD_LABEL[field], card: card.name });
      }
      for (const outcome of card.outcomes) {
        index.set(outcome.id, { text: `${outcome.note}${outcome.value !== null ? `：${outcome.value} ${outcome.unit ?? ""}` : ""}${outcome.basis ? `（口径：${outcome.basis}）` : ""}`, field: "结果", source: outcome.source, status: outcome.status, card: card.name });
      }
    }
    return index;
  }, [db]);
  const preview = reviewed?.resume;
  const previewFrame = useRef<HTMLIFrameElement>(null);
  const [onePage, setOnePage] = useState(true);
  const [loadedPreview, setLoadedPreview] = useState<{ html: string; onePage: boolean; scale: number } | null>(null);
  const previewHTML = useMemo(() => (preview?.doc ? docToHTML(preview.doc) : ""), [preview]);
  const previewReady = loadedPreview?.html === previewHTML && loadedPreview.onePage === onePage;

  // Keep the session in this tab's sessionStorage so a refresh does not lose it. sessionStorage
  // is cleared when the tab closes, so the resume does not stay on the computer afterwards.
  const [restored, setRestored] = useState(false);
  const savedState = {
    cv, jdText, db, jd, gaps, asked, turns, pending, interviewDone, answer, chatLanguage, sortMode,
    selectedCardIds, discovery, regularSkipped, roundStart, result, choices, reviewed, evaluation, onePage, analyzedInputs, uploadInfo, detailsConfirmed,
  };
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      const saved = raw ? (JSON.parse(raw) as { version?: number; state?: Partial<typeof savedState> }) : null;
      if ((saved?.version === SESSION_VERSION || saved?.version === 2) && saved.state) {
        const s = saved.state;
        if (s.cv !== undefined) setCv(s.cv);
        if (s.jdText !== undefined) setJdText(s.jdText);
        if (s.detailsConfirmed !== undefined) setDetailsConfirmed(s.detailsConfirmed);
        if (s.db !== undefined) {
          let repaired = s.db;
          try { repaired = s.db ? repairOriginalBoundaries(s.db) : s.db; }
          catch (err) {
            s.result = null; s.reviewed = null; s.evaluation = null;
            setError(err instanceof Error ? err.message : String(err));
          }
          setDb(repaired);
          if (repaired !== s.db) {
            // Existing preview HTML and proposals may contain stale source text.
            s.result = null; s.reviewed = null; s.evaluation = null;
          }
        }
        if (s.jd !== undefined) setJd(s.jd);
        if (s.gaps !== undefined) setGaps(s.gaps);
        if (s.asked !== undefined) setAsked(s.asked);
        if (s.turns !== undefined) setTurns(s.turns);
        if (s.roundStart !== undefined) setRoundStart(Math.max(0, Math.min(s.roundStart, s.turns?.length ?? 0)));
        if (s.pending !== undefined) setPending(s.pending);
        if (s.interviewDone !== undefined) setInterviewDone(s.interviewDone);
        if (s.answer !== undefined) setAnswer(s.answer);
        if (s.chatLanguage !== undefined) setChatLanguage(s.chatLanguage);
        if (s.sortMode !== undefined) setSortMode(s.sortMode);
        if (s.selectedCardIds !== undefined) setSelectedCardIds(s.selectedCardIds);
        if (s.discovery !== undefined) setDiscovery(s.discovery);
        if (s.regularSkipped !== undefined) setRegularSkipped(s.regularSkipped);
        if (s.result !== undefined) setResult(s.result);
        if (s.choices !== undefined) setChoices(s.choices);
        if (s.reviewed !== undefined) setReviewed(s.reviewed);
        if (s.evaluation !== undefined) setEvaluation(s.evaluation);
        if (s.onePage !== undefined) setOnePage(s.onePage);
        if (s.analyzedInputs !== undefined) setAnalyzedInputs(s.analyzedInputs);
        if (s.uploadInfo !== undefined) setUploadInfo(s.uploadInfo);
      }
    } catch {
      // Storage blocked or data from an older version: start fresh.
    }
    setRestored(true);
  }, []);
  const savedJSON = JSON.stringify({ version: SESSION_VERSION, state: savedState });
  useEffect(() => {
    if (!restored) return; // never overwrite the saved session before it has been read
    try {
      sessionStorage.setItem(SESSION_KEY, savedJSON);
    } catch {
      // Storage full or blocked: the page still works, it just will not survive a refresh.
    }
  }, [restored, savedJSON]);

  async function preparePreview(frame: HTMLIFrameElement) {
    const doc = frame.contentDocument;
    if (!doc?.querySelector(".resume-content")) return;
    await doc.fonts.ready;
    if (frame !== previewFrame.current || doc !== frame.contentDocument || frame.srcdoc !== previewHTML) return;
    const scale = onePage ? fitResumeToOnePage(doc) : 1;
    frame.style.height = `${Math.ceil(doc.body.getBoundingClientRect().height) + 4}px`;
    setLoadedPreview({ html: previewHTML, onePage, scale });
  }

  function downloadPDF() {
    const frame = previewFrame.current?.contentWindow;
    if (!frame || !preview || !previewReady) return;
    // 打印窗口里选择「存储为 PDF」；文件名取自页面标题
    const original = document.title;
    document.title = resumeFileName(preview.doc, "pdf").replace(/\.pdf$/, "");
    frame.focus();
    frame.print();
    document.title = original;
  }

  async function downloadWord() {
    if (!preview || !previewReady || !loadedPreview) return;
    await guard("生成 Word 文件…", async () => {
      const { buildDocx } = await import("@/lib/resume-docx");
      const blob = await buildDocx(preview.doc, loadedPreview.scale);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = resumeFileName(preview.doc, "docx");
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
  const acceptedCount = reviewed?.stats?.accepted ?? 0;
  const retainedCount = reviewed?.stats?.retained ?? 0;
  const totalBullets = reviewed?.rewritten.reduce((n, c) => n + c.bullets.length, 0) ?? 0;
  const experienceBulletCount = preview?.experienceBulletCount ?? 0;
  const recordedExperienceCount = db ? countExperiences(db, selectedCardIds ?? undefined) : 0;
  const previewExperienceCount = preview?.experienceCount ?? 0;
  const experienceTargetMet = previewExperienceCount >= TARGET_EXPERIENCES || discovery.exhausted;
  const needsOriginals = !!result && (db?.cards ?? []).some((c) => c.original_bullets === undefined && FACT_FIELDS.some((f) => c[f].some((x) => x.source === "cv_parse")) && db?.affiliations.find((a) => a.id === c.affiliation_id)?.type !== "skills_list");

  const evaluationSignature = JSON.stringify({ cv, jdText, db, jd, gaps, sortMode, selectedCardIds, discovery, rewritten: result?.rewritten, choices });
  const currentEvaluation = evaluation?.signature === evaluationSignature ? evaluation.report : null;
  async function runEvaluation() {
    if (!db || !jd || !result || experienceBulletCount === 0 || !experienceTargetMet) return;
    const signature = evaluationSignature;
    await guard("正在评估简历质量…", async () => {
      const response = await call<{ evaluation: EvaluationReport }>({ step: "evaluate", cv, db, jd, gaps, sortMode, selectedCardIds: selectedCardIds ?? undefined, discovery, rewritten: result.rewritten, choices });
      setEvaluation({ signature, report: response.evaluation });
    });
  }

  const reqText = (id: string) => jd?.requirements.find((r) => r.id === id)?.text ?? id;
  const unconfirmedCount = db ? reviewFacts(db).filter(f => f.status !== "user_confirmed").length : 0;
  const cardName = (id: string) => db?.cards.find((c) => c.id === id)?.name ?? id;

  return (
    <main>
      <h1>
        Resume Agent · Demo v0 {mode && <span className={`mode ${!providerConfigured ? "mock" : mode}`}>{mode === "live" ? providerConfigured ? `LIVE · ${providerLabel}` : `${provider === "openai-compatible" ? "OpenAI 兼容接口" : "Anthropic API"} · 待配置` : "MOCK · 使用内置示例逻辑"}</span>}
      </h1>
      <p className="sub">
        CV + JD → 解析 → JD 匹配 → 缺口检测 → 针对性追问 → 选材排序 → 改写 → 定制简历。只有「已确认」的事实才会进入简历。
      </p>

      <section className="card">
        <h2>1. 输入：简历 CV 与目标 JD <Who kinds={["user"]} /></h2>
        <p className="note">你提供原材料。上传文件的文字提取由代码完成，不用 AI。点「解析简历，开始核对」后，先检查第 2 步的解析结果；确认后才进入 JD 分析与匹配。</p>
        <div className="row" style={{ marginTop: 0, marginBottom: 10 }}>
          <label className="upload">
            上传简历（PDF / Word / TXT）
            <input
              type="file"
              accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
              disabled={!!busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadResume(f);
                e.target.value = "";
              }}
            />
          </label>
          <span className="note">{uploadInfo ?? "支持 PDF、Word（.docx）和 TXT，每个文件不超过 10MB。扫描件暂不支持，也可以直接粘贴文字。"}</span>
        </div>
        <div className="row" style={{ marginTop: 0, marginBottom: 10 }}>
          <label>
            沟通语言{" "}
            <select value={chatLanguage} onChange={(e) => setChatLanguage(e.target.value as Lang)} disabled={!!busy}>
              {LANGS.map((l) => <option key={l} value={l}>{LANG_LABEL[l]}</option>)}
            </select>
          </label>
          <span className="note">追问用这个语言提出，回答用中文或英文都可以。生成的简历始终和上传的简历语言一致，不受这里影响。</span>
        </div>
        <JobPicker disabled={!!busy} onUse={setJdText} />
        <div className="grid2">
          <label className="input-field"><span>您的简历：</span><textarea value={cv} onChange={(e) => { setCv(e.target.value); setUploadInfo(null); }} disabled={!!busy} /></label>
          <label className="input-field"><span>您的JD：</span><textarea value={jdText} onChange={(e) => setJdText(e.target.value)} disabled={!!busy} /></label>
        </div>
        {mode === "mock" && (
          <p className="note">Mock 模式只认识内置的示例 CV/JD；换成别的文本需要配置模型的 API key（模板见 .env.example）。</p>
        )}
        {provider === "anthropic" && !providerConfigured && <p className="note" role="status">已切换为 Anthropic API。请在项目根目录的 .env.local 中填写 ANTHROPIC_API_KEY，再重启开发服务并刷新页面。</p>}
        {provider === "openai-compatible" && !providerConfigured && <p className="note" role="status">已切换为 OpenAI 兼容接口。请在项目根目录的 .env.local 中填写 LLM_BASE_URL、LLM_API_KEY 和 LLM_MODEL，再重启开发服务并刷新页面。</p>}
        <div className="row">
          <button onClick={runAnalysis} disabled={!!busy || !!missingInput}>解析简历，开始核对</button>
          {busy ? <span className="note">{busy}</span> : missingInput && <span className="note" role="status">{missingInput}</span>}
        </div>
        <p className="note">进度只保存在当前标签页：刷新页面不会丢失，关闭标签页后自动清除。</p>
        {inputsStale && analyzedInputs && (
          <div className="err" role="alert">
            简历或 JD 已经改过，下面的结果还是根据修改前的材料生成的，追问、生成、下载和评估都已暂停。请重新点「解析简历，开始核对」；如果是误改，也可以恢复修改前的材料，继续使用现有结果。
            <div className="row"><button className="ghost" disabled={!!busy} onClick={() => { setCv(analyzedInputs.cv); setJdText(analyzedInputs.jd); setUploadInfo(null); }}>恢复修改前的简历和 JD</button></div>
          </div>
        )}
        {error && <div className="err">出错：{error}</div>}
      </section>

      {db && (
        <section className="card review-workspace">
          <h2>2. 简历解析 → 经历库 Experience DB <Who kinds={["ai", "user"]} /></h2>
          <p className="note">这里展示 AI 对材料的理解，不等于你已经确认。请对照原文核对每条信息：来源和核对状态分别显示，确认只代表本人认可，不代表系统核实了真实性。</p>
          <div className="review-mobile-switch" role="group" aria-label="核对视图">
            <button className="small ghost" aria-pressed={reviewPane === "source"} onClick={() => setReviewPane("source")}>查看原文</button>
            <button className="small ghost" aria-pressed={reviewPane === "fields"} onClick={() => setReviewPane("fields")}>核对与修改</button>
          </div>
          <div className={`review-columns review-show-${reviewPane}`}>
            <aside className="review-source-panel" aria-labelledby="review-source-title">
              <div className="review-panel-heading"><div><span className="review-step-label">对照材料</span><h3 id="review-source-title">原简历文字</h3></div><span className="chip">只读</span></div>
              <p className="note">本次解析使用的完整文字。右侧修改不会改变这份原文。</p>
              <pre className="source-cv" tabIndex={0} aria-label="本次解析的原简历文字">{analyzedInputs?.cv ?? cv}</pre>
            </aside>
            <div className="review-fields-panel" role="region" aria-labelledby="review-fields-title" tabIndex={0}>
              <div className="review-panel-heading"><div><span className="review-step-label">逐项核对</span><h3 id="review-fields-title">解析结果与修改</h3></div><span className="chip">你来确认</span></div>
          {jd ? <div className="row"><button className="ghost" disabled={locked} onClick={reopenReview}>重新核对经历库（清除后续结果）</button><span className="note">修改前先返回核对；追问中新增的信息也在这里确认。</span></div> : <ResumeDetailsReview db={db} disabled={locked || reviewEditing > 0} onChange={updateReviewedDB} onDraftChange={setNewEntryDraft} />}

          <div className="row" style={{ marginTop: 0 }}>
            <label>
              简历目标语言{" "}
              <select
                value={db.resume_language ?? "en"}
                disabled={locked || !!result}
                onChange={(e) => setDb({ ...db, resume_language: e.target.value as Lang })}
              >
                {LANGS.map((l) => <option key={l} value={l}>{LANG_LABEL[l]}</option>)}
              </select>
            </label>
            <span className="note">
              {result
                ? "简历已生成，目标语言不能再改；需要换语言请重新点「解析简历，开始核对」。"
                : "根据上传的简历自动识别。回答追问时记录的事实、改写的 bullet 和最终简历都统一用这个语言；识别不对可以在这里改。"}
            </span>
          </div>
          {jd && (db.education ?? []).map((e) => (
            <div className="cardbox" key={e.id}>
              <h3>{e.school} <span className="chip">{e.id}</span></h3>
              <div className="org">
                教育经历 · {[e.degree, e.field].filter(Boolean).join(", ") || "学位未写明"}
                {(e.start_date || e.end_date) && ` · ${[e.start_date, e.end_date].filter(Boolean).join(" – ")}`}
              </div>
              {e.location && <div className="fact"><span className="f">地点</span>{e.location}</div>}
              {e.gpa && <div className="fact"><span className="f">GPA</span>{e.gpa}</div>}
              {e.details.map((d, i) => (
                <div className="fact" key={i}><span className="f">补充</span>{d}</div>
              ))}
            </div>
          ))}
          <ExperienceReview db={db} disabled={locked} readOnly={!!jd} onChange={updateReviewedDB} onConfirm={confirmInterviewFacts} onEditing={(active) => setReviewEditing((n) => n + (active ? 1 : -1))} />
          {!jd && <div className="review-continue">
            {newEntryDraft && <p className="note" role="status">请先保存或取消新增内容，再继续。</p>}
            <label><input type="checkbox" checked={detailsConfirmed} disabled={locked} onChange={(e) => setDetailsConfirmed(e.target.checked)} /> 我已对照原文核对姓名、联系方式、教育经历、单位、职位和日期</label>
            <div className="row"><button disabled={locked || newEntryDraft || reviewEditing > 0 || !detailsConfirmed || reviewFacts(db).some((f) => f.status !== "user_confirmed")} onClick={continueAfterReview}>核对完成，继续 JD 分析与匹配</button></div>
            <p className="note">请先确认或删除全部事实，再继续。修改或删除事实后，该经历的旧原句不再自动保留；后续新建议需要逐条接受。</p>
          </div>}

            </div>
          </div>
        </section>
      )}

      {jd && (
        <section className="card">
          <h2>3. JD 分析 · 匹配 · 缺口检测 <Who kinds={["ai", "rule"]} /></h2>
          <p className="note">
            <b>AI</b> 做两件事：把 JD 拆成一条条要求；逐条要求去经历库里找证据（必须指出具体哪条事实）。
            <b>代码规则</b>再据此判定状态，不让 AI 拍板：已覆盖＝有你本人的动作和已确认的结果；偏弱＝有证据但缺动作或结果；未知＝没找到证据，值得问；真缺口＝你被问过并回答没有。
          </p>
          <p className="note">{jd.role_title} · {jd.domain} · {jd.seniority}</p>
          <EducationNotice checks={educationChecks} education={db?.education ?? []} />
          <table>
            <thead><tr><th>要求</th><th>优先级</th><th>状态</th><th>原因</th><th>证据</th></tr></thead>
            <tbody>
              {matchingGaps.map((g) => {
                const r = jd.requirements.find((x) => x.id === g.requirement_id)!;
                return (
                  <tr key={g.requirement_id}>
                    <td>{r.text}</td>
                    <td>{r.priority}</td>
                    <td><span className={`chip ${g.status}`}>{isEducationRequirement(r) ? g.status === "covered" ? "教育条件已匹配" : g.status === "true_gap" ? "教育要求风险" : "教育资格待核实" : GAP_LABEL[g.status]}</span></td>
                    <td>{g.reason}</td>
                    <td className="note">{g.evidence_fact_ids.join(", ") || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!pending && !interviewDone && turns.length === 0 && (
            <div className="row"><button onClick={startInterview} disabled={locked}>开始针对性追问</button></div>
          )}
        </section>
      )}

      {jd && (turns.length > 0 || pending || interviewDone) && (
        <section className="card">
          <h2>4. 针对性追问{TARGET_EXPERIENCES > 0 ? "与补充经历" : ""} <Who kinds={["rule", "ai", "user"]} /></h2>
          <p className="note">
            <b>代码规则</b>挑下一个最值得问的缺口（按优先级）；<b>AI</b>把它说成一句话，并把你的回答整理成事实；<b>你</b>回答，没做过就写「没有」。
            回答后会回到第 3 步重新匹配，缺口状态随之更新。每轮 JD 针对性追问最多 {MAX_QUESTIONS} 题，结束后可换一组问题。{TARGET_EXPERIENCES > 0 && `不足 ${TARGET_EXPERIENCES} 段时，另行追问课程、小组作业或其他相关经历。确实没有就按现有数量继续，不为凑数编造经历。`}
          </p>
          {roundStart > 0 && <>
            <details><summary>查看此前的追问与回答（{roundStart} 条）</summary>
              {turns.slice(0, roundStart).map((t, i) => <div className="qa" key={i}>
                {t.requirement && <div className="question-context"><b>对应的 JD 要求（解析结果）</b><p>{t.requirement.text}</p></div>}
                <div className="q">历史问答 {i + 1}：<span className="question-text">{t.question}</span></div>
                <div className="a">{t.answer}</div>
              </div>)}
            </details>
            <h3>新一轮针对性追问</h3>
            <p className="note">本轮从 Q1 开始，最多 3 题。此前已记录的信息继续保留。</p>
          </>}
          {turns.slice(roundStart).map((t, i) => (
            <div className="qa" key={i}>
              {t.kind !== "experience" && t.requirement && <div className="question-context"><b>对应的 JD 要求（解析结果）</b><p>{t.requirement.text}</p></div>}
              <div className="q">Q{i + 1}{t.kind === "experience" ? "（补充经历）" : ""}：<span className="question-text">{t.question}</span></div>
              <div className="a">{t.answer}</div>
              <div className="note">{t.kind === "experience" ? t.note : t.has_experience ? `已记录 ${t.added_ids.length} 条新事实，上表蓝底高亮` : "你确认没有相关经历 → 该要求记为真缺口"}</div>
            </div>
          ))}
          {pending && (
            <div className="qa">
              {pending.kind === "gap" && <div className="question-context"><b>对应的 JD 要求（解析结果）</b><p>{pending.requirement.text}</p><p><b>目前的证据情况：</b>{pending.gap.reason}</p><p className="note">这里说明的是已确认信息是否充分，不代表你没有这项能力。请按实际情况回答，没有相关经历也可以直接说明。</p></div>}
              <div className="q">Q{turns.length - roundStart + 1}{pending.kind === "experience" ? "（补充经历）" : ""}：<span className="question-text">{pending.question}</span></div>
              <textarea className="short" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder={chatLanguage === "en" ? "Answer directly; write \"no\" if you have not done it" : "直接回答；没做过就写“没有”"} />
              <div className="row">
                <button onClick={() => submitAnswer()} disabled={locked || !answer.trim()}>提交回答</button>
                {pending.kind === "experience"
                  ? <button className="ghost" onClick={continueWithCurrentExperiences} disabled={locked}>确实没有其他经历，按现有数量继续</button>
                  : <button className="ghost" onClick={skipRegularQuestions} disabled={locked}>跳过剩余 JD 问题</button>}
                {pending.kind === "experience" && result && db && countExperiences(db) >= TARGET_EXPERIENCES && <button className="ghost" disabled={locked} onClick={restoreExistingExperiences}>恢复全部已有经历</button>}
                {busy && <span className="note">{busy}</span>}
              </div>
            </div>
          )}
          {!pending && !interviewDone && turns.length > 0 && (
            busy ? <p className="note" role="status">正在准备下一条追问，请稍候…</p> : <>
              {error ? <p className="err" role="alert">{error}</p> : <p className="note">可以继续获取下一条追问；经历库核对后的修改会用于新的匹配和问题。</p>}
              <div className="row">
                <button onClick={retryNextQuestion}>重试获取下一题</button>
                <button className="ghost" onClick={skipRegularQuestions}>跳过剩余 JD 问题</button>
              </div>
            </>
          )}
          {interviewDone && <p className="note">本轮追问结束。{discovery.exhausted && recordedExperienceCount < TARGET_EXPERIENCES ? `你已确认没有其他经历，将按现有 ${recordedExperienceCount} 段继续，不强制三段。` : ""}</p>}
          {interviewDone && !pending && <div className="row"><button className="ghost" onClick={restartInterview} disabled={locked}>重新开始针对性追问环节</button><span className="note">换一组问题，每轮最多 3 题。保留此前回答与确认信息；没有更多适合的问题时会直接结束。</span></div>}
        </section>
      )}

      {jd && interviewDone && !pending && (
        <section className="card">
          <h2>5. 选材排序 · 改写 · 生成简历 <Who kinds={["rule", "ai", "rule"]} /></h2>
          <p className="note">
            <b>代码规则</b>按 JD 匹配证据给经历排序并提示证据情况；<b>你</b>决定保留哪些经历；<b>AI</b>逐条提出改写建议。未修改经历库的经历保留原句；核对时修改过事实的经历需要接受新建议后才加入。只有点「接受这条」且改写通过校验才替换。
          </p>
          <fieldset className="resume-sort" disabled={locked || editing !== null}>
            <legend>最终简历的经历排序</legend>
            {(["relevance", "chronological"] as const).map((value) => <label key={value}>
              <input type="radio" name="resume-sort" value={value} checked={sortMode === value} onChange={() => changeSortMode(value)} /> {SORT_LABELS[value]}
            </label>)}
            <p className="note">{sortMode === "relevance" ? "优先展示与目标 JD 更相关的经历。" : "正在进行的经历优先，再按结束、开始时间倒序；日期未知的放最后，同日期按 JD 匹配度排列。项目沿用所属经历的日期。"} 切换排序会保留选择和编辑，不会重新调用 AI。经历是否保留由你决定。</p>
          </fieldset>
          {db && unconfirmedCount > 0 && <div className="question-context" role="region" aria-label="生成前待确认信息">
            <h3>还有 {unconfirmedCount} 条信息需要你确认</h3>
            <p>追问回答由 AI 整理后仍需本人核对，确认完成才能生成简历。请核对以下内容；不准确时可返回第 2 步修改或删除。</p>
            {db.cards.map(card => {
              const facts = reviewFacts({ ...db, cards: [card] }).filter(f => f.status !== "user_confirmed");
              return facts.length > 0 && <div key={card.id}>
                <h4>{card.name}</h4>
                {facts.map(f => <div className="qa" key={f.id}>
                  <p>{"text" in f ? f.text : [f.note, f.value != null ? `${f.value} ${f.unit ?? ""}` : null, f.basis].filter(Boolean).join(" · ")}</p>
                  <button className="small ghost" disabled={locked} onClick={() => confirmInterviewFacts([f.id])}>我已核对，确认这条信息</button>
                </div>)}
              </div>;
            })}
          </div>}
          {inputsStale && <p className="err" role="alert">简历或 JD 输入已变更，请先重新解析或恢复原文，再生成简历。</p>}
          <div className="row">
            <button onClick={finish} disabled={locked || unconfirmedCount > 0}>生成简历</button>
            {busy && <span className="note" role="status">{busy}</span>}
          </div>
          {error && unconfirmedCount === 0 && <p className="err" role="alert">{error}</p>}
          {result && (
            <>
              <h2 style={{ marginTop: 16 }}>经历排序与保留</h2>
              <p className="note">默认保留全部经历，证据不足或暂未匹配也会列出。取消勾选才会从简历中移除；重新勾选会恢复原来的审阅选择，不会重新调用 AI。追问新增内容仍需在下方逐条接受后才写入简历。</p>
              <p className="note" role="status">当前保留 {recordedExperienceCount} 段经历。{TARGET_EXPERIENCES > 0 && <>目标至少 {TARGET_EXPERIENCES} 段，实习或项目均可。{discovery.exhausted ? "你已确认没有其他可保留经历，可按现有数量继续。" : "不足时会先触发补充经历追问。"}</>}</p>
              <table>
                <thead><tr><th>经历</th><th>JD 匹配得分</th><th>经历时间</th><th>证据情况</th><th>保留经历</th><th>理由</th></tr></thead>
                <tbody>
                  {orderedRanked.map((r) => (
                    <tr key={r.card_id}>
                      <td>{cardName(r.card_id)}</td>
                      <td>{r.score}</td>
                      <td>{(() => { const card = db?.cards.find((c) => c.id === r.card_id); const aff = db?.affiliations.find((a) => a.id === card?.affiliation_id); return [aff?.start_date, aff?.end_date].filter(Boolean).join(" – ") || "日期未知"; })()}</td>
                      <td><span className={`chip ${r.evidence_status === "supported" ? "covered" : r.evidence_status === "insufficient" ? "weak" : "unknown"}`}>{CARD_EVIDENCE_LABELS[r.evidence_status] ?? "待重新生成"}</span></td>
                      <td><label><input type="checkbox" aria-label={`保留经历：${cardName(r.card_id)}`} checked={r.included} disabled={locked || editing !== null} onChange={(e) => changeCardSelection(r.card_id, e.target.checked)} /> 保留</label></td>
                      <td className="note">{r.reasons.join("；")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <h2 style={{ marginTop: 16 }}>改写对照与逐条审阅</h2>
              {needsOriginals ? <p className="note" role="status">当前结果来自旧版，请点「生成简历」补齐完整原句，已有追问记录会保留。</p> : <p className="note" role="status">共 {totalBullets} 条，其中改动或新增建议 {reviewableBulletCount} 条；已接受 {acceptedCount} 条，保留原句 {retainedCount} 条，已排除 {reviewed?.stats?.excluded ?? 0} 条。未选择时保留原句，接受后才替换；排除会删除整条。</p>}
              <p className="note">这里只列出有改动或新增的建议；未改动的 bullet 自动保留，不需要接受或排除。左侧显示原简历的完整 bullet（包含续行和分句）。追问补充或经历库核对后重新生成的新增建议需接受后才加入。数字会按来源逐项检查单位、指标、归属和限制说明；对应关系无法确认时拦截改写并保留原句。规则检查不等于外部事实核实，请同时核实职责与个人贡献。</p>
              {!needsOriginals && reviewableBulletCount === 0 && <p className="note" role="status">当前没有需要审阅的改动。未改动的原句会保留在下方简历中。</p>}
              {(!needsOriginals ? reviewCards : []).map((rc) => (
                <div className="cardbox" key={rc.card_id}>
                  <h3>{cardName(rc.card_id)}</h3>
                  {rc.rows.map(({ bullet: b, index: i, key, sourceBullet }) => {
                    const original = result.rewritten.find((c) => c.card_id === rc.card_id)?.bullets.find((candidate, index) => bulletKey(rc.card_id, index, candidate.original_bullet_id, candidate.source_ids) === key)
                      ?? { ...b, text: sourceBullet?.text ?? b.text, has_suggestion: false };
                    const status = choices[key]?.status ?? "pending";
                    const label = status === "excluded" ? "已排除" : !b.ok ? "改写已拦截" : status === "accepted" ? "已接受" : sourceBullet ? "待审阅 · 保留原句" : "待接受 · 新增建议";
                    return (
                      <article className="bullet-review" key={key} aria-label={`${cardName(rc.card_id)} 第 ${i + 1} 条审阅`}>
                        <div className="review-heading"><b>Bullet {i + 1}</b><span className={`chip ${!b.ok ? "blocked" : status === "accepted" ? "user_confirmed" : "unknown"}`}>{label}</span></div>
                        <div className="grid2">
                          <div className="review-panel">
                            <h4>改写前 · 原简历整条 bullet</h4>
                            {sourceBullet ? <p className="bullet-text">{sourceBullet.text}</p> : <p className="note">这条是追问补充或经历库核对后重新生成的建议，没有可直接保留的原句；未接受时不会加入简历。</p>}
                            <details><summary>查看支持改写的来源事实</summary>
                            {original.source_ids.filter((id) => id !== original.original_bullet_id).map((id) => {
                              const fact = sources.get(id);
                              return <div className="source-fact" key={id}>
                                {fact ? <><p>{fact.text}</p><span className="note">{fact.field} · {fact.source === "cv_parse" ? "简历解析" : fact.source === "dialogue" ? "追问补充" : "用户编辑"} · {STATUS_LABEL[fact.status as keyof typeof STATUS_LABEL]} · {id}{fact.card !== cardName(rc.card_id) ? ` · 来自「${fact.card}」` : ""}</span></> : <p className="err">找不到来源 {id}</p>}
                              </div>;
                            })}
                            {original.source_ids.every((id) => id === original.original_bullet_id) && <p className="note">依据左侧完整原句。</p>}
                            </details>
                          </div>
                          <div className="review-panel">
                            <h4>改写建议 · {b.text !== original.text ? "你的修改稿" : original.has_suggestion === false ? "暂保留原句" : "AI 建议稿"}</h4>
                            {editing === key ? <>
                              <textarea className="short" aria-label={`编辑 ${cardName(rc.card_id)} 第 ${i + 1} 条`} value={editText} onChange={(e) => setEditText(e.target.value)} disabled={locked} />
                              <div className="row"><button disabled={locked || !editText.trim()} onClick={() => reviewBullet(key, editText, "pending")}>保存并重新校验</button><button className="ghost" disabled={locked} onClick={() => setEditing(null)}>取消</button></div>
                            </> : <p className="bullet-text">{b.text}</p>}
                            {b.text !== original.text && <details><summary>查看 AI 原建议</summary><p>{original.text}</p></details>}
                            <p className={`note ${!b.ok ? "err" : ""}`}>{b.ok ? "来源及数字对应规则未发现冲突；仍需核实事实" : b.issues.join("；")}</p>
                            <p className="note">{status === "excluded" ? "本条已从最终简历排除。" : status === "accepted" && b.ok ? "最终简历使用这条改写稿。" : sourceBullet ? "最终简历保留左侧原句。编辑保存后仍需点「接受这条」才替换。" : "本条尚未加入最终简历。"}</p>
                            <div className="row">
                              <button disabled={locked || !b.ok || editing !== null || status === "accepted"} onClick={() => reviewBullet(key, b.text, "accepted")}>接受这条</button>
                              <button className="ghost" disabled={locked || editing !== null} onClick={() => { setEditing(key); setEditText(b.text); }}>编辑</button>
                              <button className="ghost" disabled={locked || editing !== null || status === "excluded"} onClick={() => reviewBullet(key, b.text, "excluded")}>排除这条</button>
                              {status !== "pending" && <button className="ghost" disabled={locked || editing !== null} onClick={() => reviewBullet(key, b.text, "pending")}>撤回选择</button>}
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ))}

              <h2 style={{ marginTop: 16 }}>{experienceTargetMet ? "最终简历" : "简历预览 · 待补足经历"} · 预览与下载</h2>
              {!experienceTargetMet && <div className="warn" role="status">
                <p>当前预览有 {previewExperienceCount} 段经历，目标至少 {TARGET_EXPERIENCES} 段。已记录的新增经历需要先在上方接受描述才会加入；也可以恢复被排除的原句。确实没有其他可保留经历时，可按现有数量继续。</p>
                <button className="ghost" disabled={locked || editing !== null} onClick={continueWithCurrentExperiences}>没有其他可保留经历，按现有数量继续</button>
              </div>}
              <p className="note">当前简历保留 {retainedCount} 条原句，使用 {acceptedCount} 条已接受的改写或新增描述。未操作的原句会保留。</p>
              <p className="note">当前排序：{SORT_LABELS[sortMode]}</p>
              <p className="note">下面的预览和导出的 PDF 是同一份排版，排序、保留和已接受的改写都会同步。点「下载 PDF」会打开打印窗口，在目标打印机里选择「存储为 PDF」即可保存；「下载 Word」直接下载 .docx 文件，可以继续在 Word 里修改。</p>
              <fieldset className="resume-sort" disabled={locked || needsOriginals}>
                <legend>简历页数</legend>
                <label>
                  <input type="radio" name="resume-pagination" checked={onePage} onChange={() => { setLoadedPreview(null); setOnePage(true); }} />
                  压缩至 1 页（推荐）
                </label>
                <label>
                  <input type="radio" name="resume-pagination" checked={!onePage} onChange={() => { setLoadedPreview(null); setOnePage(false); }} />
                  自然分页
                </label>
              </fieldset>
              {onePage && <p className="note">PDF 按 Letter 纸张压缩为一页。Word 会应用相近的字号和间距，实际页数取决于字体和 Word 的排版。</p>}
              {onePage && previewReady && loadedPreview && loadedPreview.scale * 10.5 < 8 && (
                <p className="warn" role="status">内容较多，压缩后的字号偏小。可切回自然分页以便阅读。</p>
              )}
              {needsOriginals ? <p className="note" role="status">请重新生成简历以显示完整原句。</p> : previewHTML && (
                <iframe
                  key={onePage ? "one-page" : "natural"}
                  ref={previewFrame}
                  className="resume-preview"
                  title="简历预览"
                  srcDoc={previewHTML}
                  onLoad={(e) => void preparePreview(e.currentTarget)}
                />
              )}
              <div className="row">
                <button disabled={locked || needsOriginals || experienceBulletCount === 0 || !experienceTargetMet || editing !== null || !previewReady} onClick={downloadPDF}>下载 PDF</button>
                <button disabled={locked || needsOriginals || experienceBulletCount === 0 || !experienceTargetMet || editing !== null || !previewReady} onClick={downloadWord}>下载 Word</button>
              </div>
              <details>
                <summary>查看 Markdown 原文</summary>
                <pre className="out">{needsOriginals ? "请重新生成简历以显示完整原句。" : preview?.markdown}</pre>
              </details>
              <p className="note">
                JD 覆盖：已覆盖 {preview?.coverage.covered} · 偏弱 {preview?.coverage.weak} · 未知 {preview?.coverage.unknown} · 真缺口 {preview?.coverage.true_gap}
              </p>
              {!!preview?.warnings.length && (
                <ul className="warn">{preview?.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
              )}
              <div className="row">
                <button className="ghost" disabled={locked || needsOriginals || experienceBulletCount === 0 || !experienceTargetMet || editing !== null} onClick={() => preview && navigator.clipboard.writeText(preview.markdown)}>复制 Markdown</button>
              </div>
              <div className="evaluation-section">
                <h2>简历质量评估 <Who kinds={["ai", "rule"]} /></h2>
                <p className="note">对比原简历与当前预览稿（保留的原句及已接受的改写），按六个维度评估，并核验引用能否在原文中找到。每项 0–3 分，无法判断时不评分。建议仍需你审阅，评估不会自动修改简历。</p>
                <p className="note">这是文字内容评估，不包含版式、PDF 解析测试或 ATS 通过率预测。LIVE 模式点击后调用一次模型，使用你的 API 额度。</p>
                <button disabled={locked || needsOriginals || experienceBulletCount === 0 || !experienceTargetMet || editing !== null} onClick={runEvaluation}>{currentEvaluation ? "重新评估" : "评估当前简历"}</button>
                {busy === "正在评估简历质量…" && <p role="status">正在评估简历质量…</p>}
                {evaluation && !currentEvaluation && <p className="note">简历或审阅内容已变化，请重新评估。</p>}
                {currentEvaluation && <>
                  <ScoreComparison report={currentEvaluation} />
                  <p>{currentEvaluation.summary}</p>
                  {currentEvaluation.warnings.length > 0 && <ul className="warn">{currentEvaluation.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
                  {currentEvaluation.dimensions.map((dimension) => <div className="cardbox" key={dimension.id}>
                    <h3 id={`evaluation-evidence-${dimension.id}`} className="evaluation-evidence-title">{DIMENSIONS[dimension.id]}</h3>
                    <div className="grid2">{(["before", "after"] as const).map((version) => <div className="review-panel" key={version}>
                      <h4>{version === "before" ? "原简历" : "当前稿"} · {dimension[version].score === null ? "暂不评分" : `${dimension[version].score} / 3`}</h4>
                      <p>{dimension[version].reason}</p>
                      {dimension[version].evidence.map((e, i) => <blockquote key={i}><span className="note">{{ before: "原简历", after: "当前稿", confirmed: "已确认事实", jd: "岗位要求" }[e.source]}</span><br />{e.quote}</blockquote>)}
                    </div>)}</div>
                    {dimension.missing.length > 0 && <><b>缺失信息</b><ul>{dimension.missing.map((m, i) => <li key={i}>{m}</li>)}</ul></>}
                    <p><b>建议：</b>{dimension.suggestion}</p>
                  </div>)}
                  <h3 id="evaluation-fact-risks" className="evaluation-evidence-title">需要核实的事实风险</h3>
                  {currentEvaluation.fact_risks.length ? currentEvaluation.fact_risks.map((risk, i) => <div className="cardbox" key={i}><blockquote>{risk.quote}</blockquote><p>{risk.reason}</p><span className="note">来源事实：{risk.source_ids.join("、") || "未找到支持事实，需用户核实"}</span></div>) : <p className="note">本次未报告具体风险；这不等于内容已获得外部核实。</p>}
                  {currentEvaluation.next_actions.length > 0 && <><h3>优先改进建议</h3><ol>{currentEvaluation.next_actions.map((action, i) => <li key={i}>{action}</li>)}</ol></>}
                </>}
              </div>
            </>
          )}
        </section>
      )}
    </main>
  );
}
