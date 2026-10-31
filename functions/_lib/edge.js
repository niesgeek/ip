export const COMMON_HEADERS = {
  "access-control-allow-origin": "*",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

function textOrNull(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text ? text : null;
}

function asnOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(String(value).replace(/^AS/i, ""));
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
}

function readIsEu(cf) {
  const value = cf.isEUCountry;
  if (value === "1" || value === 1 || value === true) return true;
  if (value === "0" || value === 0 || value === false) return false;
  return null;
}

export function clientIp(request) {
  const headers = request.headers;
  const candidates = [
    headers.get("cf-connecting-ip"),
    headers.get("true-client-ip"),
    headers.get("x-real-ip"),
    headers.get("x-forwarded-for"),
  ];
  for (const raw of candidates) {
    if (!raw) continue;
    const first = raw.split(",")[0].trim().replace(/^\[|\]$/g, "");
    if (first) return first;
  }
  return null;
}

function ipType(ip) {
  if (!ip) return null;
  if (ip.includes(":")) return "IPv6";
  if (ip.includes(".")) return "IPv4";
  return null;
}

export function buildWhoami(request, now = Date.now()) {
  const cf = request.cf && typeof request.cf === "object" ? request.cf : {};
  const ip = clientIp(request);
  const country = textOrNull(cf.country);
  return {
    ip,
    type: ipType(ip),
    asn: asnOrNull(cf.asn),
    org: textOrNull(cf.asOrganization),
    isp: null,
    city: textOrNull(cf.city),
    region: textOrNull(cf.region),
    country,
    country_code: country,
    continent: textOrNull(cf.continent),
    latitude: textOrNull(cf.latitude),
    longitude: textOrNull(cf.longitude),
    postal: textOrNull(cf.postalCode),
    timezone: textOrNull(cf.timezone),
    isEu: readIsEu(cf),
    colo: textOrNull(cf.colo),
    tlsVersion: textOrNull(cf.tlsVersion),
    tlsCipher: textOrNull(cf.tlsCipher),
    httpProtocol: textOrNull(cf.httpProtocol),
    acceptLanguage: request.headers.get("accept-language") || "",
    edge: true,
    ts: now,
  };
}

function preflight() {
  return new Response(null, {
    status: 204,
    headers: {
      ...COMMON_HEADERS,
      "access-control-allow-methods": "GET, HEAD, OPTIONS",
      "access-control-allow-headers": "*",
      "access-control-max-age": "86400",
    },
  });
}

function methodNotAllowed(contentType) {
  const body = contentType.includes("json")
    ? JSON.stringify({ error: "method not allowed" })
    : "method not allowed\n";
  return new Response(body, {
    status: 405,
    headers: {
      ...COMMON_HEADERS,
      "content-type": contentType,
      allow: "GET, HEAD, OPTIONS",
    },
  });
}

export function handleWhoamiRequest(request) {
  if (request.method === "OPTIONS") return preflight();
  if (request.method !== "GET" && request.method !== "HEAD") {
    return methodNotAllowed("application/json; charset=utf-8");
  }
  const url = new URL(request.url);
  const data = buildWhoami(request);
  const body = url.searchParams.has("pretty")
    ? `${JSON.stringify(data, null, 2)}\n`
    : JSON.stringify(data);
  return new Response(request.method === "HEAD" ? null : body, {
    status: 200,
    headers: {
      ...COMMON_HEADERS,
      "content-type": "application/json; charset=utf-8",
    },
  });
}

export function textIpResponse(request) {
  if (request.method === "OPTIONS") return preflight();
  if (request.method !== "GET" && request.method !== "HEAD") {
    return methodNotAllowed("text/plain; charset=utf-8");
  }
  const ip = clientIp(request) || "unknown";
  return new Response(request.method === "HEAD" ? null : `${ip}\n`, {
    status: 200,
    headers: {
      ...COMMON_HEADERS,
      "content-type": "text/plain; charset=utf-8",
      vary: "accept, user-agent",
    },
  });
}

export async function htmlPageResponse(request, env) {
  if (!env?.ASSETS || typeof env.ASSETS.fetch !== "function") {
    return new Response("页面资源不可用\n", {
      status: 500,
      headers: { ...COMMON_HEADERS, "content-type": "text/plain; charset=utf-8" },
    });
  }
  const assetUrl = new URL(request.url);
  assetUrl.pathname = "/index.html";
  assetUrl.search = "";
  const asset = await env.ASSETS.fetch(new Request(assetUrl.toString(), { method: "GET" }));
  const headers = new Headers(asset.headers);
  headers.set("content-type", "text/html; charset=utf-8");
  headers.set("cache-control", "no-store");
  headers.set("x-content-type-options", "nosniff");
  headers.set("vary", "accept, user-agent");
  headers.set("access-control-allow-origin", "*");
  headers.set("referrer-policy", "no-referrer");
  return new Response(request.method === "HEAD" ? null : asset.body, {
    status: asset.status,
    headers,
  });
}
