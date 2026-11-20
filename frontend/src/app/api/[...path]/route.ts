/**
 * Relais vers le backend Python (FastAPI, server.py).
 * Le navigateur n'appelle que /api/* sur le même domaine : pas de CORS,
 * et les clés Djelia / Anthropic restent sur le serveur Python.
 */
// Backend déployé sur Railway ; en local, BACKEND_URL=http://127.0.0.1:8000 pour utiliser le serveur de sa machine.
const BACKEND_URL = (process.env.BACKEND_URL ?? 'https://bubbly-elegance-production-150335c2.up.railway.app').replace(/\/$/, '');

async function forward(request: Request, ctx: RouteContext<'/api/[...path]'>) {
  const { path } = await ctx.params;
  const url = `${BACKEND_URL}/api/${path.map(encodeURIComponent).join('/')}${new URL(request.url).search}`;
  const headers = new Headers();
  for (const name of ['content-type', 'x-user-token']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  try {
    const res = await fetch(url, {
      method: request.method,
      headers,
      body: request.method === 'GET' || request.method === 'DELETE' ? undefined : await request.arrayBuffer(),
      cache: 'no-store',
    });
    return new Response(res.body, {
      status: res.status,
      headers: { 'content-type': res.headers.get('content-type') ?? 'application/json' },
    });
  } catch {
    return Response.json(
      { detail: 'Serveur AgriVoix injoignable. Vérifiez votre connexion et réessayez.' },
      { status: 502 },
    );
  }
}

export const GET = forward;
export const POST = forward;
export const DELETE = forward;
