// src/app/components/FloatingWidgetMount.tsx
'use client';

import { useEffect, useState } from 'react';

export default function FloatingWidgetMount() {
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 z-50 rounded-full bg-[color:var(--accent)] text-black px-4 py-3 font-semibold shadow-lg hover:scale-105 transition"
      >
        💬 Chat
      </button>

      {/* Modal */}
      {open && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur flex items-center justify-center">
          <div className="relative w-full max-w-[420px] h-[80vh] md:h-[700px] bg-black rounded-2xl overflow-hidden border border-white/10 shadow-lg">
            <iframe
              src="/chatbot"
              className="w-full h-full"
              style={{ border: 'none' }}
              title="Collision Academy Chatbot"
            />
            <button
              onClick={() => setOpen(false)}
              className="absolute top-2 right-2 text-white bg-white/10 hover:bg-white/20 rounded-full p-1"
              aria-label="Close Chat"
            >
              ✕
            </button>
          </div>
        </div>
      )}
    </>
  );
}
