#!/usr/bin/env node
import fs from "node:fs";
import { createHash } from "node:crypto";

const manifestPath = process.argv[2] ?? "evidence/manifest.json";
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const failures = [];
const loaded = new Map();

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const readArtifact = (path) => {
  const bytes = fs.readFileSync(path);
  const value = JSON.parse(bytes.toString("utf8"));
  loaded.set(path, { bytes, value });
  return { bytes, value };
};

let previousTimestamp = -Infinity;
for (const item of manifest.chain ?? []) {
  const { bytes, value } = readArtifact(item.path);
  const actualHash = sha256(bytes);
  if (actualHash !== item.sha256) failures.push(`${item.path}: SHA-256 mismatch`);

  const actualTimestamp = value.capturedAt ?? value.fetchedAt;
  if (actualTimestamp !== item.capturedAt) failures.push(`${item.path}: timestamp does not match manifest`);
  const timestamp = Date.parse(item.capturedAt);
  if (!Number.isFinite(timestamp) || timestamp < previousTimestamp) failures.push(`${item.path}: evidence chronology is out of order`);
  previousTimestamp = timestamp;

  if (value.collectorId && value.collectorId !== manifest.collectorId) failures.push(`${item.path}: collector ID changed`);
  if (value.targetUrl && value.targetUrl !== manifest.targetUrl) failures.push(`${item.path}: target URL changed`);
}

const sourcePath = manifest.derivation?.source;
const recoveredPath = manifest.derivation?.sanitized;
const promotedPath = manifest.derivation?.promoted;
const source = loaded.get(sourcePath)?.value ?? readArtifact(sourcePath).value;
const recovered = loaded.get(recoveredPath)?.value ?? readArtifact(recoveredPath).value;
const promoted = loaded.get(promotedPath)?.value ?? readArtifact(promotedPath).value;

const sourceHash = sha256(loaded.get(sourcePath).bytes);
if (recovered.provenance?.sourceArtifact !== sourcePath) failures.push("Recovered evidence does not identify its source artifact");
if (recovered.provenance?.sourceSha256 !== sourceHash) failures.push("Recovered evidence source hash is invalid");

const flatten = (results) => results.flatMap((result) => result?.entries ?? []);
const sortEntries = (entries) => [...entries].sort((left, right) => String(left.url).localeCompare(String(right.url)));
const sourceEntries = sortEntries(flatten(source.raw ?? source.results ?? source));
const recoveredEntries = sortEntries(flatten(recovered.results ?? recovered));
if (JSON.stringify(sourceEntries) !== JSON.stringify(recoveredEntries)) failures.push("Sanitized recovery entries differ from the post-heal route run");

const promotedEntries = sortEntries(promoted.entries ?? []).map(({ title, summary, url, publishedAt, category }) => ({
  title,
  published_date: publishedAt,
  category,
  summary,
  url,
}));
if (JSON.stringify(recoveredEntries) !== JSON.stringify(promotedEntries)) failures.push("Promoted live artifact differs from recovered evidence");
if (promoted.recoveryVerified !== true || promoted.recoveryEvidence !== recoveredPath) failures.push("Promoted artifact does not link to verified recovery evidence");

if (failures.length) {
  console.error(JSON.stringify({ passed: false, failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  passed: true,
  collectorId: manifest.collectorId,
  artifactCount: manifest.chain.length,
  entryCount: recoveredEntries.length,
  chronology: manifest.chain.map(({ role, capturedAt }) => ({ role, capturedAt })),
}, null, 2));
