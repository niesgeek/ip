import { handleWhoamiRequest } from "../_lib/edge.js";

export function onRequest(context) {
  return handleWhoamiRequest(context.request);
}
