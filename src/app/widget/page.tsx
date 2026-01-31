'use client';

import { useTheme } from 'next-themes';
import { useState, useEffect, useRef } from 'react';

type Message = {
  role: 'user' | 'assistant' | 'system';
  content: string;
};

export default function ChatWidget() {
  const { theme } = useTheme();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const logoSrc =
    theme === 'light'
      ? '/brand/logos/Logo-dark.png'
      : '/brand/logos/Logo-grey.png';

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    if (!input.trim()) return;

    const userMessage: Message = {
      role: 'user',
      content: input,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        body: JSON.stringify({ message: input }),
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await res.json();

      const assistantMessage: Message = {
        role: 'assistant',
        content: data.message,
      };

      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="flex flex-col min-h-[500px] max-h-[80vh] bg-white dark:bg-black text-black dark:text-white rounded overflow-hidden shadow-lg">
      {/* Logo */}
      <div className="p-4 border-b border-gray-300 dark:border-gray-700 flex justify-center">
        <img src={logoSrc} alt="Collision Academy Logo" className="h-8 object-contain" />
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-h-[60vh]">
        {messages.map((msg, index) => (
          <div
            key={index}
            className={`p-3 rounded-md max-w-[75%] ${
              msg.role === 'user'
                ? 'bg-blue-600 text-white self-end ml-auto text-right'
                : 'bg-gray-200 dark:bg-gray-800 self-start'
            }`}
          >
            {msg.content}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-gray-300 dark:border-gray-700">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendMessage();
          }}
          className="flex space-x-2"
        >
          <input
            className="flex-1 p-2 rounded bg-gray-100 dark:bg-gray-900 border border-gray-400 dark:border-gray-600 text-black dark:text-white"
            placeholder="Type a message..."
            value={input}
            onChange={(e) => setInput(e.target.value)}
          />
          <button
            type="submit"
            className="bg-blue-600 px-4 py-2 rounded text-white hover:bg-blue-700"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
