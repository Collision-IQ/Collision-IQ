export default function ChatbotPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-2xl font-semibold text-white">Collision-IQ Chat</h1>
      <p className="mt-2 text-sm text-white/70">
        Chat is loading in an embedded widget.
      </p>

      <div className="mt-6 h-[700px] w-full overflow-hidden rounded-2xl border border-white/10 bg-black">
        <iframe
          src="/widget"
          className="h-full w-full"
          style={{ border: "none" }}
          title="Collision Academy Chat"
        />
      </div>
    </div>
  );
}
