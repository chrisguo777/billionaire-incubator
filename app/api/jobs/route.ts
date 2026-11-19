import { NextResponse } from "next/server";
import { listCompanyJobs } from "@/lib/job-sources";

export const runtime = "nodejs";
export const maxDuration = 60;

// GET /api/jobs?name=Stripe&domain=stripe.com → the company's open jobs on Greenhouse, Lever and Ashby.
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const name = (params.get("name") ?? "").trim();
  const domain = (params.get("domain") ?? "").trim();
  if (name.length < 2 || name.length > 80 || domain.length > 120) {
    return NextResponse.json({ error: "请先选择公司" }, { status: 400 });
  }
  try {
    return NextResponse.json(await listCompanyJobs(name, domain || null));
  } catch (err) {
    console.error("[api/jobs]", err);
    return NextResponse.json({ error: "岗位列表暂时读不到，请粘贴具体岗位的链接" }, { status: 502 });
  }
}
