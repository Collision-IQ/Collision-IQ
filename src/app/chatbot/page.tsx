import Image from "next/image";
import ChatWidget from "@/components/ChatWidget";

export default function ChatbotPage() {
  return (
    <main className="relative min-h-screen bg-black">
      {/* Background logo */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-[0.04]">
        <Image
          src="/brand/logos/Logo-grey.png"
          alt="Collision Academy"
          width={600}
          height={120}
          priority
        />
      </div>

      {/* Foreground chat */}
      <div className="relative mx-auto max-w-4xl px-4 py-10">
        <h1 className="mb-4 text-center text-2xl font-semibold">
          Collision-IQ Chatbot
        </h1>

        <div className="h-[75vh] rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)]">
          <ChatWidget />
        </div>
      </div>
    </main>
  );
}
