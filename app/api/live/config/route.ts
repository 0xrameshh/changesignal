import { getPublicLiveConfig } from "../../../../server/live-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return Response.json(getPublicLiveConfig(request), {
    headers: { "cache-control": "no-store" },
  });
}
