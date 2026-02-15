"use client";

import { useState } from "react";
import ChatWidget from "@/components/ChatWidget";
import WorkspacePanel from "@/components/WorkspacePanel";
import { ChevronLeft, ChevronRight } from "lucide-react";

export default function ChatbotPage() {
  const [railOpen, setRailOpen] = useState(true);

  return (
    <div className="flex gap-6 h-[75vh]">

      {/* Collapsible Rail */}
      <div
        className={`transition-all duration-300 ${
          railOpen ? "w-[340px]" : "w-[60px]"
        }`}
      >
        <div className="h-full rounded-3xl border border-white/10 bg-black/40 backdrop-blur-xl shadow-[0_0_60px_rgba(0,0,0,0.6)] relative">

          {/* Toggle Button */}
          <button
            onClick={() => setRailOpen(!railOpen)}
            className="absolute -right-4 top-6 z-10 bg-black border border-white/10 rounded-full p-2 hover:bg-orange-500/20 transition"
            aria-label="Toggle panel"
          >
            {railOpen ? (
              <ChevronLeft size={16} />
            ) : (
              <ChevronRight size={16} />
            )}
          </button>

          {railOpen && (
            <div className="h-full overflow-y-auto p-4">
              <WorkspacePanel variant="left" />
            </div>
          )}
        </div>
      </div>

      {/* Center Chat */}
      <div className="flex-1 flex justify-center">
        <div className="w-full max-w-[900px] h-full rounded-3xl border border-white/10 bg-black/40 backdrop-blur-xl shadow-[0_0_80px_rgba(0,0,0,0.8)]">
          <ChatWidget />
        </div>
      </div>

    </div>
  );
}
