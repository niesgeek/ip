import assert from "node:assert/strict";
import test from "node:test";
import { countryLabel } from "../public/assets/logic/countries.js";
import { addressesOf, decodeTxt, lookupDns, summarizeMail } from "../public/assets/logic/dns.js";
import { lookupGeo } from "../public/assets/logic/geo.js";
import {
  assessRisk,
  containingNetwork,
  expandIPv6,
  formatIPv6,
  isNonPublic,
  parseCidr,
  parseIPv6,
  parseTarget,
  ptrName,
  splitTargets,
  tierFor,
} from "../public/assets/logic/net.js";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("risk bands and keyword or ASN hints", () => {
  assert.equal(tierFor(19).id, "home");
  assert.equal(tierFor(20).id, "transit");
  assert.equal(tierFor(39).id, "transit");
  assert.equal(tierFor(40).id, "cloud");
  assert.equal(tierFor(69).id, "cloud");
  assert.equal(tierFor(70).id, "proxy");
  assert.equal(tierFor(100).label, "代理 / VPN 高概率");

  const cloud = assessRisk({ org: "Cloudflare, Inc." });
  assert.equal(cloud.score, 56);
  assert.equal(cloud.tier, "cloud");
  const proxy = assessRisk({ org: "Mullvad VPN" });
  assert.equal(proxy.score, 84);
  assert.equal(proxy.tier, "proxy");
  const home = assessRisk({ isp: "Chinanet" });
  assert.equal(home.score, 8);
  assert.equal(home.label, "住宅 / 企业宽带");
  const transit = assessRisk({ org: "Cogent Communications" });
  assert.equal(transit.score, 30);
  assert.equal(transit.tier, "transit");
  const hosting = assessRisk({ org: "Example Hosting" });
  assert.equal(hosting.score, 48);
  assert.equal(assessRisk({ asn: 13335 }).score, 56);
  assert.equal(assessRisk({ asn: 4134 }).score, 8);
  assert.equal(assessRisk({ org: "Example Net" }).score, 14);
  assert.equal(assessRisk({}).score, 14);
  assert.equal(assessRisk({ local: true }).score, 5);
});

test("parses IP, URL, domain, IDN and CIDR targets", () => {
  assert.equal(parseTarget("8.8.8.8").ip, "8.8.8.8");
  assert.equal(parseTarget("1.1.1.1:443").ip, "1.1.1.1");
  assert.equal(parseTarget("https://example.com/path").domain, "example.com");
  assert.equal(parseTarget("example.com.").domain, "example.com");
  assert.equal(parseTarget("[2001:db8::1]:443").ip, "2001:db8::1");
  assert.equal(parseTarget("::ffff:1.2.3.4").ip, "::ffff:1.2.3.4");
  const idn = parseTarget("https://测试.example.com/a");
  assert.equal(idn.kind, "domain");
  assert.ok(idn.domain.startsWith("xn--"));
  assert.ok(idn.domain.endsWith(".example.com"));
  const cidr = parseTarget("203.0.113.42/26");
  assert.equal(cidr.ip, "203.0.113.42");
  assert.equal(cidr.cidr, "203.0.113.42/26");
  assert.equal(parseTarget("").error.includes("请输入"), true);
  assert.equal(parseTarget("localhost").error.includes("完整域名"), true);
});

test("classifies private networks and containing prefixes", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "192.168.1.1", "172.16.0.1", "100.64.1.1", "169.254.1.1", "224.0.0.1", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1"]) {
    assert.equal(isNonPublic(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "172.15.0.1", "172.32.0.1", "1.1.1.1", "2001:db8::1", "::ffff:8.8.8.8"]) {
    assert.equal(isNonPublic(ip), false, ip);
  }
  assert.equal(containingNetwork("1.2.3.4"), "1.2.3.0/24");
  assert.equal(containingNetwork("2001:db8:1:2::5"), "2001:db8:1:2::/64");
  assert.equal(ptrName("1.2.3.4"), "4.3.2.1.in-addr.arpa");
});

