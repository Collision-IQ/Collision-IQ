/**
 * The Daily iQ — what Collision iQ learned, one numbered and sourced entry
 * per day.
 *
 * This is the publishing record behind "The Daily iQ" page (/daily-iq) and the
 * daily IG / TikTok / LinkedIn series (filed in marketing as KB-<day>.md). Each entry is filed the day the fact is
 * verified: the headline is the selected hook, the summary is the platform's
 * own wording, and every source is a public article or document reached by a
 * verified search result — never a licensed estimating guide (those are cited
 * by section, never linked; see `src/lib/ai/estimatingGuides.ts`).
 *
 * To publish a new day: append an entry, keep `entryNumber` sequential, and
 * point `image` at a 1080x1350 card under `public/daily-iq/`. The page renders
 * newest first and every source opens in a new tab.
 */

export type KnowledgeDailySourceKind = "primary" | "coverage" | "reference";

export type KnowledgeDailySource = {
  /** Headline of the article or document as published. */
  label: string;
  publisher: string;
  /** Absolute https URL. Opens in a new tab on the page. */
  url: string;
  kind: KnowledgeDailySourceKind;
};

export type KnowledgeDailyCategory =
  | "ADAS & calibration"
  | "OEM position statements"
  | "Insurance industry data"
  | "Total loss & valuation";

export type KnowledgeDailyEntry = {
  entryNumber: number;
  slug: string;
  /** ISO calendar date (YYYY-MM-DD) the entry was filed. */
  date: string;
  category: KnowledgeDailyCategory;
  headline: string;
  /** The one number or phrase the card leads with. */
  keyFigure: string;
  keyFigureLabel: string;
  /** Plain-English paragraphs, in the platform's own words. */
  summary: string[];
  whyItMatters: string;
  howCollisionIqUsesIt: string;
  sources: KnowledgeDailySource[];
  tags: string[];
  image: { src: string; alt: string };
};

