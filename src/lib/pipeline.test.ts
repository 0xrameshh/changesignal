import { describe, expect, it } from "vitest";
import { diffSnapshots, normalizeCollectorPayload } from "./pipeline";
import type { ChangeEvent } from "../types";

const event: ChangeEvent = {
  id: "demo-one",
  sourceId: "demo",
  title: "One",
  summary: "Stable",
  url: "https://example.com/one",
  publishedAt: "now",
  kind: "release",
  impact: "low",
  fields: [],
};

describe("ChangeSignal pipeline", () => {
  it("normalizes collector entries while preserving the collector id", () => {
    const result = normalizeCollectorPayload(
      {
        collectorId: "c_live_123",
        fetchedAt: "2026-08-17T09:42:00Z",
        entries: [
          {
            id: "one",
            title: "One",
            summary: "Stable",
            url: "https://example.com/one",
            publishedAt: "now",
            category: "RELEASE",
          },
        ],
      },
      "demo",
    );

    expect(result[0].id).toBe("demo-one");
    expect(result[0].fields.at(-1)).toEqual({ label: "collector", value: "c_live_123" });
  });

  it("only returns new or materially changed events", () => {
    const changed = { ...event, summary: "Updated" };
    expect(diffSnapshots([event], [event, changed])).toEqual([changed]);
  });
});
