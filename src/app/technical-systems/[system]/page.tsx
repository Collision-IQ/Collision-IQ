import Link from "next/link";
import { notFound } from "next/navigation";
import { ProductScreenshotFrame } from "@/components/technical-systems/ProductScreenshotFrame";
import { TechnicalSystemCheckoutButton } from "@/components/technical-systems/TechnicalSystemCheckoutButton";

export const dynamic = "force-dynamic";

type SystemSlug = "shop-flow" | "parts-app" | "shop-hub";
type SystemCheckoutPlan = "shop_flow" | "parts_app" | "shop_hub";

type ScreenshotAsset = {
  src: string;
  alt: string;
  title: string;
  caption: string;
  width: number;
  height: number;
  featured?: boolean;
};

type VideoAsset = {
  src: string;
  title: string;
};

type SystemPage = {
  title: string;
  kicker: string;
  description: string;
  checkoutPlan: SystemCheckoutPlan;
  capabilities: string[];
  screenshots: ScreenshotAsset[];
  videos: VideoAsset[];
};

const SHOP_FLOW_SCREENSHOTS: ScreenshotAsset[] = [
  {
    src: "/shop_flow/screenshots/production_page.png",
    alt: "Shop-Flow production management board",
    title: "Production management board",
    caption:
      "Shows the high-level production view teams use to track active repair work and handoffs.",
    width: 3425,
    height: 1271,
    featured: true,
  },
  {
    src: "/shop_flow/screenshots/shop_flow.png",
    alt: "Shop-Flow workflow dashboard",
    title: "Shop workflow dashboard",
    caption:
      "Shows how Shop-Flow keeps repair-stage visibility and operational attention in one place.",
    width: 1536,
    height: 1024,
  },
];

const PARTS_APP_SCREENSHOTS: ScreenshotAsset[] = [
  {
    src: "/parts_app/screenshots/parts_home.png",
    alt: "Parts App inventory home",
    title: "Parts inventory",
    caption:
      "Proves the parts workspace has a dedicated inventory entry point instead of a generic task list.",
    width: 1689,
    height: 1330,
    featured: true,
  },
  {
    src: "/parts_app/screenshots/parts_queue.png",
    alt: "Parts App request queue",
    title: "Parts request queue",
    caption:
      "Shows the shared queue where requests can be reviewed, prioritized, and advanced.",
    width: 1536,
    height: 1024,
    featured: true,
  },
  {
    src: "/parts_app/screenshots/tech_parts_request.png",
    alt: "Parts App technician parts request",
    title: "Tech parts request",
    caption:
      "Shows the technician request flow for capturing needed parts from the floor.",
    width: 1674,
    height: 1249,
  },
  {
    src: "/parts_app/screenshots/office_request.png",
    alt: "Parts App office parts request",
    title: "Office parts request",
    caption:
      "Shows the office-side request path for coordinating parts needs from administration.",
    width: 1674,
    height: 1249,
  },
  {
    src: "/parts_app/screenshots/appraiser_request.png",
    alt: "Parts App appraiser parts request",
    title: "Appraiser parts request",
    caption:
      "Shows the appraiser intake path for turning estimate review into a trackable parts request.",
    width: 1674,
    height: 1249,
  },
  {
    src: "/parts_app/screenshots/my_requests.png",
    alt: "Parts App active requests",
    title: "My active requests",
    caption:
      "Shows how individual users can track the requests they already opened.",
    width: 1674,
    height: 1249,
  },
  {
    src: "/parts_app/screenshots/work_queue.png",
    alt: "Parts App work queue",
    title: "My work queue",
    caption:
      "Shows the personal work queue that keeps each role focused on its next actions.",
    width: 1674,
    height: 1249,
  },
  {
    src: "/parts_app/screenshots/parts_locator.png",
    alt: "Parts App parts locator",
    title: "Parts locator",
    caption:
      "Shows the locator view that supports faster coordination when parts need to be found.",
    width: 1674,
    height: 1249,
  },
];

