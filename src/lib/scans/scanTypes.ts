// Scan IQ — types for the pre/post diagnostic-scan pipeline (Pro-only).
// Parsing and comparison are deterministic; MOTOR enrichment is optional and
// clearly labeled (sandbox coverage is limited — see motorSandboxCoverage).

export type ScanSide = "pre" | "post";

export type DtcStatus =
  | "active"
  | "stored"
  | "pending"
  | "history"
  | "permanent"
  | "intermittent"
  | "cleared"
  | "unknown";

export type DtcRecord = {
  /** Exact code as written in the scan, e.g. "P0301", "U0121-00", "B1342:08". */
  code: string;
  /** Canonical code for matching (uppercased, suffix stripped), e.g. "P0301". */
  normalizedCode: string;
  module: string | null;
  originalDescription: string | null;
  status: DtcStatus;
  /** Which uploaded file the code came from. */
  sourceFile: string;
  side: ScanSide;
  /** 1-based line index in the extracted text, when available. */
  lineReference: number | null;
};

export type ParsedScanReport = {
  side: ScanSide;
  sourceFile: string;
  vin: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  scanDate: string | null;
  scannerVendor: string | null;
  modules: string[];
  dtcs: DtcRecord[];
  warnings: string[];
  /** True when no scan-like content could be extracted at all. */
  unreadable: boolean;
};

export type DtcChangeType = "cleared" | "remaining" | "new" | "unknown";

export type MotorLookupStatus =
  | "vehicle-specific-sandbox"
  | "general-reference"
  | "unavailable"
  | "not-configured"
  | "error"
  | "skipped";

export type MotorSourceMetadata = {
  sourceVendor: "MOTOR";
  sourceSystem: "DaaS Sandbox";
  sourceMode: "vehicle-specific-sandbox" | "general-reference";
  apiVersion?: string | null;
  databaseVersion?: string | null;
  motorVehicleId?: number | null;
  vcdbBaseVehicleId?: number | null;
  route?: string | null;
  retrievedAt: string;
  sourceReferenceId?: string | null;
  confidence: "high" | "medium" | "low";
};

export type DtcComparison = {
  code: string;
  module: string | null;
  preStatus: DtcStatus | null;
  postStatus: DtcStatus | null;
  changeType: DtcChangeType;
  originalDescription: string | null;
  normalizedDescription: string | null;
  motorLookupStatus: MotorLookupStatus;
  motorSource?: MotorSourceMetadata | null;
  repairRelevance: string;
  evidence: {
    preSourceFile: string | null;
    postSourceFile: string | null;
    preLineReference: number | null;
    postLineReference: number | null;
  };
};

export type ScanComparisonSummary = {
  clearedCount: number;
  remainingCount: number;
  newCount: number;
  unknownCount: number;
  modulesOnlyInPre: string[];
  modulesOnlyInPost: string[];
};

export type ScanIqComparison = {
  pre: ParsedScanReport;
  post: ParsedScanReport;
  rows: DtcComparison[];
  summary: ScanComparisonSummary;
};
