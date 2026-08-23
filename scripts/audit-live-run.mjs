#!/usr/bin/env node
import fs from "node:fs";

const [inputPath] = process.argv.slice(2);
if (!inputPath) {
  console.error("Usage: audit-live-run.mjs <collector-json>");
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const payload = raw?.raw ?? raw;
const results = Array.isArray(payload) ? payload : Array.isArray(payload?.results) ? payload.results : [];
const entries = results.flatMap((result) => Array.isArray(result?.entries) ? result.entries : []);
const weakSummaryPattern = /^(note|to upgrade:?|upgrade:?|read more|learn more)$/i;
const isoDatePattern = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z)?$/;
const weakSummaries = entries.filter((entry) => {
  const summary = String(entry?.summary ?? "").trim();
  return weakSummaryPattern.test(summary) || summary.length < 24;
});
const invalidDates = entries.filter((entry) => typeof entry?.published_date !== "string" || !isoDatePattern.test(entry.published_date.trim()) || !Number.isFinite(Date.parse(entry.published_date.trim())));
const missingFields = entries.filter((entry) => ["title", "category", "summary", "url"].some((field) => typeof entry?.[field] !== "string" || entry[field].trim() === ""));
const report = {
  resultCount: results.length,
  entryCount: entries.length,
  weakSummaryCount: weakSummaries.length,
  invalidDateCount: invalidDates.length,
  missingFieldCount: missingFields.length,
  weakSummarySamples: weakSummaries.slice(0, 5).map(({ title, summary, url }) => ({ title, summary, url })),
  passed: entries.length > 0 && weakSummaries.length === 0 && invalidDates.length === 0 && missingFields.length === 0,
};

console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exit(2);
