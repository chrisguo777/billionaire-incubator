import { compareScores } from "../../lib/score-comparison";
import type { EvaluationReport } from "../../lib/evaluation-schema";

// A missing score has a dashed track; zero has a solid empty track and no arc.
function RingArc({ value, max, radius, version, width = 8 }: {
  value: number | null; max: number; radius: number; version: "before" | "after"; width?: number;
}) {
  return <g fill="none" strokeWidth={width}>
    <circle className={`score-ring-track ${value === null ? "score-ring-track--unscored" : ""}`}
      cx="60" cy="60" r={radius} pathLength="100" />
    {value !== null && value > 0 && <circle className={`score-ring-arc score-ring-arc--${version}`}
      cx="60" cy="60" r={radius} pathLength="100" strokeDasharray={`${value / max * 100} 100`}
      strokeLinecap="round" transform="rotate(-90 60 60)" />}
  </g>;
}

function OverallRing({ value, version }: { value: number | null; version: "before" | "after" }) {
  return <div className="score-overall-meter">
    <svg className="score-ring" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
      <RingArc value={value} max={100} radius={52} version={version} />
    </svg>
    <div className="score-overall-value"><strong>{value === null ? "—" : value.toFixed(1)}</strong><span>/ 100</span></div>
  </div>;
}

function Change({ value, overall = false }: { value: number | null; overall?: boolean }) {
  const state = value === null ? "unscored" : value > 0 ? "up" : value < 0 ? "down" : "same";
  const number = value === null ? "" : overall ? Math.abs(value).toFixed(1) : String(Math.abs(value));
  return <span className={`score-change score-change--${state}`}>
    {value === null ? "暂无可比评分" : value === 0 ? "分数持平" : <>
      <span aria-hidden="true">{value > 0 ? "↗" : "↘"}</span> {value > 0 ? "+" : "−"}{number} 分
    </>}
  </span>;
}

export default function ScoreComparison({ report }: { report: EvaluationReport }) {
  const scores = compareScores(report.dimensions);
  return <section className="score-dashboard" aria-label="简历评分前后对比">
    <header className="score-dashboard-heading">
      <div><span className="score-eyebrow">RESUME QUALITY</span><h3>让每一项变化清晰可见</h3></div>
      <span className={`score-coverage ${scores.includedCount < 6 ? "score-coverage--partial" : ""}`}>
        参与总分 {scores.includedCount} / 6 项
      </span>
    </header>

    <div className="score-overalls">
      <article className="score-overall score-overall--before" aria-label="原始简历总体评分">
        <div className="score-overall-top"><h4>原始简历</h4><span>BEFORE</span></div>
        <p className="score-overall-caption">Overall score · 加权总分</p>
        <OverallRing value={scores.before} version="before" />
        <p className="score-overall-foot">{scores.before === null ? "依据不足，暂不计算总分" : "作为本次对比的起点"}</p>
      </article>
      <article className="score-overall score-overall--after" aria-label="修改后简历总体评分">
        <div className="score-overall-top"><h4>修改后简历</h4><span>AFTER</span></div>
        <p className="score-overall-caption">Overall score · 加权总分</p>
        <OverallRing value={scores.after} version="after" />
        <div className="score-overall-foot"><Change value={scores.delta} overall /><span>相较原始简历</span></div>
      </article>
    </div>

    {scores.includedCount === 0 ? <p className="score-partial-note" role="note">
      前后没有共同可评分的指标，暂不计算总分。暂不评分不等于 0 分。
    </p> : scores.excludedLabels.length > 0 && <p className="score-partial-note" role="note">
      总分仅比较双方都有评分且权重大于零的 {scores.includedCount} 项，权重已重新归一化。
      {scores.excludedLabels.join("、")}未计入；暂不评分不等于 0 分。
    </p>}
    {report.fact_risks.length > 0 && <a className="score-risk-note" href="#evaluation-fact-risks">
      <span aria-hidden="true">!</span> {report.fact_risks.length} 项事实需要核实 <span aria-hidden="true">↓</span>
    </a>}

    <div className="score-chart-heading"><div><h4>六项指标，逐一对照</h4><p>每项满分 3 分，圆环越满，评分越高</p></div><div className="score-legend">
      <span><i className="score-dot score-dot--before" />内环 · 原始</span><span><i className="score-dot score-dot--after" />外环 · 修改后</span>
    </div></div>
    <ul className="score-dimensions">
      {scores.rows.map((row) => <li className="score-dimension" key={row.id}>
        <div className="score-dimension-top"><h5>{row.label}</h5><span className="score-weight">{row.weightPercent}% 权重</span></div>
        <div className="score-dimension-body">
          <div className="score-dimension-meter">
            <svg className="score-ring" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
              <RingArc value={row.before} max={3} radius={40} width={6} version="before" />
              <RingArc value={row.after} max={3} radius={52} version="after" />
            </svg>
            <div className={`score-dimension-center ${row.after === null ? "score-dimension-center--unscored" : ""}`} aria-hidden="true">
              <span><strong>{row.after ?? "—"}</strong>{row.after !== null && <small> / 3</small>}</span>
              <span>{row.after === null ? "暂不评分" : "修改后"}</span>
            </div>
          </div>
          <dl className="score-dimension-values">
            {(["before", "after"] as const).map((version) => <div className={`score-dimension-value score-dimension-value--${version}`} key={version}>
              <dt><i className={`score-dot score-dot--${version}`} />{version === "before" ? "原始" : "修改后"}</dt>
              <dd>{row[version] === null ? <span className="score-unscored">暂不评分</span> : <>{row[version]}<small> / 3</small></>}</dd>
            </div>)}
          </dl>
        </div>
        <div className="score-dimension-foot"><Change value={row.delta} /><a href={`#evaluation-evidence-${row.id}`}>查看依据 <span aria-hidden="true">↗</span></a></div>
      </li>)}
    </ul>
    <details className="score-method">
      <summary>总分如何计算 <span>加权 · 100 分制</span></summary>
      <p>总分 = Σ（维度分数 × 权重）÷ Σ（参与计算的权重）÷ 3 × 100，保留一位小数。前后总分始终使用相同维度、相同权重。</p>
      <p>{scores.rows.map((row) => `${row.label} ${row.weightPercent}%`).join("，")}。某一侧暂不评分时，该维度同时从两个总分中排除；没有可比维度时不显示总分。</p>
      <p>这是本产品当前的评分配置。总分概括文字内容的评估结果，事实风险仍需独立核实。</p>
    </details>
  </section>;
}
