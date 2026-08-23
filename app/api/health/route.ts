import "server-only";

import { getLiveConfig, isLiveActionInProgress, isLiveRunnerReady } from "../../../server/live-api";
import { getOperatorSecurity } from "../../../server/live-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const security = getOperatorSecurity();
  return Response.json({
    status: "ok",
    service: "changesignal",
    liveCollectorConfigured: Boolean(getLiveConfig()),
    liveActionsProtected: security.keyConfigured && !security.allowUnauthenticated,
    liveRunnerReady: isLiveRunnerReady(),
    liveActionInProgress: isLiveActionInProgress(),
    webHealingEnabled: process.env.CHANGESIGNAL_ALLOW_WEB_HEAL === "true",
    release: process.env.CHANGESIGNAL_RELEASE ?? null,
    timestamp: new Date().toISOString(),
  }, {
    headers: { "cache-control": "no-store" },
  });
}
