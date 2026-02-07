"use client";

type Props = {
  left?: React.ReactNode;
  center?: React.ReactNode;
  right?: React.ReactNode;
};

export default function ChatShell({ left, center, right }: Props) {
  return (
    <div className="mx-auto grid max-w-7xl grid-cols-[260px_1fr_300px] gap-6">
      
      {/* LEFT */}
      <aside>{left}</aside>

      {/* CENTER */}
      <main className="min-h-0 flex flex-col">{center}</main>

      {/* RIGHT */}
      <aside>{right}</aside>

    </div>
  );
}
