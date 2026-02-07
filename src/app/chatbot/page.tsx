import Image from "next/image";
import ChatShell from "@/components/ChatShell";
import ChatWidget from "@/components/ChatWidget";

export default function ChatbotPage() {
  return (
    <ChatShell
      left={
        <div className="text-sm opacity-80">
          <Image
            src="/brand/logos/Logo-grey.png"
            alt="Collision Academy"
            width={160}
            height={40}
            className="mb-4 opacity-90"
            priority
          />
          <p>Collision-IQ</p>
          <p className="opacity-60 text-xs mt-1">
            Upload an estimate, OEM procedure, or photo — get structured analysis instantly.
          </p>
        </div>
      }
      center={<ChatWidget />}
      right={
        <div className="text-sm opacity-70">
          Workspace panel
        </div>
      }
    />
  );
}
