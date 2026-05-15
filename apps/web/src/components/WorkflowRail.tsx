"use client";

import React from "react";

type Attachment = {
  attachmentId: string;
  filename: string;
  hasVision: boolean;
  usedInAnalysis?: boolean;
};

interface Props {
  attachments: Attachment[];
  onUploadClick: () => void;
  onRemove: (id: string) => void;
}

export default function WorkflowRail({
  attachments,
  onUploadClick,
  onRemove,
}: Props) {
  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 text-[10px] uppercase tracking-[0.22em] text-white/40">
        Workflow
      </div>

      <button
        onClick={onUploadClick}
        className="mb-4 rounded-xl border border-white/7 bg-white/[0.045] px-4 py-3 text-sm text-white/85 transition hover:bg-white/[0.075]"
      >
        Upload Files
      </button>

      <div className="flex-1 space-y-2 overflow-y-auto">
        {attachments.length === 0 && (
          <div className="text-xs text-white/40">No files uploaded yet</div>
        )}

        {attachments.map((file) => (
          <div
            key={file.attachmentId}
            className="flex justify-between rounded-xl bg-black/20 px-3 py-2 text-xs text-white/70"
          >
            <span className="truncate">{file.filename}</span>
            <button
              onClick={() => onRemove(file.attachmentId)}
              className="text-white/40 transition hover:text-red-300"
              aria-label="Remove attachment"
            >
              x
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
