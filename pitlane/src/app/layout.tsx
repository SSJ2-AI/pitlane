import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'PitLane — Porsche Service Advisor',
  description: 'Service advisor dashboard for Porsche dealerships',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
