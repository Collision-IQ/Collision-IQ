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
      className="w-full h-[85vh] sm:h-[700px] rounded-md shadow-lg"
      style={{
        border: 'none',
        overflow: 'hidden',
      }}
    />
  );
}
