import ChatShell from "@/components/ChatShell";
import ChatWidget from "@/components/ChatWidget";
import WorkspacePanel from "@/components/WorkspacePanel";

export default function ChatbotPage() {
  return (
    <ChatShell
      title="Collision IQ"
      left={<WorkspacePanel variant="left" />}
      center={<ChatWidget mode="page" />}
      right={<WorkspacePanel variant="right" />}
    />
  );
}
