import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  SIGNALS,
  buildPortrait,
  canonical,
  collisionText,
  compareBrandLists,
  compareLanguageLists,
  diffSignals,
  entropyBits,
  makeSignal,
  missingSignalIds,
  networkSignals,
  normalizeLangTag,
  parseSecChUa,
  sha256Hex,
} from "../public/assets/logic/fp-core.js";

const connection = {
  edge: true,
  ip: "203.0.113.10",
  type: "IPv4",
  asn: 4134,
  org: "Chinanet",
  isp: null,
  city: "Shanghai",
  country: "CN",
  timezone: "Asia/Shanghai",
  colo: "SJC",
  tlsVersion: "TLSv1.3",
  tlsCipher: "AEAD-AES128-GCM-SHA256",
  httpProtocol: "HTTP/3",
  acceptLanguage: "zh-CN,zh;q=0.9,en;q=0.8",
  secChUa: "\"Not;A=Brand\";v=\"24\", \"Chromium\";v=\"120\"",
  secChUaMobile: "?0",
  secChUaPlatform: "\"Linux\"",
  ts: 111,
};

test("catalog lists sixty distinct signals", () => {
  assert.equal(SIGNALS.length, 60);
  assert.equal(new Set(SIGNALS.map((row) => row.id)).size, 60);
  for (const row of SIGNALS) {
    assert.ok(row.name);
    assert.ok(row.group);
    assert.equal(typeof row.bits, "number");
  }
});

test("canonical drops volatile rows and does not depend on input order", () => {
  const canvas = makeSignal({ id: "canvas", value: "已采样", status: "ok", hash: "pixel" });
  const viewport = makeSignal({ id: "viewport", value: "800×600", status: "volatile", hash: "800" });
  const tz = makeSignal({ id: "tz", value: "Asia/Shanghai", status: "ok", hash: "Asia/Shanghai" });
  const forward = canonical([viewport, canvas, tz]);
  const backward = canonical([tz, canvas, viewport]);
  assert.equal(forward, backward);
  assert.equal(forward.includes("viewport"), false);
  assert.match(forward, /canvas\u241eok\u241epixel/);
  assert.match(forward, /tz\u241eok\u241eAsia\/Shanghai/);
  assert.equal(entropyBits([canvas, viewport, makeSignal({ id: "memory", value: "", status: "ok" })]), 8 + 1);
});

test("empty obtained values are marked not provided", () => {
  const row = makeSignal({ id: "vendor", value: "", status: "ok", hash: "" });
  assert.equal(row.status, "absent");
});

test("language and client-hint comparisons keep raw values", () => {
  assert.equal(normalizeLangTag("zh_cn;q=0.9"), "zh-CN");
  assert.equal(compareLanguageLists("zh-CN,zh;q=0.9,en;q=0.8", ["zh-CN", "zh"]), "prefix");
  assert.equal(compareLanguageLists("zh-CN,en", ["en", "zh-CN"]), "reordered");
  assert.equal(compareLanguageLists("zh-CN", ["zh-CN", "en"]), "mismatch");
  assert.equal(compareLanguageLists("", ["zh-CN"]), "insufficient");
  const parsed = parseSecChUa(connection.secChUa);
  assert.deepEqual(parsed.map((item) => item.brand), ["Not;A=Brand", "Chromium"]);
  const same = compareBrandLists(connection.secChUa, parsed);
  assert.equal(same.relation, "exact");
  const different = compareBrandLists(connection.secChUa, [{ brand: "Firefox", version: "120" }]);
  assert.equal(different.relation, "mismatch");
});

test("network signals omit timestamps and do not invent JA3", () => {
  const brands = parseSecChUa(connection.secChUa);
  const first = networkSignals({ connection, brands, languages: ["zh-CN", "zh"] });
  const second = networkSignals({
    connection: { ...connection, ts: 999999, secChUa: connection.secChUa },
    brands,
    languages: ["zh-CN", "zh"],
  });
  assert.equal(first.length, 8);
  assert.equal(canonical(first), canonical(second));
  const ja3 = first.find((row) => row.id === "ja3");
  assert.equal(ja3.status, "absent");
  assert.equal(ja3.hash, "absent");
  assert.match(ja3.detail, /JA3/);
  const moved = networkSignals({
    connection: { ...connection, ip: "198.51.100.8" },
    brands,
    languages: ["zh-CN", "zh"],
  });
  assert.notEqual(canonical(first), canonical(moved));
  const offline = networkSignals({ connection: null, brands, languages: ["zh-CN"] });
  assert.equal(offline.find((row) => row.id === "tls").status, "blocked");
  assert.equal(offline.find((row) => row.id === "ja3").status, "absent");
  assert.equal(missingSignalIds(first).includes("tls"), false);
});

