import { afterEach, describe, expect, it, vi } from "vitest";
import { getHealDisposition, LiveApiError, healLiveCollector, runLiveCollector } from "./live-api";

const okResponse = (body: unknown) => ({
  ok: true,
  status: 200,
  text: async () => JSON.stringify(body),
});

describe("live API client", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("parses the server response through the raw collector contract", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({
      collectorId: "c_live",
      targetUrl: "https://bun.sh/blog",
      fetchedAt: "2026-08-19T13:00:00Z",
      raw: [{ entries: [{ title: "Bun release", published_date: "2026-08-19", category: "Blog", summary: "A meaningful release summary for downstream developers.", url: "https://bun.com/blog/release" }] }],
    }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await runLiveCollector("operator-key-value");

    expect(result.payload.entries[0]).toMatchObject({ title: "Bun release", publishedAt: "2026-08-19", category: "Blog" });
    expect(result.raw).toEqual([{ entries: [expect.objectContaining({ title: "Bun release" })] }]);
    expect(result.targetUrl).toBe("https://bun.sh/blog");
    expect(fetchMock).toHaveBeenCalledWith("/api/live/run", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ authorization: "Bearer operator-key-value" }),
    }));
  });

  it("requests the server-owned repair plan and preserves its compact status", async () => {
    const fetchMock = vi.fn().mockResolvedValue(okResponse({ collectorId: "c_live", raw: { status: "review", requiresApproval: true, repairId: "summary-contract-v1" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await healLiveCollector("operator-key-value");

    expect(result.raw).toEqual({ status: "review", requiresApproval: true, repairId: "summary-contract-v1" });
    expect(fetchMock).toHaveBeenCalledWith("/api/live/heal", expect.objectContaining({
      body: JSON.stringify({ repairId: "summary-contract-v1" }),
      headers: expect.objectContaining({ authorization: "Bearer operator-key-value" }),
    }));
  });

  it("preserves the safe contract-failure code without exposing an implementation stack", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => JSON.stringify({ error: "Collector output failed the semantic contract.", detail: "Last valid output held.", code: "CONTRACT_FAILED" }),
    }));

    await expect(runLiveCollector()).rejects.toEqual(expect.objectContaining<Partial<LiveApiError>>({
      message: "Collector output failed the semantic contract.",
      status: 422,
      code: "CONTRACT_FAILED",
    }));
  });

  it("treats a non-JSON error response as an operational error, not a contract failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => "Bad Gateway",
    }));

    await expect(runLiveCollector()).rejects.toEqual(expect.objectContaining<Partial<LiveApiError>>({
      message: "The live API returned a non-JSON error.",
      status: 502,
    }));
  });

  it("reports an unreachable live API as an operational error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));

    await expect(runLiveCollector()).rejects.toEqual(expect.objectContaining<Partial<LiveApiError>>({
      message: "The live API is unreachable.",
      status: 0,
    }));
  });
});

describe("getHealDisposition", () => {
  it("routes a review/required-approval result to approval", () => {
    expect(getHealDisposition({ status: "review", requiresApproval: true, repairId: "summary-contract-v1" })).toBe("approval");
  });

  it("routes a failed repair to failed", () => {
    expect(getHealDisposition({ status: "failed", requiresApproval: false, repairId: "summary-contract-v1" })).toBe("failed");
  });

  it("routes a completed repair to rerun", () => {
    expect(getHealDisposition({ status: "completed", requiresApproval: false, repairId: "summary-contract-v1" })).toBe("rerun");
  });

  it("does not match requiresApproval when its value is false", () => {
    expect(getHealDisposition({ status: "completed", requiresApproval: false })).toBe("rerun");
  });

  it("falls back to failed for non-object input", () => {
    expect(getHealDisposition(null)).toBe("failed");
    expect(getHealDisposition("completed")).toBe("failed");
  });
});
