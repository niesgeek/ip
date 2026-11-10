import { applyDom, bindLangToggle, getLang, L, onLang } from "./logic/i18n.js";
import { isNonPublic } from "./logic/net.js";
import {
  GLOBALPING_ENDPOINT,
  globalpingBody,
  packProtocol,
  probesFromGlobalping,
  summarizeReach,
  validateTarget,
} from "./logic/reach.js";

const $ = (sel) => document.querySelector(sel);

function esc(value) {
  return String(value ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
}

function show(el, on) {
  if (el) el.hidden = !on;
}

const REACH_CACHE = "ip-lookup.reach.v1";
const page = { model: null, cached: false };
let reachSeq = 0;
let reachAbort = null;

function reachSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readReachCache(ip, port) {
  try {
    const all = JSON.parse(sessionStorage.getItem(REACH_CACHE) || "{}");
    const hit = all[`${ip}|${port}`];
    if (!hit || Date.now() - hit.at > 10 * 60 * 1000) return null;
    return hit.model;
  } catch {
    return null;
  }
}

function dropReachCache(ip, port) {
  try {
    const all = JSON.parse(sessionStorage.getItem(REACH_CACHE) || "{}");
    delete all[`${ip}|${port}`];
    sessionStorage.setItem(REACH_CACHE, JSON.stringify(all));
  } catch { /* private mode */ }
}

function writeReachCache(model) {
  try {
    const all = JSON.parse(sessionStorage.getItem(REACH_CACHE) || "{}");
    const keys = Object.keys(all);
    if (keys.length > 8) delete all[keys[0]];
    all[`${model.ip}|${model.port}`] = { at: Date.now(), model };
    sessionStorage.setItem(REACH_CACHE, JSON.stringify(all));
  } catch { /* private mode */ }
}

function toneOf(id) {
  if (id === "clear") return "ok";
  if (id === "blocked" || id === "error") return "bad";
  if (id === "down" || id === "mixed" || id === "asymmetric") return "warn";
  return "muted";
}

function nodeLine(node) {
  const where = [node.location, node.provider].filter(Boolean).join(" · ") || node.id;
  const mark = node.status === "ok"
    ? `<b class="reach-ok">${node.ms == null ? esc(L("通", "up")) : `${esc(node.ms)} ms`}</b>`
    : `<b class="reach-bad">${esc(L("不通", "down"))}</b>`;
  return `<div class="reach-node"><span>${esc(where)}</span>${mark}</div>`;
}

function protoBlock(label, side, nodes) {
  if (!side) {
    return `<div class="reach-proto"><div class="reach-proto-h"><span>${esc(label)}</span><span class="pill pill-wait">${esc(L("还在测", "checking"))}</span></div></div>`;
  }
  const pill = side.state === "fail" ? "pill-bad" : side.state === "mixed" ? "pill-dc" : side.state === "ok" ? "pill-home" : "pill-wait";
  const text = side.total < 2 ? L("样本不够", "too few") : L(`通 ${side.ok} · 不通 ${side.fail}`, `up ${side.ok} · down ${side.fail}`);
  const list = (nodes || []).map(nodeLine).join("");
  const offline = side.offline ? `<p class="fine">${esc(L(`${side.offline} 个节点离线，已忽略`, `${side.offline} offline nodes ignored`))}</p>` : "";
  return `<div class="reach-proto"><div class="reach-proto-h"><span>${esc(label)}</span><span class="pill ${pill}">${text}</span></div>${list}${offline}</div>`;
}

function columnHtml(heading, icmp, tcp, port, overseas) {
  const icmpNodes = overseas ? icmp?.overseasSample : icmp?.domesticNodes;
  const tcpNodes = overseas ? tcp?.overseasSample : tcp?.domesticNodes;
  const icmpSide = overseas ? icmp?.overseas : icmp?.domestic;
  const tcpSide = overseas ? tcp?.overseas : tcp?.domestic;
  return `<h3 class="reach-h">${heading}</h3>${protoBlock("ICMP", icmpSide, icmpNodes)}${protoBlock(`TCP ${port}`, tcpSide, tcpNodes)}`;
}

function paintReach(model, options = {}) {
  page.model = model || null;
  page.cached = Boolean(options.cached);
  const banner = $("#reachBanner");
  const grid = $("#reachGrid");
  if (!banner || !grid) return;
  if (!model) {
    banner.className = "reach-banner tone-muted";
    $("#reachTitle").textContent = L("还没探测", "Not checked");
    $("#reachDetail").textContent = L(
      "填一个公网 IP 和端口。这里对照国内和国外，点「开始检测」才会去问。",
      "Enter a public IP and a port. This compares mainland China with abroad after you press Start.",
    );
    $("#reachSrc").textContent = L("填写后开始", "Starts when you ask");
    show(grid, false);
    $("#reachGo").disabled = false;
    $("#reachGo").textContent = L("开始检测", "Start");
    return;
  }
  const verdict = model.tcp || model.tcpError
    ? summarizeReach({ icmp: model.icmp, tcp: model.tcp, port: model.port, icmpError: model.icmpError || "", lang: getLang() })
    : summarizeReach({ icmp: null, tcp: null, port: model.port, lang: getLang() });
  if (model.tcpError && !model.tcp) {
    verdict.id = "error";
    verdict.tone = "bad";
    verdict.title = L("这次没测成", "This check did not finish");
    verdict.detail = model.tcpError;
  }
  banner.className = `reach-banner tone-${toneOf(verdict.id)}`;
  $("#reachTitle").textContent = verdict.title;
  const cached = options.cached ? L(" 这是刚才存在这台浏览器里的结果。", " This is the result kept in this browser a moment ago.") : "";
  $("#reachDetail").textContent = `${verdict.detail}${cached}`;
  const tcpName = model.tcp?.source === "globalping" ? "TCP Globalping" : model.tcp ? "TCP ping.pe" : "TCP …";
  const icmpName = model.icmp ? "ICMP Globalping" : model.icmpError ? L("ICMP 失败", "ICMP failed") : "ICMP …";
  $("#reachSrc").textContent = model.tcp || model.icmp ? `${tcpName} · ${icmpName}` : L("探测中", "Checking");
  const hasNodes = Boolean(model.tcp || model.icmp);
  show(grid, hasNodes);
  if (hasNodes) {
    $("#reachDomestic").innerHTML = columnHtml(L("国内", "Mainland China"), model.icmp, model.tcp, model.port, false);
    $("#reachOverseas").innerHTML = columnHtml(L("国外", "Abroad"), model.icmp, model.tcp, model.port, true);
  }
  const waiting = Boolean(model.pending && !model.tcp && !model.tcpError);
  $("#reachGo").disabled = waiting;
  $("#reachGo").textContent = waiting ? L("探测中…", "Checking…") : L("重新检测", "Run again");
}

function showReachError(message) {
  const err = $("#reachErr");
  err.hidden = false;
  err.textContent = message;
}

function probeErrorMessage(error, fallback) {
  if (error?.client && error.message) return error.message;
  const text = String(error?.message || "");
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(text)) return fallback;
  if (text && text.length <= 80) return text;
  return fallback;
}

