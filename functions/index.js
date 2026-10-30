import { COMMON_HEADERS, htmlPageResponse, textIpResponse } from "./_lib/edge.js";
import { wantsPlainText } from "./_lib/negotiate.js";

export async function onRequest(context) {
  const { request, env } = context;
  if (wantsPlainText(request)) return textIpResponse(request);
  if (request.method === "OPTIONS") return textIpResponse(request);
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("method not allowed\n", {
      status: 405,
      headers: {
        ...COMMON_HEADERS,
        "content-type": "text/plain; charset=utf-8",
        allow: "GET, HEAD, OPTIONS",
      },
    });
  }
  return htmlPageResponse(request, env);
}
