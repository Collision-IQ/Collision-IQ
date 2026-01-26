import "../globals.css";

export const metadata = {
  title: "Collision Academy",
  description: "Professional-grade vehicle valuation support",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body>
        {children}
      </body>
    </html>
  );
}