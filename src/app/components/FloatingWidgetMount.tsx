"use client";

import dynamic from "next/dynamic";

const WidgetClient = dynamic(() => import("./WidgetClient"), {
  ssr: false,
  loading: () => null,
});

export default function FloatingWidgetMount() {
  return <WidgetClient />;
}
