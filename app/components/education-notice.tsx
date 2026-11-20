import type { Education } from "@/lib/schema";
import type { EducationCheck } from "@/lib/education-match";

export default function EducationNotice({ checks, education }: { checks: EducationCheck[]; education: Education[] }) {
  if (!checks.length) return null;
  return <div className="education-notice" role="region" aria-label="教育背景与岗位资格提示">
    <h3>教育背景与岗位资格提示</h3>
    <p className="note">以下只对照你在第 2 步核对后的教育信息；教育要求不进入追问，也不占用追问次数。信息有误时请返回第 2 步修改。</p>
    <details><summary>查看本次使用的已确认教育信息</summary>{education.length ? education.map((e) => <p key={e.id}>{[e.school, e.degree, e.field, e.end_date ? `毕业时间：${e.end_date}` : null, e.gpa ? `GPA：${e.gpa}` : null].filter(Boolean).join(" · ")}</p>) : <p>未提供教育记录。</p>}</details>
    {checks.map((check) => <div key={check.requirement.id} className="education-check">
      <span className={`chip ${check.status === "matched" ? "user_confirmed" : "ai_inferred"}`}>{check.status === "matched" ? "教育条件已匹配" : check.requirement.kind === "preferred" ? "教育偏好待核实（非硬性要求）" : check.status === "risk" ? "教育背景不匹配风险" : "教育资格需人工核实"}</span>
      <p><b>JD：{check.requirement.text}</b></p><p>{check.reason}</p>
    </div>)}
  </div>;
}
