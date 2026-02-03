import Link from "next/link";

export default function ServicesPage() {
  return (
    <main className="mx-auto max-w-xl px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold">
        Collision Academy Services
      </h1>

      <p className="mt-3 text-sm text-[color:var(--muted)]">
        Services are securely handled through our checkout partner.
      </p>

      <div className="mt-8 flex flex-col gap-4">
        <a
          href="https://www.collision.academy/s/shop"
          target="_blank"
          rel="noopener noreferrer"
          className="rounded-xl bg-[color:var(--accent)] px-6 py-3 font-semibold text-black hover:opacity-90"
        >
          Continue to Services
        </a>

        <Link
          href="/"
          className="rounded-xl border border-[color:var(--border)] px-6 py-3 text-sm hover:bg-white/5"
        >
          ← Go back to home
        </Link>
      </div>
    </main>
  );
}
// This page provides information about Collision Academy's services
// and includes a link to the external services shop. It also offers
// navigation back to the home page. The layout is centered and styled
// for clarity and ease of use.