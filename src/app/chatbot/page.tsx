import ChatShell from "@/components/ChatShell";
import ChatWidget from "@/components/ChatWidget";

export default function ChatbotPage() {
  return (
    <ChatShell
      left={<div className="opacity-70">Collision Academy</div>}
      center={<ChatWidget />}
      right={<div className="opacity-70">Workspace Panel</div>}
    />
  );
}
