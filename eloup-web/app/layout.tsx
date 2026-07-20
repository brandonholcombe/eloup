import type { Metadata, Viewport } from 'next';
import './globals.css';
import { BottomNav } from '@/components/BottomNav';
import { InstallHintIOS } from '@/components/InstallHintIOS';
import { InstallHintAndroid } from '@/components/InstallHintAndroid';
import { RegisterSW } from '@/lib/pwa/register-sw';

export const metadata: Metadata = {
  title: 'EloUp',
  description: 'Multi-game ELO tracker for parties',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: 'EloUp' },
  icons: { apple: '/apple-touch-icon.png' },
};

export const viewport: Viewport = {
  themeColor: '#0f172a',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-slate-950 pb-[calc(6rem+env(safe-area-inset-bottom))] text-slate-100">
        <header
          className="sticky top-0 z-40 border-b border-slate-800 bg-slate-950/95 backdrop-blur"
          style={{ paddingTop: 'var(--safe-top, 0px)' }}
        >
          <div className="mx-auto flex max-w-md items-center justify-center px-4 py-3">
            <span className="text-lg font-semibold tracking-tight">EloUp</span>
          </div>
        </header>
        <div className="mx-auto max-w-md">{children}</div>
        <InstallHintIOS />
        <InstallHintAndroid />
        <BottomNav />
        <RegisterSW />
      </body>
    </html>
  );
}