const ENTRIES: KnowledgeDailyEntry[] = [
  {
    entryNumber: 1,
    slug: "calibration-lines-grew-31-4-percent",
    date: "2026-09-09",
    category: "ADAS & calibration",
    headline:
      "Calibration lines on repair estimates grew 31.4% in one year. “That's not necessary” didn't get the memo.",
    keyFigure: "31.4%",
    keyFigureLabel: "growth in estimates carrying a calibration line, 2025",
    summary: [
      "Per Enlyte's Envision Trends 2026 report (Enlyte is Mitchell's parent, the company whose software processes the claims), calibration lines on repairable estimates grew 31.4% in 2025, and calibrations per repair rose about 10%.",
      "Enlyte's own words: failure to identify and complete required calibrations “can compromise system performance and create financial and liability exposure for insurers and repairers.”",
    ],
    whyItMatters:
      "That is not a body shop talking. When the entity that processes the claims data says skipping calibrations is a liability exposure, “we don't pay for that” stops being a position and starts being a paper trail.",
    howCollisionIqUsesIt:
      "Filed the day it was verified. When a calibration line is questioned in an estimate review, the platform argues from the industry's own numbers, not from vibes.",
    sources: [
      {
        label: "Calibrations grew 31.4% in 2025, Mitchell data shows",
        publisher: "Repairer Driven News, Jun 4, 2026",
        url: "https://www.repairerdrivennews.com/2026/06/04/calibrations-grew-31-4-in-2025-mitchell-data-shows/",
        kind: "coverage",
      },
      {
        label: "Enlyte Envision Trends Report 2026",
        publisher: "Enlyte",
        url: "https://www.enlyte.com/enlyte-envision-trends-report-2026",
        kind: "primary",
      },
      {
        label: "Calibrations and Parts Inflation Drive Collision Claim Complexity",
        publisher: "CollisionWeek, Jun 2, 2026",
        url: "https://collisionweek.com/2026/06/02/calibrations-parts-inflation-drive-collision-claim-complexity/",
        kind: "coverage",
      },
      {
        label: "Enlyte's 2026 Envision Trends Report Explores Forces Driving Claim Complexity",
        publisher: "BodyShop Business",
        url: "https://www.bodyshopbusiness.com/enlytes-2026-envision-trends-report-explores-forces-driving-claim-complexity/",
        kind: "coverage",
      },
    ],
    tags: ["adas", "calibration", "collisionrepair", "autoclaims", "carinsurance"],
    image: {
      src: "/daily-iq/kb-001-calibration-lines.png",
      alt: "The Daily iQ entry 1 card: 31.4% growth in calibration lines on estimates in 2025, per Enlyte Envision Trends 2026.",
    },
  },
  {
    entryNumber: 2,
    slug: "ford-officially-mandates-adas-standards",
    date: "2026-09-10",
    category: "OEM position statements",
    headline: "Ford stopped “recommending.” It now officially mandates.",
    keyFigure: "“Mandates”",
    keyFigureLabel: "the verb in Ford/Lincoln's May 1, 2026 ADAS position statement",
    summary: [
      "Ford/Lincoln's updated ADAS position statement (May 1, 2026) uses language you rarely see from an OEM: Ford “officially mandates adherence to these standards to ensure the vehicle is restored to the high safety standards to which it was originally manufactured.”",
      "What that covers: pre- and post-repair diagnostic scans on any damaged vehicle, ADAS calibrations performed to Ford's own workshop procedures, and a flat prohibition on recycled, salvaged, or aftermarket ADAS sensors. Unapproved windshields and even window tint near a camera make the list, because a distorted camera view can mean unintended braking.",
    ],
    whyItMatters:
      "Position statements are where repair disputes get decided on paper. When the OEM's verb is “mandates,” an adjuster's “not required” carries the burden of proof.",
    howCollisionIqUsesIt:
      "Filed, cited, and ready to be quoted in dispute documentation. If a repair plan on a Ford gets pushback, this document is the answer key.",
    sources: [
      {
        label: "Collision Position Statement: ADAS Integrity and Technical Imperatives (May 1, 2026)",
        publisher: "Ford Motor Company via OEM1Stop",
        url: "https://www.oem1stop.com/sites/default/files/Collision%20Position%20Statement%20ADAS%20Integrity%20and%20Technical%20ImperativesPDF5.1.26.pdf",
        kind: "primary",
      },
      {
        label: "Ford, Lincoln ‘mandate’ standards in updated ADAS position statement",
        publisher: "Repairer Driven News, May 18, 2026",
        url: "https://www.repairerdrivennews.com/2026/05/18/ford-lincoln-mandate-standards-in-updated-adas-position-statement/",
        kind: "coverage",
      },
      {
        label: "Ford ADAS — OEM information",
        publisher: "I-CAR Repairability Technical Support",
        url: "https://rts.i-car.com/oem-information/ford/ford-adas.html",
        kind: "reference",
      },
      {
        label: "Ford Crash Parts position statements",
        publisher: "Ford Crash Parts",
        url: "https://fordcrashparts.com/position-statements/",
        kind: "reference",
      },
    ],
    tags: ["ford", "oemprocedures", "adas", "collisionrepair", "autoclaims"],
    image: {
      src: "/daily-iq/kb-002-ford-mandates.png",
      alt: "The Daily iQ entry 2 card: Ford officially mandates pre- and post-repair scans, OEM calibrations, and no used or aftermarket ADAS sensors.",
    },
  },
  {
    entryNumber: 3,
    slug: "iihs-hldi-crash-avoidance-repair-costs",
    date: "2026-09-11",
    category: "Insurance industry data",
    headline:
      "“Crash avoidance systems raise the cost of the repairs they fail to prevent.” That is the insurance industry's own research institute.",
    keyFigure: "Lower",
    keyFigureLabel: "overall insurance losses on sensor-equipped vehicles, even as each repair costs more",
    summary: [
      "Matt Moore, Chief Insurance Operations Officer at IIHS-HLDI, the insurance industry's own research institute, put the ADAS cost debate in one sentence: “Crash avoidance systems raise the cost of the repairs they fail to prevent.”",
      "HLDI's data shows sensor-equipped vehicles carry higher claim severity (all those cameras and calibrations) and sharply lower claim frequency. The aggregate: lower overall insurance losses, even as individual repair bills climb.",
    ],
    whyItMatters:
      "Severity pressure lands on one claim file at a time, yours, while the frequency savings accrue quietly across the carrier's whole book. A complete, calibrated repair is not what is driving loss ratios. The industry's own institute says so.",
    howCollisionIqUsesIt:
      "The platform carries this framing wherever repair-cost pushback shows up. No per-claim dollar figures were disclosed in the coverage, so none are quoted here.",
    sources: [
      {
        label: "IIHS-HLDI's Moore Says Crash Avoidance Systems Lower Overall Losses Even as Repair Costs Climb",
        publisher: "CollisionWeek, Aug 11, 2026",
        url: "https://collisionweek.com/2026/08/11/iihs-hldis-moore-says-crash-avoidance-systems-lower-overall-losses-even-repair-costs-climb/",
        kind: "coverage",
      },
      {
        label: "How crash avoidance tech simultaneously raises and slashes repair costs",
        publisher: "IIHS-HLDI",
        url: "https://www.iihs.org/news/detail/how-crash-avoidance-tech-simultaneously-raises-and-slashes-repair-costs",
        kind: "primary",
      },
      {
        label: "IIHS-HLDI: ADAS features are expensive but they likely are saving drivers money",
        publisher: "Repairer Driven News, Aug 17, 2026",
        url: "https://www.repairerdrivennews.com/2026/08/17/iihs-hldi-adas-features-are-expensive-but-they-likely-are-saving-drivers-money/",
        kind: "coverage",
      },
    ],
    tags: ["adas", "carinsurance", "collisionrepair", "autoclaims", "iihs"],
    image: {
      src: "/daily-iq/kb-003-iihs-hldi.png",
      alt: "The Daily iQ entry 3 card: crash avoidance systems raise per-repair cost but lower overall insurance losses, per IIHS-HLDI.",
    },
  },
  {
    entryNumber: 4,
    slug: "chadwick-v-state-farm-typical-negotiation-adjustment",
    date: "2026-09-12",
    category: "Total loss & valuation",
    headline: "One invisible line on total-loss valuations just cost an insurer $15.58 million.",
    keyFigure: "$15.58M",
    keyFigureLabel: "settlement over “typical negotiation adjustments” on Arkansas total-loss valuations",
    summary: [
      "Chadwick v. State Farm (U.S. District Court, Eastern District of Arkansas) challenged valuation reports that applied a “typical negotiation adjustment,” a downward tweak to the comparable vehicles used to value totaled cars. Plaintiffs argued the adjustment had no observable market data behind it. Accepted appraisal standards require exactly that support.",
      "State Farm settled for $15.58 million covering Arkansas first-party total-loss claims from November 2016 to October 2021. Preliminary approval was granted March 27, 2026. The insurer denied liability; the case settled and no finding of liability was made.",
    ],
    whyItMatters:
      "Total-loss valuations are documents, and documents can be audited. Every adjustment either has market support or it does not, and “typical negotiation” is not a market observation. If your car was totaled, read the valuation report and ask for the data behind every adjustment.",
    howCollisionIqUsesIt:
      "This is precisely the audit Collision iQ runs on valuation and estimate documents: find the line, demand the data behind it.",
    sources: [
      {
        label: "State Farm Reaches $15.58M Settlement in Arkansas Total Loss Valuation Case",
        publisher: "BodyShop Business",
        url: "https://www.bodyshopbusiness.com/state-farm-reaches-15-58m-settlement-in-arkansas-total-loss-valuation-case/",
        kind: "coverage",
      },
      {
        label: "State Farm Agrees to $15M Settlement for Underpaid Vehicle Claims",
        publisher: "Insurance Journal, May 2026",
        url: "https://www.insurancejournal.com/magazines/mag-features/2026/05/04/868030.htm",
        kind: "coverage",
      },
      {
        label: "State Farm to settle Arkansas actual cash value lawsuit for $15.6 million",
        publisher: "Repairer Driven News, Apr 13, 2026",
        url: "https://www.repairerdrivennews.com/2026/04/13/state-farm-to-settle-arkansas-actual-cash-value-lawsuit-for-15-6-million/",
        kind: "coverage",
      },
    ],
    tags: ["totalloss", "carinsurance", "autoclaims", "knowyourrights", "diminishedvalue"],
    image: {
      src: "/daily-iq/kb-004-chadwick-state-farm.png",
      alt: "The Daily iQ entry 4 card: $15.58 million State Farm settlement over typical negotiation adjustments on total-loss valuations.",
    },
  },
];

/** Entries newest first — the order the page publishes them. */
export function getKnowledgeDailyEntries(): KnowledgeDailyEntry[] {
  return [...ENTRIES].sort((a, b) => (a.date === b.date ? b.entryNumber - a.entryNumber : b.date.localeCompare(a.date)));
}

export function getKnowledgeDailyEntry(slug: string): KnowledgeDailyEntry | null {
  return ENTRIES.find((entry) => entry.slug === slug) ?? null;
}

export function formatKnowledgeDailyDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
