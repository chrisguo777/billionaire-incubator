import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import zlib from "node:zlib";
import type { Readable } from "node:stream";
import { isBlockedAddress } from "./job-text";

// Fetches a user-supplied URL without letting it reach our own machine or private network (SSRF).
// The DNS answer is checked inside the socket's own lookup, so the address we check is the one we connect to,
// and every redirect hop is checked again.

export class FetchError extends Error {
  constructor(message: string, readonly status = 422) {
    super(message);
  }
}

export interface FetchedPage {
  url: string;
  status: number;
  contentType: string;
  body: string;
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void;

function safeLookup(hostname: string, options: dns.LookupOptions, callback: LookupCallback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    const list = addresses as dns.LookupAddress[];
    if (!list.length || list.some((a) => isBlockedAddress(a.address))) {
      return callback(Object.assign(new Error(`blocked address for ${hostname}`), { code: "EBLOCKED" }), "", 0);
    }
    if (options.all) return callback(null, list);
    callback(null, list[0].address, list[0].family);
  });
}

function checkUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new FetchError("链接格式不对，请粘贴完整的岗位网址（以 https:// 开头）", 400);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new FetchError("只支持 http 或 https 链接", 400);
  if (url.username || url.password) throw new FetchError("链接里不能包含账号或密码", 400);
  if (url.port && url.port !== "80" && url.port !== "443") throw new FetchError("不支持带特殊端口的链接", 400);
  const host = url.hostname.replace(/^\[|\]$/g, "");
  // Node skips the lookup function for IP literals, so check those here.
  if (net.isIP(host) && isBlockedAddress(host)) throw new FetchError("不能访问这个地址", 400);
  return url;
}

function requestOnce(url: URL, accept: string, timeoutMs: number, maxBytes: number): Promise<{ status: number; location?: string; contentType: string; body: string }> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(url, {
      method: "GET",
      lookup: safeLookup as unknown as net.LookupFunction,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; ResumeAgentDemo/0.1; job description fetch on user request)",
        Accept: accept,
        "Accept-Encoding": "gzip, deflate, br",
        "Accept-Language": "en-US,en;q=0.9",
      },
      timeout: timeoutMs,
    }, (res) => {
      const status = res.statusCode ?? 0;
      const contentType = String(res.headers["content-type"] ?? "");
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume();
        return resolve({ status, location: res.headers.location, contentType, body: "" });
      }
      const encoding = String(res.headers["content-encoding"] ?? "").toLowerCase();
      let stream: Readable = res;
      if (encoding === "gzip" || encoding === "x-gzip") stream = res.pipe(zlib.createGunzip());
      else if (encoding === "deflate") stream = res.pipe(zlib.createInflate());
      else if (encoding === "br") stream = res.pipe(zlib.createBrotliDecompress());
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) {
          req.destroy();
          reject(new FetchError("页面太大，无法读取，请手动复制 JD"));
          return;
        }
        chunks.push(chunk);
      });
      stream.on("end", () => {
        const charset = contentType.match(/charset=([\w-]+)/i)?.[1] ?? "utf-8";
        let body: string;
        try {
          body = new TextDecoder(charset).decode(Buffer.concat(chunks));
        } catch {
          body = Buffer.concat(chunks).toString("utf8");
        }
        resolve({ status, contentType, body });
      });
      stream.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new FetchError("网站响应超时，请稍后再试或手动复制 JD")));
    req.on("error", (err: NodeJS.ErrnoException) => {
      if (err instanceof FetchError) return reject(err);
      if (err.code === "EBLOCKED") return reject(new FetchError("不能访问这个地址", 400));
      if (err.code === "ENOTFOUND") return reject(new FetchError("找不到这个网站，请检查链接"));
      reject(new FetchError("打不开这个链接，请手动复制 JD"));
    });
    req.end();
  });
}

export async function safeFetch(
  raw: string,
  { accept = "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5", timeoutMs = 10_000, maxBytes = 3_000_000, maxRedirects = 4 } = {},
): Promise<FetchedPage> {
  let url = checkUrl(raw);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await requestOnce(url, accept, timeoutMs, maxBytes);
    if (res.location) {
      url = checkUrl(new URL(res.location, url).toString());
      continue;
    }
    if (res.status === 401 || res.status === 403) throw new FetchError("这个网站不允许自动读取（可能需要登录或有反爬限制），请手动复制 JD");
    if (res.status === 404 || res.status === 410) throw new FetchError("岗位页面不存在，可能已经下线");
    if (res.status < 200 || res.status >= 300) throw new FetchError(`网站返回错误（${res.status}），请手动复制 JD`);
    return { url: url.toString(), status: res.status, contentType: res.contentType, body: res.body };
  }
  throw new FetchError("跳转次数太多，请手动复制 JD");
}
