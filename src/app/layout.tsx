// src/app/layout.tsx
import './globals.css';
import { Inter } from 'next/font/google';
import { ThemeProvider } from 'next-themes';
import FloatingWidget from '@/components/FloatingWidget'; // ✅ import here

const inter = Inter({ subsets: ['latin'] });

export const metadata = {
  title: 'Collision Academy',
  description: 'Chatbot assistant',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
          <FloatingWidget /> {/* ✅ render here */}
        </ThemeProvider>
      </body>
    </html>
  );
}
