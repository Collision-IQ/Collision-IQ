'use client';

import '@/lib/auth/assertClientClerk';
import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import FloatingWidget from '@/components/FloatingWidget';
import { onBackButton, isNative, exitApp } from '@/lib/native';

const EXIT_PROMPT_WINDOW_MS = 2000;

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const showWidget = !pathname.startsWith('/widget');
  const [showExitPrompt, setShowExitPrompt] = useState(false);
  const lastHomeBackPressRef = useRef(0);

  // Android hardware back button — on the home page, require two presses within
  // the exit window to close the app (matches standard Android back behavior).
  // Anywhere else, navigate back as usual.
  useEffect(() => {
    if (!isNative()) return;
    const off = onBackButton(() => {
      const isHome = pathname === '/';
      if (!isHome) {
        router.back();
        return;
      }

      const now = Date.now();
      if (now - lastHomeBackPressRef.current < EXIT_PROMPT_WINDOW_MS) {
        void exitApp();
        return;
      }

      lastHomeBackPressRef.current = now;
      setShowExitPrompt(true);
      window.setTimeout(() => setShowExitPrompt(false), EXIT_PROMPT_WINDOW_MS);
    });
    return off;
  }, [router, pathname]);

  return (
    <>
      {children}
      {showWidget && <FloatingWidget />}
      {showExitPrompt && (
        <div
          role="status"
          aria-live="polite"
          className="
            fixed bottom-24 left-1/2 z-[80] -translate-x-1/2
            rounded-full px-4 py-2
            bg-black/80 text-white text-sm font-medium
            shadow-[0_10px_30px_rgba(0,0,0,0.5)]
            backdrop-blur-sm
          "
        >
          Press back again to exit
        </div>
      )}
    </>
  );
}
