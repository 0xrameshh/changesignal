"use client";

import { Fragment, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowUpRight,
  Check,
  CircleAlert,
  Code2,
  ExternalLink,
  KeyRound,
  Play,
  RotateCcw,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { Button } from "./components/ui/button";
import { verifiedArtifact, verifiedPayload } from "./lib/artifact";
import { parseCollectorPayload } from "./lib/contract";
import { buildRecordedFailureReplay, recordedFailure } from "./lib/failure-replay";
import { getHealDisposition, LiveApiError, healLiveCollector, runLiveCollector } from "./lib/live-api";
import { diffSnapshots, normalizeCollectorPayload } from "./lib/pipeline";
import type { ChangeEvent, ChangeKind, RunRecord } from "./types";

const sourceUrl = "https://bun.sh/blog";
const sourceName = "Bun changelog";

/* Shared instrument vocabulary. Static maps keep Tailwind's scanner able to see every class. */
const panel = "overflow-hidden rounded-lg border border-line bg-surface shadow-[0_12px_32px_-16px_rgba(0,0,0,0.65)]";
const sectionHeading = "flex min-h-12 items-start justify-between gap-4 border-b border-line bg-raised px-[18px] py-3";
const headingTitle = "m-0 text-[13px] font-bold uppercase leading-[1.3] tracking-[0.02em] text-ink";
const fieldLabel = "text-[10px] font-bold uppercase tracking-[0.08em] text-faint";
const textAction = "cursor-pointer border-0 bg-transparent px-1 py-2 text-[13px] font-semibold text-accent transition-colors hover:text-accent-hover hover:underline disabled:cursor-not-allowed disabled:text-disabled disabled:no-underline";
const kindTag = "w-fit rounded px-[7px] py-[3px] font-mono text-[10px] font-bold uppercase tracking-[0.05em]";

const kindStyles: Record<ChangeKind, string> = {
  release: "bg-trace/10 text-trace",
  fix: "bg-warning-soft text-warning",
  breaking: "bg-danger-soft text-danger",
  security: "bg-danger-soft text-danger",
};

const kindFilters: Array<{ value: ChangeKind | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "release", label: "Release" },
  { value: "fix", label: "Fix" },
  { value: "breaking", label: "Breaking" },
  { value: "security", label: "Security" },
];

const runDotStyles: Record<RunRecord["status"], string> = {
  success: "border-success bg-success",
  healed: "border-success bg-success",
  watch: "border-danger bg-danger",
  replay: "border-warning bg-warning",
};

const statusTones = {
  success: { bar: "border-success-border border-l-success bg-success-soft", icon: "bg-success/10 text-success" },
  error: { bar: "border-danger-border border-l-danger bg-danger-soft", icon: "bg-danger/10 text-danger" },
  working: { bar: "border-accent-border border-l-accent bg-accent-soft", icon: "bg-accent/10 text-accent animate-spin" },
} as const;

type LiveConfigResponse = {
  configured?: boolean;
  enabled?: boolean;
  requiresAuth?: boolean;
  securityReady?: boolean;
  healEnabled?: boolean;
};

async function fetchLiveConfig(operatorKey?: string): Promise<LiveConfigResponse> {
  const response = await fetch("/api/live/config", {
    headers: operatorKey ? { authorization: `Bearer ${operatorKey}` } : undefined,
    cache: "no-store",
  });
  if (!response.ok) throw new Error("Live API is unavailable");
  return response.json() as Promise<LiveConfigResponse>;
}

const recoveryEvidence = [
  { label: "Detected", result: "50 weak summaries", file: "live-failure.json", href: "/api/evidence/live-failure", failed: true },
  { label: "Rejected", result: "Date field regressed", file: "live-heal-rejected.json", href: "/api/evidence/live-heal-rejected", failed: true },
  { label: "Approved", result: "Summary-only repair", file: "live-heal.json", href: "/api/evidence/live-heal", failed: false },
  { label: "Reran", result: "18:27 UTC · 176 valid", file: "next-live-api-run.json", href: "/api/evidence/next-live-api-run", failed: false },
  { label: "Recovered", result: "176 / 176 valid", file: "live-run-recovered.json", href: "/api/evidence/live-run-recovered", failed: false },
  { label: "Checked", result: "Hashes + recorded order", file: "manifest.json", href: "/api/evidence/manifest", failed: false },
] as const;

function formatDate(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(timestamp);
}

interface ActivityBucket {
  key: string;
  label: string;
  year: string;
  isYearStart: boolean;
  count: number;
  anomalyKinds: ChangeKind[];
}

