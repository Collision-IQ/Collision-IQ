// The V2 "Analysis Workspace" shell is a purely presentational shell around the
// existing ChatbotPage logic/state/APIs. It is now the default home ("/"); the
// V1 shell remains available as an instant, code-free rollback by setting
// NEXT_PUBLIC_WORKSPACE_V2=false.
export function isWorkspaceV1Forced(): boolean {
  return process.env.NEXT_PUBLIC_WORKSPACE_V2 === "false";
}

export type WorkspaceShellVariant = "v1" | "v2";
