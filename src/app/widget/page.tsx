'use client';

import FileUpload from "@/app/components/FileUpload";
import ChatWidget from './ChatWidget';

export default function WidgetPage() {
  return (
    <main className="p-4 max-w-3xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Upload Documents</h1>
      <div className="mb-8">
        <FileUpload />
      </div>
      <ChatWidget />
    </main>
  );
}
