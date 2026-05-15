import Image from "next/image";
import Link from "next/link";

export default function CollisionAcademyPage() {
  return (
    <main className="min-h-screen text-white">
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

            <div className="hidden items-center gap-3 text-xs text-white/60 md:flex">
              <span className="inline-flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-[#C65A2A]" />
                Online
              </span>
              <span className="opacity-40">|</span>
              <span>Documentation-first</span>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/the-academy"
              className="rounded-2xl border border-[#C65A2A]/50 bg-[#C65A2A]/10 px-4 py-2 text-sm font-semibold text-[#C65A2A] transition hover:bg-[#C65A2A]/20"
            >
              The Academy
            </Link>

            <Link
              href="/"
              className="rounded-2xl border border-white/12 bg-white/5 px-4 py-2 text-sm text-white/85 transition hover:bg-white/10"
            >
              Collision IQ
            </Link>
          </div>
        </div>
      </header>

      <section className="relative isolate flex min-h-[50vh] items-end overflow-hidden">
        <video
          autoPlay
          muted
          loop
          playsInline
          className="absolute inset-0 h-full w-full object-cover"
        >
          <source src="/brand/logos/Logo-video.mp4" type="video/mp4" />
        </video>

        <div className="absolute inset-0 bg-black/60" />
        <div className="absolute inset-0 bg-gradient-to-tr from-black via-black/55 to-black/20" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_35%,rgba(0,0,0,0.9))]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_10%,rgba(198,90,42,0.18),transparent_45%)]" />

        <div className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-12">
          <h1 className="text-4xl font-bold leading-tight tracking-tight md:text-6xl">
            Collision IQ inside the Collision Academy brand
          </h1>

          <p className="mt-6 max-w-3xl text-lg leading-relaxed text-white/80 md:text-xl">
            Collision Academy is the umbrella brand for professional services,
            brand presence, and expert positioning. Collision IQ is the working
            software surface, and Technical Systems is the tailored product layer
            for shops.
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              href="/"
              className="rounded-2xl bg-[#C65A2A] px-6 py-3 text-sm font-semibold text-black shadow-[0_10px_30px_rgba(198,90,42,0.25)] transition hover:opacity-90"
            >
              Open Collision IQ
            </Link>

            <Link
              href="/the-academy"
              className="rounded-2xl border border-white/20 bg-black/25 px-6 py-3 text-sm font-semibold text-white transition hover:bg-black/35"
            >
              View Professional Services
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 py-12">
        <h2 className="mb-2 text-2xl font-semibold">How to work with us</h2>
        <p className="mb-6 text-sm text-white/60">
          Choose how you want to engage — start with Collision IQ, access
          systems, or work directly with our team.
        </p>

        <div className="grid gap-5 md:grid-cols-3">
          <Link
            href="/"
            className="rounded-3xl border border-white/10 bg-black/30 p-6 shadow-[0_25px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl transition hover:bg-black/40"
          >
            <div className="text-lg font-semibold">Collision IQ</div>
            <p className="mt-2 text-sm text-white/70">
              AI-powered repair analysis and decision support.
            </p>
            <div className="mt-5 text-sm text-[#C65A2A]">Open -&gt;</div>
          </Link>

          <Link
            href="/the-academy"
            className="rounded-3xl border border-white/10 bg-black/30 p-6 shadow-[0_25px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl transition hover:bg-black/40"
          >
            <div className="text-lg font-semibold">Professional Services</div>
            <p className="mt-2 text-sm text-white/70">
              Appraisals, diminished value, ACV support, and dispute help.
            </p>
            <div className="mt-5 text-sm text-[#C65A2A]">View -&gt;</div>
          </Link>

          <Link
            href="/technical-systems"
            className="rounded-3xl border border-[#C65A2A]/40 bg-black/30 p-6 shadow-[0_25px_80px_rgba(0,0,0,0.55)] backdrop-blur-xl transition hover:bg-black/40"
          >
            <div className="text-lg font-semibold">Technical Systems</div>
            <p className="mt-2 text-sm text-white/70">
              Custom-built applications for collision repair centers — workflows,
              automation, onboarding, and operational intelligence.
            </p>
            <div className="mt-5 text-sm text-[#C65A2A]">View Systems -&gt;</div>
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-12">
        <div className="rounded-3xl border border-white/10 bg-black/30 p-6 shadow-[0_30px_90px_rgba(0,0,0,0.6)] backdrop-blur-xl md:p-8">
          <div className="text-xl font-semibold">Collision IQ</div>
          <p className="mt-3 max-w-2xl text-white/70">
            Upload estimates, detect missed operations, and generate
            dispute-ready documentation using AI built for collision repair.
          </p>

          <Link href="/" className="mt-6 inline-block text-sm font-medium text-[#C65A2A]">
            Launch -&gt;
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-16">
        <div className="rounded-3xl border border-white/10 bg-black/30 p-6 shadow-[0_30px_90px_rgba(0,0,0,0.6)] backdrop-blur-xl md:p-8">
          <div className="text-xl font-semibold">Stay connected</div>

          <div className="mt-5 grid gap-4 md:grid-cols-3">
            <Link
              href="/"
              className="group rounded-2xl border border-white/10 bg-black/35 p-5 transition hover:bg-black/45"
            >
              <div className="text-sm font-semibold">Collision IQ</div>
              <div className="mt-2 text-sm text-white/70">
                Open the chatbot and repair intelligence workspace.
              </div>
              <div className="mt-4 text-sm text-[#C65A2A]">Open -&gt;</div>
            </Link>

            <Link
              href="/the-academy"
              className="group rounded-2xl border border-white/10 bg-black/35 p-5 transition hover:bg-black/45"
            >
              <div className="text-sm font-semibold">Professional Services</div>
              <div className="mt-2 text-sm text-white/70">
                Move into appraisal, diminished value, ACV, and dispute support.
              </div>
              <div className="mt-4 text-sm text-[#C65A2A]">View -&gt;</div>
            </Link>

            <Link
              href="/technical-systems"
              className="group rounded-2xl border border-white/10 bg-black/35 p-5 transition hover:bg-black/45"
            >
              <div className="text-sm font-semibold">Technical Systems</div>
              <div className="mt-2 text-sm text-white/70">
                Review subscriptions, apps, onboarding, and tailored system builds.
              </div>
              <div className="mt-4 text-sm text-[#C65A2A]">View -&gt;</div>
            </Link>
          </div>
        </div>
      </section>

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
            <Link href="/" className="transition hover:text-white">
              Collision IQ
            </Link>
          </div>
        </div>
      </footer>
    </main>
  );
}
