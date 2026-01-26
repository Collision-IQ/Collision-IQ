'use client';

import { useState } from 'react';

export default function ChatWidget() {
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [input, setInput] = useState('');

  const sendMessage = async () => {
    if (!input.trim()) return;

    const newMessage = { role: 'user', content: input } as const;
    // ...
    setMessages(prev => [...prev, { role: 'assistant', content: data.message } as const]);

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: input }),
    });

    const data = await res.json();
    setMessages(prev => [...prev, { role: 'assistant', content: data.message }]);
  };

  return (
    <div className="bg-black text-white rounded-lg shadow-lg p-4 max-h-[500px] overflow-y-auto">
      <div className="space-y-2 mb-4 max-h-[400px] overflow-y-auto">
        {messages.map((msg, idx) => (
          <div key={idx} className={`text-sm ${msg.role === 'user' ? 'text-blue-400' : 'text-green-400'}`}>
            <strong>{msg.role === 'user' ? 'You' : 'AI'}:</strong> {msg.content}
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Type a message..."
          className="flex-1 px-3 py-2 rounded text-black"
        />
        <button onClick={sendMessage} className="bg-blue-600 px-4 py-2 rounded hover:bg-blue-700">
          Send
        </button>
      </div>
    </div>
  );
}
