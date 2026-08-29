import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  // pdf-parse → pdfjs-dist breaks when webpack bundles it. Keep external.
  // Do NOT require @napi-rs/canvas — Hostinger cannot load its native binding;
  // lib/pdfPolyfill.ts stubs DOMMatrix / ImageData / Path2D for text extraction.
  serverExternalPackages: ['pdf-parse', 'pdfjs-dist'],
  outputFileTracingIncludes: {
    '/api/audits': [
      './node_modules/pdf-parse/**/*',
      './node_modules/pdfjs-dist/**/*',
    ],
    '/api/upload': [
      './node_modules/pdf-parse/**/*',
      './node_modules/pdfjs-dist/**/*',
    ],
  },
  webpack: (config) => {
    // Prevent accidental resolution of the native canvas addon in the server bundle.
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...(config.resolve.alias ?? {}),
      '@napi-rs/canvas': false,
    };
    return config;
  },
};

export default nextConfig;
