import { NextRequest } from 'next/server';
import { getAuth } from '@/lib/auth';
import { noStoreJson } from '@/lib/cloudflareDb';
import { getPlayerPreference, savePlayerPreference } from '@/lib/serverStore';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const auth = await getAuth(req);
    const session = await auth.api.getSession({ headers: req.headers }).catch(() => null);
    const requestedId = req.nextUrl.searchParams.get('userId')?.trim() || '';
    const targetId = session?.user?.id || requestedId;

    if (!targetId) {
      return noStoreJson({ error: 'Missing userId' }, { status: 400 });
    }

    const pref = await getPlayerPreference(targetId);
    return noStoreJson({
      preferences: pref ?? {
        userId: targetId,
        name: session?.user?.name,
        soundEnabled:
          typeof (session?.user as { soundEnabled?: unknown } | undefined)?.soundEnabled ===
          'boolean'
            ? (session?.user as { soundEnabled?: boolean }).soundEnabled!
            : true,
        updatedAt: Date.now(),
      },
    });
  } catch (err: unknown) {
    return noStoreJson(
      { error: err instanceof Error ? err.message : 'Failed to load preferences' },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      userId?: string;
      name?: string;
      soundEnabled?: boolean;
    };

    const auth = await getAuth(req);
    const session = await auth.api.getSession({ headers: req.headers }).catch(() => null);
    const requestedId = typeof body.userId === 'string' ? body.userId.trim() : '';

    // Registered users always bind to their authenticated session ID unless operating as guest
    const targetId = session?.user?.id || requestedId;
    if (!targetId) {
      return noStoreJson({ error: 'Missing userId or active session' }, { status: 400 });
    }

    const cleanName =
      typeof body.name === 'string' && body.name.trim().length > 0
        ? body.name.trim().slice(0, 24)
        : undefined;
    const soundEnabled = typeof body.soundEnabled === 'boolean' ? body.soundEnabled : undefined;

    const saved = await savePlayerPreference(targetId, {
      name: cleanName,
      soundEnabled,
    });

    return noStoreJson({ ok: true, preferences: saved });
  } catch (err: unknown) {
    return noStoreJson(
      { error: err instanceof Error ? err.message : 'Failed to save preferences' },
      { status: 500 }
    );
  }
}
