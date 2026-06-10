import type { Metadata } from 'next';
import { IncomingCallPopup } from '@/components/IncomingCallPopup';
import { VoiceProvider } from '@/providers/VoiceProvider';
import './globals.css';

export const metadata: Metadata = {
  title: 'PitLane — Porsche Service Advisor',
  description: 'Service advisor dashboard for Porsche dealerships',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <VoiceProvider>
          {children}
          <IncomingCallPopup />
        </VoiceProvider>
      </body>
    </html>
  );
}
