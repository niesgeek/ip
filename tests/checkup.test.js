import assert from "node:assert/strict";
import test from "node:test";
import { compareResolvers, dedupeResolvers, parseEdns } from "../public/assets/logic/dnsleak.js";
import { classifyProbe, normalizeHost, probeUrl, SITE_PROBES } from "../public/assets/logic/sites.js";
import { familyOf, parsePlainIp, sameIp, STACK_PROBES } from "../public/assets/logic/stack.js";

test("plain IP text keeps the requested family", () => {
  assert.equal(familyOf("8.8.8.8"), "4");
  assert.equal(familyOf("2001:db8::1"), "6");
  assert.equal(parsePlainIp("  203.0.113.9\n", "4").ip, "203.0.113.9");
  assert.equal(parsePlainIp("2001:db8::1", "4"), null);
  assert.equal(parsePlainIp("not an ip", "6"), null);
  assert.equal(parsePlainIp("[2001:db8::1]", "6").type, "IPv6");
  assert.equal(sameIp("2001:db8::1", "2001:0db8:0000::0001"), true);
  assert.equal(sameIp("1.1.1.1", "1.1.1.1"), true);
  assert.equal(sameIp("1.1.1.1", "2001:db8::1"), false);
  assert.equal(STACK_PROBES[4].length, 2);
  assert.equal(STACK_PROBES[6][0].url.includes("ipv6"), true);
});

test("edns payload becomes a resolver row and compares with the exit", () => {
  assert.equal(parseEdns({}), null);
  assert.equal(parseEdns({ dns: { ip: "nope", geo: "x" } }), null);
  const row = parseEdns({ dns: { ip: "1.1.1.1", geo: "Australia - Cloudflare" } });
  assert.equal(row.country, "Australia");
  assert.equal(row.org, "Cloudflare");
  const duped = dedupeResolvers([row, { ip: "1.1.1.1", geo: "Australia - Cloudflare" }, { ip: "8.8.8.8" }]);
  assert.equal(duped.length, 2);
  const same = compareResolvers([row], [{ ip: "1.1.1.1", asn: 13335 }]);
  assert.equal(same.id, "same-ip");
  const asn = compareResolvers(
    [{ ip: "1.0.0.1", asn: 13335 }],
    [{ ip: "203.0.113.10", asn: 13335 }],
  );
  assert.equal(asn.id, "same-asn");
  const other = compareResolvers(
    [{ ip: "8.8.8.8", asn: 15169 }],
    [{ ip: "203.0.113.10", asn: 4134, cc: "CN" }],
  );
  assert.equal(other.id, "different");
  assert.equal(compareResolvers([], []).id, "empty");
});

test("site probe hosts are our own short list", () => {
  assert.equal(normalizeHost("https://Example.com:443/a?q=1"), "example.com");
  assert.equal(normalizeHost("zh.wikipedia.org."), "zh.wikipedia.org");
  assert.equal(normalizeHost("localhost"), null);
  assert.equal(normalizeHost("bad host"), null);
  assert.equal(normalizeHost("https://[2001:db8::1]/"), null);
  assert.equal(probeUrl("github.com"), "https://github.com/favicon.ico");
  assert.equal(classifyProbe({ ok: true }), "open");
  assert.equal(classifyProbe({ ok: false, reason: "timeout" }), "timeout");
  assert.equal(classifyProbe({ ok: false, reason: "fail" }), "fail");
  assert.equal(SITE_PROBES.length, 10);
  assert.ok(SITE_PROBES.some((row) => row.host === "www.bilibili.com"));
  assert.ok(SITE_PROBES.some((row) => row.host === "github.com"));
});
