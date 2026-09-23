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
  | "Total loss & valuation"
  | "Law & regulation"
  | "Repair economics";

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
  /**
   * Optional source line printed on the card. Defaults to the sources'
   * publishers joined with semicolons (see scripts/daily-iq/render-cards.mjs).
   */
  cardSource?: string;
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
  {
    entryNumber: 5,
    slug: "total-loss-frequency-record-23-1-percent",
    date: "2026-09-14",
    category: "Insurance industry data",
    headline: "23.1% of crashed cars never came back. That's a record.",
    keyFigure: "23.1%",
    keyFigureLabel: "of 2025 auto claims ended in a total loss, the highest rate the industry has recorded",
    summary: [
      "In 2025, 23.1% of auto claims ended in a total loss, the highest rate on record, according to CCC Intelligent Solutions' Crash Course 2026 report, released March 31, 2026. Pricier parts, sensor-packed bumpers, and softer used-car values tip the math to “total” earlier than most owners expect.",
      "The same report counts calibrations on 28.3% of repairable estimates: the car that is still worth fixing now needs its cameras taught where to look before it leaves the shop.",
    ],
    whyItMatters:
      "A total-loss decision is a valuation, and a valuation is a document. When one in four claims ends there, the comparables and adjustments behind that number decide what you drive next.",
    howCollisionIqUsesIt:
      "Filed into the knowledge base as the baseline for how often a claim becomes a valuation dispute rather than a repair dispute.",
    sources: [
      {
        label: "CCC Crash Course 2026 Report Finds Higher Severity and Record Total Loss Frequency",
        publisher: "GlobeNewswire (CCC Intelligent Solutions release), Mar 31, 2026",
        url: "https://www.globenewswire.com/news-release/2026/03/31/3265423/0/en/CCC-Crash-Course-2026-Report-Finds-Higher-Severity-and-Record-Total-Loss-Frequency.html",
        kind: "primary",
      },
      {
        label: "CCC Crash Course Report: Collision Repair Industry Showing Signs of Stabilization",
        publisher: "Autobody News",
        url: "https://www.autobodynews.com/news/ccc-crash-course-report-collision-repair-industry-showing-signs-of-stabilization",
        kind: "coverage",
      },
    ],
    tags: ["totalloss", "collisionrepair", "autoclaims", "carinsurance", "autoindustry"],
    image: {
      src: "/daily-iq/kb-005-total-loss-record.png",
      alt: "The Daily iQ entry 5 card: 23.1% of 2025 auto claims ended in a total loss, a record.",
    },
    cardSource: "Source: CCC Crash Course 2026, released Mar 31, 2026.",
  },
  {
    entryNumber: 6,
    slug: "ev-repair-gap-record-low-729",
    date: "2026-09-15",
    category: "Repair economics",
    headline: "Fixing an EV now costs $729 more than fixing a gas car. It used to be much worse.",
    keyFigure: "$729",
    keyFigureLabel: "gap between average repairable claim severity for battery-electric and gas vehicles, a record low",
    summary: [
      "Average repairable claim severity last quarter in the U.S.: $5,684 for battery-electric vehicles against $4,955 for gas vehicles, per Mitchell's “Plugged-In: EV Collision Insights” Q2 2026 report, published August 20, 2026. The gap, once the industry's favorite scare number, is the smallest on record.",
      "Two reasons it is closing: the EV fleet is aging into ordinary repairs, and the worst-hit EVs increasingly total out instead of pulling the repair average up.",
    ],
    whyItMatters:
      "The “EVs cost a fortune to fix” argument is used on both sides of a claim. The current number is $729, and it is shrinking. Any estimate or valuation that leans on the old gap is leaning on last year's data.",
    howCollisionIqUsesIt:
      "Filed into the knowledge base as the current benchmark for EV versus gas repair severity, dated so it can be superseded next quarter.",
    sources: [
      {
        label: "Plugged-In: EV Collision Insights Q2 2026",
        publisher: "Mitchell",
        url: "https://www.mitchell.com/insights/article/auto-physical-damage/plugged-in-ev-collision-insights-q2-2026",
        kind: "primary",
      },
      {
        label: "Mitchell: Gap in average repairable claims severity between BEVs, ICE vehicles",
        publisher: "Repairer Driven News, Aug 21, 2026",
        url: "https://www.repairerdrivennews.com/2026/08/21/mitchell-gap-in-average-repairable-claims-severity-between-bevs-ice-vehicles/",
        kind: "coverage",
      },
    ],
    tags: ["evrepair", "electricvehicles", "collisionrepair", "autoclaims", "teslarepair"],
    image: {
      src: "/daily-iq/kb-006-ev-repair-gap.png",
      alt: "The Daily iQ entry 6 card: $729 gap between EV and gas repairable claim severity, a record low.",
    },
    cardSource: "Source: Mitchell, Plugged-In Q2 2026, Aug 20, 2026; Repairer Driven News.",
  },
  {
    entryNumber: 7,
    slug: "posted-body-labor-rate-86-mechanical-163",
    date: "2026-09-16",
    category: "Repair economics",
    headline: "The posted body rate hit $86 an hour. The one on your estimate probably didn't.",
    keyFigure: "$86/hr",
    keyFigureLabel: "national average posted body labor rate, June 2026, up 6.2% in a year; mechanical reached $163/hr",
    summary: [
      "National average posted labor rates for June 2026, per National AutoBody Research's Labor Rate Index: body $86 an hour, up 6.2% in a year, and mechanical $163 an hour, up 11.6% from $146, climbing nearly twice as fast as body work. The figures come from NABR's LaborRateHero platform, reported by Autobody News.",
      "“Posted” is what shops charge. What an insurer's estimate pays is often a different number, and the space between those two rates, multiplied by every labor hour on the file, is where many repair disputes actually live.",
    ],
    whyItMatters:
      "A labor rate is one number that touches every line of an estimate. When the posted rate and the paid rate differ, the difference is not a rounding error; it compounds across the whole repair.",
    howCollisionIqUsesIt:
      "Filed into the knowledge base as the dated national posted-rate reference for reading the rate line on an estimate.",
    sources: [
      {
        label: "Labor Rate Index: National Data Shows Mechanical Labor Rates Rising Faster Than Body, Refinish",
        publisher: "Autobody News",
        url: "https://www.autobodynews.com/news/labor-rate-index-national-data-shows-mechanical-labor-rates-rising-faster-than-body-refinish",
        kind: "coverage",
      },
      {
        label: "LaborRateHero",
        publisher: "National AutoBody Research",
        url: "https://www.nationalautobodyresearch.com/laborratehero.html",
        kind: "reference",
      },
    ],
    tags: ["laborrates", "collisionrepair", "autobody", "bodyshop", "insuranceclaim"],
    image: {
      src: "/daily-iq/kb-007-posted-labor-rates.png",
      alt: "The Daily iQ entry 7 card: national average posted body labor rate of $86 an hour in June 2026.",
    },
    cardSource: "Source: National AutoBody Research Labor Rate Index (June 2026 data), via Autobody News.",
  },
  {
    entryNumber: 8,
    slug: "illinois-hb-4160-appraisal-clause-senate-56-2",
    date: "2026-09-17",
    category: "Law & regulation",
    headline: "Illinois just voted 56–2 to put an appraisal clause in every auto policy.",
    keyFigure: "56–2",
    keyFigureLabel: "Illinois Senate vote on HB 4160, the right-to-appraisal bill, May 28, 2026",
    summary: [
      "HB 4160 passed the Illinois Senate 56–2 on May 28, 2026, and the House concurred 115–0 on May 31. As passed, every auto policy with first-party physical damage coverage issued or renewed from July 1, 2027 must let either the insured, without the insurer's consent, or the insurer invoke appraisal when the amount of a loss is disputed. Each side pays its own appraiser; the umpire's cost is split.",
      "Why it matters beyond Illinois: the clause that already resolves disputes quietly in most policies is being written into statute, with a process attached. Legislators noticed what it does.",
    ],
    whyItMatters:
      "Appraisal is the one dispute mechanism that ends in a binding number without a lawsuit. When a legislature makes it mandatory, it is confirming that the mechanism works.",
    howCollisionIqUsesIt:
      "Filed into the knowledge base alongside the appraisal-clause references Collision iQ cites when a valuation or repair-cost dispute stalls.",
    sources: [
      {
        label: "Amended Illinois right-to-appraisal bill passed by Senate",
        publisher: "Repairer Driven News, May 29, 2026",
        url: "https://www.repairerdrivennews.com/2026/05/29/amended-illinois-right-to-appraisal-bill-passed-by-senate-insurance-committee/",
        kind: "coverage",
      },
      {
        label: "Illinois Right-to-Appraisal Bill Heads to Pritzker's Desk in Narrowed Form",
        publisher: "Autobody News",
        url: "https://www.autobodynews.com/news/illinois-right-to-appraisal-bill-heads-to-pritzkers-desk-in-narrowed-form",
        kind: "coverage",
      },
      {
        label: "Bill Status of HB4160, 104th General Assembly",
        publisher: "Illinois General Assembly",
        url: "https://www.ilga.gov/Legislation/BillStatus?GAID=18&DocNum=4160&DocTypeID=HB&LegId=164381&SessionID=114",
        kind: "reference",
      },
    ],
    tags: ["appraisalclause", "insuranceclaim", "knowyourrights", "autoinsurance", "illinois"],
    image: {
      src: "/daily-iq/kb-008-illinois-appraisal-bill.png",
      alt: "The Daily iQ entry 8 card: Illinois Senate votes 56 to 2 for HB 4160, mandatory appraisal clause in auto policies.",
    },
    cardSource: "Source: Repairer Driven News, May 29, 2026; Illinois General Assembly, HB 4160.",
  },
  {
    entryNumber: 9,
    slug: "destructive-weld-testing-paid-1-in-4",
    date: "2026-09-18",
    category: "Repair economics",
    headline: "Only 1 in 4 shops gets paid for testing the welds that hold your car together.",
    keyFigure: "1 in 4",
    keyFigureLabel: "shops that negotiate for destructive weld testing are paid always or most of the time, down from 37% two years ago",
    summary: [
      "Before welding structural parts on your car, a technician is supposed to weld test coupons of the same steel and tear them apart to prove the settings hold. In the 2026 “Who Pays for What?” Frame & Mechanical survey by Collision Advice and CRASH Network, run through April 2026 with 473 shops in 49 states responding, only 25% of shops that negotiate for that step are paid always or most of the time, down from 37% two years ago. The share saying insurers never pay for it rose from 32% to 44%.",
      "A required test, performed on your car's structure, that usually goes unpaid. That is the state of “not included.”",
    ],
    whyItMatters:
      "A weld test is not an upsell; it is how a shop proves the welds on your structure will hold. When it goes unpaid, the pressure is to skip it, and a skipped test does not show up at delivery.",
    howCollisionIqUsesIt:
      "Filed into the knowledge base as the dated reimbursement benchmark for destructive weld testing, so a missing test line is flagged as a required step, not an extra.",
    sources: [
      {
        label: "“Who Pays for What?” Survey: Destructive Weld Testing Is the Non-Negotiable Procedure Most Shops Still Aren't Paid For",
        publisher: "Autobody News",
        url: "https://www.autobodynews.com/regional/midwest-regional-news/who-pays-for-what-survey-destructive-weld-testing-is-the-non-negotiable-procedure-most-shops-still-arent-paid-for",
        kind: "coverage",
      },
      {
        label: "Survey: 44% of Shops Say Insurers Never Pay for Destructive Weld Testing",
        publisher: "BodyShop Business",
        url: "https://www.bodyshopbusiness.com/more-shops-billing-for-destructive-weld-testing-but-fewer-being-paid-regularly-according-to-who-pays-for-what-survey-latest-survey-open-now/",
        kind: "coverage",
      },
    ],
    tags: ["collisionrepair", "welding", "autobody", "carsafety", "insuranceclaim"],
    image: {
      src: "/daily-iq/kb-009-weld-test-pay.png",
      alt: "The Daily iQ entry 9 card: only 1 in 4 shops is paid for destructive weld testing.",
    },
    cardSource: "Source: Collision Advice / CRASH Network “Who Pays for What?” 2026, via Autobody News and BodyShop Business.",
  },
  {
    entryNumber: 10,
    slug: "gm-position-statements-strictly-prohibited",
    date: "2026-09-19",
    category: "OEM position statements",
    headline: "GM stopped saying “not recommended.” It now says “strictly prohibited.”",
    keyFigure: "Prohibited",
    keyFigureLabel: "GM's word for salvage, reconditioned, remanufactured and aftermarket ADAS sensors, and aftermarket fascias on ADAS-equipped vehicles",
    summary: [
      "GM rewrote its collision position statements, reported July 30, 2026. The ADAS statement, dated June 2, 2026, limits repairs to new GM Genuine radars, cameras, sensors, modules and related components and calls salvaged, recycled, reconditioned, remanufactured, aftermarket and other secondary-market ADAS parts “not approved and strictly prohibited.” A March version had said “not recommended”; an April 23 revision said “not approved.” A companion statement strictly prohibits aftermarket, reconditioned or salvage bumper fascias on ADAS-equipped GM vehicles.",
      "A position statement is not a law. It is the manufacturer's written answer to “what does this repair require,” and it is what a line-by-line dispute gets measured against.",
    ],
    whyItMatters:
      "One word changed, and every estimate on a GM vehicle with a radar behind the bumper feels it. A part choice that used to be “discouraged” is now in writing as prohibited by the company that built the car.",
    howCollisionIqUsesIt:
      "Filed into the knowledge base as an OEM position statement, cited by date, so a used or aftermarket sensor line on a GM estimate is checked against the manufacturer's own wording.",
    sources: [
      {
        label: "GM revises position statements to add ‘strictly prohibits’ language",
        publisher: "Repairer Driven News, Jul 30, 2026",
        url: "https://www.repairerdrivennews.com/2026/07/30/gm-revises-position-statements-to-add-strictly-prohibits-language/",
        kind: "coverage",
      },
      {
        label: "GM Rewrites ADAS Position Statement to Prohibit Salvaged and Aftermarket Sensors",
        publisher: "CollisionWeek, Jul 30, 2026",
        url: "https://collisionweek.com/2026/07/30/gm-rewrites-adas-position-statement-prohibit-salvaged-aftermarket-sensors/",
        kind: "coverage",
      },
      {
        label: "GM Strengthens OEM Parts Policy With Stricter Statements",
        publisher: "GM Authority, Jul 2026",
        url: "https://gmauthority.com/blog/2026/07/gm-strengthens-oem-parts-policy-with-stricter-repair-position-statements/",
        kind: "coverage",
      },
    ],
    tags: ["gm", "collisionrepair", "adas", "oemparts", "insuranceclaim"],
    image: {
      src: "/daily-iq/kb-010-gm-strictly-prohibited.png",
      alt: "The Daily iQ entry 10 card: GM position statements now say strictly prohibited for salvage and aftermarket ADAS sensors.",
    },
    cardSource: "Source: GM position statements dated Jun 2, 2026, via Repairer Driven News and CollisionWeek, Jul 30, 2026.",
  },
  {
    entryNumber: 11,
    slug: "texas-right-to-appraisal-notice-every-renewal",
    date: "2026-09-21",
    category: "Law & regulation",
    headline: "Texas is about to tell every driver about appraisal. At every renewal.",
    keyFigure: "Every renewal",
    keyFigureLabel: "Texas auto insurers must disclose the right to appraisal at issuance and renewal from January 1, 2027",
    summary: [
      "The Texas Department of Insurance has adopted amendments to the state's Auto Bill of Rights that add a notice of “the right to request appraisal to resolve disputes about loss amounts.” Every Texas auto insurer must give it at policy issuance and at every renewal, starting January 1, 2027, two months later than the November 1, 2026 date TDI proposed on May 1, 2026.",
      "The rule implements Senate Bill 458, which wrote a mandatory appraisal right into Insurance Code Chapter 1813 and took effect September 1, 2025. For years the appraisal clause worked mostly for the people who already knew it existed. A notice at every renewal changes who that is.",
    ],
    whyItMatters:
      "The appraisal clause is only useful to a policyholder who knows it is there. Printing it on every renewal turns a fine-print right into common knowledge.",
    howCollisionIqUsesIt:
      "Filed into the knowledge base with the Texas appraisal references Collision iQ cites, updated from the proposed rule to the adopted one.",
    sources: [
      {
        label: "TDI approves consumer Auto Bill of Rights updates to include mandatory right to appraisal",
        publisher: "Repairer Driven News, Sep 21, 2026",
        url: "https://www.repairerdrivennews.com/2026/09/21/tdi-approves-consumer-auto-bill-of-rights-updates-to-include-mandatory-right-to-appraisal/",
        kind: "coverage",
      },
      {
        label: "Texas Pushes Back Deadline for New Right-to-Appraisal Disclosure to 2027",
        publisher: "Autobody News",
        url: "https://www.autobodynews.com/regional/midwest-regional-news/texas-pushes-back-deadline-for-new-right-to-appraisal-disclosure-to-2027",
        kind: "coverage",
      },
      {
        label: "Texas Auto Policyholders Set to Receive Right to Appraisal Notice at Every Renewal Under Proposed TDI Rule",
        publisher: "Autobody News, May 2026",
        url: "https://www.autobodynews.com/news/texas-auto-policyholders-set-to-receive-right-to-appraisal-notice-at-every-renewal-under-proposed-tdi-rule",
        kind: "coverage",
      },
    ],
    tags: ["righttoappraisal", "texasinsurance", "autoinsurance", "insuranceclaim", "knowyourrights"],
    image: {
      src: "/daily-iq/kb-011-texas-appraisal-notice.png",
      alt: "The Daily iQ entry 11 card: Texas auto insurers must disclose the right to appraisal at every renewal from January 1, 2027.",
    },
    cardSource: "Source: Texas Department of Insurance adopted rule, via Repairer Driven News, Sep 21, 2026.",
  },
  {
    entryNumber: 12,
    slug: "adas-lawsuits-3-to-61",
    date: "2026-09-22",
    category: "ADAS & calibration",
    headline: "ADAS lawsuits: 3 in 2018. 61 in 2024.",
    keyFigure: "3 → 61",
    keyFigureLabel: "lawsuits tied to advanced driver-assistance systems, 2018 to 2024, per a Revv analysis",
    summary: [
      "Lawsuits tied to advanced driver-assistance systems, the cameras and radars that brake and steer for you, grew from 3 cases in 2018 to 61 in 2024, with typical settlements and judgments running $200,000 to more than $1 million, according to an analysis by calibration platform Revv reported by Autobody News on December 31, 2025.",
      "When a required calibration is skipped after a repair, the miss does not show up at delivery. It shows up later, at speed, and then in a filing. That is why the calibration line on an estimate is a safety line, not padding.",
    ],
    whyItMatters:
      "A calibration that is not on the estimate is a calibration that was probably not done. The cost of the line is small; the cost of the miss is now measured in six and seven figures.",
    howCollisionIqUsesIt:
      "Filed into the knowledge base as the liability context behind every missing-calibration flag Collision iQ raises.",
    sources: [
      {
        label: "2025 Data Points to Fewer Claims, More Collision Repair Complexity in 2026",
        publisher: "Autobody News, Dec 31, 2025",
        url: "https://www.autobodynews.com/news/2025-data-points-to-fewer-claims-more-collision-repair-complexity-in-2026",
        kind: "coverage",
      },
      {
        label: "Revv: ADAS calibration now ‘core repair function’",
        publisher: "Repairer Driven News, Dec 18, 2025",
        url: "https://www.repairerdrivennews.com/2025/12/18/revv-adas-calibration-now-core-repair-function/",
        kind: "coverage",
      },
    ],
    tags: ["adascalibration", "carsafety", "collisionrepair", "insuranceclaim", "adas"],
    image: {
      src: "/daily-iq/kb-012-adas-lawsuits.png",
      alt: "The Daily iQ entry 12 card: ADAS lawsuits grew from 3 in 2018 to 61 in 2024.",
    },
    cardSource: "Source: Revv analysis, via Autobody News, Dec 31, 2025.",
  },
  {
    entryNumber: 13,
    slug: "oem-parts-44-percent-made-overseas",
    date: "2026-09-23",
    category: "Repair economics",
    headline: "44% of the OEM parts on American estimates weren't made in America.",
    keyFigure: "44%",
    keyFigureLabel: "of OEM collision parts sold in the U.S. are manufactured overseas, per PartsTrader; tariffs add about $100 to an average repair order",
    summary: [
      "Per parts-procurement platform PartsTrader, 44% of OEM collision parts sold in the U.S. are manufactured overseas, and 2025's tariffs added roughly $100 to the parts line of an average repair order, passed through supplier pricing, as reported by Autobody News on December 31, 2025.",
      "A hundred dollars does not sound like much until you remember how estimates die: not in one big cut, but a hundred dollars at a time. When parts prices move and the estimate does not, the difference has to come from somewhere, usually the lines that are easiest not to write.",
    ],
    whyItMatters:
      "Parts prices are not static between the first estimate and the supplement. A parts line written months ago may no longer buy the part it names.",
    howCollisionIqUsesIt:
      "Filed into the knowledge base as the dated context for reading parts pricing on an estimate against current supplier pricing.",
    sources: [
      {
        label: "2025 Data Points to Fewer Claims, More Collision Repair Complexity in 2026",
        publisher: "Autobody News, Dec 31, 2025",
        url: "https://www.autobodynews.com/news/2025-data-points-to-fewer-claims-more-collision-repair-complexity-in-2026",
        kind: "coverage",
      },
      {
        label: "Tariff Expansion Could Hit 44% of Collision Parts Sold in U.S.",
        publisher: "Autobody News",
        url: "https://www.autobodynews.com/news/tariff-expansion-could-hit-44-of-collision-parts-sold-in-u-s",
        kind: "coverage",
      },
      {
        label: "Update: Tariffs and the Increased Cost of Repair Parts",
        publisher: "PartsTrader",
        url: "https://www.partstrader.com/update-tariffs-and-the-increased-cost-of-repair-parts/",
        kind: "primary",
      },
    ],
    tags: ["oemparts", "collisionrepair", "autoparts", "carinsurance", "autoindustry"],
    image: {
      src: "/daily-iq/kb-013-oem-parts-overseas.png",
      alt: "The Daily iQ entry 13 card: 44% of OEM collision parts sold in the U.S. are made overseas.",
    },
    cardSource: "Source: PartsTrader, via Autobody News, Dec 31, 2025.",
  },
  {
    entryNumber: 14,
    slug: "small-repairable-claims-41-5-to-25-5-percent",
    date: "2026-09-24",
    category: "Insurance industry data",
    headline: "The fender-bender is disappearing. Small claims fell from 41.5% to 25.5%.",
    keyFigure: "41.5% → 25.5%",
    keyFigureLabel: "share of repairable appraisals for damage of $2,000 or less, 2019 to mid-2025, per CCC",
    summary: [
      "In 2019, 41.5% of repairable appraisals were for damage of $2,000 or less. By mid-2025 that share had fallen to 25.5%, and repairable claims overall dropped 10.4% year over year through August 2025, per CCC Intelligent Solutions data reported by Autobody News on December 31, 2025. The same report notes 26% of auto insurance customers now carry deductibles of $1,000 or more.",
      "Two things are happening at once: bumpers full of sensors turned small hits into big estimates, and owners with high deductibles stopped filing for the hits that stayed small. What is left in the system is the expensive, complicated claim, exactly the kind where a missing line costs the most.",
    ],
    whyItMatters:
      "If nearly every claim that gets filed is now a large one, every claim is worth reading line by line. The cheap claim that did not need scrutiny is the one that is going extinct.",
    howCollisionIqUsesIt:
      "Filed into the knowledge base as the claims-mix context for why estimate review matters on the claims that still get filed.",
    sources: [
      {
        label: "2025 Data Points to Fewer Claims, More Collision Repair Complexity in 2026",
        publisher: "Autobody News, Dec 31, 2025",
        url: "https://www.autobodynews.com/news/2025-data-points-to-fewer-claims-more-collision-repair-complexity-in-2026",
        kind: "coverage",
      },
    ],
    tags: ["carinsurance", "insuranceclaim", "collisionrepair", "autoclaims", "deductible"],
    image: {
      src: "/daily-iq/kb-014-small-claims-vanish.png",
      alt: "The Daily iQ entry 14 card: repairable appraisals of $2,000 or less fell from 41.5% in 2019 to 25.5% in mid-2025.",
    },
    cardSource: "Source: CCC Intelligent Solutions data, via Autobody News, Dec 31, 2025.",
  },
  {
    entryNumber: 15,
    slug: "illinois-right-to-appraisal-signed-into-law",
    date: "2026-09-25",
    category: "Law & regulation",
    headline: "Update to Entry #8: Illinois signed it. Right to appraisal is now law.",
    keyFigure: "Signed",
    keyFigureLabel: "HB 4160 became Public Act 104-0767 on August 7, 2026; mandatory appraisal provisions from July 1, 2027",
    summary: [
      "When this knowledge base filed Entry #8, HB 4160 was a bill moving through the Illinois legislature. On August 7, 2026, Governor Pritzker signed it. Now Public Act 104-0767, it adds a new Section 398 to the Illinois Insurance Code: starting July 1, 2027, policies carrying first-party auto physical damage coverage must include an appraisal provision that either the insured, at the insured's sole discretion, or the insurer can invoke when the amount of a loss is disputed.",
      "That is two states this year, Illinois writing the clause into every policy and Texas printing the right on every renewal, moving the appraisal clause from fine print toward common knowledge. It is also what a knowledge base is for: the entries keep growing after they are filed.",
    ],
    whyItMatters:
      "A bill can stall; a signed act has a date. From July 1, 2027, an Illinois policyholder who disputes a valuation has a binding path to a number without a courtroom.",
    howCollisionIqUsesIt:
      "Filed into the knowledge base as the successor to Entry #8, so the Illinois appraisal reference Collision iQ cites reads the enacted statute, not the bill.",
    sources: [
      {
        label: "Illinois Governor Signs Auto Insurance Right to Appraisal Law",
        publisher: "CollisionWeek, Aug 17, 2026",
        url: "https://collisionweek.com/2026/08/17/illinois-governor-signs-auto-insurance-right-appraisal-law/",
        kind: "coverage",
      },
      {
        label: "Illinois governor signs right to appraisal bill, AASPI calls it ‘major legislative victory’",
        publisher: "Repairer Driven News, Aug 13, 2026",
        url: "https://www.repairerdrivennews.com/2026/08/13/illinois-governor-signs-right-to-appraisal-bill-aaspi-calls-it-major-legislative-victory/",
        kind: "coverage",
      },
      {
        label: "Bill Status of HB4160, 104th General Assembly",
        publisher: "Illinois General Assembly",
        url: "https://www.ilga.gov/Legislation/BillStatus?GAID=18&DocNum=4160&DocTypeID=HB&LegId=164381&SessionID=114",
        kind: "reference",
      },
    ],
    tags: ["righttoappraisal", "illinois", "autoinsurance", "insuranceclaim", "knowyourrights"],
    image: {
      src: "/daily-iq/kb-015-illinois-appraisal-law.png",
      alt: "The Daily iQ entry 15 card: Illinois HB 4160 signed into law as Public Act 104-0767, effective July 1, 2027.",
    },
    cardSource: "Source: CollisionWeek, Aug 17, 2026; Repairer Driven News, Aug 13, 2026.",
  },
  {
    entryNumber: 16,
    slug: "used-car-listing-price-27239-four-year-high",
    date: "2026-09-26",
    category: "Total loss & valuation",
    headline: "$27,239: the average used-car listing, the highest since December 2022.",
    keyFigure: "$27,239",
    keyFigureLabel: "average U.S. used-vehicle listing price in August 2026, up 7% in a year, per Cox Automotive",
    summary: [
      "In August 2026 the average U.S. used-vehicle listing price reached $27,239, up 7% from a year earlier and the highest monthly average since December 2022, per Cox Automotive. Supply under $15,000 fell 25.9% year over year to 15.1% of used inventory, down from 20.6%. Autobody News' review of six months of used-vehicle data, published September 16, 2026, sets those swings against a record 23.1% total-loss rate.",
      "Why the retail number matters if your car gets totaled: you replace your car at retail. A valuation built on soft comparables drifts away from the market you actually have to buy in, and the ordinary, older car is the one most exposed.",
    ],
    whyItMatters:
      "A total-loss check is only fair if it buys the same car back in the same market. When listings hit a four-year high, a valuation that has not moved with them is a valuation worth auditing.",
    howCollisionIqUsesIt:
      "Filed into the knowledge base as the dated retail-market reference Value iQ reads against a total-loss valuation's comparables.",
    sources: [
      {
        label: "Used-Vehicle Prices Reach Highest Level Since 2022 as Inventory Tightens in August",
        publisher: "Cox Automotive, Sep 2026",
        url: "https://www.coxautoinc.com/insights/used-vehicle-inventory-august-2026/",
        kind: "primary",
      },
      {
        label: "Six Months of Data Show a Bumpier Path for Used-Vehicle Values",
        publisher: "Autobody News, Sep 16, 2026",
        url: "https://www.autobodynews.com/regional/midwest-regional-news/six-months-of-data-show-a-bumpier-path-for-used-vehicle-values",
        kind: "coverage",
      },
    ],
    tags: ["usedcars", "totalloss", "actualcashvalue", "carinsurance", "carmarket"],
    image: {
      src: "/daily-iq/kb-016-used-car-four-year-high.png",
      alt: "The Daily iQ entry 16 card: average used-vehicle listing price of $27,239 in August 2026, highest since December 2022.",
    },
    cardSource: "Source: Cox Automotive, August 2026 used-vehicle report; Autobody News, Sep 16, 2026.",
  },
];

/** Entries newest first — the order the page publishes them. */
/** Today's ISO calendar date in New York time, the series' publishing clock (noon ET posts). */
export function knowledgeDailyToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/**
 * Every entry filed, newest first. A whole week is filed in advance from the
 * weekly Knowledge Base batch, so entries dated after `today` are held back
 * and appear on their own day (the page revalidates hourly).
 */
export function getKnowledgeDailyEntries(today: string = knowledgeDailyToday()): KnowledgeDailyEntry[] {
  return ENTRIES.filter((entry) => entry.date <= today).sort((a, b) =>
    a.date === b.date ? b.entryNumber - a.entryNumber : b.date.localeCompare(a.date)
  );
}

/** Every filed entry including those not yet published (for tooling and tests). */
export function getAllKnowledgeDailyEntries(): KnowledgeDailyEntry[] {
  return [...ENTRIES].sort((a, b) => (a.date === b.date ? b.entryNumber - a.entryNumber : b.date.localeCompare(a.date)));
}

export function getKnowledgeDailyEntry(slug: string, today: string = knowledgeDailyToday()): KnowledgeDailyEntry | null {
  return ENTRIES.find((entry) => entry.slug === slug && entry.date <= today) ?? null;
}

export function formatKnowledgeDailyDate(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
