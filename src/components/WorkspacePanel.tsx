interface Props {
  variant?: "left" | "right";
  analysis?: string;
}

export default function WorkspacePanel({ analysis }: Props) {
  return (
    <div className="h-full flex flex-col gap-4 text-sm text-white">

      <div className="p-4 rounded-xl border border-white/10 bg-black/50">
        <h3 className="text-orange-400 font-semibold mb-2">
          Analysis Panel
        </h3>
        <p className="text-white/60">
          Uploaded files and structured repair analysis will appear here.
        </p>
      </div>

      {analysis && (
        <div className="p-4 rounded-xl border border-white/10 bg-black/60 overflow-y-auto whitespace-pre-wrap">
          {analysis}
        </div>
      )}

    </div>
  );
}
