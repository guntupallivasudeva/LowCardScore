import { getCloudflareContext } from '@opennextjs/cloudflare';
import { NextResponse } from 'next/server';
import {
  cleanupNonEssentialDatabaseData,
  ensureD1Schema,
  getLastDatabaseCleanupTimestamp,
  maybeAutoCleanupDatabase,
} from './dbCleanup';

export {
  cleanupNonEssentialDatabaseData,
  ensureD1Schema,
  getLastDatabaseCleanupTimestamp,
  maybeAutoCleanupDatabase,
};

export interface CloudflareRuntime {
  d1: D1Database | null;
  env: Partial<CloudflareEnv> & Record<string, unknown>;
  waitUntil?: (promise: Promise<unknown>) => void;
}

/**
 * Resolve Cloudflare Workers bindings (`env.DB`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`)
 * and `ExecutionContext.waitUntil` from OpenNext context (works in Cloudflare production,
 * Wrangler preview, and `next dev` via `initOpenNextCloudflareForDev()`).
 */
export async function getCloudflareRuntime(): Promise<CloudflareRuntime> {
  try {
    const context = await getCloudflareContext({ async: true });
    const env = (context?.env ?? {}) as Partial<CloudflareEnv> & Record<string, unknown>;
    const execCtx = context?.ctx;
    const waitUntil =
      execCtx && typeof execCtx.waitUntil === 'function'
        ? (promise: Promise<unknown>) => execCtx.waitUntil(promise)
        : undefined;

    return {
      d1: env.DB ?? null,
      env,
      waitUntil,
    };
  } catch {
    return {
      d1: null,
      env: {},
    };
  }
}

export const NO_STORE_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  Pragma: 'no-cache',
  Expires: '0',
} as const;

/**
 * Wraps `NextResponse.json` with strict anti-cache headers so Cloudflare edge and browsers
 * never serve stale room states or auth responses.
 */
export function noStoreJson<T>(data: T, init?: ResponseInit): NextResponse<T> {
  const headers = new Headers(init?.headers);
  Object.entries(NO_STORE_HEADERS).forEach(([k, v]) => headers.set(k, v));
  return NextResponse.json(data, {
    ...init,
    headers,
  });
}