async function runGlobalping(ip, port, protocol, signal) {
  const created = await fetch(GLOBALPING_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(globalpingBody(ip, port, protocol)),
    signal,
  });
  const payload = await created.json().catch(() => ({}));
  if (created.status === 429) throw new Error(L("这个网络的探测次数用完了，大约一小时后再试", "This network is out of probes. Try again in about an hour."));
  if (!created.ok || !payload.id) throw new Error(L("公开探测接口没有接受这次请求", "The public probe did not accept this request."));
  let wait = 400;
  for (let i = 0; i < 20; i += 1) {
    await reachSleep(wait);
    const response = await fetch(`${GLOBALPING_ENDPOINT}/${encodeURIComponent(payload.id)}`, {
      cache: "no-store",
      signal,
      headers: { accept: "application/json" },
    });
    if (response.status === 429) throw new Error(L("这个网络的探测次数用完了，大约一小时后再试", "This network is out of probes. Try again in about an hour."));
    const data = await response.json().catch(() => ({}));
    if (data.status && data.status !== "in-progress") return data;
    wait = 700;
  }
  throw new Error(L("探测超时", "The probe timed out."));
}

async function loadTcp(ip, port, signal) {
  let fallback = "";
  try {
    const response = await fetch(`/api/reach?ip=${encodeURIComponent(ip)}&port=${port}`, {
      cache: "no-store",
      signal,
      headers: { accept: "application/json" },
    });
    const data = await response.json().catch(() => ({}));
    if (response.status === 400) {
      const error = new Error(data.error || L("地址不能探测", "That address cannot be probed."));
      error.client = true;
      throw error;
    }
    const useful = data.tcp && (data.tcp.domestic?.total || 0) + (data.tcp.overseas?.total || 0) > 0;
    if (response.ok && useful) return data.tcp;
    fallback = data.error || "";
  } catch (error) {
    if (error.client || error.name === "AbortError") throw error;
    fallback = L("边缘探测没有连上", "The edge probe did not connect.");
  }
  const measurement = await runGlobalping(ip, port, "TCP", signal).catch((error) => {
    if (error.name === "AbortError") throw error;
    const why = probeErrorMessage(error, L("备用探测没有连上", "The backup probe did not connect."));
    throw new Error(fallback ? `${fallback}；${why}` : why);
  });
  return packProtocol(probesFromGlobalping(measurement), "globalping");
}

