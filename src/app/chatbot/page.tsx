import Image from "next/image";
import ChatShell from "@/components/ChatShell";
import ChatWidget from "@/components/ChatWidget";

export default function ChatbotPage() {
  return (
    <ChatShell
      title="Collision-IQ"
      subtitle="Upload an estimate, OEM procedure, or photo — get structured analysis instantly."
      logo={
        <Image
          src="/brand/logos/Logo-grey.png"
          alt="Collision Academy"
          width={160}
          height={40}
          className="opacity-90"
          priority
        />
      }
    >
      {/* Your existing widget stays exactly as-is */}
      <ChatWidget />
    </ChatShell>
  );
}
