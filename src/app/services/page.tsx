export default function ServicesRedirect() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center space-y-4">
        <h1 className="text-xl font-semibold">
          Collision Academy Services
        </h1>
        <p className="text-sm opacity-80">
          Services are securely handled through our checkout partner.
        </p>
        <a
          href="https://www.collision.academy/s/shop"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block rounded px-5 py-3 bg-orange-600 text-white"
        >
          Continue to Services
        </a>
      </div>
    </div>
  );
}
