// src/app/chatbot/page.tsx

'use client';

export default function ChatbotPage() {
  return (
    <div className="flex h-screen w-screen flex-col bg-black text-white">
      <header className="p-4 border-b border-white/10">
        <h1 className="text-xl font-semibold">Collision-IQ Chat</h1>
        <p className="text-sm text-white/50">Chat is loading in an embedded widget.</p>
      </header>

      <div className="flex-1 overflow-auto p-4">
        <iframe
          src="/widget"
          className="w-full h-full border-none rounded-xl"
          title="Collision Academy Chat"
        />
      </div>
    </div>
  );
}
