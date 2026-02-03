"use client";

export default function AnimatedHeader() {
  return (
    <header className="relative w-full h-[80vh] min-h-[520px] overflow-hidden">
      {/* VIDEO BACKGROUND */}
      <video
        className="absolute inset-0 w-full h-full object-cover"
        src="/brand/logos/Logo-video.mp4"
        autoPlay
        loop
        muted
        playsInline
      />

      {/* DARK OVERLAY (for contrast) */}
      <div className="absolute inset-0 bg-black/60" />

      {/* OPTIONAL CENTER BRANDING */}
      <div className="relative z-10 flex h-full items-center justify-center">
        <div className="text-center">
          <h1 className="text-4xl md:text-6xl font-bold tracking-tight">
            <span className="text-white">Collision</span>{" "}
            <span className="text-[color:var(--accent)]">Academy</span>
          </h1>
          <p className="mt-4 text-sm md:text-base text-white/70">
            OEM-aligned. Documentation-first. Claim-focused.
          </p>
        </div>
      </div>
    </header>
  );
}
// This component renders an animated header with a video background.
// It includes a dark overlay for contrast and optional centered branding
// with the company name and tagline. The header is responsive and fills
// the viewport height.