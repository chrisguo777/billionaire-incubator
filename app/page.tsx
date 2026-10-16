"use client";

import { useEffect, useMemo, useState } from "react";
import { SAMPLE_CV, SAMPLE_JD } from "@/lib/sample";
import { FACT_FIELDS } from "@/lib/schema";
import type { Asked, ExperienceDB, Gap, GapStatus, JDAnalysis, Requirement } from "@/lib/schema";
import type { RankedCard, ResumeOutput, RewrittenCard } from "@/lib/pipeline";

const MAX_QUESTIONS = 3; // 追问停止条件尚未最终确定，demo 先固定为 3 题

const GAP_LABEL: Record<GapStatus, string> = {
  covered: "已覆盖 Covered",
  weak: "证据偏弱 Weak",
  unknown: "未知 Unknown",
  true_gap: "真缺口 True Gap",
};
const STATUS_LABEL = { user_confirmed: "已确认", ai_inferred: "待确认", missing: "缺失" } as const;
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
  requirement: Requirement;
  question: string;
  answer: string;
  has_experience: boolean;
  added_ids: string[];
}
interface Pending {
  gap: Gap;
  requirement: Requirement;
  question: string;
}
interface FinishResult {
  ranked: RankedCard[];
  rewritten: RewrittenCard[];
  resume: ResumeOutput;
}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch("/api/step", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "request failed");
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
  const [cv, setCv] = useState(SAMPLE_CV);
  const [jdText, setJdText] = useState(SAMPLE_JD);
  const [db, setDb] = useState<ExperienceDB | null>(null);
  const [jd, setJd] = useState<JDAnalysis | null>(null);
  const [gaps, setGaps] = useState<Gap[]>([]);
  const [asked, setAsked] = useState<Asked>({});
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [interviewDone, setInterviewDone] = useState(false);
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<FinishResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadInfo, setUploadInfo] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/step").then((r) => r.json()).then((d) => setMode(d.mode)).catch(() => {});
  }, []);

  const newIds = useMemo(() => new Set(turns.flatMap((t) => t.added_ids)), [turns]);

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
    await guard("解析简历和 JD…", async () => {
      setTurns([]);
      setAsked({});
      setPending(null);
      setInterviewDone(false);
      setResult(null);
      const p = await call<{ db: ExperienceDB }>({ step: "parse", cv });
      const j = await call<{ jd: JDAnalysis }>({ step: "jd", jd: jdText });
      const a = await call<{ gaps: Gap[] }>({ step: "analyze", db: p.db, jd: j.jd, asked: {} });
      setDb(p.db);
      setJd(j.jd);
      setGaps(a.gaps);
    });
  }

  async function uploadCvFile(file: File) {
    await guard("提取简历文字…", async () => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/pdf", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "简历文件上传失败");
      setCv(data.text);
      setUploadInfo(data.format === "pdf" ? `已从 ${data.name} 提取 ${data.pages} 页文字，请检查下方文本是否完整` : `已从 ${data.name} 提取文字，请检查下方文本是否完整`);
    });
  }

  async function nextQuestion(
    currentDb: ExperienceDB,
    currentGaps: Gap[],
    currentAsked: Asked,
    count: number,
    history: { question: string; answer: string }[] = [],
  ) {
    if (!jd || count >= MAX_QUESTIONS) {
      setPending(null);
      setInterviewDone(true);
      return;
    }
    const q = await call<{ done?: boolean } & Partial<Pending>>({
      step: "question",
      db: currentDb,
      jd,
      gaps: currentGaps,
      asked: currentAsked,
      history,
    });
    if (q.done || !q.gap) {
      setPending(null);
      setInterviewDone(true);
    } else {
      setPending({ gap: q.gap, requirement: q.requirement!, question: q.question! });
    }
  }

  async function startInterview() {
    if (!db) return;
    await guard("生成第一个问题…", () => nextQuestion(db, gaps, asked, 0));
  }

  async function submitAnswer() {
    if (!db || !jd || !pending || !answer.trim()) return;
    await guard("整理你的回答、重新匹配…", async () => {
      const r = await call<{ db: ExperienceDB; asked: Asked; gaps: Gap[]; added_ids: string[]; has_experience: boolean }>({
        step: "answer",
        db,
        jd,
        gap: pending.gap,
        question: pending.question,
        answer,
        asked,
      });
      const turn: Turn = {
        requirement: pending.requirement,
        question: pending.question,
        answer,
        has_experience: r.has_experience,
        added_ids: r.added_ids,
      };
      setTurns((t) => [...t, turn]);
      setPending(null);
      setDb(r.db);
      setAsked(r.asked);
      setGaps(r.gaps);
      setAnswer("");
      await nextQuestion(r.db, r.gaps, r.asked, turns.length + 1, [...turns, turn]);
    });
  }

  async function confirmOutcome(outcomeId: string) {
    if (!db || !jd) return;
    const next = structuredClone(db);
    for (const c of next.cards) for (const o of c.outcomes) if (o.id === outcomeId) o.status = "user_confirmed";
    await guard("更新匹配…", async () => {
      const a = await call<{ gaps: Gap[] }>({ step: "analyze", db: next, jd, asked });
      setDb(next);
      setGaps(a.gaps);
    });
  }

  async function finish() {
    if (!db || !jd) return;
    await guard("选择经历、改写 bullet、检查事实…", async () => {
      setResult(await call<FinishResult>({ step: "finish", db, jd, gaps }));
    });
  }

  const reqText = (id: string) => jd?.requirements.find((r) => r.id === id)?.text ?? id;
  const cardName = (id: string) => db?.cards.find((c) => c.id === id)?.name ?? id;

  return (
    <main>
      <h1>
        Resume Agent · Demo v0 {mode && <span className={`mode ${mode}`}>{mode === "live" ? "LIVE · 真实模型" : "MOCK · 无 API Key，使用内置示例逻辑"}</span>}
      </h1>
      <p className="sub">
        CV + JD → 解析 → JD 匹配 → 缺口检测 → 针对性追问 → 选材排序 → 改写 → 定制简历。只有「已确认」的事实才会进入简历。
      </p>

      <section className="card">
        <h2>1. 输入：简历 CV 与目标 JD <Who kinds={["user"]} /></h2>
        <p className="note">你提供原材料。PDF 和 Word 的文字提取由代码完成，不用 AI。点「解析并分析」后，AI 会依次完成第 2、3 步。</p>
        <div className="row" style={{ marginTop: 0, marginBottom: 10 }}>
          <label className="upload">
            上传简历文件
            <input
              type="file"
              accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx"
              disabled={!!busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadCvFile(f);
                e.target.value = "";
              }}
            />
          </label>
          <span className="note">{uploadInfo ?? "支持可复制文字的 PDF 和 Word .docx；扫描件暂不支持。也可以直接在左侧粘贴简历文字。"}</span>
        </div>
        <div className="grid2">
          <textarea value={cv} onChange={(e) => { setCv(e.target.value); setUploadInfo(null); }} aria-label="CV" />
          <textarea value={jdText} onChange={(e) => setJdText(e.target.value)} aria-label="JD" />
        </div>
        {mode === "mock" && (
          <p className="note">Mock 模式只认识内置的示例 CV/JD；换成别的文本需要配置 ANTHROPIC_API_KEY（见 README）。</p>
        )}
        <div className="row">
          <button onClick={runAnalysis} disabled={!!busy}>解析并分析</button>
          {busy && <span className="note">{busy}</span>}
        </div>
        {error && <div className="err">出错：{error}</div>}
      </section>

      {db && (
        <section className="card">
          <h2>2. 简历解析 → 经历库 Experience DB <Who kinds={["ai", "rule"]} /></h2>
          <p className="note">AI 把简历拆成「经历 → 卡片 → 格子」，只能照搬原文、不许添加；代码给每条事实打上状态和出处。CV 里的内容视为「已确认」（你自己写的）；对话中得到的数字先标「待确认」，需要你点确认才算数。</p>
          {db.cards.map((c) => {
            const aff = db.affiliations.find((a) => a.id === c.affiliation_id);
            return (
              <div className="cardbox" key={c.id}>
                <h3>{c.name} <span className="chip">{c.id}</span></h3>
                <div className="org">{[aff?.title, aff?.organization].filter(Boolean).join(" · ")} · {aff?.type}</div>
                {FACT_FIELDS.flatMap((f) =>
                  c[f].map((x) => (
                    <div className={`fact ${newIds.has(x.id) ? "new" : ""}`} key={x.id}>
                      <span className="f">{FIELD_LABEL[f]}</span>{x.text} <span className={`chip ${x.status}`}>{STATUS_LABEL[x.status]}</span>
                    </div>
                  )),
                )}
                {c.outcomes.map((o) => (
                  <div className={`fact ${newIds.has(o.id) ? "new" : ""}`} key={o.id}>
                    <span className="f">{FIELD_LABEL.outcomes}</span>
                    {o.note}{o.value !== null ? `：${o.value}${o.unit ? " " + o.unit : ""}` : ""}{" "}
                    <span className={`chip ${o.status}`}>{STATUS_LABEL[o.status]}</span>{" "}
                    {o.status !== "user_confirmed" && (
                      <button className="small ghost" disabled={!!busy} onClick={() => confirmOutcome(o.id)}>确认这个结果</button>
                    )}
                  </div>
                ))}
              </div>
            );
          })}
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
          <table>
            <thead><tr><th>要求</th><th>优先级</th><th>状态</th><th>原因</th><th>证据</th></tr></thead>
            <tbody>
              {gaps.map((g) => {
                const r = jd.requirements.find((x) => x.id === g.requirement_id)!;
                return (
                  <tr key={g.requirement_id}>
                    <td>{r.text}</td>
                    <td>{r.priority}</td>
                    <td><span className={`chip ${g.status}`}>{GAP_LABEL[g.status]}</span></td>
                    <td>{g.reason}</td>
                    <td className="note">{g.evidence_fact_ids.join(", ") || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!pending && !interviewDone && turns.length === 0 && (
            <div className="row"><button onClick={startInterview} disabled={!!busy}>开始针对性追问</button></div>
          )}
        </section>
      )}

      {(turns.length > 0 || pending) && (
        <section className="card">
          <h2>4. 针对性追问（最多 {MAX_QUESTIONS} 题） <Who kinds={["rule", "ai", "user"]} /></h2>
          <p className="note">
            <b>代码规则</b>挑下一个最值得问的缺口（按优先级）；<b>AI</b>把它说成一句话，并把你的回答整理成事实；<b>你</b>回答，没做过就写「没有」。
            回答后会回到第 3 步重新匹配，缺口状态随之更新。
          </p>
          {turns.map((t, i) => (
            <div className="qa" key={i}>
              <div className="q">Q{i + 1}（{t.requirement.text}）：{t.question}</div>
              <div className="a">{t.answer}</div>
              <div className="note">{t.has_experience ? `已记录 ${t.added_ids.length} 条新事实，上表蓝底高亮` : "你确认没有相关经历 → 该要求记为真缺口"}</div>
            </div>
          ))}
          {pending && (
            <div className="qa">
              <div className="q">Q{turns.length + 1}（{pending.requirement.text}）：{pending.question}</div>
              <textarea className="short" value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="直接回答；没做过就写“没有”" />
              <div className="row">
                <button onClick={submitAnswer} disabled={!!busy || !answer.trim()}>提交回答</button>
                <button className="ghost" onClick={() => { setPending(null); setInterviewDone(true); }} disabled={!!busy}>跳过剩余问题</button>
                {busy && <span className="note">{busy}</span>}
              </div>
            </div>
          )}
          {interviewDone && <p className="note">追问结束。</p>}
        </section>
      )}

      {jd && (interviewDone || turns.length > 0) && !pending && (
        <section className="card">
          <h2>5. 选材排序 · 改写 · 生成简历 <Who kinds={["rule", "ai", "rule"]} /></h2>
          <p className="note">
            <b>代码规则</b>按覆盖了多少高优先级要求给经历打分、选材；<b>AI</b>只用「已确认」的事实改写 bullet，并标明依据哪几条事实；<b>代码规则</b>再检查：没有来源、引用未确认事实、或出现事实里没有的数字，该条就被拦截，不进简历。
          </p>
          <div className="row">
            <button onClick={finish} disabled={!!busy}>生成简历</button>
            {busy && <span className="note">{busy}</span>}
          </div>
          {result && (
            <>
              <h2 style={{ marginTop: 16 }}>经历选择与排序</h2>
              <table>
                <thead><tr><th>经历</th><th>得分</th><th>是否入选</th><th>理由</th></tr></thead>
                <tbody>
                  {result.ranked.map((r) => (
                    <tr key={r.card_id}>
                      <td>{cardName(r.card_id)}</td>
                      <td>{r.score}</td>
                      <td>{r.included ? "入选" : "落选"}</td>
                      <td className="note">{r.reasons.join("；") || "与 JD 要求的匹配度低"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <h2 style={{ marginTop: 16 }}>Bullet 与事实校验</h2>
              {result.rewritten.map((rc) => (
                <div className="cardbox" key={rc.card_id}>
                  <h3>{cardName(rc.card_id)}</h3>
                  {rc.bullets.map((b, i) => (
                    <div className="fact" key={i}>
                      <span className={`chip ${b.ok ? "user_confirmed" : "blocked"}`}>{b.ok ? "通过" : "已拦截"}</span> {b.text}
                      <span className="note"> ← {b.source_ids.join(", ")}{b.issues.length ? ` ｜ ${b.issues.join("；")}` : ""}</span>
                    </div>
                  ))}
                </div>
              ))}

              <h2 style={{ marginTop: 16 }}>最终简历（Markdown）</h2>
              <pre className="out">{result.resume.markdown}</pre>
              <p className="note">
                JD 覆盖：已覆盖 {result.resume.coverage.covered} · 偏弱 {result.resume.coverage.weak} · 未知 {result.resume.coverage.unknown} · 真缺口 {result.resume.coverage.true_gap}
              </p>
              {result.resume.warnings.length > 0 && (
                <ul className="warn">{result.resume.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
              )}
              <div className="row">
                <button className="ghost" onClick={() => navigator.clipboard.writeText(result.resume.markdown)}>复制 Markdown</button>
              </div>
            </>
          )}
        </section>
      )}
    </main>
  );
}
