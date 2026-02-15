"use client";

import { motion } from "framer-motion";
import ChatShell from "@/components/ChatShell";
import ChatWidget from "@/components/ChatWidget";
import WorkspacePanel from "@/components/WorkspacePanel";

export default function ChatbotPage() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: "easeOut" }}
    >
      <ChatShell
        title="Collision IQ"
        left={<WorkspacePanel variant="left" />}
        center={<ChatWidget mode="page" />}
        right={<WorkspacePanel variant="right" />}
      />
    </motion.div>
  );
}
