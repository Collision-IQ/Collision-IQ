"use client";

import { AnimatePresence, motion } from "framer-motion";

interface FloatingWidgetGateProps {
  open: boolean;
  setOpen: (value: boolean) => void;
  onClose: () => void;
}

export default function FloatingWidgetGate({
  open,
  setOpen,
  onClose,
}: FloatingWidgetGateProps) {
  return (
    <>
      {/* Bubble Button (Always Visible) */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 left-6 z-50 h-14 w-14 rounded-full bg-[#C65A2A] text-black font-bold shadow-2xl hover:scale-105 transition-all"
        >
          IQ
        </button>
      )}

      {/* Panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 40, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 40, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className="fixed bottom-6 left-6 z-50 w-[380px] max-w-[90vw] rounded-3xl border border-white/10 bg-black/95 shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <div className="text-sm font-semibold text-white">
                Collision IQ
              </div>
              <button
                onClick={onClose}
                className="text-white/60 hover:text-white"
              >
                ✕
              </button>
            </div>

            {/* Body (iframe or chat mount) */}
            <div className="h-[500px] w-full overflow-hidden rounded-b-3xl">
              <iframe
                src="/chatbot"
                title="Collision IQ"
                className="h-full w-full border-none"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
