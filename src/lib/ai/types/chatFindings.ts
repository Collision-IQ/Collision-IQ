export type ChatFindingSeverity = "low" | "medium" | "high";

export type ChatFindingCategory =
  | "missing_operation"
  | "compliance"
  | "risk"
  | "optimization";

export interface ChatFinding {
  title: string;
  severity: ChatFindingSeverity;
  category: ChatFindingCategory;
  explanation: string;
}
