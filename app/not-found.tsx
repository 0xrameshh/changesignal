import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen w-[min(100%-32px,560px)] flex-col items-start justify-center gap-4 text-ink">
      <span className="font-mono text-[13px] font-semibold leading-none tracking-[0.04em] text-faint">404</span>
      <h1 className="m-0 text-[clamp(28px,5vw,42px)] font-bold leading-[1.1] tracking-[-0.035em]">This workspace does not exist</h1>
      <p className="mt-0 mb-2 max-w-[56ch] text-[15px] leading-[1.6] text-muted">ChangeSignal currently exposes one monitored source and its recovery evidence.</p>
      <Link className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-accent no-underline hover:text-accent-hover hover:underline" href="/">
        <ArrowLeft size={15} />Return to Bun changelog
      </Link>
    </main>
  );
}
