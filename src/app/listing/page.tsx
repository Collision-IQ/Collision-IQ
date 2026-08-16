"use client";

// Outbound listing page for Value IQ report links.
//
// PDF viewers decide link-target behavior themselves — Chrome's built-in
// viewer navigates the report tab away on a plain URI link, losing the
// reader's place. Report links therefore land here, and the button below is a
// real <a target="_blank">, which every browser honors — the listing opens in
// a new tab and the report tab survives (owner requirement, three reports
// running). This is NOT an auto-redirect: the destination is displayed in
// full and nothing navigates without a click, so the page cannot be used as
// an open redirect.

import { Suspense } from "react";
import Link from "next/link";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";

function OutboundListing() {
  const searchParams = useSearchParams();
  const raw = searchParams.get("u") ?? "";

  let url: URL | null = null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      url = parsed;
    }
  } catch {
    url = null;
  }

  return (
    <section className="mx-auto max-w-xl px-5 py-16">
      {url ? (
        <div className="ci-card p-8">
          <h1 className="mb-2 text-xl font-semibold">View this comparable listing</h1>
          <p className="mb-1 text-sm text-muted-foreground">
            This link comes from a Collision iQ valuation report. You are leaving the report to
            view a live listing on{" "}
            <span className="font-semibold text-foreground">{url.hostname.replace(/^www\./, "")}</span>.
          </p>
          <p className="mb-6 break-all rounded-lg border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
            {url.toString()}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <a
              href={url.toString()}
              target="_blank"
              rel="noopener noreferrer"
              className="ci-btn ci-btn-primary"
            >
              <ExternalLink className="mr-2 h-4 w-4" />
              Open listing in a new tab
            </a>
            <button type="button" className="ci-btn ci-btn-ghost" onClick={() => history.back()}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              Return to your report
            </button>
          </div>
          <p className="mt-4 text-xs text-muted-foreground">
            Listings change and sell quickly — save the listing to PDF while it is live. Market
            values in the report reflect the listing as of the date it was accessed.
          </p>
        </div>
      ) : (
        <div className="ci-card p-8">
          <h1 className="mb-2 text-xl font-semibold">Listing link unavailable</h1>
          <p className="text-sm text-muted-foreground">
            This link is missing or malformed. Use the full listing URL printed in the report.
          </p>
        </div>
      )}
    </section>
  );
}

export default function ListingRedirectPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
          <Link href="/" className="flex items-center gap-2">
            <Image src="/iq/iq_logo.png" alt="Collision iQ" width={34} height={34} />
            <span className="text-sm font-semibold tracking-wide">Collision iQ</span>
          </Link>
          <Link href="/diminished-value" className="text-sm text-muted-foreground hover:text-foreground">
            Value IQ
          </Link>
        </div>
      </header>
      <Suspense fallback={null}>
        <OutboundListing />
      </Suspense>
    </main>
  );
}
