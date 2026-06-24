export type PreliminaryReviewAttachment = {
  filename: string;
  mime?: string;
  text: string;
  usedInAnalysis?: boolean;
};

export type PreliminaryReviewDraft = {
  message: string;
  hasUsefulTriage: boolean;
};

function formatPreliminaryCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function extractEstimateTotalCandidate(text: string): number | null {
  if (!text.trim()) return null;

  const candidates: Array<{ value: number; score: number; index: number }> = [];
  const totalPatterns = [
    /(?:net\s+cost\s+of\s+repairs|estimate|gross|repair|claim|net|grand)\s+total?[^$\d]{0,32}\$?\s*([0-9][0-9,]*(?:\.\d{2})?)/gi,
    /total[^$\d]{0,20}\$?\s*([0-9][0-9,]*(?:\.\d{2})?)/gi,
    /\$\s*([0-9][0-9,]*(?:\.\d{2}))/g,
  ];

  totalPatterns.forEach((pattern, patternIndex) => {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const value = Number(String(match[1] ?? "").replace(/,/g, ""));
      if (!Number.isFinite(value) || value < 100 || value > 250000) continue;
      candidates.push({
        value,
        score: patternIndex === 0 ? 3 : patternIndex === 1 ? 2 : 1,
        index: match.index,
      });
    }
  });

  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score || b.index - a.index || b.value - a.value);
  return candidates[0]?.value ?? null;
}

export function inferEstimateRole(attachment: Pick<PreliminaryReviewAttachment, "filename" | "text">): "shop" | "carrier" | "unknown" {
  const haystack = `${attachment.filename}\n${attachment.text.slice(0, 4000)}`.toLowerCase();
  if (/\b(?:shop|repair facility|collision center|body shop|supplement|work auth|work authorization|final estimate|revised estimate)\b/.test(haystack)) {
    return "shop";
  }
  if (/\b(?:sor|allstate|state farm|geico|progressive|carrier estimate|insurer estimate|insurance estimate|claim rep|staff estimate|adjuster)\b/.test(haystack)) {
    return "carrier";
  }
  return "unknown";
}

function buildPreliminaryCategories(attachments: PreliminaryReviewAttachment[]) {
  const text = attachments.map((attachment) => `${attachment.filename}\n${attachment.text}`).join("\n").toLowerCase();
  const categories: string[] = [];

  if (/\b(?:labor rate|body rate|paint rate|material rate|paint materials?|refinish rate)\b/.test(text)) {
    categories.push("labor/material rate difference");
  }
  if (/\b(?:oem|aftermarket|a\/m|lkq|recycled|rcy|reman|used part|part source)\b/.test(text)) {
    categories.push("OEM vs A/M/LKQ/RCY part posture");
  }
  if (/\b(?:adas|calibration|calibrate|pre-?scan|post-?scan|diagnostic|dtc|radar|camera|aiming)\b/.test(text)) {
    categories.push("scan/ADAS/calibration");
  }
  if (/\b(?:steering column|srs|airbag|seat belt|restraint|structural|frame|measure|safety)\b/.test(text)) {
    categories.push("steering/SRS/safety operations");
  }
  if (/\b(?:refinish|blend|clear coat|corrosion|seam sealer|feather|prime|block|mask|cover car)\b/.test(text)) {
    categories.push("refinish/process/manual lines");
  }

  return categories.slice(0, 5);
}

