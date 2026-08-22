const upstreamOrigin = "https://penguin-cup-fpl-api.nbafantasy.workers.dev";
const publicApiPath = /^(?:health|status|league|history|gw\/\d+)$/;

function corsHeaders(request) {
  return {
    "access-control-allow-origin": request.headers.get("origin") || "*",
    "access-control-allow-methods": "GET,HEAD,OPTIONS",
    "access-control-allow-headers": "Content-Type",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}

export async function onRequest(context) {
  const { request, params } = context;
  const cors = corsHeaders(request);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return Response.json({ error: "Method not allowed" }, { status: 405, headers: cors });
  }

  const segments = Array.isArray(params.path) ? params.path : [params.path];
  const apiPath = segments.filter(Boolean).join("/");
  if (!publicApiPath.test(apiPath)) {
    return Response.json({ error: "Not found" }, { status: 404, headers: cors });
  }

  const incomingUrl = new URL(request.url);
  const upstreamUrl = new URL(`/api/${apiPath}${incomingUrl.search}`, upstreamOrigin);

  try {
    const upstreamResponse = await fetch(upstreamUrl, {
      method: request.method,
      headers: { accept: "application/json" },
    });
    const headers = new Headers(upstreamResponse.headers);
    for (const [name, value] of Object.entries(cors)) headers.set(name, value);
    headers.set("x-penguin-api-proxy", "cloudflare-pages");
    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers,
    });
  } catch {
    return Response.json(
      { error: "Upstream API is temporarily unavailable" },
      { status: 502, headers: { ...cors, "cache-control": "no-store" } },
    );
  }
}
