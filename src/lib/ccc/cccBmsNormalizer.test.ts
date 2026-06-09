import { describe, expect, it, vi } from "vitest";
import {
  normalizeCccBmsEstimate,
  normalizeCccBmsEstimateForAi,
} from "./cccBmsNormalizer";

const SAMPLE_BMS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<bms:VehicleDamageEstimateAddRq xmlns:bms="urn:cieca:bms">
  <bms:RqUID>rq-123</bms:RqUID>
  <bms:EstimateNumber>EST-42</bms:EstimateNumber>
  <bms:ClaimNumber>CLM-100</bms:ClaimNumber>
  <bms:EstimateDate>2026-06-09</bms:EstimateDate>
  <bms:LossState>IL</bms:LossState>
  <bms:InsuranceCompanyName>Example Carrier</bms:InsuranceCompanyName>
  <bms:RepairFacilityName>Example Collision</bms:RepairFacilityName>
  <bms:VIN>5YJ3E1EA3TF150471</bms:VIN>
  <bms:ModelYear>2026</bms:ModelYear>
  <bms:Make>TESL</bms:Make>
  <bms:Model>Model 3</bms:Model>
  <bms:EstimateLineItem>
    <bms:LineNumber>1</bms:LineNumber>
    <bms:Operation>R&I</bms:Operation>
    <bms:PartDescription>Front bumper cover</bms:PartDescription>
    <bms:LaborHours>1.5</bms:LaborHours>
    <bms:LaborAmount>120.00</bms:LaborAmount>
    <bms:TotalAmount>120.00</bms:TotalAmount>
  </bms:EstimateLineItem>
  <bms:EstimateLineItem>
    <bms:LineNumber>2</bms:LineNumber>
    <bms:Operation>Refinish</bms:Operation>
    <bms:PartDescription>Front bumper cover</bms:PartDescription>
    <bms:PaintHours>2.0</bms:PaintHours>
    <bms:PaintAmount>$160.00</bms:PaintAmount>
    <bms:TotalAmount>$160.00</bms:TotalAmount>
  </bms:EstimateLineItem>
</bms:VehicleDamageEstimateAddRq>`;

describe("CCC BMS normalizer", () => {
  it("normalizes estimate header fields from namespaced CCC BMS XML", () => {
    const estimate = normalizeCccBmsEstimate(SAMPLE_BMS_XML);

    expect(estimate.header).toMatchObject({
      rqUid: "rq-123",
      estimateNumber: "EST-42",
      claimNumber: "CLM-100",
      estimateDate: "2026-06-09",
      carrierName: "Example Carrier",
      shopName: "Example Collision",
    });
    expect(estimate.sourceConfidence).toBe("high_confidence_estimate_source");
  });

  it("normalizes line items without treating them as citation authority", () => {
    const estimate = normalizeCccBmsEstimate(SAMPLE_BMS_XML);

    expect(estimate.lineItems).toHaveLength(2);
    expect(estimate.lineItems[0]).toMatchObject({
      id: "ccc-line-1",
      lineNumber: "1",
      operation: "R&I",
      component: "Front bumper cover",
      laborHours: 1.5,
      laborAmount: 120,
      totalAmount: 120,
      evidenceCapabilities: ["line_item_exists", "line_item_changed"],
    });
    expect(estimate.lineItems[1]).toMatchObject({
      operation: "Refinish",
      paintHours: 2,
      paintAmount: 160,
    });
  });

  it("builds vehicle reconciliation input and jurisdiction evidence candidates", () => {
    const estimate = normalizeCccBmsEstimate(SAMPLE_BMS_XML);

    expect(estimate.vehicleReconciliationInput).toMatchObject({
      year: 2026,
      make: "TESL",
      model: "Model 3",
      vin: "5YJ3E1EA3TF150471",
      source: "attachment",
    });
    expect(estimate.jurisdictionEvidenceCandidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "lossState",
          value: "IL",
          proofCapability: "structured_estimate_metadata",
        }),
        expect.objectContaining({
          field: "carrierName",
          value: "Example Carrier",
        }),
      ])
    );
  });

  it("builds AI-safe estimate evidence context with explicit authority boundaries", () => {
    const context = normalizeCccBmsEstimateForAi(SAMPLE_BMS_XML);

    expect(context.authorityBoundary).toContain("estimate-source evidence only");
    expect(context.citationGapBoundary).toContain("OEM/P-page/DEG/legal support has not yet been verified");
    expect(context.allowedProofCapabilities).toContain("line_item_exists");
    expect(context.prohibitedProofCategories).toEqual(
      expect.arrayContaining([
        "oem_required_procedure",
        "p_page_inclusion_exclusion",
        "deg_inquiry_support",
        "legal_or_regulatory_obligation",
        "policy_coverage_or_exclusion",
        "carrier_violation",
      ])
    );
    expect(context.aiUse.mustNotUseFor).toContain("carrier violation proof");
  });

  it("does not log raw XML during normalization", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const rawXml = `${SAMPLE_BMS_XML}<OwnerName>Do Not Log</OwnerName>`;

    normalizeCccBmsEstimateForAi(rawXml);

    expect(JSON.stringify(infoSpy.mock.calls)).not.toContain(rawXml);
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(rawXml);
    expect(JSON.stringify(infoSpy.mock.calls)).not.toContain("Do Not Log");
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("Do Not Log");

    infoSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
