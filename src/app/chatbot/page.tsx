"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import ChatWidget from "@/components/ChatWidget";
import { useIsMobile } from "@/hooks/useIsMobile";

export default function ChatbotPage() {
  return (
    <ChatShell
      title="Collision-IQ"
      subtitle="Upload an estimate, OEM procedure, or photo — get structured analysis instantly."
      logo={
        <Image
          src="/brand/logos/Logo-grey.png"
          alt="Collision Academy"
          width={160}
          height={40}
          className="opacity-90"
          priority
        />
      }
    >
      {/* Your existing widget stays exactly as-is */}
      <ChatWidget />
    </ChatShell>
  );
}
