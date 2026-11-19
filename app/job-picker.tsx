"use client";

import { useEffect, useRef, useState } from "react";
import type { CompanyJobs, CompanyOption, FetchedJob } from "@/lib/job-sources";
import { BOARD_LABEL, filterJobs, type BoardJob } from "@/lib/job-board";

// Optional helper above the JD box: company autocomplete, job-title autocomplete from the company's
// public Greenhouse / Lever / Ashby board, and full JD from a job link.
// A fetched JD only fills the JD box; the user still reviews it and clicks 「解析并分析」.

async function getJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "请求失败");
  return data as T;
}

const METHOD_LABEL: Record<FetchedJob["method"], string> = {
  ats_api: "招聘系统官方接口",
  structured_data: "网页里的结构化岗位信息",
  ai_extract: "AI 从网页正文提取",
  page_text: "网页正文",
};

export default function JobPicker({ disabled, onUse }: { disabled: boolean; onUse: (jd: string) => void }) {
  const [companyQuery, setCompanyQuery] = useState("");
  const [company, setCompany] = useState<CompanyOption | null>(null);
  const [options, setOptions] = useState<CompanyOption[]>([]);
  const [companySource, setCompanySource] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const comboRef = useRef<HTMLDivElement>(null);
  // Jobs of the chosen company; null until loaded.
  const [companyJobs, setCompanyJobs] = useState<CompanyJobs | null>(null);
  const [jobsBusy, setJobsBusy] = useState(false);
  const [titleQuery, setTitleQuery] = useState("");
  const [titleOpen, setTitleOpen] = useState(false);
  const [titleActive, setTitleActive] = useState(0);
  const titleRef = useRef<HTMLDivElement>(null);
  const titleOptions = companyJobs ? filterJobs(companyJobs.jobs, titleQuery) : [];
  const hasJobs = !!companyJobs && companyJobs.jobs.length > 0;

  // Load the chosen company's open jobs once per selection.
  useEffect(() => {
    setCompanyJobs(null);
    setTitleQuery("");
    setTitleOpen(false);
    if (!company) return;
    const ctrl = new AbortController();
    setJobsBusy(true);
    const params = new URLSearchParams({ name: company.name, domain: company.domain });
    getJSON<CompanyJobs>(`/api/jobs?${params}`, { signal: ctrl.signal })
      .then(setCompanyJobs)
      .catch((e) => { if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!ctrl.signal.aborted) setJobsBusy(false); });
    return () => { ctrl.abort(); setJobsBusy(false); };
  }, [company]);

  // Debounced company lookup while typing.
  useEffect(() => {
    const q = companyQuery.trim();
    if (q.length < 2 || q === company?.name) { setOptions([]); return; }
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const data = await getJSON<{ source: string; companies: CompanyOption[] }>(`/api/company?q=${encodeURIComponent(q)}`, { signal: ctrl.signal });
        setCompanySource(data.source);
        setOptions(data.companies);
        setActive(0);
        setOpen(true);
      } catch (e) {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      }
    }, 250);
    return () => { clearTimeout(timer); ctrl.abort(); };
  }, [companyQuery, company]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!comboRef.current?.contains(e.target as Node)) setOpen(false);
      if (!titleRef.current?.contains(e.target as Node)) setTitleOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function choose(option: CompanyOption) {
    setCompany(option);
    setCompanyQuery(option.name);
    setOpen(false);
    setOptions([]);
  }

  function chooseJob(job: BoardJob) {
    setTitleQuery(job.title);
    setTitleOpen(false);
    setLink(job.url);
    fetchLink(job.url);
  }

  async function fetchLink(target = link) {
    if (!target.trim()) return;
    setBusy("读取岗位页面…");
    setError(null);
    try {
      const { job } = await getJSON<{ job: FetchedJob }>("/api/job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: target.trim() }),
      });
      const header = [job.title, job.company].filter(Boolean).join(" - ");
      onUse(header ? `${header}\n\n${job.description}` : job.description);
      setWarnings(job.warnings);
      setInfo(`已填入${header ? `：${header}` : ""}（来源：${METHOD_LABEL[job.method]}）。请对照原网页检查 JD 文本，再点「解析并分析」。`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  function onComboKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!open || !options.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => (i + 1) % options.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => (i - 1 + options.length) % options.length); }
    else if (e.key === "Enter") { e.preventDefault(); choose(options[active]); }
    else if (e.key === "Escape") setOpen(false);
  }

  function onTitleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (!titleOpen || !titleOptions.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); setTitleActive((i) => (i + 1) % titleOptions.length); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setTitleActive((i) => (i - 1 + titleOptions.length) % titleOptions.length); }
    else if (e.key === "Enter") { e.preventDefault(); chooseJob(titleOptions[titleActive]); }
    else if (e.key === "Escape") setTitleOpen(false);
  }

  const off = disabled || !!busy;

  return (
    <div className="job-picker">
      <h3>从岗位获取 JD <span className="note">（可选，也可以直接在下方粘贴）</span></h3>
      <div className="picker-fields">
        <div className="combo" ref={comboRef}>
          <label htmlFor="company-input">公司</label>
          <input
            id="company-input"
            role="combobox"
            aria-expanded={open && options.length > 0}
            aria-controls="company-options"
            aria-autocomplete="list"
            autoComplete="off"
            placeholder="输入公司名，例如 ama"
            value={companyQuery}
            disabled={off}
            onChange={(e) => { setCompanyQuery(e.target.value); setCompany(null); }}
            onFocus={() => options.length && setOpen(true)}
            onKeyDown={onComboKey}
          />
          {open && options.length > 0 && (
            <ul id="company-options" role="listbox" className="combo-list">
              {options.map((o, i) => (
                <li
                  key={`${o.domain}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={i === active ? "active" : ""}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={(e) => { e.preventDefault(); choose(o); }}
                >
                  {o.logo_url ? <img src={o.logo_url} alt="" width={22} height={22} /> : <span className="logo-fallback" aria-hidden>{o.name[0]}</span>}
                  <span className="combo-name">{o.name}</span>
                  <span className="combo-domain">{o.domain}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="combo" ref={titleRef}>
          <label htmlFor="title-input">职位</label>
          <input
            id="title-input"
            role="combobox"
            aria-expanded={titleOpen && titleOptions.length > 0}
            aria-controls="title-options"
            aria-autocomplete="list"
            autoComplete="off"
            placeholder={!company ? "先选择公司" : jobsBusy ? "正在查找岗位…" : hasJobs ? "输入职位关键词，例如 data analyst" : "这家公司没有可选的职位"}
            value={titleQuery}
            disabled={off || !hasJobs}
            onChange={(e) => { setTitleQuery(e.target.value); setTitleActive(0); setTitleOpen(true); }}
            onFocus={() => setTitleOpen(true)}
            onKeyDown={onTitleKey}
          />
          {titleOpen && titleOptions.length > 0 && (
            <ul id="title-options" role="listbox" className="combo-list">
              {titleOptions.map((j, i) => (
                <li
                  key={j.url}
                  role="option"
                  aria-selected={i === titleActive}
                  className={i === titleActive ? "active" : ""}
                  onMouseEnter={() => setTitleActive(i)}
                  onMouseDown={(e) => { e.preventDefault(); chooseJob(j); }}
                >
                  <span className="combo-name">{j.title}</span>
                  {j.location && <span className="combo-domain">{j.location}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {!company && <p className="note">先选公司，再从它的公开岗位里选职位，会自动读取完整 JD。</p>}
      {company && jobsBusy && <p className="note" role="status">正在查找 {company.name} 的公开岗位…</p>}
      {company && companyJobs && !hasJobs && (
        <p className="note">没有找到 {company.name} 在 Greenhouse、Lever、Ashby 上的公开招聘页（很多大公司用自己的招聘网站）。请打开具体岗位，把链接粘贴到下方。</p>
      )}
      {company && companyJobs && hasJobs && (
        <p className="note">
          共 {companyJobs.jobs.length} 个公开岗位，来自{" "}
          {companyJobs.boards.map((b, i) => (
            <span key={b.url}>{i > 0 && "、"}<a href={b.url} target="_blank" rel="noreferrer">{BOARD_LABEL[b.kind]}（{b.slug}）</a></span>
          ))}
          。招聘页名称是按公司名猜的，请点开确认是这家公司。
        </p>
      )}
      {hasJobs && titleQuery.trim() && titleOptions.length === 0 && <p className="note">没有匹配的职位，换个关键词试试。</p>}
      {companySource === "mock" && <p className="note">示例数据：没有配置 LOGO_DEV_SECRET_KEY，公司列表来自内置的几十家公司。</p>}
      {companySource === "logo.dev" && <p className="note"><a href="https://logo.dev" target="_blank" rel="noreferrer">Logos provided by Logo.dev</a></p>}

      <div className="picker-fields">
        <div className="field grow">
          <label htmlFor="link-input">或者：粘贴岗位链接</label>
          <input id="link-input" type="url" placeholder="https://… 具体岗位的详情页" value={link} disabled={off}
            onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") fetchLink(); }} />
        </div>
        <button onClick={() => fetchLink()} disabled={off || !link.trim()}>获取完整 JD</button>
      </div>
      <p className="note">公司官网、Greenhouse、Lever、Ashby 等页面通常能读到。LinkedIn 等需要登录的网站读不到，请手动复制。</p>
      {busy && <p className="note" role="status">{busy}</p>}
      {error && <div className="err">{error}</div>}
      {info && <p className="note" role="status">{info}</p>}
      {warnings.length > 0 && <ul className="warn">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
    </div>
  );
}
