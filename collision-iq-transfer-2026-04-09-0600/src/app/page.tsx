import Image from "next/image";
import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen text-white">
      {/* ================= HEADER ================= */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-black/40 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
          <div className="flex items-center gap-3">
            <div className="relative h-9 w-40">
              <Image
                src="/brand/logos/Logo-grey.png"
                alt="Collision Academy"
                fill
                className="object-contain"
                priority
              />
            </div>

            <div className="hidden md:flex items-center gap-3 text-xs text-white/60">
              <span className="inline-flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[#C65A2A]" />
                Online
              </span>
              <span className="opacity-40">|</span>
              <span>Documentation-first</span>
            </div>
          </div>

          <Link
            href="/chatbot"
            className="rounded-2xl border border-white/12 bg-white/5 px-4 py-2 text-sm text-white/85 hover:bg-white/10 transition"
          >
            Open Collision IQ
          </Link>
        </div>
      </header>

      {/* ================= HERO ================= */}
      <section className="relative isolate min-h-[46vh] md:min-h-[50vh] overflow-hidden flex items-end">
        <video
          autoPlay
          muted
          loop
          playsInline
          className="absolute inset-0 h-full w-full object-cover"
        >
          <source src="/brand/logos/Logo-video.mp4" type="video/mp4" />
        </video>

        {/* Overlays */}
        <div className="absolute inset-0 bg-black/60" />
        <div className="absolute inset-0 bg-gradient-to-tr from-black via-black/55 to-black/20" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_35%,rgba(0,0,0,0.9))]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_10%,rgba(198,90,42,0.18),transparent_45%)]" />

        <div className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-10">
          <h1 className="text-4xl md:text-6xl font-bold leading-tight tracking-tight">
            Automotive Appraisal &amp; Collision Technology Experts.
          </h1>

          <p className="mt-6 text-lg md:text-xl text-white/80 max-w-3xl leading-relaxed">
            Court-recognized expertise in vehicle appraisals, diminished value,
            total loss disputes, and right-to-appraisal clauses.
            Now introducing{" "}
            <span className="text-[#C65A2A] font-semibold">
              Collision IQ
            </span>{" "}
            — AI-powered production solutions for collision repair shops.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <a
              href="https://www.collision.academy/s/shop"
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-2xl bg-[#C65A2A] px-6 py-3 text-sm font-semibold text-black hover:opacity-90 transition"
            >
              View Services
            </a>

            <Link
              href="/chatbot"
              className="rounded-2xl border border-white/20 bg-black/25 px-6 py-3 text-sm font-semibold text-white hover:bg-black/35 transition"
            >
              Launch Collision IQ
            </Link>
          </div>
        </div>
      </section>

      {/* ================= DIALOGUE BAR ================= */}
      <section className="border-t border-white/10 bg-black/35 backdrop-blur-xl">
        <div className="mx-auto max-w-6xl px-5 py-5">
          <Link href="/chatbot" className="flex items-center gap-3 group">
            <div className="flex-1 rounded-2xl border border-white/12 bg-black/35 px-4 py-3 text-sm text-white/60 group-hover:border-white/30 transition">
              How can I help you today?
            </div>

            <div className="rounded-2xl bg-[#C65A2A] px-5 py-3 text-sm font-semibold text-black hover:opacity-90 transition">
              Chat
            </div>
          </Link>
        </div>
      </section>

      {/* ================= SERVICES ================= */}
      <section className="mx-auto max-w-6xl px-5 py-10">
        <div className="grid gap-5 md:grid-cols-3">
          {[
            {
              title: "Diminished Value",
              desc: "Market-based DV documentation for negotiation.",
            },
            {
              title: "Total Loss Value Dispute",
              desc: "Comp-driven rebuttal support and review.",
            },
            {
              title: "Right to Appraisal",
              desc: "Process guidance + documentation packet.",
            },
          ].map((s) => (
            <div
              key={s.title}
              className="rounded-3xl border border-white/10 bg-black/30 backdrop-blur-xl p-6 shadow-[0_25px_80px_rgba(0,0,0,0.55)]"
            >
              <div className="text-lg font-semibold">{s.title}</div>
              <div className="mt-2 text-sm text-white/70">{s.desc}</div>

              <div className="mt-5">
                <a
                  href="https://www.collision.academy/s/shop"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center rounded-2xl border border-white/12 bg-white/5 px-4 py-2 text-sm text-white/85 hover:bg-white/10 transition"
                >
                  Learn more →
                </a>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ================= NEXT STEPS ================= */}
      <section className="mx-auto max-w-6xl px-5 pb-16">
        <div className="rounded-3xl border border-white/10 bg-black/30 backdrop-blur-xl p-6 md:p-8 shadow-[0_30px_90px_rgba(0,0,0,0.6)]">
          <div className="text-xl font-semibold">Next steps</div>

          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <Link
              href="/chatbot"
              className="group rounded-2xl border border-white/10 bg-black/35 p-5 hover:bg-black/45 transition"
            >
              <div className="text-sm font-semibold">Collision IQ Chatbot</div>
              <div className="mt-2 text-sm text-white/70">
                Ask repair, OEM, and insurance questions in real time.
              </div>
              <div className="mt-4 text-sm text-[#C65A2A]">
                Open →
              </div>
            </Link>

            <a
              href="https://www.instagram.com/collision_academy"
              target="_blank"
              rel="noopener noreferrer"
              className="group rounded-2xl border border-white/10 bg-black/35 p-5 hover:bg-black/45 transition"
            >
              <div className="text-sm font-semibold">Instagram</div>
              <div className="mt-2 text-sm text-white/70">
                Repair insights, claim tips, and real-world examples.
              </div>
              <div className="mt-4 text-sm text-[#C65A2A]">
                View →
              </div>
            </a>

            <a
              href="https://www.linkedin.com/in/vinny-menichetti-917097304/"
              target="_blank"
              rel="noopener noreferrer"
              className="group rounded-2xl border border-white/10 bg-black/35 p-5 hover:bg-black/45 transition"
            >
              <div className="text-sm font-semibold">LinkedIn</div>
              <div className="mt-2 text-sm text-white/70">
                Industry updates and professional guidance.
              </div>
              <div className="mt-4 text-sm text-[#C65A2A]">
                View →
              </div>
            </a>
          </div>
        </div>
      </section>

      {/* ================= FOOTER ================= */}
      <footer className="border-t border-white/10 py-10">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-5 text-sm text-white/55 md:flex-row md:items-center md:justify-between">
          <div>&copy; {new Date().getFullYear()} Collision Academy</div>

          <div className="flex flex-wrap items-center gap-4">
            <Link href="/terms" className="transition hover:text-white">
              Terms
            </Link>
            <Link href="/privacy" className="transition hover:text-white">
              Privacy
            </Link>
            <Link href="/chatbot" className="transition hover:text-white">
              Collision IQ
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
// This is the main landing page for Collision Academy. It features a cinematic hero section with a video background, an introduction to the company's services, and clear calls to action for users to explore the chatbot and services. The page is designed to be visually engaging while providing essential information about what Collision Academy offers.
