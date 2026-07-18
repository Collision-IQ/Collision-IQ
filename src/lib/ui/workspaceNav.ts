"use client";

/**
 * Cross-component request to switch the workspace shell's left-nav section
 * (e.g. the "Reports ready" toast opening the Reports tab). Decoupled via a
 * window event because the requester and the shell sit in different subtrees.
 */
export const WORKSPACE_NAV_EVENT = "collisioniq:workspace:nav";

export type WorkspaceNavDetail = { section: string };

export function requestWorkspaceNav(section: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<WorkspaceNavDetail>(WORKSPACE_NAV_EVENT, { detail: { section } })
  );
}
