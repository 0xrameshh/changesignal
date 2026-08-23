#!/usr/bin/env node

const target = process.argv[2] ?? "https://bun.sh/blog";
const response = await fetch(target, {
  headers: { "user-agent": "ChangeSignal feasibility review (public page only)" },
});
const body = await response.text();
const title = body.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim() ?? "";
const hasLoginLanguage = /<input[^>]+type=["']password|sign\s*in\s+to\s+(?:view|access|continue)|log\s*in\s+to\s+(?:view|access|continue)/i.test(body);
const hasPaywallLanguage = /paywall|members[- ]only|subscribe\s+to\s+(?:read|continue|access)/i.test(body);

const result = {
  target,
  capturedAt: new Date().toISOString(),
  status: response.status,
  contentType: response.headers.get("content-type"),
  title,
  bytes: Buffer.byteLength(body),
  publicPageSignals: {
    loginLanguageFound: hasLoginLanguage,
    paywallLanguageFound: hasPaywallLanguage,
  },
  observedFieldPlan: ["published date", "article title", "category label", "short summary", "article URL"],
  excludedFieldPlan: ["author names", "reactions", "comments", "analytics identifiers", "personal data"],
  note: "This script checks reachability and documents a field plan; it does not bypass access controls or establish pre-built-library coverage.",
};

console.log(JSON.stringify(result, null, 2));
if (!response.ok || hasLoginLanguage || hasPaywallLanguage) process.exitCode = 2;
