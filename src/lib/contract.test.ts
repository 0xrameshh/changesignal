import { describe, expect, it } from "vitest";
import { ArtifactContractError, parseCollectorPayload } from "./contract";

const meaningfulSummary = "A meaningful release summary for contract validation.";

describe("collector contract", () => {
  it("accepts the minimal observed entry shape", () => {
    const result = parseCollectorPayload({
      collectorId: "c_demo",
      fetchedAt: "2026-08-18T00:00:00Z",
      entries: [{ id: "one", title: "One", summary: meaningfulSummary, url: "https://bun.com/blog/one", publishedAt: "2026-08-18", category: "RELEASE" }],
    });
    expect(result.entries).toHaveLength(1);
  });

  it("normalizes the live Scraper Studio result envelope", () => {
    const result = parseCollectorPayload([
      {
        entries: [{
          title: "Bun v1.2.21",
          published_date: "2025-08-25T00:00:00.000Z",
          category: "Blog",
          summary: "A meaningful release summary for developers (addressing 519 👍).",
          url: "https://bun.com/blog/bun-v1.2.21",
        }],
        product_page_url: "https://bun.sh/blog/bun-v1.2.21",
        input: { url: "https://bun.sh/blog" },
      },
    ], {
      collectorId: "c_live_bun",
      fetchedAt: "2026-08-19T12:58:26Z",
      contractVersion: "0.1",
      source: "live",
    });

    expect(result).toMatchObject({ collectorId: "c_live_bun", source: "live", contractVersion: "0.1" });
    expect(result.entries[0]).toMatchObject({
      title: "Bun v1.2.21",
      publishedAt: "2025-08-25T00:00:00.000Z",
      category: "Blog",
      url: "https://bun.com/blog/bun-v1.2.21",
    });
    expect(result.entries[0].id).toContain("bun-com-blog-bun-v1-2-21");
    expect(result.entries[0].summary).toBe("A meaningful release summary for developers.");
  });

  it("rejects boilerplate or underspecified summaries", () => {
    const context = { collectorId: "c_live_bun", fetchedAt: "2026-08-19T12:58:26Z", source: "live" as const };
    expect(() => parseCollectorPayload([
      { entries: [{ title: "Bun v1", published_date: "2026-08-19", category: "Blog", summary: "Note", url: "https://bun.com/blog/v1" }] },
    ], context)).toThrow("contains boilerplate instead of a meaningful synopsis");
    expect(() => parseCollectorPayload([
      { entries: [{ title: "Bun v1", published_date: "2026-08-19", category: "Blog", summary: "Short release note", url: "https://bun.com/blog/v1" }] },
    ], context)).toThrow("contains boilerplate instead of a meaningful synopsis");
  });

  it("accepts the sanitized live evidence wrapper", () => {
    const result = parseCollectorPayload({
      contractVersion: "0.1",
      collectorId: "c_live_bun",
      capturedAt: "2026-08-19T12:58:26Z",
      source: "live",
      results: [{ entries: [{ title: "One", published_date: "2026-08-19", category: "Blog", summary: meaningfulSummary, url: "https://bun.com/blog/one" }] }],
    });
    expect(result.entries[0].publishedAt).toBe("2026-08-19");
  });

  it("rejects empty or missing required fields", () => {
    expect(() => parseCollectorPayload({ collectorId: "c_demo", fetchedAt: "2026-08-19T00:00:00Z", entries: [{ id: "", title: "One" }] })).toThrow(ArtifactContractError);
    expect(() => parseCollectorPayload({
      collectorId: "c_demo",
      fetchedAt: "2026-08-19T00:00:00Z",
      entries: [{ id: "one", title: "One", summary: meaningfulSummary, url: "https://bun.com/blog/one", publishedAt: "2026-08-19" }],
    })).toThrow("category must be a non-empty string");
  });

  it("rejects a missing entries array", () => {
    expect(() => parseCollectorPayload({ collectorId: "c_demo", fetchedAt: "2026-08-19T00:00:00Z" })).toThrow("entries must be an array");
  });

  it("rejects unsafe links and non-ISO dates from collector output", () => {
    const context = { collectorId: "c_live_bun", fetchedAt: "2026-08-19T12:58:26Z", source: "live" as const };
    expect(() => parseCollectorPayload([{ entries: [{ title: "One", published_date: "2026-08-19", category: "Blog", summary: meaningfulSummary, url: "javascript:alert(1)" }] }], context)).toThrow("must be an HTTPS Bun URL");
    expect(() => parseCollectorPayload([{ entries: [{ title: "One", published_date: "today", category: "Blog", summary: meaningfulSummary, url: "https://bun.com/blog/one" }] }], context)).toThrow("must be an ISO-8601 date");
  });

  it("rejects unbounded collector result sets", () => {
    const entries = Array.from({ length: 1_001 }, (_, index) => ({ title: `Entry ${index}`, published_date: "2026-08-19", category: "Blog", summary: meaningfulSummary, url: `https://bun.com/blog/${index}` }));
    expect(() => parseCollectorPayload([{ entries }], { collectorId: "c_live_bun", fetchedAt: "2026-08-19T12:58:26Z" })).toThrow("exceeds 1000 entries");
  });

  it("rejects a raw array without collector context", () => {
    expect(() => parseCollectorPayload([{ entries: [] }])).toThrow("raw collector arrays require collector context");
  });

  it("rejects duplicate generated entry ids", () => {
    const context = { collectorId: "c_live_bun", fetchedAt: "2026-08-19T12:58:26Z", source: "live" as const };
    expect(() => parseCollectorPayload([
      { entries: [
        { title: "Same title", published_date: "2026-08-19", category: "Blog", summary: meaningfulSummary, url: "https://bun.com/blog/dup" },
        { title: "Same title", published_date: "2026-08-19", category: "Blog", summary: meaningfulSummary, url: "https://bun.com/blog/dup" },
      ] },
    ], context)).toThrow("duplicate entry id");
  });

  it("rejects an empty entries array as contract failure, not healthy output", () => {
    expect(() => parseCollectorPayload({
      collectorId: "c_demo",
      fetchedAt: "2026-08-19T00:00:00Z",
      entries: [],
    })).toThrow("contains no entries");
  });
});
