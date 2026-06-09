import { describe, expect, it, vi } from "vitest";
import { normalizeCccBmsEstimate } from "./bmsEstimateNormalizer";

const SAMPLE_XML = `<ns:VehicleDamageEstimateAddRq xmlns:ns="urn:cieca:bms">
  <ns:RqUID>xml-rq</ns:RqUID>
  <ns:DocumentID>DOC-7</ns:DocumentID>
  <ns:WorkfileID>WF-7</ns:WorkfileID>
  <ns:EstimateNumber>EST-7</ns:EstimateNumber>
  <ns:EstimateVersion>2</ns:EstimateVersion>
  <ns:SupplementNumber>1</ns:SupplementNumber>
  <ns:ClaimNumber>CLAIM-123456</ns:ClaimNumber>
  <ns:LossState>CA</ns:LossState>
  <ns:RepairFacilityName>Example Collision</ns:RepairFacilityName>
  <ns:RepairFacilityAddress1>10 Shop Way</ns:RepairFacilityAddress1>
  <ns:RepairFacilityCity>Los Angeles</ns:RepairFacilityCity>
  <ns:RepairFacilityState>CA</ns:RepairFacilityState>
  <ns:RepairFacilityZip>90001</ns:RepairFacilityZip>
  <ns:OwnerName>Example Owner</ns:OwnerName>
  <ns:OwnerAddress1>20 Owner St</ns:OwnerAddress1>
  <ns:OwnerCity>Los Angeles</ns:OwnerCity>
  <ns:OwnerState>CA</ns:OwnerState>
  <ns:OwnerZip>90002</ns:OwnerZip>
  <ns:InsuranceCompanyName>Example Carrier</ns:InsuranceCompanyName>
  <ns:VIN>1HGCM82633A004352</ns:VIN>
  <ns:ModelYear>2024</ns:ModelYear>
  <ns:Make>Honda</ns:Make>
  <ns:Model>Accord</ns:Model>
  <ns:Mileage>12345</ns:Mileage>
  <ns:GrossTotal>245.50</ns:GrossTotal>
  <ns:Tax>15.25</ns:Tax>
  <ns:EstimateLineItem>
    <ns:LineNumber>10</ns:LineNumber>
    <ns:Section>Front Lamps</ns:Section>
    <ns:Operation>Replace</ns:Operation>
    <ns:PartDescription>Headlamp assembly</ns:PartDescription>
    <ns:PartNumber>HL-123</ns:PartNumber>
    <ns:PartType>OEM</ns:PartType>
    <ns:Quantity>1</ns:Quantity>
    <ns:LaborHours>0.8</ns:LaborHours>
    <ns:UnitPrice>245.50</ns:UnitPrice>
    <ns:Tax>15.25</ns:Tax>
    <ns:IncludedFlag>false</ns:IncludedFlag>
    <ns:ManualEntry>true</ns:ManualEntry>
    <ns:TotalAmount>245.50</ns:TotalAmount>
  </ns:EstimateLineItem>
</ns:VehicleDamageEstimateAddRq>`;

