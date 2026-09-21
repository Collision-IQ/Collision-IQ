/**
 * DEG INQUIRY LIBRARY — Database Enhancement Gateway inquiries Collision iQ
 * knows by number, so an estimate review that touches the operation an
 * inquiry settled cites the inquiry instead of arguing the premise from
 * memory.
 *
 * A DEG inquiry is the information provider's own answer about what one of
 * its labor times includes or excludes. On the project evidence ladder it is
 * industry evidence (DEG, below the estimating guides and far below OEM); on
 * the host ladder in reports/authorityTier.ts, degweb.org places at tier 4.
 * An inquiry is platform-specific (a CCC/MOTOR answer says nothing about a
 * Mitchell line) and is never vehicle-specific unless its record says so.
 *
 * Every entry records WHERE its text came from. The inquiry page is the
 * primary record; when an entry was recorded from a secondary publication
 * that summarizes the inquiry (an SCRS estimating tip, for example) the
 * entry says so, and the citation carries that provenance to the reader.
 * Nothing here is paraphrased from memory: the finding text is what the
 * recorded source states.
 *
 * Unlike the estimating guides (estimatingGuides.ts), DEG inquiries are
 * public pages. They are cited by number and may be linked.
 */

import type { EstimatingPlatform } from "@/lib/ai/estimatingGuides";
import { sniffEstimatingPlatform } from "@/lib/ai/estimatingGuides";

export type DegInquiryPlatform = "ccc" | "mitchell" | "audatex";

export type DegInquiry = {
  /** The DEG inquiry number, as printed on the page. */
  id: number;
  /** Public inquiry page. */
  url: string;
  /** Short reader-facing title: the operation and what was settled. */
  title: string;
  /** The estimating platform whose labor time the inquiry ruled on. */
  platform: DegInquiryPlatform;
  /** Platform name as a reader knows it, e.g. "CCC ONE". */
  platformLabel: string;
  /** The labor operation the inquiry ruled on. */
  operation: string;
  /** What the recorded source states the provider confirmed. */
  finding: string;
  /** What a reviewer does with it on an estimate. */
  reviewAction: string;
  /** Where the recorded text came from, in one line. */
  recordedFrom: string;
  /** ISO date the record was taken. */
  recordedOn: string;
  /** Vehicle scope the record states, or null when the record is not vehicle-specific. */
  vehicleScope: string | null;
  /**
   * Line or finding text that makes the inquiry apply. `operation` must
   * match; `subject` must also match for the inquiry to SETTLE the item
   * (the inquiry is then attached as reviewed authority). An operation
   * match alone is a prompt to check, never a citation.
   */
  match: {
    operation: RegExp;
    subject: RegExp;
  };
};

export const DEG_INQUIRIES: readonly DegInquiry[] = [
  {
    id: 41986,
    url: "https://degweb.org/inquiries/41986/",
    title: "Frame-mounted cage nuts and bed-mounting hardware are not included in Pick Up Box R&I / R&R",
    platform: "ccc",
    platformLabel: "CCC ONE",
    operation: "Pick Up Box R&I / R&R",
    finding:
      "Replacing or transferring frame-mounted cage nuts and bed-mounting hardware is not included in Pick Up Box R&I / R&R labor operations. Because these fasteners mount to the frame rather than the bed assembly, any replacement, transfer, or cleanup must be added as a separate, manual line.",
    reviewAction:
      "When an estimate carries Pick Up Box R&I or R&R, replacement, transfer or cleanup of the frame-mounted cage nuts and bed-mounting hardware is a separate manual line. A separate hardware line is supported; a removal of that line as 'included' is not.",
    recordedFrom:
      "SCRS Estimating Tip 'CCCONE – Frame mounted hardware for Bed R&I / R&R' (September 21, 2026), which summarizes DEG Inquiry 41986; the inquiry page itself was not retrieved when this record was taken.",
    recordedOn: "2026-09-21",
    vehicleScope: null,
    match: {
      operation:
        /\b(?:pick\s*-?\s*up\s+box|pickup\s+box|truck\s+bed|cargo\s+box|bed\s+(?:assy|assembly|r\s*&\s*[ir]\b|r\/i|r\/r|remove|reinstall))/i,
      subject:
        /\b(?:cage\s+nuts?|(?:bed|box)[\s-]*mount(?:ing)?\s+(?:hardware|nuts?|bolts?|fasteners?)|frame[\s-]*mount(?:ed|ing)?\s+(?:hardware|nuts?|bolts?|fasteners?|cage)|mounting\s+hardware|bed\s+(?:bolts?|hardware|fasteners?))\b/i,
    },
  },
];

export type DegInquiryMatch = {
  inquiry: DegInquiry;
  /** True when the text names the subject the inquiry settled, not just the operation. */
  settles: boolean;
  /** True when the estimate's platform is known and is the inquiry's platform. */
  platformConfirmed: boolean;
};

function normalizePlatform(platform: DegInquiryPlatform | EstimatingPlatform | null | undefined): DegInquiryPlatform | null {
  return platform === "ccc" || platform === "mitchell" || platform === "audatex" ? platform : null;
}

/**
 * The inquiries a line or finding text touches. A known platform other than
 * the inquiry's excludes it outright (a CCC answer never speaks for a
 * Mitchell line). An unknown platform keeps the match and says so, so the
 * citation can ask for the platform to be confirmed rather than assume it.
 */
