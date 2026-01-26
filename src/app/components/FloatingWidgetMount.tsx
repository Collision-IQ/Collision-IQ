'use client';
import { useEffect, useState } from 'react';

export default function ChatbotIframe() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  return (
    <iframe
      src="/widget"
      className="h-full w-full"
      style={{ border: "none" }}
      title="Collision Academy Chat"
    />
  );
}