test("retest diff and collision text stay labeled as estimates", () => {
  const before = [makeSignal({ id: "ua", value: "One", status: "ok", hash: "One" })];
  const after = [makeSignal({ id: "ua", value: "Two", status: "ok", hash: "Two" })];
  const changes = diffSignals(before, after);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].kind, "changed");
  assert.equal(changes[0].before, "One");
  assert.match(collisionText(0), /不是实测访客比例/);
  assert.match(collisionText(30), /本地估算/);
  assert.match(collisionText(30), /不是实测访客比例/);
});

test("portrait only mentions values that were actually collected", () => {
  const signals = [
    makeSignal({ id: "tz", value: "Asia/Shanghai", status: "ok", hash: "Asia/Shanghai" }),
    makeSignal({ id: "platform", value: "Linux x86_64", status: "ok", hash: "Linux x86_64" }),
    makeSignal({ id: "webgl-renderer", value: "", status: "absent", hash: "absent" }),
  ];
  const text = buildPortrait(signals, { timezone: "America/Los_Angeles", colo: "LAX" }).join("\n");
  assert.match(text, /Asia\/Shanghai/);
  assert.match(text, /America\/Los_Angeles/);
  assert.match(text, /LAX/);
  assert.match(text, /没有拿到 WebGL/);
  assert.match(text, /Linux x86_64/);
  assert.doesNotMatch(text, /标的位置/);
  assert.doesNotMatch(text, /摄像头|麦克风|定位/);
  assert.doesNotMatch(text, /Lanzhou|上海的书桌|你在上海/);
  const noCity = buildPortrait(signals, { timezone: "Asia/Shanghai" }).join("\n");
  assert.match(noCity, /连接回执里的时区也是 Asia\/Shanghai/);
  assert.doesNotMatch(noCity, /标的位置/);
});

