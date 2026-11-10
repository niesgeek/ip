import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTACT_INBOX,
  contactConfig,
  contactReady,
  handleContact,
  handleContactConfig,
  resetContactLimits,
  validEmail,
} from "../functions/_lib/contact.js";

const READY = {
  TURNSTILE_SITE_KEY: "site-key",
  TURNSTILE_SECRET_KEY: "secret",
  RESEND_API_KEY: "re_test",
  CONTACT_FROM: "IP Lookup <i@wi.fs.kg>",
};

function post(body, headers = {}) {
  return new Request("https://lookup.local/api/contact", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.8", ...headers },
    body: JSON.stringify(body),
  });
}

function fetchOk(calls) {
  return async (url, init) => {
    calls.push({ url: String(url), body: init.body instanceof URLSearchParams ? init.body.toString() : String(init.body || "") });
    if (String(url).includes("siteverify")) {
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  };
}

test("contact config stays closed until the three secrets exist", () => {
  assert.equal(contactReady({}), false);
  assert.equal(contactReady({ TURNSTILE_SITE_KEY: "a", TURNSTILE_SECRET_KEY: "b" }), false);
  const closed = contactConfig({});
  assert.equal(closed.ready, false);
  assert.equal(closed.siteKey, "");
  assert.equal(closed.inbox, CONTACT_INBOX);
  const open = contactConfig(READY);
  assert.equal(open.ready, true);
  assert.equal(open.siteKey, "site-key");
  assert.equal(JSON.stringify(open).includes("secret"), false);
  assert.equal(JSON.stringify(open).includes("re_test"), false);
});

test("contact form rejects bad input and a filled honeypot", async () => {
  resetContactLimits();
  const bad = await handleContact(post({ email: "nope", message: "hello there", turnstile: "t" }), READY);
  assert.equal(bad.status, 400);
  assert.equal((await bad.json()).code, "INVALID_EMAIL");
  const short = await handleContact(post({ email: "a@b.co", message: "hi", turnstile: "t" }), READY);
  assert.equal((await short.json()).code, "MESSAGE_TOO_SHORT");
  const honey = await handleContact(post({ email: "a@b.co", message: "hello there", website: "https://spam.example", turnstile: "t" }), READY);
  assert.equal((await honey.json()).code, "REJECTED");
  assert.equal(validEmail("i@wi.fs.kg"), true);
});

test("without secrets the handler points back at mailto and does not call Resend", async () => {
  resetContactLimits();
  const calls = [];
  const response = await handleContact(
    post({ email: "a@b.co", message: "hello there", turnstile: "token" }),
    {},
    { fetch: fetchOk(calls) },
  );
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.code, "NOT_CONFIGURED");
  assert.match(body.error, /i@wi\.fs\.kg/);
  assert.equal(calls.length, 0);
});

test("a configured form verifies Turnstile and relays with an [ip] subject", async () => {
  resetContactLimits();
  const calls = [];
  const response = await handleContact(
    post({ name: "Ada", email: "ada@example.com", message: "The map pin is off.", turnstile: "token", lang: "en", page: "/contact" }),
    READY,
    { fetch: fetchOk(calls), now: 1_700_000_000_000 },
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /siteverify/);
  assert.match(calls[0].body, /secret=secret/);
  const mail = JSON.parse(calls[1].body);
  assert.equal(mail.to[0], CONTACT_INBOX);
  assert.equal(mail.reply_to, "ada@example.com");
  assert.match(mail.subject, /^\[ip\] /);
  assert.match(mail.text, /IP Lookup contact form/);
  assert.doesNotMatch(mail.text, /wi\.fs\.kg contact form/);
  const config = await handleContactConfig(READY).json();
  assert.equal(config.ready, true);
});

test("failed Turnstile does not send mail", async () => {
  resetContactLimits();
  const calls = [];
  const response = await handleContact(
    post({ email: "ada@example.com", message: "hello there", turnstile: "nope" }),
    READY,
    {
      fetch: async (url) => {
        calls.push(String(url));
        return new Response(JSON.stringify({ success: false, "error-codes": ["invalid-input-response"] }), { status: 200 });
      },
      now: 1_800_000_000_000,
    },
  );
  assert.equal(response.status, 403);
  assert.equal(calls.length, 1);
});
