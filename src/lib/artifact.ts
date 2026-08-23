import verifiedCollector from "../../data/collector.live.json";
import { parseCollectorPayload } from "./contract";
import { normalizeCollectorPayload, type CollectorPayload } from "./pipeline";
import type { ChangeEvent } from "../types";

export type ArtifactMode = "live" | "recovery-replay";

export interface NormalizedArtifact {
  mode: ArtifactMode;
  contractVersion: string;
  collectorId: string;
  fetchedAt: string;
  recoveryVerified: boolean;
  recoveryEvidence?: string;
  events: ChangeEvent[];
}

type CollectorArtifactPayload = CollectorPayload & {
  recoveryVerified?: boolean;
  recoveryEvidence?: string | null;
};

export function normalizeArtifact(
  payload: CollectorArtifactPayload,
  sourceId: string,
  mode: ArtifactMode,
): NormalizedArtifact {
  const validated = parseCollectorPayload(payload);
  return {
    mode,
    contractVersion: validated.contractVersion ?? "unversioned",
    collectorId: validated.collectorId,
    fetchedAt: validated.fetchedAt,
    recoveryVerified: payload.recoveryVerified === true,
    ...(typeof payload.recoveryEvidence === "string" ? { recoveryEvidence: payload.recoveryEvidence } : {}),
    events: normalizeCollectorPayload(validated, sourceId),
  };
}

/**
 * The sanitized post-heal collector run promoted from
 * `evidence/live-run-recovered.json`. This is the only dataset the workspace
 * ships: it is real recorded output from collector `c_mt03abix22hd4vf273`.
 */
export const verifiedArtifact = normalizeArtifact(
  verifiedCollector as CollectorArtifactPayload,
  "bun",
  "live",
);

/** The raw promoted payload, used for the collector JSON view and replay input. */
export const verifiedPayload = verifiedCollector as CollectorArtifactPayload;
