"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import ChatWidget from "@/components/ChatWidget";
import { useIsMobile } from "@/hooks/useIsMobile";

export default function ChatbotPage() {
  const isMobile = useIsMobile();
  const [railOpen, setRailOpen] = useState(false);
  const [attachment, setAttachment] = useState<string | null>(null);
  const [analysisText, setAnalysisText] = useState<string>("");

  // Keep rail state predictable when switching viewport modes
  useEffect(() => {
    if (isMobile === null) return;
    setRailOpen(false);
  }, [isMobile]);

  // Prevent background scroll when mobile rail is open
  useEffect(() => {
    if (!isMobile) return;
    document.body.style.overflow = railOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isMobile, railOpen]);

  if (isMobile === null) return null;

  return (
    <div className="min-h-screen bg-black text-white">
      <div className="mx-auto flex min-h-screen w-full max-w-[1400px] flex-col px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-6 space-y-3">
          <Image
            src="/brand/logos/Logo-grey.png"
            alt="Collision Academy"
            width={160}
            height={40}
            className="opacity-90"
            priority
          />
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              Collision-IQ
            </h1>
            <p className="max-w-3xl text-sm text-white/70">
              Upload an estimate, OEM procedure, or photo — get structured
              analysis instantly.
            </p>
          </div>
        </header>

        {/* Main Content Area */}
        <div className="relative mx-auto w-full max-w-[1000px] flex-1 min-h-0">
          <ChatWidget
            onAttachmentChange={setAttachment}
            onAnalysisChange={setAnalysisText}
          />
        </div>

        {/* Desktop Rail Toggle (always reachable) */}
        {!isMobile && (
          <button
            onClick={() => setRailOpen((v) => !v)}
            aria-label={railOpen ? "Close analysis panel" : "Open analysis panel"}
            className={`
              fixed top-24 z-[60]
              bg-black/60 border border-white/10
              p-2 rounded-l-md text-white/60 hover:text-white
              transition-all duration-300
              ${railOpen ? "right-[380px]" : "right-0"}
            `}
          >
            {railOpen ? "→" : "←"}
          </button>
        )}

        {/* Desktop Rail Overlay */}
        {!isMobile && (
          <div
            className={`
              fixed top-0 right-0 h-full w-[380px]
              bg-black/80 backdrop-blur-2xl
              border-l border-white/10
              transition-transform duration-300 z-50
              ${railOpen ? "translate-x-0" : "translate-x-full"}
            `}
          >
            <RailContent
              attachment={attachment}
              analysisText={analysisText}
            />
          </div>
        )}

        {/* Mobile open button */}
        {isMobile && !railOpen && (
          <button
            onClick={() => setRailOpen(true)}
            aria-label="Open analysis panel"
            className="fixed bottom-6 right-6 z-50 rounded-full bg-black/70 border border-white/20 px-4 py-2 text-white/90"
          >
            Insights
          </button>
        )}

        {/* Mobile Rail Overlay */}
        {isMobile && railOpen && (
          <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xl">
            <button
              onClick={() => setRailOpen(false)}
              className="absolute top-4 right-4 text-white text-xl"
              aria-label="Close analysis panel"
            >
              ✕
            </button>
            <RailContent
              attachment={attachment}
              analysisText={analysisText}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/* RAIL CONTENT - Kept from original to preserve analysis logic */

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