/** Buckets events into contiguous quarters (including empty ones) so gaps in the timeline stay honest. */
function buildActivityBuckets(events: ChangeEvent[]): ActivityBucket[] {
  if (events.length === 0) return [];
  const quarterOf = (event: ChangeEvent) => {
    const date = new Date(event.publishedAt);
    return { year: date.getUTCFullYear(), quarter: Math.floor(date.getUTCMonth() / 3) + 1 };
  };
  const stamped = events.map((event) => ({ event, ...quarterOf(event) }));
  const first = stamped.reduce((min, entry) => (entry.year * 4 + entry.quarter < min.year * 4 + min.quarter ? entry : min));
  const last = stamped.reduce((max, entry) => (entry.year * 4 + entry.quarter > max.year * 4 + max.quarter ? entry : max));

  const buckets: ActivityBucket[] = [];
  for (let year = first.year, quarter = first.quarter; year < last.year || (year === last.year && quarter <= last.quarter); ) {
    const isFirstBucket = year === first.year && quarter === first.quarter;
    buckets.push({ key: `${year}-Q${quarter}`, label: `Q${quarter} ${year}`, year: String(year), isYearStart: quarter === 1 || isFirstBucket, count: 0, anomalyKinds: [] });
    quarter += 1;
    if (quarter > 4) {
      quarter = 1;
      year += 1;
    }
  }

  const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  for (const { event, year, quarter } of stamped) {
    const bucket = byKey.get(`${year}-Q${quarter}`);
    if (!bucket) continue;
    bucket.count += 1;
    if ((event.kind === "security" || event.kind === "breaking") && !bucket.anomalyKinds.includes(event.kind)) {
      bucket.anomalyKinds.push(event.kind);
    }
  }
  return buckets;
}

/** Starts a wall-clock timer and returns a reader for the formatted elapsed time. */
function startTimer(): () => string {
  const startedAt = performance.now();
  return () => `${((performance.now() - startedAt) / 1000).toFixed(1)} s`;
}

const signalWavePath = "M0 6h2.5l2-4.5L8 10l3.5-8L15 10l3.5-8L22 6h2.5";

/** A small oscilloscope-style mark shared by the live badge and the Timeline heading — the one recurring signature motif tied to the product name. Flatlines when inactive, traces with a traveling pulse when live. */
function SignalWave({ active, className }: { active: boolean; className?: string }) {
  return (
    <svg aria-hidden="true" className={className} height="12" viewBox="0 0 25 12" width="25">
      <path d={active ? signalWavePath : "M0 6h25"} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
      {active && (
        <circle r="1.4" fill="currentColor">
          <animateMotion dur="2.2s" path={signalWavePath} repeatCount="indefinite" />
        </circle>
      )}
    </svg>
  );
}

let runSequence = 0;

/** Monotonic activity-row key. Unique even for two actions in the same millisecond. */
function nextRunId(prefix: string): string {
  runSequence += 1;
  return `${prefix}-${runSequence}`;
}

