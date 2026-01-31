'use client';

import { useState } from 'react';

export default function FloatingWidget() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Toggle Button */}
      <button
        onClick={() => setOpen((prev) => !prev)}
        className="fixed bottom-6 right-6 z-50 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-full shadow-lg transition-all"
      >
        {open ? 'Close' : 'Chat'}
      </button>

      {/* Floating Iframe */}
      {open && (
        <div className="fixed bottom-20 right-6 z-40 w-[360px] h-[500px] max-h-[80vh] bg-white dark:bg-black rounded-xl overflow-hidden shadow-2xl border border-gray-300 dark:border-gray-700">
          <iframe
            src="/widget"
            title="Collision Academy Chat"
            className="w-full h-full border-none"
            sandbox="allow-scripts allow-same-origin allow-modals"
          />
        </div>
      )}
    </>
  );
}
