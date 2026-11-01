import { COMMON_HEADERS } from "../_lib/edge.js";
import { fetchTcpProbes } from "../_lib/pingpe.js";
import { packProtocol, validateTarget } from "../../public/assets/logic/reach.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...COMMON_HEADERS,
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function preflight() {
  return new Response(null, {
    status: 204,
    headers: {
      ...COMMON_HEADERS,
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "*",
      "access-control-max-age": "86400",
    },
  });
}

export async function handleReachRequest(request, deps = {}) {
  if (request.method === "OPTIONS") return preflight();
  if (request.method !== "GET") {
    return json({ error: "method not allowed" }, 405);
  }
  const url = new URL(request.url);
  const target = validateTarget(url.searchParams.get("ip"), url.searchParams.get("port"));
  if (target.error) return json({ error: target.error }, 400);
  try {
    const result = await fetchTcpProbes(target.ip, target.port, deps);
    if (result.error) return json({ error: result.error, ip: target.ip, port: target.port }, 502);
    return json({
      ip: target.ip,
      port: target.port,
      tcp: packProtocol(result.probes, "ping.pe"),
    });
  } catch {
    return json({ error: "连通性探测失败，请稍后再试", ip: target.ip, port: target.port }, 502);
  }
}

export function onRequest(context) {
  return handleReachRequest(context.request);
}
