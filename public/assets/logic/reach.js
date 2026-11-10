import { isIPv4, isNonPublic, parseIPv6 } from "./net.js";

export const DEFAULT_PORT = 22;

export const GLOBALPING_ENDPOINT = "https://api.globalping.io/v1/measurements";

// Mainland probes plus a few clearly overseas ones. Each probe counts as one
// Globalping test; unauthenticated quota is per caller IP, so the browser calls it.
export const GLOBALPING_LOCATIONS = [
  { country: "CN", limit: 4 },
  { country: "US", limit: 1 },
  { country: "DE", limit: 1 },
  { country: "SG", limit: 1 },
];

export function parsePort(value) {
  if (value == null || String(value).trim() === "") return DEFAULT_PORT;
  const text = String(value).trim();
  if (!/^\d+$/.test(text)) return null;
  const port = Number(text);
  if (port < 1 || port > 65535) return null;
  return port;
}

export function validateTarget(ip, portRaw) {
  const port = parsePort(portRaw);
  if (port == null) return { error: "端口要在 1 到 65535 之间" };
  const text = String(ip || "").trim();
  if (!isIPv4(text) && parseIPv6(text) == null) return { error: "请输入公网 IP。域名先在上面的搜索框解析。" };
  if (isNonPublic(text)) return { error: "私网、回环或保留地址没有公网连通性可测" };
  return { ip: text, port };
}

export function probeSide(id, location = "") {
  const loc = String(location || "").trim().toLowerCase();
  if (/^cn_/i.test(String(id || "")) || loc === "china" || loc.startsWith("china,")) return "domestic";
  return "overseas";
}

function roundMs(value) {
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'");
}

export function parsePingPeDirectory(html) {
  const directory = new Map();
  const re = /data-pinger-id='([^']+)'\s+data-location='([^']*)'\s+data-provider='([^']*)'/g;
  for (const match of String(html || "").matchAll(re)) {
    directory.set(match[1], {
      id: match[1],
      location: decodeEntities(match[2]),
      provider: decodeEntities(match[3]),
    });
  }
  return directory;
}

export function parsePingPeTask(html) {
  const source = String(html || "");
  const token = source.match(/var taskStartToken = "([^"]+)"/)?.[1] || "";
  const query = source.match(/var taskStartQuery = "([^"]*)"/)?.[1] || "";
  const interval = Number(source.match(/var interval_s = (\d+)/)?.[1] || 3);
  if (!token || !query) return null;
  return { token, query, interval: Number.isFinite(interval) && interval > 0 ? interval : 3 };
}

export function parseAntifloodCookie(html) {
  const value = String(html || "").match(/antiflood=([a-f0-9]{16,})/i)?.[1];
  return value ? `antiflood=${value}` : "";
}

export function directoryFromOutstanding(state, directory = new Map()) {
  const nodes = state?.outstandingNodes;
  if (!nodes || typeof nodes !== "object" || Array.isArray(nodes)) return directory;
  for (const [id, meta] of Object.entries(nodes)) {
    if (!id || directory.has(id) || !meta || typeof meta !== "object") continue;
    directory.set(id, {
      id,
      location: String(meta.location || ""),
      provider: String(meta.provider || ""),
    });
  }
  return directory;
}

// ping.pe TCP: 0 = up, 1 = failed, >1 = connect time in microseconds.
// ping.pe ICMP: result/1000 is milliseconds; -2 is a timeout; -1 is "not yet".
export function interpretPingPeSample(kind, item) {
  const text = String(item?.result_text || "");
  if (/offline/i.test(text)) return { status: "offline", ms: null };
  const result = Number(item?.result);
  if (!Number.isFinite(result)) return { status: "pending", ms: null };
  if (kind === "tcp") {
    if (result === 1) return { status: "fail", ms: null };
    if (result === 0) return { status: "ok", ms: null };
    if (result > 1) return { status: "ok", ms: roundMs(result / 1000) };
    return { status: "pending", ms: null };
  }
  const value = result / 1000;
  if (value >= 0) return { status: "ok", ms: roundMs(value) };
  if (value === -2) return { status: "fail", ms: null };
  return { status: "pending", ms: null };
}

function mergeSample(prev, next) {
  if (!prev || prev.status === "pending") return next;
  if (!next || next.status === "pending") return prev;
  if (prev.status === "ok" && next.status === "ok") {
    const ms = [prev.ms, next.ms].filter((value) => value != null);
    return { status: "ok", ms: ms.length ? Math.min(...ms) : null };
  }
  if (next.status === "ok" || prev.status === "ok") return next.status === "ok" ? next : prev;
  if (next.status === "fail" || prev.status === "fail") return next.status === "fail" ? next : prev;
  return next;
}

