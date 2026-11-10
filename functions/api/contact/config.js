import { handleContactConfig } from "../../_lib/contact.js";

export function onRequest(context) {
  if (context.request.method !== "GET" && context.request.method !== "HEAD") {
    return new Response(JSON.stringify({ ok: false, code: "METHOD_NOT_ALLOWED", error: "Method not allowed." }), {
      status: 405,
      headers: {
        "content-type": "application/json; charset=utf-8",
        allow: "GET, HEAD",
        "cache-control": "no-store",
      },
    });
  }
  const response = handleContactConfig(context.env);
  if (context.request.method === "HEAD") return new Response(null, { status: response.status, headers: response.headers });
  return response;
}
