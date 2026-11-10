export const CONTACT_INBOX = "i@wi.fs.kg";
export const DEFAULT_CONTACT_FROM = "IP Lookup <onboarding@resend.dev>";
export const TURNSTILE_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
export const RESEND_URL = "https://api.resend.com/emails";

const MAX_NAME = 80;
const MAX_EMAIL = 200;
const MIN_MESSAGE = 5;
const MAX_MESSAGE = 5000;
const MAX_PAGE = 300;
const MAX_UA = 400;
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60_000;

const hits = new Map();

export function resetContactLimits() {
  hits.clear();
}

function text(value) {
  return String(value || "").trim();
}

function clipRunes(value, max) {
  const chars = [...value];
  return chars.length <= max ? value : chars.slice(0, max).join("");
}

export function cleanLine(value, max) {
  const stripped = [...text(value)].filter((ch) => {
    const code = ch.codePointAt(0);
    return code >= 32 && code !== 127;
  }).join("");
  return clipRunes(stripped, max);
}

export function cleanBlock(value, max) {
  const normalized = text(String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n"));
  const stripped = [...normalized].filter((ch) => {
    if (ch === "\n" || ch === "\t") return true;
    const code = ch.codePointAt(0);
    return code >= 32 && code !== 127;
  }).join("");
  return clipRunes(stripped, max);
}

export function validEmail(value) {
  if (!value || value.length > MAX_EMAIL || /[\s\t\r\n]/.test(value)) return false;
  const at = value.lastIndexOf("@");
  if (at <= 0 || at >= value.length - 1) return false;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (/[,;:<>()]/.test(local) || /[,;:<>()]/.test(domain)) return false;
  const dot = domain.lastIndexOf(".");
  return dot > 0 && dot < domain.length - 1;
}

export function contactReady(env) {
  return Boolean(text(env?.TURNSTILE_SITE_KEY) && text(env?.TURNSTILE_SECRET_KEY) && text(env?.RESEND_API_KEY));
}

export function contactFrom(env) {
  const from = text(env?.CONTACT_FROM);
  return from || DEFAULT_CONTACT_FROM;
}

export function contactConfig(env) {
  return {
    siteKey: text(env?.TURNSTILE_SITE_KEY),
    inbox: CONTACT_INBOX,
    ready: contactReady(env),
  };
}

function allow(ip, now) {
  const key = ip || "unknown";
  const recent = (hits.get(key) || []).filter((stamp) => now - stamp < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    hits.set(key, recent);
    const retry = Math.max(1, Math.ceil((RATE_WINDOW_MS - (now - recent[0])) / 1000));
    return { ok: false, retry };
  }
  recent.push(now);
  hits.set(key, recent);
  return { ok: true, retry: 0 };
}

function clientIp(request) {
  const raw = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "";
  return raw.split(",")[0].trim();
}

const MESSAGES = {
  BAD_JSON: "Could not read that message.",
  INVALID_EMAIL: "Email address looks wrong.",
  MESSAGE_TOO_SHORT: "Write a few more words.",
  MESSAGE_TOO_LONG: "Message is too long.",
  REJECTED: "Could not accept this message.",
  TURNSTILE_REQUIRED: "Security check has not finished.",
  TURNSTILE_FAILED: `Security check failed. Write to ${CONTACT_INBOX} instead.`,
  NOT_CONFIGURED: `Contact mail is not configured on this server. Write to ${CONTACT_INBOX} instead.`,
  RATE_LIMITED: `Too many messages. Try again shortly, or write to ${CONTACT_INBOX}.`,
  SEND_FAILED: `Could not send the message. Write to ${CONTACT_INBOX} instead.`,
  METHOD_NOT_ALLOWED: "Method not allowed.",
};

function result(ok, code) {
  return { ok, code: code || "", error: code ? MESSAGES[code] || MESSAGES.SEND_FAILED : "" };
}

function json(status, body, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "access-control-allow-origin": "*",
      ...extra,
    },
  });
}

