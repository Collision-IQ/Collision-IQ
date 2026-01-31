"use client";

import { useEffect, useState } from "react";
import ChatWidget from "./ChatWidget";

export default function WidgetClient() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <div className="w-full h-full">
      <ChatWidget />
    </div>
  );
}
