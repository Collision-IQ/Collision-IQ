import fs from "node:fs";
import path from "node:path";
import Link from "next/link";
import { notFound } from "next/navigation";

type SystemSlug = "shop-flow" | "parts-app" | "shop-hub";

type SystemPage = {
  title: string;
  kicker: string;
  description: string;
  capabilities: string[];
  assetRoots: string[];
};

const SYSTEM_PAGES: Record<SystemSlug, SystemPage> = {
  "shop-flow": {
    title: "Shop-Flow",
    kicker: "Production workflow system",
    description:
      "A workflow layer for repair centers that need cleaner handoffs, more consistent production visibility, and a clearer path from estimate review to action.",
    capabilities: [
      "Production queue visibility for active repair work",
      "Workflow checkpoints for estimate review, supplement handling, and handoff",
      "Operational views that help teams see what needs attention next",
    ],
    assetRoots: ["shop_flow"],
  },
  "parts-app": {
    title: "Parts App",
    kicker: "Parts request and coordination system",
    description:
      "A parts-focused system for intake, requests, queue review, management visibility, and coordination between office, appraiser, and technician workflows.",
    capabilities: [
      "Parts request intake for multiple roles",
      "Queue and locator views for faster internal coordination",
      "Management views for tracking request volume and status",
    ],
    assetRoots: ["parts_app"],
  },
  "shop-hub": {
    title: "Shop Hub",
    kicker: "Bundled shop operating layer",
    description:
      "A bundled technical systems package that combines Shop-Flow and Parts App into a broader operating layer for shops that want both workflow and parts coordination in one path.",
    capabilities: [
      "Combined production and parts workflow visibility",
      "Shared operating rhythm across office, appraiser, production, and parts roles",
      "Launch path for tailored implementation and onboarding",
    ],
    assetRoots: ["shop_flow", "parts_app"],
  },
};

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov"]);

export function generateStaticParams() {
  return Object.keys(SYSTEM_PAGES).map((system) => ({ system }));
}

type PageProps = {
  params: Promise<{ system: string }>;
};

export default async function TechnicalSystemDetailPage({ params }: PageProps) {
  const { system } = await params;

  if (!isSystemSlug(system)) {
    notFound();
  }

  const page = SYSTEM_PAGES[system];
  const assets = discoverAssets(page.assetRoots);

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Link href="/technical-systems" className="text-sm font-semibold text-foreground">
            Collision IQ Technical Systems
          </Link>
          <Link href="/sign-up" className="rounded-2xl bg-[#C65A2A] px-4 py-2 text-sm font-semibold text-black transition hover:opacity-90">
            Start trial
          </Link>
        </div>
      </header>

      <section className="mx-auto max-w-6xl px-5 py-12">
        <div className="max-w-3xl">
          <div className="text-sm font-semibold uppercase tracking-[0.16em] text-[#C65A2A]">
            {page.kicker}
          </div>
          <h1 className="mt-4 text-4xl font-bold tracking-tight md:text-6xl">{page.title}</h1>
          <p className="mt-5 text-lg leading-8 text-muted-foreground">{page.description}</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link href="/technical-systems" className="rounded-2xl border border-border bg-card px-5 py-3 text-sm font-semibold text-foreground transition hover:bg-muted">
              Back to systems
            </Link>
            <Link href="/sign-up" className="rounded-2xl bg-[#C65A2A] px-5 py-3 text-sm font-semibold text-black transition hover:opacity-90">
              Contact / start trial
            </Link>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-5 px-5 pb-10 md:grid-cols-3">
        {page.capabilities.map((capability) => (
          <div key={capability} className="rounded-3xl border border-border bg-card p-5 text-sm leading-6 text-muted-foreground">
            {capability}
          </div>
        ))}
      </section>

      {assets.images.length > 0 || assets.videos.length > 0 ? (
        <section className="mx-auto max-w-6xl px-5 pb-16">
          <h2 className="text-2xl font-semibold">Product views</h2>
          {assets.videos.length > 0 ? (
            <div className="mt-6 grid gap-6 md:grid-cols-2">
              {assets.videos.map((asset) => (
                <video key={asset.src} controls className="aspect-video w-full rounded-3xl border border-border bg-black">
                  <source src={asset.src} />
                </video>
              ))}
            </div>
          ) : null}
          {assets.images.length > 0 ? (
            <div className="mt-6 grid gap-6 md:grid-cols-2">
              {assets.images.map((asset) => (
                <img
                  key={asset.src}
                  src={asset.src}
                  alt={asset.alt}
                  className="w-full rounded-3xl border border-border bg-card object-cover shadow-[0_18px_44px_rgba(15,23,42,0.08)]"
                />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
    </main>
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
      if (IMAGE_EXTENSIONS.has(ext) && images.length < 8) {
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
