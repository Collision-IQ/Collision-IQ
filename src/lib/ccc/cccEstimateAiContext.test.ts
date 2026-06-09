import { describe, expect, it } from "vitest";
import { normalizeCccBmsEstimate } from "./bmsEstimateNormalizer";
import { buildCccEstimateEvidenceContext } from "./cccEstimateAiContext";

const SAMPLE_XML = `<VehicleDamageEstimateAddRq>
  <RqUID>rq-context</RqUID>
  <DocumentID>DOC-1</DocumentID>
  <ClaimNumber>CLAIM-123456</ClaimNumber>
  <LossState>CA</LossState>
  <VIN>1HGCM82633A004352</VIN>
  <ModelYear>2024</ModelYear>
  <Make>Honda</Make>
  <Model>Accord</Model>
  <GrossTotal>1000.25</GrossTotal>
  <Tax>75.25</Tax>
  <EstimateLineItem>
    <LineNumber>1</LineNumber>
    <Operation>Replace</Operation>
    <PartDescription>Headlamp assembly</PartDescription>
    <PartNumber>HL-1</PartNumber>
    <LaborHours>0.8</LaborHours>
    <TotalAmount>245.50</TotalAmount>
  </EstimateLineItem>
</VehicleDamageEstimateAddRq>`;

describe("CCC estimate AI context adapter", () => {
  it("builds concise structured context for bot understanding", () => {
    const normalized = normalizeCccBmsEstimate(SAMPLE_XML, {
      environment: "sandbox",
      appId: "1686",
      sourceEventId: "event-1",
    });
    const context = buildCccEstimateEvidenceContext(normalized);

    expect(context).toContain("Estimate source: CCC Secure Share BMS");
    expect(context).toContain(
      "Source confidence: high for estimate structure and line-item extraction"
    );
    expect(context).toContain("Evidence lane: estimate_evidence");
    expect(context).toContain("Vehicle:");
    expect(context).toContain("summary: 2024 Honda Accord");
    expect(context).toContain("vinRedacted: ***********004352");
    expect(context).toContain("Jurisdiction:");
    expect(context).toContain("source:");
    expect(context).toContain("Estimate totals:");
    expect(context).toContain("grossTotal: 1000.25");
    expect(context).toContain("Top normalized line items: 1 shown of 1");
    expect(context).toContain("Headlamp assembly");
  });

  it("includes required CCC evidence and citation boundary sentences", () => {
    const context = buildCccEstimateEvidenceContext(normalizeCccBmsEstimate(SAMPLE_XML));

    expect(context).toContain(
      "CCC Secure Share source confirms this estimate line was present in the structured estimate data."
    );
    expect(context).toContain(
      "The CCC estimate data supports the existence of this line-item difference. OEM/P-page/DEG/legal support has not yet been verified."
    );
  });

  it("states CCC source confidence is high for estimate data only", () => {
    const context = buildCccEstimateEvidenceContext(normalizeCccBmsEstimate(SAMPLE_XML));

    expect(context).toContain(
      "Source confidence: high for estimate structure and line-item extraction"
    );
    expect(context).toContain("Evidence lane: estimate_evidence");
    expect(context).toContain(
      "Do not use CCC Secure Share BMS as OEM, P-page, DEG, legal, policy, or carrier-violation authority."
    );
    const confidenceLines = context
      .split("\n")
      .filter((line) => /confidence/i.test(line))
      .join("\n");
    expect(confidenceLines).not.toMatch(/OEM|required|P-page|DEG|legal|policy|coverage/i);
  });

  it("caps top normalized line items", () => {
    const manyLines = Array.from({ length: 14 }, (_, index) => {
      const lineNumber = index + 1;
      return `<EstimateLineItem><LineNumber>${lineNumber}</LineNumber><Operation>Replace</Operation><PartDescription>Part ${lineNumber}</PartDescription><TotalAmount>${lineNumber}</TotalAmount></EstimateLineItem>`;
    }).join("");
    const context = buildCccEstimateEvidenceContext(
      normalizeCccBmsEstimate(`<VehicleDamageEstimateAddRq>${manyLines}</VehicleDamageEstimateAddRq>`)
    );

    expect(context).toContain("Top normalized line items: 12 shown of 14");
    expect(context).toContain("... 2 additional line item(s) omitted");
    expect(context).toContain("Part 12");
    expect(context).not.toContain("Part 13");
  });

  it("includes parse warnings and limitations", () => {
    const context = buildCccEstimateEvidenceContext(
      normalizeCccBmsEstimate("<VehicleDamageEstimateAddRq><RqUID>rq</RqUID></VehicleDamageEstimateAddRq>")
    );

    expect(context).toContain("Parse warnings:");
    expect(context).toContain("No CCC BMS line item blocks were found.");
    expect(context).toContain("Limitations:");
    expect(context).toContain("Line items were not found");
  });

  it("does not include banned authority phrases", () => {
    const context = buildCccEstimateEvidenceContext(normalizeCccBmsEstimate(SAMPLE_XML));

    expect(context).not.toContain("CCC confirms this operation is required");
    expect(context).not.toContain("CCC proves OEM requirement");
    expect(context).not.toContain("CCC proves P-page support");
    expect(context).not.toContain("CCC proves legal violation");
    expect(context).not.toContain("CCC proves policy coverage");
  });
});
