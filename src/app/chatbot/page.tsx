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

  // Prevent hydration mismatch flash
  if (isMobile === null) return null;

  return (
    <div className="min-h-screen bg-black text-white relative overflow-hidden">

      {/* Back Button */}
      <button
        onClick={() => router.push("/")}
        className="absolute top-4 left-4 z-50 flex items-center gap-2 text-sm text-white/60 hover:text-[#C65A2A] transition"
      >
        ← Back
      </button>

      <div className="mx-auto max-w-[1600px] px-4 md:px-6 pt-16 pb-8 flex flex-col md:flex-row gap-6">

        {/* =========================
            SIDE RAIL
        ========================== */}

        {isMobile ? (
          <>
            {/* Overlay */}
            {railOpen && (
              <div
                className="fixed inset-0 bg-black/60 z-40"
                onClick={() => setRailOpen(false)}
              />
            )}

            {/* Slide Panel */}
            <div
              className={`fixed top-0 left-0 h-full w-[85%] max-w-[360px] z-50 bg-black border-r border-white/10 transition-transform duration-300 ${
                railOpen ? "translate-x-0" : "-translate-x-full"
              }`}
            >
              <RailContent
                attachment={attachment}
                analysisText={analysisText}
              />
            </div>

            {/* Mobile Toggle Button */}
            <button
              onClick={() => setRailOpen(true)}
              className="fixed bottom-6 left-6 z-50 bg-[#C65A2A] text-black px-4 py-2 rounded-full shadow-lg"
            >
              Insights
            </button>
          </>
        ) : (
          <div
            className={`transition-all duration-300 ${
              railOpen ? "w-[340px]" : "w-[60px]"
            }`}
          >
            <div className="h-[75vh] rounded-3xl border border-white/10 bg-black/40 backdrop-blur-xl shadow-[0_0_60px_rgba(0,0,0,0.6)] relative overflow-hidden">

              <button
                type="button"
                onClick={() => setRailOpen(!railOpen)}
                className="absolute -right-4 top-6 z-10 bg-black border border-white/10 rounded-full p-2 hover:bg-[#C65A2A]/20 transition"
              >
                {railOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
              </button>

              {railOpen && (
                <RailContent
                  attachment={attachment}
                  analysisText={analysisText}
                />
              )}
            </div>
          </div>
        )}

        {/* =========================
            CHAT CENTER
        ========================== */}

        <div className="flex-1 flex justify-center">
          <div className="w-full max-w-[900px] h-[70vh] md:h-[75vh] rounded-3xl border border-white/10 bg-black/40 backdrop-blur-xl shadow-[0_0_80px_rgba(0,0,0,0.8)] overflow-hidden">
            <ChatWidget
              onAttachmentChange={setAttachment}
              onAnalysisChange={setAnalysisText}
            />
          </div>
        </div>

      </div>
    </div>
  );
}

/* =========================
   RAIL CONTENT COMPONENT
========================= */

function RailContent({
  attachment,
  analysisText,
}: {
  attachment: string | null;
  analysisText: string;
}) {
  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      <div className="text-sm font-semibold text-white/90">
        Analysis Panel
      </div>

      <div className="rounded-2xl border border-white/10 bg-black/50 p-4">
        <div className="text-xs font-semibold text-white/80 mb-2">
          Preview
        </div>

        {attachment ? (
          <div className="text-sm text-white/80 break-words">
            Attached:
            <div className="mt-1 text-white">{attachment}</div>
          </div>
        ) : (
          <div className="text-sm text-white/50">
            Upload a PDF/photo and it will appear here.
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-white/10 bg-black/50 p-4">
        <div className="text-xs font-semibold text-white/80 mb-2">
          Repair Insights
        </div>

        {analysisText?.trim() ? (
          <div className="text-sm text-white/80 whitespace-pre-wrap leading-relaxed">
            {analysisText}
          </div>
        ) : (
          <div className="text-sm text-white/50">
            The latest assistant output will populate here.
          </div>
        )}
      </div>
    </div>
  );
}
