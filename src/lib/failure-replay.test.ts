import { describe, expect, it } from "vitest";
import { verifiedPayload } from "./artifact";
import { ArtifactContractError, parseCollectorPayload } from "./contract";
import { buildRecordedFailureReplay, recordedFailure, recordedWeakSummaries } from "./failure-replay";

describe("recorded failure replay", () => {
  it("reinstates every recorded boilerplate summary present in the payload", () => {
    const { payload, degradedTitles } = buildRecordedFailureReplay(verifiedPayload);

    expect(degradedTitles.length).toBeGreaterThan(0);
    for (const title of degradedTitles) {
      const entry = payload.entries.find((candidate) => candidate.title === title);
      expect(entry?.summary).toBe(recordedWeakSummaries[title]);
    }
  });

  it("is rejected by the semantic contract", () => {
    const { payload } = buildRecordedFailureReplay(verifiedPayload);
    expect(() => parseCollectorPayload(payload)).toThrow(ArtifactContractError);
  });

  it("leaves the healed payload untouched so the last valid data survives", () => {
    const before = JSON.stringify(verifiedPayload);
    buildRecordedFailureReplay(verifiedPayload);
    expect(JSON.stringify(verifiedPayload)).toBe(before);
    expect(() => parseCollectorPayload(verifiedPayload)).not.toThrow();
  });

  it("keeps the entry count identical to the recorded run", () => {
    const { payload } = buildRecordedFailureReplay(verifiedPayload);
    expect(payload.entries.length).toBe(recordedFailure.entryCount);
  });
});
