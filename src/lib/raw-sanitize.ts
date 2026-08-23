export function cleanPublicSummary(value: unknown): string {
  return String(value ?? "")
    .replace(/\s*\([^)]*👍[^)]*\)/g, "")
    .replace(/\s+\d+\s*👍/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function sanitizeHealOutput(value: unknown, repairId: string) {
  const candidate = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const rawStatus = typeof candidate.status === "string" ? candidate.status.trim().toLowerCase() : "";
  const status = ["pending", "review", "completed", "failed"].includes(rawStatus) ? rawStatus : "review";
  const text = JSON.stringify(value).toLowerCase();
  return {
    status,
    requiresApproval: /approv|review|pending/.test(text),
    repairId,
  };
}

export function sanitizeRawCollectorOutput(value: unknown): unknown[] {
  const results = Array.isArray(value) ? value : [];
  return results.map((result) => {
    if (!result || typeof result !== "object") return { entries: [] };
    const candidate = result as Record<string, unknown>;
    const rawEntries = Array.isArray(candidate.entries) ? candidate.entries : [];
    return {
      entries: rawEntries.map((entry) => {
        if (!entry || typeof entry !== "object") return {};
        const item = entry as Record<string, unknown>;
        return {
          title: item.title,
          published_date: item.published_date,
          category: item.category,
          summary: cleanPublicSummary(item.summary),
          url: item.url,
        };
      }),
      ...(typeof candidate.product_page_url === "string" ? { product_page_url: candidate.product_page_url } : {}),
      ...(candidate.input && typeof candidate.input === "object" && typeof (candidate.input as Record<string, unknown>).url === "string"
        ? { input: { url: (candidate.input as Record<string, unknown>).url } }
        : {}),
    };
  });
}
