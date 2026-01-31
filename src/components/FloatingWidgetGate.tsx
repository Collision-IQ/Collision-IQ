'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

export default function FloatingWidgetGate() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Floating launcher button */}
      <button
        onClick={() => setOpen(!open)}
        className="fixed bottom-6 right-6 z-40 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-full shadow-lg"
      >
        {open ? 'Close Chat' : 'Chat'}
      </button>

      {/* Chat Widget */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 50, scale: 0.95 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="fixed bottom-20 right-6 z-50 w-full max-w-md h-[600px] rounded-xl shadow-2xl bg-black text-white border border-white/10 overflow-hidden flex flex-col"
          >
            <iframe
              src="/widget"
              title="Chat"
              className="w-full h-full border-none"
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
