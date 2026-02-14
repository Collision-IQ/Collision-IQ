"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

export default function FloatingWidgetGate() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Launcher */}
      <button
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-6 right-6 z-[70] rounded-full bg-accent px-5 py-3 text-sm font-semibold text-black shadow-2xl hover:opacity-90"
      >
        {open ? "Close" : "Chat"}
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.98 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
            className={[
              "fixed z-[75] overflow-hidden border border-border bg-card shadow-2xl",
              "bottom-20 right-6",
              "w-[92vw] max-w-[420px] h-[70vh] max-h-[640px] rounded-3xl",
              "sm:w-[420px]",
            ].join(" ")}
          >
            <div className="flex items-center justify-between border-b border-border bg-black/20 px-4 py-3">
              <div className="text-sm font-semibold text-text">Collision IQ</div>
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg border border-border bg-white/5 px-2 py-1 text-xs text-text hover:bg-white/10"
              >
                Close
              </button>
            </div>

            <iframe
              src="/widget"
              title="Collision IQ Chat"
              className="h-[calc(100%-52px)] w-full border-none"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
