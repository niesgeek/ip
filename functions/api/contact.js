import { handleContact } from "../_lib/contact.js";

export function onRequest(context) {
  return handleContact(context.request, context.env);
}
