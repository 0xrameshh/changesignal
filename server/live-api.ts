import "server-only";

import { spawn, type ChildProcess } from "node:child_process";
import { accessSync, constants as fsConstants } from "node:fs";
import { dirname, resolve } from "node:path";
import { ArtifactContractError, parseCollectorPayload } from "../src/lib/contract";
import { sanitizeHealOutput, sanitizeRawCollectorOutput } from "../src/lib/raw-sanitize";
import { getOperatorSecurity, isLiveActionAuthorized, isSameOriginRequest } from "./live-auth";

const MAX_STDOUT_BYTES = 16 * 1024 * 1024;
const MAX_STDERR_BYTES = 1024 * 1024;
const MAX_BODY_BYTES = 8 * 1024;
const BODY_READ_TIMEOUT_MS = 5_000;
const MAX_HEAL_PROMPT_LENGTH = 1_000;
const MIN_ACTION_INTERVAL_MS = 5_000;
const WEB_REPAIR_ID = "summary-contract-v1";
const WEB_HEAL_PROMPT = "Fix only summary extraction. Replace boilerplate summaries such as Note and To upgrade with a meaningful one- or two-sentence article synopsis. Preserve the entries array and title, published_date, category, summary, and url fields. Keep published_date as a non-empty ISO-8601 string. Do not change the collector target or include personal data.";
const COMMAND_TIMEOUT_MS = 10 * 60 * 1000;
const TERMINATION_GRACE_MS = 5_000;

type LiveAction = "run" | "heal";

type LiveConfig = {
  collectorId: string;
  targetUrl: string;
};

export class LiveServiceError extends Error {
  status: number;
  detail?: string;
  code?: string;

  constructor(message: string, status: number, detail?: string, code?: string) {
    super(message);
    this.name = "LiveServiceError";
    this.status = status;
    this.detail = detail;
    this.code = code;
  }
}

let activeAction: LiveAction | null = null;
let activeChild: ChildProcess | null = null;
let lastActionStartedAt = 0;

export function getLiveConfig(): LiveConfig | null {
  const collectorId = process.env.BRIGHTDATA_COLLECTOR_ID?.trim();
  if (!collectorId || !/^c_[a-zA-Z0-9]{8,126}$/.test(collectorId)) return null;

  const targetUrl = process.env.BRIGHTDATA_TARGET_URL?.trim() || "https://bun.sh/blog";
  try {
    const url = new URL(targetUrl);
    if (targetUrl.length > 2_048 || url.protocol !== "https:" || url.username || url.password) return null;
  } catch {
    return null;
  }
  return { collectorId, targetUrl };
}

export function getPublicLiveConfig(request: Request) {
  const config = getLiveConfig();
  const security = getOperatorSecurity();
  const authorized = Boolean(config) && isLiveActionAuthorized(request);
  return {
    configured: Boolean(config),
    enabled: authorized,
    requiresAuth: Boolean(config) && security.keyConfigured && !authorized,
    healEnabled: authorized && process.env.CHANGESIGNAL_ALLOW_WEB_HEAL === "true",
  };
}

function isLiveActionsEnabled(): boolean {
  if (process.env.NODE_ENV !== "production") return true;
  return process.env.CHANGESIGNAL_ENABLE_LIVE_ACTIONS === "true";
}

function redact(value: string): string {
  return value
    .replace(/(api[_ -]?key|token|authorization|password|secret)\s*[:=]\s*[^\s,]+/gi, "$1=[redacted]")
    .replace(/\b[a-f0-9]{32,}\b/gi, "[redacted]");
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") throw new LiveServiceError("Content-Type must be application/json.", 415);

  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) throw new LiveServiceError("Request body is too large.", 413);
  if (!request.body) return {};

  const bodyController = new AbortController();
  const bodyTimeout = setTimeout(() => bodyController.abort(), BODY_READ_TIMEOUT_MS);
  bodyTimeout.unref();
  const bodySignal = bodyController.signal;

  try {
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let totalBytes = 0;
    while (true) {
      const readPromise = reader.read();
      const abortPromise = new Promise<{ done: true; value: undefined }>((resolve, reject) => {
        if (bodySignal.aborted) reject(new LiveServiceError("Request body read timed out.", 408));
        bodySignal.addEventListener("abort", () => reject(new LiveServiceError("Request body read timed out.", 408)), { once: true });
      });
      const { done, value } = await Promise.race([readPromise, abortPromise]);
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_BODY_BYTES) {
        await reader.cancel("Request body exceeded the configured limit.");
        throw new LiveServiceError("Request body is too large.", 413);
      }
      chunks.push(value);
    }

    const text = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
    if (!text) return {};
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new LiveServiceError("Request body must be valid JSON.", 400);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new LiveServiceError("Request body must be a JSON object.", 400);
    return parsed as Record<string, unknown>;
  } finally {
    clearTimeout(bodyTimeout);
  }
}

