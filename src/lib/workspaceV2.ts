// Feature flag for the V2 "Analysis Workspace" shell. The V2 UI is a purely
// presentational shell around the existing ChatbotPage logic/state/APIs — it is
// opt-in via NEXT_PUBLIC_WORKSPACE_V2=true or the /collision-iq-v2 route, and the
// production `/` route stays on the V1 shell until V2 is validated.
export function isWorkspaceV2Enabled(): boolean {
  return process.env.NEXT_PUBLIC_WORKSPACE_V2 === "true";
}

export type WorkspaceShellVariant = "v1" | "v2";
