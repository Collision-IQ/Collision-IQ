import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Next 16.1.1 types don't include this yet, but future versions may.
    // Keeping it here is safe as long as we don't let TS validate the shape.
    // @ts-expect-error - allowedDevOrigins is not typed in this Next version
    allowedDevOrigins: [
      "http://localhost:3000",
      "https://*.ngrok-free.dev",
      "https://authorizable-unhurrying-lani.ngrok-free.dev",
    ],
  },
};

export default nextConfig;
