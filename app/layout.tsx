import type { Metadata } from 'next';
import { Archivo, Manrope, Outfit } from 'next/font/google';
import './globals.css';
import './diagnose.css';

const outfit = Outfit({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-outfit',
  display: 'swap',
});

/**
 * Measurement figures. The width axis lets the big readouts sit wide and
 * engineered without pulling the body type around with them.
 */
const archivo = Archivo({
  subsets: ['latin'],
  axes: ['wdth'],
  variable: '--font-archivo',
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
    <html
      lang="en"
      className={`${outfit.variable} ${manrope.variable} ${archivo.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
