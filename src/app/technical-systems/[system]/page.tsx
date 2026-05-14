import fs from "node:fs";
import path from "node:path";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import CheckoutButton from "./CheckoutButton";

type SystemSlug = "shop-flow" | "parts-app" | "shop-hub";
type Plan = "shop_hub" | "shop_flow" | "parts_app";

type SystemPage = {
  title: string;
  plan: Plan;
  logo: string;
  icon: string;
  kicker: string;
  price: string;
  description: string;
  includedNote: string;
  assetRoots: string[];
  features: string[];
  faq: Array<{ question: string; answer: string }>;
};

const SYSTEM_PAGES: Record<SystemSlug, SystemPage> = {
  "shop-flow": {
    title: "Shop-Flow",
    plan: "shop_flow",
    logo: "/shop_flow/brand/collision-flow-logo.svg",
    icon: "/shop_flow/brand/collision-flow-app-icon.png",
    kicker: "Production workflow system",
    price: "$200/month",
    description: "A cleaner workflow layer for repair centers that need production visibility, estimate-review checkpoints, and sharper handoffs from analysis to action.",
    includedNote: "Included in Shop Hub.",
    assetRoots: ["shop_flow"],
    features: [
      "Production queue visibility for active repair work",
      "Workflow checkpoints for estimate review and supplement handling",
      "Operational views that show what needs attention next",
      "A cleaner path from repair intelligence to production action",
    ],
    faq: [
      { question: "Who is Shop-Flow for?", answer: "Repair centers that need a more consistent way to see work status, handoffs, and estimate-review checkpoints." },
      { question: "Is Shop-Flow bundled?", answer: "Yes. Shop-Flow is included in Shop Hub for teams that also want Parts App." },
    ],
  },
  "parts-app": {
    title: "Parts App",
    plan: "parts_app",
    logo: "/parts_app/brand/collision-iq-parts-logo.svg",
    icon: "/parts_app/brand/collision-iq-parts-app-icon.png",
    kicker: "Parts request and coordination system",
    price: "$200/month",
    description: "Parts-focused process support and decision guidance for intake, queues, locator workflows, and management visibility.",
    includedNote: "Included in Shop Hub.",
    assetRoots: ["parts_app"],
    features: [
      "Parts request intake for office, appraiser, and technician workflows",
      "Queue and locator views for faster internal coordination",
      "Management views for request volume and status",
      "Repeatable parts decisions inside the repair workflow",
    ],
    faq: [
      { question: "What does Parts App organize?", answer: "Requests, queue visibility, location support, and parts-process coordination across shop roles." },
      { question: "Does Shop Hub include Parts App?", answer: "Yes. Parts App is included in the Shop Hub bundle." },
    ],
  },
  "shop-hub": {
    title: "Shop Hub",
    plan: "shop_hub",
    logo: "/iq/iq_logo.png",
    icon: "/iq/iq-app.png",
    kicker: "Bundled shop operating layer",
    price: "$300/month",
    description: "A bundled technical systems package that combines Shop-Flow and Parts App for shops that want workflow and parts coordination in one operating path.",
    includedNote: "Includes Shop-Flow, Parts App, and free virtual onboarding.",
    assetRoots: ["shop_flow", "parts_app"],
    features: [
      "Combined production and parts workflow visibility",
      "Shared operating rhythm across office, appraiser, production, and parts roles",
      "Lower bundled monthly price than buying systems separately",
      "Free virtual onboarding to help launch the system",
    ],
    faq: [
      { question: "What is included?", answer: "Shop Hub includes Shop-Flow, Parts App, bundled pricing, and free virtual onboarding." },
      { question: "Who should choose Shop Hub?", answer: "Teams that want both workflow visibility and parts coordination without managing separate system decisions." },
    ],
  },
};

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov"]);

export function generateStaticParams() {
  return Object.keys(SYSTEM_PAGES).map((system) => ({ system }));
}

type PageProps = {
  params: Promise<{ system: string }>;
};

