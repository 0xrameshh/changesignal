export default function Loading() {
  return (
    <main className="mx-auto flex min-h-screen w-[min(100%-32px,560px)] flex-col items-start justify-center gap-4 text-ink" aria-busy="true" aria-live="polite">
      <span className="size-6 animate-spin rounded-full border-[2.5px] border-line-strong border-t-accent" aria-hidden="true" />
      <h1 className="m-0 text-[clamp(28px,5vw,42px)] font-bold leading-[1.1] tracking-[-0.035em]">Loading the workspace</h1>
      <p className="mt-0 mb-2 max-w-[56ch] text-[15px] leading-[1.6] text-muted">Preparing saved collector output and recovery evidence.</p>
    </main>
  );
}
