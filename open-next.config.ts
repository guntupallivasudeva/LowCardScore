import { defineCloudflareConfig, type OpenNextConfig } from '@opennextjs/cloudflare';

/**
 * Cloudflare Workers runtime configuration for OpenNext.
 * Uses Cloudflare Workers Assets + Cloudflare D1 (Free tier compatible, no R2 required).
 * Uses `npm run next:build` so `npm run build` can invoke `opennextjs-cloudflare build`
 * safely without recursion during Cloudflare Workers Builds (`npm run build` + `wrangler deploy`).
 */
const openNextConfig = {
  ...defineCloudflareConfig({}),
  buildCommand: 'npm run next:build',
} satisfies OpenNextConfig;

export default openNextConfig;
