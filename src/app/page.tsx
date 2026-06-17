"use client";

import dynamic from "next/dynamic";

const ChatbotPage = dynamic(() => import("@/components/ChatbotPage"), {
  ssr: false,
  loading: () => null,
});

export default function HomePage() {
  return <ChatbotPage />;
}
