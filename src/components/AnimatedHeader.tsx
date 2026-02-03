"use client";

export default function AnimatedHeader() {
  return (
    <header className="relative h-screen w-full overflow-hidden">
      {/* VIDEO BACKGROUND */}
      <video
        className="absolute inset-0 h-full w-full object-cover"
        src="/brand/logos/Logo video.mp4"
        autoPlay
        muted
        loop
        playsInline
      />

      {/* DARK OVERLAY (for readability) */}
      <div className="absolute inset-0 bg-black/60" />

      {/* OPTIONAL CENTERED BRAND TEXT (can remove later) */}
      <div className="relative z-10 flex h-full items-center justify-center">
        <div className="text-center">
          <h1 className="text-4xl md:text-5xl font-semibold text-white">
            Collision <span className="text-[color:var(--accent)]">Academy</span>
          </h1>
          <p className="mt-2 text-sm text-white/70">
            OEM-aligned · Documentation-first · Claim-focused
          </p>
        </div>
      </div>
    </header>
  );
}
