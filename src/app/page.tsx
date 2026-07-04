"use client";

import dynamic from "next/dynamic";
import { isWorkspaceV1Forced } from "@/lib/workspaceV2";

const ChatbotPage = dynamic(() => import("@/components/ChatbotPage"), {
  ssr: false,
  loading: () => null,
});

export default function HomePage() {
  // V2 "Analysis Workspace" is the default home. Instant rollback without a code
  // change: set NEXT_PUBLIC_WORKSPACE_V2=false to force the V1 shell.
  return <ChatbotPage shellVariant={isWorkspaceV1Forced() ? "v1" : "v2"} />;
}
