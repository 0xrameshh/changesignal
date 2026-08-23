#!/usr/bin/env node
import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const child = spawn(command, ["exec", "playwright", "test", ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});

const exitCode = await new Promise((resolve) => {
  child.on("error", () => resolve(1));
  child.on("exit", (code) => resolve(code ?? 1));
});

const declarationPath = "next-env.d.ts";
try {
  const declaration = await readFile(declarationPath, "utf8");
  const normalized = declaration.replace(/import "\.\/\.next(?:-[^"]+)?\/dev\/types\/routes\.d\.ts";/, 'import "./.next/dev/types/routes.d.ts";');
  if (normalized !== declaration) await writeFile(declarationPath, normalized, "utf8");
} catch (error) {
  console.error(`Could not normalize ${declarationPath}:`, error instanceof Error ? error.message : error);
  process.exit(1);
}

process.exit(exitCode);
