"use client";

import { useState } from "react";
import NewReviewEntry from "./new-review-entry";
import { FACT_FIELDS, type ExperienceDB, type Fact, type Outcome } from "@/lib/schema";
import { changeFact, confirmFacts, deleteAffiliation, reviewFacts, SOURCE_LABEL } from "@/lib/fact-review";

const FIELDS: Record<string, string> = { context: "背景", my_actions: "我的动作", team_actions: "团队动作", methods: "方法", tools: "工具", skills: "技能", scale: "规模", outcomes: "成果" };

export function ResumeDetailsReview({ db, disabled, onChange, onDraftChange }: { db: ExperienceDB; disabled: boolean; onChange: (db: ExperienceDB) => void; onDraftChange: (active: boolean) => void }) {
  const [activeEntry, setActiveEntry] = useState<"education" | "experience" | null>(null);
  const [deletion, setDeletion] = useState<{ before: ExperienceDB; after: ExperienceDB; label: string } | null>(null);
  function remove(next: ExperienceDB, label: string) {
    setDeletion({ before: db, after: next, label });
    onChange(next);
  }
  function input(label: string, value: string | null | undefined, update: (next: ExperienceDB, value: string) => void, multiline = false) {
    const props = { value: value ?? "", disabled, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => { const next = structuredClone(db); update(next, e.target.value); onChange(next); } };
    return <label key={label}>{label}{multiline ? <textarea {...props} /> : <input {...props} />}</label>;
  }
  return <details className="cardbox review-personal-details" open><summary>姓名、联系方式、教育经历与经历信息</summary>
    <p className="note">以下也是 AI 的解析结果，请对照原简历检查；确认不代表系统验证了真实性。</p>
    {deletion?.after === db && <div className="row" role="status"><span>已删除「{deletion.label}」。</span><button className="small ghost" disabled={disabled} onClick={() => { onChange(deletion.before); setDeletion(null); }}>撤销本次删除</button></div>}
    <div className="fact-review-fields">
      {input("姓名", db.header?.name, (n, v) => { n.header = { name: v || null, contactLines: n.header?.contactLines ?? [] }; })}
      {input("联系方式（每行一项）", db.header?.contactLines.join("\n"), (n, v) => { n.header = { name: n.header?.name ?? null, contactLines: v.split("\n") }; }, true)}
    </div>
    {db.education.map((e, i) => <fieldset key={e.id}><legend>教育经历 {i + 1}</legend><div className="fact-review-fields">
      {([['school', '学校'], ['degree', '学位'], ['field', '专业'], ['location', '地点'], ['start_date', '开始日期'], ['end_date', '结束日期'], ['gpa', 'GPA']] as const).map(([key, label]) => input(label, e[key], (n, v) => { n.education[i][key] = v; }))}
      {input("补充信息（每行一项）", e.details.join("\n"), (n, v) => { n.education[i].details = v.split("\n"); }, true)}
    </div><button className="small ghost" disabled={disabled} onClick={() => { const n = structuredClone(db); n.education.splice(i, 1); remove(n, e.school || "教育经历"); }}>删除这段教育经历</button></fieldset>)}
    <NewReviewEntry entryKind="education" db={db} disabled={disabled || activeEntry === "experience"} onChange={onChange} onDraftChange={(active) => { setActiveEntry(active ? "education" : null); onDraftChange(active); }} />
    {db.affiliations.map((a, i) => <fieldset key={a.id}><legend>经历 {i + 1}</legend><div className="fact-review-fields">
      {([['organization', '单位'], ['title', '职位'], ['start_date', '开始日期'], ['end_date', '结束日期']] as const).map(([key, label]) => input(label, a[key], (n, v) => { n.affiliations[i][key] = v; }))}
    </div><p className="note">删除将同时移除关联的 {db.cards.filter((c) => c.affiliation_id === a.id).length} 段经历内容及其全部事实和原句；其他经历不受影响。删除后可立即撤销。</p><button className="small ghost" disabled={disabled} onClick={() => remove(deleteAffiliation(db, a.id), a.organization || "经历")}>删除这段经历</button></fieldset>)}
    <NewReviewEntry entryKind="experience" db={db} disabled={disabled || activeEntry === "education"} onChange={onChange} onDraftChange={(active) => { setActiveEntry(active ? "experience" : null); onDraftChange(active); }} />
  </details>;
}

