import { describe, expect, it, vi } from "vitest";
import { normalizeCccBmsEstimate } from "./bmsEstimateNormalizer";

const SAMPLE_XML = `<ns:VehicleDamageEstimateAddRq xmlns:ns="urn:cieca:bms">
  <ns:RqUID>xml-rq</ns:RqUID>
  <ns:EstimateNumber>EST-7</ns:EstimateNumber>
  <ns:ClaimNumber>CLAIM-7</ns:ClaimNumber>
  <ns:LossState>CA</ns:LossState>
  <ns:VIN>1HGCM82633A004352</ns:VIN>
  <ns:ModelYear>2024</ns:ModelYear>
  <ns:Make>Honda</ns:Make>
  <ns:Model>Accord</ns:Model>
  <ns:EstimateLineItem>
    <ns:LineNumber>10</ns:LineNumber>
    <ns:Operation>Replace</ns:Operation>
    <ns:PartDescription>Headlamp assembly</ns:PartDescription>
    <ns:LaborHours>0.8</ns:LaborHours>
    <ns:TotalAmount>245.50</ns:TotalAmount>
  </ns:EstimateLineItem>
</ns:VehicleDamageEstimateAddRq>`;

describe("bmsEstimateNormalizer", () => {
  it("exports the requested normalizer API and preserves source options", () => {
    const estimate = normalizeCccBmsEstimate(SAMPLE_XML, {
      environment: "sandbox",
      rqUid: "option-rq",
      appId: "1686",
      sourceEventId: "event-1",
    });

    expect(estimate).toMatchObject({
      sourceSystem: "ccc_secure_share_bms",
      sourceConfidence: "high_confidence_estimate_source",
      environment: "sandbox",
      appId: "1686",
      sourceEventId: "event-1",
      rqUid: "option-rq",
    });
    expect(estimate.header.rqUid).toBe("option-rq");
  });

  it("handles XML namespaces and CCC/CIECA line item variation", () => {
    const estimate = normalizeCccBmsEstimate(SAMPLE_XML);

    expect(estimate.header).toMatchObject({
      rqUid: "xml-rq",
      estimateNumber: "EST-7",
      claimNumber: "CLAIM-7",
    });
    expect(estimate.lineItems[0]).toMatchObject({
      lineNumber: "10",
      operation: "Replace",
      component: "Headlamp assembly",
      laborHours: 0.8,
      totalAmount: 245.5,
    });
  });

  it("does not throw on missing optional fields and returns warnings and limitations", () => {
    const estimate = normalizeCccBmsEstimate("<VehicleDamageEstimateAddRq><RqUID>rq</RqUID></VehicleDamageEstimateAddRq>");

    expect(estimate.rqUid).toBe("rq");
    expect(estimate.vehicleReconciliationInput).toBeNull();
    expect(estimate.lineItems).toEqual([]);
    expect(estimate.warnings).toContain("No CCC BMS line item blocks were found.");
    expect(estimate.limitations).toEqual(
      expect.arrayContaining([
        "Claim number was not found in the CCC BMS XML.",
        "Vehicle identity fields were not found in the CCC BMS XML.",
        "Line items were not found in recognized CCC/CIECA BMS line item blocks.",
      ])
    );
  });

  it("returns AI-safe context that does not treat CCC as citation authority", () => {
    const estimate = normalizeCccBmsEstimate(SAMPLE_XML);

    expect(estimate.evidenceBoundary.authorityBoundary).toContain(
      "estimate-source evidence only"
    );
    expect(estimate.aiContext.prohibitedProofCategories).toEqual(
      expect.arrayContaining([
        "oem_required_procedure",
        "p_page_inclusion_exclusion",
        "deg_inquiry_support",
        "legal_or_regulatory_obligation",
        "policy_coverage_or_exclusion",
        "carrier_violation",
      ])
    );
  });

  it("never logs raw XML", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const rawXml = `${SAMPLE_XML}<OwnerName>Do Not Log</OwnerName>`;

    normalizeCccBmsEstimate(rawXml);

    expect(JSON.stringify(infoSpy.mock.calls)).not.toContain(rawXml);
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain(rawXml);
    expect(JSON.stringify(infoSpy.mock.calls)).not.toContain("Do Not Log");
    expect(JSON.stringify(warnSpy.mock.calls)).not.toContain("Do Not Log");

    infoSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
