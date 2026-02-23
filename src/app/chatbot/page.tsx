"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import ChatWidget from "@/components/ChatWidget";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useIsMobile } from "@/hooks/useIsMobile";

export default function ChatbotPage() {
  const router = useRouter();
  const isMobile = useIsMobile();

  const [railOpen, setRailOpen] = useState(true);
  const [attachment, setAttachment] = useState<string | null>(null);
  const [analysisText, setAnalysisText] = useState<string>("");

  if (isMobile === null) return null;

  return (
    <div
      className="
        h-screen flex flex-col text-white relative
        bg-black
        bg-[radial-gradient(circle_at_85%_15%,rgba(198,90,42,0.06),transparent_60%)]
      "
    >
      {/* BACK */}
      <button
        onClick={() => router.push("/")}
        className="absolute top-6 left-6 text-sm text-white/60 hover:text-[#C65A2A] transition"
      >
        ← Back
      </button>

      {/* HEADER STRIP */}
      <div className="pt-24 pb-8 text-center">
        <div className="text-xs tracking-[0.35em] text-white/50 uppercase">
          Collision IQ
        </div>
        <div className="text-[10px] tracking-[0.3em] text-white/30 uppercase mt-2">
          AI Repair Analysis Workstation
        </div>
      </div>

      {/* MAIN CHAT SURFACE */}
      <div className="relative mx-auto w-full max-w-[1000px] px-6 flex-1 min-h-0">
        <ChatWidget
          onAttachmentChange={setAttachment}
          onAnalysisChange={setAnalysisText}
        />
      </div>

      {/* DESKTOP RAIL OVERLAY */}
      {!isMobile && (
        <>
          <button
            onClick={() => setRailOpen(!railOpen)}
            className="
              fixed top-24 right-6 z-50
              bg-black/60 border border-white/10
              rounded-full p-3
              hover:bg-[#C65A2A]/20
              transition
            "
          >
            {railOpen ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>

          <div
            className={`
              fixed top-0 right-0 h-full w-[380px]
              bg-black/80 backdrop-blur-2xl
              border-l border-white/10
              transition-transform duration-300
              ${railOpen ? "translate-x-0" : "translate-x-full"}
            `}
          >
            <RailContent
              attachment={attachment}
              analysisText={analysisText}
            />
          </div>
        </>
      )}

      {/* MOBILE RAIL */}
      {isMobile && railOpen && (
        <div
          className="
            fixed inset-0 z-50
            bg-black/70 backdrop-blur-xl
          "
        >
          <RailContent
            attachment={attachment}
            analysisText={analysisText}
          />
        </div>
      )}
    </div>
  );
}

/* RAIL CONTENT */

function RailContent({
  attachment,
  analysisText,
}: {
  attachment: string | null;
  analysisText: string;
}) {
  return (
    <div className="h-full overflow-y-auto p-6 space-y-8">
      <div className="text-xs tracking-[0.3em] uppercase text-white/60">
        Analysis Panel
      </div>

      <div className="space-y-4">
        <div className="text-[11px] uppercase text-white/40">Preview</div>
        <div className="text-sm text-white/80 break-words">
          {attachment || "No attachment uploaded."}
        </div>
      </div>

      <div className="space-y-4">
        <div className="text-[11px] uppercase text-white/40">
          Repair Insights
        </div>
        <div className="text-sm text-white/80 whitespace-pre-wrap leading-relaxed">
          {analysisText || "Assistant output will appear here."}
        </div>
      </div>
    </div>
  );
}
