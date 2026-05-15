export type EvidenceRecord = {
  id: string;
  title: string;
  snippet: string;
  source: string;
  authority: "oem" | "internal" | "inferred";
};
