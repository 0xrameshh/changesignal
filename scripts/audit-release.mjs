#!/usr/bin/env node
import { lstat, readFile, readdir, readlink } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = process.env.NEXT_DIST_DIR?.trim() || ".next";
if (!/^[A-Za-z0-9._-]+$/.test(distDir)) throw new Error("NEXT_DIST_DIR must be a single safe directory name");
const releaseRoot = resolve(projectRoot, distDir, "standalone");
const expectedEvidence = new Set([
  "live-failure.json",
  "live-heal-rejected.json",
  "live-heal.json",
  "next-live-api-run.json",
  "live-run-recovered.json",
  "manifest.json",
]);
const textExtensions = new Set([".js", ".mjs", ".cjs", ".json", ".sh", ".txt", ".md", ".yaml", ".yml"]);
const suspicious = [
  /-----BEGIN (?:RSA|OPENSSH|EC|DSA) PRIVATE KEY-----/,
  /\bBearer\s+eyJ[A-Za-z0-9._-]{20,}/,
  /\b(?:gh[pousr]|sk)-[A-Za-z0-9_-]{20,}/,
  /\bAIza[0-9A-Za-z_-]{20,}/,
];
const findings = [];

async function exists(path) {
  try { await lstat(path); return true; } catch { return false; }
}

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    const stat = await lstat(path);
    if (stat.isSymbolicLink()) {
      const target = await readlink(path);
      if (target.startsWith(projectRoot)) findings.push(`${relative(releaseRoot, path)}: absolute build-machine symlink`);
      continue;
    }
    if (entry.isDirectory()) {
      await walk(path);
      continue;
    }
    if (!textExtensions.has(extname(entry.name)) || stat.size > 5 * 1024 * 1024) continue;
    const text = await readFile(path, "utf8");
    const releasePath = relative(releaseRoot, path);
    const nextBuildMetadata = releasePath === "server.js" || releasePath === `${distDir}/required-server-files.json`;
    if (!nextBuildMetadata && text.includes(projectRoot)) findings.push(`${releasePath}: contains absolute build-machine path`);
    for (const pattern of suspicious) if (pattern.test(text)) findings.push(`${releasePath}: matches ${pattern.source}`);
  }
}

if (!await exists(releaseRoot)) findings.push("standalone release directory is missing");
else {
  const cliEntry = join(releaseRoot, "node_modules/@brightdata/cli/dist/index.js");
  if (!await exists(cliEntry)) findings.push("packaged Bright Data CLI entry is missing");
  if (await exists(join(releaseRoot, "node_modules/.bin/bdata"))) findings.push("generated bdata shim should not be packaged");
  const packageManifest = JSON.parse(await readFile(join(releaseRoot, "package.json"), "utf8"));
  if (packageManifest.scripts?.start !== "node server.js") findings.push("standalone package start command must be node server.js");

  const evidenceRoot = join(releaseRoot, "evidence");
  if (await exists(evidenceRoot)) {
    for (const name of await readdir(evidenceRoot)) findings.push(`evidence/${name}: source evidence should be bundled through the allowlisted route, not copied as a directory`);
  }
  await walk(releaseRoot);
}

console.log(JSON.stringify({ releaseRoot, expectedEvidence: [...expectedEvidence], findings }, null, 2));
if (findings.length) process.exitCode = 1;
