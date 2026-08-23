import { describe, expect, it } from "vitest";
import { normalizeArtifact, verifiedArtifact } from "./artifact";

describe("artifact boundary", () => {
  it("loads the promoted post-heal artifact through the normalizer", () => {
    expect(verifiedArtifact.mode).toBe("live");
    expect(verifiedArtifact.collectorId).toBe("c_mt03abix22hd4vf273");
    expect(verifiedArtifact.events.length).toBe(176);
    expect(verifiedArtifact.recoveryVerified).toBe(true);
    expect(verifiedArtifact.recoveryEvidence).toBe("evidence/live-run-recovered.json");
    expect(verifiedArtifact.events[0].url).toContain("bun.com/blog");
  });

  it("ships no entry with a boilerplate summary", () => {
    const weak = verifiedArtifact.events.filter((event) => /^(note|to upgrade:?)$/i.test(event.summary.trim()) || event.summary.trim().length < 24);
    expect(weak).toEqual([]);
  });

  it("normalizes an arbitrary live payload through the same boundary", () => {
    const result = normalizeArtifact(
      {
        contractVersion: "0.1",
        collectorId: "c_live_123",
        fetchedAt: "2026-08-18T00:00:00Z",
        source: "live",
        entries: [
          {
            id: "release-1",
            title: "A release",
            summary: "A useful release change for downstream developers.",
            url: "https://bun.com/blog/release-1",
            publishedAt: "2026-08-18",
            category: "RELEASE",
          },
        ],
      },
      "source",
      "live",
    );

    expect(result.mode).toBe("live");
    expect(result.collectorId).toBe("c_live_123");
    expect(result.events[0].kind).toBe("release");
  });
});
