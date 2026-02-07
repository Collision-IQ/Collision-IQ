"use client";

import React, { useCallback, useRef } from "react";
import type { ChatWidgetApi } from "@/components/ChatWidget";

type Props = {
  children: (setApi: (api: ChatWidgetApi) => void) => React.ReactNode;
};

export default function ChatShell({ children }: Props) {
  const apiRef = useRef<ChatWidgetApi | null>(null);

  // IMPORTANT: safe ref write (happens when child calls it, not during render)
  const setApi = useCallback((api: ChatWidgetApi) => {
    apiRef.current = api;
  }, []);

  return (
    <div className="min-h-[100svh] w-full bg-black text-white overflow-hidden">
      {/* soft vignette */}
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top,_rgba(255,255,255,.08),transparent_55%)]" />
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_center,_rgba(0,0,0,.65),transparent_60%)]" />

      <div className="relative mx-auto grid h-[100svh] max-w-7xl grid-cols-1 gap-6 px-4 py-6 lg:grid-cols-[280px_1fr_320px]">
        {/* eslint-disable-next-line react-hooks/refs */}
        {children(setApi)}
      </div>
    </div>
  );
}
