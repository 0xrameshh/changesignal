import type { CollectorPayload } from "./pipeline";

/**
 * Facts recorded in evidence/live-failure.json for the pre-heal run. These are
 * transcribed from the evidence file, not generated at runtime.
 */
export const recordedFailure = {
  capturedAt: "2026-08-19T12:58:26Z",
  evidencePath: "evidence/live-failure.json",
  entryCount: 176,
  incompleteSummaryCount: 50,
  contractRule: "summary must contain a meaningful article synopsis, not navigation or boilerplate text",
} as const;

/**
 * The boilerplate summary values the evidence file records for the entries it
 * names as samples. Keyed by entry title so the replay stays correct even if
 * entry ordering changes.
 */
export const recordedWeakSummaries: Readonly<Record<string, string>> = {
  "Bun v0.1.7": "To upgrade:",
  "Bun v0.5.2": "Note",
  "Bun v1.1.44": "Note",
};

export interface RecordedFailureReplay {
  /** The verified payload with recorded boilerplate summaries reinstated. */
  payload: CollectorPayload;
  /** Titles whose summaries were replaced, in payload order. */
  degradedTitles: string[];
}

/**
 * Rebuilds the recorded semantic failure by reinstating the boilerplate summary
 * values from `evidence/live-failure.json` into an otherwise healthy payload.
 *
 * This mutates nothing: the healed payload stays intact so the workspace can
 * hold the last valid data while the degraded copy is rejected by the contract.
 */
export function buildRecordedFailureReplay(payload: CollectorPayload): RecordedFailureReplay {
  const degradedTitles: string[] = [];
  const entries = payload.entries.map((entry) => {
    const weakSummary = recordedWeakSummaries[entry.title];
    if (weakSummary === undefined) return entry;
    degradedTitles.push(entry.title);
    return { ...entry, summary: weakSummary };
  });

  return { payload: { ...payload, entries }, degradedTitles };
}