export function collectProbes(kind, items, directory = new Map()) {
  const byId = new Map();
  for (const item of items || []) {
    const id = String(item?.node_id || "").trim();
    if (!id) continue;
    const sample = interpretPingPeSample(kind, item);
    if (sample.status === "pending") continue;
    const meta = directory.get(id) || {};
    const merged = mergeSample(byId.get(id)?.sample, sample);
    byId.set(id, { id, sample: merged, meta });
  }
  return [...byId.values()].map(({ id, sample, meta }) => ({
    id,
    side: probeSide(id, meta.location),
    location: meta.location || "",
    provider: meta.provider || "",
    status: sample.status,
    ms: sample.ms,
  }));
}

export function probesFromGlobalping(measurement) {
  const probes = [];
  for (const [index, item] of (measurement?.results || []).entries()) {
    const probe = item?.probe || {};
    const result = item?.result || {};
    let status = "pending";
    let ms = null;
    if (result.status === "finished") {
      if (Number(result.stats?.rcv) > 0) {
        status = "ok";
        ms = roundMs(Number(result.stats?.avg));
      } else status = "fail";
    } else if (result.status === "failed") {
      status = result.failureSource === "internal" ? "offline" : "fail";
    } else if (result.status === "offline") status = "offline";
    else continue;
    const country = String(probe.country || "");
    const place = country === "CN" ? "China" : country;
    probes.push({
      id: `${country || "xx"}-${probe.city || index}-${probe.asn || index}`,
      side: country === "CN" ? "domestic" : "overseas",
      location: [place, probe.city].filter(Boolean).join(", "),
      provider: String(probe.network || ""),
      status,
      ms,
    });
  }
  return probes;
}

export function globalpingBody(ip, port, protocol) {
  const measurementOptions = { packets: 2, protocol };
  if (protocol === "TCP") measurementOptions.port = port;
  return {
    type: "ping",
    target: ip,
    inProgressUpdates: false,
    locations: GLOBALPING_LOCATIONS,
    measurementOptions,
  };
}

export function judgeSide(probes) {
  const rows = (probes || []).filter((probe) => probe.status === "ok" || probe.status === "fail");
  const offline = (probes || []).filter((probe) => probe.status === "offline").length;
  const ok = rows.filter((probe) => probe.status === "ok").length;
  const fail = rows.length - ok;
  let state = "unknown";
  if (rows.length >= 2) {
    if (ok === 0) state = "fail";
    else if (fail === 0 || ok >= fail) state = "ok";
    else state = "mixed";
  }
  return { state, ok, fail, offline, total: rows.length };
}

function nodeRank(probe) {
  if (probe.status === "fail") return 0;
  if (probe.status === "ok") return 1;
  return 2;
}

function compactNodes(probes) {
  return [...probes]
    .filter((probe) => probe.status === "ok" || probe.status === "fail")
    .sort((a, b) => nodeRank(a) - nodeRank(b) || String(a.location).localeCompare(String(b.location)))
    .map((probe) => ({
      id: probe.id,
      side: probe.side,
      location: probe.location || "",
      provider: probe.provider || "",
      status: probe.status,
      ms: probe.ms,
    }));
}

export function packProtocol(probes, source) {
  const domestic = (probes || []).filter((probe) => probe.side === "domestic");
  const overseas = (probes || []).filter((probe) => probe.side === "overseas");
  const overseasSample = [
    ...compactNodes(overseas.filter((probe) => probe.status === "fail")).slice(0, 4),
    ...compactNodes(overseas.filter((probe) => probe.status === "ok")).slice(0, 4),
  ];
  return {
    source,
    domestic: judgeSide(domestic),
    overseas: judgeSide(overseas),
    domesticNodes: compactNodes(domestic),
    overseasSample,
  };
}

function sideState(protocol, side) {
  return protocol?.[side]?.state || "unknown";
}

