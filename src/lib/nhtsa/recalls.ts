import { fetchJsonWithRetry, type FetchJsonWithRetryOptions } from "./client";
import type { NhtsaRecall, RecallVehicleIdentity } from "./types";

const RECALLS_BASE = "https://api.nhtsa.gov/recalls/recallsByVehicle";

interface NhtsaRecallsResponse {
  Count: number;
  results: Array<{
    Manufacturer: string;
    NHTSACampaignNumber: string;
    Component: string;
    Summary: string;
    Consequence: string;
    Remedy: string;
    ReportReceivedDate: string;
  }>;
}

/**
 * Looks up recall campaigns for a vehicle's make/model/year.
 *
 * ACCURACY CAVEAT (every surface must carry it — see RECALL_MATCH_DISCLAIMER):
 * NHTSA's public recalls API matches on make/model/modelYear only. It does
 * not accept or confirm against a specific VIN, and some campaigns are scoped
 * to a production range, plant, or trim within a model year. A hit here means
 * "a recall was issued for vehicles like yours", never "your VIN is affected".
 */
export async function getRecallsForVehicle(
  { make, model, modelYear }: RecallVehicleIdentity,
  options?: FetchJsonWithRetryOptions
): Promise<NhtsaRecall[]> {
  const params = new URLSearchParams({ make, model, modelYear });
  const url = `${RECALLS_BASE}?${params.toString()}`;

  const data = await fetchJsonWithRetry<NhtsaRecallsResponse>(url, options);

  return (data.results ?? []).map((r) => ({
    campaignNumber: r.NHTSACampaignNumber ?? "",
    component: r.Component ?? "",
    summary: r.Summary ?? "",
    consequence: r.Consequence ?? "",
    remedy: r.Remedy ?? "",
    reportReceivedDate: r.ReportReceivedDate ?? "",
    manufacturer: r.Manufacturer ?? "",
  }));
}
