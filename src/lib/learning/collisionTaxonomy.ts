/**
 * Collision Learning Engine — domain taxonomy.
 *
 * Static, non-proprietary domain map for the 90-day learning blueprint. Seed
 * data stores approved source REFERENCES and scoped gold answers only — never
 * proprietary source text (OEM procedures, MOTOR/CCC content, I-CAR material).
 */

export type CollisionTaxonomyDomain = {
  slug: string;
  name: string;
  week: number;
  /** Domains whose failures are treated as safety-critical by default. */
  safetyCriticalByDefault: boolean;
  description: string;
};

export const COLLISION_TAXONOMY: CollisionTaxonomyDomain[] = [
  { slug: "collision-fundamentals", name: "Collision fundamentals", week: 1, safetyCriticalByDefault: false, description: "Terminology, vehicle identification, component naming, repair-process stages." },
  { slug: "source-governance", name: "Source authority & governance", week: 1, safetyCriticalByDefault: false, description: "Source-authority hierarchy, evidence vs inference, vehicle-specific vs general guidance, citation requirements, unsupported-vehicle handling." },
  { slug: "vehicle-construction", name: "Vehicle construction", week: 2, safetyCriticalByDefault: true, description: "Body-over-frame vs unibody, structural vs non-structural, load paths, crash-energy management." },
  { slug: "materials", name: "Materials", week: 2, safetyCriticalByDefault: true, description: "Steel strength classes, aluminum, magnesium, plastics/composites, attachment methods, heat restrictions." },
  { slug: "repair-safety", name: "Personal & vehicle safety", week: 2, safetyCriticalByDefault: true, description: "Personal protection, fire and high-voltage hazards, vehicle protection during repair." },
  { slug: "damage-analysis", name: "Damage analysis & blueprinting", week: 3, safetyCriticalByDefault: false, description: "Direct/indirect damage, damage migration, hidden damage, disassembly, repair planning." },
  { slug: "measurement", name: "Measurement & structural setup", week: 3, safetyCriticalByDefault: true, description: "Pre-repair measurements, structural setup, three-dimensional measuring, suspension indicators." },
  { slug: "estimating", name: "Estimating systems & database logic", week: 4, safetyCriticalByDefault: false, description: "R&I/R&R/repair/overhaul, included & not-included, overlap, labor categories, judgment times, P-pages, supplements." },
  { slug: "structural-repair", name: "OEM procedures & structural repair", week: 5, safetyCriticalByDefault: true, description: "Procedure discovery, sectioning limits, weld type/location/count, one-time-use components, structural measurements." },
  { slug: "welding-joining", name: "Welding & joining", week: 5, safetyCriticalByDefault: true, description: "STRSW, GMA welding, MIG brazing, rivet bonding, adhesive bonding, test welds, destructive testing." },
  { slug: "refinish", name: "Refinish & materials", week: 6, safetyCriticalByDefault: false, description: "Feather/prime/block, blends, clearcoat, tinting, masking, de-nib and polish, refinish overlap." },
  { slug: "corrosion-protection", name: "Corrosion protection", week: 6, safetyCriticalByDefault: true, description: "Weld-through primer, cavity wax, seam sealer, undercoating, adhesives, hazardous-material handling." },
  { slug: "scanning-diagnostics", name: "Scanning & diagnostics", week: 7, safetyCriticalByDefault: true, description: "Pre/post-repair scanning, DTC interpretation, network communication, battery support, programming/initialization." },
  { slug: "electrical", name: "Electrical systems", week: 7, safetyCriticalByDefault: false, description: "Network topology, harness repair, connector service, battery systems." },
  { slug: "srs", name: "SRS & restraints", week: 7, safetyCriticalByDefault: true, description: "SRS components, seat-belt inspections, impact sensors, occupant classification." },
  { slug: "adas-calibration", name: "ADAS & calibration", week: 7, safetyCriticalByDefault: true, description: "Radar/camera/ultrasonic systems, static & dynamic calibration, alignment and ride-height dependencies, documentation." },
  { slug: "ev-hybrid", name: "EV & hybrid", week: 8, safetyCriticalByDefault: true, description: "High-voltage isolation, battery inspection/handling, thermal events, EV lifting and storage." },
  { slug: "aluminum-repair", name: "Aluminum repair", week: 8, safetyCriticalByDefault: true, description: "Contamination control, dedicated tools, aluminum joining and refinish interactions." },
  { slug: "plastics-composites", name: "Plastics & composites", week: 8, safetyCriticalByDefault: false, description: "Plastic identification and repair, composite repair." },
  { slug: "glass", name: "Glass", week: 8, safetyCriticalByDefault: true, description: "Windshield replacement, urethane systems, camera-equipped glass, pinch-weld preparation, leak testing." },
  { slug: "parts", name: "Parts & supply chain", week: 9, safetyCriticalByDefault: false, description: "OEM/aftermarket/recycled/reconditioned parts, supersession, restricted and one-time-use parts, cores, freight, vendor invoices." },
  { slug: "mechanical", name: "Mechanical systems", week: 9, safetyCriticalByDefault: false, description: "Cooling, A/C, suspension, steering, wheels and tires, exhaust, air intake, sublet documentation." },
  { slug: "estimate-comparison", name: "Estimate delta & comparison", week: 10, safetyCriticalByDefault: false, description: "Line-item matching, added/removed/changed operations, hidden scope changes, supplement forensics." },
  { slug: "citation-density", name: "Citation density & case forensics", week: 10, safetyCriticalByDefault: false, description: "Supporting-document association, photo-to-line mapping, scan-to-operation mapping, invoice verification, file diagnostics." },
  { slug: "documentation", name: "Documentation", week: 10, safetyCriticalByDefault: false, description: "Repair documentation, completion proof, duplicate and support-only file handling." },
  { slug: "claims", name: "Claims handling", week: 11, safetyCriticalByDefault: false, description: "Claim documentation, technical short-pay analysis, policy-language boundaries." },
  { slug: "appraisal", name: "Appraisal & Right to Appraisal", week: 11, safetyCriticalByDefault: false, description: "Right to Appraisal, appraisal posture, expert vs legal functions." },
  { slug: "valuation", name: "Valuation, DV & total loss", week: 11, safetyCriticalByDefault: false, description: "Diminished value, total-loss valuation, comparables, condition/option adjustments, betterment, taxes and fees." },
  { slug: "jurisdiction", name: "Jurisdiction & regulation", week: 11, safetyCriticalByDefault: false, description: "State-specific requirements, DOI and regulatory materials; never converts general insurance info into jurisdiction-specific legal advice." },
  { slug: "customer-communication", name: "Customer communication", week: 12, safetyCriticalByDefault: false, description: "Customer reports, plain-English answer-first structure, audience adaptation." },
  { slug: "professional-work-product", name: "Professional work product", week: 12, safetyCriticalByDefault: false, description: "Repair-intelligence reports, carrier rebuttals, supplement narratives, expert-safe language, observed vs inferred facts." },
];

const BY_SLUG = new Map(COLLISION_TAXONOMY.map((domain) => [domain.slug, domain]));

export function getTaxonomyDomain(slug: string): CollisionTaxonomyDomain | undefined {
  return BY_SLUG.get(slug);
}

export function isKnownDomain(slug: string): boolean {
  return BY_SLUG.has(slug);
}

export function listDomainSlugs(): string[] {
  return COLLISION_TAXONOMY.map((domain) => domain.slug);
}

export function isDomainSafetyCriticalByDefault(slug: string): boolean {
  return BY_SLUG.get(slug)?.safetyCriticalByDefault ?? false;
}