test("formats IPv6 and calculates CIDR", () => {
  assert.equal(formatIPv6(parseIPv6("2001:0db8:0000:0000:0000:0000:0000:0001")), "2001:db8::1");
  assert.equal(formatIPv6(parseIPv6("::1")), "::1");
  assert.equal(formatIPv6(parseIPv6("::")), "::");
  assert.equal(formatIPv6(parseIPv6("::ffff:8.8.8.8")), "::ffff:8.8.8.8");
  assert.equal(expandIPv6("::1"), "0000:0000:0000:0000:0000:0000:0000:0001");
  assert.equal(parseIPv6("gggg::"), null);
  assert.equal(parseIPv6("1:2:3:4:5:6:7:8:9"), null);

  const slash26 = parseCidr("203.0.113.42/26");
  assert.equal(slash26.network, "203.0.113.0");
  assert.equal(slash26.broadcast, "203.0.113.63");
  assert.equal(slash26.netmask, "255.255.255.192");
  assert.equal(slash26.wildcard, "0.0.0.63");
  assert.equal(slash26.first, "203.0.113.1");
  assert.equal(slash26.last, "203.0.113.62");
  assert.equal(slash26.usable, 62);
  assert.equal(slash26.total, 64);

  const slash31 = parseCidr("203.0.113.42/31");
  assert.equal(slash31.network, "203.0.113.42");
  assert.equal(slash31.broadcast, "203.0.113.43");
  assert.equal(slash31.usable, 2);
  assert.match(slash31.note, /RFC 3021/);

  const slash32 = parseCidr("203.0.113.42");
  assert.equal(slash32.prefix, 32);
  assert.equal(slash32.usable, 1);
  assert.equal(slash32.first, "203.0.113.42");

  const v6 = parseCidr("2001:db8::1/48");
  assert.equal(v6.network, "2001:db8::");
  assert.equal(v6.last, "2001:db8:0:ffff:ffff:ffff:ffff:ffff");
  assert.equal(v6.totalText, "2^80");
  assert.equal(v6.broadcast, null);

  const host6 = parseCidr("2001:db8::1");
  assert.equal(host6.prefix, 128);
  assert.equal(host6.totalText, "1");
  assert.equal(host6.network, "2001:db8::1");
});

test("splits at most 20 unique batch targets", () => {
  const split = splitTargets("1.1.1.1，8.8.8.8 1.1.1.1\nexample.com", 20);
  assert.deepEqual(split.items, ["1.1.1.1", "8.8.8.8", "example.com"]);
  const many = splitTargets(Array.from({ length: 25 }, (_, i) => `1.2.3.${i}`).join(" "), 20);
  assert.equal(many.items.length, 20);
  assert.equal(many.truncated, true);
  assert.equal(many.total, 25);
});

test("geo lookup walks providers in order and normalizes records", async () => {
  const calls = [];
  const result = await lookupGeo("8.8.8.8", {
    fetchImpl: async (url) => {
      calls.push(String(url));
      if (String(url).includes("ipwho.is")) {
        return jsonResponse({
          success: true,
          ip: "8.8.8.8",
          type: "IPv4",
          country: "United States",
          country_code: "US",
          region: "California",
          city: "Mountain View",
          latitude: 37.4,
          longitude: -122.08,
          postal: "94043",
          continent_code: "NA",
          connection: { asn: 15169, org: "Google LLC", isp: "Google" },
          timezone: { id: "America/Los_Angeles" },
        });
      }
      throw new Error("should not call later providers");
    },
  });
  assert.deepEqual(calls, ["https://ipwho.is/8.8.8.8"]);
  assert.equal(result.source, "ipwho.is");
  assert.equal(result.record.asn, 15169);
  assert.equal(result.record.org, "Google LLC");
  assert.equal(result.record.timezone, "America/Los_Angeles");
  assert.equal(result.record.country_code, "US");

  const calls2 = [];
  const fallback = await lookupGeo("1.1.1.1", {
    fetchImpl: async (url) => {
      calls2.push(String(url));
      if (String(url).includes("ipwho.is")) return jsonResponse({ success: false }, 429);
      if (String(url).includes("ip.sb")) {
        return jsonResponse({
          ip: "1.1.1.1",
          country: "Australia",
          country_code: "AU",
          city: "Sydney",
          asn: 13335,
          organization: "Cloudflare",
          asn_organization: "Cloudflare, Inc.",
          isp: "Cloudflare",
          latitude: "nil",
          longitude: 151.2,
        });
      }
      throw new Error("should stop after ip.sb");
    },
  });
  assert.equal(fallback.source, "ip.sb");
  assert.equal(fallback.record.latitude, null);
  assert.equal(fallback.record.org, "Cloudflare, Inc.");
  assert.equal(fallback.skipped[0].reason, "限流");
  assert.equal(calls2.length, 2);

  const geojs = await lookupGeo("8.8.8.8", {
    fetchImpl: async (url) => {
      if (!String(url).includes("geojs")) return jsonResponse({}, 429);
      return jsonResponse({
        ip: "8.8.8.8",
        asn: 15169,
        organization: "AS15169 Google LLC",
        organization_name: "Google LLC",
        country: "United States",
        country_code: "US",
        latitude: "nil",
        longitude: "-122.1",
        timezone: "America/Chicago",
        continent_code: "NA",
      });
    },
  });
  assert.equal(geojs.source, "geojs");
  assert.equal(geojs.record.asn, 15169);
  assert.equal(geojs.record.org, "Google LLC");
  assert.equal(geojs.record.latitude, null);
  assert.equal(countryLabel(geojs.record.country_code, geojs.record.country), "美国");
});

