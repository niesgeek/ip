import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { onRequest as whoami } from "../functions/api/whoami.js";
import { onRequest as page } from "../functions/index.js";
import { onRequest as json } from "../functions/json.js";
import { buildWhoami, clientIp } from "../functions/_lib/edge.js";
import { wantsPlainText } from "../functions/_lib/negotiate.js";

const FIELDS = [
  "ip", "type", "asn", "org", "isp", "city", "region", "country", "country_code",
  "continent", "latitude", "longitude", "postal", "timezone", "isEu", "colo",
  "tlsVersion", "tlsCipher", "httpProtocol", "acceptLanguage", "edge", "ts",
];

function mockRequest(url, { headers = {}, cf = {}, method = "GET" } = {}) {
  const request = new Request(url, { method, headers });
  request.cf = cf;
  return request;
}

const CF = {
  asn: 15169,
  asOrganization: "Google LLC",
  city: "Mountain View",
  region: "California",
  country: "US",
  continent: "NA",
  latitude: "37.4056",
  longitude: "-122.0775",
  postalCode: "94043",
  timezone: "America/Los_Angeles",
  isEUCountry: "0",
  colo: "SJC",
  tlsVersion: "TLSv1.3",
  tlsCipher: "AEAD-AES128-GCM-SHA256",
  httpProtocol: "HTTP/3",
};

test("whoami fields come from the connection and request.cf", () => {
  const request = mockRequest("https://lookup.local/json", {
    headers: {
      "cf-connecting-ip": "8.8.8.8, 1.2.3.4",
      "x-forwarded-for": "9.9.9.9",
      "accept-language": "zh-CN,zh;q=0.9",
    },
    cf: CF,
  });
  const body = buildWhoami(request, 1700000000000);
  assert.deepEqual(Object.keys(body), FIELDS);
  assert.equal(body.ip, "8.8.8.8");
  assert.equal(body.type, "IPv4");
  assert.equal(body.asn, 15169);
  assert.equal(body.org, "Google LLC");
  assert.equal(body.isp, null);
  assert.equal(body.country, "US");
  assert.equal(body.country_code, "US");
  assert.equal(body.latitude, "37.4056");
  assert.equal(body.postal, "94043");
  assert.equal(body.isEu, false);
  assert.equal(body.colo, "SJC");
  assert.equal(body.httpProtocol, "HTTP/3");
  assert.equal(body.acceptLanguage, "zh-CN,zh;q=0.9");
  assert.equal(body.edge, true);
  assert.equal(body.ts, 1700000000000);
});

test("client IP falls through only when the edge header is missing", () => {
  const request = mockRequest("https://lookup.local/json", {
    headers: { "x-forwarded-for": "203.0.113.9, 198.51.100.1" },
  });
  assert.equal(clientIp(request), "203.0.113.9");
  const bracketed = mockRequest("https://lookup.local/json", {
    headers: { "cf-connecting-ip": "[2001:db8::1]" },
  });
  assert.equal(clientIp(bracketed), "2001:db8::1");
  assert.equal(buildWhoami(bracketed, 1).type, "IPv6");
  assert.equal(buildWhoami(bracketed, 1).isEu, null);
});

test("/json and /api/whoami return the same payload and cache headers", async () => {
  const headers = { "cf-connecting-ip": "1.1.1.1", "accept-language": "" };
  const cf = { ...CF, country: "AU", isEUCountry: "1", asn: 13335 };
  const first = await whoami({ request: mockRequest("https://lookup.local/api/whoami", { headers, cf }) });
  const second = await json({ request: mockRequest("https://lookup.local/json", { headers, cf }) });
  assert.equal(first.headers.get("access-control-allow-origin"), "*");
  assert.equal(first.headers.get("cache-control"), "no-store");
  assert.equal(first.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(second.headers.get("cache-control"), "no-store");
  const a = await first.json();
  const b = await second.json();
  delete a.ts;
  delete b.ts;
  assert.deepEqual(a, b);
  assert.equal(a.isEu, true);
  assert.equal(a.edge, true);
});

test("pretty JSON is formatted and HEAD/OPTIONS/POST are explicit", async () => {
  const pretty = await json({
    request: mockRequest("https://lookup.local/json?pretty", {
      headers: { "cf-connecting-ip": "1.1.1.1" },
    }),
  });
  const text = await pretty.text();
  assert.match(text, /\n/);
  assert.equal(text.trimEnd(), JSON.stringify(JSON.parse(text), null, 2));

  const head = await whoami({
    request: mockRequest("https://lookup.local/api/whoami", { method: "HEAD", headers: { "cf-connecting-ip": "1.1.1.1" } }),
  });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");

  const options = await json({ request: mockRequest("https://lookup.local/json", { method: "OPTIONS" }) });
  assert.equal(options.status, 204);
  assert.equal(options.headers.get("access-control-allow-origin"), "*");

  const post = await whoami({ request: mockRequest("https://lookup.local/api/whoami", { method: "POST" }) });
  assert.equal(post.status, 405);
});

test("root path returns text for CLI clients and HTML for browsers", async () => {
  const env = {
    ASSETS: {
      async fetch(request) {
        const url = new URL(request.url);
        assert.equal(url.pathname, "/index.html");
        return new Response("<!DOCTYPE html><title>IP Lookup</title>", {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      },
    },
  };
  const cases = [
    ["curl/8.5.0", "text/html", "text"],
    ["Wget/1.21", "*/*", "text"],
    ["HTTPie/3.2.2", "*/*", "text"],
    ["python-requests/2.31", "*/*", "text"],
    ["Mozilla/5.0 PowerShell/7.4", "text/html", "text"],
    ["Mozilla/5.0", "text/html,application/xhtml+xml", "html"],
    ["Mozilla/5.0", "text/plain", "text"],
    ["", "*/*", "text"],
  ];
  for (const [ua, accept, kind] of cases) {
    const response = await page({
      request: mockRequest("https://lookup.local/?q=1.1.1.1", {
        headers: { "user-agent": ua, accept, "cf-connecting-ip": "203.0.113.10" },
      }),
      env,
    });
    if (kind === "text") {
      assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8", ua);
      assert.equal(await response.text(), "203.0.113.10\n");
      assert.equal(response.headers.get("cache-control"), "no-store");
    } else {
      assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8", ua);
      assert.match(await response.text(), /IP Lookup/);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal(response.headers.get("vary"), "accept, user-agent");
    }
  }
});

test("plain-text negotiation treats an empty browser accept header as HTML", () => {
  const browser = new Request("https://lookup.local/", { headers: { "user-agent": "Mozilla/5.0" } });
  const anonymous = new Request("https://lookup.local/");
  assert.equal(wantsPlainText(browser), false);
  assert.equal(wantsPlainText(anonymous), true);
});

test("function routes include the root, JSON and whoami endpoints", () => {
  const routes = JSON.parse(readFileSync(new URL("../public/_routes.json", import.meta.url), "utf8"));
  assert.equal(routes.version, 1);
  assert.ok(routes.include.includes("/"));
  assert.ok(routes.include.includes("/json"));
  assert.ok(routes.include.includes("/api/whoami"));
});
