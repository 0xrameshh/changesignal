#!/usr/bin/env node
import fs from "node:fs";

const [inputPath, outputPath] = process.argv.slice(2);
if (!inputPath || !outputPath) {
  console.error("Usage: promote-live-artifact.mjs <sanitized-evidence> <collector-payload>");
  process.exit(1);
}

const evidence = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const rows = (evidence.results ?? []).flatMap((result) => result.entries ?? []);
const unique = new Map(rows.map((entry) => [`${entry.url}|${entry.title}`, entry]));
const entries = [...unique.values()]
  .sort((left, right) => Date.parse(right.published_date) - Date.parse(left.published_date))
  .map((entry, index) => ({
    id: `${entry.url}-${entry.title}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 120) || `entry-${index + 1}`,
    title: entry.title,
    summary: entry.summary,
    url: entry.url,
    publishedAt: entry.published_date,
    category: entry.category,
  }));

const payload = {
  contractVersion: evidence.contractVersion,
  collectorId: evidence.collectorId,
  fetchedAt: evidence.capturedAt,
  source: "live",
  recoveryVerified: inputPath.includes("recovered"),
  recoveryEvidence: inputPath.includes("recovered") ? "evidence/live-run-recovered.json" : null,
  entries,
};
fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ outputPath, entryCount: entries.length, collectorId: payload.collectorId }));