function resolveCliEntry(): string {
  const serverRoot = process.argv[1] ? dirname(resolve(process.argv[1])) : process.cwd();
  const candidates = [
    resolve(serverRoot, "node_modules/@brightdata/cli/dist/index.js"),
    resolve(process.cwd(), "node_modules/@brightdata/cli/dist/index.js"),
  ];
  for (const candidate of candidates) {
    try {
      accessSync(candidate, fsConstants.R_OK);
      return candidate;
    } catch {
      // Try the next deterministic runtime root.
    }
  }
  throw new Error("Packaged Bright Data CLI entry is unavailable");
}

export function isLiveRunnerReady(): boolean {
  try {
    resolveCliEntry();
    return true;
  } catch {
    return false;
  }
}

export function isLiveActionInProgress(): boolean {
  return activeAction !== null;
}

export function stopActiveLiveAction(): void {
  if (activeChild) terminateChild(activeChild);
}

function buildCliEnvironment(config: LiveConfig, prompt?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { NODE_ENV: "production" };
  for (const name of ["PATH", "HOME", "USER", "TMPDIR", "TEMP", "LANG", "LC_ALL", "XDG_CONFIG_HOME", "SystemRoot", "ComSpec", "PATHEXT"]) {
    if (process.env[name]) env[name] = process.env[name];
  }
  if (process.env.BRIGHTDATA_API_KEY) env.BRIGHTDATA_API_KEY = process.env.BRIGHTDATA_API_KEY;
  env.BRIGHTDATA_COLLECTOR_ID = config.collectorId;
  env.BRIGHTDATA_TARGET_URL = config.targetUrl;
  env.BRIGHTDATA_HEAL_AUTO_APPROVE = "false";
  if (prompt) env.BRIGHTDATA_HEAL_PROMPT = prompt;
  return env;
}

function terminateChild(child: ChildProcess) {
  if (child.killed || child.exitCode !== null) return;
  const signal = (value: NodeJS.Signals) => {
    try {
      if (process.platform !== "win32" && child.pid) process.kill(-child.pid, value);
      else child.kill(value);
    } catch {
      // The process may have exited between checks.
    }
  };
  signal("SIGTERM");
  const killTimer = setTimeout(() => signal("SIGKILL"), TERMINATION_GRACE_MS);
  killTimer.unref();
}

const liveRuntimeGlobal = globalThis as typeof globalThis & { __changeSignalShutdownHooks?: boolean };
if (!liveRuntimeGlobal.__changeSignalShutdownHooks) {
  liveRuntimeGlobal.__changeSignalShutdownHooks = true;
  process.once("SIGTERM", stopActiveLiveAction);
  process.once("SIGINT", stopActiveLiveAction);
}

async function runBrightData(action: LiveAction, config: LiveConfig, prompt: string | undefined, requestSignal: AbortSignal): Promise<unknown> {
  if (requestSignal.aborted) throw new Error(`${action} request was cancelled`);
  const cliEntry = resolveCliEntry();
  const args = action === "run"
    ? [cliEntry, "scraper", "run", config.collectorId, config.targetUrl, "--json", "--pretty"]
    : [cliEntry, "scraper", "heal", config.collectorId, prompt ?? "", "--json", "--pretty", "--url", config.targetUrl];

  const output = await new Promise<string>((resolveOutput, rejectOutput) => {
    const child = spawn(process.execPath, args, {
      cwd: dirname(cliEntry),
      env: buildCliEnvironment(config, prompt),
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    activeChild = child;
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      requestSignal.removeEventListener("abort", handleAbort);
      activeChild = null;
      if (error) rejectOutput(error);
      else resolveOutput(Buffer.concat(stdout).toString("utf8").trim());
    };
    let pendingError: Error | null = null;
    const failAndTerminate = (message: string) => {
      pendingError = new Error(message);
      terminateChild(child);
      // Hold the action lease until the child actually closes. A bounded fallback
      // covers the rare case where no close event arrives after the TERM→KILL grace.
      const settleFallback = setTimeout(() => finish(pendingError!), TERMINATION_GRACE_MS + 1_000);
      settleFallback.unref();
    };
    const handleAbort = () => failAndTerminate(`${action} request was cancelled`);
    const timeout = setTimeout(() => failAndTerminate(`${action} exceeded the command timeout`), COMMAND_TIMEOUT_MS);
    timeout.unref();
    requestSignal.addEventListener("abort", handleAbort, { once: true });

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > MAX_STDOUT_BYTES) return failAndTerminate(`${action} exceeded the stdout limit`);
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > MAX_STDERR_BYTES) return failAndTerminate(`${action} exceeded the stderr limit`);
      stderr.push(chunk);
    });
    child.on("error", (error) => finish(error));
    child.on("close", (code, signal) => {
      if (settled) return;
      if (pendingError) return finish(pendingError);
      if (code !== 0) {
        const diagnostic = Buffer.concat(stderr).toString("utf8").trim().slice(0, 2_000);
        return finish(new Error(`${action} exited with ${code ?? signal ?? "unknown"}${diagnostic ? `: ${diagnostic}` : ""}`));
      }
      finish();
    });
  });

  if (!output) throw new Error(`${action} returned no JSON output`);
  try {
    const parsed = JSON.parse(output);
    return action === "run" ? sanitizeRawCollectorOutput(parsed) : sanitizeHealOutput(parsed, WEB_REPAIR_ID);
  } catch {
    throw new Error(`${action} returned an invalid JSON envelope`);
  }
}

