#!/usr/bin/env node
import { spawn } from "node:child_process";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const distDir = process.env.NEXT_DIST_DIR?.trim() || ".next";
if (!/^[A-Za-z0-9._-]+$/.test(distDir)) throw new Error("NEXT_DIST_DIR must be a single safe directory name");
const source = join(process.cwd(), distDir, "standalone");
const temporaryRoot = await mkdtemp(join(tmpdir(), "changesignal-standalone-"));
const appRoot = join(temporaryRoot, "app");
const port = 4300 + (process.pid % 500);
const baseUrl = `http://127.0.0.1:${port}`;
const operatorKey = "standalone-smoke-operator-key";
let server;

try {
  await cp(source, appRoot, { recursive: true });
  const cliEntry = join(appRoot, "node_modules/@brightdata/cli/dist/index.js");
  await writeFile(cliEntry, `
if (process.env.UNRELATED_SECRET) process.exit(41);
console.log(JSON.stringify([{ entries: [{
  title: "Bun smoke release",
  published_date: "2026-08-19T00:00:00Z",
  category: "Blog",
  summary: "A deterministic packaged-runner smoke result.",
  url: "https://bun.com/blog/smoke-release"
}] }]));
`, "utf8");

  server = spawn(process.execPath, ["server.js"], {
    cwd: appRoot,
    env: {
      ...process.env,
      HOSTNAME: "127.0.0.1",
      PORT: String(port),
      BRIGHTDATA_COLLECTOR_ID: "c_standalonesmoke123",
      BRIGHTDATA_TARGET_URL: "https://bun.sh/blog",
      CHANGESIGNAL_OPERATOR_KEY: operatorKey,
      CHANGESIGNAL_ENABLE_LIVE_ACTIONS: "true",
      CHANGESIGNAL_ALLOW_WEB_HEAL: "false",
      CHANGESIGNAL_RELEASE: "standalone-smoke-build",
      UNRELATED_SECRET: "must-not-reach-child",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let diagnostics = "";
  server.stdout.on("data", (chunk) => { diagnostics += chunk.toString(); });
  server.stderr.on("data", (chunk) => { diagnostics += chunk.toString(); });

  let healthy = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      const body = await response.json();
      if (response.ok && body.status === "ok" && body.liveRunnerReady === true && body.release === "standalone-smoke-build") {
        healthy = true;
        break;
      }
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!healthy) throw new Error(`Standalone server did not become ready. ${diagnostics}`);

  const evidenceResponse = await fetch(`${baseUrl}/api/evidence/manifest`);
  const evidence = await evidenceResponse.json();
  if (!evidenceResponse.ok || evidence.collectorId !== "c_mt03abix22hd4vf273" || evidence.schemaVersion !== 1) {
    throw new Error(`Bundled evidence route smoke failed (${evidenceResponse.status}).`);
  }

  const unauthorizedResponse = await fetch(`${baseUrl}/api/live/run`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: "{}",
  });
  if (unauthorizedResponse.status !== 401) throw new Error(`Packaged live runner did not reject an unauthorized request (${unauthorizedResponse.status}).`);

  const invalidContentTypeResponse = await fetch(`${baseUrl}/api/live/run`, {
    method: "POST",
    headers: { authorization: `Bearer ${operatorKey}`, "content-type": "text/plain", origin: baseUrl },
    body: "{}",
  });
  if (invalidContentTypeResponse.status !== 415) throw new Error(`Packaged live runner did not enforce JSON (${invalidContentTypeResponse.status}).`);

  const response = await fetch(`${baseUrl}/api/live/run`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${operatorKey}`,
      "content-type": "application/json",
      origin: baseUrl,
    },
    body: "{}",
  });
  const body = await response.json();
  if (!response.ok || body.collectorId !== "c_standalonesmoke123" || body.raw?.[0]?.entries?.[0]?.title !== "Bun smoke release") {
    throw new Error(`Packaged live runner smoke failed (${response.status}): ${JSON.stringify(body)}`);
  }

  console.log(JSON.stringify({ passed: true, port, isolatedRoot: appRoot, buildIdentityVerified: true, unauthorizedRejected: true, jsonRequired: true, liveRunnerReady: true, minimalChildEnvironment: true, allowlistedEvidenceBundled: true }));
} finally {
  if (server && server.exitCode === null) {
    server.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 100));
    if (server.exitCode === null) server.kill("SIGKILL");
  }
  await rm(temporaryRoot, { recursive: true, force: true });
}
