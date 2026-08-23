import { parseCollectorPayload } from "./contract";
import type { CollectorPayload } from "./pipeline";

export class LiveApiError extends Error {
  status: number;
  detail?: string;
  code?: string;

  constructor(message: string, status: number, detail?: string, code?: string) {
    super(message);
    this.name = "LiveApiError";
    this.status = status;
    this.detail = detail;
    this.code = code;
  }
}

export interface LiveRunResult {
  payload: CollectorPayload;
  raw: unknown;
  targetUrl: string;
}

export interface LiveHealResult {
  raw: unknown;
  collectorId: string;
}

export function getHealDisposition(value: unknown): "approval" | "failed" | "rerun" {
  if (!value || typeof value !== "object") return "failed";
  const status = value as { status?: unknown; requiresApproval?: unknown };
  if (status.requiresApproval === true) return "approval";
  if (status.status === "failed") return "failed";
  return "rerun";
}

async function requestJson(path: string, body: Record<string, unknown>, operatorKey?: string): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(operatorKey ? { authorization: `Bearer ${operatorKey}` } : {}),
      },
      body: JSON.stringify(body),
    });
  } catch (networkError) {
    throw new LiveApiError("The live API is unreachable.", 0, networkError instanceof Error ? networkError.message : undefined);
  }
  const text = await response.text();
  let result: Record<string, unknown> = {};
  if (text) {
    try {
      const parsed: unknown = JSON.parse(text);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) result = parsed as Record<string, unknown>;
      else result = { error: "The live API returned an unexpected response." };
    } catch {
      throw new LiveApiError("The live API returned a non-JSON error.", response.status, text.slice(0, 200));
    }
  }
  if (!response.ok) {
    throw new LiveApiError(
      typeof result.error === "string" ? result.error : "Live API request failed",
      response.status,
      typeof result.detail === "string" ? result.detail : undefined,
      typeof result.code === "string" ? result.code : undefined,
    );
  }
  return result;
}

export async function runLiveCollector(operatorKey?: string): Promise<LiveRunResult> {
  const result = await requestJson("/api/live/run", {}, operatorKey);
  const collectorId = typeof result.collectorId === "string" ? result.collectorId : "";
  const fetchedAt = typeof result.fetchedAt === "string" ? result.fetchedAt : new Date().toISOString();
  const targetUrl = typeof result.targetUrl === "string" ? result.targetUrl : "https://bun.sh/blog";
  const payload = parseCollectorPayload(result.raw, {
    collectorId,
    fetchedAt,
    contractVersion: "0.1",
    source: "live",
  });
  return { payload, raw: result.raw, targetUrl };
}

export async function healLiveCollector(operatorKey?: string): Promise<LiveHealResult> {
  const result = await requestJson("/api/live/heal", { repairId: "summary-contract-v1" }, operatorKey);
  return {
    raw: result.raw,
    collectorId: typeof result.collectorId === "string" ? result.collectorId : "",
  };
}
