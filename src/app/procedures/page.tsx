import Link from "next/link";
import ProcedureSearch from "@/components/ProcedureSearch";

const RESOURCES = [
  {
    title: "OEM1Stop",
    desc: "Access OEM repair procedures and position statements directly from manufacturers.",
    href: "https://www.oem1stop.com",
  },
  {
    title: "I-CAR",
    desc: "Industry training and technical resources for collision repair professionals.",
    href: "https://www.i-car.com",
  },
  {
    title: "Collision-IQ Chatbot",
    desc: "Upload an OE procedure PDF and ask specific questions using AI-powered analysis.",
    href: "/chatbot",
  },
];

export default function ProceduresPage() {
  return (
    <main className="mx-auto max-w-4xl px-4 py-12">
      {/* Back link + heading */}
      <div className="mb-8">
        <Link
          href="/"
          className="text-sm text-[color:var(--muted)] hover:underline"
        >
          ← Home
        </Link>
        <h1 className="mt-4 text-3xl font-semibold">
          OE Procedures &amp; Position Statements
        </h1>
        <p className="mt-2 text-[color:var(--muted)]">
          Search for Original Equipment manufacturer repair procedures and OEM
          position statements by vehicle make, model, and year.
        </p>
      </div>

      {/* Search card */}
      <div className="rounded-3xl border border-[color:var(--border)] bg-[color:var(--card)] p-6">
        <ProcedureSearch />
      </div>

      {/* Resource links */}
      <div className="mt-8 grid gap-4 sm:grid-cols-3">
        {RESOURCES.map(({ title, desc, href }) => (
          <a
            key={title}
            href={href}
            target={href.startsWith("http") ? "_blank" : undefined}
            rel={href.startsWith("http") ? "noopener noreferrer" : undefined}
            className="rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] p-4 transition hover:bg-white/5"
          >
            <div className="font-semibold">{title}</div>
            <div className="mt-1 text-sm text-[color:var(--muted)]">{desc}</div>
          </a>
        ))}
      </div>
    </main>
  );
}
