import ChatWidget from "@/components/ChatWidget";

export default function ChatbotPage() {
  return (
    <main className="relative min-h-screen overflow-hidden">

      {/* 🔥 BACKGROUND GRADIENT — SAFE (no logic touched) */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,90,0,0.25),transparent_55%)]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_bottom,rgba(255,120,0,0.15),transparent_60%)]" />
      </div>

      {/* HEADER */}
      <div className="mx-auto max-w-6xl px-4 pt-16 text-center">
        <h1 className="text-3xl font-semibold tracking-tight">
          Collision-IQ Chatbot
        </h1>

        <p className="mt-2 text-sm text-[color:var(--muted)]">
          Upload estimates, OEM procedures, or photos — get structured analysis instantly.
        </p>
      </div>

      {/* 🔥 GLASS PANEL REDESIGN — VISUAL ONLY */}
      <div className="relative z-10 mx-auto mt-10 max-w-5xl px-4 pb-24">

        <div className="rounded-3xl border border-[color:var(--border)] bg-[color:var(--card)]/70 backdrop-blur-xl shadow-[0_0_80px_rgba(255,90,0,0.12)] overflow-hidden">

          {/* TOP ACCENT BAR */}
          <div className="h-1 w-full bg-gradient-to-r from-transparent via-[color:var(--accent)] to-transparent" />

          <div className="p-4 md:p-6">

            {/* 🚫 IMPORTANT:
                DO NOT pass fullPage prop
                Widget already handles layout internally
            */}
            <ChatWidget />

          </div>
        </div>
      </div>
    </main>
  );
}
