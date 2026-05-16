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
      <body className="min-h-screen bg-slate-950 pb-24 text-slate-100">
        <div className="mx-auto max-w-md">{children}</div>
        <InstallHintIOS />
        <InstallHintAndroid />
        <BottomNav />
        <RegisterSW />
      </body>
    </html>
  );
}