export async function executeLiveAction(action: LiveAction, request: Request) {
  if (!isSameOriginRequest(request)) {
    throw new LiveServiceError("Cross-site live actions are not allowed.", 403);
  }

  const config = getLiveConfig();
  if (!config) {
    throw new LiveServiceError(
      "Live collector is not configured.",
      503,
      "Set a valid BRIGHTDATA_COLLECTOR_ID and HTTPS target before starting the server.",
    );
  }

  if (!isLiveActionsEnabled()) {
    throw new LiveServiceError(
      "Fresh live actions are disabled on this deployment.",
      503,
      "Read-only snapshots remain available. Enable fresh actions only on a private single-replica operator service with a Bright Data budget cap.",
    );
  }

  const security = getOperatorSecurity();
  if (!security.keyConfigured && !security.allowUnauthenticated) {
    throw new LiveServiceError("Live actions are locked by default.", 503, "Configure CHANGESIGNAL_OPERATOR_KEY with at least 16 characters.");
  }
  if (!isLiveActionAuthorized(request)) {
    throw new LiveServiceError("A valid operator key is required.", 401);
  }
  if (action === "heal" && process.env.CHANGESIGNAL_ALLOW_WEB_HEAL !== "true") {
    throw new LiveServiceError("Web healing is disabled.", 403, "Run pnpm bright:heal for reviewed approval, or explicitly set CHANGESIGNAL_ALLOW_WEB_HEAL=true.");
  }
  if (activeAction) {
    throw new LiveServiceError(`A live ${activeAction} is already running.`, 409);
  }
  if (Date.now() - lastActionStartedAt < MIN_ACTION_INTERVAL_MS) {
    throw new LiveServiceError("Live actions are being requested too quickly.", 429, "Wait a few seconds and try again.");
  }

  activeAction = action;
  try {
    const body = await readJson(request);
    const allowedKeys = action === "heal" ? new Set(["repairId"]) : new Set<string>();
    const unknownKeys = Object.keys(body).filter((key) => !allowedKeys.has(key));
    if (unknownKeys.length) throw new LiveServiceError(`Unknown request field: ${unknownKeys[0]}.`, 400);
    if (action === "heal" && body.repairId !== WEB_REPAIR_ID) {
      throw new LiveServiceError("A supported server-owned repair plan is required.", 400);
    }
    const prompt = action === "heal" ? WEB_HEAL_PROMPT : undefined;
    if (prompt && prompt.length > MAX_HEAL_PROMPT_LENGTH) throw new LiveServiceError("The server repair plan exceeds the CLI limit.", 500);

    lastActionStartedAt = Date.now();
    const raw = await runBrightData(action, config, prompt, request.signal);
    const fetchedAt = new Date().toISOString();
    if (action === "run") parseCollectorPayload(raw, { collectorId: config.collectorId, fetchedAt, source: "live" });
    return {
      action,
      collectorId: config.collectorId,
      targetUrl: config.targetUrl,
      fetchedAt,
      raw,
    };
  } catch (error) {
    if (error instanceof LiveServiceError) throw error;
    if (error instanceof ArtifactContractError) {
      console.error(`[live-api] ${action} contract rejected: ${redact(error.message)}`);
      throw new LiveServiceError(
        "Collector output failed the semantic contract.",
        422,
        process.env.NODE_ENV === "development" ? error.message : "The last valid output was preserved. Review or repair the collector before rerunning.",
        "CONTRACT_FAILED",
      );
    }
    const internalDetail = error instanceof Error ? redact(error.message) : "Bright Data command failed";
    console.error(`[live-api] ${action} failed: ${internalDetail}`);
    const detail = process.env.NODE_ENV === "development"
      ? internalDetail
      : "The Bright Data command did not complete. Check the server logs.";
    throw new LiveServiceError(`${action} failed`, 502, detail);
  } finally {
    activeAction = null;
  }
}