function App() {
  const [events, setEvents] = useState<ChangeEvent[]>(verifiedArtifact.events);
  const [activeEventId, setActiveEventId] = useState(verifiedArtifact.events[0]?.id ?? "");
  const [fetchedAt, setFetchedAt] = useState(verifiedArtifact.fetchedAt);
  const [targetUrl, setTargetUrl] = useState(sourceUrl);
  const [collectorId, setCollectorId] = useState(verifiedArtifact.collectorId);
  const [apiState, setApiState] = useState<"checking" | "ready" | "locked" | "unconfigured">("checking");
  const [operatorKey, setOperatorKey] = useState("");
  const [operatorKeyInput, setOperatorKeyInput] = useState("");
  const [unlockVisible, setUnlockVisible] = useState(false);
  const [unlockError, setUnlockError] = useState("");
  const [webHealEnabled, setWebHealEnabled] = useState(false);
  const [runState, setRunState] = useState<"idle" | "running" | "complete" | "error">("idle");
  const [recoveryState, setRecoveryState] = useState<"verified" | "attention" | "recovering" | "recovered">("verified");
  const [error, setError] = useState("");
  const [showPayload, setShowPayload] = useState(false);
  const [payloadView, setPayloadView] = useState<"collector" | "normalized">("collector");
  const [rawPayload, setRawPayload] = useState<unknown>(verifiedPayload);
  const [showAll, setShowAll] = useState(false);
  const [activeKind, setActiveKind] = useState<ChangeKind | "all">("all");
  const [hoveredBucket, setHoveredBucket] = useState<number | null>(null);
  const [runs, setRuns] = useState<RunRecord[]>([
    {
      id: "verified-artifact",
      sourceId: "bun",
      time: `recorded ${formatDate(verifiedArtifact.fetchedAt)}`,
      status: "healed",
      detail: `${verifiedArtifact.events.length} valid entries · post-heal run on the same collector`,
    },
  ]);

  const kindCounts = useMemo(() => {
    const counts: Record<ChangeKind, number> = { release: 0, fix: 0, breaking: 0, security: 0 };
    for (const event of events) counts[event.kind] += 1;
    return counts;
  }, [events]);

  const filteredEvents = useMemo(
    () => (activeKind === "all" ? events : events.filter((event) => event.kind === activeKind)),
    [events, activeKind],
  );

  const activityBuckets = useMemo(() => buildActivityBuckets(events), [events]);
  const maxActivityCount = Math.max(1, ...activityBuckets.map((bucket) => bucket.count));
  const clearHoveredBucket = (index: number) => setHoveredBucket((current) => (current === index ? null : current));

  const activeEvent = filteredEvents.find((event) => event.id === activeEventId) ?? filteredEvents[0];
  const visibleEvents = showAll ? filteredEvents : filteredEvents.slice(0, 12);
  const liveActionsReady = apiState === "ready";
  const busy = runState === "running" || recoveryState === "recovering";
  const needsRecovery = recoveryState === "attention";

  const normalizedPayload = useMemo(() => ({
    contractVersion: verifiedArtifact.contractVersion,
    collectorId,
    fetchedAt,
    entries: events,
  }), [collectorId, events, fetchedAt]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      // Match on `code`, not `key`: macOS turns Option+K into the dead key "˚",
      // so comparing `event.key` silently breaks the shortcut on every Mac.
      if (!(event.altKey && !event.ctrlKey && !event.metaKey && event.code === "KeyK") || target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) return;
      event.preventDefault();
      setShowPayload((value) => !value);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchLiveConfig()
      .then((config) => {
        if (cancelled) return;
        setWebHealEnabled(config.healEnabled === true);
        setApiState(config.enabled ? "ready" : config.requiresAuth ? "locked" : "unconfigured");
      })
      .catch(() => {
        if (!cancelled) setApiState("unconfigured");
      });
    return () => { cancelled = true; };
  }, []);

  const addRun = (record: RunRecord) => setRuns((current) => [record, ...current].slice(0, 4));

  const unlockLiveActions = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const candidate = operatorKeyInput.trim();
    if (!candidate) return;
    setUnlockError("");
    try {
      const config = await fetchLiveConfig(candidate);
      if (!config.enabled) {
        setUnlockError("That operator key was not accepted.");
        return;
      }
      setOperatorKey(candidate);
      setOperatorKeyInput("");
      setWebHealEnabled(config.healEnabled === true);
      setApiState("ready");
      setRunState("idle");
      setError("");
      setUnlockVisible(false);
    } catch {
      setUnlockError("The server could not verify the operator key.");
    }
  };

  /** Re-runs the semantic contract over the shipped verified snapshot. No credentials needed. */
  const revalidateSnapshot = () => {
    if (busy) return;
    setRunState("running");
    setError("");
    const elapsed = startTimer();
    try {
      const validated = parseCollectorPayload(verifiedPayload);
      const nextEvents = normalizeCollectorPayload(validated, "bun");
      const changedEvents = diffSnapshots(events, nextEvents);
      setEvents(nextEvents);
      setRawPayload(verifiedPayload);
      setFetchedAt(validated.fetchedAt);
      setCollectorId(validated.collectorId);
      setActiveEventId(nextEvents[0]?.id ?? "");
      setRunState("complete");
      setRecoveryState("verified");
      addRun({
        id: nextRunId("revalidate"),
        sourceId: "bun",
        time: "now",
        status: "success",
        detail: `${nextEvents.length} entries revalidated · ${changedEvents.length} changed`,
        duration: elapsed(),
      });
    } catch (contractError) {
      setRunState("idle");
      setRecoveryState("attention");
      setError(contractError instanceof Error ? contractError.message : "The snapshot failed its contract.");
    }
  };

  const runFreshCollector = async () => {
    if (busy) return;
    setRunState("running");
    setError("");
    const elapsed = startTimer();
    try {
      const result = await runLiveCollector(operatorKey);
      const nextEvents = normalizeCollectorPayload(result.payload, "bun");
      const changedEvents = diffSnapshots(events, nextEvents);
      setEvents(nextEvents);
      setRawPayload(result.raw);
      setFetchedAt(result.payload.fetchedAt);
      setCollectorId(result.payload.collectorId);
      setTargetUrl(result.targetUrl);
      setActiveEventId(nextEvents[0]?.id ?? "");
      setRunState("complete");
      setRecoveryState("verified");
      addRun({
        id: nextRunId("live"),
        sourceId: "bun",
        time: "now",
        status: "success",
        detail: `${nextEvents.length} entries validated · ${changedEvents.length} new or changed`,
        duration: elapsed(),
      });
    } catch (runError) {
      const message = runError instanceof Error ? runError.message : "The live collector failed.";
      setError(message);
      if (runError instanceof LiveApiError && runError.code !== "CONTRACT_FAILED") {
        setRunState("error");
        if (runError.status === 401) {
          setApiState("locked");
          setOperatorKey("");
        }
      } else {
        setRunState("idle");
        setRecoveryState("attention");
      }
      addRun({ id: nextRunId("failed"), sourceId: "bun", time: "now", status: "watch", detail: message, duration: elapsed() });
    }
  };

  const handlePrimaryAction = () => {
    if (apiState === "locked") {
      setUnlockVisible(true);
      return;
    }
    if (liveActionsReady) {
      void runFreshCollector();
      return;
    }
    revalidateSnapshot();
  };

  /**
   * Reinstates the boilerplate summary values recorded in
   * evidence/live-failure.json so the contract rejection can be observed
   * against real collector output. Nothing is sent to Bright Data.
   */
  const replayRecordedFailure = () => {
    if (busy || needsRecovery) return;
    const { payload: degraded, degradedTitles } = buildRecordedFailureReplay(verifiedPayload);
    setRawPayload(degraded);
    try {
      parseCollectorPayload(degraded);
      setRunState("error");
      setError("The recorded failure replay unexpectedly passed the contract.");
    } catch (contractError) {
      setRecoveryState("attention");
      setRunState("idle");
      setError(`Contract rejected the replay: ${contractError instanceof Error ? contractError.message : "boilerplate summary"}. The last valid data is still shown.`);
      addRun({
        id: nextRunId("replay"),
        sourceId: "bun",
        time: "now",
        status: "watch",
        detail: `${degradedTitles.length} recorded boilerplate summaries rejected · last valid data held`,
      });
    }
  };

  const restoreSnapshot = () => {
    if (busy || !needsRecovery) return;
    setRecoveryState("recovering");
    setError("");
    const elapsed = startTimer();
    try {
      const validated = parseCollectorPayload(verifiedPayload);
      const recoveredEvents = normalizeCollectorPayload(validated, "bun");
      setEvents(recoveredEvents);
      setRawPayload(verifiedPayload);
      setFetchedAt(validated.fetchedAt);
      setCollectorId(validated.collectorId);
      setActiveEventId(recoveredEvents[0]?.id ?? "");
      setRecoveryState("recovered");
      addRun({
        id: nextRunId("restore"),
        sourceId: "bun",
        time: "now",
        status: "replay",
        detail: `verified snapshot restored · ${recoveredEvents.length} entries pass the contract`,
        duration: elapsed(),
      });
    } catch (contractError) {
      setRecoveryState("attention");
      setError(contractError instanceof Error ? contractError.message : "Restoring the snapshot failed its contract.");
    }
  };

  const healLiveCollectorAction = async () => {
    if (busy || !needsRecovery) return;
    setRecoveryState("recovering");
    setError("");
    const elapsed = startTimer();
    try {
      const heal = await healLiveCollector(operatorKey);
      const disposition = getHealDisposition(heal.raw);
      if (disposition === "approval") {
        setRecoveryState("attention");
        setError("Bright Data is waiting for approval. Review the proposed repair in the terminal, then run the collector again.");
        return;
      }
      if (disposition === "failed") throw new Error("Bright Data reported that the repair failed.");
      const rerun = await runLiveCollector(operatorKey);
      const nextEvents = normalizeCollectorPayload(rerun.payload, "bun");
      const changedEvents = diffSnapshots(events, nextEvents);
      setEvents(nextEvents);
      setRawPayload(rerun.raw);
      setFetchedAt(rerun.payload.fetchedAt);
      setCollectorId(rerun.payload.collectorId);
      setTargetUrl(rerun.targetUrl);
      setActiveEventId(nextEvents[0]?.id ?? "");
      setRunState("complete");
      setRecoveryState("recovered");
      addRun({
        id: nextRunId("heal"),
        sourceId: "bun",
        time: "now",
        status: "healed",
        detail: `${nextEvents.length} valid entries · ${changedEvents.length} new or changed · same collector`,
        duration: elapsed(),
      });
    } catch (healError) {
      setRecoveryState("attention");
      setError(healError instanceof LiveApiError ? healError.message : "Live recovery failed.");
    }
  };

  const recoveryAction = liveActionsReady
    ? webHealEnabled
      ? { label: "Heal collector", run: healLiveCollectorAction }
      : { label: "Re-run after terminal heal", run: runFreshCollector }
    : { label: "Restore verified snapshot", run: restoreSnapshot };

  // Re-validating the shipped snapshot is always safe and never billable, so it is
  // the default action while live capability is still being discovered. This keeps
  // the server-rendered CTA immediately usable instead of flashing a disabled state.
  const primaryLabel = runState === "running"
    ? "Running…"
    : apiState === "locked"
      ? "Unlock live actions"
      : liveActionsReady
        ? "Run collector"
        : "Re-validate snapshot";

  const status = runState === "error"
    ? { tone: "error", icon: <CircleAlert size={17} />, title: "Run unavailable", detail: error || "The server could not start the collector." }
    : needsRecovery
      ? { tone: "error", icon: <CircleAlert size={17} />, title: "Contract failed", detail: error }
      : recoveryState === "recovering"
        ? { tone: "working", icon: <Wrench size={17} />, title: liveActionsReady ? "Repairing collector" : "Restoring verified snapshot", detail: "The last valid event data remains available." }
        : recoveryState === "recovered"
          ? { tone: "success", icon: <ShieldCheck size={17} />, title: "Recovery complete", detail: `${events.length} entries pass the contract again.` }
          : runState === "running"
            ? { tone: "working", icon: <RotateCcw size={17} />, title: liveActionsReady ? "Running collector" : "Validating snapshot", detail: liveActionsReady ? "Bright Data is running on the server; a fresh collection can take several minutes." : "Checking the verified snapshot against the event contract." }
            : runState === "complete"
              ? { tone: "success", icon: <Check size={17} />, title: "Contract passed", detail: `${events.length} entries passed the contract.` }
              : { tone: "success", icon: <Check size={17} />, title: liveActionsReady ? "Live collector ready" : "Verified snapshot loaded", detail: liveActionsReady ? "Fresh runs are enabled on this server." : `${events.length} contract-valid entries recorded from collector ${collectorId}.` };

  const tone = statusTones[status.tone as keyof typeof statusTones];

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-4 border-b border-line-strong bg-surface/80 px-[max(24px,calc((100vw-1280px)/2))] backdrop-blur-md max-[620px]:h-13 max-[620px]:px-4">
        <a className="inline-flex items-center gap-3 text-ink no-underline" href="#top" aria-label="ChangeSignal home">
          <span className="grid size-[30px] place-items-center rounded-md border border-accent-border bg-accent-soft text-[11px] font-bold tracking-[-0.02em] text-accent" aria-hidden="true">CS</span>
          <span className="grid">
            <strong className="text-[15px] font-bold tracking-[-0.02em]">ChangeSignal</strong>
            <small className="text-xs font-normal text-faint max-[620px]:hidden">Bright Data changelog monitor</small>
          </span>
        </a>
        <span className={`ml-auto inline-flex items-center gap-1.5 rounded-full border px-[11px] py-1 text-xs font-semibold ${liveActionsReady ? "border-success-border bg-success-soft text-success" : "border-line-strong bg-surface text-muted"}`}>
          <SignalWave active={liveActionsReady} />
          {liveActionsReady ? "Live" : "Verified snapshot"}
        </span>
      </header>

      <main className="mx-auto w-full max-w-[1280px] px-6 pt-9 pb-18 max-[820px]:pt-6 max-[620px]:px-4 max-[620px]:pt-5 max-[620px]:pb-12" id="top">
        <section className="mb-5 grid grid-cols-[minmax(260px,1fr)_auto_auto] items-end gap-8 border-b-2 border-line-strong pb-7 max-[1050px]:grid-cols-[1fr_auto] max-[620px]:grid-cols-1 max-[620px]:gap-[18px] max-[620px]:pb-5" aria-labelledby="source-title">
          <div>
            <h1 className="mb-1.5 text-[clamp(26px,3vw,34px)] font-bold leading-[1.1] tracking-[-0.03em]" id="source-title">{sourceName}</h1>
            <a className="inline-flex items-center gap-[5px] text-[13px] text-faint no-underline transition-colors hover:text-accent" href={targetUrl} target="_blank" rel="noopener noreferrer" aria-label={`Open ${sourceName} source in a new tab`}>
              {targetUrl.replace(/^https?:\/\//, "")}<ArrowUpRight size={14} />
            </a>
          </div>
          <dl className="m-0 flex items-end gap-7 max-[1050px]:col-span-full max-[1050px]:row-start-2 max-[620px]:col-auto max-[620px]:row-auto max-[620px]:grid max-[620px]:grid-cols-2 max-[620px]:gap-3.5 max-[620px]:border-y max-[620px]:border-line max-[620px]:py-3.5">
            <div className="grid gap-[3px] max-[620px]:col-span-full">
              <dt className={fieldLabel}>Collector</dt>
              <dd className="m-0 font-mono text-[13px] font-semibold text-ink" data-testid="collector-id">{collectorId}</dd>
            </div>
            <div className="grid gap-[3px]">
              <dt className={fieldLabel}>Last result</dt>
              <dd className="tabular-nums m-0 text-sm font-semibold text-ink">{events.length} valid</dd>
            </div>
            <div className="grid gap-[3px]">
              <dt className={fieldLabel}>Checked</dt>
              <dd className="tabular-nums m-0 text-sm font-semibold text-ink">{formatDate(fetchedAt)}</dd>
            </div>
          </dl>
          <Button variant="primary" onClick={handlePrimaryAction} disabled={busy} className="max-[1050px]:col-start-2 max-[1050px]:row-start-1 max-[620px]:col-start-1 max-[620px]:row-auto max-[620px]:min-h-12 max-[620px]:w-full">
            {apiState === "locked" ? <KeyRound size={15} /> : <Play size={15} fill="currentColor" />}
            {primaryLabel}
          </Button>
        </section>

        {unlockVisible && (
          <form className="mb-5 grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-4 gap-y-3 rounded-lg border border-accent-border bg-accent-soft px-5 py-4 max-[820px]:grid-cols-[1fr_auto_auto] max-[620px]:grid-cols-1" onSubmit={unlockLiveActions}>
            <div className="grid gap-1 max-[820px]:col-span-full">
              <strong className="text-sm">Unlock live actions</strong>
              <span className="text-[13px] text-muted">The operator key is checked by this server and kept only in this tab.</span>
            </div>
            <label className="grid gap-1.5" htmlFor="operator-key">
              <span className="text-[10px] font-bold uppercase tracking-[0.06em] text-faint">Operator key</span>
              <input
                className="min-h-11 w-full rounded-md border border-line-strong bg-surface px-3.5 py-2.5 text-[15px] text-ink transition-[border-color,box-shadow] focus:border-accent focus:shadow-[0_0_0_3px_rgba(46,230,184,0.25)] focus:outline-none max-[620px]:min-h-12"
                id="operator-key"
                name="operator-key"
                type="password"
                autoComplete="off"
                minLength={16}
                required
                value={operatorKeyInput}
                onChange={(event) => setOperatorKeyInput(event.target.value)}
                aria-describedby={unlockError ? "operator-key-error" : undefined}
              />
            </label>
            <Button type="submit" variant="secondary" className="max-[620px]:w-full">Unlock</Button>
            <button className={`${textAction} justify-self-start`} type="button" onClick={() => { setUnlockVisible(false); setOperatorKeyInput(""); setUnlockError(""); }}>Cancel</button>
            {unlockError && <p className="col-start-2 col-end-[-1] m-0 text-[13px] text-danger max-[620px]:col-span-full max-[620px]:col-start-1" id="operator-key-error" role="alert">{unlockError}</p>}
          </form>
        )}

        <section className={`mb-5 grid min-h-14 grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3.5 rounded-md border border-l-[3px] px-[18px] py-3 transition-colors max-[620px]:grid-cols-[36px_minmax(0,1fr)] ${tone.bar}`} role="status" aria-live="polite">
          <span className={`grid size-8 place-items-center rounded-md ${tone.icon}`} aria-hidden="true">{status.icon}</span>
          <div className="grid gap-0.5">
            <strong className="text-sm font-semibold">{status.title}</strong>
            <span className="text-[13px] leading-[1.5] text-muted">{status.detail}</span>
          </div>
          {!needsRecovery && recoveryState !== "recovering" && (
            <button className={`${textAction} max-[620px]:col-span-full max-[620px]:justify-self-start`} type="button" onClick={replayRecordedFailure} disabled={busy}>Replay recorded failure</button>
          )}
          {needsRecovery && (
            <Button variant="secondary" onClick={recoveryAction.run} disabled={busy} className="max-[620px]:col-span-full max-[620px]:w-full">{recoveryAction.label}</Button>
          )}
        </section>

        {activityBuckets.length > 0 && (
          <section className={`mb-5 ${panel}`} aria-labelledby="timeline-title">
            <div className={sectionHeading}>
              <div className="grid gap-px">
                <h2 className={`inline-flex items-center gap-2 ${headingTitle}`} id="timeline-title">
                  Timeline
                  <SignalWave active className="text-accent" />
                </h2>
                <p className="m-0 text-xs text-muted">Quarterly event volume, all time · square markers flag security and breaking changes.</p>
              </div>
            </div>
            <div className="relative px-[18px] pt-10 pb-3.5 max-[620px]:px-4">
              {hoveredBucket !== null && activityBuckets[hoveredBucket] && (
                <div
                  className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-line-strong bg-ink px-2.5 py-1.5 text-xs text-surface"
                  style={{ left: `${((hoveredBucket + 0.5) / activityBuckets.length) * 100}%` }}
                >
                  <strong className="font-mono">{activityBuckets[hoveredBucket].label}</strong>
                  <span className="ml-1.5 text-faint">
                    {activityBuckets[hoveredBucket].count} event{activityBuckets[hoveredBucket].count === 1 ? "" : "s"}
                    {activityBuckets[hoveredBucket].anomalyKinds.length > 0 && ` · ${activityBuckets[hoveredBucket].anomalyKinds.join(" + ")}`}
                  </span>
                </div>
              )}

              <div className="flex h-4 items-end gap-0.5" aria-hidden="true">
                {activityBuckets.map((bucket) => (
                  <div className="flex flex-1 items-end justify-center" key={`marker-${bucket.key}`}>
                    {bucket.anomalyKinds.length > 0 && <span className="size-2 rounded-[2px] border border-danger bg-danger" />}
                  </div>
                ))}
              </div>

              <div className="flex h-20 items-end gap-0.5">
                {activityBuckets.map((bucket, index) => (
                  <button
                    aria-label={`${bucket.label}: ${bucket.count} event${bucket.count === 1 ? "" : "s"}${bucket.anomalyKinds.length > 0 ? `, including ${bucket.anomalyKinds.join(" and ")}` : ""}`}
                    className="group flex h-full flex-1 items-end justify-center rounded-t-[4px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
                    key={bucket.key}
                    onBlur={() => clearHoveredBucket(index)}
                    onFocus={() => setHoveredBucket(index)}
                    onMouseEnter={() => setHoveredBucket(index)}
                    onMouseLeave={() => clearHoveredBucket(index)}
                    type="button"
                  >
                    <span
                      aria-hidden="true"
                      className="w-full max-w-6 rounded-t-[4px] bg-accent/70 transition-colors group-hover:bg-accent group-focus-visible:bg-accent"
                      style={{ height: `${Math.max(4, (bucket.count / maxActivityCount) * 100)}%` }}
                    />
                  </button>
                ))}
              </div>

              <div className="mt-1.5 flex gap-0.5 border-t border-line pt-1.5">
                {activityBuckets.map((bucket) => (
                  <div className="flex-1 text-center" key={`year-${bucket.key}`}>
                    {bucket.isYearStart && <span className="font-mono text-[10px] text-faint">{bucket.year}</span>}
                  </div>
                ))}
              </div>
            </div>
          </section>
        )}

        <section className={`mb-5 ${panel}`} aria-labelledby="recovery-title">
          <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-4 border-b border-line bg-raised px-[18px] py-3.5">
            <div>
              <h2 className={headingTitle} id="recovery-title">Same-collector recovery</h2>
              <p className="mt-[3px] mb-0 text-xs text-muted">
                Recorded Bright Data evidence for <code className="font-mono text-xs text-faint">{verifiedArtifact.collectorId}</code>.
              </p>
            </div>
            <p className="m-0 whitespace-nowrap text-[13px] text-muted">
              <strong className="tabular-nums font-bold text-ink">{recordedFailure.incompleteSummaryCount}</strong> weak summaries before · <strong className="tabular-nums font-bold text-ink">0</strong> after
            </p>
          </div>
          <ol className="m-0 grid list-none grid-cols-6 p-0 max-[1050px]:grid-cols-3 max-[620px]:grid-cols-2">
            {recoveryEvidence.map((item) => (
              <li className="grid min-w-0 content-start gap-[5px] border-l border-line px-4 pt-3.5 pb-4 first:border-l-0 max-[1050px]:[&:nth-child(3n+1)]:border-l-0 max-[1050px]:[&:nth-child(n+4)]:border-t max-[1050px]:[&:nth-child(n+4)]:border-t-line max-[620px]:[&:nth-child(2n+1)]:border-l-0 max-[620px]:[&:nth-child(n+3)]:border-t max-[620px]:[&:nth-child(n+3)]:border-t-line" key={item.label}>
                <span className={`mb-0.5 size-2.5 rounded-[2px] border ${item.failed ? "border-danger bg-danger" : "border-success bg-success"}`} aria-hidden="true" />
                <strong className="text-[13px] font-bold tracking-[-0.005em] text-ink">{item.label}</strong>
                <span className="text-xs leading-[1.45] text-muted">{item.result}</span>
                <a className="mt-0.5 inline-flex w-fit max-w-full items-center gap-1 font-mono text-[11px] leading-[1.4] break-words text-accent no-underline hover:text-accent-hover hover:underline" href={item.href} target="_blank" rel="noopener noreferrer" aria-label={`Open ${item.file} evidence in a new tab`}>
                  {item.file}<ExternalLink className="shrink-0" size={11} />
                </a>
              </li>
            ))}
          </ol>
        </section>

        <div className="grid grid-cols-[minmax(0,1fr)_380px] items-start gap-5 max-[1050px]:grid-cols-[minmax(0,1fr)_340px] max-[820px]:grid-cols-1">
          <section className={`min-w-0 ${panel}`} aria-labelledby="events-title">
            <div className={sectionHeading}>
              <div className="grid gap-px">
                <h2 className={headingTitle} id="events-title">Extracted events</h2>
                <p className="m-0 text-xs text-muted">Normalized output used by the downstream product.</p>
              </div>
              <span className="tabular-nums whitespace-nowrap font-mono text-[13px] font-bold text-accent">
                {activeKind === "all" ? `${events.length} total` : `${filteredEvents.length} of ${events.length}`}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-surface px-[18px] py-2.5 max-[620px]:px-4" role="group" aria-label="Filter events by signal kind">
              {kindFilters.map((filter) => (
                <button
                  className="inline-flex items-center gap-1.5 rounded-md border-0 bg-transparent px-2.5 py-1.5 text-[13px] font-semibold text-muted transition-colors hover:bg-hover aria-pressed:bg-accent-soft aria-pressed:text-accent max-[620px]:min-h-11"
                  key={filter.value}
                  type="button"
                  aria-pressed={activeKind === filter.value}
                  onClick={() => setActiveKind(filter.value)}
                >
                  {filter.label}
                  <span className="tabular-nums rounded bg-canvas px-1.5 py-0.5 font-mono text-[11px]">
                    {filter.value === "all" ? events.length : kindCounts[filter.value]}
                  </span>
                </button>
              ))}
            </div>

            {visibleEvents.length ? (
              <div className="grid">
                {visibleEvents.map((event, index) => {
                  const year = event.publishedAt.slice(0, 4);
                  const startsYear = index === 0 || visibleEvents[index - 1].publishedAt.slice(0, 4) !== year;
                  return (
                    <Fragment key={event.id}>
                      {startsYear && <p className="tabular-nums m-0 border-b border-line bg-raised px-[18px] py-1.5 font-mono text-[11px] font-bold leading-[1.4] tracking-[0.08em] text-faint">{year}</p>}
                      <button
                        className={`relative grid min-h-16 w-full cursor-pointer grid-cols-[76px_minmax(0,1fr)_90px] items-center gap-3.5 border-0 border-b border-line px-[18px] py-[11px] text-left text-ink transition-colors last:border-b-0 hover:bg-hover max-[620px]:min-h-15 max-[620px]:grid-cols-[72px_minmax(0,1fr)] max-[620px]:px-4 ${activeEvent?.id === event.id ? "bg-accent-soft before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-accent before:content-['']" : "bg-transparent"}`}
                        type="button"
                        data-testid="event-row"
                        aria-pressed={activeEvent?.id === event.id}
                        onClick={() => setActiveEventId(event.id)}
                      >
                        <span className={`${kindTag} ${kindStyles[event.kind]}`}>{event.kind}</span>
                        <span className="grid min-w-0 gap-0.5">
                          <strong className="truncate text-sm font-semibold tracking-[-0.01em]">{event.title}</strong>
                          <small className="truncate text-[13px] leading-[1.45] text-muted max-[620px]:line-clamp-2 max-[620px]:whitespace-normal">{event.summary}</small>
                        </span>
                        <time className="tabular-nums text-right font-mono text-xs text-faint max-[620px]:hidden" dateTime={event.publishedAt}>{formatDate(event.publishedAt)}</time>
                      </button>
                    </Fragment>
                  );
                })}
              </div>
            ) : events.length === 0 ? (
              <div className="grid min-h-[200px] place-items-center content-center gap-2.5 p-5 text-center text-muted">
                <CircleAlert size={20} />
                <strong className="text-[15px] font-semibold text-ink">No valid events</strong>
                <span className="text-[13px]">Run the collector or inspect the contract error.</span>
              </div>
            ) : (
              <div className="grid min-h-[200px] place-items-center content-center gap-2.5 p-5 text-center text-muted">
                <CircleAlert size={20} />
                <strong className="text-[15px] font-semibold text-ink">
                  No {kindFilters.find((filter) => filter.value === activeKind)?.label.toLowerCase()} events
                </strong>
                <span className="text-[13px]">No events match this filter.</span>
                <button className={textAction} type="button" onClick={() => setActiveKind("all")}>Show all events</button>
              </div>
            )}

            {filteredEvents.length > 12 && (
              <button className="min-h-[42px] w-full cursor-pointer border-0 border-t border-line bg-surface text-[13px] font-semibold text-accent transition-colors hover:bg-accent-soft" type="button" onClick={() => setShowAll((value) => !value)}>
                {showAll ? "Show 12 events" : `Show all ${filteredEvents.length} events`}
              </button>
            )}
          </section>

          <aside className="sticky top-[76px] grid gap-5 max-[820px]:static max-[820px]:grid-cols-2 max-[620px]:grid-cols-1" aria-label="Selected event and collector details">
            <section className={`max-[820px]:col-span-full max-[620px]:col-auto ${panel}`} aria-live="polite">
              <div className={sectionHeading}>
                <h2 className={headingTitle}>Selected event</h2>
                {activeEvent && (
                  <a className="-my-0.5 grid size-8 place-items-center rounded-md text-faint transition-colors hover:bg-hover hover:text-accent max-[620px]:size-11" href={activeEvent.url} target="_blank" rel="noopener noreferrer" aria-label="Open selected event in a new tab">
                    <ExternalLink size={15} />
                  </a>
                )}
              </div>
              {activeEvent ? (
                <div className="px-[18px] pt-4 pb-0 max-[620px]:px-4">
                  <span className={`${kindTag} ${kindStyles[activeEvent.kind]}`}>{activeEvent.kind}</span>
                  <h3 className="mt-3 mb-2 text-xl font-bold leading-[1.25] tracking-[-0.02em]">{activeEvent.title}</h3>
                  <p className="m-0 text-sm leading-[1.6] text-muted">{activeEvent.summary}</p>
                  <dl className="mt-4 mb-0 grid grid-cols-3 gap-3 border-t border-line pt-3.5 max-[620px]:grid-cols-2">
                    <div className="grid gap-[3px]">
                      <dt className={fieldLabel}>Published</dt>
                      <dd className="tabular-nums m-0 text-[13px] font-semibold text-ink">{formatDate(activeEvent.publishedAt)}</dd>
                    </div>
                    <div className="grid gap-[3px]">
                      <dt className={fieldLabel}>Signal</dt>
                      <dd className="m-0 text-[13px] font-semibold capitalize text-ink">{activeEvent.kind}</dd>
                    </div>
                    <div className="grid gap-[3px]">
                      <dt className={fieldLabel}>Impact</dt>
                      <dd className="m-0 text-[13px] font-semibold capitalize text-ink">{activeEvent.impact}</dd>
                    </div>
                  </dl>
                  <p className="mt-3.5 mb-4 border-t border-line pt-3 text-xs leading-[1.55] text-faint">
                    Signal and impact are derived locally from the category and title text. They are not collector fields.
                  </p>
                </div>
              ) : <p className="px-[18px] py-4 text-sm text-muted">No event is selected.</p>}
            </section>

            <section className={panel}>
              <div className={sectionHeading}><h2 className={headingTitle}>Recent activity</h2></div>
              <ul className="m-0 grid list-none px-[18px] pt-1 pb-3">
                {runs.map((run) => (
                  <li className="grid grid-cols-[10px_minmax(0,1fr)] items-start gap-3 border-b border-line py-2.5 last:border-b-0" key={run.id}>
                    <span className={`mt-1 size-2.5 rounded-[2px] border ${runDotStyles[run.status]}`} />
                    <div className="grid min-w-0 gap-0.5">
                      <strong className="text-[13px] font-semibold leading-[1.4]">{run.detail}</strong>
                      <span className="tabular-nums font-mono text-xs text-faint">{run.duration ? `${run.time} · ${run.duration}` : run.time}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </div>

        <section className={`mt-5 ${panel}`}>
          <button className="flex min-h-12 w-full cursor-pointer items-center justify-between gap-3 border-0 border-b border-line bg-raised px-[18px] text-ink transition-colors hover:bg-hover" type="button" onClick={() => setShowPayload((value) => !value)} aria-expanded={showPayload} aria-controls="payload-output">
            <span className="inline-flex items-center gap-2 text-sm font-semibold"><Code2 size={16} />JSON output</span>
            <span className="inline-flex items-center gap-2 font-mono text-xs font-medium text-faint">{showPayload ? "Hide" : "View"} · Alt+K</span>
          </button>
          {showPayload && (
            <div id="payload-output">
              <div className="flex gap-1 border-b border-line bg-surface px-3.5 py-2" role="group" aria-label="JSON output type">
                <button className="cursor-pointer rounded-md border-0 bg-transparent px-3 py-1.5 text-[13px] font-semibold text-muted transition-colors hover:bg-hover aria-pressed:bg-accent-soft aria-pressed:text-accent max-[620px]:min-h-11" aria-pressed={payloadView === "collector"} type="button" onClick={() => setPayloadView("collector")}>Collector response</button>
                <button className="cursor-pointer rounded-md border-0 bg-transparent px-3 py-1.5 text-[13px] font-semibold text-muted transition-colors hover:bg-hover aria-pressed:bg-accent-soft aria-pressed:text-accent max-[620px]:min-h-11" aria-pressed={payloadView === "normalized"} type="button" onClick={() => setPayloadView("normalized")}>Normalized events</button>
              </div>
              <pre className="m-0 max-h-[460px] overflow-auto whitespace-pre-wrap bg-code-bg p-[18px] font-mono text-[13px] leading-[1.65] text-code-text [tab-size:2]" aria-label={payloadView === "collector" ? "Collector response" : "Normalized events"}>
                {JSON.stringify(payloadView === "collector" ? rawPayload : normalizedPayload, null, 2)}
              </pre>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

export default App;
