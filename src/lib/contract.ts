import { cleanPublicSummary } from "./raw-sanitize";
import type { CollectorEntry, CollectorPayload } from "./pipeline";

export class ArtifactContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ArtifactContractError";
  }
}

export interface CollectorParseContext {
  collectorId: string;
  fetchedAt: string;
  contractVersion?: string;
  source?: "fixture" | "live";
}

const MAX_ENTRIES = 1_000;
const ALLOWED_PUBLIC_HOSTS = new Set(["bun.sh", "www.bun.sh", "bun.com", "www.bun.com"]);

function requireString(value: unknown, label: string, maxLength = 5_000): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ArtifactContractError(`${label} must be a non-empty string`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new ArtifactContractError(`${label} exceeds ${maxLength} characters`);
  return normalized;
}

function requirePublicUrl(value: unknown, label: string): string {
  const rawUrl = requireString(value, label, 2_048);
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || !ALLOWED_PUBLIC_HOSTS.has(url.hostname.toLowerCase()) || url.username || url.password) {
      throw new Error("unsupported URL");
    }
    return url.toString();
  } catch {
    throw new ArtifactContractError(`${label} must be an HTTPS Bun URL`);
  }
}

function requireIsoDate(value: unknown, label: string): string {
  const date = requireString(value, label, 64);
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/.test(date) || !Number.isFinite(Date.parse(date))) {
    throw new ArtifactContractError(`${label} must be an ISO-8601 date`);
  }
  return date;
}

function requireMeaningfulSummary(value: string, label: string): string {
  const normalized = value.trim();
  if (/^(note|to upgrade:?|upgrade:?|read more|learn more)$/i.test(normalized) || normalized.length < 24) {
    throw new ArtifactContractError(`${label} contains boilerplate instead of a meaningful synopsis`);
  }
  return normalized;
}

function stableRawId(url: string, title: string, index: number): string {
  const slug = `${url}-${title}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
  return slug || `entry-${index + 1}`;
}

function normalizeEntry(value: unknown, index: number, allowGeneratedId: boolean): CollectorEntry {
  if (!value || typeof value !== "object") throw new ArtifactContractError(`entries[${index}] must be an object`);
  const item = value as Record<string, unknown>;
  const title = requireString(item.title, `entries[${index}].title`, 300);
  const rawSummary = requireString(item.summary, `entries[${index}].summary`, 5_000);
  const summary = requireMeaningfulSummary(cleanPublicSummary(rawSummary), `entries[${index}].summary`);
  const url = requirePublicUrl(item.url, `entries[${index}].url`);
  const publishedAt = requireIsoDate(item.publishedAt ?? item.published_date, `entries[${index}].publishedAt`);
  const category = requireString(item.category, `entries[${index}].category`, 100);
  const id = allowGeneratedId
    ? typeof item.id === "string" && item.id.trim() !== "" ? requireString(item.id, `entries[${index}].id`, 200) : stableRawId(url, title, index)
    : requireString(item.id, `entries[${index}].id`, 200);

  return {
    id,
    title,
    summary,
    url,
    publishedAt,
    category,
  };
}

function parseRawResults(results: unknown[], context: CollectorParseContext): CollectorPayload {
  if (results.length > MAX_ENTRIES) throw new ArtifactContractError(`raw collector output exceeds ${MAX_ENTRIES} results`);
  const entryCount = results.reduce<number>((total, result) => total + (result && typeof result === "object" && Array.isArray((result as Record<string, unknown>).entries) ? ((result as Record<string, unknown>).entries as unknown[]).length : 0), 0);
  if (entryCount > MAX_ENTRIES) throw new ArtifactContractError(`raw collector output exceeds ${MAX_ENTRIES} entries`);

  const entries = results.flatMap((result, resultIndex) => {
    if (!result || typeof result !== "object") throw new ArtifactContractError(`results[${resultIndex}] must be an object`);
    const rawEntries = (result as Record<string, unknown>).entries;
    if (!Array.isArray(rawEntries)) throw new ArtifactContractError(`results[${resultIndex}].entries must be an array`);
    return rawEntries.map((entry, entryIndex) => normalizeEntry(entry, entryIndex, true));
  });

  if (entries.length === 0) throw new ArtifactContractError("raw collector output contains no entries");
  const seenIds = new Set<string>();
  for (const entry of entries) {
    if (seenIds.has(entry.id)) throw new ArtifactContractError(`duplicate entry id: ${entry.id}`);
    seenIds.add(entry.id);
  }
  return {
    ...(context.contractVersion ? { contractVersion: context.contractVersion } : {}),
    collectorId: requireString(context.collectorId, "collectorId", 128),
    fetchedAt: requireIsoDate(context.fetchedAt, "fetchedAt"),
    ...(context.source ? { source: context.source } : {}),
    entries,
  };
}

export function parseCollectorPayload(value: unknown, context?: CollectorParseContext): CollectorPayload {
  if (Array.isArray(value)) {
    if (!context) throw new ArtifactContractError("raw collector arrays require collector context");
    return parseRawResults(value, context);
  }
  if (!value || typeof value !== "object") throw new ArtifactContractError("collector output must be an object");

  const candidate = value as Record<string, unknown>;
  if (Array.isArray(candidate.results)) {
    return parseRawResults(candidate.results, {
      collectorId: context?.collectorId ?? requireString(candidate.collectorId, "collectorId"),
      fetchedAt: context?.fetchedAt ?? requireString(candidate.fetchedAt ?? candidate.capturedAt, "fetchedAt"),
      contractVersion: context?.contractVersion ?? (typeof candidate.contractVersion === "string" ? candidate.contractVersion : undefined),
      source: context?.source ?? (candidate.source === "fixture" || candidate.source === "live" ? candidate.source : undefined),
    });
  }

  const collectorId = requireString(candidate.collectorId, "collectorId", 128);
  const fetchedAt = requireIsoDate(candidate.fetchedAt, "fetchedAt");
  if (!Array.isArray(candidate.entries)) throw new ArtifactContractError("entries must be an array");
  if (candidate.entries.length > MAX_ENTRIES) throw new ArtifactContractError(`entries exceeds ${MAX_ENTRIES} items`);
  if (candidate.entries.length === 0) throw new ArtifactContractError("collector output contains no entries");

  const entries = candidate.entries.map((entry, index) => normalizeEntry(entry, index, false));
  const seenIds = new Set<string>();
  for (const entry of entries) {
    if (seenIds.has(entry.id)) throw new ArtifactContractError(`duplicate entry id: ${entry.id}`);
    seenIds.add(entry.id);
  }
  return {
    ...(typeof candidate.contractVersion === "string" ? { contractVersion: candidate.contractVersion } : {}),
    collectorId,
    fetchedAt,
    ...(candidate.source === "fixture" || candidate.source === "live" ? { source: candidate.source } : {}),
    entries,
  };
}
