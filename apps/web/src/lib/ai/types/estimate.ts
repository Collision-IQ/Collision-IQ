export type RepairOperation = {
  operation: string;
  component: string;
  rawLine: string;
  laborHours?: number;
};

export type RepairFacts = {
  vehicle?: {
    year?: number;
    make?: string;
    model?: string;
    vin?: string;
  };
  operations: RepairOperation[];
  systems: string[];
  components: string[];
  proceduresMentioned: string[];
};
