#!/usr/bin/env node
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url);
const ignored = new Set(["node_modules", ".git", "dist", "out", ".playwright-cli"]);
const suspicious = [
  /AIza[0-9A-Za-z_-]{20,}/,
  /gh[pousr]_[A-Za-z0-9_]{20,}/,
  /sk-[A-Za-z0-9_-]{20,}/,
  /-----BEGIN (?:RSA|OPENSSH|EC|DSA) PRIVATE KEY-----/,
  /password\s*[:=]\s*["'][^"']{8,}["']/i,
  /api[_-]?key\s*[:=]\s*["'][^"']{12,}["']/i,
];
const textExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".md", ".css", ".html", ".yaml", ".yml", ".sh", ".env"]);
const findings = [];
const checkedEnvironmentFiles = [];
let checkedFileCount = 0;

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name) || entry.name.startsWith(".next")) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(path);
      continue;
    }
    const extension = entry.name.includes(".") ? `.${entry.name.split(".").pop()}` : "";
    if (!entry.name.startsWith(".env") && !textExtensions.has(extension)) continue;
    const text = await readFile(path, "utf8");
    checkedFileCount += 1;
    if (entry.name.startsWith(".env")) checkedEnvironmentFiles.push(relative(root.pathname, path));
    for (const pattern of suspicious) {
      if (pattern.test(text)) findings.push({ file: relative(root.pathname, path), pattern: pattern.source });
    }
  }
}

await walk(root.pathname);
console.log(JSON.stringify({ checkedRoot: root.pathname, checkedFileCount, checkedEnvironmentFiles, findings }, null, 2));
if (findings.length) process.exitCode = 1;
