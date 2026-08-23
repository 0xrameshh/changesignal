#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const args = process.argv.slice(2);
const command = args.length ? args : ["bdata", "--version"];
const result = await run("npx", ["-p", "@brightdata/cli", ...command], { maxBuffer: 1024 * 1024 });
const redact = (value) => value
  .replace(/(api[-_ ]?key|token|password|secret)\s*[:=]\s*[^\s]+/gi, "$1: [REDACTED]")
  .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");

console.log(redact(result.stdout));
if (result.stderr) console.error(redact(result.stderr));
