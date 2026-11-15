import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'LowScore — Strategic Low-Sum Card Game',
  description: 'Play LowScore online with friends via room code or against smart AI bots.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-[#FAF9F5] text-stone-900 antialiased">
        {children}
      </body>
    </html>
  );
}