test("portrait talks in short spoken sentences and keeps the caveats", () => {
  const signals = [
    makeSignal({ id: "lang", value: "zh-CN", status: "ok", hash: "zh-CN" }),
    makeSignal({ id: "langs", value: "zh-CN, zh, en", status: "ok", hash: "zh-CN,zh,en" }),
    makeSignal({ id: "tz", value: "Asia/Shanghai", status: "ok", hash: "Asia/Shanghai" }),
    makeSignal({ id: "tz-offset", value: "UTC+08:00", status: "ok", hash: "480" }),
    makeSignal({ id: "ua-platform", value: "Windows", status: "ok", hash: "Windows" }),
    makeSignal({ id: "ua", value: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/154.0.8037.98", status: "ok", hash: "ua" }),
    makeSignal({ id: "ua-full", value: "154.0.8037.98", status: "ok", hash: "154" }),
    makeSignal({ id: "ua-brands", value: "Chromium/154 Google Chrome/154", status: "ok", hash: "brands" }),
    makeSignal({ id: "screen", value: "2560×1440", status: "ok", hash: "2560x1440" }),
    makeSignal({ id: "dpr", value: "1x", status: "ok", hash: "1" }),
    makeSignal({ id: "cores", value: "12", status: "ok", hash: "12" }),
    makeSignal({ id: "memory", value: "32 GB", status: "ok", hash: "32" }),
    makeSignal({ id: "webgl-renderer", value: "Microsoft Basic Render Driver", status: "ok", hash: "gpu" }),
    makeSignal({ id: "canvas", value: "已采样", status: "ok", hash: "c" }),
    makeSignal({ id: "audio", value: "已采样", status: "ok", hash: "a" }),
    makeSignal({ id: "fonts", value: "12 / 40 款和回退字体宽度不同", status: "ok", hash: "f" }),
    makeSignal({ id: "scheme", value: "light", status: "ok", hash: "light" }),
    makeSignal({ id: "lang-header", value: "和页面一致", status: "ok", hash: "exact" }),
    makeSignal({ id: "ua-header", value: "和页面里的品牌一致", status: "ok", hash: "exact" }),
  ];
  const text = buildPortrait(signals, {
    city: "Lanzhou",
    country: "CN",
    timezone: "Asia/Shanghai",
    asn: 4134,
    org: "Chinanet",
    colo: "SJC",
  }, {
    id: "64d09f697d39732d8fcb6f9fabcdefabcdefabcdefabcdefabcdefab",
    now: new Date("2026-11-10T06:43:00Z"),
  }).join("\n");
  assert.match(text, /浏览器把语言设成了中文/);
  assert.match(text, /zh-CN/);
  assert.match(text, /英文/);
  assert.match(text, /不能说明你人在上海/);
  assert.match(text, /Lanzhou，中国/);
  assert.match(text, /书桌/);
  assert.match(text, /周二 14:43/);
  assert.match(text, /Windows 10 或 11/);
  assert.match(text, /Chrome/);
  assert.match(text, /154\.0\.8037\.98/);
  assert.match(text, /2560×1440/);
  assert.match(text, /像素比是 1 倍/);
  assert.match(text, /Microsoft Basic Render Driver/);
  assert.match(text, /逻辑核心 12 个/);
  assert.match(text, /32 GB/);
  assert.match(text, /粗档/);
  assert.match(text, /中国电信/);
  assert.match(text, /AS4134/);
  assert.match(text, /家里或公司的宽带/);
  assert.match(text, /语言是同一套/);
  assert.match(text, /浅色/);
  assert.match(text, /清掉 Cookie/);
  assert.match(text, /也不猜/);
  assert.match(text, /64d09f69 7d39732d 8fcb6f9f/);
  assert.match(text, /没写进这个 ID/);
  assert.match(text, /没有额外去查你/);
  assert.doesNotMatch(text, /；/);
  assert.doesNotMatch(text, /近乎唯一/);
  assert.doesNotMatch(text, /首选语言 zh-CN/);
  assert.doesNotMatch(text, /年龄是|职业是|你是工程师/);
  assert.doesNotMatch(text, /摄像头|麦克风|定位/);
});

test("portrait fallbacks stay quiet when signals are missing", () => {
  const signals = [
    makeSignal({ id: "lang", value: "", status: "absent", hash: "absent" }),
    makeSignal({ id: "tz", value: "Europe/Berlin", status: "ok", hash: "Europe/Berlin" }),
    makeSignal({ id: "canvas", value: "画布被拦住", status: "blocked", hash: "blocked" }),
    makeSignal({ id: "webgl-renderer", value: "", status: "absent", hash: "absent" }),
  ];
  const bare = buildPortrait(signals, { colo: "FRA", org: "Example Net", asn: 65536 }).join("\n");
  assert.match(bare, /没给出语言/);
  assert.match(bare, /Europe\/Berlin/);
  assert.match(bare, /画布被拦住了/);
  assert.match(bare, /没有拿到 WebGL/);
  assert.match(bare, /FRA/);
  assert.match(bare, /Example Net/);
  assert.doesNotMatch(bare, /家里或公司的宽带|住宅/);
  assert.doesNotMatch(bare, /Berlin，|你在柏林/);
  const empty = buildPortrait([], null).join("\n");
  assert.match(empty, /没采到多少能说出口的读数/);
  assert.match(empty, /也不猜/);
  assert.doesNotMatch(empty, /指纹 ID 是/);
  const noId = buildPortrait(signals, null, { id: "" }).join("\n");
  assert.match(noId, /没能把读数收成指纹 ID/);
  const offline = buildPortrait([
    makeSignal({ id: "tz", value: "UTC", status: "ok", hash: "UTC" }),
    makeSignal({ id: "lang-header", value: "没有回执", status: "blocked", hash: "blocked" }),
    makeSignal({ id: "ua-header", value: "没有回执", status: "blocked", hash: "blocked" }),
  ], null).join("\n");
  assert.match(offline, /出口位置这一轮没读到/);
  assert.doesNotMatch(offline, /对不上|被拦住/);
});

test("sha256 of an empty payload is the standard digest", async () => {
  assert.equal(
    await sha256Hex(""),
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
});

test("pages link the fingerprint view and do not upload or persist it", () => {
  const home = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  const page = readFileSync(new URL("../public/fingerprint.html", import.meta.url), "utf8");
  const source = readFileSync(new URL("../public/assets/fingerprint.js", import.meta.url), "utf8");
  assert.match(home, /href="\/fingerprint"/);
  assert.match(page, /href="\/"/);
  assert.match(page, /网站眼里的你/);
  assert.match(page, /点击展开查看/);
  assert.match(page, /这些数字怎么来的/);
  assert.match(page, /每一项有一个事先写好的权重/);
  const css = readFileSync(new URL("../public/assets/fingerprint.css", import.meta.url), "utf8");
  assert.match(css, /#fpList\{display:flex;flex-direction:column;gap:22px\}/);
  assert.match(css, /\.fp-vnote-hint\{/);
  assert.match(css, /\.fp-chevron\{/);
  assert.match(page, /\/api\/whoami/);
  assert.doesNotMatch(source, /fingerprintjs|FingerprintJS|getUserMedia|getCurrentPosition/i);
  assert.match(source, /ip-lookup\.storage-probe/);
  assert.doesNotMatch(source, /localStorage\.setItem\(\s*["'](?!ip-lookup\.storage-probe)/);
  assert.match(readFileSync(new URL("../public/_headers", import.meta.url), "utf8"), /camera=\(\)/);
});