export function handleContactConfig(env) {
  return json(200, contactConfig(env));
}

export async function handleContact(request, env, deps = {}) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-allow-headers": "content-type",
        "access-control-max-age": "86400",
        "cache-control": "no-store",
      },
    });
  }
  if (request.method !== "POST") {
    return json(405, result(false, "METHOD_NOT_ALLOWED"), { allow: "POST, OPTIONS" });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json(400, result(false, "BAD_JSON"));
  }
  if (!payload || typeof payload !== "object") return json(400, result(false, "BAD_JSON"));
  if (text(payload.website)) return json(400, result(false, "REJECTED"));

  const name = cleanLine(payload.name, MAX_NAME);
  const email = cleanLine(payload.email, MAX_EMAIL);
  const message = cleanBlock(payload.message, MAX_MESSAGE + 1);
  if (!validEmail(email)) return json(400, result(false, "INVALID_EMAIL"));
  const length = [...message].length;
  if (length < MIN_MESSAGE) return json(400, result(false, "MESSAGE_TOO_SHORT"));
  if (length > MAX_MESSAGE) return json(400, result(false, "MESSAGE_TOO_LONG"));

  const budget = allow(clientIp(request), deps.now || Date.now());
  if (!budget.ok) {
    return json(429, result(false, "RATE_LIMITED"), { "retry-after": String(budget.retry) });
  }
  if (!contactReady(env)) return json(503, result(false, "NOT_CONFIGURED"));

  const token = text(payload.turnstile);
  if (!token) return json(400, result(false, "TURNSTILE_REQUIRED"));

  const fetchImpl = deps.fetch || fetch;
  const lang = String(payload.lang || "").toLowerCase() === "en" ? "en" : "zh";
  let subject = lang === "en" ? "[ip] from the contact page" : "[ip] 来自联系页面";
  if (name) subject += ` — ${name}`;
  const from = contactFrom(env);
  if (/[\r\n]/.test(from) || /[\r\n]/.test(subject)) return json(503, result(false, "SEND_FAILED"));

  const verified = await verifyTurnstile(fetchImpl, env, token, clientIp(request));
  if (verified === "error") return json(503, result(false, "TURNSTILE_FAILED"));
  if (!verified) return json(403, result(false, "TURNSTILE_FAILED"));

  const sent = await sendResend(fetchImpl, env, {
    from,
    to: CONTACT_INBOX,
    replyTo: email,
    subject,
    text: contactBody({
      name,
      email,
      page: cleanLine(payload.page, MAX_PAGE),
      lang,
      ua: cleanLine(request.headers.get("user-agent"), MAX_UA),
      message,
    }),
  });
  if (!sent) return json(503, result(false, "SEND_FAILED"));
  return json(200, { ok: true });
}

async function verifyTurnstile(fetchImpl, env, token, remoteIp) {
  const body = new URLSearchParams();
  body.set("secret", text(env.TURNSTILE_SECRET_KEY));
  body.set("response", token);
  if (remoteIp) body.set("remoteip", remoteIp);
  try {
    const response = await fetchImpl(TURNSTILE_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!response.ok) return "error";
    const data = await response.json();
    return Boolean(data?.success);
  } catch {
    return "error";
  }
}

async function sendResend(fetchImpl, env, mail) {
  try {
    const response = await fetchImpl(RESEND_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${text(env.RESEND_API_KEY)}`,
      },
      body: JSON.stringify({
        from: mail.from,
        to: [mail.to],
        reply_to: mail.replyTo,
        subject: mail.subject,
        text: mail.text,
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function dash(value) {
  return value ? value : "—";
}

function contactBody({ name, email, page, lang, ua, message }) {
  return [
    "IP Lookup contact form",
    "",
    `Name: ${dash(name)}`,
    `Email: ${email}`,
    `Page: ${dash(page)}`,
    `Lang: ${lang}`,
    `User-Agent: ${dash(ua)}`,
    "",
    message,
    "",
  ].join("\n");
}
