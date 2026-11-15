import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';

const isDev = process.env.NODE_ENV === 'development';

if (isDev) {
  initOpenNextCloudflareForDev();
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep `next dev` isolated in `.next-dev` so running `npm run cf:build` / `next build`
  // never overwrites `.next/` and crashes an active local dev server.
  distDir: isDev ? '.next-dev' : '.next',
  allowedDevOrigins: [
    'localhost',
    '127.0.0.1',
    '*.loca.lt',
    '*.trycloudflare.com',
    '*.ngrok-free.app',
    '*.ngrok-free.dev',
    '*.ngrok.io',
  ],
  async headers() {
    return [
      {
        source: '/cards/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=86400, stale-while-revalidate=604800',
          },
        ],
      },
      {
        source: '/api/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-store, no-cache, must-revalidate, proxy-revalidate',
          },
          { key: 'Pragma', value: 'no-cache' },
          { key: 'Expires', value: '0' },
        ],
      },
    ];
  },
};

export default nextConfig;
