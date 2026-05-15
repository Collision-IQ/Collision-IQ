"use client";

interface Attachment {
  attachmentId: string;
  filename: string;
  hasVision?: boolean;
}

interface Props {
  attachments?: Attachment[];
  onRemove?: (id: string) => void;
}

export default function AttachmentTray({ attachments, onRemove }: Props) {
  if (!attachments?.length) return null;

  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {attachments.map((file) => (
        <div
          key={file.attachmentId}
          className="flex items-center gap-2 rounded-full bg-white/[0.06] px-3 py-1 text-xs text-white/70"
        >
          <span className="truncate max-w-[140px]">{file.filename}</span>

          <button
            onClick={() => onRemove?.(file.attachmentId)}
            className="text-white/40 transition hover:text-red-300"
            aria-label="Remove attachment"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
