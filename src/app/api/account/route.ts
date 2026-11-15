import { NextRequest } from 'next/server';
import { deleteUserFromMemoryAuthFallback, getAuth } from '@/lib/auth';
import { noStoreJson } from '@/lib/cloudflareDb';
import { kickOrRemovePlayer } from '@/lib/roomController';
import {
  deleteGuestPreferencesFromStore,
  deleteRegisteredUserAccountFromStore,
  deleteRoom,
  getRoom,
  saveRoom,
} from '@/lib/serverStore';

export const dynamic = 'force-dynamic';

async function leaveRoomOnDelete(roomCode: string | undefined, playerId: string): Promise<void> {
  const code = roomCode?.trim().toUpperCase();
  if (!code || !playerId) return;
  try {
    const room = await getRoom(code);
    if (!room) return;
    if (!room.players.some((p) => p.id === playerId)) return;
    const updated = kickOrRemovePlayer(room, playerId, false);
    if (updated) {
      await saveRoom(updated);
    } else {
      await deleteRoom(code);
    }
  } catch {
    // Non-blocking: account deletion proceeds even if room cleanup fails
  }
}

function appendSetCookieHeaders(target: Headers, source: Headers | undefined): void {
  if (!source) return;
  const multi =
    typeof (source as Headers & { getSetCookie?: () => string[] }).getSetCookie === 'function'
      ? (source as Headers & { getSetCookie: () => string[] }).getSetCookie()
      : [];
  if (multi.length > 0) {
    for (const cookie of multi) {
      target.append('set-cookie', cookie);
    }
    return;
  }
  const single = source.get('set-cookie');
  if (single) {
    target.append('set-cookie', single);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      guestId?: string;
      activeRoomCode?: string;
    };

    const auth = await getAuth(req);
    const session = await auth.api.getSession({ headers: req.headers }).catch(() => null);

    if (session?.user?.id) {
      const userId = session.user.id;
      const email = session.user.email;

      await leaveRoomOnDelete(body.activeRoomCode, userId);

      // Sign out first so Better Auth generates the exact Set-Cookie headers clearing browser auth cookies
      const signOutRes = await auth.api
        .signOut({ headers: req.headers, asResponse: true })
        .catch(() => null);

      await deleteRegisteredUserAccountFromStore(userId, email);
      deleteUserFromMemoryAuthFallback(userId, email);

      const response = noStoreJson({
        ok: true,
        deletedUserId: userId,
        accountType: 'registered',
      });
      appendSetCookieHeaders(response.headers, signOutRes?.headers);
      return response;
    }

    const guestId = typeof body.guestId === 'string' ? body.guestId.trim() : '';
    if (guestId.startsWith('guest_')) {
      await leaveRoomOnDelete(body.activeRoomCode, guestId);
      await deleteGuestPreferencesFromStore(guestId);
      return noStoreJson({
        ok: true,
        deletedUserId: guestId,
        accountType: 'guest',
      });
    }

    return noStoreJson(
      { error: 'Active account session required to delete your account.' },
      { status: 401 }
    );
  } catch (err: unknown) {
    return noStoreJson(
      { error: err instanceof Error ? err.message : 'Failed to delete account' },
      { status: 500 }
    );
  }
}
