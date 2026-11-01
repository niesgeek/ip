import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { handleReachRequest } from "../functions/api/reach.js";
import {
  collectProbes,
  interpretPingPeSample,
  packProtocol,
  parsePingPeDirectory,
  parsePort,
  probesFromGlobalping,
  probeSide,
  summarizeReach,
  validateTarget,
} from "../public/assets/logic/reach.js";

const PAGE = `
  var taskStartToken = "token-value";
  var taskStartQuery = "1.1.1.1:22";
  var interval_s = 1 ;
  <tr data-pinger-id='CN_104' data-location='China, Jiangsu' data-provider='China Mobile'></tr>
  <tr data-pinger-id='CN_105' data-location='China, Jiangsu' data-provider='China Unicom'></tr>
  <tr data-pinger-id='CN_102' data-location='China, Jiangsu' data-provider='China Telecom'></tr>
  <tr data-pinger-id='US_CA_1' data-location='USA, CA, Fremont' data-provider='Hurricane'></tr>
  <tr data-pinger-id='DE_1' data-location='Germany, Frankfurt' data-provider='Example'></tr>
  <tr data-pinger-id='HK_110' data-location='Hong Kong' data-provider='Example'></tr>
`;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("port and address validation", () => {
  assert.equal(parsePort(""), 22);
  assert.equal(parsePort(null), 22);
  assert.equal(parsePort(" 443 "), 443);
  assert.equal(parsePort("0"), null);
  assert.equal(parsePort("65536"), null);
  assert.equal(parsePort("22abc"), null);
  assert.equal(validateTarget("8.8.8.8", "22").port, 22);
  assert.equal(validateTarget("2001:4860:4860::8888").ip, "2001:4860:4860::8888");
  assert.match(validateTarget("10.1.1.1", "22").error, /私网/);
  assert.match(validateTarget("::1", "22").error, /私网/);
  assert.match(validateTarget("example.com", "443").error, /公网 IP/);
  assert.match(validateTarget("1.1.1.1", "0").error, /端口/);
});

test("ping.pe samples and mainland classification", () => {
  assert.equal(probeSide("CN_104", "China, Jiangsu"), "domestic");
  assert.equal(probeSide("HK_110", "Hong Kong"), "overseas");
  assert.equal(probeSide("TW_1", "Taiwan, Taipei"), "overseas");
  assert.deepEqual(interpretPingPeSample("tcp", { result: 1 }), { status: "fail", ms: null });
  assert.deepEqual(interpretPingPeSample("tcp", { result: 0 }), { status: "ok", ms: null });
  assert.deepEqual(interpretPingPeSample("tcp", { result: 11030 }), { status: "ok", ms: 11.03 });
  assert.equal(interpretPingPeSample("tcp", { result: 1, result_text: "pinger offline" }).status, "offline");
  assert.equal(interpretPingPeSample("icmp", { result: -2000 }).status, "fail");
  assert.equal(interpretPingPeSample("icmp", { result: -1000 }).status, "pending");
  assert.deepEqual(interpretPingPeSample("icmp", { result: 43250 }), { status: "ok", ms: 43.25 });

  const directory = parsePingPeDirectory(PAGE);
  const probes = collectProbes("tcp", [
    { node_id: "CN_104", result: 50000 },
    { node_id: "CN_104", result: 40000 },
    { node_id: "US_CA_1", result: 1 },
    { node_id: "HK_110", result: 1, result_text: "pinger offline" },
    { node_id: "DE_1", result: -1 },
  ], directory);
  const jiangsu = probes.find((probe) => probe.id === "CN_104");
  assert.equal(jiangsu.side, "domestic");
  assert.equal(jiangsu.provider, "China Mobile");
  assert.equal(jiangsu.ms, 40);
  assert.equal(probes.find((probe) => probe.id === "HK_110").status, "offline");
  assert.equal(probes.some((probe) => probe.id === "DE_1"), false);
});

test("verdict follows overseas-up and domestic-down", () => {
  const blockedTcp = packProtocol([
    { id: "CN_104", side: "domestic", status: "fail", location: "China, Jiangsu", provider: "China Mobile" },
    { id: "CN_105", side: "domestic", status: "fail", location: "China, Jiangsu", provider: "China Unicom" },
    { id: "CN_102", side: "domestic", status: "offline", location: "China, Jiangsu", provider: "China Telecom" },
    { id: "US_CA_1", side: "overseas", status: "ok", ms: 20, location: "USA, CA, Fremont", provider: "Hurricane" },
    { id: "DE_1", side: "overseas", status: "ok", ms: null, location: "Germany, Frankfurt", provider: "Example" },
    { id: "HK_110", side: "overseas", status: "ok", ms: 15, location: "Hong Kong", provider: "Example" },
  ], "ping.pe");
  assert.equal(blockedTcp.domestic.state, "fail");
  assert.equal(blockedTcp.domestic.offline, 1);
  assert.equal(blockedTcp.overseas.state, "ok");
  assert.equal(blockedTcp.domesticNodes.some((node) => node.id === "HK_110"), false);

  const icmpOpen = packProtocol([
    { id: "a", side: "domestic", status: "ok", ms: 30 },
    { id: "b", side: "domestic", status: "ok", ms: 40 },
    { id: "c", side: "overseas", status: "ok", ms: 10 },
    { id: "d", side: "overseas", status: "ok", ms: 12 },
  ], "globalping");
  const blocked = summarizeReach({ tcp: blockedTcp, icmp: icmpOpen, port: 22 });
  assert.equal(blocked.id, "blocked");
  assert.match(blocked.detail, /ICMP/);
  assert.match(blocked.title, /22/);

  const clear = summarizeReach({
    tcp: packProtocol([
      { id: "a", side: "domestic", status: "ok" },
      { id: "b", side: "domestic", status: "ok" },
      { id: "c", side: "overseas", status: "ok" },
      { id: "d", side: "overseas", status: "ok" },
    ], "ping.pe"),
    icmp: icmpOpen,
    port: 443,
  });
  assert.equal(clear.id, "clear");

  const down = summarizeReach({
    tcp: packProtocol([
      { id: "a", side: "domestic", status: "fail" },
      { id: "b", side: "domestic", status: "fail" },
      { id: "c", side: "overseas", status: "fail" },
      { id: "d", side: "overseas", status: "fail" },
    ], "ping.pe"),
    icmp: icmpOpen,
    port: 22,
  });
  assert.equal(down.id, "down");
  assert.match(down.detail, /端口没开/);

  const mixed = summarizeReach({
    tcp: packProtocol([
      { id: "a", side: "domestic", status: "ok" },
      { id: "b", side: "domestic", status: "fail" },
      { id: "c", side: "domestic", status: "fail" },
      { id: "d", side: "domestic", status: "fail" },
      { id: "e", side: "overseas", status: "ok" },
      { id: "f", side: "overseas", status: "ok" },
    ], "ping.pe"),
    port: 22,
  });
  assert.equal(mixed.id, "mixed");

  const thin = summarizeReach({
    tcp: packProtocol([
      { id: "a", side: "domestic", status: "fail" },
      { id: "b", side: "overseas", status: "ok" },
    ], "ping.pe"),
    port: 22,
  });
  assert.equal(thin.id, "unknown");
});

