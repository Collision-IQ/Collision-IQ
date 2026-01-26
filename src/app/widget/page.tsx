'use client';

import { useState } from 'react';

type Message = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export default function ChatWidget() {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'system', content: 'How can I assist you today?' },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const sendMessage = async () => {
    if (!input.trim()) return;

    const userMessage: Message = { role: 'user', content: input };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    setInput('');
    setLoading(true);

    const res = await fetch('/api/assignments/dummy/chat', {
      method: 'POST',
      body: JSON.stringify({ message: input }),
      headers: { 'Content-Type': 'application/json' },
    });

    const { message: assistantReply } = await res.json();

    setMessages([...newMessages, { role: 'assistant', content: assistantReply }]);
    setLoading(false);
  };

  return (
    <div className="h-screen w-screen bg-black text-white flex flex-col p-6">
      <div className="flex-1 overflow-y-auto space-y-3">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`text-sm ${
              m.role === 'user'
                ? 'text-blue-400 text-right'
                : m.role === 'assistant'
                ? 'text-green-400'
                : 'text-gray-400'
            }`}
          >
            <span>{m.role}:</span> {m.content}
          </div>
        ))}
      </div>

      <div className="mt-4 flex">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
          placeholder="Ask something..."
          className="flex-1 px-4 py-2 bg-white/5 border border-white/20 rounded text-white"
        />
        <button
          onClick={sendMessage}
          disabled={loading}
          className="ml-2 px-4 py-2 bg-white text-black rounded"
        >
          Send
        </button>
      </div>
    </div>
  );
}
