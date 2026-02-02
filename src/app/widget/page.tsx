'use client';

import WidgetClient from '@/components/WidgetClient';
// IMPORTANT:
// This route intentionally renders ONLY <WidgetClient />.
// All chat logic lives in components/ChatWidget.tsx.
export default function WidgetPage() {
  return (
    <div className="w-full h-full min-h-screen bg-transparent">
      <WidgetClient />
    </div>
  );
}
