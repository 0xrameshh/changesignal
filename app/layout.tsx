import type { Metadata, Viewport } from "next";
import "@fontsource-variable/manrope";
import "../src/styles.css";

export const metadata: Metadata = {
  title: "ChangeSignal — resilient change monitoring",
  description: "ChangeSignal is a self-healing public changelog monitor.",
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0d10",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="scroll-smooth">
      <body className="min-h-screen min-w-80 bg-canvas font-sans text-ink antialiased">
        {/*
          THESIS: Put real scraper output and contract health ahead of product chrome.
          OWN-WORLD: A restrained developer workspace with one source, one primary action, and plain operational language.
          STORY: Run the collector, inspect normalized events, diagnose contract failure, and verify same-collector recovery.
          FIRST VIEWPORT: Source identity, collector state, run control, extracted events, selected output, and recovery status.
          FORM: A focused data workspace with progressive disclosure for evidence and JSON.
        */}
        {children}
      </body>
    </html>
  );
}
