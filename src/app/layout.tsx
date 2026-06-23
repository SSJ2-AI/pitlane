import type { Metadata } from 'next';
import { IncomingCallPopup } from '@/components/IncomingCallPopup';
import { VoiceProvider } from '@/providers/VoiceProvider';
import './globals.css';

export const metadata: Metadata = {
  title: 'PitLane — Porsche Service Advisor',
  description: 'Service advisor dashboard for Porsche dealerships',
};

/**
 * Inline no-flash init script for the Phase 10 task-3 light/dark toggle.
 * Reads localStorage('pitlane-theme') BEFORE React hydrates and stamps the
 * matching class on <html>. Without this, the page renders in default-dark
 * for one frame and then snaps to the saved theme on hydration.
 *
 * dark is the default — only 'light' flips the class. We deliberately avoid
 * matchMedia(prefers-color-scheme) so the user's PitLane choice isn't
 * overridden by their OS-level preference.
 */
const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem('pitlane-theme');if(t==='light'){document.documentElement.classList.add('light');}else{document.documentElement.classList.add('dark');}}catch(e){document.documentElement.classList.add('dark');}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <VoiceProvider>
          {children}
          <IncomingCallPopup />
        </VoiceProvider>
      </body>
    </html>
  );
}