export function findDegInquiriesForText(
  text: string | null | undefined,
  options: { platform?: DegInquiryPlatform | EstimatingPlatform | null; text?: string | null } = {}
): DegInquiryMatch[] {
  const value = (text ?? "").replace(/\s+/g, " ").trim();
  if (!value) return [];
  const platform = normalizePlatform(options.platform) ?? normalizePlatform(sniffEstimatingPlatform(options.text ?? value));
  const matches: DegInquiryMatch[] = [];
  for (const inquiry of DEG_INQUIRIES) {
    if (platform && platform !== inquiry.platform) continue;
    if (!inquiry.match.operation.test(value)) continue;
    matches.push({
      inquiry,
      settles: inquiry.match.subject.test(value),
      platformConfirmed: platform === inquiry.platform,
    });
  }
  return matches;
}

/** The inquiries that SETTLE the text: operation and subject both named. */
export function findSettlingDegInquiries(
  text: string | null | undefined,
  options: { platform?: DegInquiryPlatform | EstimatingPlatform | null; text?: string | null } = {}
): DegInquiryMatch[] {
  return findDegInquiriesForText(text, options).filter((match) => match.settles);
}

const INQUIRY_URL_RE = /^https?:\/\/(?:www\.)?degweb\.org\/inquiries\/(\d+)\/?(?:[?#].*)?$/i;

/** The inquiry a URL names, or null for any other page (including other DEG pages). */
export function findDegInquiryForUrl(url: string | null | undefined): DegInquiry | null {
  if (!url) return null;
  const id = INQUIRY_URL_RE.exec(url.trim())?.[1];
  if (!id) return null;
  const numeric = Number(id);
  return DEG_INQUIRIES.find((inquiry) => inquiry.id === numeric) ?? null;
}

/** The inquiry a stored citation names, by URL or by its "DEG Inquiry <n>" title. */
export function findDegInquiryForSource(source: { url?: string | null; title?: string | null }): DegInquiry | null {
  const byUrl = findDegInquiryForUrl(source.url);
  if (byUrl) return byUrl;
  const id = /\bDEG\s+Inquiry\s+(\d+)\b/i.exec(source.title ?? "")?.[1];
  if (!id) return null;
  const numeric = Number(id);
  return DEG_INQUIRIES.find((inquiry) => inquiry.id === numeric) ?? null;
}

/** Citable title: number first, so a reader can find the record. */
export function buildDegInquiryCitationTitle(inquiry: DegInquiry): string {
  return `DEG Inquiry ${inquiry.id}: ${inquiry.title} (${inquiry.platformLabel})`;
}

/**
 * The provenance note a citation carries. Names the platform gate and where
 * the recorded text came from, so a reader never takes a secondary record
 * for the inquiry page.
 */
export function buildDegInquiryCitationNote(match: DegInquiryMatch): string {
  const platform = match.platformConfirmed
    ? `${match.inquiry.platformLabel} labor premise; platform confirmed from the document`
    : `${match.inquiry.platformLabel} labor premise; confirm the estimate was written on ${match.inquiry.platformLabel} before relying on it`;
  return `DEG inquiry on file; ${platform}. Recorded from: ${match.inquiry.recordedFrom}`;
}

/** One reader-facing paragraph for a matched inquiry. */
export function describeDegInquiryMatch(match: DegInquiryMatch): string {
  const { inquiry } = match;
  const lead = match.settles
    ? `DEG Inquiry ${inquiry.id} settles this item on ${inquiry.platformLabel}: ${inquiry.finding}`
    : `${inquiry.operation} is on this estimate. DEG Inquiry ${inquiry.id} (${inquiry.platformLabel}) confirms: ${inquiry.finding} Check whether that hardware was replaced, transferred or cleaned up, and that it is carried as its own line.`;
  const platform = match.platformConfirmed ? "" : ` This applies to ${inquiry.platformLabel} estimates only; confirm the platform before relying on it.`;
  return `${lead}${platform} Source: ${inquiry.url}`;
}

/**
 * Prompt block for the chat and case-chat system prompts: the inquiries the
 * assistant knows and the rules for citing them. Empty when the library is
 * empty, so the prompt carries no dead heading.
 */
export function buildDegInquiryLibraryDirective(): string {
  if (DEG_INQUIRIES.length === 0) return "";
  const lines = DEG_INQUIRIES.map(
    (inquiry) =>
      `- DEG Inquiry ${inquiry.id} (${inquiry.platformLabel}; ${inquiry.url})\n  Operation: ${inquiry.operation}\n  Finding: ${inquiry.finding}\n  Review action: ${inquiry.reviewAction}\n  Vehicle scope: ${inquiry.vehicleScope ?? "not vehicle-specific"}\n  Recorded from: ${inquiry.recordedFrom}`
  );
  return `
DEG INQUIRY LIBRARY (Database Enhancement Gateway inquiries on file — industry evidence, below the estimating guides and below OEM):
${lines.join("\n")}
Rules:
- When an estimate line or a review item matches an inquiry's operation on the inquiry's platform, cite the inquiry by number ("DEG Inquiry 41986") and state its finding as recorded. The inquiry page is public and may be linked.
- An inquiry answers for its own platform only. Never apply a CCC/MOTOR inquiry to a Mitchell or Audatex line, or the reverse. When the estimate's platform is not established, say the inquiry applies to that platform and ask for the platform to be confirmed.
- An inquiry is the information provider's statement of what a labor time includes or excludes. It is not an OEM procedure, not a position statement, and not vehicle-specific unless its record says so. Label it as DEG guidance.
- When the record was taken from a secondary publication (its "Recorded from" line says so), say the finding is as recorded there and that the inquiry page should be checked for the provider's full response.
- An operation the inquiry says is not included supports a separate line for it; it does not by itself establish that the work was performed. Ask for the repair evidence when that is in question.
`.trim();
}
