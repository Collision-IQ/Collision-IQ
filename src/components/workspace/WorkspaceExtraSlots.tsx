"use client";

import { createContext, useContext, type ReactNode } from "react";

/**
 * Extra workspace slots threaded AROUND ChatShell instead of through its
 * props. ChatShell is deliberately left untouched (it carries in-progress
 * work), so new slots reach CollisionWorkspaceV2 via this context; the
 * shell's direct props win when both are provided.
 */
type WorkspaceExtraSlots = {
  /** Dedicated Reports tab content (the live report cards, full width). */
  reportsPanel?: ReactNode;
};

const WorkspaceExtraSlotsContext = createContext<WorkspaceExtraSlots>({});

export function WorkspaceExtraSlotsProvider({
  reportsPanel,
  children,
}: WorkspaceExtraSlots & { children: ReactNode }) {
  return (
    <WorkspaceExtraSlotsContext.Provider value={{ reportsPanel }}>
      {children}
    </WorkspaceExtraSlotsContext.Provider>
  );
}

export function useWorkspaceExtraSlots(): WorkspaceExtraSlots {
  return useContext(WorkspaceExtraSlotsContext);
}
