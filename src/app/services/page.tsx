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
          className="inline-flex items-center justify-center rounded-xl bg-orange-500 px-6 py-3 text-black font-semibold hover:bg-orange-600 transition"
        >
          View Services
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