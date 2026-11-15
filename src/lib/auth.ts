import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { ensureD1Schema, getCloudflareRuntime } from './cloudflareDb';

const globalAuthFallback = globalThis as unknown as {
  __lowscore_memory_db?: Record<string, Record<string, unknown>[]>;
  __lowscore_dev_secret?: string;
};

if (!globalAuthFallback.__lowscore_memory_db) {
  globalAuthFallback.__lowscore_memory_db = {};
}

const PBKDF2_ITERATIONS = 100_000;
const SALT_BYTES = 16;
const DERIVED_BITS = 256;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    const byte = Number.parseInt(hex.slice(i, i + 2), 16);
    if (Number.isNaN(byte)) return null;
    out[i / 2] = byte;
  }
  return out;
}

function constantTimeEqualBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

/**
 * Native WebCrypto PBKDF2-SHA256 password hasher.
 * Executes in native BoringSSL inside Cloudflare Workers (< 1ms CPU) so Free Tier
 * 10ms Workers CPU limits are never exceeded.
 */
async function hashPasswordPBKDF2(password: string): Promise<string> {
  const salt = new Uint8Array(SALT_BYTES);
  crypto.getRandomValues(salt);
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password.normalize('NFKC')),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    DERIVED_BITS
  );
  return `pbkdf2_sha256$${PBKDF2_ITERATIONS}$${toHex(salt)}$${toHex(new Uint8Array(derived))}`;
}

async function verifyPasswordPBKDF2({
  hash,
  password,
}: {
  hash: string;
  password: string;
}): Promise<boolean> {
  const parts = hash.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2_sha256') return false;
  const iterations = Number.parseInt(parts[1], 10);
  const salt = fromHex(parts[2]);
  const expected = fromHex(parts[3]);
  if (!Number.isFinite(iterations) || iterations < 10_000 || !salt || !expected) {
    return false;
  }
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password.normalize('NFKC')),
    { name: 'PBKDF2' },
    false,
    ['deriveBits']
  );
  const derived = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    expected.length * 8
  );
  return constantTimeEqualBytes(new Uint8Array(derived), expected);
}

function getLocalDevEphemeralSecret(): string {
  if (!globalAuthFallback.__lowscore_dev_secret) {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    globalAuthFallback.__lowscore_dev_secret = toHex(bytes);
  }
  return globalAuthFallback.__lowscore_dev_secret;
}

function isLocalHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

function resolveRequestOrigin(
  req: Request
): { origin: string; hostname: string; host: string; protocol: string } | null {
  try {
    const url = new URL(req.url);
    const forwardedHost = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
    const headerHost = forwardedHost || req.headers.get('host')?.trim() || '';
    const rawHost = headerHost || url.host;
    const forwardedProto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase();
    const protoRaw =
      forwardedProto === 'http' || forwardedProto === 'https'
        ? forwardedProto
        : url.protocol.replace(':', '').toLowerCase();
    const proto = protoRaw === 'https' ? 'https' : 'http';
    const resolvedUrl = new URL(`${proto}://${rawHost}`);
    return {
      origin: resolvedUrl.origin,
      hostname: resolvedUrl.hostname.toLowerCase(),
      host: resolvedUrl.host,
      protocol: resolvedUrl.protocol,
    };
  } catch {
    return null;
  }
}

/**
 * Creates a request-scoped Better Auth instance backed by Cloudflare D1.
 */
export async function getAuth(request?: Request) {
  const { d1, env } = await getCloudflareRuntime();

  if (d1) {
    await ensureD1Schema(d1);
  }

  let requestOrigin = 'http://localhost:3005';
  let requestHostname = 'localhost';
  if (request) {
    const resolved = resolveRequestOrigin(request);
    if (resolved) {
      requestOrigin = resolved.origin;
      requestHostname = resolved.hostname;
    }
  }

  const configuredBaseUrl =
    (typeof env.BETTER_AUTH_URL === 'string' && env.BETTER_AUTH_URL.trim()) ||
    process.env.BETTER_AUTH_URL?.trim() ||
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    '';

  const baseURL = isLocalHostname(requestHostname)
    ? requestOrigin
    : configuredBaseUrl || requestOrigin;

  const configuredSecret =
    (typeof env.BETTER_AUTH_SECRET === 'string' && env.BETTER_AUTH_SECRET.trim()) ||
    process.env.BETTER_AUTH_SECRET?.trim() ||
    '';

  let secret = configuredSecret;
  if (!secret) {
    if (isLocalHostname(requestHostname) || process.env.NODE_ENV !== 'production') {
      secret = getLocalDevEphemeralSecret();
    } else {
      throw new Error(
        'Missing BETTER_AUTH_SECRET environment secret for Cloudflare deployment.'
      );
    }
  }

  const database = d1
    ? (d1 as unknown as NonNullable<Parameters<typeof betterAuth>[0]['database']>)
    : memoryAdapter(globalAuthFallback.__lowscore_memory_db!);

  return betterAuth({
    database,
    secret,
    baseURL,
    basePath: '/api/auth',
    trustedOrigins: async (req) => {
      const origins = new Set<string>([
        baseURL,
        requestOrigin,
        'http://localhost:3005',
        'http://localhost:3000',
        'http://localhost:8787',
        'http://127.0.0.1:3005',
        'http://127.0.0.1:3000',
      ]);
      if (configuredBaseUrl) origins.add(configuredBaseUrl);
      if (req) {
        const resolved = resolveRequestOrigin(req);
        if (resolved) {
          origins.add(resolved.origin);
          const reqOriginHeader = req.headers.get('origin');
          if (reqOriginHeader) {
            try {
              const parsedOrigin = new URL(reqOriginHeader);
              if (
                parsedOrigin.host === resolved.host &&
                parsedOrigin.protocol === resolved.protocol
              ) {
                origins.add(parsedOrigin.origin);
              }
            } catch {
              // ignore malformed Origin header
            }
          }
        }
      }
      return Array.from(origins);
    },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 4,
      autoSignIn: true,
      password: {
        hash: hashPasswordPBKDF2,
        verify: verifyPasswordPBKDF2,
      },
    },
    user: {
      additionalFields: {
        soundEnabled: {
          type: 'boolean',
          defaultValue: true,
          required: false,
          input: true,
        },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    advanced: {
      ipAddress: {
        ipAddressHeaders: ['cf-connecting-ip', 'x-forwarded-for'],
      },
      useSecureCookies: baseURL.startsWith('https://'),
    },
  });
}
