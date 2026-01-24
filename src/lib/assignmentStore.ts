// src/lib/assignmentStore.ts
export type AssignmentState = {
  threadId: string;
  vectorStoreId: string;
};

const store = new Map<string, AssignmentState>();

export function getAssignment(id: string) {
  return store.get(id);
}

export function setAssignment(id: string, state: AssignmentState) {
  store.set(id, state);
}
