"use client";

import { useEffect, useMemo, useState } from "react";
import { EMPTY_CONTACT, PRIVACY_NOTICE, contactLines, redactPayload, redactText, validateContact, type Contact, type ContactMode } from "@/lib/privacy";
import { SAMPLE_CV, SAMPLE_JD } from "@/lib/sample";
import { DIMENSIONS, type EvaluationReport } from "@/lib/evaluation-schema";
import { bulletKey, type ReviewChoices } from "@/lib/review-types";
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

async function requestStep<T>(body: Record<string, unknown>): Promise<T> {
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
  const [contactMode, setContactMode] = useState<ContactMode | null>(null);
  const [contact, setContact] = useState<Contact>({ ...EMPTY_CONTACT });
  const [sourceReviewed, setSourceReviewed] = useState(false);
  const [downloadAcknowledged, setDownloadAcknowledged] = useState(false);

  function selectContactMode(next: ContactMode) {
    if (next === contactMode) return;
    // Never carry an old identity or generated draft across a privacy-mode switch.
    if (next === "private") {
      setCv((text) => redactText(text, contact));
      setAnswer((text) => redactText(text, contact));
      setJdText((text) => redactText(text, contact));
      setContact({ ...EMPTY_CONTACT });
    }
    setContactMode(next); setSourceReviewed(false); setDownloadAcknowledged(false);
    setDb(null); setJd(null); setResult(null); setReviewed(null); setChoices({});
    setTurns([]); setPending(null); setGaps([]); setAsked({}); setInterviewDone(false); setEvaluation(null); setError(null);
  }

  async function call<T>(body: Record<string, unknown>): Promise<T> {
    // Contact details stay out of every model workflow request, including evaluation and answers.
    return requestStep<T>(redactPayload(body, contact));
  }

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
  const [choices, setChoices] = useState<ReviewChoices>({});
  const [reviewed, setReviewed] = useState<{ rewritten: RewrittenCard[]; resume: ResumeOutput } | null>(null);
  const [evaluation, setEvaluation] = useState<{ signature: string; report: EvaluationReport } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
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
    if (!contactMode) { setError("请先选择个人信息使用模式。"); return; }
    if (contactMode === "full") {
      const issue = validateContact(contact); if (issue) { setError(issue); return; }
    } else if (!sourceReviewed) { setError("请先确认已检查简历文字中的个人信息。"); return; }
    await guard("解析简历和 JD…", async () => {
      setTurns([]);
      setAsked({});
      setPending(null);
      setInterviewDone(false);
      setResult(null);
      setReviewed(null);
      setChoices({});
      setEditing(null);
      const p = await call<{ db: ExperienceDB }>({ step: "parse", cv });
      const j = await call<{ jd: JDAnalysis }>({ step: "jd", jd: jdText });
      const a = await call<{ gaps: Gap[] }>({ step: "analyze", db: p.db, jd: j.jd, asked: {} });
      setDb(p.db);
      setJd(j.jd);
      setGaps(a.gaps);
    });
  }

  async function uploadResume(file: File) {
    await guard("提取简历文字…", async () => {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/resume", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "简历上传失败");
      setCv(redactText(data.text, contact));
      setSourceReviewed(false);
      setUploadInfo(`已从 ${data.name} 提取文字${data.pages ? `（${data.pages} 页）` : ""}，请检查下方文本是否完整`);
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
      const generated = await call<FinishResult>({ step: "finish", db, jd, gaps });
      const initial = await call<{ rewritten: RewrittenCard[]; resume: ResumeOutput }>({ step: "review", db, jd, gaps, rewritten: generated.rewritten, choices: {} });
      setResult(generated);
      setChoices({});
      setEditing(null);
      setReviewed(initial);
    });
  }

  async function reviewBullet(key: string, text: string, status: "accepted" | "excluded" | "pending") {
    if (!db || !jd || !result) return;
    await guard("更新审阅结果…", async () => {
      const next = { ...choices, [key]: { text, status } };
      const response = await call<{ rewritten: RewrittenCard[]; resume: ResumeOutput }>({
        step: "review", db, jd, gaps, rewritten: result.rewritten, choices: next,
      });
      setChoices(next);
      setReviewed(response);
      setEditing(null);
    });
  }

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
  const acceptedCount = (reviewed?.rewritten ?? []).reduce((n, c) => n + c.bullets.filter((b, i) => b.ok && choices[bulletKey(c.card_id, i)]?.status === "accepted").length, 0);
  const totalBullets = result?.rewritten.reduce((n, c) => n + c.bullets.length, 0) ?? 0;

  const evaluationSignature = JSON.stringify({ cv, jdText, db, jd, gaps, rewritten: result?.rewritten, choices });
  const currentEvaluation = evaluation?.signature === evaluationSignature ? evaluation.report : null;
  async function runEvaluation() {
    if (!db || !jd || !result || acceptedCount === 0) return;
    const signature = evaluationSignature;
    await guard("正在评估简历质量…", async () => {
      const response = await call<{ evaluation: EvaluationReport }>({ step: "evaluate", cv, db, jd, gaps, rewritten: result.rewritten, choices });
      setEvaluation({ signature, report: response.evaluation });
    });
  }

  const identityLines = contactMode ? contactLines(contactMode, contact) : [];
  const personalIssue = contactMode === "full" ? validateContact(contact) : null;
  const finalMarkdown = preview ? [...identityLines.map((line, i) => i === 0 ? `# ${line}` : line), "", preview.markdown.replace(/^# .*\n?/, "")].join("\n") : "";
  const canExport = !!contactMode && !busy && acceptedCount > 0 && editing === null && !personalIssue && (contactMode !== "private" || downloadAcknowledged);

  async function downloadWord() {
    if (!canExport || !db || !jd || !result) return;
    await guard("生成 Word 简历…", async () => {
      const response = await fetch("/api/export", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...redactPayload({ db, jd, gaps, rewritten: result.rewritten, choices }, contact),
          mode: contactMode, ...(contactMode === "full" ? { contact } : {}), acknowledged: downloadAcknowledged }),
      });
      if (!response.ok) throw new Error((await response.json()).error ?? "Word 导出失败");
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a"); anchor.href = url;
      anchor.download = contactMode === "private" ? "Resume-待填写个人信息.docx" : "Resume.docx";
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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

      <section className="card privacy-settings">
        <h2>个人信息使用模式</h2>
        <p className="note">请先选择。个人信息仅保存在当前页面内存中，刷新后清除；填写的联系方式仅用于预览和 Word 组装，不发送给模型。上传原文件仍会发送到本平台进行文字提取。</p>
        <fieldset disabled={!!busy}>
          <legend>选择制作方式</legend>
          <label className="mode-option"><input type="radio" name="contact-mode" checked={contactMode === "full"} onChange={() => selectContactMode("full")} /> 完整信息模式：我同意提供真实联系方式，生成完整简历</label>
          <label className="mode-option"><input type="radio" name="contact-mode" checked={contactMode === "private"} onChange={() => selectContactMode("private")} /> 隐私占位模式：下载 Word 后在本地填写个人信息</label>
        </fieldset>
        {contactMode === "full" && <div className="contact-grid">{([
          ["name", "姓名", "text"], ["email", "邮箱", "email"], ["phone", "电话", "tel"], ["link", "个人链接（可选）", "text"],
        ] as const).map(([key, label, type]) => <label key={key}>{label}<input type={type} value={contact[key]} maxLength={key === "link" ? 500 : key === "email" ? 254 : key === "name" ? 120 : 80} disabled={!!busy} autoComplete="off" onChange={(e) => { setContact({ ...contact, [key]: e.target.value }); setDownloadAcknowledged(false); }} /></label>)}
          <p className="note">姓名、邮箱和电话用于完整导出；请勿在经历正文或回答中重复填写。真实信息仅在下载时交给本平台的 Word 组装接口。</p>
        </div>}
        {contactMode === "private" && <div className="privacy-warning" role="note"><b>下载后必须填写个人信息</b><p>{PRIVACY_NOTICE}</p><p>预览与 Word 将使用黄色高亮的 <mark>[YOUR NAME]</mark>、<mark>[YOUR EMAIL]</mark>、<mark>[YOUR PHONE]</mark>，可选链接省略。</p><p>请在上传前删除原文件中的姓名、联系方式等隐私信息。系统可辅助遮盖邮箱和常见电话，不能可靠识别所有姓名、地址或其他身份线索；请自行检查。</p></div>}
        <p className="note">切换模式会重置已生成结果和审阅记录；切换到隐私模式会清空已填写的联系方式。</p>
      </section>

      <section className="card">
        <h2>1. 输入：简历 CV 与目标 JD <Who kinds={["user"]} /></h2>
        <p className="note">你提供原材料。上传文件的文字提取由代码完成，不用 AI。点「解析并分析」后，AI 会依次完成第 2、3 步。</p>
        <div className="row" style={{ marginTop: 0, marginBottom: 10 }}>
          <label className="upload">
            上传简历（PDF / Word / TXT）
            <input
              type="file"
              accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
              disabled={!!busy || !contactMode}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadResume(f);
                e.target.value = "";
              }}
            />
          </label>
          <span className="note">{uploadInfo ?? "支持 PDF、Word（.docx）和 TXT，每个文件不超过 10MB。扫描件暂不支持，也可以直接粘贴文字。"}</span>
        </div>
        <div className="grid2">
          <textarea value={cv} onChange={(e) => { setCv(e.target.value); setUploadInfo(null); setSourceReviewed(false); }} aria-label="CV" />
          <textarea value={jdText} onChange={(e) => setJdText(e.target.value)} aria-label="JD" />
        </div>
        {contactMode === "private" && <>
          <button className="ghost" disabled={!!busy} onClick={() => { setCv(redactText(cv)); setSourceReviewed(false); }}>辅助遮盖邮箱与常见电话</button>
          <label className="mode-option"><input type="checkbox" checked={sourceReviewed} disabled={!!busy} onChange={(e) => setSourceReviewed(e.target.checked)} /> 我已检查上方简历文字，并移除不希望发送给模型的姓名、联系方式和其他身份信息。</label>
        </>}
        {mode === "mock" && (
          <p className="note">Mock 模式只认识内置的示例 CV/JD；换成别的文本需要配置 ANTHROPIC_API_KEY（见 README）。</p>
        )}
        <div className="row">
          <button onClick={runAnalysis} disabled={!!busy || !contactMode || (contactMode === "private" && !sourceReviewed)}>解析并分析</button>
          {busy && <span className="note">{busy}</span>}
        </div>
        {error && <div className="err">出错：{error}</div>}
      </section>

      {db && (
        <section className="card">
          <h2>2. 简历解析 → 经历库 Experience DB <Who kinds={["ai", "rule"]} /></h2>
          <p className="note">AI 把简历拆成「经历 → 卡片 → 格子」，只能照搬原文、不许添加；代码给每条事实打上状态和出处。CV 里的内容视为「已确认」（你自己写的）；对话中得到的数字先标「待确认」，需要你点确认才算数。</p>
          {(db.education ?? []).map((e) => (
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

              <h2 style={{ marginTop: 16 }}>改写对照与逐条审阅</h2>
              <p className="note" role="status">共 {totalBullets} 条，已接受 {acceptedCount} 条。只有已接受且通过规则校验的内容才进入下方简历。</p>
              <p className="note">左侧是经历库中抽取的事实，接近原文但不等同于原始简历逐字内容。规则校验只检查来源、确认状态和数字；请同时核实职责和个人贡献是否准确。</p>
              {result.rewritten.map((rc) => (
                <div className="cardbox" key={rc.card_id}>
                  <h3>{cardName(rc.card_id)}</h3>
                  {rc.bullets.map((original, i) => {
                    const key = bulletKey(rc.card_id, i);
                    const b = reviewed?.rewritten.find((c) => c.card_id === rc.card_id)?.bullets[i] ?? original;
                    const status = choices[key]?.status ?? "pending";
                    const label = !b.ok ? "已拦截" : status === "accepted" ? "已接受" : status === "excluded" ? "已排除" : "待审阅";
                    return (
                      <article className="bullet-review" key={key} aria-label={`${cardName(rc.card_id)} 第 ${i + 1} 条审阅`}>
                        <div className="review-heading"><b>Bullet {i + 1}</b><span className={`chip ${!b.ok ? "blocked" : status === "accepted" ? "user_confirmed" : "unknown"}`}>{label}</span></div>
                        <div className="grid2">
                          <div className="review-panel">
                            <h4>改写前 · 来源事实</h4>
                            {original.source_ids.length === 0 && <p className="err">未引用来源事实</p>}
                            {original.source_ids.map((id) => {
                              const fact = sources.get(id);
                              return <div className="source-fact" key={id}>
                                {fact ? <><p>{fact.text}</p><span className="note">{fact.field} · {fact.source === "cv_parse" ? "简历解析" : fact.source === "dialogue" ? "追问补充" : "用户编辑"} · {STATUS_LABEL[fact.status as keyof typeof STATUS_LABEL]} · {id}{fact.card !== cardName(rc.card_id) ? ` · 来自「${fact.card}」` : ""}</span></> : <p className="err">找不到来源 {id}</p>}
                              </div>;
                            })}
                          </div>
                          <div className="review-panel">
                            <h4>改写后 · {b.text !== original.text ? "你的修改稿" : "AI 建议稿"}</h4>
                            {editing === key ? <>
                              <textarea className="short" aria-label={`编辑 ${cardName(rc.card_id)} 第 ${i + 1} 条`} value={editText} onChange={(e) => setEditText(e.target.value)} disabled={!!busy} />
                              <div className="row"><button disabled={!!busy || !editText.trim()} onClick={() => reviewBullet(key, editText, "pending")}>保存并重新校验</button><button className="ghost" disabled={!!busy} onClick={() => setEditing(null)}>取消</button></div>
                            </> : <p className="bullet-text">{b.text}</p>}
                            {b.text !== original.text && <details><summary>查看 AI 原建议</summary><p>{original.text}</p></details>}
                            <p className={`note ${!b.ok ? "err" : ""}`}>{b.ok ? "来源与数字规则校验通过" : b.issues.join("；")}</p>
                            <div className="row">
                              <button disabled={!!busy || !b.ok || editing !== null || status === "accepted"} onClick={() => reviewBullet(key, b.text, "accepted")}>接受这条</button>
                              <button className="ghost" disabled={!!busy || editing !== null} onClick={() => { setEditing(key); setEditText(b.text); }}>编辑</button>
                              <button className="ghost" disabled={!!busy || editing !== null || status === "excluded"} onClick={() => reviewBullet(key, b.text, "excluded")}>排除这条</button>
                              {status !== "pending" && <button className="ghost" disabled={!!busy || editing !== null} onClick={() => reviewBullet(key, b.text, "pending")}>撤回选择</button>}
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ))}

              <h2 style={{ marginTop: 16 }}>简历预览与 Word 下载</h2>
              <p className="note">{acceptedCount ? `当前简历包含 ${acceptedCount} 条已接受的经历描述。` : "请先接受上方至少一条描述，经历部分才会写入简历。"}</p>
              <div className="identity-preview" aria-label="个人信息预览">{identityLines.map((line, i) => <div key={i}>{contactMode === "private" ? <mark>{line}</mark> : (line || "待填写")}</div>)}</div>
              <pre className="out">{preview?.markdown.replace(/^# .*\n?/, "")}</pre>
              {contactMode === "private" ? <div className="privacy-warning"><b>个人信息待本地填写 · 不能直接投递</b><p>{PRIVACY_NOTICE}</p><label className="mode-option"><input type="checkbox" checked={downloadAcknowledged} onChange={(e) => setDownloadAcknowledged(e.target.checked)} /> 我知道该文件尚未完成，提交申请前须自行替换所有黄色占位信息，并自行承担遗漏填写的风险。</label></div> : personalIssue && <p className="err">{personalIssue}</p>}
              <p className="note">
                JD 覆盖：已覆盖 {preview?.coverage.covered} · 偏弱 {preview?.coverage.weak} · 未知 {preview?.coverage.unknown} · 真缺口 {preview?.coverage.true_gap}
              </p>
              {!!preview?.warnings.length && (
                <ul className="warn">{preview?.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
              )}
              <div className="row">
                <button disabled={!canExport} onClick={downloadWord}>下载 Word{contactMode === "private" ? "（待填写个人信息）" : ""}</button>
                {contactMode === "full" && <button className="ghost" disabled={!canExport} onClick={() => navigator.clipboard.writeText(finalMarkdown)}>复制 Markdown</button>}
              </div>
              <div className="evaluation-section">
                <h2>简历质量评估 <Who kinds={["ai", "rule"]} /></h2>
                <p className="note">对比原简历与已接受的当前稿，按六个维度评估，并核验引用能否在原文中找到。每项 0–3 分，无法判断时不评分。建议仍需你审阅，评估不会自动修改简历。</p>
                <p className="note">这是文字内容评估，不包含版式、PDF 解析测试或 ATS 通过率预测。LIVE 模式点击后调用一次模型，使用你的 API 额度。</p>
                <button disabled={!!busy || acceptedCount === 0 || editing !== null} onClick={runEvaluation}>{currentEvaluation ? "重新评估" : "评估当前简历"}</button>
                {busy === "正在评估简历质量…" && <p role="status">正在评估简历质量…</p>}
                {evaluation && !currentEvaluation && <p className="note">简历或审阅内容已变化，请重新评估。</p>}
                {currentEvaluation && <>
                  <p>{currentEvaluation.summary}</p>
                  {currentEvaluation.warnings.length > 0 && <ul className="warn">{currentEvaluation.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
                  {currentEvaluation.dimensions.map((dimension) => <div className="cardbox" key={dimension.id}>
                    <h3>{DIMENSIONS[dimension.id]}</h3>
                    <div className="grid2">{(["before", "after"] as const).map((version) => <div className="review-panel" key={version}>
                      <h4>{version === "before" ? "原简历" : "当前稿"} · {dimension[version].score === null ? "暂不评分" : `${dimension[version].score} / 3`}</h4>
                      <p>{dimension[version].reason}</p>
                      {dimension[version].evidence.map((e, i) => <blockquote key={i}><span className="note">{{ before: "原简历", after: "当前稿", confirmed: "已确认事实", jd: "岗位要求" }[e.source]}</span><br />{e.quote}</blockquote>)}
                    </div>)}</div>
                    {dimension.missing.length > 0 && <><b>缺失信息</b><ul>{dimension.missing.map((m, i) => <li key={i}>{m}</li>)}</ul></>}
                    <p><b>建议：</b>{dimension.suggestion}</p>
                  </div>)}
                  <h3>需要核实的事实风险</h3>
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
