"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

export default function FloatingWidgetGate() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-6 right-6 bg-[#C4512D] text-white px-5 py-3 rounded-full shadow-xl hover:opacity-90 transition"
      >
        Chat
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.98 }}
            transition={{ duration: 0.18 }}
            className="fixed bottom-20 right-6 w-[420px] h-[70vh] max-h-[640px] bg-[#0B0F14] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
              <div className="text-sm font-semibold text-white">
                Collision IQ
              </div>
              <button
                onClick={() => setOpen(false)}
                className="text-xs text-white/60 hover:text-white"
              >
                Close
              </button>
            </div>

            <iframe
              src="/widget"
              className="w-full h-[calc(100%-48px)] border-none"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
