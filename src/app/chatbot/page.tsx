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
        min-h-screen
        text-white
        relative
        overflow-hidden
        bg-black
        bg-[radial-gradient(circle_at_85%_15%,rgba(198,90,42,0.06),transparent_60%)]
      "
    >

      {/* WATERMARK */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center z-0">
        <img
          src="/brand/logos/Logo-grey.png"
          alt="Collision IQ Watermark"
          className="
            w-[500px] md:w-[900px]
            opacity-[0.045]
            grayscale
            blur-[0.5px]
            select-none
          "
        />
      </div>

      {/* BACK BUTTON */}
      <button
        onClick={() => router.push("/")}
        className="
          absolute top-4 left-4 z-50
          text-sm text-white/60
          hover:text-[#C65A2A]
          transition ease-out duration-200
        "
      >
        ← Back
      </button>

      {/* IDENTITY STRIP */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 text-center z-40">
        <div className="text-xs tracking-[0.35em] text-white/50 uppercase">
          Collision IQ
        </div>
        <div className="text-[10px] tracking-[0.3em] text-white/30 uppercase mt-1">
          AI Repair Analysis Workstation
        </div>
      </div>

      {!isMobile && (
        <div className="relative z-10 mx-auto max-w-[1600px] px-6 pt-20 pb-10 flex gap-8">

          {/* RAIL */}
          <div
            className={`transition-all ease-out duration-200 ${
              railOpen ? "w-[340px]" : "w-[60px]"
            }`}
          >
            <div
              className="
                h-[75vh]
                rounded-3xl
                border border-white/10
                bg-white/[0.03]
                backdrop-blur-2xl
                shadow-[0_20px_60px_rgba(0,0,0,0.6)]
                relative overflow-hidden
              "
            >

              <button
                type="button"
                onClick={() => setRailOpen(!railOpen)}
                className="
                  absolute -right-4 top-6 z-10
                  bg-black/60 border border-white/10
                  rounded-full p-2
                  hover:bg-[#C65A2A]/20
                  transition ease-out duration-200
                "
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

          {/* CHAT */}
          <div className="flex-1 flex justify-center">
            <div
              className="
                relative
                w-full max-w-[950px] h-[75vh]
                rounded-3xl
                border border-white/10
                bg-white/[0.02]
                backdrop-blur-3xl
                shadow-[0_30px_100px_rgba(0,0,0,0.7)]
                overflow-hidden
              "
            >
              <ChatWidget
                onAttachmentChange={setAttachment}
                onAnalysisChange={setAnalysisText}
              />
            </div>
          </div>
        </div>
      )}

      {isMobile && (
        <>
          {railOpen && (
            <div
              className="fixed inset-0 bg-black/50 z-40 transition ease-out duration-200"
              onClick={() => setRailOpen(false)}
            />
          )}

          <div
            className={`
              fixed top-0 left-0 h-full w-[85%] max-w-[360px]
              z-50
              border-r border-white/10
              bg-white/[0.04]
              backdrop-blur-3xl
              transition-transform ease-out duration-200
              ${railOpen ? "translate-x-0" : "-translate-x-full"}
            `}
          >
            <RailContent
              attachment={attachment}
              analysisText={analysisText}
            />
          </div>

          <div
            className="
              fixed inset-0 z-30 pt-16
              bg-transparent
              backdrop-blur-2xl
            "
          >
            <ChatWidget
              onAttachmentChange={setAttachment}
              onAnalysisChange={setAnalysisText}
            />
          </div>

          <button
            onClick={() => setRailOpen(true)}
            className="
              fixed bottom-6 left-6 z-50
              bg-[#C65A2A] text-black
              px-4 py-2 rounded-full
              shadow-lg
              hover:brightness-110
              transition ease-out duration-200
            "
          >
            Insights
          </button>
        </>
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
    <div className="h-full overflow-y-auto p-6 space-y-6">

      <div className="text-xs tracking-[0.3em] uppercase text-white/60">
        Analysis Panel
      </div>

      <div className="h-px w-full bg-gradient-to-r from-[#C65A2A]/40 via-transparent to-transparent" />

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl">
        <div className="text-[11px] tracking-widest uppercase text-white/60 mb-3">
          Preview
        </div>

        {attachment ? (
          <div className="text-sm text-white/80 break-words">
            Attached:
            <div className="mt-2 text-white">{attachment}</div>
          </div>
        ) : (
          <div className="text-sm text-white/40">
            Upload a PDF/photo and it will appear here.
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 backdrop-blur-xl">
        <div className="text-[11px] tracking-widest uppercase text-white/60 mb-3">
          Repair Insights
        </div>

        {analysisText?.trim() ? (
          <div className="text-sm text-white/80 whitespace-pre-wrap leading-relaxed">
            {analysisText}
          </div>
        ) : (
          <div className="text-sm text-white/40">
            The latest assistant output will populate here.
          </div>
        )}
      </div>
    </div>
  );
}
