import Link from "next/link";

type AcademyCard = {
  title: string;
  description: string;
  href: string;
  cta: string;
  featured?: boolean;
};

const academyCards: AcademyCard[] = [
  {
    title: "Membership Access",
    description:
      "Tiered access to Collision IQ tools, training, and system workflows.",
    href: "/the-academy#membership",
    cta: "View Membership",
  },
  {
    title: "Technical Systems",
    description:
      "Custom-built applications for repair centers designed to improve transparency, efficiency, communication, and workflow control.",
    href: "/the-academy#technical-systems",
    cta: "Explore Systems",
    featured: true,
  },
  {
    title: "Professional Services",
    description:
      "Hands-on support for complex claims, including estimating strategy, RTA positioning, diminished value, total loss disputes, and negotiation.",
    href: "/the-academy#professional-services",
    cta: "Request Support",
  },
];

export function AcademyPathwayCards() {
  return (
    <section className="w-full">
      <div className="mx-auto w-full max-w-6xl px-6 md:px-8">
        <div className="mb-6">
          <p className="text-xs font-medium uppercase tracking-[0.24em] text-white/45">
            Three ways to work with Collision IQ
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {academyCards.map((card) => (
            <Link
              key={card.title}
              href={card.href}
              className={[
                "group rounded-[24px] border bg-black/40 p-7 transition-all duration-200",
                "hover:-translate-y-0.5 hover:border-[#d96b32] hover:bg-black/55",
                "focus:outline-none focus:ring-2 focus:ring-[#d96b32]/50",
                card.featured
                  ? "border-[#d96b32]/45 shadow-[0_0_0_1px_rgba(217,107,50,0.12)]"
                  : "border-white/10",
              ].join(" ")}
            >
              <div className="flex h-full flex-col">
                <h3 className="text-[28px] font-semibold leading-tight text-white">
                  {card.title}
                </h3>

                <p className="mt-4 text-[15px] leading-7 text-white/68">
                  {card.description}
                </p>

                <div className="mt-6 pt-2">
                  <span className="inline-flex items-center gap-2 text-sm font-medium text-[#d96b32] transition-transform duration-200 group-hover:translate-x-0.5">
                    {card.cta}
                    <span aria-hidden="true">→</span>
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
