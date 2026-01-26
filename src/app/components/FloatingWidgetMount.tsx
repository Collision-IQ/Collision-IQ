'use client';

import { useEffect, useState } from 'react';

export default function ChatbotIframe() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return (
    <iframe
      src="/widget"
      title="Collision Academy Chat"
      className="w-[400px] max-w-full h-[500px] sm:w-[500px] sm:h-[600px] rounded-md shadow-lg"
      style={{
        border: 'none',
        overflow: 'hidden',
      }}
    />
  );
}
