'use client';

import { useEffect, useRef, useState } from 'react';

export default function ChatbotIframe() {
  const [mounted, setMounted] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    setMounted(true);

    const handleMessage = (event: MessageEvent) => {
      if (event.data.type === 'resize' && iframeRef.current) {
        iframeRef.current.style.height = `${event.data.height}px`;
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  if (!mounted) return null;

  return (
    <iframe
      ref={iframeRef}
      src="/widget"
      title="Collision Academy Chat"
      className="w-[400px] sm:w-[500px] rounded-md shadow-lg"
      style={{ border: 'none', overflow: 'hidden' }}
    />
  );
}