export default async function TechnicalSystemDetailPage({ params }: PageProps) {
  const { system } = await params;
  if (!isSystemSlug(system)) notFound();

  const page = SYSTEM_PAGES[system];
  const assets = discoverAssets(page.assetRoots);
  const heroImage = assets.images[0];

  return (
    <main className="min-h-screen bg-[#f7f9fc] text-[#102033]">
      <MarketingNav />

      <section className="mx-auto grid max-w-7xl items-center gap-10 px-6 py-14 lg:grid-cols-[0.92fr_1.08fr] lg:py-20">
        <div>
          <div className="flex h-16 items-center">
            <Image src={page.logo} alt={`${page.title} logo`} width={210} height={64} className="max-h-14 w-auto object-contain" priority />
          </div>
          <p className="mt-8 text-sm font-semibold uppercase tracking-[0.2em] text-[#c65a2a]">{page.kicker}</p>
          <h1 className="mt-4 text-5xl font-bold tracking-tight text-[#0b1727] md:text-6xl">{page.title}</h1>
          <p className="mt-5 max-w-2xl text-lg leading-8 text-[#5a697a]">{page.description}</p>
          <div className="mt-6 inline-flex rounded-full bg-white px-4 py-2 text-sm font-semibold text-[#102033] shadow-sm">
            {page.price}
          </div>
          <p className="mt-4 text-sm font-semibold text-[#c65a2a]">{page.includedNote}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <CheckoutButton plan={page.plan} label={`Subscribe to ${page.title}`} />
            <Link href="/sign-up" className="rounded-full border border-[#dbe4ee] bg-white px-6 py-3 text-sm font-semibold text-[#102033] shadow-sm transition hover:border-[#c65a2a]/40 hover:text-[#c65a2a]">
              Start 30-Day Free Trial
            </Link>
          </div>
        </div>

        <div className="rounded-[30px] border border-[#dfe7f0] bg-white p-5 shadow-[0_24px_80px_rgba(15,32,51,0.12)]">
          {heroImage ? (
            <Image src={heroImage.src} alt={heroImage.alt} width={1100} height={720} priority className="h-auto w-full rounded-[22px] object-cover" />
          ) : (
            <Placeholder title={`${page.title} preview`} />
          )}
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-6 px-6 pb-16 md:grid-cols-[0.8fr_1.2fr]">
        <div className="rounded-[28px] border border-[#dfe7f0] bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#c65a2a]">Overview</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-[#0b1727]">Built around collision repair work.</h2>
          <p className="mt-4 text-sm leading-7 text-[#5a697a]">Each system is intentionally narrow enough to deploy quickly and practical enough for daily shop use.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {page.features.map((feature) => (
            <div key={feature} className="rounded-[24px] border border-[#dfe7f0] bg-white p-5 text-sm font-medium leading-7 text-[#24364b] shadow-sm">
              {feature}
            </div>
          ))}
        </div>
      </section>

      <MediaSection assets={assets} title={page.title} />

      <section className="mx-auto max-w-7xl px-6 pb-20">
        <div className="grid gap-5 md:grid-cols-2">
          {page.faq.map((item) => (
            <article key={item.question} className="rounded-[24px] border border-[#dfe7f0] bg-white p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-[#0b1727]">{item.question}</h3>
              <p className="mt-3 text-sm leading-7 text-[#5a697a]">{item.answer}</p>
            </article>
          ))}
        </div>
        <div className="mt-8 rounded-[30px] bg-[#0b1727] p-8 text-white md:p-10">
          <h2 className="text-3xl font-bold tracking-tight">Need a tailored systems path?</h2>
          <p className="mt-3 max-w-2xl text-sm leading-7 text-white/72">Professional Services can help map the right system mix, onboarding path, and operational rollout.</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/professional" className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-[#102033] transition hover:bg-[#f4f7fb]">Contact Professional Services</Link>
            <Link href="/technical-systems" className="rounded-full border border-white/18 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10">Back to systems</Link>
          </div>
        </div>
      </section>
    </main>
  );
}

function MarketingNav() {
  return (
    <header className="sticky top-0 z-40 border-b border-[#e4ebf3]/80 bg-white/90 backdrop-blur">
      <nav className="mx-auto flex max-w-7xl items-center justify-between gap-5 px-6 py-4">
        <Link href="/" className="flex items-center gap-3">
          <Image src="/iq/iq_logo.png" alt="Collision IQ" width={154} height={36} className="h-9 w-auto" priority />
        </Link>
        <div className="hidden items-center gap-7 text-sm font-medium text-[#526173] lg:flex">
          <Link href="/technical-systems" className="text-[#c65a2a]">Technical Systems</Link>
          <Link href="/professional" className="transition hover:text-[#c65a2a]">Professional Services</Link>
          <Link href="/the-academy" className="transition hover:text-[#c65a2a]">Resources</Link>
          <Link href="/pricing" className="transition hover:text-[#c65a2a]">Pricing</Link>
          <Link href="/services" className="transition hover:text-[#c65a2a]">About</Link>
        </div>
        <Link href="/dashboard" className="rounded-full bg-[#102033] px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#1b314b]">
          Go to Workspace
        </Link>
      </nav>
    </header>
  );
}

function MediaSection({ assets, title }: { assets: ReturnType<typeof discoverAssets>; title: string }) {
  return (
    <section className="mx-auto max-w-7xl px-6 pb-16">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[#c65a2a]">Screenshots & videos</p>
          <h2 className="mt-2 text-3xl font-bold tracking-tight text-[#0b1727]">Product views</h2>
        </div>
      </div>
      {assets.videos.length > 0 ? (
        <div className="grid gap-6 md:grid-cols-2">
          {assets.videos.map((asset) => (
            <video key={asset.src} controls className="aspect-video w-full rounded-[24px] border border-[#dfe7f0] bg-black shadow-sm">
              <source src={asset.src} />
            </video>
          ))}
        </div>
      ) : null}
      {assets.images.length > 1 ? (
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          {assets.images.slice(1, 7).map((asset) => (
            <Image key={asset.src} src={asset.src} alt={asset.alt} width={1000} height={680} className="h-auto w-full rounded-[24px] border border-[#dfe7f0] bg-white object-cover shadow-sm" />
          ))}
        </div>
      ) : assets.videos.length === 0 ? (
        <Placeholder title={`${title} media coming soon`} />
      ) : null}
    </section>
  );
}

function Placeholder({ title }: { title: string }) {
  return (
    <div className="flex min-h-[320px] items-center justify-center rounded-[22px] border border-dashed border-[#c8d4e1] bg-[#f7f9fc] p-8 text-center">
      <div>
        <div className="mx-auto mb-4 h-12 w-12 rounded-2xl bg-[#fff2ec]" />
        <p className="text-sm font-semibold text-[#102033]">{title}</p>
        <p className="mt-2 text-sm text-[#6a7888]">Visual assets can be added without changing the page layout.</p>
      </div>
    </div>
  );
}

function isSystemSlug(value: string): value is SystemSlug {
  return value in SYSTEM_PAGES;
}

function discoverAssets(roots: string[]) {
  const publicRoot = path.join(process.cwd(), "public");
  const images: Array<{ src: string; alt: string }> = [];
  const videos: Array<{ src: string }> = [];

  for (const root of roots) {
    const absoluteRoot = path.join(publicRoot, root);
    if (!fs.existsSync(absoluteRoot)) continue;

    for (const file of walkFiles(absoluteRoot)) {
      const ext = path.extname(file).toLowerCase();
      const src = `/${path.relative(publicRoot, file).replace(/\\/g, "/")}`;
      if (IMAGE_EXTENSIONS.has(ext) && !/favicon|background|brand\.png/i.test(file) && images.length < 10) {
        images.push({ src, alt: humanizeAssetName(file) });
      }
      if (VIDEO_EXTENSIONS.has(ext) && videos.length < 4) {
        videos.push({ src });
      }
    }
  }

  return { images, videos };
}

function walkFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walkFiles(file) : [file];
  });
}

function humanizeAssetName(file: string) {
  return path
    .basename(file, path.extname(file))
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
