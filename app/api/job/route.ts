import { NextResponse } from "next/server";
import { fetchJobFromUrl } from "@/lib/job-sources";
import { FetchError } from "@/lib/safe-fetch";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST /api/job { url } → title, company and full JD text from a job posting link.
export async function POST(req: Request) {
  let url: unknown;
  try {
    url = (await req.json()).url;
  } catch {
    return NextResponse.json({ error: "请求格式不对" }, { status: 400 });
  }
  if (typeof url !== "string" || !url.trim() || url.length > 2000) {
    return NextResponse.json({ error: "请粘贴岗位链接" }, { status: 400 });
  }
  try {
    return NextResponse.json({ job: await fetchJobFromUrl(url) });
  } catch (err) {
    const status = err instanceof FetchError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
