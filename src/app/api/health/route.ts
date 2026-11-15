import {
  ensureD1Schema,
  getCloudflareRuntime,
  getLastDatabaseCleanupTimestamp,
  maybeAutoCleanupDatabase,
  noStoreJson,
} from '@/lib/cloudflareDb';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const { d1, waitUntil } = await getCloudflareRuntime();
    if (d1) {
      await ensureD1Schema(d1);
      maybeAutoCleanupDatabase(d1, waitUntil);
    }
    return noStoreJson({
      ok: true,
      runtime: 'cloudflare-workers',
      database: d1 ? 'cloudflare-d1' : 'local-fallback',
      auth: 'better-auth',
      autoCleanup: {
        retentionHours: 24,
        lastRunAt: getLastDatabaseCleanupTimestamp(),
      },
      timestamp: Date.now(),
    });
  } catch (err: unknown) {
    return noStoreJson(
      {
        ok: false,
        error: err instanceof Error ? err.message : 'Health check failed',
      },
      { status: 500 }
    );
  }
}
