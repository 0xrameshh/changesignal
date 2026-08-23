#!/usr/bin/env node
import fs from "node:fs";
import { createHash } from "node:crypto";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error("Usage: sanitize-live-run.mjs <input-json> <output-json>");
  process.exit(1);
}

const sourceBytes = fs.readFileSync(inputPath);
const raw = JSON.parse(sourceBytes.toString("utf8"));
const payload = raw?.raw ?? raw;
const results = Array.isArray(payload) ? payload : Array.isArray(payload?.results) ? payload.results : [];
const cleanSummary = (value) => String(value ?? "")
  .replace(/\s*\([^)]*👍[^)]*\)/g, "")
  .replace(/\s+\d+\s*👍/g, "")
  .replace(/\s{2,}/g, " ")
  .trim();

const sanitizedResults = results.map((result) => ({
  entries: Array.isArray(result?.entries)
    ? result.entries.map((entry) => ({
        title: String(entry?.title ?? ""),
        published_date: String(entry?.published_date ?? ""),
        category: String(entry?.category ?? ""),
        summary: cleanSummary(entry?.summary),
        url: String(entry?.url ?? ""),
      }))
    : [],
  ...(result?.product_page_url ? { product_page_url: String(result.product_page_url) } : {}),
  ...(result?.input?.url ? { input: { url: String(result.input.url) } } : {}),
}));

const entryCount = sanitizedResults.reduce((total, result) => total + result.entries.length, 0);
const artifact = {
  contractVersion: "0.1",
  mode: "live",
  source: "live",
  collectorId: process.env.BRIGHTDATA_COLLECTOR_ID ?? "",
  targetUrl: process.env.BRIGHTDATA_TARGET_URL ?? "https://bun.sh/blog",
  capturedAt: process.env.CAPTURED_AT ?? raw?.fetchedAt ?? new Date().toISOString(),
  run: {
    ...(process.env.BRIGHTDATA_RESPONSE_ID ? { responseId: process.env.BRIGHTDATA_RESPONSE_ID } : {}),
    ...(process.env.BRIGHTDATA_BATCH_JOB_ID ? { batchJobId: process.env.BRIGHTDATA_BATCH_JOB_ID } : {}),
    ...(raw?.action ? { routeAction: String(raw.action) } : {}),
  },
  provenance: {
    sourceArtifact: inputPath,
    sourceSha256: createHash("sha256").update(sourceBytes).digest("hex"),
    derivedBy: "scripts/sanitize-live-run.mjs",
  },
  rawShape: {
    topLevel: Array.isArray(payload) ? "array" : typeof payload,
    resultCount: sanitizedResults.length,
    entryCount,
    entryFields: ["title", "published_date", "category", "summary", "url"],
  },
  results: sanitizedResults,
};

fs.writeFileSync(outputPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputPath, resultCount: sanitizedResults.length, entryCount }));
