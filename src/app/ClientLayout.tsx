'use client';

import { usePathname } from 'next/navigation';
import FloatingWidget from '@/components/FloatingWidget';

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isWidget = pathname.startsWith('/widget');

  return (
    <>
      {children}
      {!isWidget && <FloatingWidget />}
    </>
  );
}
