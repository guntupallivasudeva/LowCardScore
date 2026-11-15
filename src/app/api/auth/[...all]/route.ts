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

async function normalizeAuthRequest(request: Request): Promise<Request> {
  const method = request.method.toUpperCase();
  if (
    (method === 'POST' || method === 'PUT' || method === 'PATCH') &&
    !request.headers.get('content-type')
  ) {
    const rawBody = await request.text().catch(() => '');
    const headers = new Headers(request.headers);
    headers.set('content-type', 'application/json');
    headers.delete('content-length');
    const body = rawBody.trim().length > 0 ? rawBody : '{}';
    return new Request(request.url, {
      method,
      headers,
      body,
    });
  }
  return request;
}

async function handleAuthRequest(request: Request): Promise<Response> {
  const normalizedRequest = await normalizeAuthRequest(request);
  const auth = await getAuth(normalizedRequest);
  const res = await auth.handler(normalizedRequest);
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
