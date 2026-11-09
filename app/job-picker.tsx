"use client";

import { useEffect, useRef, useState } from "react";
import type { CompanyOption, FetchedJob } from "@/lib/job-sources";

// Optional helper above the JD box: company autocomplete and full JD from a job link.
// A fetched JD only fills the JD box; the user still reviews it and clicks 「解析并分析」.
// The chosen company is not used yet: job search needs a data source and is on hold.

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
    const close = (e: MouseEvent) => { if (!comboRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  function choose(option: CompanyOption) {
    setCompany(option);
    setCompanyQuery(option.name);
    setOpen(false);
    setOptions([]);
  }

  async function fetchLink() {
    if (!link.trim()) return;
    setBusy("读取岗位页面…");
    setError(null);
    try {
      const { job } = await getJSON<{ job: FetchedJob }>("/api/job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: link.trim() }),
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
      </div>
      {company && <p className="note">已选择 {company.name}。按公司搜索岗位还在开发中，请先粘贴具体岗位的链接。</p>}
      {companySource === "mock" && <p className="note">示例数据：没有配置 LOGO_DEV_SECRET_KEY，公司列表来自内置的几十家公司。</p>}
      {companySource === "logo.dev" && <p className="note"><a href="https://logo.dev" target="_blank" rel="noreferrer">Logos provided by Logo.dev</a></p>}

      <div className="picker-fields">
        <div className="field grow">
          <label htmlFor="link-input">岗位链接</label>
          <input id="link-input" type="url" placeholder="https://… 具体岗位的详情页" value={link} disabled={off}
            onChange={(e) => setLink(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") fetchLink(); }} />
        </div>
        <button onClick={fetchLink} disabled={off || !link.trim()}>获取完整 JD</button>
      </div>
      <p className="note">公司官网、Greenhouse、Lever、Ashby 等页面通常能读到。LinkedIn 等需要登录的网站读不到，请手动复制。</p>
      {busy && <p className="note" role="status">{busy}</p>}
      {error && <div className="err">{error}</div>}
      {info && <p className="note" role="status">{info}</p>}
      {warnings.length > 0 && <ul className="warn">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
    </div>
  );
}
