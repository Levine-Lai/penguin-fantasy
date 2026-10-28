const upstreamOrigin = "https://penguin-cup-fpl-api.nbafantasy.workers.dev";
const publicApiPath = /^(?:health|status|league|history|gw\/\d+)$/;
const operationsPath = /^(?:community|visits|player\/session|duels(?:\/mine)?|admin\/(?:login|logout|overview|arena|player-code|announcements(?:\/[\w-]+)?|duels\/[\w-]+))$/;
const allowedOrigins = new Set(["https://penguin-fantasy.pages.dev", "https://levine-lai.github.io", "https://penguin-cup-2627.hazy-lemon-8599.chatgpt.site"]);

function corsHeaders(request) {
  const origin = request.headers.get("origin") ?? "";
  return {
    ...(allowedOrigins.has(origin) || /^http:\/\/localhost:\d+$/.test(origin) ? { "access-control-allow-origin": origin } : {}),
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "GET,HEAD,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "Content-Type,Authorization",
    "access-control-max-age": "600",
    vary: "Origin",
  };
}

export async function onRequest(context) {
  const { request, params, env } = context;
  const cors = corsHeaders(request);
  const segments = Array.isArray(params.path) ? params.path : [params.path];
  const apiPath = segments.filter(Boolean).join("/");
  const isOperations = operationsPath.test(apiPath);
  if (!publicApiPath.test(apiPath) && !isOperations) {
    return Response.json({ error: "Not found" }, { status: 404, headers: cors });
  }
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigins.has(origin) && !/^http:\/\/localhost:\d+$/.test(origin)) {
    return Response.json({ error: "Origin not allowed" }, { status: 403, headers: cors });
  }

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }

  if ((!isOperations && !["GET", "HEAD"].includes(request.method)) || !["GET", "HEAD", "POST", "DELETE"].includes(request.method)) {
    return Response.json({ error: "Method not allowed" }, { status: 405, headers: cors });
  }

  if (isOperations && !env?.OPS_PROXY_SECRET) return Response.json({ error: "服务尚未配置完成" }, { status: 503, headers: { ...cors, "cache-control": "no-store" } });
  if (Number(request.headers.get("content-length") ?? 0) > 12000) return Response.json({ error: "内容过长" }, { status: 413, headers: cors });

  const incomingUrl = new URL(request.url);
  const upstreamUrl = new URL(`/api/${apiPath}${incomingUrl.search}`, upstreamOrigin);

  try {
    const forwardingHeaders = new Headers({ accept: "application/json", "accept-encoding": "identity" });
    if (isOperations) {
      for (const name of ["content-type", "cookie", "authorization", "origin", "user-agent"]) {
        const value = request.headers.get(name); if (value) forwardingHeaders.set(name, value);
      }
      forwardingHeaders.set("x-penguin-proxy-key", env.OPS_PROXY_SECRET);
      forwardingHeaders.set("x-penguin-client-ip", request.headers.get("cf-connecting-ip") ?? "unknown");
    }
    const upstreamResponse = await fetch(upstreamUrl, {
      method: request.method,
      headers: forwardingHeaders,
      ...(["POST", "DELETE"].includes(request.method) ? { body: request.body } : {}),
    });
    const headers = new Headers(upstreamResponse.headers);
    // Materialize decoded JSON and remove upstream compression metadata. Passing
    // compressed streams through both edge hops stalls some browser/network paths.
    const payload = await upstreamResponse.arrayBuffer();
    headers.delete("content-encoding");
    headers.delete("content-length");
    for (const [name, value] of Object.entries(cors)) headers.set(name, value);
    headers.set("cache-control", isOperations ? "no-store, no-transform" : `${headers.get("cache-control") ?? "no-cache"}, no-transform`);
    headers.set("x-penguin-api-proxy", "cloudflare-pages");
    return new Response(request.method === "HEAD" || [204, 205, 304].includes(upstreamResponse.status) ? null : payload, {
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
