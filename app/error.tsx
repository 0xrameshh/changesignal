"use client";

import { CircleAlert } from "lucide-react";
import { Button } from "../src/components/ui/button";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-screen w-[min(100%-32px,560px)] flex-col items-start justify-center gap-4 text-ink">
      <CircleAlert className="text-danger" size={24} aria-hidden="true" />
      <h1 className="m-0 text-[clamp(28px,5vw,42px)] font-bold leading-[1.1] tracking-[-0.035em]">The workspace could not load</h1>
      <p className="mt-0 mb-2 max-w-[56ch] text-[15px] leading-[1.6] text-muted">The saved evidence is still safe. Retry the interface, or check the server logs if the problem continues.</p>
      <Button variant="primary" onClick={reset}>Try again</Button>
    </main>
  );
}
