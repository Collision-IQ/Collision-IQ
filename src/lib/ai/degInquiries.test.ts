import { describe, expect, it } from "vitest";
import {
  DEG_INQUIRIES,
  buildDegInquiryCitationNote,
  buildDegInquiryCitationTitle,
  buildDegInquiryLibraryDirective,
  describeDegInquiryMatch,
  findDegInquiriesForText,
  findDegInquiryForSource,
  findDegInquiryForUrl,
  findSettlingDegInquiries,
} from "@/lib/ai/degInquiries";
import { attachDegInquirySources, buildAnnotationSourceRefs } from "@/lib/ai/builders/estimateScrubberPdfBuilder";
import { classifyAuthority } from "@/lib/reports/authorityTier";

const INQUIRY_URL = "https://degweb.org/inquiries/41986/";

describe("the DEG inquiry library records inquiry 41986 with its provenance", () => {
  const inquiry = DEG_INQUIRIES.find((entry) => entry.id === 41986)!;

  it("keeps the inquiry by number, address and platform", () => {
    expect(inquiry.url).toBe(INQUIRY_URL);
    expect(inquiry.platform).toBe("ccc");
    expect(inquiry.operation).toBe("Pick Up Box R&I / R&R");
    expect(inquiry.finding).toMatch(/frame-mounted cage nuts and bed-mounting hardware is not included/i);
    expect(inquiry.finding).toMatch(/separate, manual line/i);
    expect(inquiry.vehicleScope).toBeNull();
  });

  it("says where the recorded text came from and that the page itself was not retrieved", () => {
    expect(inquiry.recordedFrom).toMatch(/SCRS Estimating Tip/);
    expect(inquiry.recordedFrom).toMatch(/inquiry page itself was not retrieved/);
    expect(inquiry.recordedOn).toBe("2026-09-21");
  });

  it("is admitted to the authority ladder as an industry technical body, not rejected", () => {
    const result = classifyAuthority({ title: buildDegInquiryCitationTitle(inquiry), url: inquiry.url });
    expect("tier" in result && result.tier.tier).toBe(4);
    expect("tier" in result && result.tier.tierBasis).toMatch(/degweb\.org/);
  });

  it("is found by its address or by its citation title, and by nothing else", () => {
    expect(findDegInquiryForUrl(INQUIRY_URL)?.id).toBe(41986);
    expect(findDegInquiryForUrl("http://www.degweb.org/inquiries/41986")?.id).toBe(41986);
    expect(findDegInquiryForUrl("https://degweb.org/inquiries/41985/")).toBeNull();
    expect(findDegInquiryForUrl("https://degweb.org/estimate-tips/")).toBeNull();
    expect(findDegInquiryForSource({ title: "DEG Inquiry 41986: anything" })?.id).toBe(41986);
    expect(findDegInquiryForSource({ title: "SCRS Guide to Complete Repair Planning" })).toBeNull();
  });
});

describe("an estimate line that matches the inquiry's criteria finds it", () => {
  it("settles a separate hardware line next to a pickup box R&I on a CCC estimate", () => {
    const matches = findSettlingDegInquiries("Line 12 R&I Pick Up Box; Line 13 Repl frame mounted cage nuts (bed mounting hardware)", {
      platform: "ccc",
    });
    expect(matches.map((match) => match.inquiry.id)).toEqual([41986]);
    expect(matches[0].settles).toBe(true);
    expect(matches[0].platformConfirmed).toBe(true);
  });

  it("matches the operation alone as a prompt to check, never as a settled item", () => {
    const [match] = findDegInquiriesForText("R&R Pickup Box assembly 4.2 hrs", { platform: "ccc" });
    expect(match.inquiry.id).toBe(41986);
    expect(match.settles).toBe(false);
    expect(findSettlingDegInquiries("R&R Pickup Box assembly 4.2 hrs", { platform: "ccc" })).toEqual([]);
  });

  it("recognises the subject in its common spellings", () => {
    for (const text of [
      "Truck bed R&I — transfer cage nuts to frame",
      "Bed R&R plus replace bed mounting bolts",
      "Cargo box R&I; clean up frame-mounted hardware",
      "Pick-up box R&I with mounting hardware replacement",
    ]) {
      expect(findSettlingDegInquiries(text, { platform: "ccc" }).length, text).toBe(1);
    }
  });

  it("never answers for a Mitchell or Audatex line", () => {
    const text = "R&I Pick Up Box; replace cage nuts";
    expect(findDegInquiriesForText(text, { platform: "mitchell" })).toEqual([]);
    expect(findDegInquiriesForText(text, { platform: "audatex" })).toEqual([]);
    expect(findDegInquiriesForText(text, { text: "Mitchell Cloud Estimating\n" + text })).toEqual([]);
  });

  it("keeps the match on an unknown platform and says the platform is unconfirmed", () => {
    const [match] = findSettlingDegInquiries("R&I Pick Up Box; replace cage nuts");
    expect(match.platformConfirmed).toBe(false);
    expect(buildDegInquiryCitationNote(match)).toMatch(/confirm the estimate was written on CCC ONE/);
    expect(describeDegInquiryMatch(match)).toMatch(/applies to CCC ONE estimates only/);
  });

  it("confirms the platform from the document's own markers when the text carries them", () => {
    const [match] = findSettlingDegInquiries("R&I Pick Up Box; replace cage nuts", {
      text: "CCC ONE Estimating\nWorkfile ID: abc\nR&I Pick Up Box; replace cage nuts",
    });
    expect(match.platformConfirmed).toBe(true);
    expect(buildDegInquiryCitationNote(match)).toMatch(/platform confirmed from the document/);
    expect(buildDegInquiryCitationNote(match)).toMatch(/Recorded from: SCRS Estimating Tip/);
  });

  it("ignores lines that only sound like a bed", () => {
    for (const text of ["Repl bed liner", "R&I bedside panel", "Refinish tailgate", "R&I front bumper cover; cage nut"]) {
      expect(findDegInquiriesForText(text, { platform: "ccc" }), text).toEqual([]);
    }
    expect(findDegInquiriesForText("")).toEqual([]);
    expect(findDegInquiriesForText(null)).toEqual([]);
  });
});