test("globalping rows split mainland from everywhere else", () => {
  const probes = probesFromGlobalping({
    results: [
      { probe: { country: "CN", city: "Chengdu", network: "Tencent", asn: 45090 }, result: { status: "finished", stats: { rcv: 1, avg: 82.2 } } },
      { probe: { country: "US", city: "Buffalo", network: "HostPapa", asn: 36352 }, result: { status: "finished", stats: { rcv: 0, avg: null, loss: 100 } } },
      { probe: { country: "HK", city: "Hong Kong", network: "HKT", asn: 1 }, result: { status: "failed", failureSource: "internal" } },
    ],
  });
  assert.equal(probes[0].side, "domestic");
  assert.equal(probes[0].status, "ok");
  assert.equal(probes[1].side, "overseas");
  assert.equal(probes[1].status, "fail");
  assert.equal(probes[2].side, "overseas");
  assert.equal(probes[2].status, "offline");
});

test("reach handler rejects bad targets and folds a ping.pe TCP run", async () => {
  const refused = await handleReachRequest(new Request("https://lookup.local/api/reach?ip=10.1.1.1&port=22"), {
    fetch() { throw new Error("should not probe"); },
  });
  assert.equal(refused.status, 400);
  assert.match((await refused.json()).error, /私网/);

  const method = await handleReachRequest(new Request("https://lookup.local/api/reach?ip=1.1.1.1", { method: "POST" }));
  assert.equal(method.status, 405);

  const calls = [];
  let starts = 0;
  const fetchImpl = async (url, init = {}) => {
    const href = String(url);
    const methodName = init.method || "GET";
    calls.push(`${methodName} ${href}`);
    if (href.includes("browsercheck")) return new Response(PAGE, { status: 200 });
    if (href.includes("ajax_startTask")) {
      starts += 1;
      if (starts === 1) return jsonResponse({ ok: false, error: "Invalid start token" }, 403);
      return jsonResponse({ ok: true, data: { stream_id: "42", interval_s: 1 } });
    }
    if (href.includes("ajax_getPingResults")) {
      return jsonResponse({
        state: { outstandingNodeCount: 0, outstandingNodes: {} },
        data: [
          { node_id: "CN_104", result: 1, result_text: "" },
          { node_id: "CN_105", result: 1, result_text: "" },
          { node_id: "CN_102", result: 1, result_text: "pinger offline" },
          { node_id: "US_CA_1", result: 20000, result_text: "" },
          { node_id: "DE_1", result: 0, result_text: "" },
          { node_id: "HK_110", result: 15000, result_text: "" },
        ],
      });
    }
    if (href.includes("ajax_stopTask")) return new Response("", { status: 200 });
    if (href.startsWith("https://tcp.ping.pe/1.1.1.1:22")) {
      return new Response(`document.cookie="antiflood=abcdef0123456789abcdef0123456789;path=/";`, { status: 200 });
    }
    return new Response(`unexpected ${href}`, { status: 404 });
  };

  const response = await handleReachRequest(new Request("https://lookup.local/api/reach?ip=1.1.1.1"), {
    fetch: fetchImpl,
    sleep: async () => {},
    maxPolls: 1,
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const body = await response.json();
  assert.equal(body.port, 22);
  assert.equal(body.tcp.source, "ping.pe");
  assert.equal(body.tcp.domestic.state, "fail");
  assert.equal(body.tcp.overseas.state, "ok");
  assert.equal(body.tcp.domestic.offline, 1);
  assert.equal(body.tcp.overseasSample.some((node) => node.location === "Hong Kong"), true);
  assert.equal(calls.some((line) => line.startsWith("POST ")), true);
  assert.equal(calls.filter((line) => line.includes("ajax_stopTask")).length, 1);
  assert.equal(starts, 2);
});

test("page routes the reach function and the lookup page exposes it", () => {
  const routes = JSON.parse(readFileSync(new URL("../public/_routes.json", import.meta.url), "utf8"));
  assert.ok(routes.include.includes("/api/reach"));
  const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
  assert.match(html, /id="reach"/);
  assert.match(html, /id="reachPort"/);
  assert.match(html, /value="22"/);
});
