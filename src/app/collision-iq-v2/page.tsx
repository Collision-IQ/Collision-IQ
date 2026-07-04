"use client";

import dynamic from "next/dynamic";

// V2 "Analysis Workspace" shell — same ChatbotPage logic/state/APIs, new
// presentational shell. The production "/" route stays on V1 until V2 is
// validated; this route is the opt-in preview.
const ChatbotPage = dynamic(() => import("@/components/ChatbotPage"), {
  ssr: false,
  loading: () => null,
});

export default function CollisionIqV2Page() {
  return <ChatbotPage shellVariant="v2" />;
}
