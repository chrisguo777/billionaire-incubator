// Pure helpers for listing a company's open jobs from public ATS job boards
// (Greenhouse, Lever, Ashby). No network or Node imports here, so the page can reuse `filterJobs`.

export type BoardKind = "greenhouse" | "lever" | "ashby";

export interface BoardJob {
  title: string;
  location: string | null;
  /** A job link that `detectAts` recognises, so the existing JD fetch can read the full posting. */
  url: string;
  source: BoardKind;
}

export interface CompanyBoard {
  kind: BoardKind;
  slug: string;
  /** Public page of the board, shown so the user can check it is the right company. */
  url: string;
}

export const BOARD_LABEL: Record<BoardKind, string> = { greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby" };

export function boardApiUrl(kind: BoardKind, slug: string): string {
  const s = encodeURIComponent(slug);
  if (kind === "greenhouse") return `https://boards-api.greenhouse.io/v1/boards/${s}/jobs`;
  if (kind === "lever") return `https://api.lever.co/v0/postings/${s}?mode=json`;
  return `https://api.ashbyhq.com/posting-api/job-board/${s}`;
}

export function boardPageUrl(kind: BoardKind, slug: string): string {
  const s = encodeURIComponent(slug);
  if (kind === "greenhouse") return `https://boards.greenhouse.io/${s}`;
  if (kind === "lever") return `https://jobs.lever.co/${s}`;
  return `https://jobs.ashbyhq.com/${s}`;
}

const SUFFIXES = /\b(inc|incorporated|llc|ltd|corp|corporation|co|company|technologies|technology|labs|hq)\b\.?/g;

/**
 * Guesses the board name ("slug") a company uses on these platforms, e.g. "Scale AI" + scale.com
 * → ["scaleai", "scale-ai", "scale"]. Boards are usually the company name or the domain's first label.
 */
export function boardSlugs(name: string, domain?: string | null): string[] {
  const out: string[] = [];
  const add = (s: string) => { if (/^[a-z0-9][a-z0-9-]{1,49}$/.test(s) && !out.includes(s)) out.push(s); };
  const base = name.toLowerCase().replace(/&/g, " and ").replace(SUFFIXES, " ").replace(/[^a-z0-9]+/g, " ").trim();
  if (base) {
    add(base.replace(/ /g, ""));
    add(base.replace(/ /g, "-"));
  }
  const label = (domain ?? "").toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[./]/)[0] ?? "";
  add(label);
  return out.slice(0, 3);
}

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.replace(/\s+/g, " ").trim() : null);

/** Turns one board's API response into job rows; anything unexpected is skipped rather than trusted. */
export function parseBoard(kind: BoardKind, slug: string, data: unknown): BoardJob[] {
  const jobs: BoardJob[] = [];
  const s = encodeURIComponent(slug);
  if (kind === "greenhouse") {
    const list = (data as { jobs?: unknown })?.jobs;
    for (const j of Array.isArray(list) ? list : []) {
      const title = text(j?.title);
      const id = j?.id;
      if (!title || !(typeof id === "number" || (typeof id === "string" && /^\d+$/.test(id)))) continue;
      // Built from the board and id: `absolute_url` often points to the company's own site, which detectAts does not know.
      jobs.push({ title, location: text(j?.location?.name), url: `https://boards.greenhouse.io/${s}/jobs/${id}`, source: kind });
    }
  } else if (kind === "lever") {
    for (const j of Array.isArray(data) ? data : []) {
      const title = text(j?.text);
      const id = j?.id;
      if (!title || typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) continue;
      jobs.push({ title, location: text(j?.categories?.location), url: `https://jobs.lever.co/${s}/${id}`, source: kind });
    }
  } else {
    const list = (data as { jobs?: unknown })?.jobs;
    for (const j of Array.isArray(list) ? list : []) {
      const title = text(j?.title);
      const id = j?.id;
      if (!title || typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id) || j?.isListed === false) continue;
      jobs.push({ title, location: text(j?.location), url: `https://jobs.ashbyhq.com/${s}/${id}`, source: kind });
    }
  }
  return jobs;
}

/**
 * Job-title autocomplete: every typed word must appear in the title or location.
 * Titles starting with the query come first, then the rest in board order.
 */
export function filterJobs(jobs: BoardJob[], query: string, limit = 10): BoardJob[] {
  const q = query.toLowerCase().trim();
  const words = q.split(/\s+/).filter(Boolean);
  const hits = jobs.filter((j) => {
    const hay = `${j.title} ${j.location ?? ""}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
  const starts = hits.filter((j) => q && j.title.toLowerCase().startsWith(q));
  return [...starts, ...hits.filter((j) => !starts.includes(j))].slice(0, limit);
}
