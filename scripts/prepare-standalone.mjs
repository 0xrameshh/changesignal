#!/usr/bin/env node
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const distDir = process.env.NEXT_DIST_DIR?.trim() || ".next";
if (!/^[A-Za-z0-9._-]+$/.test(distDir)) throw new Error("NEXT_DIST_DIR must be a single safe directory name");

const distRoot = resolve(root, distDir);
const standalone = resolve(distRoot, "standalone");
await mkdir(resolve(standalone, distDir), { recursive: true });
await cp(resolve(distRoot, "static"), resolve(standalone, distDir, "static"), { recursive: true });
await cp(resolve(root, "public"), resolve(standalone, "public"), { recursive: true });

const packagePath = resolve(standalone, "package.json");
const packageManifest = JSON.parse(await readFile(packagePath, "utf8"));
packageManifest.scripts = { ...(packageManifest.scripts ?? {}), start: "node server.js" };
await writeFile(packagePath, `${JSON.stringify(packageManifest, null, 2)}\n`, "utf8");

console.log(`Prepared ${distDir}/standalone with static assets and an artifact-local start command.`);
