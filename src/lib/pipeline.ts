import type { ChangeEvent } from "../types";

export interface CollectorEntry {
  id: string;
  title: string;
  summary: string;
  url: string;
  publishedAt: string;
  category: string;
  /** Supported only for backwards-compatible local fixtures; live output should use category. */
  kind?: ChangeEvent["kind"];
  impact?: ChangeEvent["impact"];
}

export interface CollectorPayload {
  contractVersion?: string;
  collectorId: string;
  fetchedAt: string;
  source?: "fixture" | "live";
  entries: CollectorEntry[];
}

function classifyKind(entry: CollectorEntry): ChangeEvent["kind"] {
  if (entry.kind) return entry.kind;
  const text = `${entry.category} ${entry.title} ${entry.summary}`.toLowerCase();
  if (/security|cve|vulnerability|unsafe/.test(text)) return "security";
  if (/breaking|deprecat|remove|migration/.test(text)) return "breaking";
  if (/fix|patch|bug|correct/.test(text)) return "fix";
  return "release";
}

function classifyImpact(entry: CollectorEntry, kind: ChangeEvent["kind"]): ChangeEvent["impact"] {
  if (entry.impact) return entry.impact;
  if (kind === "security" || kind === "breaking") return "high";
  const text = `${entry.title} ${entry.summary}`.toLowerCase();
  if (/major|performance|runtime|migration/.test(text)) return "medium";
  return "low";
}

export function normalizeCollectorPayload(payload: CollectorPayload, sourceId: string): ChangeEvent[] {
  return payload.entries.map((entry) => {
    const kind = classifyKind(entry);
    const impact = classifyImpact(entry, kind);
    return {
      id: `${sourceId}-${entry.id}`,
      sourceId,
      title: entry.title,
      summary: entry.summary,
      url: entry.url,
      publishedAt: entry.publishedAt,
      kind,
      impact,
      fields: [
        { label: "signal", value: kind },
        { label: "impact", value: impact },
        { label: "collector", value: payload.collectorId },
      ],
    };
  });
}

export function diffSnapshots(previous: ChangeEvent[], current: ChangeEvent[]): ChangeEvent[] {
  const previousById = new Map(previous.map((entry) => [entry.id, entry]));
  return current.filter((entry) => {
    const oldEntry = previousById.get(entry.id);
    return !oldEntry || oldEntry.title !== entry.title || oldEntry.summary !== entry.summary;
  });
}