export function summarizeReach({ icmp, tcp, port, icmpError = "", lang = "zh" }) {
  const en = lang === "en";
  const s = (zh, text) => (en ? text : zh);
  const label = `TCP ${port}`;
  if (!tcp) {
    return {
      id: "pending",
      tone: "muted",
      title: s("正在探测", "Checking"),
      detail: s(
        "归属地已经出来了。国内外节点还在测这个端口，通常要几秒到十几秒。",
        "The location is in. Nodes in China and abroad are still testing this port. That usually takes a few seconds.",
      ),
    };
  }
  const domestic = sideState(tcp, "domestic");
  const overseas = sideState(tcp, "overseas");
  const known = (state) => state === "ok" || state === "fail" || state === "mixed";
  if (!known(domestic) || !known(overseas)) {
    return {
      id: "unknown",
      tone: "muted",
      title: s(`${label} 还判断不了`, `${label} is not enough to judge`),
      detail: s(
        "国内或国外返回的有效节点太少。标成离线的节点已经忽略。可以换一个端口，或过一会儿再测。",
        "Too few live nodes came back from China or from abroad. Nodes marked offline are ignored. Try another port, or test again in a moment.",
      ),
    };
  }
  const icmpNote = icmpExtra(icmp, icmpError, en);
  if (overseas === "ok" && domestic === "fail") {
    return {
      id: "blocked",
      tone: "bad",
      title: s(`${label} 很像在国内被封`, `${label} looks blocked in mainland China`),
      detail: s(
        `国外连得上、国内连不上。按这个口径，这个端口在大陆被墙或被封。${icmpNote}可以改个端口再测：换了仍然是国内不通，才更像整段 IP 被封，而不是只封了这一个端口。`,
        `Abroad can connect and mainland China cannot. By this reading, the port is blocked in mainland China. ${icmpNote}Try another port: if mainland China still cannot connect, the whole address looks blocked, not just this port.`,
      ),
    };
  }
  if (overseas === "ok" && domestic === "ok") {
    return {
      id: "clear",
      tone: "ok",
      title: s(`${label} 国内外都通`, `${label} is open in both places`),
      detail: s(
        `国内和国外节点都能连上这个端口，不像被墙。${icmpNote}`,
        `Nodes in mainland China and abroad can both connect to this port. It does not look blocked. ${icmpNote}`,
      ),
    };
  }
  if (overseas === "fail" && domestic === "fail") {
    let detail = s(
      "两边都连不上这个端口。更像是机器没开机、端口没在监听、防火墙把探测丢掉了，或流量用尽，不一定是被墙。",
      "Neither side can connect to this port. That looks more like the machine is down, the port is closed, a firewall dropped the probe, or the quota ran out. It is not necessarily a block.",
    );
    if (sideState(icmp, "domestic") === "ok" && sideState(icmp, "overseas") === "ok") {
      detail = s(
        "两边 ping 都通，但这个端口两边都不通。多半是端口没开，或被防火墙丢掉了，不是整段地址被墙。",
        "Ping works on both sides, but this port is closed on both. The port is probably closed or firewalled, not the whole address blocked.",
      );
    } else if (sideState(icmp, "overseas") === "ok" && sideState(icmp, "domestic") === "fail") {
      detail = s(
        "这个端口国内外都不通，所以端口本身可能没开。另外国外 ping 通、国内 ping 不通，ICMP 这一层更像国内不可达。",
        "This port is closed on both sides, so the port itself may be closed. Ping works abroad and fails in mainland China, so ICMP looks unreachable from China.",
      );
    }
    return { id: "down", tone: "warn", title: s(`${label} 国内外都连不上`, `${label} is closed on both sides`), detail };
  }
  if (overseas === "fail" && domestic === "ok") {
    return {
      id: "asymmetric",
      tone: "warn",
      title: s(`${label} 不像被墙`, `${label} does not look blocked`),
      detail: s(
        `国内能连上，国外反而不能。被墙通常是国内不通。这更像节点波动，或目标只对部分网络开放。${icmpNote}`,
        `Mainland China can connect and abroad cannot. A block usually fails inside China. This looks more like node noise, or a target that is only open to some networks. ${icmpNote}`,
      ),
    };
  }
  return {
    id: "mixed",
    tone: "warn",
    title: s(`${label} 结果不一致`, `${label} came back mixed`),
    detail: s(
      `同一侧里有的节点通、有的不通，还不能说被墙。${icmpNote}可以再测一次，或换一个端口对照。`,
      `On the same side some nodes connect and some do not, so this is not enough to call it blocked. ${icmpNote}Run it again, or compare another port.`,
    ),
  };
}

function icmpExtra(icmp, icmpError, en = false) {
  const s = (zh, text) => (en ? text : zh);
  if (!icmp && icmpError) return s(`ICMP 这次没测成（${icmpError}）。`, `ICMP did not complete this time (${icmpError}). `);
  if (!icmp) return "";
  const domestic = sideState(icmp, "domestic");
  const overseas = sideState(icmp, "overseas");
  if (domestic === "unknown" || overseas === "unknown") {
    return icmpError
      ? s(`ICMP 样本不够（${icmpError}）。`, `Not enough ICMP samples (${icmpError}). `)
      : s("ICMP 样本不够，没有放进结论。", "Not enough ICMP samples, so they were left out of the conclusion. ");
  }
  if (overseas === "ok" && domestic === "ok") return s("ICMP 国内外也都通。", "ICMP is open on both sides. ");
  if (overseas === "ok" && domestic === "fail") return s("ICMP 是国外通、国内不通。", "ICMP works abroad and fails in mainland China. ");
  if (overseas === "fail" && domestic === "fail") return s("ICMP 国内外都不通，很多机器本来就会禁 ping。", "ICMP fails on both sides. Many machines block ping. ");
  if (overseas === "fail" && domestic === "ok") return s("ICMP 国内通、国外不通。", "ICMP works in mainland China and fails abroad. ");
  return s("ICMP 结果不一致。", "ICMP came back mixed. ");
}
