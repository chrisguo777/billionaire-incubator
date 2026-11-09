import { NextResponse } from "next/server";
import { companySource, searchCompanies } from "@/lib/job-sources";
import { FetchError } from "@/lib/safe-fetch";

export const runtime = "nodejs";

// GET /api/company?q=ama → company suggestions for the autocomplete box.
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  try {
    return NextResponse.json({ source: companySource(), companies: await searchCompanies(q) });
  } catch (err) {
    const status = err instanceof FetchError ? err.status : 500;
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status });
  }
}
