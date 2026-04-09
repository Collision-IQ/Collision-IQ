import type { ReactNode } from "react";

export default function ChatbotLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="h-screen bg-black text-white flex flex-col overflow-hidden relative">

      {/* ------------------------------------------------ */}
      {/* Ambient background lighting (very subtle)       */}
      {/* ------------------------------------------------ */}

      <div className="pointer-events-none fixed inset-0 z-0">

        {/* Collision IQ glow */}
        <div className="absolute -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-[#C65A2A]/10 blur-3xl" />

        {/* soft secondary glow */}
        <div className="absolute bottom-[-300px] right-[-200px] h-[500px] w-[500px] rounded-full bg-white/5 blur-3xl" />

      </div>

      {/* ------------------------------------------------ */}
      {/* Subtle grid texture (adds depth)                */}
      {/* ------------------------------------------------ */}

      <div
        className="chat-grid pointer-events-none fixed inset-0 opacity-[0.04] z-0"
      />

      {/* ------------------------------------------------ */}
      {/* Main App Container                              */}
      {/* ------------------------------------------------ */}

      <div className="relative z-10 flex-1 min-h-0 mx-auto w-full max-w-[1600px] px-6">

        {children}

      </div>

    </div>
  );
}
