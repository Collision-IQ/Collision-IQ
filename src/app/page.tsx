"use client";

import dynamic from "next/dynamic";
import { isWorkspaceV2Enabled } from "@/lib/workspaceV2";

const ChatbotPage = dynamic(() => import("@/components/ChatbotPage"), {
  ssr: false,
  loading: () => null,
});

export default function HomePage() {
  // Production stays on the V1 shell; the V2 workspace is opt-in via
  // NEXT_PUBLIC_WORKSPACE_V2=true (or the /collision-iq-v2 route).
  return <ChatbotPage shellVariant={isWorkspaceV2Enabled() ? "v2" : "v1"} />;
}
