export default function WidgetLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children; // No HTML/body wrapper — just the raw chat widget
}
