import { countryLabel, continentLabel } from "./logic/countries.js";
import { addressesOf, lookupDns, lookupPtr, summarizeMail } from "./logic/dns.js";
import { edgeUsable, lookupGeo, recordFromEdge, sourceLabel } from "./logic/geo.js";
import {
  assessRisk,
  containingNetwork,
  expandIPv6,
  ipv4ToInt,
  isNonPublic,
  parseCidr,
  parseTarget,
  splitTargets,
} from "./logic/net.js";

const HISTORY_KEY = "ip-lookup.history.v1";
const state = {
  self: null,
  selfToken: 0,
  query: null,
  queryToken: 0,
  queryAbort: null,
  clockTimer: 0,
  batchRows: [],
};

function h(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key === "disabled") node.disabled = true;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, String(value));
  }
  for (const child of [children].flat(2)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

function dash(value) {
  return value == null || value === "" ? "—" : String(value);
}

function placeLine(record) {
  if (!record) return "—";
  if (record.local) return "私网或本机地址";
  const parts = [];
  const country = countryLabel(record.country_code, record.country);
  if (country && country !== "未知") parts.push(country);
  if (record.region && !parts.includes(record.region)) parts.push(record.region);
  if (record.city && !parts.includes(record.city)) parts.push(record.city);
  if (!record.city && !record.region) {
    const continent = continentLabel(record.continent);
    if (continent && !parts.includes(continent)) parts.push(continent);
  }
  return parts.join(" · ") || "—";
}

function orgLine(record) {
  const parts = [];
  for (const value of [record?.org, record?.isp]) {
    if (value && !parts.includes(value)) parts.push(value);
  }
  return parts.join(" · ") || "—";
}

function formatAsn(asn) {
  return asn == null ? "—" : `AS${asn}`;
}

function sourceLine(source, skipped = []) {
  const name = sourceLabel(source);
  if (!skipped.length) return `来源 ${name}`;
  const detail = skipped.map((item) => `${sourceLabel(item.id)}（${item.reason}）`).join("、");
  return `来源 ${name}，已跳过 ${detail}`;
}

function riskOf(record) {
  if (!record) return null;
  return assessRisk({ org: record.org, isp: record.isp, asn: record.asn, local: record.local });
}

function facts(rows) {
  const list = h("dl", { class: "facts" });
  for (const row of rows) {
    if (!row) continue;
    const wrap = h("div");
    wrap.append(h("dt", { text: row.label }));
    const dd = h("dd");
    if (row.id) dd.id = row.id;
    if (row.node) dd.append(row.node);
    else dd.textContent = row.value ?? "—";
    wrap.append(dd);
    list.append(wrap);
  }
  return list;
}

function localRecord(ip) {
  return {
    ip,
    type: ip.includes(":") ? "IPv6" : "IPv4",
    asn: null,
    org: null,
    isp: null,
    city: null,
    region: null,
    country: null,
    country_code: null,
    continent: null,
    latitude: null,
    longitude: null,
    postal: null,
    timezone: null,
    local: true,
  };
}

function summaryText(record, source) {
  return [
    `IP: ${record.ip || "—"}`,
    `位置: ${placeLine(record)}`,
    `运营商: ${orgLine(record)}`,
    `ASN: ${formatAsn(record.asn)}`,
    `来源: ${sourceLabel(source)}`,
  ].join("\n");
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    const previous = button.textContent;
    button.textContent = "已复制";
    window.setTimeout(() => {
      button.textContent = previous;
    }, 1600);
  } catch {
    button.textContent = "复制失败";
  }
}

function formatClock(timeZone) {
  try {
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).format(new Date());
  } catch {
    return "—";
  }
}

function zoneOffsetMinutes(timeZone) {
  try {
    const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "shortOffset" })
      .formatToParts(new Date())
      .find((part) => part.type === "timeZoneName")?.value || "";
    if (name === "GMT") return 0;
    const match = name.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/i);
    if (!match) return null;
    const sign = match[1] === "-" ? -1 : 1;
    return sign * (Number(match[2]) * 60 + Number(match[3] || 0));
  } catch {
    return null;
  }
}

