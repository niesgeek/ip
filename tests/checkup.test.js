import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compareResolvers, dedupeResolvers, parseEdns } from "../public/assets/logic/dnsleak.js";
import { classifyProbe, normalizeHost, probeUrl, rememberLatency, SITE_PROBES, sparkBars } from "../public/assets/logic/sites.js";
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
  assert.deepEqual(SITE_PROBES.map((row) => row.zh), ["Google", "YouTube", "GitHub", "Cloudflare", "Claude", "ChatGPT", "WeChat"]);
  assert.equal(SITE_PROBES.find((row) => row.id === "wechat").host, "weixin.qq.com");
  const trail = rememberLatency([120, null], 400, 4);
  assert.deepEqual(trail, [120, null, 400]);
  const bars = sparkBars([100, 500], 4);
  assert.equal(bars.length, 4);
  assert.equal(bars[0].tone, "empty");
  assert.equal(bars[2].tone, "fast");
  assert.equal(bars[3].tone, "slow");
  assert.ok(bars[3].height >= bars[2].height);
});

test("checkup copy stays on one card and does not name the probe vendors", () => {
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const phrases = readFileSync(new URL("../public/assets/logic/phrases.js", import.meta.url), "utf8");
  const app = readFileSync(new URL("../public/assets/app.js", import.meta.url), "utf8");
  assert.match(html, /id="tab4"/);
  assert.match(html, /id="tab6"/);
  assert.match(html, /class="ipbig"/);
  assert.match(html, /再测一次/);
  assert.match(html, /复制体检摘要/);
  assert.match(html, /以上字段优先由离你最近的边缘节点直接从连接里读出/);
  assert.doesNotMatch(html, /id="reach"/);
  assert.doesNotMatch(`${html}\n${phrases}\n${app}`, /icanhazip|api-ipv4|api-ipv6|4\. \/ 6\./);
  const gfw = readFileSync(new URL("../public/gfwblock.html", import.meta.url), "utf8");
  assert.match(gfw, /被墙检测/);
  assert.match(gfw, /id="reach"/);
  assert.match(gfw, /ip-ui-theme/);
  assert.match(gfw, /ip-ui-lang/);
});
