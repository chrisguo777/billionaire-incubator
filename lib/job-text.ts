// Pure helpers for the job-link feature: address checks, HTML → text, schema.org JobPosting, ATS link detection.
// No imports so tests/job-text.cjs can load this file directly.

export interface JobPostingData {
  title: string | null;
  company: string | null;
  description: string;
}

/** True for addresses the server must never fetch: loopback, private, link-local, CGNAT, multicast, reserved. */
export function isBlockedAddress(ip: string): boolean {
  const addr = ip.trim().toLowerCase().replace(/^\[|\]$/g, "");
  const mapped = addr.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedAddress(mapped[1]);
  const v4 = addr.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    if ([a, b, Number(v4[3]), Number(v4[4])].some((n) => n > 255)) return true;
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 192 && b === 0)
      || (a === 198 && (b === 18 || b === 19));
  }
  if (!addr.includes(":")) return true; // not an IP literal we understand
  if (addr === "::" || addr === "::1") return true;
  const first = parseInt(addr.split(":")[0] || "0", 16);
  return (first & 0xfe00) === 0xfc00 // fc00::/7 unique local
    || (first & 0xffc0) === 0xfe80 // fe80::/10 link local
    || (first & 0xff00) === 0xff00 // multicast
    || addr.startsWith("64:ff9b:") // NAT64 can reach IPv4 private ranges
    || addr.startsWith("2001:db8:");
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", bull: "•", hellip: "…", middot: "·", reg: "®", trade: "™", copy: "©",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

/** Readable text from HTML: drops scripts, styles and page chrome, keeps paragraph and list breaks. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<(script|style|noscript|svg|template|iframe|head|nav|header|footer|form|button|select)\b[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<li\b[^>]*>/gi, "\n- ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/?(p|div|section|article|h[1-6]|ul|ol|tr|table|main)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function pageTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const t = m ? decodeEntities(m[1]).replace(/\s+/g, " ").trim() : "";
  return t || null;
}

function asText(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && "name" in value) return asText((value as { name: unknown }).name);
  return null;
}

/** Finds a schema.org JobPosting in JSON-LD blocks. Many career sites publish one for search engines. */
export function findJobPosting(html: string): JobPostingData | null {
  const blocks = html.matchAll(/<script[^>]+type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const block of blocks) {
    let data: unknown;
    try {
      data = JSON.parse(block[1].trim());
    } catch {
      continue;
    }
    const queue: unknown[] = [data];
    while (queue.length) {
      const node = queue.shift();
      if (Array.isArray(node)) { queue.push(...node); continue; }
      if (!node || typeof node !== "object") continue;
      const obj = node as Record<string, unknown>;
      const type = obj["@type"];
      const isPosting = type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"));
      if (isPosting && typeof obj.description === "string") {
        // Descriptions are usually HTML, sometimes HTML-escaped HTML.
        const description = htmlToText(decodeEntities(obj.description));
        if (description.length >= 200) {
          return { title: asText(obj.title), company: asText(obj.hiringOrganization), description };
        }
      }
      if (Array.isArray(obj["@graph"])) queue.push(...obj["@graph"]);
    }
  }
  return null;
}

export type AtsLink =
  | { kind: "greenhouse"; board: string; jobId: string }
  | { kind: "lever"; company: string; postingId: string }
  | { kind: "ashby"; org: string; jobId: string };

/** Recognises job links on ATS platforms that publish a free, official job-board API. */
export function detectAts(link: string): AtsLink | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);
  if (/^(boards|job-boards)(\.eu)?\.greenhouse\.io$/.test(host)) {
    const at = parts.indexOf("jobs");
    if (at === 1 && /^\d+$/.test(parts[2] ?? "")) return { kind: "greenhouse", board: parts[0], jobId: parts[2] };
    const ghJid = url.searchParams.get("gh_jid");
    if (parts[0] && ghJid && /^\d+$/.test(ghJid)) return { kind: "greenhouse", board: parts[0], jobId: ghJid };
  }
  if (host === "jobs.lever.co" && parts.length >= 2 && /^[0-9a-f-]{36}$/i.test(parts[1])) {
    return { kind: "lever", company: parts[0], postingId: parts[1] };
  }
  if (host === "jobs.ashbyhq.com" && parts.length >= 2 && /^[0-9a-f-]{36}$/i.test(parts[1])) {
    return { kind: "ashby", org: parts[0], jobId: parts[1] };
  }
  return null;
}
