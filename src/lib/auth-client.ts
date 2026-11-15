'use client';

import { createAuthClient } from 'better-auth/react';

/**
 * Browser client for Better Auth (`/api/auth/*`) running on Cloudflare Workers + D1.
 */
export const authClient = createAuthClient({
  basePath: '/api/auth',
  fetchOptions: {
    cache: 'no-store',
  },
});
