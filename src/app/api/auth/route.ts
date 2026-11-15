import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { loadUsersMap, saveUsersMap, StoredUser } from '@/lib/serverStore';

function getSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (url && key) {
    return createClient(url, key);
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { action, email, password, name, soundEnabled } = body as {
      action: 'login' | 'signup' | 'preferences';
      email?: string;
      password?: string;
      name?: string;
      soundEnabled?: boolean;
    };

    const cleanEmail = (email || '').trim().toLowerCase();
    const cleanPassword = (password || '').trim();
    const cleanName = (name || '').trim();

    if (action === 'preferences') {
      if (cleanEmail) {
        const usersMap = loadUsersMap();
        const existing = usersMap.get(cleanEmail);
        if (existing) {
          existing.soundEnabled = Boolean(soundEnabled);
          usersMap.set(cleanEmail, existing);
          saveUsersMap(usersMap);
        }
      }
      return NextResponse.json({ ok: true, soundEnabled: Boolean(soundEnabled) });
    }

    if (!cleanEmail || !cleanEmail.includes('@')) {
      return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 });
    }
    if (!cleanPassword || cleanPassword.length < 4) {
      return NextResponse.json({ error: 'Password must be at least 4 characters.' }, { status: 400 });
    }

    const supabase = getSupabaseClient();

    // Try Supabase Auth if configured
    if (supabase) {
      if (action === 'signup') {
        const displayName = cleanName || cleanEmail.split('@')[0];
        const { data, error } = await supabase.auth.signUp({
          email: cleanEmail,
          password: cleanPassword,
          options: {
            data: { display_name: displayName },
          },
        });
        if (!error && data.user) {
          return NextResponse.json({
            user: {
              id: data.user.id,
              email: cleanEmail,
              name: displayName,
              soundEnabled: true,
              isGuest: false,
            },
          });
        }
      } else if (action === 'login') {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password: cleanPassword,
        });
        if (!error && data.user) {
          const displayName =
            (data.user.user_metadata?.display_name as string) || cleanEmail.split('@')[0];
          const usersMap = loadUsersMap();
          const stored = usersMap.get(cleanEmail);
          return NextResponse.json({
            user: {
              id: data.user.id,
              email: cleanEmail,
              name: displayName,
              soundEnabled:
                stored?.soundEnabled ??
                (data.user.user_metadata?.sound_enabled as boolean | undefined) ??
                true,
              isGuest: false,
            },
          });
        }
      }
    }

    // Fallback to built-in persistent DB store
    const usersMap = loadUsersMap();
    const existingUser = usersMap.get(cleanEmail);

    if (action === 'signup') {
      if (existingUser) {
        return NextResponse.json(
          { error: 'An account with this email already exists. Please log in instead.' },
          { status: 400 }
        );
      }
      const displayName = cleanName || cleanEmail.split('@')[0];
      const newUser: StoredUser = {
        id: `usr_${Math.random().toString(36).substring(2, 10)}`,
        email: cleanEmail,
        password: cleanPassword,
        name: displayName,
        soundEnabled: true,
        createdAt: Date.now(),
      };
      usersMap.set(cleanEmail, newUser);
      saveUsersMap(usersMap);

      return NextResponse.json({
        user: {
          id: newUser.id,
          email: newUser.email,
          name: newUser.name,
          soundEnabled: true,
          isGuest: false,
        },
      });
    } else {
      // Login
      if (!existingUser) {
        return NextResponse.json(
          { error: 'No account found with this email. Please sign up first.' },
          { status: 401 }
        );
      }
      if (existingUser.password !== cleanPassword) {
        return NextResponse.json(
          { error: 'Incorrect password. Please try again.' },
          { status: 401 }
        );
      }

      return NextResponse.json({
        user: {
          id: existingUser.id,
          email: existingUser.email,
          name: existingUser.name,
          soundEnabled: existingUser.soundEnabled ?? true,
          isGuest: false,
        },
      });
    }
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Authentication error' },
      { status: 500 }
    );
  }
}
