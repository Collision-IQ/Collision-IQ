"use client";

import { useState } from "react";

export default function FloatingWidget() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{
          position: "fixed",
          bottom: 20,
          right: 20,
          zIndex: 9999,
          background: "#f97316",
          color: "#111827",
          borderRadius: "999px",
          padding: "14px 18px",
          fontWeight: 800,
          boxShadow: "0 10px 30px rgba(0,0,0,.35)",
        }}
      >
        Chat
      </button>

      {open && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,.5)",
            zIndex: 9998,
          }}
          onClick={() => setOpen(false)}
        />
      )}

      {open && (
        <div
          style={{
            position: "fixed",
            bottom: 20,
            right: 20,
            width: 420,
            height: 640,
            background: "#0b0f14",
            borderRadius: 16,
            overflow: "hidden",
            zIndex: 9999,
            boxShadow: "0 20px 60px rgba(0,0,0,.5)",
          }}
        >
          <iframe src="/widget" style={{ width: "100%", height: "100%", border: 0 }} />
        </div>
      )}
    </>
  );
}
