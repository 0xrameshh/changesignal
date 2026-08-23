import "server-only";

import failure from "../../../../evidence/live-failure.json";
import rejectedHeal from "../../../../evidence/live-heal-rejected.json";
import approvedHeal from "../../../../evidence/live-heal.json";
import postHealRun from "../../../../evidence/next-live-api-run.json";
import recoveredRun from "../../../../evidence/live-run-recovered.json";
import manifest from "../../../../evidence/manifest.json";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const publicEvidence = {
  "live-failure": { fileName: "live-failure.json", value: failure },
  "live-heal-rejected": { fileName: "live-heal-rejected.json", value: rejectedHeal },
  "live-heal": { fileName: "live-heal.json", value: approvedHeal },
  "next-live-api-run": { fileName: "next-live-api-run.json", value: postHealRun },
  "live-run-recovered": { fileName: "live-run-recovered.json", value: recoveredRun },
  manifest: { fileName: "manifest.json", value: manifest },
} as const;

type EvidenceName = keyof typeof publicEvidence;

export async function GET(_request: Request, context: { params: Promise<{ name: string }> }) {
  const { name } = await context.params;
  if (!(name in publicEvidence)) {
    return Response.json({ error: "Evidence file not found." }, { status: 404, headers: { "cache-control": "no-store" } });
  }

  const evidence = publicEvidence[name as EvidenceName];
  return Response.json(evidence.value, {
    headers: {
      "cache-control": "public, max-age=3600, stale-while-revalidate=86400",
      "content-disposition": `inline; filename="${evidence.fileName}"`,
      "x-content-type-options": "nosniff",
    },
  });
}
