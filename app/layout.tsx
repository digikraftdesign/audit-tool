import type { Metadata } from 'next';
import { Manrope, Outfit } from 'next/font/google';
import './globals.css';

const outfit = Outfit({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-outfit',
  display: 'swap',
});

const manrope = Manrope({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-manrope',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'DigiKraft · Creative Growth Audit',
  robots: { index: false, follow: false },
  icons: { icon: '/assets/img/logo-eng-light.svg' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${outfit.variable} ${manrope.variable}`}>
      <body>{children}</body>
    </html>
  );
}