describe("bmsEstimateNormalizer", () => {
  it("returns the requested normalized estimate envelope and source options", () => {
    const estimate = normalizeCccBmsEstimate(SAMPLE_XML, {
      environment: "sandbox",
      rqUid: "option-rq",
      appId: "1686",
      sourceEventId: "event-1",
    });

    expect(estimate).toMatchObject({
      sourceSystem: "ccc_secure_share_bms",
      evidenceLane: "estimate_evidence",
      sourceConfidence: "high",
      environment: "sandbox",
      appId: "1686",
      sourceEventId: "event-1",
      rqUid: "option-rq",
    });
  });

  it("normalizes identifiers with redacted and hashed claim number fields", () => {
    const estimate = normalizeCccBmsEstimate(SAMPLE_XML);

    expect(estimate.identifiers).toMatchObject({
      documentId: "DOC-7",
      workfileId: "WF-7",
      estimateVersion: "2",
      supplementNumber: "1",
      claimNumber: "CLAIM-123456",
      claimNumberRedacted: "********3456",
    });
    expect(estimate.identifiers.claimNumberHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("normalizes vehicle fields with VIN redaction and decode metadata", () => {
    const estimate = normalizeCccBmsEstimate(SAMPLE_XML);

    expect(estimate.vehicle).toMatchObject({
      vin: "1HGCM82633A004352",
      vinRedacted: "***********004352",
      vinTail: "004352",
      year: 2024,
      make: "Honda",
      model: "Accord",
      mileage: 12345,
      decoded: {
        attempted: true,
        source: "ccc_bms",
        confidence: "high",
        limitations: [],
      },
    });
  });

  it("normalizes parties, totals, jurisdiction evidence, and jurisdiction resolution", () => {
    const estimate = normalizeCccBmsEstimate(SAMPLE_XML);

    expect(estimate.parties.repairFacility).toMatchObject({
      name: "Example Collision",
      address1: "10 Shop Way",
      city: "Los Angeles",
      state: "CA",
      zip: "90001",
      hasRealAddressBlock: true,
    });
    expect(estimate.parties.owner).toMatchObject({
      name: "Example Owner",
      state: "CA",
      zip: "90002",
      hasRealAddressBlock: true,
    });
    expect(estimate.parties.insurer).toMatchObject({ name: "Example Carrier" });
    expect(estimate.totals).toMatchObject({
      grossTotal: 245.5,
      tax: 15.25,
    });
    expect(estimate.jurisdictionEvidence).toMatchObject({
      explicitState: "CA",
      ownerAddressState: "CA",
      ownerAddressZip: "90002",
      ownerAddressIsRealBlock: true,
      repairFacilityState: "CA",
      repairFacilityZip: "90001",
    });
    expect(estimate.jurisdictionResolution).toMatchObject({
      state: "CA",
      stateCode: "CA",
      source: "owner_zip",
      confidence: "high",
    });
  });

  it("normalizes line items into estimate evidence only", () => {
    const estimate = normalizeCccBmsEstimate(SAMPLE_XML);

    expect(estimate.lineItems).toHaveLength(1);
    expect(estimate.lineItems[0]).toMatchObject({
      sourceSystem: "ccc_secure_share_bms",
      evidenceLane: "estimate_evidence",
      sourceConfidence: "high",
      lineNumber: "10",
      section: "Front Lamps",
      operation: "Replace",
      description: "Headlamp assembly",
      partNumber: "HL-123",
      partType: "OEM",
      quantity: 1,
      laborHours: 0.8,
      unitPrice: 245.5,
      extendedAmount: 245.5,
      tax: 15.25,
      includedFlag: false,
      manualEntry: true,
      rawCategory: "Front Lamps",
      sourcePath: "/VehicleDamageEstimateAddRq/EstimateLineItem[1]",
      parseWarnings: [],
    });
  });

  it("does not throw on missing optional fields and returns parseWarnings and limitations", () => {
    const estimate = normalizeCccBmsEstimate(
      "<VehicleDamageEstimateAddRq><RqUID>rq</RqUID></VehicleDamageEstimateAddRq>"
    );

    expect(estimate.rqUid).toBe("rq");
    expect(estimate.lineItems).toEqual([]);
    expect(estimate.parseWarnings).toContain("No CCC BMS line item blocks were found.");
    expect(estimate.limitations).toEqual(
      expect.arrayContaining([
        "Claim number was not found in the CCC BMS XML.",
        "Vehicle identity fields were not found in the CCC BMS XML.",
        "Line items were not found in recognized CCC/CIECA BMS line item blocks.",
      ])
    );
    expect(estimate.vehicle.decoded).toMatchObject({
      attempted: false,
      source: "not_attempted",
      confidence: "unknown",
    });
  });

  it("does not classify owner name alone as an owner address ZIP", () => {
    const estimate = normalizeCccBmsEstimate(`<VehicleDamageEstimateAddRq>
      <RqUID>rq</RqUID>
      <OwnerName>Owner Name Only</OwnerName>
      <OwnerZip>90002</OwnerZip>
      <RepairFacilityName>Example Collision</RepairFacilityName>
      <RepairFacilityState>CA</RepairFacilityState>
      <RepairFacilityZip>90001</RepairFacilityZip>
    </VehicleDamageEstimateAddRq>`);

    expect(estimate.parties.owner).toMatchObject({
      name: "Owner Name Only",
      zip: "90002",
      hasRealAddressBlock: false,
    });
    expect(estimate.jurisdictionEvidence.ownerAddressIsRealBlock).toBe(false);
    expect(estimate.jurisdictionResolution).toMatchObject({
      state: "CA",
      source: "shop_zip_fallback",
      confidence: "medium",
    });
    expect(estimate.jurisdictionResolution?.basis).toContain(
      "CCC Secure Share estimate data"
    );
  });

  it("uses inspection site ZIP only as a medium-confidence fallback", () => {
    const estimate = normalizeCccBmsEstimate(`<VehicleDamageEstimateAddRq>
      <RqUID>rq</RqUID>
      <InspectionSiteName>Inspection Yard</InspectionSiteName>
      <InspectionSiteState>IL</InspectionSiteState>
      <InspectionSiteZip>60601</InspectionSiteZip>
    </VehicleDamageEstimateAddRq>`);

    expect(estimate.jurisdictionResolution).toMatchObject({
      state: "IL",
      stateCode: "IL",
      source: "inspection_site_zip_fallback",
      confidence: "medium",
    });
    expect(estimate.jurisdictionResolution?.basis).toContain(
      "Inspection Site ZIP from CCC Secure Share estimate data"
    );
  });

  it("does not let legal search result XML set jurisdiction", () => {
    const estimate = normalizeCccBmsEstimate(`<VehicleDamageEstimateAddRq>
      <RqUID>rq</RqUID>
      <LegalSearchResult>
        <PolicyState>TX</PolicyState>
        <LossState>TX</LossState>
      </LegalSearchResult>
    </VehicleDamageEstimateAddRq>`);

    expect(estimate.jurisdictionEvidence.explicitState).toBeNull();
    expect(estimate.jurisdictionEvidence.policyState).toBeNull();
    expect(estimate.jurisdictionResolution).toMatchObject({
      state: null,
      source: "unknown",
      confidence: "unknown",
    });
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
