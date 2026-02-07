"use client";

import ChatShell from "@/components/ChatShell";
import ChatWidget from "@/components/ChatWidget";

export default function ChatbotPage() {
  return (
    <ChatShell
      left={
        <aside className="rounded-3xl border border-white/10 bg-white/5 p-4">
          Collision Academy
        </aside>
      }
      center={
        <div className="flex min-h-0 flex-1 flex-col rounded-3xl border border-white/10 bg-white/5">
          <ChatWidget />
        </div>
      }
      right={
        <aside className="rounded-3xl border border-white/10 bg-white/5 p-4">
          Workspace
        </aside>
      }
    />
  );
}
