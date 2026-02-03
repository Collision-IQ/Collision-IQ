export default function AnimatedHeader() {
  return (
    <section className="relative h-[70vh] min-h-[520px] w-full overflow-hidden">
      {/* Background video */}
      <video
        className="absolute inset-0 h-full w-full object-cover opacity-40"
        src="/brand/video/logo-loop.mp4"
        autoPlay
        muted
        loop
        playsInline
      />

      {/* Dark overlay for contrast */}
      <div className="absolute inset-0 bg-black/60" />

      {/* Optional center logo watermark */}
      <div className="relative z-10 flex h-full items-center justify-center">
        <img
          src="/brand/logos/Logo-grey.png"
          alt="Collision Academy"
          className="w-[280px] opacity-10"
        />
      </div>
    </section>
  );
}
// This component renders an animated header section with a looping
// background video, a dark overlay for contrast, and an optional
// center logo watermark. It is designed to be responsive and visually
// appealing, suitable for use as a header on web pages.