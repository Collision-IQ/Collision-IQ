"use client";

interface Props {
  variant?: "left" | "right";
}

export default function WorkspacePanel({ variant = "left" }: Props) {
  return (
    <div className="h-full text-white">
      <h2 className="text-lg font-semibold mb-4">
        Analysis Panel
      </h2>

      <div className="space-y-4 text-sm text-white/70">
        <div className="p-4 rounded-xl bg-black/50 border border-white/10">
          <p className="font-medium text-white mb-1">Preview</p>
          <p>
            Uploaded files and structured repair analysis will appear here.
          </p>
        </div>

        <div className="p-4 rounded-xl bg-black/50 border border-white/10">
          <p className="font-medium text-white mb-1">Repair Insights</p>
          <p>
            OEM procedures, damage analysis, and notes will populate in this panel.
          </p>
        </div>
      </div>
    </div>
  );
}
