"use client";

import dynamic from "next/dynamic";

const FloatingWidget = dynamic(() => import("./FloatingWidget"), {
  ssr: false,
  loading: () => null,
});

export default function FloatingWidgetMount() {
  return <FloatingWidget />;
}
