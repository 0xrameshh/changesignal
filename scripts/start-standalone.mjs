#!/usr/bin/env node
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const distDir = process.env.NEXT_DIST_DIR?.trim() || ".next";
if (!/^[A-Za-z0-9._-]+$/.test(distDir)) throw new Error("NEXT_DIST_DIR must be a single safe directory name");
const standaloneRoot = resolve(process.cwd(), distDir, "standalone");
process.chdir(standaloneRoot);
await import(pathToFileURL(resolve(standaloneRoot, "server.js")).href);
