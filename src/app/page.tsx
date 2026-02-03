import Image from "next/image";
import Link from "next/link";
import AnimatedHeader from "@/components/AnimatedHeader";

/* ----------------------------------------
   Small UI helper
---------------------------------------- */
function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-[color:var(--border)] bg-white/5 px-3 py-1 text-xs text-[color:var(--muted)]">
      {children}
    </span>
  );
}

/* ----------------------------------------
   Home Page
---------------------------------------- */
export default function Home() {
  return (
    <>
      {/* ========================================
          HERO HEADER (FIXED HEIGHT WRAPPER)
         ======================================== */}
      <header className="relative w-full h-[70vh] min-h-[520px] overflow-hidden">
        <AnimatedHeader />

        {/* Optional dark overlay for contrast */}
        <div className="pointer-events-none absolute inset-0 bg-black/40" />
      </header>

      {/* ========================================
          MAIN CONTENT (OVERLAPS HERO)
         ======================================== */}
      <main className="relative z-10 mx-auto max-w-6xl px-4 py-14 -mt-40">
        <div className="grid items-center gap-10 md:grid-cols-2">
          {/* LEFT COLUMN */}
          <div>
            <div className="flex flex-wrap gap-2">
              <Pill>Buy Now</Pill>
              <Pill>Mobile-friendly</Pill>
              <Pill>Documentation-first</Pill>
              <Pill>PA • NJ • DE • MD • NC</Pill>
            </div>

            <h1 className="mt-5 text-4xl font-semibold leading-tight md:text-5xl">
              Professional-grade vehicle valuations and appraisal support—built for{" "}
              <span className="text-[color:var(--accent)] font-semibold">
                OEM-compliant
              </span>{" "}
              repairs for policyholders and repair centers.
            </h1>

            <p className="mt-4 text-[color:var(--muted)]">
              Collision Academy supports repair centers and policyholders through
              manufacturer repair procedures, OEM position statements, and insurance
              policy law. Our guidance helps ensure repairs meet manufacturer standards,
              legal obligations, and safety requirements—especially when insurer
              practices fall short.
            </p>

            {/* PRIMARY CTA */}
            <div className="mt-7">
              <a
                href="https://www.collision.academy/s/shop"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block rounded-xl bg-[color:var(--accent)] px-6 py-3 text-center font-semibold text-black hover:opacity-90"
              >
                View Packages
              </a>
            </div>

            {/* VALUE CARDS */}
            <div className="mt-8 grid grid-cols-3 gap-3 text-center">
              {[
                ["OEM", "standards aligned"],
                ["Clear", "negotiation support"],
                ["Fast", "remote workflow"],
              ].map(([title, desc]) => (
                <div
                  key={title}
                  className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-4"
                >
                  <div className="text-xl font-semibold">{title}</div>
                  <div className="text-xs text-[color:var(--muted)]">{desc}</div>
                </div>
              ))}
            </div>
          </div>

          {/* RIGHT COLUMN */}
          <div className="rounded-3xl border border-[color:var(--border)] bg-[color:var(--card)] p-6">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm text-[color:var(--muted)]">Featured</div>
                <div className="text-xl font-semibold">Collision Academy</div>
              </div>
              <Image
                src="/brand/logos/Logo-grey.png"
                alt="Collision Academy"
                width={140}
                height={32}
                className="opacity-80"
                priority
              />
            </div>

            <div className="mt-6 grid gap-3">
              {[
                [
                  "Diminished Value",
                  "Market-based DV documentation for negotiation.",
                ],
                [
                  "Total Loss Value Dispute",
                  "Comp-driven rebuttal support and review.",
                ],
                [
                  "Right to Appraisal",
                  "Process guidance + documentation packet.",
                ],
              ].map(([title, desc]) => (
                <div
                  key={title}
                  className="rounded-2xl border border-[color:var(--border)] bg-white/5 p-4"
                >
                  <div className="font-semibold">{title}</div>
                  <div className="text-sm text-[color:var(--muted)]">{desc}</div>
                </div>
              ))}
            </div>

            {/* SEE ALL SERVICES */}
            <div className="mt-6">
              <Link
                href="/services"
                className="block rounded-xl border border-[color:var(--border)] px-5 py-3 text-center hover:bg-white/5"
              >
                See all services →
              </Link>
            </div>
          </div>
        </div>
      </main>

      {/* ========================================
          NEXT STEPS
         ======================================== */}
      <section className="mx-auto mt-16 max-w-6xl px-4">
        <h2 className="text-2xl font-semibold">Next steps</h2>

        <div className="mt-5 grid gap-4 md:grid-cols-3">
          <a
            href="/chatbot"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-5 transition hover:bg-white/5"
          >
            <div className="font-semibold">Collision-IQ Chatbot</div>
            <div className="mt-2 text-sm text-[color:var(--muted)]">
              Ask repair, OEM, and insurance questions in real time.
            </div>
          </a>

          <a
            href="https://www.instagram.com/collision_academy/"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-5 transition hover:bg-white/5"
          >
            <div className="font-semibold">Instagram</div>
            <div className="mt-2 text-sm text-[color:var(--muted)]">
              Repair insights, claim tips, and real-world examples.
            </div>
          </a>

          <a
            href="https://www.linkedin.com/in/vinny-menichetti-917097304/"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-5 transition hover:bg-white/5"
          >
            <div className="font-semibold">LinkedIn</div>
            <div className="mt-2 text-sm text-[color:var(--muted)]">
              Industry updates, standards, and professional guidance.
            </div>
          </a>
        </div>
      </section>
    </>
  );
}
// This is the main home page for Collision Academy. It features a hero header
// with an animated background, a two-column layout highlighting services
// and value propositions, and a "Next Steps" section with links to the chatbot
// and social media profiles. The design is responsive and styled for clarity
// and engagement.