async function runReach(ip, port) {
  const target = validateTarget(ip, port);
  if (target.error) {
    showReachError(target.error);
    return;
  }
  $("#reachErr").hidden = true;
  reachAbort?.abort();
  const controller = new AbortController();
  reachAbort = controller;
  const seq = ++reachSeq;
  const model = { ip: target.ip, port: target.port, tcp: null, icmp: null, tcpError: "", icmpError: "", pending: true };
  paintReach(model);
  const tcpTask = loadTcp(target.ip, target.port, controller.signal).then(
    (tcp) => { model.tcp = tcp; },
    (error) => { if (error.name !== "AbortError") model.tcpError = probeErrorMessage(error, L("端口探测失败", "The port probe failed.")); },
  );
  const icmpTask = runGlobalping(target.ip, target.port, "ICMP", controller.signal).then(
    (measurement) => { model.icmp = packProtocol(probesFromGlobalping(measurement), "globalping"); },
    (error) => { if (error.name !== "AbortError") model.icmpError = probeErrorMessage(error, L("浏览器没有连上 ICMP 探测", "The browser could not reach the ICMP probe.")); },
  );
  await tcpTask;
  if (seq === reachSeq) paintReach(model);
  await icmpTask;
  if (seq !== reachSeq) return;
  model.pending = false;
  paintReach(model);
  if (model.tcp && model.icmp) writeReachCache(model);
}

function beginReach(ip, port, fresh) {
  const target = validateTarget(ip, port);
  if (target.error) {
    showReachError(target.error);
    return;
  }
  $("#reachErr").hidden = true;
  $("#reachIp").value = target.ip;
  if (!fresh) {
    const cached = readReachCache(target.ip, target.port);
    if (cached) {
      paintReach(cached, { cached: true });
      return;
    }
  } else {
    dropReachCache(target.ip, target.port);
  }
  void runReach(target.ip, target.port);
}

async function prefill() {
  const params = new URLSearchParams(location.search);
  const queryIp = (params.get("ip") || "").trim();
  const queryPort = (params.get("port") || "").trim();
  if (queryPort) $("#reachPort").value = queryPort;
  const bar = $("#barMeIp");
  try {
    const response = await fetch("/api/whoami", { cache: "no-store", headers: { accept: "application/json" } });
    if (response.ok) {
      const data = await response.json();
      if (bar && data?.ip) bar.textContent = data.ip;
      if (!queryIp && data?.ip && !isNonPublic(data.ip) && !$("#reachIp").value.trim()) $("#reachIp").value = data.ip;
    }
  } catch { /* the form still works without it */ }
  if (bar && (bar.textContent === "读取中…" || bar.textContent === "Reading…")) bar.textContent = L("未读到", "unread");
  if (queryIp) beginReach(queryIp, $("#reachPort").value, false);
}

function bind() {
  $("#reachGo").addEventListener("click", () => {
    beginReach($("#reachIp").value, $("#reachPort").value, true);
  });
  $("#reachPort").addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); $("#reachGo").click(); }
  });
  $("#reachIp").addEventListener("keydown", (event) => {
    if (event.key === "Enter") { event.preventDefault(); $("#reachGo").click(); }
  });
  document.querySelectorAll(".reach-port").forEach((button) => {
    button.addEventListener("click", () => {
      $("#reachPort").value = button.dataset.port;
      if ($("#reachIp").value.trim()) $("#reachGo").click();
    });
  });
  const bar = $("#barMe");
  bar?.addEventListener("click", async () => {
    const ip = $("#barMeIp")?.textContent?.trim();
    if (!ip || ip === "读取中…" || ip === "未读到" || ip === "unread") return;
    try {
      await navigator.clipboard.writeText(ip);
    } catch { /* the address is still on screen */ }
  });
}

applyDom(document);
bindLangToggle();
bind();
paintReach(null);
onLang(() => paintReach(page.model, { cached: page.cached }));
void prefill();
