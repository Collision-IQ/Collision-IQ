"use client";

import { useState } from "react";
import ChatWidget from "@/components/ChatWidget";
import { ChevronLeft, ChevronRight } from "lucide-react";

export default function ChatbotPage() {
  const [railOpen, setRailOpen] = useState(true);

  // Side rail data fed by ChatWidget
  const [attachment, setAttachment] = useState<string | null>(null);
  const [analysisText, setAnalysisText] = useState<string>("");

  return (
    <div className="min-h-screen bg-black text-white relative overflow-hidden">
      <div className="mx-auto max-w-[1600px] px-6 py-8 flex gap-6">
        {/* Left collapsible rail */}
        <div
          className={`transition-all duration-300 ${
            railOpen ? "w-[340px]" : "w-[60px]"
          }`}
        >
          <div className="h-[75vh] rounded-3xl border border-white/10 bg-black/40 backdrop-blur-xl shadow-[0_0_60px_rgba(0,0,0,0.6)] relative overflow-hidden">
            <button
              type="button"
              onClick={() => setRailOpen(!railOpen)}
              className="absolute -right-4 top-6 z-10 bg-black border border-white/10 rounded-full p-2 hover:bg-orange-500/20 transition"
              aria-label="Toggle panel"
            >
              {railOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
            </button>

            {railOpen && (
              <div className="h-full overflow-y-auto p-4 space-y-4">
                <div className="text-sm font-semibold text-white/90">
                  Analysis Panel
                </div>

                {/* Preview card */}
                <div className="rounded-2xl border border-white/10 bg-black/50 p-4">
                  <div className="text-xs font-semibold text-white/80 mb-2">
                    Preview
                  </div>
                  {attachment ? (
                    <div className="text-sm text-white/80 break-words">
                      Attached: <span className="text-white">{attachment}</span>
                    </div>
                  ) : (
                    <div className="text-sm text-white/50">
                      Upload a PDF/photo and it will appear here.
                    </div>
                  )}
                </div>

                {/* Insights card */}
                <div className="rounded-2xl border border-white/10 bg-black/50 p-4">
                  <div className="text-xs font-semibold text-white/80 mb-2">
                    Repair Insights
                  </div>
                  {analysisText?.trim() ? (
                    <div className="text-sm text-white/80 whitespace-pre-wrap">
                      {analysisText}
                    </div>
                  ) : (
                    <div className="text-sm text-white/50">
                      The latest assistant output will populate here.
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Center chat */}
        <div className="flex-1 flex justify-center">
          <div className="w-full max-w-[900px] h-[75vh] rounded-3xl border border-white/10 bg-black/40 backdrop-blur-xl shadow-[0_0_80px_rgba(0,0,0,0.8)] overflow-hidden">
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
