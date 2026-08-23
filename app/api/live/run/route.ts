import { executeLiveAction, LiveServiceError } from "../../../../server/live-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

export async function POST(request: Request) {
  try {
    return Response.json(await executeLiveAction("run", request), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof LiveServiceError) {
      const headers: Record<string, string> = { "cache-control": "no-store" };
      if (error.status === 401) headers["www-authenticate"] = "Bearer";
      if (error.status === 429) headers["retry-after"] = "5";
      return Response.json({ error: error.message, detail: error.detail, code: error.code }, { status: error.status, headers });
    }
    return Response.json({ error: "Live API failed" }, { status: 500 });
  }
}