test("DNS TXT keeps the most complete answer and mail checks read SPF and DMARC", async () => {
  assert.equal(decodeTxt('"v=spf1 -all"'), "v=spf1 -all");
  assert.equal(decodeTxt('"part1" "part2"'), "part1part2");

  const dns = await lookupDns("example.com", {
    fetchImpl: async (url, init) => {
      const parsed = new URL(url);
      const type = parsed.searchParams.get("type");
      const name = parsed.searchParams.get("name");
      if (parsed.hostname === "cloudflare-dns.com") {
        assert.equal(init.headers.accept, "application/dns-json");
      }
      if (type === "TXT" && name === "example.com") {
        const full = parsed.hostname === "dns.google";
        return jsonResponse({
          Status: 0,
          Answer: full
            ? [{ type: 16, TTL: 30, data: '"v=spf1 -all"' }, { type: 16, TTL: 30, data: '"second-record"' }]
            : [{ type: 16, TTL: 30, data: '"v=spf1 -all"' }],
        });
      }
      if (type === "TXT" && name === "_dmarc.example.com") {
        return jsonResponse({ Status: 0, Answer: [{ type: 16, TTL: 30, data: '"v=DMARC1; p=none;"' }] });
      }
      if (type === "A") {
        return jsonResponse({
          Status: 0,
          Answer: [
            { type: 5, TTL: 10, data: "example.com.cdn." },
            { type: 1, TTL: 10, data: "203.0.113.10" },
          ],
        });
      }
      if (type === "MX") {
        return jsonResponse({ Status: 0, Answer: [{ type: 15, TTL: 10, data: "10 mail.example.com." }] });
      }
      return jsonResponse({ Status: 0, Answer: [] });
    },
  });
  assert.equal(dns.TXT.records.length, 2);
  assert.equal(dns.TXT.source, "google");
  assert.deepEqual(addressesOf(dns), ["203.0.113.10"]);
  assert.equal(dns.MX.records[0].text, "10 mail.example.com");
  const mail = summarizeMail({ txt: dns.TXT.records, dmarc: dns.DMARC.records, mx: dns.MX.records });
  assert.equal(mail.findings.find((item) => item.title === "SPF -all").level, "ok");
  assert.equal(mail.findings.find((item) => item.title === "DMARC none").level, "warn");
  assert.equal(mail.findings.find((item) => item.title === "有 MX").level, "ok");

  const nullMx = await lookupDns("nomail.example", {
    fetchImpl: async (url) => {
      const type = new URL(url).searchParams.get("type");
      if (type === "MX") return jsonResponse({ Status: 0, Answer: [{ type: 15, TTL: 60, data: "0 ." }] });
      return jsonResponse({ Status: 0, Answer: [] });
    },
  });
  assert.equal(nullMx.MX.records[0].text, "0 .");
  const nullMail = summarizeMail({ txt: [], dmarc: [], mx: nullMx.MX.records });
  assert.equal(nullMail.findings.find((item) => item.title === "空 MX").detail.includes("不收信"), true);

  const bad = summarizeMail({
    txt: [{ text: "v=spf1 +all" }, { text: "v=spf1 ip4:203.0.113.0/24 -all" }],
    dmarc: [],
    mx: [],
  });
  assert.ok(bad.findings.some((item) => item.level === "bad" && item.title === "SPF 重复"));
  assert.ok(bad.findings.some((item) => item.title === "没有 DMARC"));
});