function FactRow({ item, field, disabled, onChange, onConfirm, onDelete, onEditing, selected, selectionDisabled, onSelect }: {
  item: Fact | Outcome; field: string; disabled: boolean;
  onChange: (item: Fact | Outcome) => void; onConfirm: () => void; onDelete: () => void;
  onEditing: (active: boolean) => void;
  selected: boolean; selectionDisabled: boolean; onSelect: (checked: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item);
  const [invalid, setInvalid] = useState("");
  const outcome = "note" in draft;
  const text = "note" in item ? `${item.note}${item.value !== null ? ` · ${item.value} ${item.unit ?? ""}` : ""}${item.basis ? `（口径：${item.basis}）` : ""}` : item.text;
  return <div className="fact-review-row">
    <div className="fact-review-meta">{item.status !== "user_confirmed" && <input type="checkbox" aria-label={`选择${FIELDS[field]}：${text}`} checked={selected} disabled={selectionDisabled || editing} onChange={(e) => onSelect(e.target.checked)} />}<span className="f">{FIELDS[field]}</span><span className="chip">{SOURCE_LABEL[item.source]}</span><span className={`chip ${item.status}`}>{item.status === "user_confirmed" ? "本人已确认" : "尚未核对"}</span></div>
    {editing ? <form onSubmit={(e) => {
      e.preventDefault();
      if (!("note" in draft ? draft.note : draft.text).trim()) { setInvalid("内容不能为空；不需要的信息请使用删除。"); return; }
      if (JSON.stringify(draft) !== JSON.stringify(item)) onChange(draft);
      setEditing(false); onEditing(false);
    }}>
      <label>{outcome ? "成果描述" : "事实内容"}<textarea aria-label={outcome ? "成果描述" : "事实内容"} value={outcome ? draft.note : draft.text} disabled={disabled} onChange={(e) => { setDraft(outcome ? { ...draft, note: e.target.value } : { ...draft, text: e.target.value }); setInvalid(""); }} /></label>
      {outcome && <div className="fact-review-fields">
        <label>数值（可留空）<input type="number" step="any" value={draft.value ?? ""} disabled={disabled} onChange={(e) => setDraft({ ...draft, value: e.target.value === "" ? null : Number(e.target.value) })} /></label>
        <label>单位<input value={draft.unit ?? ""} disabled={disabled} onChange={(e) => setDraft({ ...draft, unit: e.target.value || null })} /></label>
        <label>统计口径 / 比较基准<input value={draft.basis ?? ""} disabled={disabled} onChange={(e) => setDraft({ ...draft, basis: e.target.value || null })} /></label>
      </div>}
      {invalid && <p className="err" role="alert">{invalid}</p>}
      <p className="note">保存后仍需确认。修改这条会暂停该经历的旧原句保留，防止错误内容回流。</p>
      <div className="row"><button className="small" disabled={disabled}>保存修改</button><button type="button" className="small ghost" onClick={() => { setEditing(false); onEditing(false); }}>取消</button></div>
    </form> : <>
      <p>{text}</p>
      <div className="row">
        {item.status !== "user_confirmed" && <button className="small" disabled={disabled} onClick={onConfirm}>确认这条信息</button>}
        <button className="small ghost" disabled={disabled} onClick={() => { setDraft(item); setInvalid(""); setEditing(true); onEditing(true); }}>修改</button>
        <button className="small ghost" disabled={disabled} onClick={onDelete}>删除</button>
      </div>
    </>}
  </div>;
}

export default function ExperienceReview({ db, disabled, readOnly, onChange, onEditing, onConfirm }: {
  db: ExperienceDB; disabled: boolean; readOnly: boolean; onChange: (next: ExperienceDB) => void; onEditing: (active: boolean) => void; onConfirm: (ids: string[]) => void;
}) {
  const [undo, setUndo] = useState<{ before: ExperienceDB; after: ExperienceDB } | null>(null);
  const [editingCount, setEditingCount] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  function select(ids: string[], checked: boolean) {
    setSelectedIds((current) => { const next = new Set(current); for (const id of ids) { if (checked) next.add(id); else next.delete(id); } return next; });
  }
  function editing(active: boolean) { setEditingCount((n) => n + (active ? 1 : -1)); onEditing(active); }
  function change(next: ExperienceDB) { setUndo({ before: db, after: next }); onChange(next); }
  const facts = reviewFacts(db);
  const pending = facts.filter((f) => f.status !== "user_confirmed").length;
  return <div className="experience-review">
    <div className="review-summary" role="status"><b>{facts.length - pending} / {facts.length} 条已由本人确认</b><span>{pending ? `还有 ${pending} 条尚未核对` : "事实核对完成"}</span></div>
    {!readOnly && undo?.after === db && <div className="row"><button className="small ghost" disabled={disabled || editingCount > 0} onClick={() => { onChange(undo.before); setUndo(null); }}>撤销上一步核对操作</button></div>}
    {db.cards.map((card) => {
      const affiliation = db.affiliations.find((a) => a.id === card.affiliation_id);
      const items = [...FACT_FIELDS.flatMap((field) => card[field].map((item) => ({ field, item }))), ...card.outcomes.map((item) => ({ field: "outcomes", item }))];
      const pendingIds = items.filter(({ item }) => item.status !== "user_confirmed").map(({ item }) => item.id);
      const selected = pendingIds.filter((id) => selectedIds.has(id));
      const allSelected = pendingIds.length > 0 && selected.length === pendingIds.length;
      const partlySelected = selected.length > 0 && !allSelected;
      return <div className="cardbox" key={card.id}>
        <h3>{card.name}</h3>
        <div className="org">{[affiliation?.title, affiliation?.organization].filter(Boolean).join(" · ")}</div>
        {!readOnly && <label>经历名称<input value={card.name} disabled={disabled} onChange={(e) => { const n = structuredClone(db); n.cards.find((c) => c.id === card.id)!.name = e.target.value; change(n); }} /></label>}
        <details><summary>对照这段经历的完整原句</summary>{card.original_bullets?.length ? card.original_bullets.map((b) => <blockquote key={b.id}>{b.text}</blockquote>) : <p className="note">这段经历没有可自动保留的原句。若你修改或删除过事实，生成时将只依据确认后的事实重新给出建议，需要逐条接受后才进入最终简历。</p>}</details>
        {!card.original_bullets?.length && affiliation?.type !== "skills_list" && <p className="note" role="status">这段经历不会自动保留旧原句；生成后请逐条接受依据已确认事实给出的新建议。</p>}
        {pendingIds.length > 0 && <div className="fact-selection-bar" role="group" aria-label={`${card.name}的批量确认`}>
          <div className="row">
            <label><input type="checkbox" aria-label={`全选「${card.name}」待核对信息`} aria-checked={partlySelected ? "mixed" : allSelected} ref={(input) => { if (input) input.indeterminate = partlySelected; }} checked={allSelected} disabled={disabled || editingCount > 0} onChange={(e) => select(pendingIds, e.target.checked)} /> 全选待核对信息</label>
            <span className="note" role="status">已选 {selected.length} / {pendingIds.length} 条</span>
            <button className="small" disabled={disabled || editingCount > 0 || !selected.length} onClick={() => { select(selected, false); if (readOnly) onConfirm(selected); else change(confirmFacts(db, selected)); }}>确认已选的 {selected.length} 条</button>
          </div>
          <p className="note">勾选后点击确认才会更新状态；不符合的信息可以取消勾选，稍后修改。{readOnly && "如需修改或删除，请先返回核对。"}</p>
        </div>}
        {items.map(({ field, item }) => readOnly ? <div className="fact" key={item.id}>{item.status !== "user_confirmed" && <input type="checkbox" aria-label={`选择${FIELDS[field]}：${"text" in item ? item.text : item.note}`} checked={selectedIds.has(item.id)} disabled={disabled} onChange={(e) => select([item.id], e.target.checked)} />}{" "}<span className="f">{FIELDS[field]}</span>{"text" in item ? item.text : `${item.note}${item.value !== null ? `：${item.value} ${item.unit ?? ""}` : ""}`}{" "}<span className="chip">{SOURCE_LABEL[item.source]}</span>{" "}<span className={`chip ${item.status}`}>{item.status === "user_confirmed" ? "本人已确认" : "尚未核对"}</span></div> : <FactRow key={item.id} item={item} field={field} disabled={disabled} selected={selectedIds.has(item.id)} selectionDisabled={disabled || editingCount > 0} onSelect={(checked) => select([item.id], checked)} onEditing={(active) => { if (active) select([item.id], false); editing(active); }} onChange={(replacement) => { select([item.id], false); change(changeFact(db, item.id, replacement)); }} onConfirm={() => { select([item.id], false); change(confirmFacts(db, [item.id])); }} onDelete={() => { select([item.id], false); change(changeFact(db, item.id, null)); }} />)}
        {!items.length && <p className="note">这段经历的事实已全部删除，不会自动保留旧原句。</p>}
      </div>;
    })}
  </div>;
}
