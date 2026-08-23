# ChangeSignal

ChangeSignal is a resilient public-changelog workspace built for the WeMakeDevs **Into the Scrape-Verse** hackathon. Bright Data Scraper Studio extracts the public Bun changelog, ChangeSignal validates a stable semantic contract, compares repeat runs, and exposes normalized events plus the recorded same-collector repair trail.

## Verified result

- Public target: `https://bun.sh/blog`
- Bright Data Collector: `c_mt03abix22hd4vf273`
- Baseline: 176 entries, including 50 semantically weak summaries
- Review: one unsafe proposal rejected after it regressed `published_date`
- Recovery: a reviewed summary-extraction repair approved and saved on the same Collector ID
- Verification: 176 entries, zero weak summaries, invalid dates, or missing fields

A clean clone needs no account: it loads the sanitized recovered artifact from the collector above and ships no synthetic demo data. Fresh runs remain server-only, operator-protected, and opt-in. The recorded repair addresses semantic extraction degradation in weak summaries; it is not presented as evidence of a later HTML layout break.

## What the application includes

- Next.js 16 App Router, React 19, and TypeScript
- Node-runtime Route Handlers for configuration, run, heal, evidence, and health
- Semantic collector-contract validation, repeat-run diffing, and normalized downstream events
- Inspectable failure, rejected repair, approved heal, and recovered-run artifacts
- Password-style operator unlock for browser-triggered live operations
- Terminal-first reviewed healing; web healing is disabled by default
- Local Manrope variable font with no runtime font dependency
- Default-workspace and operator-protected Playwright flows, Vitest unit coverage, ESLint, secret audit, and artifact audits
- Portable standalone Node output, isolated packaged-runner smoke test, multi-stage Docker image, health check, and GitHub Actions CI

## Quick start

Requires Node.js 20.9 or newer and pnpm 11.7.

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm test
pnpm typecheck
pnpm lint
pnpm dev
```

Open `http://localhost:3000`. The default workflow is intentionally account-free and uses only real recorded collector output:

1. Inspect the 176 extracted Bun events and the normalized fields of the selected event.
2. Press **Re-validate snapshot** to run the semantic contract over the recorded payload.
3. Press **Replay recorded failure**; the boilerplate summaries recorded in `evidence/live-failure.json` are reinstated, the contract rejects them, and the last valid output stays visible.
4. Press **Restore verified snapshot**; it remains explicitly labeled as a local replay, not a live heal.
5. Open **JSON output** or press `Alt+K` to compare the collector response with normalized events.

Run the complete browser suite separately:

```bash
pnpm e2e
```

## Recorded recovery snapshot and evidence

```bash
pnpm dev
```

A clean clone renders the recorded, contract-valid 176-entry recovery snapshot from collector `c_mt03abix22hd4vf273` with no environment file and no billable collector action. It is labeled **Verified snapshot**, not a fresh live run. Evidence filenames in the Recovery panel open sanitized JSON through an allowlisted server route.

The workspace ships exactly one dataset: the sanitized post-heal collector run promoted from `evidence/live-run-recovered.json`. There is no synthetic demo data.

**Replay recorded failure** reinstates the boilerplate summary values recorded in `evidence/live-failure.json` (`Note`, `To upgrade:`) so you can watch the semantic contract reject real degraded collector output while the last valid data stays on screen. Nothing is sent to Bright Data.

Verify the repository evidence chain and semantic contract directly:

```bash
pnpm verify:artifacts
pnpm secret:audit
```

`evidence/manifest.json` records SHA-256 hashes and chronological roles from collector creation through the 18:27 UTC post-heal Route Handler run. The verifier checks repository-internal consistency: unchanged hashes, recorded order, collector identity, and exact equality between the later run, sanitized evidence, and promoted 176-entry artifact. These checks detect repository drift; they are not an independent Bright Data attestation.

## Fresh Bright Data operations

The project pins `@brightdata/cli@0.3.5`. Authenticate using the CLI or the documented `BRIGHTDATA_API_KEY` environment variable:

