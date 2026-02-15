export default function ChatbotLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-black text-white relative overflow-hidden">
      <div className="mx-auto max-w-[1600px] px-6 py-8">
        {children}
      </div>
    </div>
  );
}
