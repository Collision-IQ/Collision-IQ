export type FindingSeverity = "low" | "medium" | "high";

export type FindingCategory = "risk" | "process" | "gap" | "optimization";

export interface Finding {
  title: string;
  severity: FindingSeverity;
  category: FindingCategory;
  explanation: string;
}

export type ChatFinding = Finding;
