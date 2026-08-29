import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  // pdf-parse → pdfjs-dist breaks when webpack bundles it (Object.defineProperty
  // on a shadowed exports object under eval-source-map). Keep it external.
  // SQLite uses Node's built-in `node:sqlite` (no native npm addon).
  serverExternalPackages: ['pdf-parse', 'pdfjs-dist', '@napi-rs/canvas'],
  outputFileTracingIncludes: {
    '/api/audits': [
      './node_modules/pdf-parse/**/*',
      './node_modules/pdfjs-dist/**/*',
      './node_modules/@napi-rs/canvas/**/*',
    ],
    '/api/upload': [
      './node_modules/pdf-parse/**/*',
      './node_modules/pdfjs-dist/**/*',
      './node_modules/@napi-rs/canvas/**/*',
    ],
  },
};

export default nextConfig;
