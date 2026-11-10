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
  assert.doesNotMatch(text, /标的位置/);
  assert.doesNotMatch(text, /摄像头|麦克风|定位/);
  const noCity = buildPortrait(signals, { timezone: "Asia/Shanghai" }).join("\n");
  assert.match(noCity, /连接回执里的时区也是 Asia\/Shanghai/);
  assert.doesNotMatch(noCity, /标的位置/);
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
  assert.match(page, /\/api\/whoami/);
  assert.doesNotMatch(source, /fingerprintjs|FingerprintJS|getUserMedia|getCurrentPosition/i);
  assert.match(source, /ip-lookup\.storage-probe/);
  assert.doesNotMatch(source, /localStorage\.setItem\(\s*["'](?!ip-lookup\.storage-probe)/);
  assert.match(readFileSync(new URL("../public/_headers", import.meta.url), "utf8"), /camera=\(\)/);
});