describe("the chat prompts name the inquiry and the rules for citing it", () => {
  it("lists the inquiry with its finding, review action and provenance", () => {
    const directive = buildDegInquiryLibraryDirective();
    expect(directive).toMatch(/^DEG INQUIRY LIBRARY/);
    expect(directive).toContain("DEG Inquiry 41986 (CCC ONE; https://degweb.org/inquiries/41986/)");
    expect(directive).toContain("Operation: Pick Up Box R&I / R&R");
    expect(directive).toMatch(/Finding: Replacing or transferring frame-mounted cage nuts/);
    expect(directive).toMatch(/Review action: /);
    expect(directive).toMatch(/Vehicle scope: not vehicle-specific/);
    expect(directive).toMatch(/Recorded from: SCRS Estimating Tip/);
  });

  it("gates the inquiry to its own platform and below OEM", () => {
    const directive = buildDegInquiryLibraryDirective();
    expect(directive).toMatch(/Never apply a CCC\/MOTOR inquiry to a Mitchell or Audatex line/);
    expect(directive).toMatch(/not an OEM procedure, not a position statement, and not vehicle-specific/);
    expect(directive).toMatch(/does not by itself establish that the work was performed/);
  });
});

describe("the estimate scrubber attaches a settling inquiry as reviewed DEG authority", () => {
  it("adds the inquiry once, as a verified DEG source with its address and provenance", () => {
    const text = "Frame mounted cage nuts missing from carrier estimate; shop line: R&I Pick Up Box; Repl cage nuts";
    const sources = attachDegInquirySources([], text, "ccc");
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      sourceType: "DEG",
      url: INQUIRY_URL,
      verified: true,
    });
    expect(sources[0].title).toBe(
      "DEG Inquiry 41986: Frame-mounted cage nuts and bed-mounting hardware are not included in Pick Up Box R&I / R&R (CCC ONE)"
    );
    expect(sources[0].note).toMatch(/platform confirmed from the document/);
    // Already cited: not attached twice.
    expect(attachDegInquirySources(sources, text, "ccc")).toHaveLength(1);
  });

  it("leaves the sources alone when the item is not settled or the platform is another", () => {
    expect(attachDegInquirySources([], "R&I Pick Up Box 4.2 hrs", "ccc")).toEqual([]);
    expect(attachDegInquirySources([], "R&I Pick Up Box; Repl cage nuts", "mitchell")).toEqual([]);
    expect(attachDegInquirySources([], "Blend fender; refinish door", "ccc")).toEqual([]);
  });

  it("prints the inquiry as an industry reference, by number, in the reader-facing source references", () => {
    const sources = attachDegInquirySources([], "R&I Pick Up Box; Repl cage nuts", "ccc");
    const refs = buildAnnotationSourceRefs({ sources });
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatch(/^Industry reference: DEG Inquiry 41986/);
    expect(refs[0]).toMatch(/Pick Up Box R&I \/ R&R/);
  });
});
