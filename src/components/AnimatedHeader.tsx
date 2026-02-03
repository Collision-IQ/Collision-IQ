export default function AnimatedHeader() {
  return (
    <section className="relative w-full overflow-hidden bg-black">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-b from-black via-black/90 to-transparent" />

      {/* Logo video */}
      <div className="relative flex h-[60vh] min-h-[420px] items-center justify-center">
        <video
          className="max-h-full max-w-full object-contain opacity-80"
          src="/brand/video/logo-loop.mp4"
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
        />
      </div>
    </section>
  );
}
// This component renders an animated header section with a looping logo video
// and a background gradient. It is designed to be responsive and visually
// appealing, making use of absolute positioning and opacity settings for
// the video element. The header occupies a significant portion of the viewport
// height to create an immersive experience.