function resolvePreliminaryEstimatePair(estimates: Array<{
  filename: string;
  role: "shop" | "carrier" | "unknown";
  total: number | null;
}>) {
  const withTotals = estimates.filter((estimate) =>
    typeof estimate.total === "number"
  ) as Array<{ filename: string; role: "shop" | "carrier" | "unknown"; total: number }>;
  if (withTotals.length >= 2) {
    const ordered = [...withTotals].sort((a, b) => a.total - b.total);
    const source = ordered[0];
    const comparison = ordered[ordered.length - 1];
    if (source && comparison && source !== comparison) {
      return {
        source,
        comparison,
        neutralLabels: source.role !== "carrier" && comparison.role !== "carrier",
        gap: comparison.total - source.total,
      };
    }
  }

  const shopEstimate = estimates.find((estimate) => estimate.role === "shop") ?? estimates.find((estimate) => estimate.total !== null);
  const carrierEstimate =
    estimates.find((estimate) => estimate.role === "carrier") ??
    estimates.find((estimate) => estimate !== shopEstimate && estimate.total !== null);

  return {
    source: carrierEstimate ?? shopEstimate ?? null,
    comparison: shopEstimate && shopEstimate !== carrierEstimate ? shopEstimate : carrierEstimate ?? null,
    neutralLabels: false,
    gap:
      typeof shopEstimate?.total === "number" && typeof carrierEstimate?.total === "number"
        ? Math.abs(shopEstimate.total - carrierEstimate.total)
        : null,
  };
}

export function buildPreliminaryReviewDraft(attachments: PreliminaryReviewAttachment[]): PreliminaryReviewDraft {
  const pdfs = attachments.filter((attachment) =>
    attachment.mime === "application/pdf" || /\.pdf$/i.test(attachment.filename)
  );
  const reviewedFiles = pdfs.length ? pdfs : attachments;
  const estimates = reviewedFiles.map((attachment) => ({
    filename: attachment.filename,
    role: inferEstimateRole(attachment),
    total: extractEstimateTotalCandidate(attachment.text),
  }));
  const pair = resolvePreliminaryEstimatePair(estimates);
  const categories = buildPreliminaryCategories(reviewedFiles);
  const hasDetectedTotal = estimates.some((estimate) => typeof estimate.total === "number");
  const hasUsefulTriage = hasDetectedTotal || categories.length > 0;
  const fileLabel = `${reviewedFiles.length} ${reviewedFiles.length === 1 ? "file" : "files"}`;
  const pdfLabel = pdfs.length ? `${pdfs.length} PDF${pdfs.length === 1 ? "" : "s"}` : fileLabel;
  const lines = [
    `Preliminary review started. I found ${pdfLabel} and I am parsing the estimates now. The full line-by-line citation review is still running, but I will give you a fast triage first so you are not waiting on a blank screen.`,
    "",
    "Fast triage from the current upload:",
    `- Files: ${reviewedFiles.map((attachment) => attachment.filename).join(", ")}`,
  ];

  if (pair.source?.filename || pair.comparison?.filename) {
    if (pair.neutralLabels) {
      lines.push(`- Likely source/lower estimate: ${pair.source?.filename ?? "not clear yet"}${typeof pair.source?.total === "number" ? ` (${formatPreliminaryCurrency(pair.source.total)})` : ""}`);
      lines.push(`- Likely comparison/final estimate: ${pair.comparison?.filename ?? "not clear yet"}${typeof pair.comparison?.total === "number" ? ` (${formatPreliminaryCurrency(pair.comparison.total)})` : ""}`);
    } else {
      lines.push(`- Likely shop estimate: ${pair.comparison?.filename ?? "not clear yet"}${typeof pair.comparison?.total === "number" ? ` (${formatPreliminaryCurrency(pair.comparison.total)})` : ""}`);
      lines.push(`- Likely carrier/SOR estimate: ${pair.source?.filename ?? "not clear yet"}${typeof pair.source?.total === "number" ? ` (${formatPreliminaryCurrency(pair.source.total)})` : ""}`);
    }
  }

  if (pair.gap !== null) {
    const prefix = pair.gap > 0 ? "+" : "";
    lines.push(`- Approximate total gap: ${prefix}${formatPreliminaryCurrency(pair.gap)}`);
  }

  if (categories.length) {
    lines.push(`- Early issue categories: ${categories.join("; ")}`);
  }

  lines.push("", "This is preliminary. Authority and citation review is still running.");
  return {
    message: lines.join("\n"),
    hasUsefulTriage,
  };
}