function startClocks(zones) {
  window.clearInterval(state.clockTimer);
  const tick = () => {
    for (const [id, zone] of zones) {
      const node = document.getElementById(id);
      if (node) node.textContent = zone ? formatClock(zone) : "—";
    }
  };
  tick();
  if (zones.some(([, zone]) => zone)) state.clockTimer = window.setInterval(tick, 1000);
}

function haversineKm(a, b) {
  const rad = (n) => (n * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const lat1 = rad(a.latitude);
  const lat2 = rad(b.latitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function renderMap(target) {
  const fragment = document.getElementById("map-template").content.cloneNode(true);
  const place = (name, record) => {
    const dot = fragment.querySelector(`[data-dot="${name}"]`);
    if (!record || record.latitude == null || record.longitude == null) return;
    dot.setAttribute("cx", (record.longitude + 180).toFixed(2));
    dot.setAttribute("cy", (90 - record.latitude).toFixed(2));
  };
  place("self", state.self?.record);
  place("target", target);
  const caption = fragment.querySelector("[data-caption]");
  if (!target || target.latitude == null || target.longitude == null) {
    caption.textContent = "这个结果没有可用坐标。图只按经纬度做等距矩形示意，不是行政边界。";
    return fragment;
  }
  const hemi = `${target.latitude >= 0 ? "北半球" : "南半球"} · ${target.longitude >= 0 ? "东半球" : "西半球"}`;
  const self = state.self?.record;
  if (!self || self.latitude == null || self.longitude == null) {
    caption.textContent = `${hemi}。等距矩形示意，不是行政边界。`;
    return fragment;
  }
  if (target.ip && self.ip && target.ip === self.ip) {
    caption.textContent = `${hemi}。和你的出口是同一个地址。`;
    return fragment;
  }
  const km = haversineKm(self, target);
  const distance = km >= 100 ? `${Math.round(km).toLocaleString("zh-CN")} 公里` : `${km.toFixed(1)} 公里`;
  caption.textContent = `${hemi}。离你的出口大约 ${distance}。示意不是行政边界。`;
  return fragment;
}

function renderSelf() {
  const body = document.getElementById("self-body");
  const source = document.getElementById("self-source");
  const view = state.self;
  if (!view?.record) {
    source.textContent = "不可用";
    body.replaceChildren(h("p", { class: "error", text: "边缘节点和公开接口都没有返回你的地址。可以稍后再试。" }));
    return;
  }
  const record = view.record;
  source.textContent = sourceLine(view.source, view.skipped);
  const risk = riskOf(record);
  const copy = h("button", {
    type: "button",
    class: "ghost",
    text: "复制体检摘要",
    onClick: () => copyText(summaryText(record, view.source), copy),
  });
  body.replaceChildren(
    h("p", { class: "ip", text: record.ip || "—" }),
    facts([
      { label: "国家 / 城市", value: placeLine(record) },
      { label: "运营商", value: orgLine(record) },
      { label: "ASN", value: formatAsn(record.asn) },
      { label: "协议", value: [record.type, record.httpProtocol].filter(Boolean).join(" · ") || "—" },
      record.tlsVersion || record.tlsCipher
        ? { label: "连接 / TLS", value: [record.tlsVersion, record.tlsCipher].filter(Boolean).join(" · ") }
        : null,
      record.colo ? { label: "接入节点", value: record.colo } : null,
      record.timezone ? { label: "时区", value: record.timezone } : null,
      { label: "风险", value: risk ? `${risk.score} · ${risk.label}` : "—" },
    ]),
    h("div", { class: "actions" }, copy),
  );
}

function markTiers(tier) {
  for (const item of document.querySelectorAll("#tiers li")) {
    if (tier && item.dataset.tier === tier) item.setAttribute("aria-current", "true");
    else item.removeAttribute("aria-current");
  }
}

function renderRisk(record, subject, emptyNote) {
  document.getElementById("risk-subject").textContent = subject ? `当前对象：${subject}` : "当前对象：还没有";
  const score = document.getElementById("risk-score");
  const label = document.getElementById("risk-label");
  const meter = document.getElementById("risk-meter");
  const reasons = document.getElementById("risk-reasons");
  if (!record) {
    score.textContent = "—";
    score.className = "risk-score";
    label.textContent = "等待查询";
    meter.value = 0;
    reasons.textContent = emptyNote || "查询后根据运营商名称，以及名称缺失时的少量常见 ASN，在本地打一个 0 到 100 的分。";
    markTiers(null);
    return;
  }
  const risk = riskOf(record);
  score.textContent = String(risk.score);
  score.className = `risk-score tier-${risk.tier}`;
  label.textContent = risk.label;
  meter.value = risk.score;
  reasons.textContent = `${risk.reasons.join(" ")} 这只用来区分家宽、机房和代理，不是威胁情报。`;
  markTiers(risk.tier);
}

function networkButton(ip) {
  const network = containingNetwork(ip);
  if (!network) return null;
  return h("button", {
    type: "button",
    class: "text-button",
    text: network,
    onClick: () => {
      document.getElementById("cidr-input").value = network;
      renderCidr(network);
      document.getElementById("cidr-card").scrollIntoView({ behavior: "smooth", block: "nearest" });
    },
  });
}

function renderResult(view) {
  const body = document.getElementById("result-body");
  window.clearInterval(state.clockTimer);
  if (!view) {
    body.replaceChildren(h("p", { class: "muted", text: "还没有查询目标。输入一个 IP 或域名，或点上面的示例。" }));
    return;
  }
  if (view.message) {
    body.replaceChildren(h("p", { class: view.error ? "error" : "muted", text: view.message }));
    return;
  }
  const record = view.record;
  const selfZone = state.self?.record?.timezone || null;
  const targetZone = record.timezone || null;
  const clockLine = h("span");
  clockLine.append(h("span", { id: "clock-target", text: "—" }));
  if (targetZone) clockLine.append(` ${targetZone}`);
  const selfClock = h("span");
  selfClock.append(h("span", { id: "clock-self", text: "—" }));
  if (selfZone) selfClock.append(` ${selfZone}`);
  let diff = null;
  const selfOff = selfZone ? zoneOffsetMinutes(selfZone) : null;
  const targetOff = targetZone ? zoneOffsetMinutes(targetZone) : null;
  if (selfOff != null && targetOff != null) {
    const hours = (targetOff - selfOff) / 60;
    if (hours === 0) diff = "与你的时区相同";
    else {
      const abs = Math.abs(hours);
      const shown = Number.isInteger(abs) ? String(abs) : abs.toFixed(1);
      diff = `目标比你${hours > 0 ? "快" : "慢"} ${shown} 小时`;
    }
  }
  const choices = view.addresses?.length
    ? h("div", { class: "choices" }, view.addresses.map((ip) => h("button", {
      type: "button",
      class: ip === record.ip ? "choice is-on" : "choice",
      text: ip,
      onClick: () => selectAddress(ip),
    })))
    : null;
  const nodes = [
    view.subject ? h("p", { class: "muted", text: view.subject }) : null,
    choices,
    h("p", { class: "ip", text: record.ip || "—" }),
    h("p", { class: "meta", text: sourceLine(view.source, view.skipped) }),
    facts([
      { label: "国家 / 城市", value: placeLine(record) },
      { label: "运营商", value: orgLine(record) },
      { label: "ASN", value: formatAsn(record.asn) },
      { label: "坐标", value: record.latitude == null ? "—" : `${record.latitude.toFixed(4)}, ${record.longitude.toFixed(4)}` },
      { label: "时区", node: clockLine },
      selfZone ? { label: "你的时间", node: selfClock } : null,
      diff ? { label: "时差", value: diff } : null,
      record.postal ? { label: "邮编", value: record.postal } : null,
      { label: "所在网段", node: networkButton(record.ip) },
      record.type === "IPv4" && ipv4ToInt(record.ip) != null ? { label: "十进制", value: String(ipv4ToInt(record.ip)) } : null,
      record.type === "IPv6" ? { label: "展开形式", value: expandIPv6(record.ip) || "—" } : null,
      { label: "反向解析", value: view.ptr === undefined ? "查询中…" : view.ptr || "没有 PTR", id: "ptr-value" },
    ]),
    renderMap(record),
  ];
  if (record.type === "IPv6") {
    nodes.push(h("p", { class: "meta", text: "IPv6 的地理覆盖通常比 IPv4 粗，城市更可能只是注册地。" }));
  }
  if (view.elapsed != null) nodes.push(h("p", { class: "meta", text: `耗时 ${view.elapsed} ms` }));
  body.replaceChildren(...nodes.filter(Boolean));
  startClocks([["clock-target", targetZone], ["clock-self", selfZone]]);
}

function renderDns(view) {
  const body = document.getElementById("dns-body");
  if (!view) {
    body.replaceChildren(h("p", { class: "muted", text: "查询域名后，这里会列出记录，并给出邮件配置的简要结论。只查 IP 时，这里显示反向解析。" }));
    return;
  }
  if (view.kind === "ip") {
    body.replaceChildren(
      h("p", { text: view.local ? "私网地址通常没有公网 PTR。" : view.ptr ? `PTR ${view.ptr}` : "没有 PTR 记录，或解析服务没有返回。" }),
      h("p", { class: "muted", text: "邮件体检需要一个域名。IP 查询只做反向解析。" }),
    );
    return;
  }
  const dns = view.dns;
  const groups = [
    ["A", "A"],
    ["AAAA", "AAAA"],
    ["MX", "MX"],
    ["TXT", "TXT"],
    ["NS", "NS"],
    ["CAA", "CAA"],
    ["DMARC", "_dmarc TXT"],
  ];
  const blocks = groups.map(([key, title]) => {
    const group = dns[key] || { records: [], error: true, source: null };
    const items = group.records.length
      ? h("ul", { class: "record-list" }, group.records.map((row) => h("li", { text: `${row.typeName} ${row.text}  TTL ${row.ttl || "—"}` })))
      : h("p", { class: "muted", text: group.error ? "没有拿到应答。" : "无记录。" });
    const source = key === "TXT" && group.source ? h("p", { class: "meta", text: `TXT 采用 ${group.source}，这是几家解析里更完整的一份。` }) : null;
    return h("div", { class: "record-block" }, [h("h3", { text: title }), source, items]);
  });
  const mail = summarizeMail({
    txt: (dns.TXT?.records || []).filter((row) => row.type === 16),
    dmarc: (dns.DMARC?.records || []).filter((row) => row.type === 16),
    mx: (dns.MX?.records || []).filter((row) => row.type === 15),
  });
  const findings = h("div", { class: "findings" }, mail.findings.map((item) => h("div", { class: `finding ${item.level}` }, [
    h("b", { text: item.title }),
    item.detail,
  ])));
  const raw = [mail.spf, mail.dmarc].filter(Boolean).map((item) => h("p", {}, h("code", { text: item })));
  body.replaceChildren(
    h("p", { class: "muted", text: `${view.domain} 的记录由浏览器直连 DNS-over-HTTPS 取得。` }),
    ...blocks,
    h("h3", { text: "邮件简检" }),
    findings,
    ...raw,
  );
}

function renderCidr(raw) {
  const body = document.getElementById("cidr-body");
  const input = document.getElementById("cidr-input");
  if (raw != null) input.value = raw;
  const result = parseCidr(input.value);
  if (!result.ok) {
    body.replaceChildren(h("p", { class: "error", text: result.error }));
    return;
  }
  const number = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString("zh-CN") : value;
  };
  body.replaceChildren(facts([
    { label: "网络地址", value: result.network },
    { label: "广播地址", value: result.broadcast || "无（IPv6 不使用广播地址）" },
    { label: "子网掩码", value: result.netmask },
    { label: "通配符掩码", value: result.wildcard },
    { label: "可用范围", value: result.first === result.last ? result.first : `${result.first} – ${result.last}` },
    { label: "地址总数", value: result.totalText.startsWith("2^") ? result.totalText : number(result.totalText) },
    { label: "可用地址", value: result.usableText.startsWith("2^") ? result.usableText : number(result.usableText) },
    { label: "说明", value: result.note },
  ]));
}

function readHistory() {
  try {
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function renderHistory() {
  const list = document.getElementById("history-list");
  const items = readHistory();
  if (!items.length) {
    list.replaceChildren(h("li", { class: "muted", text: "还没有记录" }));
    return;
  }
  list.replaceChildren(...items.map((item) => h("li", {}, h("button", {
    type: "button",
    text: item.q,
    onClick: () => {
      document.getElementById("q").value = item.q;
      runSearch(item.q);
    },
  }))));
}

function remember(q) {
  try {
    const items = readHistory().filter((item) => item.q !== q);
    items.unshift({ q, at: Date.now() });
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 8)));
  } catch {
    // Private mode can reject storage. The lookup itself still works.
  }
  renderHistory();
}

function setQueryParam(value) {
  const url = new URL(location.href);
  if (value) url.searchParams.set("q", value);
  else url.searchParams.delete("q");
  history.replaceState(null, "", url);
}

async function loadSelf() {
  const token = ++state.selfToken;
  const source = document.getElementById("self-source");
  source.textContent = "读取中";
  try {
    const response = await fetch("/api/whoami", { cache: "no-store", headers: { accept: "application/json" } });
    if (!response.ok) throw new Error("status");
    const data = await response.json();
    if (!edgeUsable(data)) throw new Error("unusable");
    if (token !== state.selfToken) return;
    state.self = { record: recordFromEdge(data), source: "edge", skipped: [] };
  } catch {
    if (token !== state.selfToken) return;
    const result = await lookupGeo(null);
    if (token !== state.selfToken) return;
    state.self = result?.record ? { record: result.record, source: result.source, skipped: result.skipped } : null;
  }
  renderSelf();
  if (!state.query) renderRisk(state.self?.record || null, state.self?.record ? "你的出口" : "");
}

async function geolocate(ip, token, signal, meta) {
  const started = performance.now();
  if (isNonPublic(ip)) {
    const record = localRecord(ip);
    state.query = { ...meta, record, source: "local", skipped: [], ptr: undefined };
    renderResult({ ...state.query, subject: meta.subject, elapsed: Math.round(performance.now() - started) });
    renderRisk(record, meta.subject || ip);
    const ptrNode = document.getElementById("ptr-value");
    if (ptrNode) ptrNode.textContent = "私网地址通常没有公网 PTR";
    if (meta.kind === "ip") renderDns({ kind: "ip", local: true });
    return;
  }
  const geo = await lookupGeo(ip, { signal });
  if (token !== state.queryToken || signal.aborted) return;
  if (!geo?.record) {
    const skipped = geo?.skipped?.map((item) => `${sourceLabel(item.id)}（${item.reason}）`).join("、") || "";
    renderResult({
      message: skipped ? `公开接口都没有返回可用结果。已尝试 ${skipped}。` : "公开接口都没有返回可用结果，可能是限流。稍后再试。",
      error: true,
    });
    renderRisk(null, meta.subject || ip, "没有归属地数据，无法估计线路。");
    return;
  }
  state.query = { ...meta, record: geo.record, source: geo.source, skipped: geo.skipped };
  renderResult({
    ...state.query,
    subject: meta.subject,
    addresses: meta.addresses,
    elapsed: Math.round(performance.now() - started),
    ptr: undefined,
  });
  renderRisk(geo.record, meta.subject || geo.record.ip);
  const ptr = await lookupPtr(ip, { signal });
  if (token !== state.queryToken) return;
  const ptrNode = document.getElementById("ptr-value");
  if (ptrNode) ptrNode.textContent = ptr || "没有 PTR";
  if (meta.kind === "ip") renderDns({ kind: "ip", ptr });
}

async function selectAddress(ip) {
  if (!state.query?.addresses) return;
  const token = ++state.queryToken;
  state.queryAbort?.abort();
  const signal = (state.queryAbort = new AbortController()).signal;
  await geolocate(ip, token, signal, {
    subject: state.query.subject,
    addresses: state.query.addresses,
    kind: "domain",
    domain: state.query.domain,
  });
}

async function runSearch(raw) {
  const parsed = parseTarget(raw);
  const token = ++state.queryToken;
  state.queryAbort?.abort();
  const signal = (state.queryAbort = new AbortController()).signal;
  document.getElementById("result-body").replaceChildren(h("p", { class: "muted", text: "查询中…" }));
  if (parsed.error) {
    state.query = { error: true };
    renderResult({ message: parsed.error, error: true });
    renderRisk(null, raw.trim(), parsed.error);
    return;
  }
  if (parsed.cidr) renderCidr(parsed.cidr);
  const label = parsed.kind === "ip" ? parsed.ip : parsed.domain;
  setQueryParam(String(raw).trim());
  remember(label);
  if (parsed.kind === "ip") {
    renderDns(null);
    await geolocate(parsed.ip, token, signal, { subject: parsed.ip, kind: "ip" });
    return;
  }
  document.getElementById("dns-body").replaceChildren(h("p", { class: "muted", text: "正在向多家 DoH 查询…" }));
  const dns = await lookupDns(parsed.domain, { signal });
  if (token !== state.queryToken || signal.aborted) return;
  renderDns({ kind: "domain", domain: parsed.domain, dns });
  const ips = addressesOf(dns);
  if (!ips.length) {
    state.query = { subject: parsed.domain, domain: parsed.domain, kind: "domain" };
    const hasOther = ["MX", "TXT", "NS", "CAA", "DMARC"].some((key) => dns[key]?.records?.length);
    renderResult({
      message: hasOther
        ? `${parsed.domain} 没有 A 或 AAAA，但有其他记录。邮件和 DNS 结果在下面，归属地需要一个地址。`
        : `${parsed.domain} 没有解析到地址。`,
    });
    renderRisk(null, parsed.domain, "没有 IP，无法估计线路。");
    return;
  }
  await geolocate(ips[0], token, signal, {
    subject: parsed.domain,
    addresses: ips,
    kind: "domain",
    domain: parsed.domain,
  });
}

function batchRow(target, record, geo, risk, status) {
  return {
    target,
    ip: record?.ip || "",
    place: record ? placeLine(record) : "",
    asn: record?.asn ? `AS${record.asn}` : "",
    org: record ? orgLine(record) : "",
    risk: risk?.label || "",
    score: risk ? String(risk.score) : "",
    source: geo ? sourceLabel(geo.source) : "",
    status,
  };
}

async function lookupBatchItem(raw) {
  const parsed = parseTarget(raw);
  if (parsed.error) return batchRow(raw, null, null, null, parsed.error);
  if (parsed.kind === "ip") {
    if (isNonPublic(parsed.ip)) return batchRow(raw, localRecord(parsed.ip), { source: "local" }, assessRisk({ local: true }), "私网地址");
    const geo = await lookupGeo(parsed.ip);
    if (!geo?.record) return batchRow(raw, { ip: parsed.ip }, null, null, "没有结果");
    return batchRow(raw, geo.record, geo, riskOf(geo.record), "完成");
  }
  const dns = await lookupDns(parsed.domain);
  const ips = addressesOf(dns);
  if (!ips.length) return batchRow(parsed.domain, null, null, null, "没有 A / AAAA");
  const geo = await lookupGeo(ips[0]);
  const status = ips.length > 1 ? `完成，共 ${ips.length} 个地址` : "完成";
  if (!geo?.record) return batchRow(parsed.domain, { ip: ips[0] }, null, null, "没有归属地");
  return batchRow(parsed.domain, geo.record, geo, riskOf(geo.record), status);
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      out[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return out;
}

function renderBatch(rows) {
  const wrap = document.getElementById("batch-table-wrap");
  const body = document.getElementById("batch-tbody");
  wrap.hidden = rows.length === 0;
  body.replaceChildren(...rows.map((row) => h("tr", {}, [
    h("td", { text: row.target }),
    h("td", { text: dash(row.ip) }),
    h("td", { text: dash(row.place) }),
    h("td", { text: [row.asn, row.org].filter((item) => item && item !== "—").join(" · ") || "—" }),
    h("td", { text: row.score ? `${row.score} · ${row.risk}` : "—" }),
    h("td", { text: dash(row.source) }),
    h("td", { text: row.status }),
  ])));
  document.getElementById("batch-csv").disabled = rows.length === 0;
}

function csvCell(value) {
  const text = value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function exportCsv() {
  const header = ["目标", "IP", "位置", "ASN", "运营商", "风险分", "性质", "来源", "状态"];
  const lines = [header.join(",")];
  for (const row of state.batchRows) {
    lines.push([row.target, row.ip, row.place, row.asn, row.org, row.score, row.risk, row.source, row.status].map(csvCell).join(","));
  }
  const blob = new Blob([`\uFEFF${lines.join("\n")}\n`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = h("a", { href: url, download: "ip-lookup.csv" });
  link.click();
  URL.revokeObjectURL(url);
}

async function runBatch(text) {
  const split = splitTargets(text, 20);
  const note = document.getElementById("batch-note");
  const count = document.getElementById("batch-count");
  count.textContent = `${split.items.length} / 20`;
  if (!split.items.length) {
    note.textContent = "先贴一些 IP 或域名。";
    return;
  }
  note.textContent = split.truncated
    ? `共 ${split.total} 个，只查前 20 个。正在查询 0 / ${split.items.length}`
    : `正在查询 0 / ${split.items.length}`;
  const button = document.getElementById("batch-button");
  button.disabled = true;
  let done = 0;
  try {
    state.batchRows = await mapPool(split.items, 2, async (item) => {
      const row = await lookupBatchItem(item);
      done += 1;
      note.textContent = `${split.truncated ? `共 ${split.total} 个，只查前 20 个。` : ""}正在查询 ${done} / ${split.items.length}`;
      return row;
    });
    renderBatch(state.batchRows);
    note.textContent = split.truncated ? `完成 ${split.items.length} 个，其余 ${split.total - 20} 个未查。` : `完成 ${split.items.length} 个。`;
  } finally {
    button.disabled = false;
  }
}

function fillHosts() {
  for (const node of document.querySelectorAll("[data-host]")) node.textContent = location.host;
}

document.getElementById("search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  runSearch(document.getElementById("q").value);
});

for (const button of document.querySelectorAll("[data-q]")) {
  button.addEventListener("click", () => {
    document.getElementById("q").value = button.dataset.q;
    runSearch(button.dataset.q);
  });
}

document.getElementById("cidr-form").addEventListener("submit", (event) => {
  event.preventDefault();
  renderCidr();
});

for (const button of document.querySelectorAll("[data-cidr]")) {
  button.addEventListener("click", () => renderCidr(button.dataset.cidr));
}

document.getElementById("batch-form").addEventListener("submit", (event) => {
  event.preventDefault();
  runBatch(document.getElementById("batch-input").value);
});

document.getElementById("batch-input").addEventListener("input", () => {
  const split = splitTargets(document.getElementById("batch-input").value, 20);
  document.getElementById("batch-count").textContent = `${split.items.length} / 20`;
});

document.getElementById("batch-csv").addEventListener("click", exportCsv);
document.getElementById("clear-history").addEventListener("click", () => {
  try { localStorage.removeItem(HISTORY_KEY); } catch { /* ignore */ }
  renderHistory();
});

fillHosts();
renderHistory();
const initial = new URLSearchParams(location.search).get("q");
if (initial) {
  document.getElementById("q").value = initial;
  runSearch(initial);
}
loadSelf();