const SYSTEM_PAGES: Record<SystemSlug, SystemPage> = {
  "shop-flow": {
    title: "Shop-Flow",
    kicker: "Production workflow system",
    checkoutPlan: "shop_flow",
    description:
      "A workflow layer for repair centers that need cleaner handoffs, more consistent production visibility, and a clearer path from estimate review to action.",
    capabilities: [
      "Production queue visibility for active repair work",
      "Workflow checkpoints for estimate review, supplement handling, and handoff",
      "Operational views that help teams see what needs attention next",
    ],
    screenshots: SHOP_FLOW_SCREENSHOTS,
    videos: [
      { src: "/shop_flow/videos/home_video.mp4", title: "Shop-Flow home workflow" },
      { src: "/shop_flow/videos/production_video.mp4", title: "Shop-Flow production workflow" },
    ],
  },
  "parts-app": {
    title: "Parts App",
    kicker: "Parts request and coordination system",
    checkoutPlan: "parts_app",
    description:
      "A parts-focused system for intake, requests, queue review, management visibility, and coordination between office, appraiser, and technician workflows.",
    capabilities: [
      "Parts request intake for multiple roles",
      "Queue and locator views for faster internal coordination",
      "Management views for tracking request volume and status",
    ],
    screenshots: PARTS_APP_SCREENSHOTS,
    videos: [{ src: "/parts_app/videos/Office request video sample.mp4", title: "Office request sample" }],
  },
  "shop-hub": {
    title: "Shop Hub",
    kicker: "Bundled shop operating layer",
    checkoutPlan: "shop_hub",
    description:
      "A bundled technical systems package that combines Shop-Flow and Parts App into a broader operating layer for shops that want both workflow and parts coordination in one path.",
    capabilities: [
      "Combined production and parts workflow visibility",
      "Shared operating rhythm across office, appraiser, production, and parts roles",
      "Launch path for tailored implementation and onboarding",
    ],
    screenshots: [
      SHOP_FLOW_SCREENSHOTS[0],
      SHOP_FLOW_SCREENSHOTS[1],
      PARTS_APP_SCREENSHOTS[1],
      PARTS_APP_SCREENSHOTS[7],
      PARTS_APP_SCREENSHOTS[2],
      PARTS_APP_SCREENSHOTS[5],
    ],
    videos: [
      { src: "/shop_flow/videos/production_video.mp4", title: "Shop-Flow production workflow" },
      { src: "/parts_app/videos/Office request video sample.mp4", title: "Parts App office request sample" },
    ],
  },
};

type PageProps = {
  params: Promise<{ system: string }>;
};

export default async function TechnicalSystemDetailPage({ params }: PageProps) {
  const { system } = await params;

  if (!isSystemSlug(system)) {
    notFound();
  }

  const page = SYSTEM_PAGES[system];
  const featuredScreenshots = page.screenshots.filter((asset) => asset.featured);
  const supportingScreenshots = page.screenshots.filter((asset) => !asset.featured);

  return (
    <main className="ci-workstation min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Link href="/technical-systems" className="text-sm font-semibold text-foreground">
            Collision IQ Technical Systems
          </Link>
          <TechnicalSystemCheckoutButton
            plan={page.checkoutPlan}
            className="rounded-2xl bg-[#C65A2A] px-4 py-2 text-sm font-semibold text-black transition hover:opacity-90 disabled:opacity-60"
          >
            Start trial
          </TechnicalSystemCheckoutButton>
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
            <TechnicalSystemCheckoutButton
              plan={page.checkoutPlan}
              className="rounded-2xl bg-[#C65A2A] px-5 py-3 text-sm font-semibold text-black transition hover:opacity-90 disabled:opacity-60"
            >
              Contact / start trial
            </TechnicalSystemCheckoutButton>
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

      <section className="mx-auto max-w-6xl px-5 pb-16">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold">Product views</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Real workflow media selected for this product area, with screenshots used as proof points rather than a raw asset gallery.
            </p>
          </div>
        </div>

        {page.videos.length > 0 ? (
          <div className="mt-6 grid gap-6 md:grid-cols-2">
            {page.videos.map((asset) => (
              <figure key={asset.src} className="rounded-3xl border border-border bg-card p-3">
                <video controls className="aspect-video w-full rounded-xl border border-border bg-black">
                  <source src={asset.src} />
                </video>
                <figcaption className="mt-3 text-sm font-medium text-foreground">{asset.title}</figcaption>
              </figure>
            ))}
          </div>
        ) : null}

        {featuredScreenshots.length > 0 ? (
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            {featuredScreenshots.map((asset) => (
              <ProductScreenshotFrame key={asset.src} asset={asset} priority />
            ))}
          </div>
        ) : null}

        {supportingScreenshots.length > 0 ? (
          <div className="mt-6 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
            {supportingScreenshots.map((asset) => (
              <ProductScreenshotFrame key={`${asset.src}-${asset.title}`} asset={asset} compact />
            ))}
          </div>
        ) : null}
      </section>
    </main>
  );
}

function isSystemSlug(value: string): value is SystemSlug {
  return value in SYSTEM_PAGES;
}
