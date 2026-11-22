import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Önce oyun, sonra sohbet',
  description: 'Rastgele biriyle kısa bir oyun oyna, sonra 7 dakika sohbet et.',
};

export const viewport: Viewport = {
  themeColor: '#F8F6F1',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
