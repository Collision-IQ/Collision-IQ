'use client';

import '@/lib/auth/assertClientClerk';
import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import FloatingWidget from '@/components/FloatingWidget';
import { onBackButton, isNative } from '@/lib/native';

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const showWidget = !pathname.startsWith('/widget');

  // Android hardware back button — navigate back or let the OS handle exit
  useEffect(() => {
    if (!isNative()) return;
    const off = onBackButton(() => {
      router.back();
    });
    return off;
  }, [router]);

  return (
    <>
      {children}
      {showWidget && <FloatingWidget />}
    </>
  );
}
