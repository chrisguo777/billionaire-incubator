"use client";

import { useState } from "react";
import { addEducation, addExperience, type NewExperience } from "@/lib/fact-review";
import type { ExperienceDB, Education } from "@/lib/schema";

const blankEducation: Omit<Education, "id"> = { school: "", degree: null, field: null, location: null, start_date: null, end_date: null, gpa: null, details: [] };
const blankExperience: NewExperience = { name: "", organization: "", title: "", type: "work", start_date: "", end_date: "", actions: [], outcomes: [] };

export default function NewReviewEntry({ db, disabled, onChange, onDraftChange, entryKind }: {
  db: ExperienceDB; disabled: boolean; onChange: (db: ExperienceDB) => void; onDraftChange: (active: boolean) => void; entryKind: "education" | "experience";
}) {
  const [kind, setKind] = useState<"education" | "experience" | null>(null);
  const [education, setEducation] = useState(blankEducation);
  const [experience, setExperience] = useState(blankExperience);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  function open(next: "education" | "experience") { setKind(next); setError(""); setNotice(""); onDraftChange(true); }
  function close() { setKind(null); setEducation(blankEducation); setExperience(blankExperience); setError(""); onDraftChange(false); }
  return <div className="new-review-entry">
    {notice && <p className="note" role="status">{notice}</p>}
    {!kind ? <div className="row"><button className="small ghost" disabled={disabled} onClick={() => open(entryKind)}>＋ {entryKind === "education" ? "新增教育经历" : "新增经历"}</button></div> : <form aria-label={kind === "education" ? "新增教育经历" : "新增经历"} onSubmit={(event) => {
      event.preventDefault();
      try {
        onChange(kind === "education" ? addEducation(db, education) : addExperience(db, experience));
        setNotice(kind === "education" ? "已新增教育经历，可在上方继续修改。" : "已新增经历，请在下方核对并确认新增事实。");
        close();
      }
      catch (e) { setError(e instanceof Error ? e.message : "保存失败，请检查填写内容。"); }
    }}>
      <h4>{kind === "education" ? "新增教育经历" : "新增经历"}</h4>
      <p className="note">填写真实信息，带 * 的为必填。保存后仍可修改或删除。</p>
      <div className="fact-review-fields">
        {kind === "education" ? <>
          {([['school','学校 *'],['degree','学位'],['field','专业'],['location','地点'],['start_date','开始日期'],['end_date','结束日期'],['gpa','GPA']] as const).map(([key,label]) => <label key={key}>{label}<input required={key === "school"} disabled={disabled} value={education[key] ?? ""} onChange={(e) => setEducation({ ...education, [key]: e.target.value })} /></label>)}
          <label>补充信息（每行一项）<textarea disabled={disabled} value={education.details.join("\n")} onChange={(e) => setEducation({ ...education, details: e.target.value.split("\n") })} /></label>
        </> : <>
          {([['name','经历名称 *'],['organization','单位或组织（可选）'],['title','职位（可选）'],['start_date','开始日期'],['end_date','结束日期']] as const).map(([key,label]) => <label key={key}>{label}<input required={key === "name"} disabled={disabled} value={experience[key]} onChange={(e) => setExperience({ ...experience, [key]: e.target.value })} /></label>)}
          <label>经历类型<select disabled={disabled} value={experience.type} onChange={(e) => setExperience({ ...experience, type: e.target.value as NewExperience["type"] })}>{([['work','工作'],['intern','实习'],['research','研究'],['course_project','课程项目'],['personal_project','个人项目'],['club','社团'],['competition','比赛'],['volunteer','志愿活动'],['teaching','助教 / 教学'],['other','其他']] as const).map(([value,label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>本人做了什么 *（每行一条）<textarea required disabled={disabled} value={experience.actions.join("\n")} onChange={(e) => setExperience({ ...experience, actions: e.target.value.split("\n") })} /></label>
          <label>成果（可选，每行一条）<textarea disabled={disabled} value={experience.outcomes.join("\n")} onChange={(e) => setExperience({ ...experience, outcomes: e.target.value.split("\n") })} /></label>
        </>}
      </div>
      {kind === "experience" && <p className="note">新增事实保存后为「尚未核对」，确认后用于匹配；生成的新建议仍需逐条接受。</p>}
      {error && <p className="err" role="alert">{error}</p>}
      <div className="row"><button className="small" disabled={disabled}>保存{kind === "education" ? "教育经历" : "经历"}</button><button type="button" className="small ghost" disabled={disabled} onClick={close}>取消新增</button></div>
    </form>}
  </div>;
}
