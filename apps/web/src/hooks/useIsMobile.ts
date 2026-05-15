"use client";

import { useEffect, useState } from "react";

export function useIsMobile(breakpoint: number = 768) {
  const [isMobile, setIsMobile] = useState<boolean | null>(null);

  useEffect(() => {
    function checkScreen() {
      setIsMobile(window.innerWidth < breakpoint);
    }

    checkScreen(); // Initial check
    window.addEventListener("resize", checkScreen);

    return () => {
      window.removeEventListener("resize", checkScreen);
    };
  }, [breakpoint]);

  return isMobile;
}