```bash
pnpm bright:login
BRIGHTDATA_TARGET_URL=https://bun.sh/blog pnpm bright:create
BRIGHTDATA_COLLECTOR_ID=c_your_id pnpm bright:run > /tmp/live-run.json
pnpm bright:audit /tmp/live-run.json
BRIGHTDATA_COLLECTOR_ID=c_your_id pnpm bright:heal
```

`heal` stops at Bright Data's review gate by default. Do not enable automatic approval without deliberately reviewing that change.

To enable fresh runs from the browser, copy `.env.example` to `.env.local` and set at least:

```dotenv
BRIGHTDATA_COLLECTOR_ID=c_your_id
BRIGHTDATA_API_KEY=your_bright_data_api_key
BRIGHTDATA_TARGET_URL=https://bun.sh/blog
CHANGESIGNAL_OPERATOR_KEY=a-long-random-operator-key
```

Restart the server, choose **Unlock live actions**, and enter the operator key. The key is sent only to the same-origin server and retained only in the current React state. Bright Data credentials never enter the browser bundle.

Browser-triggered healing remains off unless the operator explicitly sets:

```dotenv
CHANGESIGNAL_ALLOW_WEB_HEAL=true
```

`CHANGESIGNAL_ALLOW_UNAUTHENTICATED_LIVE_ACTIONS=true` is accepted only outside production; production ignores it and still requires the operator key.

## Production run

Standalone Node output:

```bash
pnpm build
HOSTNAME=0.0.0.0 PORT=3000 pnpm start
curl http://127.0.0.1:3000/api/health
```

`NEXT_DIST_DIR` is honored consistently by build preparation, release audit, smoke test, and startup. For example, use `NEXT_DIST_DIR=.next-release pnpm build` followed by `NEXT_DIST_DIR=.next-release pnpm start`. Inside the copied standalone artifact, the self-contained command is always `node server.js`.

Container image:

```bash
docker build -t changesignal .
docker run --rm -p 3000:3000 --env-file .env.local changesignal
```

Live runs may take several minutes and spawn the pinned Bright Data CLI. Deploy to a persistent Node.js/container host rather than a static export or short-timeout edge function. Hosting-provider selection is intentionally deferred; the image and health route are platform-neutral.

## Architecture

```text
Browser workspace
  ├─ sanitized live artifact (promoted post-heal run)
  ├─ GET  /api/evidence/:name  → allowlisted recovery JSON
  ├─ GET  /api/health          → deployment health and safe capability flags
  └─ POST /api/live/run|heal   → same-origin + operator authorization
                                   ↓
                            server/live-api.ts
                                   ↓
                         pinned Bright Data CLI
                                   ↓
                     c_mt03abix22hd4vf273
```

Live requests are serialized, stream-limited, schema-checked, origin-checked, and redacted. The CLI runs through a packaged direct entry with a minimal environment, capped output, cancellation, and TERM→KILL cleanup. Browser healing accepts only the named server-owned summary repair plan, stays within the CLI's 1,000-character limit, returns a compact allowlisted status, and requires a separate server opt-in. The browser consumes only sanitized collector output.

The built-in action mutex and cooldown are process-local, so deployments that enable live actions must run a single operator replica. Horizontal scaling requires a durable job queue, distributed lock, and platform-level rate limiting; read-only snapshot replicas can scale independently.

## Repository guide

- `app/api/` — Node runtime routes for live operations, evidence, and health
- `src/App.tsx` — focused operator workspace
- `src/lib/contract.ts` — collector response validation
- `server/live-api.ts` — protected Bright Data process boundary
- `data/` — promoted sanitized live artifact (the only shipped dataset)
- `evidence/` — dated create, failure, repair, and verification records

## Scope

The publishable repository documents one target, one real collector, one semantic extraction failure, one reviewed same-ID repair, repeat-run comparison, and one downstream product. Multi-target scheduling, persistence, alert delivery, teams, and accounts are future product work—not fabricated controls in this release.

## License

ChangeSignal is available under the MIT License.
