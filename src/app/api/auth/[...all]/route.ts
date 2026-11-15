import { getAuth } from '@/lib/auth';
import { NO_STORE_HEADERS } from '@/lib/cloudflareDb';

export const dynamic = 'force-dynamic';

function withNoStoreHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  Object.entries(NO_STORE_HEADERS).forEach(([k, v]) => headers.set(k, v));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function handleAuthRequest(request: Request): Promise<Response> {
  const auth = await getAuth(request);
  const res = await auth.handler(request);
  return withNoStoreHeaders(res);
}

export async function GET(request: Request): Promise<Response> {
  return handleAuthRequest(request);
}

export async function POST(request: Request): Promise<Response> {
  return handleAuthRequest(request);
}

export async function PUT(request: Request): Promise<Response> {
  return handleAuthRequest(request);
}

export async function PATCH(request: Request): Promise<Response> {
  return handleAuthRequest(request);
}

export async function DELETE(request: Request): Promise<Response> {
  return handleAuthRequest(request);
}
